/**
 * @fileoverview Shared 3-Tier Waterfall search strategy for wine ratings.
 * Implements the tier resolution logic used by both sync routes and async jobs.
 *
 * Tiers:
 *   Tier 1: Quick SERP AI (~3-8s) - Extract from AI Overview, Knowledge Graph
 *   Tier 2a: Claude Web Search (~10-30s) - Anthropic web search tools
 *   Tier 2b: Gemini Hybrid (~15-45s) - Gemini grounded search + Claude extraction
 *   Tier 3: Legacy Deep Scraping - Full web scraping with page fetches
 *
 * @module services/search/threeTierWaterfall
 */

import { fetchWineRatings } from '../ai/index.js';
import { claudeWebSearch, isClaudeWebSearchAvailable } from './claudeWebSearch.js';
import { hybridWineSearch, isGeminiSearchAvailable } from './geminiSearch.js';
import { quickSerpAiExtraction, isSerpAiAvailable } from './serpAi.js';
import { validateRatingsWithIdentity } from '../ratings/ratings.js';
import { withCircuitBreaker, isCircuitOpen } from '../shared/circuitBreaker.js';
import logger from '../../utils/logger.js';

/** Tier timeout constants (ms). */
export const TIER_TIMEOUTS = {
  SERP_AI: 15000,
  CLAUDE_WEB_SEARCH: 30000,
  GEMINI: 45000
};

/**
 * Log tier resolution for cost tracking and latency analysis.
 * @param {string} tier - Tier that resolved (tier1_serp_ai, tier2_claude_web, tier2_gemini, tier3_legacy)
 * @param {Object} wine - Wine object
 * @param {number} startTime - Start timestamp (Date.now())
 * @param {number} [ratingsFound=0] - Number of ratings found
 * @param {Object} [options] - Additional options
 * @param {string} [options.endpoint] - Caller identifier (sync, job, batch)
 */
export function logTierResolution(tier, wine, startTime, ratingsFound = 0, options = {}) {
  const latencyMs = Date.now() - startTime;
  logger.info('CostTrack', JSON.stringify({
    wineId: wine.id,
    wineName: wine.wine_name,
    vintage: wine.vintage,
    tier,
    ratingsFound,
    latencyMs,
    timestamp: new Date().toISOString(),
    ...(options.endpoint ? { endpoint: options.endpoint } : {})
  }));
}

/**
 * Transform hybrid search result (Claude Web Search or Gemini) to standard rating format.
 * @param {Object} hybridResult - Result from claudeWebSearch or hybridWineSearch
 * @param {string} [method='Gemini Hybrid'] - Source method for search_notes
 * @returns {Object} Transformed result with ratings array
 */
export function transformHybridResult(hybridResult, method = 'Gemini Hybrid') {
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
    grape_varieties: hybridResult.grape_varieties || [],
    search_notes: `Found via ${method} (${hybridResult._metadata?.sources_count || 0} sources)`
  };
}

/**
 * 3-Tier Waterfall search strategy.
 * Each tier is faster/cheaper than the next, with SERP results passed to Tier 3 for reuse.
 * Returns the search result and method — does NOT perform any DB operations.
 *
 * @param {Object} wine - Wine object
 * @param {Object} identityTokens - Pre-built identity tokens from buildIdentityTokensFromWine
 * @param {Object} [options] - Options
 * @param {Function} [options.onProgress] - Progress callback (progress%, message)
 * @param {string} [options.endpoint] - Caller identifier for cost tracking
 * @returns {Promise<{result: Object, usedMethod: string, serpForReuse: Object|null}>}
 */
