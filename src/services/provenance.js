/**
 * @fileoverview Data provenance service for tracking external data sources.
 * Records where every piece of externally-derived data came from.
 * @module services/provenance
 */

import crypto from 'crypto';
import db from '../db/index.js';
import logger from '../utils/logger.js';

// PostgreSQL uses CURRENT_TIMESTAMP, SQLite uses datetime('now')
const NOW_FUNC = process.env.DATABASE_URL ? 'CURRENT_TIMESTAMP' : "datetime('now')";

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
 * Called during app startup.
 */
export function initProvenanceTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS data_provenance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wine_id INTEGER,
        field_name TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_url TEXT,
        retrieval_method TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        raw_hash TEXT,
        expires_at DATETIME,
        FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
      )
    `);

    // Create indexes if they don't exist
    db.exec(`CREATE INDEX IF NOT EXISTS idx_provenance_wine ON data_provenance(wine_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_provenance_source ON data_provenance(source_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_provenance_expires ON data_provenance(expires_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_provenance_field ON data_provenance(field_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_provenance_wine_source_field ON data_provenance(wine_id, source_id, field_name)`);

    logger.info('[Provenance] Table initialized');
  } catch (error) {
    logger.error('[Provenance] Failed to initialize table:', error);
    throw error;
  }
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
 * @returns {Object} Database insert result with lastInsertRowid
 */
export function recordProvenance({
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
    const result = db.prepare(`
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
 * @returns {Array} Provenance records
 */
export function getProvenance(wineId, fieldName = null) {
  try {
    if (fieldName) {
      return db.prepare(`
        SELECT * FROM data_provenance
        WHERE wine_id = ? AND field_name = ?
        ORDER BY retrieved_at DESC
      `).all(wineId, fieldName);
    }
    return db.prepare(`
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
 * @returns {Object|null} Most recent provenance record
 */
export function getProvenanceForSource(wineId, sourceId, fieldName) {
  try {
    return db.prepare(`
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
 * @returns {boolean} True if fresh data exists
 */
export function hasFreshData(wineId, sourceId, fieldName) {
  try {
    const result = db.prepare(`
      SELECT 1 FROM data_provenance
      WHERE wine_id = ? AND source_id = ? AND field_name = ?
      AND expires_at > ${NOW_FUNC}
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
 * @returns {boolean} True if content has changed
 */
export function hasContentChanged(wineId, sourceId, fieldName, newContent) {
  const existing = getProvenanceForSource(wineId, sourceId, fieldName);
  if (!existing || !existing.raw_hash) {
    return true; // No previous record, treat as changed
  }

  const newHash = hashContent(newContent);
  return existing.raw_hash !== newHash;
}

/**
 * Get all expired provenance records.
 * @returns {Array} Expired records
 */
export function getExpiredRecords() {
  try {
    return db.prepare(`
      SELECT * FROM data_provenance
      WHERE expires_at <= ${NOW_FUNC}
      ORDER BY expires_at ASC
    `).all();
  } catch (error) {
    logger.error('[Provenance] Failed to get expired records:', error);
    return [];
  }
}

/**
 * Delete expired provenance records.
 * @returns {number} Number of records deleted
 */
export function purgeExpiredRecords() {
  try {
    const result = db.prepare(`
      DELETE FROM data_provenance
      WHERE expires_at <= ${NOW_FUNC}
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
 * @returns {Object} Statistics about provenance records
 */
export function getProvenanceStats() {
  try {
    const stats = {};

    // Total records
    stats.total = db.prepare('SELECT COUNT(*) as count FROM data_provenance').get().count;

    // Records by source
    stats.bySource = db.prepare(`
      SELECT source_id, COUNT(*) as count
      FROM data_provenance
      GROUP BY source_id
      ORDER BY count DESC
    `).all();

    // Records by field
    stats.byField = db.prepare(`
      SELECT field_name, COUNT(*) as count
      FROM data_provenance
      GROUP BY field_name
      ORDER BY count DESC
    `).all();

    // Records by retrieval method
    stats.byMethod = db.prepare(`
      SELECT retrieval_method, COUNT(*) as count
      FROM data_provenance
      GROUP BY retrieval_method
      ORDER BY count DESC
    `).all();

    // Fresh vs expired
    stats.fresh = db.prepare(`
      SELECT COUNT(*) as count FROM data_provenance
      WHERE expires_at > ${NOW_FUNC}
    `).get().count;

    stats.expired = stats.total - stats.fresh;

    // Average confidence
    stats.avgConfidence = db.prepare(`
      SELECT AVG(confidence) as avg FROM data_provenance
    `).get().avg || 0;

    return stats;
  } catch (error) {
    logger.error('[Provenance] Failed to get stats:', error);
    return { total: 0, bySource: [], byField: [], byMethod: [], fresh: 0, expired: 0, avgConfidence: 0 };
  }
}

/**
 * Get wines with provenance from a specific source.
 * @param {string} sourceId - Source identifier
 * @returns {Array} Wine IDs with provenance from this source
 */
export function getWinesWithSource(sourceId) {
  try {
    return db.prepare(`
      SELECT DISTINCT wine_id FROM data_provenance
      WHERE source_id = ? AND wine_id IS NOT NULL
    `).all(sourceId).map(r => r.wine_id);
  } catch (error) {
    logger.error('[Provenance] Failed to get wines with source:', error);
    return [];
  }
}

/**
 * Delete all provenance for a wine.
 * Called when a wine is deleted.
 * @param {number} wineId - Wine ID
 * @returns {number} Number of records deleted
 */
export function deleteWineProvenance(wineId) {
  try {
    const result = db.prepare(`
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
