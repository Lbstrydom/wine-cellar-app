/**
 * @fileoverview Job handler for unified wine rating fetch.
 * Single-call Claude Web Search strategy replacing the 3-tier waterfall.
 *
 * Key differences from ratingFetchJob.js:
 * - Uses unifiedWineSearch() instead of threeTierWaterfall()
 * - Applies no-delete-on-empty invariant (preserves existing ratings on empty result)
 * - Accepts cellarId in payload for tenant-scoped wine lookup
 * - Stores prose narrative (_narrative) in wines.tasting_notes
 *
 * @module jobs/unifiedRatingFetchJob
 */

import { unifiedWineSearch } from '../services/search/claudeWineSearch.js';
import { saveExtractedWindows } from '../services/ai/index.js';
import { persistSearchResults } from '../services/shared/wineUpdateService.js';
import {
  calculateWineRatings,
  saveRatings,
  countSaveableRatings,
  buildIdentityTokensFromWine,
  validateRatingsWithIdentity
} from '../services/ratings/ratings.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import { getWineAwards } from '../services/awards/index.js';
import db from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Job handler for fetching wine ratings via unified Claude Web Search.
 * @param {Object} payload - Job payload
 * @param {number} payload.wineId - Wine ID to fetch ratings for
 * @param {boolean} [payload.forceRefresh=false] - Whether to bypass cache
 * @param {string} [payload.cellarId] - Cellar ID for tenant-scoped wine lookup
 * @param {Object} context - Job context
 * @param {Function} context.updateProgress - Progress update callback
 * @returns {Promise<Object>} Job result
 */