export async function threeTierWaterfall(wine, identityTokens, options = {}) {
  const { onProgress = () => {}, endpoint = 'unknown' } = options;
  let serpForReuse = null;
  const startTime = Date.now();
  const logTag = 'Waterfall';

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: Quick SERP AI (~3-8s)
  // ═══════════════════════════════════════════════════════════════════════════
  if (isSerpAiAvailable() && !isCircuitOpen('serp_ai')) {
    await onProgress(10, 'Tier 1: Quick SERP AI');

    try {
      logger.info(logTag, `Tier 1: Quick SERP AI for ${wine.wine_name || wine.name} (${TIER_TIMEOUTS.SERP_AI}ms timeout)`);

      const tier1Promise = withCircuitBreaker('serp_ai', () =>
        quickSerpAiExtraction(wine, identityTokens)
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tier 1 SERP AI timed out')), TIER_TIMEOUTS.SERP_AI)
      );

      const tier1 = await Promise.race([tier1Promise, timeoutPromise]);

      // Save rawSerp for Tier 3 reuse regardless of success
      if (tier1.rawSerp) {
        serpForReuse = tier1.rawSerp;
        logger.info(logTag, `Tier 1: Captured ${serpForReuse.organic?.length || 0} organic results for Tier 3 reuse`);
      }

      if (tier1.success && tier1.ratings?.length > 0) {
        const { ratings: validatedTier1 } = validateRatingsWithIdentity(wine, tier1.ratings, identityTokens);

        if (validatedTier1.length > 0) {
          logTierResolution('tier1_serp_ai', wine, startTime, tier1.ratings.length, { endpoint });
          logger.info(logTag, `Tier 1 SUCCESS: ${tier1.ratings.length} ratings in ${Date.now() - startTime}ms`);
          return {
            result: {
              ratings: validatedTier1,
              tasting_notes: tier1.tasting_notes,
              grape_varieties: tier1.grape_varieties || [],
              search_notes: tier1.search_notes
            },
            usedMethod: 'serp_ai_tier1',
            serpForReuse
          };
        }
        logger.info(logTag, 'Tier 1: Identity gate rejected all ratings, continuing');
      } else {
        logger.info(logTag, 'Tier 1: No ratings found, proceeding to Tier 2');
      }
    } catch (err) {
      logger.warn(logTag, `Tier 1 failed: ${err.message}`);
    }
  } else if (!isSerpAiAvailable()) {
    logger.info(logTag, 'Tier 1: SERP AI not available (missing API keys)');
  } else {
    logger.info(logTag, 'Tier 1: Circuit open, skipping');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2a: Claude Web Search (~10-30s)
  // ═══════════════════════════════════════════════════════════════════════════
  let tier2Resolved = false;

  if (isClaudeWebSearchAvailable() && !isCircuitOpen('claude_web_search')) {
    await onProgress(25, 'Tier 2a: Claude Web Search');

    try {
      logger.info(logTag, `Tier 2a: Claude Web Search (${TIER_TIMEOUTS.CLAUDE_WEB_SEARCH}ms timeout)`);

      const tier2Promise = withCircuitBreaker('claude_web_search', () =>
        claudeWebSearch(wine)
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Claude Web Search timed out')), TIER_TIMEOUTS.CLAUDE_WEB_SEARCH)
      );

      const tier2a = await Promise.race([tier2Promise, timeoutPromise]);

      if (tier2a?.ratings?.length > 0) {
        const { ratings: validatedTier2a } = validateRatingsWithIdentity(wine, tier2a.ratings, identityTokens);

        if (validatedTier2a.length > 0) {
          tier2Resolved = true;
          logTierResolution('tier2_claude_web', wine, startTime, tier2a.ratings.length, { endpoint });
          logger.info(logTag, `Tier 2a SUCCESS: ${tier2a.ratings.length} ratings in ${Date.now() - startTime}ms`);
          return {
            result: transformHybridResult({ ...tier2a, ratings: validatedTier2a }, 'Claude Web Search'),
            usedMethod: 'claude_web_tier2',
            serpForReuse
          };
        }
        logger.info(logTag, 'Tier 2a: Identity gate rejected all ratings, trying Gemini fallback');
      } else {
        logger.info(logTag, 'Tier 2a: No ratings found, trying Gemini fallback');
      }
    } catch (err) {
      logger.warn(logTag, `Tier 2a failed: ${err.message}`);
    }
  } else if (!isClaudeWebSearchAvailable()) {
    logger.info(logTag, 'Tier 2a: Claude Web Search not available');
  } else {
    logger.info(logTag, 'Tier 2a: Circuit open, skipping');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2b: Gemini Hybrid (~15-45s)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!tier2Resolved && isGeminiSearchAvailable() && !isCircuitOpen('gemini_hybrid')) {
    await onProgress(35, 'Tier 2b: Gemini Hybrid');

    try {
      logger.info(logTag, `Tier 2b: Gemini Hybrid fallback (${TIER_TIMEOUTS.GEMINI}ms timeout)`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIER_TIMEOUTS.GEMINI);

      try {
        const tier2b = await withCircuitBreaker('gemini_hybrid', async () => {
          const res = await hybridWineSearch(wine);
          if (controller.signal.aborted) {
            throw new Error('Gemini search aborted due to timeout');
          }
          return res;
        });

        clearTimeout(timeoutId);

        if (tier2b?.ratings?.length > 0) {
          const { ratings: validatedTier2b } = validateRatingsWithIdentity(wine, tier2b.ratings, identityTokens);

          if (validatedTier2b.length > 0) {
            logTierResolution('tier2_gemini', wine, startTime, tier2b.ratings.length, { endpoint });
            logger.info(logTag, `Tier 2b SUCCESS: ${tier2b.ratings.length} ratings in ${Date.now() - startTime}ms`);
            return {
              result: transformHybridResult({ ...tier2b, ratings: validatedTier2b }, 'Gemini Hybrid'),
              usedMethod: 'gemini_tier2',
              serpForReuse
            };
          }
          logger.info(logTag, 'Tier 2b: Identity gate rejected all ratings, proceeding to Tier 3');
        } else {
          logger.info(logTag, 'Tier 2b: No ratings found, proceeding to Tier 3');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      logger.warn(logTag, `Tier 2b failed: ${err.message}`);
    }
  } else if (!tier2Resolved && !isGeminiSearchAvailable()) {
    logger.info(logTag, 'Tier 2b: Gemini not available (missing API key), proceeding to Tier 3');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: Legacy Deep Scraping
  // Reuses SERP results from Tier 1 to avoid duplicate API calls
  // ═══════════════════════════════════════════════════════════════════════════
  await onProgress(50, 'Tier 3: Legacy Scraping');
  logger.info(logTag, 'Tier 3: Using Legacy Deep Scraping');

  const tier3 = await fetchWineRatings(wine, { existingSerpResults: serpForReuse });
  const { ratings: validatedTier3 } = validateRatingsWithIdentity(wine, tier3.ratings || [], identityTokens);

  logTierResolution('tier3_legacy', wine, startTime, tier3.ratings?.length || 0, { endpoint });
  logger.info(logTag, `Tier 3 COMPLETE: ${tier3.ratings?.length || 0} ratings in ${Date.now() - startTime}ms`);

  return {
    result: { ...tier3, ratings: validatedTier3 },
    usedMethod: 'legacy_tier3',
    serpForReuse
  };
}
