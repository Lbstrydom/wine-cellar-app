/**
 * @fileoverview Job handler for batch rating fetch.
 * @module jobs/batchFetchJob
 */

import { fetchWineRatings, saveExtractedWindows } from '../services/claude.js';
import { calculateWineRatings, saveRatings } from '../services/ratings.js';
import db from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Job handler for batch rating fetch.
 * @param {Object} payload - Job payload
 * @param {number[]} payload.wineIds - Wine IDs to fetch
 * @param {Object} payload.options - Fetch options
 * @param {Object} context - Job context
 * @returns {Object} Batch result
 */
async function handleBatchFetch(payload, context) {
  const { wineIds, options = {} } = payload;
  const { updateProgress } = context;

  const results = {
    total: wineIds.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    wines: []
  };

  logger.info('BatchFetchJob', `Starting batch fetch for ${wineIds.length} wines`);

  for (let i = 0; i < wineIds.length; i++) {
    const wineId = wineIds[i];
    const progress = Math.floor((i / wineIds.length) * 100);

    try {
      await updateProgress(progress, `Processing wine ${i + 1} of ${wineIds.length}`);

      const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
      if (!wine) {
        results.skipped++;
        results.wines.push({ wineId, status: 'skipped', reason: 'not_found' });
        continue;
      }

      // Check if recently fetched (skip if within 24 hours unless forced)
      if (!options.forceRefresh && wine.ratings_updated_at) {
        const lastUpdate = new Date(wine.ratings_updated_at);
        const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
        if (hoursSinceUpdate < 24) {
          results.skipped++;
          results.wines.push({
            wineId,
            wineName: wine.wine_name,
            status: 'skipped',
            reason: 'recently_updated',
            lastUpdate: wine.ratings_updated_at
          });
          continue;
        }
      }

      logger.info('BatchFetchJob', `Fetching: ${wine.wine_name} ${wine.vintage || 'NV'}`);

      const fetchResult = await fetchWineRatings(wine);
      const ratings = fetchResult.ratings || [];

      // Save ratings
      if (ratings.length > 0) {
        db.prepare('DELETE FROM wine_ratings WHERE wine_id = ? AND is_user_override = 0').run(wineId);
        for (const rating of ratings) {
          saveRatings(wineId, wine.vintage, [rating]);
        }
        await saveExtractedWindows(wineId, ratings);
      }

      // Calculate aggregates
      const aggregates = calculateWineRatings(wineId);

      // Update wine
      db.prepare(`
        UPDATE wines SET
          competition_index = ?,
          critics_index = ?,
          community_index = ?,
          purchase_score = ?,
          purchase_stars = ?,
          confidence_level = ?,
          tasting_notes = COALESCE(?, tasting_notes),
          ratings_updated_at = datetime('now')
        WHERE id = ?
      `).run(
        aggregates.competition_index,
        aggregates.critics_index,
        aggregates.community_index,
        aggregates.purchase_score,
        aggregates.purchase_stars,
        aggregates.confidence_level,
        fetchResult.tasting_notes || null,
        wineId
      );

      results.successful++;
      results.wines.push({
        wineId,
        wineName: wine.wine_name,
        status: 'success',
        ratingsFound: ratings.length,
        purchaseScore: aggregates.purchase_score
      });

      // Rate limiting: pause between wines to avoid overwhelming APIs
      if (i < wineIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (error) {
      logger.error('BatchFetchJob', `Failed for wine ${wineId}: ${error.message}`);
      results.failed++;
      results.wines.push({
        wineId,
        status: 'failed',
        error: error.message
      });
    }
  }

  await updateProgress(100, 'Batch complete');

  logger.info('BatchFetchJob', `Completed: ${results.successful} success, ${results.failed} failed, ${results.skipped} skipped`);

  return results;
}

export default handleBatchFetch;
