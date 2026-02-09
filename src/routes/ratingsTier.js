/**
 * @fileoverview 3-Tier Waterfall fetch for wine ratings.
 * Implements the sync fetch strategy:
 *   Tier 1: Quick SERP AI (~3-8s) - Extract from AI Overview, Knowledge Graph
 *   Tier 2: Gemini Hybrid (~15-45s) - Gemini grounded search + Claude extraction
 *   Tier 3: Legacy Deep Scraping - Full web scraping with page fetches
 * @module routes/ratingsTier
 */

import { Router } from 'express';
import db from '../db/index.js';
import { SOURCES as RATING_SOURCES, SOURCES as SOURCE_REGISTRY } from '../config/unifiedSources.js';
import { normalizeScore, calculateWineRatings, buildIdentityTokensFromWine, validateRatingsWithIdentity } from '../services/ratings/ratings.js';
import { fetchWineRatings } from '../services/ai/index.js';
import { hybridWineSearch, isGeminiSearchAvailable } from '../services/search/geminiSearch.js';
import { quickSerpAiExtraction, isSerpAiAvailable } from '../services/search/serpAi.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import { withCircuitBreaker, isCircuitOpen } from '../services/shared/circuitBreaker.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateParams } from '../middleware/validate.js';
import { ratingWineIdSchema } from '../schemas/rating.js';

// Timeout constants for tier waterfall
const GEMINI_TIMEOUT_MS = 45000; // 45 seconds for Gemini + Claude
const SERP_AI_TIMEOUT_MS = 15000; // 15 seconds for SERP AI extraction

