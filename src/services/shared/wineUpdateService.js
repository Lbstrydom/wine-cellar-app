/**
 * @fileoverview Shared persistence helper for wine search extraction results.
 * Extracted from ratingsTier.js and unifiedRatingFetchJob.js to eliminate
 * near-identical UPDATE blocks (DRY principle).
 *
 * COALESCE guards ensure we never overwrite existing user-provided data.
 * The new fields (style_summary, producer_description, extracted_awards) are
 * persisted alongside the existing tasting notes and aggregates.
 *
 * @module services/shared/wineUpdateService
 */

import db from '../../db/index.js';
import { saveFoodPairings } from './foodPairingsService.js';
import logger from '../../utils/logger.js';

/**
 * Persist search extraction results to the wines table and ancillary tables.
 *
 * Field update strategy:
 * - Aggregates (competition_index, etc.): always overwritten with latest calculated values
 * - tasting_notes / tasting_notes_structured: COALESCE($new, existing) — preserves existing if new is null
 * - style_summary / producer_description / extracted_awards: same COALESCE guard
 * - food_pairings: upsert via saveFoodPairings (preserves user ratings)
 *
 * @param {number} wineId
 * @param {string} cellarId
 * @param {Object} wine - Existing wine DB record (used for context/logging)
 * @param {Object} aggregates - Calculated rating aggregates
 * @param {number} aggregates.competition_index
 * @param {number} aggregates.critics_index
 * @param {number} aggregates.community_index
 * @param {number} aggregates.purchase_score
 * @param {number} aggregates.purchase_stars
 * @param {string} aggregates.confidence_level
 * @param {Object} extractionData - Fields from the search extraction pipeline
 * @param {string|null} [extractionData.narrative] - Prose tasting notes (_narrative)
 * @param {Object|null} [extractionData.tastingNotesStructured] - Structured tasting notes object
 * @param {string|null} [extractionData.styleSummary] - Wine style descriptor from search
 * @param {Object|null} [extractionData.producerInfo] - Producer info object (uses .description)
 * @param {Array} [extractionData.awards] - Extracted award records [{competition, year, award, wine_name}]
 * @param {Array} [extractionData.foodPairings] - Food pairing suggestions
 * @returns {Promise<void>}
 */
export async function persistSearchResults(wineId, cellarId, wine, aggregates, extractionData) {
  const {
    narrative = null,
    tastingNotesStructured = null,
    styleSummary = null,
    producerInfo = null,
    awards = [],
    foodPairings = []
  } = extractionData || {};

  const tastingNotesJson = tastingNotesStructured ? JSON.stringify(tastingNotesStructured) : null;
  const producerDescription = producerInfo?.description || null;
  // Backfill: only fills if wine's existing column is NULL or empty string
  const producerName = producerInfo?.name || null;
  const producerRegion = producerInfo?.region || null;
  const producerCountry = producerInfo?.country || null;
  // Only persist awards JSONB when we have at least one record
  const extractedAwardsJson = awards?.length > 0 ? JSON.stringify(awards) : null;

  await db.prepare(`
    UPDATE wines SET
      competition_index = ?,
      critics_index = ?,
      community_index = ?,
      purchase_score = ?,
      purchase_stars = ?,
      confidence_level = ?,
      tasting_notes = COALESCE(?, tasting_notes),
      tasting_notes_structured = COALESCE(?, tasting_notes_structured),
      style_summary = COALESCE(?, style_summary),
      producer_description = COALESCE(?, producer_description),
      producer = COALESCE(NULLIF(producer, ''), ?),
      region = COALESCE(NULLIF(region, ''), ?),
      country = COALESCE(NULLIF(country, ''), ?),
      extracted_awards = COALESCE(?, extracted_awards),
      ratings_updated_at = CURRENT_TIMESTAMP
    WHERE cellar_id = ? AND id = ?
  `).run(
    aggregates.competition_index,
    aggregates.critics_index,
    aggregates.community_index,
    aggregates.purchase_score,
    aggregates.purchase_stars,
    aggregates.confidence_level,
    narrative,
    tastingNotesJson,
    styleSummary,
    producerDescription,
    producerName,
    producerRegion,
    producerCountry,
    extractedAwardsJson,
    cellarId,
    wineId
  );

  logger.info('WineUpdateService', `Updated wine ${wineId}: style=${styleSummary ? 'yes' : 'no'}, awards=${awards?.length || 0}, pairings=${foodPairings.length}`);

  if (foodPairings.length > 0) {
    await saveFoodPairings(wineId, cellarId, foodPairings);
  }
}
