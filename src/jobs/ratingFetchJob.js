/**
 * @fileoverview Job handler for fetching wine ratings.
 * Implements 3-Tier Waterfall Strategy:
 *   Tier 1: Quick SERP AI (~3-8s) - Extract from AI Overview, Knowledge Graph
 *   Tier 2: Gemini Hybrid (~15-45s) - Gemini grounded search + Claude extraction
 *   Tier 3: Legacy Deep Scraping - Full web scraping with page fetches
 *
 * Features:
 * - Circuit breakers to protect against cascading failures
 * - SERP result reuse between Tier 1 and Tier 3 to avoid duplicate API calls
 * - Cost tracking logs for optimization analysis
 * - AbortController for clean timeout handling
 *
 * @module jobs/ratingFetchJob
 */

import { fetchWineRatings, saveExtractedWindows } from '../services/claude.js';
import { hybridWineSearch, isGeminiSearchAvailable } from '../services/geminiSearch.js';
import { quickSerpAiExtraction, isSerpAiAvailable } from '../services/serpAi.js';
import { calculateWineRatings, saveRatings, buildIdentityTokensFromWine, validateRatingsWithIdentity } from '../services/ratings.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import { withCircuitBreaker, isCircuitOpen } from '../services/circuitBreaker.js';
import db from '../db/index.js';
import { nowFunc } from '../db/helpers.js';
import logger from '../utils/logger.js';

// Timeout for Gemini hybrid search (Gemini API + Claude extraction = 2 API calls)
// Increased to 45s to handle slow Gemini responses (32s+ observed in production)
const GEMINI_TIMEOUT_MS = 45000; // 45 seconds

// Timeout for Tier 1 Quick SERP AI extraction
const SERP_AI_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Log tier resolution for cost tracking and latency analysis.
 * Format: JSON log line that can be aggregated for metrics.
 *
 * @param {string} tier - Tier that resolved the request (tier1_serp_ai, tier2_gemini, tier3_legacy)
 * @param {Object} wine - Wine object
 * @param {number} startTime - Start timestamp (Date.now())
 * @param {number} ratingsFound - Number of ratings found
 */