/**
 * Log tier resolution for cost tracking and latency analysis.
 * @param {string} tier - Tier that resolved the request
 * @param {Object} wine - Wine object
 * @param {number} startTime - Start timestamp
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
    timestamp: new Date().toISOString(),
    endpoint: 'sync'
  }));
}

const router = Router();

/**
 * Fetch ratings from web using 3-tier waterfall strategy.
 * Uses transactional replacement - only deletes if we have valid replacements.
 *
 * 3-Tier Waterfall:
 *   Tier 1: Quick SERP AI (~3-8s) - Extract from AI Overview, Knowledge Graph
 *   Tier 2: Gemini Hybrid (~15-45s) - Gemini grounded search + Claude extraction
 *   Tier 3: Legacy Deep Scraping - Full web scraping with page fetches
 *
 * @route POST /api/wines/:wineId/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', validateParams(ratingWineIdSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);

  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  let result;
  let usedMethod = 'legacy_tier3';
  let serpForReuse = null;
  const startTime = Date.now();
  const identityTokens = buildIdentityTokensFromWine(wine);

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: Quick SERP AI (~3-8s)
  // Extract ratings from AI Overview, Knowledge Graph, Featured Snippets
  // ═══════════════════════════════════════════════════════════════════════════
  if (isSerpAiAvailable() && !isCircuitOpen('serp_ai')) {
    try {
      logger.info('Ratings', `Tier 1: Quick SERP AI for wine ${wineId} (${SERP_AI_TIMEOUT_MS}ms timeout)`);

      const tier1Promise = withCircuitBreaker('serp_ai', () =>
        quickSerpAiExtraction(wine, identityTokens)
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tier 1 SERP AI timed out')), SERP_AI_TIMEOUT_MS)
      );

      const tier1 = await Promise.race([tier1Promise, timeoutPromise]);

      // Save rawSerp for Tier 3 reuse
      if (tier1.rawSerp) {
        serpForReuse = tier1.rawSerp;
        logger.info('Ratings', `Tier 1: Captured ${serpForReuse.organic?.length || 0} organic results for Tier 3 reuse`);
      }

      if (tier1.success && tier1.ratings?.length > 0) {
        const { ratings: validatedTier1 } = validateRatingsWithIdentity(wine, tier1.ratings, identityTokens);

        if (validatedTier1.length > 0) {
          result = {
            ratings: validatedTier1,
            tasting_notes: tier1.tasting_notes,
            search_notes: tier1.search_notes
          };
          usedMethod = 'serp_ai_tier1';
          logTierResolution('tier1_serp_ai', wine, startTime, tier1.ratings.length);
          logger.info('Ratings', `Tier 1 SUCCESS: ${tier1.ratings.length} ratings in ${Date.now() - startTime}ms`);
        } else {
          logger.info('Ratings', 'Tier 1: Identity gate rejected all ratings, proceeding to Tier 2');
        }
      } else {
        logger.info('Ratings', 'Tier 1: No ratings found, proceeding to Tier 2');
      }
    } catch (err) {
      logger.warn('Ratings', `Tier 1 failed: ${err.message}`);
    }
  } else if (!isSerpAiAvailable()) {
    logger.info('Ratings', 'Tier 1: SERP AI not available (missing API keys)');
  } else {
    logger.info('Ratings', 'Tier 1: Circuit open, skipping');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: Gemini Hybrid (~15-45s)
  // Uses Gemini grounded search + Claude extraction for comprehensive coverage
  // ═══════════════════════════════════════════════════════════════════════════
  if (!result && isGeminiSearchAvailable() && !isCircuitOpen('gemini_hybrid')) {
    try {
      logger.info('Ratings', `Tier 2: Gemini Hybrid for wine ${wineId} (${GEMINI_TIMEOUT_MS}ms timeout)`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        const hybridResult = await withCircuitBreaker('gemini_hybrid', async () => {
          const res = await hybridWineSearch(wine);
          if (controller.signal.aborted) {
            throw new Error('Gemini search aborted due to timeout');
          }
          return res;
        });

        clearTimeout(timeoutId);

        if (hybridResult?.ratings?.length > 0) {
          const normalizedRatings = hybridResult.ratings.map(r => ({
            source: r.source ? r.source.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'unknown',
            source_lens: r.source_lens || 'critics',
            score_type: r.score_type || 'points',
            raw_score: r.raw_score,
            raw_score_numeric: r.raw_score_numeric,
            vintage_match: r.vintage_match || 'inferred',
            match_confidence: r.confidence || 'medium',
            source_url: r.source_url,
            tasting_notes: r.tasting_notes
          }));

          const { ratings: validatedTier2 } = validateRatingsWithIdentity(wine, normalizedRatings, identityTokens);

          if (validatedTier2.length > 0) {
            result = {
              ratings: validatedTier2,
              tasting_notes: hybridResult.tasting_notes ? JSON.stringify(hybridResult.tasting_notes) : null,
              search_notes: `Found via Gemini Hybrid (${hybridResult._metadata?.sources_count || 0} sources)`
            };
            usedMethod = 'gemini_tier2';
            logTierResolution('tier2_gemini', wine, startTime, hybridResult.ratings.length);
            logger.info('Ratings', `Tier 2 SUCCESS: ${hybridResult.ratings.length} ratings in ${Date.now() - startTime}ms`);
          } else {
            logger.info('Ratings', 'Tier 2: Identity gate rejected all ratings, proceeding to Tier 3');
          }
        } else {
          logger.info('Ratings', 'Tier 2: No ratings found, proceeding to Tier 3');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      logger.warn('Ratings', `Tier 2 failed: ${err.message}`);
    }
  } else if (!result && !isGeminiSearchAvailable()) {
    logger.info('Ratings', 'Tier 2: Gemini not available (missing API key)');
  } else if (!result) {
    logger.info('Ratings', 'Tier 2: Circuit open, skipping');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: Legacy Deep Scraping
  // Full web scraping with Claude extraction - slower but comprehensive
  // Reuses SERP results from Tier 1 to avoid duplicate API calls
  // ═══════════════════════════════════════════════════════════════════════════
  if (!result) {
    logger.info('Ratings', `Tier 3: Legacy Scraping for wine ${wineId}`);
    const tier3 = await fetchWineRatings(wine, { existingSerpResults: serpForReuse });
    const { ratings: validatedTier3 } = validateRatingsWithIdentity(wine, tier3.ratings || [], identityTokens);

    result = { ...tier3, ratings: validatedTier3 };
    usedMethod = 'legacy_tier3';
    logTierResolution('tier3_legacy', wine, startTime, result.ratings?.length || 0);
    logger.info('Ratings', `Tier 3 COMPLETE: ${result.ratings?.length || 0} ratings in ${Date.now() - startTime}ms`);
  }

  // Get existing ratings count for comparison
  const existingRatings = await db.prepare(
    'SELECT * FROM wine_ratings WHERE wine_id = $1 AND (is_user_override IS NOT TRUE)'
  ).all(wineId);

  const rawRatings = result.ratings || [];

  // Identity validation (defensive) and vintage sensitivity filter
  const { ratings: identityValidRatings } = validateRatingsWithIdentity(wine, rawRatings, identityTokens);

  const sensitivity = getVintageSensitivity(wine);
  const newRatings = filterRatingsByVintageSensitivity(wine, identityValidRatings);

  if (rawRatings.length > newRatings.length) {
    logger.info('Ratings', `Filtered ${rawRatings.length - newRatings.length} ratings due to vintage mismatch (sensitivity: ${sensitivity})`);
  }

  // ONLY delete if we have valid replacements
  // This prevents losing data when search/extraction fails
  if (newRatings.length === 0) {
    logger.info('Ratings', `No new ratings found via ${usedMethod}, keeping ${existingRatings.length} existing`);
    return res.json({
      message: 'No new ratings found, existing ratings preserved',
      search_notes: result.search_notes,
      ratings_kept: existingRatings.length,
      method: usedMethod
    });
  }

  // Deduplicate by source before inserting
  const seenSources = new Set();
  const uniqueRatings = [];

  for (const rating of newRatings) {
    // Create a unique key for deduplication
    const sourceKey = rating.source ? rating.source.toLowerCase() : 'unknown';
    const yearKey = rating.competition_year || rating.vintage_match || 'any';
    const key = `${sourceKey}-${yearKey}`;

    if (!seenSources.has(key)) {
      seenSources.add(key);
      uniqueRatings.push(rating);
    } else {
      logger.info('Ratings', `Skipping duplicate ${rating.source} rating`);
    }
  }

  // Delete existing auto-fetched ratings (keep user overrides)
  await db.prepare(`
    DELETE FROM wine_ratings
    WHERE wine_id = $1 AND (is_user_override IS NOT TRUE)
  `).run(wineId);

  logger.info('Ratings', `Cleared ${existingRatings.length} existing auto-ratings for wine ${wineId}`);

  // Insert new ratings
  let insertedCount = 0;
  for (const rating of uniqueRatings) {
    // Normalize source ID
    const sourceId = rating.source ? rating.source.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'unknown';
    const sourceConfig = RATING_SOURCES[sourceId] || SOURCE_REGISTRY[sourceId] || { lens: rating.source_lens || 'critics' };

    // Skip ratings without valid scores (e.g., paywalled content)
    if (!rating.raw_score || rating.raw_score === 'null' || rating.raw_score === '') {
      logger.warn('Ratings', `No score found for ${rating.source}, skipping (likely paywalled)`);
      continue;
    }

    try {
      const normalized = normalizeScore(sourceId, rating.score_type, rating.raw_score);

      // Validate normalized values are actual numbers
      if (isNaN(normalized.min) || isNaN(normalized.max) || isNaN(normalized.mid)) {
        logger.warn('Ratings', `Invalid normalized score for ${rating.source}: ${rating.raw_score}, skipping`);
        continue;
      }

      const numericScore = parseFloat(String(rating.raw_score).replace(/\/\d+$/, '')) || null;

      await db.prepare(`
        INSERT INTO wine_ratings (
          wine_id, vintage, source, source_lens, score_type, raw_score, raw_score_numeric,
          normalized_min, normalized_max, normalized_mid,
          award_name, competition_year, rating_count,
          source_url, evidence_excerpt, matched_wine_label,
          identity_score, identity_reason,
          vintage_match, match_confidence, fetched_at, is_user_override
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, FALSE)
      `).run(
        wineId,
        wine.vintage,
        sourceId,
        rating.lens || rating.source_lens || sourceConfig.lens,
        rating.score_type || 'points',
        rating.raw_score,
        numericScore,
        normalized.min,
        normalized.max,
        normalized.mid,
        rating.award_name || null,
        rating.competition_year || null,
        rating.rating_count || null,
        rating.source_url || null,
        rating.evidence_excerpt || null,
        rating.matched_wine_label || null,
        rating.identity_score ?? null,
        rating.identity_reason || null,
        rating.vintage_match || 'inferred',
        rating.match_confidence || 'medium'
      );
      insertedCount++;
    } catch (err) {
      logger.error('Ratings', `Failed to insert rating from ${rating.source}: ${err.message}`);
    }
  }

  logger.info('Ratings', `Inserted ${insertedCount} ratings via ${usedMethod}`);

  // Update aggregates
  const ratings = await db.prepare('SELECT * FROM wine_ratings WHERE wine_id = $1').all(wineId);
  const prefSetting = await db.prepare("SELECT value FROM user_settings WHERE cellar_id = $1 AND key = $2").get(req.cellarId, 'rating_preference');
  const preference = parseInt(prefSetting?.value || '40');
  const aggregates = calculateWineRatings(ratings, wine, preference);

  const tastingNotes = result.tasting_notes || null;

  await db.prepare(`
    UPDATE wines SET
      competition_index = $1, critics_index = $2, community_index = $3,
      purchase_score = $4, purchase_stars = $5, confidence_level = $6,
      tasting_notes = COALESCE($7, tasting_notes),
      ratings_updated_at = CURRENT_TIMESTAMP
    WHERE cellar_id = $8 AND id = $9
  `).run(
    aggregates.competition_index,
    aggregates.critics_index,
    aggregates.community_index,
    aggregates.purchase_score,
    aggregates.purchase_stars,
    aggregates.confidence_level,
    tastingNotes,
    req.cellarId,
    wineId
  );

  res.json({
    message: `Found ${insertedCount} ratings (replaced ${existingRatings.length} existing) via ${usedMethod}`,
    search_notes: result.search_notes,
    tasting_notes: tastingNotes,
    method: usedMethod,
    ...aggregates
  });
}));

export default router;
