/**
 * @fileoverview Data provenance service for tracking external data sources.
 * Records where every piece of externally-derived data came from.
 * @module services/provenance
 */

import crypto from 'crypto';
import db from '../db/index.js';
import { nowFunc } from '../db/helpers.js';
import logger from '../utils/logger.js';

/**
 * Retrieval methods for provenance tracking.
 */
export const RETRIEVAL_METHODS = {
  SCRAPE: 'scrape',      // Web scraping
  API: 'api',            // Official API call
  USER_INPUT: 'user_input', // Manual user entry
  OCR: 'ocr',            // OCR from PDF/image
  MANUAL: 'manual',      // Manual data entry by admin
  IMPORT: 'import'       // Bulk import from file
};

/**
 * Field names commonly tracked for provenance.
 */
export const PROVENANCE_FIELDS = {
  RATING_SCORE: 'rating_score',
  TASTING_NOTES: 'tasting_notes',
  DRINK_WINDOW: 'drink_window',
  AWARD: 'award',
  PRICE: 'price',
  PRODUCER_INFO: 'producer_info',
  VINTAGE_NOTES: 'vintage_notes'
};

/**
 * Default expiry periods by field type (in days).
 */
const DEFAULT_EXPIRY_DAYS = {
  rating_score: 365,      // Ratings rarely change once published
  tasting_notes: 365,     // Notes don't change
  drink_window: 180,      // May need refresh as wine ages
  award: 365,             // Awards are permanent
  price: 7,               // Prices change frequently
  producer_info: 365,     // Producer info is stable
  vintage_notes: 365,     // Vintage info doesn't change
  default: 90             // Default 3 months
};

/**
 * Initialize the provenance table if it doesn't exist.
 * @deprecated Table is now created via migrations (013_data_provenance.sql).
 * This function is kept for backwards compatibility but is a no-op.
 */
export function initProvenanceTable() {
  logger.info('[Provenance] Table initialization skipped - table created via migrations');
}

/**
 * Generate a hash of raw content for change detection.
 * @param {string} content - Raw content to hash
 * @returns {string|null} SHA-256 hash or null if content is null/undefined
 */
