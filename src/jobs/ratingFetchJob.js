/**
 * @fileoverview Job handler for fetching wine ratings.
 * UPDATED: Now uses Gemini Hybrid Search if available (faster, more sources).
 * @module jobs/ratingFetchJob
 */

import { fetchWineRatings, saveExtractedWindows } from '../services/claude.js';
import { hybridWineSearch, isGeminiSearchAvailable } from '../services/geminiSearch.js';
import { calculateWineRatings, saveRatings } from '../services/ratings.js';
import { filterRatingsByVintageSensitivity, getVintageSensitivity } from '../config/vintageSensitivity.js';
import db from '../db/index.js';
import { nowFunc } from '../db/helpers.js';
import logger from '../utils/logger.js';

// Timeout for Gemini hybrid search (Gemini API + Claude extraction = 2 API calls)
// Increased from 8s to 20s to allow both calls to complete
const GEMINI_TIMEOUT_MS = 20000; // 20 seconds

/**
 * Try Gemini hybrid search first, fall back to legacy if unavailable or fails.
 * Uses strict timeout to prevent latency compounding (Gemini hang + Legacy = 55s+).
 * @param {Object} wine - Wine object
 * @param {Function} updateProgress - Progress callback
 * @returns {Promise<{result: Object, usedMethod: string}>}
 */
async function tryGeminiThenLegacy(wine, updateProgress) {
  // 1. Try Gemini Hybrid Search First (Fast, more sources) with STRICT TIMEOUT
  if (isGeminiSearchAvailable()) {
    try {
      await updateProgress(15, 'Trying Gemini Hybrid Search');
      logger.info('RatingFetchJob', `Attempting Gemini Hybrid Search (${GEMINI_TIMEOUT_MS}ms timeout)`);

      // Race Gemini against a strict timeout to fail fast
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini search timed out')), GEMINI_TIMEOUT_MS)
      );

      const hybridResult = await Promise.race([
        hybridWineSearch(wine),
        timeoutPromise
      ]);

      if (hybridResult?.ratings?.length > 0) {
        // Transform hybrid result to match legacy format
        const result = {
          ratings: hybridResult.ratings.map(r => ({
            source: r.source ? r.source.toLowerCase().replaceAll(/[^a-z0-9]/g, '_') : 'unknown',
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
        logger.info('RatingFetchJob', `Gemini found ${result.ratings.length} ratings`);
        return { result, usedMethod: 'gemini_hybrid' };
      }
      logger.info('RatingFetchJob', 'Gemini search returned no ratings, falling back to legacy');
    } catch (err) {
      // If timed out or failed, log and move instantly to legacy
      logger.warn('RatingFetchJob', `Gemini search skipped: ${err.message}, falling back to legacy`);
    }
  }

  // 2. Fallback to Legacy Search (Slow but established)
  await updateProgress(25, 'Using Legacy Search');
  logger.info('RatingFetchJob', 'Using Legacy Search');
  const result = await fetchWineRatings(wine);
  return { result, usedMethod: 'legacy' };
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

  // Fetch ratings with progress updates
  await updateProgress(10, 'Searching for ratings');

  // Try search methods - Gemini first, then legacy fallback
  const searchResult = await tryGeminiThenLegacy(wine, updateProgress);
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
  const ratings = filterRatingsByVintageSensitivity(wine, rawRatings);

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