function logTierResolution(tier, wine, startTime, ratingsFound = 0) {
  const latencyMs = Date.now() - startTime;
  logger.info('CostTrack', JSON.stringify({
    wineId: wine.id,
    wineName: wine.wine_name,
    vintage: wine.vintage,
    tier,
    ratingsFound,
    latencyMs,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Transform hybrid Gemini result to standard rating format.
 * @param {Object} hybridResult - Result from hybridWineSearch
 * @returns {Object} Transformed result with ratings array
 */
function transformHybridResult(hybridResult) {
  return {
    ratings: (hybridResult.ratings || []).map(r => ({
      source: r.source ? r.source.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'unknown',
      source_lens: r.source_lens || 'critics',
      score_type: r.score_type || 'points',
      raw_score: r.raw_score,
      raw_score_numeric: r.raw_score_numeric,
      vintage_match: r.vintage_match || 'inferred',
      match_confidence: r.confidence || 'medium',
      source_url: r.source_url,
      tasting_notes: r.tasting_notes
    })),
    tasting_notes: hybridResult.tasting_notes ? JSON.stringify(hybridResult.tasting_notes) : null,
    search_notes: `Found via Gemini Hybrid (${hybridResult._metadata?.sources_count || 0} sources)`
  };
}

/**
 * 3-Tier Waterfall Search Strategy.
 * Each tier is faster/cheaper than the next, with SERP results passed to Tier 3 for reuse.
 *
 * @param {Object} wine - Wine object
 * @param {Function} updateProgress - Progress callback
 * @returns {Promise<{result: Object, usedMethod: string}>}
 */
async function threeTierWaterfall(wine, updateProgress, identityTokens) {
  let serpForReuse = null;
  const startTime = Date.now();

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: Quick SERP AI (~3-8s)
  // Extract ratings from AI Overview, Knowledge Graph, Featured Snippets
  // ═══════════════════════════════════════════════════════════════════════════
  if (isSerpAiAvailable() && !isCircuitOpen('serp_ai')) {
    await updateProgress(10, 'Tier 1: Quick SERP AI');

    try {
      logger.info('RatingFetchJob', `Tier 1: Attempting Quick SERP AI (${SERP_AI_TIMEOUT_MS}ms timeout)`);

      // Race against timeout for fast fail
      const tier1Promise = withCircuitBreaker('serp_ai', () =>
        quickSerpAiExtraction(wine, identityTokens)
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tier 1 SERP AI timed out')), SERP_AI_TIMEOUT_MS)
      );

      const tier1 = await Promise.race([tier1Promise, timeoutPromise]);

      // Save rawSerp for Tier 3 reuse regardless of success
      if (tier1.rawSerp) {
        serpForReuse = tier1.rawSerp;
        logger.info('RatingFetchJob', `Tier 1: Captured ${serpForReuse.organic?.length || 0} organic results for Tier 3 reuse`);
      }

      if (tier1.success && tier1.ratings?.length > 0) {
        const { ratings: validatedTier1 } = validateRatingsWithIdentity(wine, tier1.ratings, identityTokens);

        if (validatedTier1.length === 0) {
          logger.info('RatingFetchJob', 'Tier 1: Identity gate rejected all ratings, continuing');
        }

        logTierResolution('tier1_serp_ai', wine, startTime, tier1.ratings.length);
        logger.info('RatingFetchJob', `Tier 1 SUCCESS: ${tier1.ratings.length} ratings in ${Date.now() - startTime}ms`);
        if (validatedTier1.length > 0) {
          return {
            result: {
              ratings: validatedTier1,
              tasting_notes: tier1.tasting_notes,
              search_notes: tier1.search_notes
            },
            usedMethod: 'serp_ai_tier1'
          };
        }
      }

      logger.info('RatingFetchJob', 'Tier 1: No ratings found, proceeding to Tier 2');
    } catch (err) {
      logger.warn('RatingFetchJob', `Tier 1 failed: ${err.message}`);
      // Circuit breaker will record failure via withCircuitBreaker
    }
  } else if (!isSerpAiAvailable()) {
    logger.info('RatingFetchJob', 'Tier 1: SERP AI not available (missing API keys)');
  } else {
    logger.info('RatingFetchJob', 'Tier 1: Circuit open, skipping');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: Gemini Hybrid (~15-45s)
  // Uses Gemini grounded search + Claude extraction for comprehensive coverage
  // ═══════════════════════════════════════════════════════════════════════════
  if (isGeminiSearchAvailable() && !isCircuitOpen('gemini_hybrid')) {
    await updateProgress(25, 'Tier 2: Gemini Hybrid');

    try {
      logger.info('RatingFetchJob', `Tier 2: Attempting Gemini Hybrid (${GEMINI_TIMEOUT_MS}ms timeout)`);

      // Use AbortController for clean timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        const tier2 = await withCircuitBreaker('gemini_hybrid', async () => {
          const result = await hybridWineSearch(wine);
          if (controller.signal.aborted) {
            throw new Error('Gemini search aborted due to timeout');
          }
          return result;
        });

        clearTimeout(timeoutId);

        if (tier2?.ratings?.length > 0) {
          const { ratings: validatedTier2 } = validateRatingsWithIdentity(wine, tier2.ratings, identityTokens);

          if (validatedTier2.length === 0) {
            logger.info('RatingFetchJob', 'Tier 2: Identity gate rejected all ratings, proceeding to Tier 3');
          }

          logTierResolution('tier2_gemini', wine, startTime, tier2.ratings.length);
          logger.info('RatingFetchJob', `Tier 2 SUCCESS: ${tier2.ratings.length} ratings in ${Date.now() - startTime}ms`);
          if (validatedTier2.length > 0) {
            return {
              result: transformHybridResult({ ...tier2, ratings: validatedTier2 }),
              usedMethod: 'gemini_tier2'
            };
          }
        }

        logger.info('RatingFetchJob', 'Tier 2: No ratings found, proceeding to Tier 3');
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      logger.warn('RatingFetchJob', `Tier 2 failed: ${err.message}`);
      // Circuit breaker will record failure via withCircuitBreaker
    }
  } else if (!isGeminiSearchAvailable()) {
    logger.info('RatingFetchJob', 'Tier 2: Gemini not available (missing API key)');
  } else {
    logger.info('RatingFetchJob', 'Tier 2: Circuit open, skipping');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: Legacy Deep Scraping
  // Full web scraping with Claude extraction - slower but comprehensive
  // Reuses SERP results from Tier 1 to avoid duplicate API calls
  // ═══════════════════════════════════════════════════════════════════════════
  await updateProgress(50, 'Tier 3: Legacy Scraping');
  logger.info('RatingFetchJob', 'Tier 3: Using Legacy Deep Scraping');

  const tier3 = await fetchWineRatings(wine, { existingSerpResults: serpForReuse });

  logTierResolution('tier3_legacy', wine, startTime, tier3.ratings?.length || 0);
  logger.info('RatingFetchJob', `Tier 3 COMPLETE: ${tier3.ratings?.length || 0} ratings in ${Date.now() - startTime}ms`);

  const { ratings: validatedTier3 } = validateRatingsWithIdentity(wine, tier3.ratings || [], identityTokens);

  return {
    result: { ...tier3, ratings: validatedTier3 },
    usedMethod: 'legacy_tier3'
  };
}

/**
 * Job handler for fetching wine ratings.
 * @param {Object} payload - Job payload
 * @param {number} payload.wineId - Wine ID to fetch ratings for
 * @param {boolean} payload.forceRefresh - Whether to bypass cache
 * @param {Object} context - Job context
 * @returns {Object} Job result
 */
async function handleRatingFetch(payload, context) {
  const { wineId, forceRefresh: _forceRefresh = false } = payload;
  const { updateProgress } = context;

  // Get wine details
  await updateProgress(5, 'Loading wine details');
  const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

  if (!wine) {
    throw new Error(`Wine not found: ${wineId}`);
  }

  logger.info('RatingFetchJob', `Starting fetch for: ${wine.wine_name} ${wine.vintage || 'NV'}`);

  // Fetch ratings with 3-tier waterfall
  const identityTokens = buildIdentityTokensFromWine(wine);

  const searchResult = await threeTierWaterfall(wine, updateProgress, identityTokens);
  const { result, usedMethod } = searchResult;

  await updateProgress(70, 'Processing results');

  // Check if we got any ratings
  const rawRatings = result.ratings || [];
  const existingCountRow = await db.prepare(
    'SELECT COUNT(*) as count FROM wine_ratings WHERE wine_id = ? AND is_user_override = FALSE'
  ).get(wineId);
  const existingCount = existingCountRow?.count || 0;

  // Filter ratings by vintage sensitivity
  const sensitivity = getVintageSensitivity(wine);
  const { ratings: identityValidRatings } = validateRatingsWithIdentity(wine, rawRatings, identityTokens);

  const ratings = filterRatingsByVintageSensitivity(wine, identityValidRatings);

  if (rawRatings.length > ratings.length) {
    logger.info('RatingFetchJob', `Filtered ${rawRatings.length - ratings.length} ratings due to vintage mismatch (sensitivity: ${sensitivity})`);
  }

  await updateProgress(80, 'Saving ratings');

  // Save ratings to database
  if (ratings.length > 0) {
    // Clear existing auto-ratings
    await db.prepare('DELETE FROM wine_ratings WHERE wine_id = ? AND is_user_override = FALSE').run(wineId);

    // Insert new ratings
    for (const rating of ratings) {
      await saveRatings(wineId, wine.vintage, [rating]);
    }

    // Save extracted drinking windows
    const windowsSaved = await saveExtractedWindows(wineId, ratings);
    if (windowsSaved > 0) {
      logger.info('RatingFetchJob', `Saved ${windowsSaved} drinking windows`);
    }
  }

  await updateProgress(90, 'Calculating aggregates');

  // Get all ratings for this wine and calculate aggregates
  const allRatings = await db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
  // Get user preference scoped to cellar (use wine.cellar_id since jobs don't have req context)
  const prefSetting = await db.prepare("SELECT value FROM user_settings WHERE cellar_id = ? AND key = 'rating_preference'").get(wine.cellar_id);
  const preference = Number.parseInt(prefSetting?.value || '40', 10);
  const aggregates = calculateWineRatings(allRatings, wine, preference);

  // Safe: nowFunc() is a helper that returns CURRENT_TIMESTAMP SQL function
  const currentTime = nowFunc();

  // Update wine with aggregates and tasting notes
  const sql = [
    'UPDATE wines SET',
    'competition_index = ?,',
    'critics_index = ?,',
    'community_index = ?,',
    'purchase_score = ?,',
    'purchase_stars = ?,',
    'confidence_level = ?,',
    'tasting_notes = COALESCE(?, tasting_notes),',
    'ratings_updated_at = ' + currentTime,
    'WHERE id = ?'
  ].join(' ');
  await db.prepare(sql).run(
    aggregates.competition_index,
    aggregates.critics_index,
    aggregates.community_index,
    aggregates.purchase_score,
    aggregates.purchase_stars,
    aggregates.confidence_level,
    result.tasting_notes || null,
    wineId
  );

  await updateProgress(100, 'Complete');

  logger.info('RatingFetchJob', `Completed via ${usedMethod}: ${ratings.length} ratings, score: ${aggregates.purchase_score}`);

  return {
    wineId,
    wineName: wine.wine_name,
    vintage: wine.vintage,
    ratingsFound: ratings.length,
    previousRatings: existingCount,
    competitionIndex: aggregates.competition_index,
    criticsIndex: aggregates.critics_index,
    communityIndex: aggregates.community_index,
    purchaseScore: aggregates.purchase_score,
    purchaseStars: aggregates.purchase_stars,
    confidenceLevel: aggregates.confidence_level,
    tastingNotes: result.tasting_notes ? 'captured' : null,
    searchNotes: result.search_notes,
    method: usedMethod
  };
}

export default handleRatingFetch;