export function hashContent(content) {
  if (content === null || content === undefined) return null;
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

/**
 * Record provenance for externally-derived data.
 * Call this whenever storing data from an external source.
 *
 * @param {Object} params - Provenance parameters
 * @param {number} params.wineId - Wine ID (can be null for global data)
 * @param {string} params.fieldName - Field being stored (e.g., 'rating_score')
 * @param {string} params.sourceId - Source identifier (e.g., 'decanter')
 * @param {string} [params.sourceUrl] - URL where data was retrieved
 * @param {string} [params.retrievalMethod='scrape'] - How data was retrieved
 * @param {number} [params.confidence=1.0] - Confidence score (0.0-1.0)
 * @param {string} [params.rawContent] - Raw content to hash for change detection
 * @param {number} [params.expiresInDays] - Days until data expires
 * @returns {Promise<Object>} Database insert result with lastInsertRowid
 */
export async function recordProvenance({
  wineId,
  fieldName,
  sourceId,
  sourceUrl = null,
  retrievalMethod = RETRIEVAL_METHODS.SCRAPE,
  confidence = 1.0,
  rawContent = null,
  expiresInDays = null
}) {
  // Determine expiry period
  const expiry = expiresInDays || DEFAULT_EXPIRY_DAYS[fieldName] || DEFAULT_EXPIRY_DAYS.default;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiry);

  const rawHash = rawContent ? hashContent(rawContent) : null;

  try {
    const result = await db.prepare(`
      INSERT INTO data_provenance
      (wine_id, field_name, source_id, source_url, retrieval_method, confidence, raw_hash, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      wineId,
      fieldName,
      sourceId,
      sourceUrl,
      retrievalMethod,
      confidence,
      rawHash,
      expiresAt.toISOString()
    );

    logger.debug(`[Provenance] Recorded: wine=${wineId}, field=${fieldName}, source=${sourceId}`);
    return result;
  } catch (error) {
    logger.error('[Provenance] Failed to record:', error);
    throw error;
  }
}

/**
 * Get provenance history for a wine.
 * @param {number} wineId - Wine ID
 * @param {string} [fieldName] - Optional field name filter
 * @returns {Promise<Array>} Provenance records
 */
export async function getProvenance(wineId, fieldName = null) {
  try {
    if (fieldName) {
      return await db.prepare(`
        SELECT * FROM data_provenance
        WHERE wine_id = ? AND field_name = ?
        ORDER BY retrieved_at DESC
      `).all(wineId, fieldName);
    }
    return await db.prepare(`
      SELECT * FROM data_provenance
      WHERE wine_id = ?
      ORDER BY retrieved_at DESC
    `).all(wineId);
  } catch (error) {
    logger.error('[Provenance] Failed to get provenance:', error);
    return [];
  }
}

/**
 * Get provenance for a specific source and field.
 * @param {number} wineId - Wine ID
 * @param {string} sourceId - Source identifier
 * @param {string} fieldName - Field name
 * @returns {Promise<Object|null>} Most recent provenance record
 */
export async function getProvenanceForSource(wineId, sourceId, fieldName) {
  try {
    return await db.prepare(`
      SELECT * FROM data_provenance
      WHERE wine_id = ? AND source_id = ? AND field_name = ?
      ORDER BY retrieved_at DESC
      LIMIT 1
    `).get(wineId, sourceId, fieldName);
  } catch (error) {
    logger.error('[Provenance] Failed to get source provenance:', error);
    return null;
  }
}

/**
 * Check if we have fresh (non-expired) data for a wine/source/field combo.
 * @param {number} wineId - Wine ID
 * @param {string} sourceId - Source identifier
 * @param {string} fieldName - Field name
 * @returns {Promise<boolean>} True if fresh data exists
 */
export async function hasFreshData(wineId, sourceId, fieldName) {
  try {
    const currentTime = nowFunc(); // Safe: nowFunc() returns CURRENT_TIMESTAMP SQL
    const result = await db.prepare(`
      SELECT 1 FROM data_provenance
      WHERE wine_id = ? AND source_id = ? AND field_name = ?
      AND expires_at > ${currentTime}
      LIMIT 1
    `).get(wineId, sourceId, fieldName);
    return !!result;
  } catch (error) {
    logger.error('[Provenance] Failed to check fresh data:', error);
    return false;
  }
}

/**
 * Check if content has changed since last retrieval.
 * @param {number} wineId - Wine ID
 * @param {string} sourceId - Source identifier
 * @param {string} fieldName - Field name
 * @param {string} newContent - New content to compare
 * @returns {Promise<boolean>} True if content has changed
 */
export async function hasContentChanged(wineId, sourceId, fieldName, newContent) {
  const existing = await getProvenanceForSource(wineId, sourceId, fieldName);
  if (!existing || !existing.raw_hash) {
    return true; // No previous record, treat as changed
  }

  const newHash = hashContent(newContent);
  return existing.raw_hash !== newHash;
}

/**
 * Get all expired provenance records.
 * @returns {Promise<Array>} Expired records
 */
export async function getExpiredRecords() {
  try {
    const currentTime = nowFunc(); // Safe: nowFunc() returns CURRENT_TIMESTAMP SQL
    return await db.prepare(`
      SELECT * FROM data_provenance
      WHERE expires_at <= ${currentTime}
      ORDER BY expires_at ASC
    `).all();
  } catch (error) {
    logger.error('[Provenance] Failed to get expired records:', error);
    return [];
  }
}

/**
 * Delete expired provenance records.
 * @returns {Promise<number>} Number of records deleted
 */
export async function purgeExpiredRecords() {
  try {
    const currentTime = nowFunc(); // Safe: nowFunc() returns CURRENT_TIMESTAMP SQL
    const result = await db.prepare(`
      DELETE FROM data_provenance
      WHERE expires_at <= ${currentTime}
    `).run();

    if (result.changes > 0) {
      logger.info(`[Provenance] Purged ${result.changes} expired records`);
    }
    return result.changes;
  } catch (error) {
    logger.error('[Provenance] Failed to purge expired records:', error);
    return 0;
  }
}

/**
 * Get provenance statistics.
 * @returns {Promise<Object>} Statistics about provenance records
 */
export async function getProvenanceStats() {
  try {
    const stats = {};

    // Total records
    const totalResult = await db.prepare('SELECT COUNT(*) as count FROM data_provenance').get();
    stats.total = totalResult.count;

    // Records by source
    stats.bySource = await db.prepare(`
      SELECT source_id, COUNT(*) as count
      FROM data_provenance
      GROUP BY source_id
      ORDER BY count DESC
    `).all();

    // Records by field
    stats.byField = await db.prepare(`
      SELECT field_name, COUNT(*) as count
      FROM data_provenance
      GROUP BY field_name
      ORDER BY count DESC
    `).all();

    // Records by retrieval method
    stats.byMethod = await db.prepare(`
      SELECT retrieval_method, COUNT(*) as count
      FROM data_provenance
      GROUP BY retrieval_method
      ORDER BY count DESC
    `).all();

    // Fresh vs expired
    const currentTime = nowFunc(); // Safe: nowFunc() returns CURRENT_TIMESTAMP SQL
    const freshResult = await db.prepare(`
      SELECT COUNT(*) as count FROM data_provenance
      WHERE expires_at > ${currentTime}
    `).get();
    stats.fresh = freshResult.count;

    stats.expired = stats.total - stats.fresh;

    // Average confidence
    const avgResult = await db.prepare(`
      SELECT AVG(confidence) as avg FROM data_provenance
    `).get();
    stats.avgConfidence = avgResult.avg || 0;

    return stats;
  } catch (error) {
    logger.error('[Provenance] Failed to get stats:', error);
    return { total: 0, bySource: [], byField: [], byMethod: [], fresh: 0, expired: 0, avgConfidence: 0 };
  }
}

/**
 * Get wines with provenance from a specific source.
 * @param {string} sourceId - Source identifier
 * @returns {Promise<Array>} Wine IDs with provenance from this source
 */
export async function getWinesWithSource(sourceId) {
  try {
    const results = await db.prepare(`
      SELECT DISTINCT wine_id FROM data_provenance
      WHERE source_id = ? AND wine_id IS NOT NULL
    `).all(sourceId);
    return results.map(r => r.wine_id);
  } catch (error) {
    logger.error('[Provenance] Failed to get wines with source:', error);
    return [];
  }
}

/**
 * Delete all provenance for a wine.
 * Called when a wine is deleted.
 * @param {number} wineId - Wine ID
 * @returns {Promise<number>} Number of records deleted
 */
export async function deleteWineProvenance(wineId) {
  try {
    const result = await db.prepare(`
      DELETE FROM data_provenance WHERE wine_id = ?
    `).run(wineId);
    return result.changes;
  } catch (error) {
    logger.error('[Provenance] Failed to delete wine provenance:', error);
    return 0;
  }
}

export default {
  initProvenanceTable,
  recordProvenance,
  getProvenance,
  getProvenanceForSource,
  hasFreshData,
  hasContentChanged,
  getExpiredRecords,
  purgeExpiredRecords,
  getProvenanceStats,
  getWinesWithSource,
  deleteWineProvenance,
  hashContent,
  RETRIEVAL_METHODS,
  PROVENANCE_FIELDS
};
