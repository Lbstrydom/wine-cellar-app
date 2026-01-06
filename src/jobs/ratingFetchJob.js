/**
 * @fileoverview Job handler for fetching wine ratings.
 * @module jobs/ratingFetchJob
 */

import { fetchWineRatings, saveExtractedWindows } from '../services/claude.js';
import { calculateWineRatings, saveRatings } from '../services/ratings.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import db from '../db/index.js';
import logger from '../utils/logger.js';

// PostgreSQL uses CURRENT_TIMESTAMP, SQLite uses datetime('now')
const NOW_FUNC = process.env.DATABASE_URL ? 'CURRENT_TIMESTAMP' : "datetime('now')";

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
  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

  if (!wine) {
    throw new Error(`Wine not found: ${wineId}`);
  }

  logger.info('RatingFetchJob', `Starting fetch for: ${wine.wine_name} ${wine.vintage || 'NV'}`);

  // Fetch ratings with progress updates
  await updateProgress(10, 'Searching for ratings');

  const result = await fetchWineRatings(wine);

  await updateProgress(70, 'Processing results');

  // Check if we got any ratings
  const rawRatings = result.ratings || [];
  const existingCount = db.prepare(
    'SELECT COUNT(*) as count FROM wine_ratings WHERE wine_id = ? AND is_user_override = 0'
  ).get(wineId)?.count || 0;

  // Filter ratings by vintage sensitivity
  const sensitivity = getVintageSensitivity(wine);
  const ratings = filterRatingsByVintageSensitivity(wine, rawRatings);

  if (rawRatings.length > ratings.length) {
    logger.info('RatingFetchJob', `Filtered ${rawRatings.length - ratings.length} ratings due to vintage mismatch (sensitivity: ${sensitivity})`);
  }

  await updateProgress(80, 'Saving ratings');

  // Save ratings to database
  if (ratings.length > 0) {
    // Clear existing auto-ratings
    db.prepare('DELETE FROM wine_ratings WHERE wine_id = ? AND is_user_override = 0').run(wineId);

    // Insert new ratings
    for (const rating of ratings) {
      saveRatings(wineId, wine.vintage, [rating]);
    }

    // Save extracted drinking windows
    const windowsSaved = await saveExtractedWindows(wineId, ratings);
    if (windowsSaved > 0) {
      logger.info('RatingFetchJob', `Saved ${windowsSaved} drinking windows`);
    }
  }

  await updateProgress(90, 'Calculating aggregates');

  // Get all ratings for this wine and calculate aggregates
  const allRatings = db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
  const prefSetting = db.prepare("SELECT value FROM user_settings WHERE key = 'rating_preference'").get();
  const preference = parseInt(prefSetting?.value || '40');
  const aggregates = calculateWineRatings(allRatings, wine, preference);

  // Update wine with aggregates and tasting notes
  db.prepare(`
    UPDATE wines SET
      competition_index = ?,
      critics_index = ?,
      community_index = ?,
      purchase_score = ?,
      purchase_stars = ?,
      confidence_level = ?,
      tasting_notes = COALESCE(?, tasting_notes),
      ratings_updated_at = ${NOW_FUNC}
    WHERE id = ?
  `).run(
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

  logger.info('RatingFetchJob', `Completed: ${ratings.length} ratings, score: ${aggregates.purchase_score}`);

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
    searchNotes: result.search_notes
  };
}

export default handleRatingFetch;
