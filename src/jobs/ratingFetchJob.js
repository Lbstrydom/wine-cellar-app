/**
 * @fileoverview Job handler for fetching wine ratings.
 * Uses the shared 3-Tier Waterfall Strategy via threeTierWaterfall module.
 * @module jobs/ratingFetchJob
 */

import { saveExtractedWindows } from '../services/ai/index.js';
import { calculateWineRatings, saveRatings, buildIdentityTokensFromWine, validateRatingsWithIdentity } from '../services/ratings/ratings.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import { threeTierWaterfall } from '../services/search/threeTierWaterfall.js';
import db from '../db/index.js';
import { nowFunc } from '../db/helpers.js';
import logger from '../utils/logger.js';

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

  const { result, usedMethod } = await threeTierWaterfall(wine, identityTokens, {
    onProgress: updateProgress,
    endpoint: 'job'
  });

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

  // Enrich wine with discovered grape varieties (only if wine is missing them)
  const discoveredGrapes = result.grape_varieties || [];
  let grapesEnriched = false;
  if (discoveredGrapes.length > 0 && !wine.grapes) {
    const grapeString = discoveredGrapes.join(', ');
    const grapeResult = await db.prepare(
      "UPDATE wines SET grapes = ? WHERE id = ? AND (grapes IS NULL OR grapes = '')"
    ).run(grapeString, wineId);
    if (grapeResult.changes > 0) {
      grapesEnriched = true;
      logger.info('RatingFetchJob', `Enriched grapes from search: ${grapeString}`);
    }
  }

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
    grapesDiscovered: discoveredGrapes.length > 0 ? discoveredGrapes : null,
    grapesEnriched,
    searchNotes: result.search_notes,
    method: usedMethod
  };
}

export default handleRatingFetch;
