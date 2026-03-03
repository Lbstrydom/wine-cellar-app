/**
 * @fileoverview Shared food pairings persistence helper.
 * Upserts AI-suggested pairings into wine_food_pairings.
 * ON CONFLICT (wine_id, cellar_id, pairing) DO NOTHING preserves user ratings
 * set on previous rows — idempotent across search re-runs.
 * @module services/shared/foodPairingsService
 */

import db from '../../db/index.js';
import logger from '../../utils/logger.js';

/**
 * Upsert food pairings discovered by web search / Phase 2 extraction.
 * Safe to call multiple times — never overwrites user_rating or rated_at.
 *
 * @param {number} wineId - Wine ID
 * @param {string} cellarId - Cellar UUID (tenant scope)
 * @param {string[]} pairings - Array of pairing strings from result.food_pairings
 * @param {string} [source='search'] - Provenance tag ('search' | 'manual')
 * @returns {Promise<number>} Number of new rows inserted
 */
export async function saveFoodPairings(wineId, cellarId, pairings, source = 'search') {
  if (!Array.isArray(pairings) || pairings.length === 0) return 0;

  let inserted = 0;

  for (const pairing of pairings) {
    if (typeof pairing !== 'string' || !pairing.trim()) continue;
    try {
      const result = await db.prepare(`
        INSERT INTO wine_food_pairings (wine_id, cellar_id, pairing, source)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (wine_id, cellar_id, pairing) DO NOTHING
      `).run(wineId, cellarId, pairing.trim(), source);

      if (result.changes > 0) inserted++;
    } catch (err) {
      logger.error('FoodPairings', `Failed to save pairing "${pairing}" for wine ${wineId}: ${err.message}`);
    }
  }

  if (inserted > 0) {
    logger.info('FoodPairings', `Saved ${inserted} new food pairings for wine ${wineId}`);
  }

  return inserted;
}