async function handleRatingFetch(payload, context) {
  const { wineId, forceRefresh: _forceRefresh = false, cellarId: payloadCellarId } = payload;
  const { updateProgress } = context;

  await updateProgress(5, 'Loading wine details');

  // cellarId is required — routes/ratings.js always sets req.cellarId in the payload
  if (!payloadCellarId) {
    throw new Error(`Missing cellarId in job payload for wine ${wineId}. All rating fetch jobs must include cellarId.`);
  }
  const wine = await db.prepare('SELECT * FROM wines WHERE id = ? AND cellar_id = ?').get(wineId, payloadCellarId);

  if (!wine) {
    throw new Error(`Wine not found: ${wineId}`);
  }

  logger.info('UnifiedRatingFetchJob', `Starting fetch for: ${wine.wine_name} ${wine.vintage || 'NV'}`);

  // Run unified Claude Web Search (single API call)
  const result = await unifiedWineSearch(wine);
  const usedMethod = result?._metadata?.method || 'unified_claude_search';

  if (!result) {
    throw new Error(`Unified wine search returned no result for wine ${wineId}`);
  }

  await updateProgress(70, 'Processing results');

  // Identity validation + vintage sensitivity filter
  const identityTokens = buildIdentityTokensFromWine(wine);
  const rawRatings = result.ratings || [];

  const existingCountRow = await db.prepare(
    'SELECT COUNT(*) as count FROM wine_ratings WHERE wine_id = ? AND is_user_override = FALSE'
  ).get(wineId);
  const existingCount = existingCountRow?.count || 0;

  const sensitivity = getVintageSensitivity(wine);
  const searchContext = `${wine.producer_name || ''} ${wine.wine_name} ${wine.vintage || ''}`.trim();
  const { ratings: identityValidRatings, rejected: identityRejected } = validateRatingsWithIdentity(wine, rawRatings, identityTokens, { searchContext });
  const newRatings = filterRatingsByVintageSensitivity(wine, identityValidRatings);

  if (rawRatings.length > newRatings.length) {
    logger.info('UnifiedRatingFetchJob', `Filtered ${rawRatings.length - newRatings.length} ratings (sensitivity: ${sensitivity})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NO-DELETE-ON-EMPTY INVARIANT
  // Preserve existing ratings when search returns 0 valid results.
  // This prevents data loss when extraction or identity validation fails.
  // ═══════════════════════════════════════════════════════════════════════════
  if (newRatings.length === 0) {
    const identityRejectedCount = identityRejected?.length ?? (rawRatings.length - identityValidRatings.length);
    logger.info('UnifiedRatingFetchJob',
      `No new ratings found via ${usedMethod}, keeping ${existingCount} existing (${identityRejectedCount} rejected by identity gate)`
    );

    return {
      wineId,
      wineName: wine.wine_name,
      vintage: wine.vintage,
      ratingsFound: 0,
      previousRatings: existingCount,
      confidenceLevel: null,
      tastingNotes: null,
      grapesDiscovered: null,
      grapesEnriched: false,
      method: usedMethod,
      searchNotes: identityRejectedCount > 0
        ? `Found ${rawRatings.length} ratings but all rejected by identity validation`
        : 'No new ratings found, existing ratings preserved'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRAPE BACKFILL: Save discovered varieties only if wine has none
  // ═══════════════════════════════════════════════════════════════════════════
  const discoveredGrapes = result.grape_varieties || [];
  let grapesEnriched = false;
  if (discoveredGrapes.length > 0 && (!wine.grapes || wine.grapes.trim() === '')) {
    const grapeString = discoveredGrapes.join(', ');
    const grapeResult = await db.prepare(
      "UPDATE wines SET grapes = ? WHERE id = ? AND cellar_id = ? AND (grapes IS NULL OR grapes = '')"
    ).run(grapeString, wineId, wine.cellar_id);
    if (grapeResult.changes > 0) {
      grapesEnriched = true;
      logger.info('UnifiedRatingFetchJob', `Enriched grapes from search: ${grapeString}`);
    }
  }

  // Deduplicate by source key before inserting
  const seenSources = new Set();
  const uniqueRatings = [];
  for (const rating of newRatings) {
    const sourceKey = (rating.source || 'unknown').toLowerCase();
    const yearKey = rating.competition_year || rating.vintage_match || 'any';
    const key = `${sourceKey}-${yearKey}`;
    if (!seenSources.has(key)) {
      seenSources.add(key);
      uniqueRatings.push(rating);
    } else {
      logger.info('UnifiedRatingFetchJob', `Skipping duplicate ${rating.source} rating`);
    }
  }

  await updateProgress(80, 'Saving ratings');

  // Pre-validate: count how many ratings have known source IDs and valid scores.
  // Only delete existing ratings if we can guarantee at least one new rating will be saved.
  // This prevents data loss when Claude returns display names (e.g. "Tim Atkin SA")
  // instead of registry IDs (e.g. "tim_atkin"), causing saveRatings to silently skip all rows.
  const saveableCount = countSaveableRatings(uniqueRatings);
  if (saveableCount === 0) {
    logger.warn('UnifiedRatingFetchJob',
      `All ${uniqueRatings.length} ratings have unknown source IDs — keeping ${existingCount} existing ratings`
    );
    return {
      wineId,
      wineName: wine.wine_name,
      vintage: wine.vintage,
      ratingsFound: 0,
      previousRatings: existingCount,
      confidenceLevel: null,
      tastingNotes: null,
      grapesDiscovered: null,
      grapesEnriched: false,
      method: usedMethod,
      searchNotes: `All ${uniqueRatings.length} ratings had unknown source IDs, existing ratings preserved`
    };
  }

  // Clear existing auto-fetched ratings (keep user overrides) — safe: saveableCount > 0
  await db.prepare('DELETE FROM wine_ratings WHERE wine_id = ? AND is_user_override = FALSE').run(wineId);

  // Insert new ratings
  let insertedCount = 0;
  for (const rating of uniqueRatings) {
    const saved = await saveRatings(wineId, wine.vintage, [rating], wine.cellar_id);
    insertedCount += saved;
  }

  // Save drinking windows — adapt top-level drinking_window to per-rating format
  const drinkingWindowRatings = result.drinking_window
    ? [{
        source: 'unified_search',
        drinking_window: {
          drink_from_year: result.drinking_window.drink_from,
          drink_by_year: result.drinking_window.drink_by,
          peak_year: result.drinking_window.peak
        }
      }]
    : [];
  if (drinkingWindowRatings.length > 0) {
    const windowsSaved = await saveExtractedWindows(wineId, drinkingWindowRatings);
    if (windowsSaved > 0) {
      logger.info('UnifiedRatingFetchJob', `Saved ${windowsSaved} drinking windows`);
    }
  }

  logger.info('UnifiedRatingFetchJob', `Inserted ${insertedCount} ratings via ${usedMethod}`);

  await updateProgress(90, 'Calculating aggregates');

  // Calculate aggregates over all ratings for this wine, including local awards
  const allRatings = await db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
  const prefSetting = await db.prepare(
    "SELECT value FROM user_settings WHERE cellar_id = ? AND key = 'rating_preference'"
  ).get(wine.cellar_id);
  const preference = Number.parseInt(prefSetting?.value || '40', 10);

  let localAwards = [];
  try {
    localAwards = await getWineAwards(wineId);
  } catch {
    // awardsDb may not exist in all environments — degrade gracefully
  }

  const aggregates = calculateWineRatings(allRatings, wine, preference, localAwards);

  // Store prose narrative + structured extraction (COALESCE preserves existing if null)
  const narrativeText = result._narrative || null;
  const tastingNotesStructured = result.tasting_notes || null;
  const foodPairings = result.food_pairings || [];

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSIST: Update wines + food pairings via shared helper
  // Persists aggregates, tasting notes, style_summary, producer_description,
  // extracted_awards, and food pairings in a single consistent operation.
  // ═══════════════════════════════════════════════════════════════════════════
  await persistSearchResults(wineId, wine.cellar_id, wine, aggregates, {
    narrative: narrativeText,
    tastingNotesStructured,
    styleSummary: result.style_summary || null,
    producerInfo: result.producer_info || null,
    awards: result.awards || [],
    foodPairings
  });

  await updateProgress(100, 'Complete');

  logger.info('UnifiedRatingFetchJob',
    `Completed via ${usedMethod}: ${insertedCount} ratings, score: ${aggregates.purchase_score}`
  );

  return {
    wineId,
    wineName: wine.wine_name,
    vintage: wine.vintage,
    ratingsFound: insertedCount,
    previousRatings: existingCount,
    competitionIndex: aggregates.competition_index,
    criticsIndex: aggregates.critics_index,
    communityIndex: aggregates.community_index,
    purchaseScore: aggregates.purchase_score,
    purchaseStars: aggregates.purchase_stars,
    confidenceLevel: aggregates.confidence_level,
    tastingNotes: narrativeText ? 'captured' : null,
    tastingNotesStructured: tastingNotesStructured ? 'captured' : null,
    foodPairingsCount: foodPairings.length,
    grapesDiscovered: discoveredGrapes.length > 0 ? discoveredGrapes : null,
    grapesEnriched,
    method: usedMethod
  };
}

export default handleRatingFetch;
