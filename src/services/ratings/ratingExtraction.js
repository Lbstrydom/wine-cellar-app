/**
 * @fileoverview Wine rating extraction — drinking window persistence.
 * @module services/ratings/ratingExtraction
 */

import db from '../../db/index.js';
import logger from '../../utils/logger.js';

/**
 * Save extracted drinking windows to the database.
 * @param {number} wineId - Wine ID
 * @param {Object[]} ratings - Array of ratings with potential drinking_window data
 * @returns {Promise<number>} Number of windows saved
 */
export async function saveExtractedWindows(wineId, ratings) {
  if (!ratings || !Array.isArray(ratings)) return 0;

  let saved = 0;

  for (const rating of ratings) {
    if (rating.drinking_window && (rating.drinking_window.drink_from_year || rating.drinking_window.drink_by_year || rating.drinking_window.peak_year)) {
      try {
        await db.prepare(`
          INSERT INTO drinking_windows (wine_id, source, drink_from_year, drink_by_year, peak_year, confidence, raw_text, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(wine_id, source) DO UPDATE SET
            drink_from_year = excluded.drink_from_year,
            drink_by_year = excluded.drink_by_year,
            peak_year = excluded.peak_year,
            raw_text = excluded.raw_text,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          wineId,
          rating.source,
          rating.drinking_window.drink_from_year || null,
          rating.drinking_window.drink_by_year || null,
          rating.drinking_window.peak_year || null,
          rating.match_confidence || 'medium',
          rating.drinking_window.raw_text || null
        );
        saved++;
        logger.info('DrinkingWindows', `Saved window for wine ${wineId} from ${rating.source}`);
      } catch (err) {
        logger.error('DrinkingWindows', `Failed to save window from ${rating.source}: ${err.message}`);
      }
    }
  }

  return saved;
}
