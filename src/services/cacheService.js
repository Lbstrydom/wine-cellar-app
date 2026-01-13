/**
 * @fileoverview Cache service for search results, pages, and extractions.
 * @module services/cacheService
 */

import crypto from 'crypto';
import db from '../db/index.js';
import { nowFunc } from '../db/helpers.js';
import logger from '../utils/logger.js';

/**
 * Generate cache key from parameters.
 * @param {Object} params - Parameters to hash
 * @returns {string} 32-character hex hash
 */
export function generateCacheKey(params) {
  const normalized = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 32);
}

/**
 * Get cache TTL from config.
 * @param {string} type - TTL type (serp, page, extraction, blocked_page)
 * @returns {Promise<number>} TTL in hours
 */
export async function getCacheTTL(type) {
  const configKey = `${type}_ttl_hours`;
  try {
    const result = await db.prepare('SELECT value FROM cache_config WHERE key = ?').get(configKey);
    return result ? parseInt(result.value) : 24;
  } catch {
    return 24; // Default fallback
  }
}

/**
 * Calculate expiry timestamp.
 * @param {number} hours - Hours from now
 * @returns {string} ISO timestamp
 */
function getExpiryTimestamp(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// =============================================================================
// SERP Cache
// =============================================================================

/**
 * Get cached SERP results.
 * @param {Object} queryParams - Search parameters
 * @returns {Object|null} Cached results or null
 */
export async function getCachedSerpResults(queryParams) {
  const cacheKey = generateCacheKey(queryParams);

  try {
    const cached = await db.prepare(`
      SELECT results, result_count
      FROM search_cache
      WHERE cache_key = ? AND expires_at > CURRENT_TIMESTAMP
    `).get(cacheKey);

    if (cached) {
      logger.info('Cache', `SERP HIT: ${queryParams.query?.substring(0, 50)}...`);
      return {
        results: JSON.parse(cached.results),
        count: cached.result_count,
        fromCache: true
      };
    }
  } catch (err) {
    logger.warn('Cache', `SERP lookup failed: ${err.message}`);
  }

  return null;
}

/**
 * Cache SERP results.
 * @param {Object} queryParams - Search parameters
 * @param {string} queryType - Type of query
 * @param {Array} results - Search results
 */
export async function cacheSerpResults(queryParams, queryType, results) {
  const cacheKey = generateCacheKey(queryParams);
  const ttlHours = await getCacheTTL('serp');

  try {
    await db.prepare(`
      INSERT INTO search_cache (cache_key, query_type, query_params, results, result_count, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        results = excluded.results,
        result_count = excluded.result_count,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `).run(
      cacheKey,
      queryType,
      JSON.stringify(queryParams),
      JSON.stringify(results),
      results.length,
      getExpiryTimestamp(ttlHours)
    );
  } catch (err) {
    logger.warn('Cache', `SERP cache write failed: ${err.message}`);
  }
}

// =============================================================================
// Page Cache
// =============================================================================

/**
 * Get cached page content.
 * @param {string} url - Page URL
 * @returns {Object|null} Cached page or null
 */
export async function getCachedPage(url) {
  const urlHash = generateCacheKey({ url });

  try {
    const cached = await db.prepare(`
      SELECT content, fetch_status, status_code, error_message
      FROM page_cache
      WHERE url_hash = ? AND expires_at > CURRENT_TIMESTAMP
    `).get(urlHash);

    if (cached) {
      logger.info('Cache', `Page HIT: ${url.substring(0, 60)}...`);
      return {
        content: cached.content,
        status: cached.fetch_status,
        statusCode: cached.status_code,
        error: cached.error_message,
        fromCache: true
      };
    }
  } catch (err) {
    logger.warn('Cache', `Page lookup failed: ${err.message}`);
  }

  return null;
}

/**
 * Cache page content.
 * @param {string} url - Page URL
 * @param {string|null} content - Page content
 * @param {string} status - Fetch status
 * @param {number} statusCode - HTTP status code
 * @param {string|null} errorMessage - Error message if failed
 */
export async function cachePage(url, content, status, statusCode, errorMessage = null) {
  const urlHash = generateCacheKey({ url });

  // Blocked pages get shorter TTL for retry
  const ttlType = status === 'success' ? 'page' : 'blocked_page';
  const ttlHours = await getCacheTTL(ttlType);

  try {
    await db.prepare(`
      INSERT INTO page_cache (url_hash, url, content, content_length, fetch_status, status_code, error_message, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url_hash) DO UPDATE SET
        content = excluded.content,
        content_length = excluded.content_length,
        fetch_status = excluded.fetch_status,
        status_code = excluded.status_code,
        error_message = excluded.error_message,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `).run(
      urlHash,
      url,
      content,
      content ? content.length : 0,
      status,
      statusCode,
      errorMessage,
      getExpiryTimestamp(ttlHours)
    );
  } catch (err) {
    logger.warn('Cache', `Page cache write failed: ${err.message}`);
  }
}

// =============================================================================
// Extraction Cache
// =============================================================================

/**
 * Get cached extraction results.
 * @param {number} wineId - Wine ID
 * @param {string} contentHash - Hash of input content
 * @param {string} extractionType - Type of extraction
 * @returns {Object|null} Cached extraction or null
 */
export async function getCachedExtraction(wineId, contentHash, extractionType) {
  try {
    const cached = await db.prepare(`
      SELECT extracted_ratings, extracted_windows, tasting_notes
      FROM extraction_cache
      WHERE wine_id = ? AND content_hash = ? AND extraction_type = ?
        AND expires_at > CURRENT_TIMESTAMP
    `).get(wineId, contentHash, extractionType);

    if (cached) {
      logger.info('Cache', `Extraction HIT: wine ${wineId}, type ${extractionType}`);
      return {
        ratings: JSON.parse(cached.extracted_ratings),
        windows: cached.extracted_windows ? JSON.parse(cached.extracted_windows) : [],
        tastingNotes: cached.tasting_notes,
        fromCache: true
      };
    }
  } catch (err) {
    logger.warn('Cache', `Extraction lookup failed: ${err.message}`);
  }

  return null;
}

/**
 * Cache extraction results.
 * @param {number} wineId - Wine ID
 * @param {string} contentHash - Hash of input content
 * @param {string} extractionType - Type of extraction
 * @param {Array} ratings - Extracted ratings
 * @param {Array|null} windows - Extracted drinking windows
 * @param {string|null} tastingNotes - Tasting notes
 * @param {string} modelVersion - Claude model used
 */
export async function cacheExtraction(wineId, contentHash, extractionType, ratings, windows, tastingNotes, modelVersion) {
  const ttlHours = await getCacheTTL('extraction');

  try {
    await db.prepare(`
      INSERT INTO extraction_cache (wine_id, content_hash, extraction_type, extracted_ratings, extracted_windows, tasting_notes, model_version, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(wine_id, content_hash, extraction_type) DO UPDATE SET
        extracted_ratings = excluded.extracted_ratings,
        extracted_windows = excluded.extracted_windows,
        tasting_notes = excluded.tasting_notes,
        model_version = excluded.model_version,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `).run(
      wineId,
      contentHash,
      extractionType,
      JSON.stringify(ratings),
      windows ? JSON.stringify(windows) : null,
      tastingNotes,
      modelVersion,
      getExpiryTimestamp(ttlHours)
    );
  } catch (err) {
    logger.warn('Cache', `Extraction cache write failed: ${err.message}`);
  }
}

// =============================================================================
// Cache Maintenance
// =============================================================================

/**
 * Purge expired cache entries.
 * @returns {Object} Count of purged entries by table
 */
export async function purgeExpiredCache() {
  // Whitelist of allowed tables - prevents table name injection
  const ALLOWED_TABLES = new Set(['search_cache', 'page_cache', 'extraction_cache']);
  const tables = Array.from(ALLOWED_TABLES);
  const results = {};

  for (const table of tables) {
    try {
      // Safe: table name from whitelist, CURRENT_TIMESTAMP is SQL constant
      const result = await db.prepare(`DELETE FROM ${table} WHERE expires_at < CURRENT_TIMESTAMP`).run();
      results[table] = result.changes || 0;
    } catch (err) {
      results[table] = `error: ${err.message}`;
    }
  }

  logger.info('Cache', `Purged expired entries: ${JSON.stringify(results)}`);
  return results;
}

/**
 * Get cache statistics.
 * @returns {Object} Cache stats by table
 */
export async function getCacheStats() {
  const stats = {};

  try {
    stats.serp = await db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END) as valid
      FROM search_cache
    `).get();

    stats.page = await db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END) as valid
      FROM page_cache
    `).get();

    stats.extraction = await db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END) as valid
      FROM extraction_cache
    `).get();
  } catch (err) {
    logger.warn('Cache', `Stats lookup failed: ${err.message}`);
  }

  return stats;
}

/**
 * Invalidate cache for a specific wine.
 * @param {number} wineId - Wine ID
 */
export async function invalidateWineCache(wineId) {
  try {
    await db.prepare('DELETE FROM extraction_cache WHERE wine_id = ?').run(wineId);
    logger.info('Cache', `Invalidated extraction cache for wine ${wineId}`);
  } catch (err) {
    logger.warn('Cache', `Invalidation failed: ${err.message}`);
  }
}

/**
 * Update cache configuration.
 * @param {string} key - Config key
 * @param {string} value - Config value
 */
export async function updateCacheConfig(key, value) {
  try {
    await db.prepare(`
      UPDATE cache_config SET value = ? WHERE key = ?
    `).run(value, key);
  } catch (err) {
    logger.warn('Cache', `Config update failed: ${err.message}`);
  }
}

// =============================================================================
// Analysis Cache
// =============================================================================

/**
 * Generate slot hash for cache invalidation.
 * Hash of all wine_id assignments to detect changes.
 * @returns {Promise<string>} MD5 hash of slot assignments
 */
export async function generateSlotHash() {
  try {
    const slots = await db.prepare(`
      SELECT location_code, wine_id
      FROM slots
      WHERE wine_id IS NOT NULL
      ORDER BY location_code
    `).all();

    const slotData = slots.map(s => `${s.location_code}:${s.wine_id}`).join('|');
    return crypto.createHash('md5').update(slotData).digest('hex');
  } catch (err) {
    logger.warn('Cache', `Slot hash generation failed: ${err.message}`);
    return '';
  }
}

/**
 * Get cached cellar analysis.
 * @param {string} analysisType - Type of analysis ('full', 'fridge', 'zones')
 * @returns {Promise<Object|null>} Cached analysis or null
 */
export async function getCachedAnalysis(analysisType) {
  try {
    const cached = await db.prepare(`
      SELECT analysis_data, wine_count, slot_hash, created_at
      FROM cellar_analysis_cache
      WHERE analysis_type = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).get(analysisType);

    if (cached) {
      // Verify slot hash matches current state
      const currentHash = await generateSlotHash();
      if (cached.slot_hash === currentHash) {
        logger.info('Cache', `Analysis HIT: ${analysisType}`);
        return {
          data: JSON.parse(cached.analysis_data),
          wineCount: cached.wine_count,
          createdAt: cached.created_at,
          fromCache: true
        };
      } else {
        logger.info('Cache', `Analysis STALE: ${analysisType} (slot hash mismatch)`);
        // Invalidate stale cache
        await invalidateAnalysisCache(analysisType);
      }
    }
  } catch (err) {
    logger.warn('Cache', `Analysis lookup failed: ${err.message}`);
  }

  return null;
}

/**
 * Cache cellar analysis result.
 * @param {string} analysisType - Type of analysis ('full', 'fridge', 'zones')
 * @param {Object} analysisData - The analysis result
 * @param {number} wineCount - Current wine count
 * @param {number} [ttlHours=24] - Cache TTL in hours
 */
export async function cacheAnalysis(analysisType, analysisData, wineCount, ttlHours = 24) {
  try {
    const slotHash = await generateSlotHash();
    const expiresAt = getExpiryTimestamp(ttlHours);

    await db.prepare(`
      INSERT INTO cellar_analysis_cache (analysis_type, analysis_data, wine_count, slot_hash, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(analysis_type) DO UPDATE SET
        analysis_data = excluded.analysis_data,
        wine_count = excluded.wine_count,
        slot_hash = excluded.slot_hash,
        created_at = CURRENT_TIMESTAMP,
        expires_at = excluded.expires_at
    `).run(
      analysisType,
      JSON.stringify(analysisData),
      wineCount,
      slotHash,
      expiresAt
    );

    logger.info('Cache', `Analysis cached: ${analysisType} (${wineCount} wines)`);
  } catch (err) {
    logger.warn('Cache', `Analysis cache write failed: ${err.message}`);
  }
}

/**
 * Invalidate analysis cache.
 * @param {string} [analysisType] - Specific type to invalidate, or all if omitted
 */
export async function invalidateAnalysisCache(analysisType = null) {
  try {
    if (analysisType) {
      await db.prepare('DELETE FROM cellar_analysis_cache WHERE analysis_type = ?').run(analysisType);
      logger.info('Cache', `Invalidated analysis cache: ${analysisType}`);
    } else {
      await db.prepare('DELETE FROM cellar_analysis_cache').run();
      logger.info('Cache', 'Invalidated all analysis cache');
    }
  } catch (err) {
    logger.warn('Cache', `Analysis cache invalidation failed: ${err.message}`);
  }
}

/**
 * Get analysis cache info (without full data).
 * @param {string} analysisType - Type of analysis
 * @returns {Promise<Object|null>} Cache info or null
 */
export async function getAnalysisCacheInfo(analysisType) {
  try {
    const info = await db.prepare(`
      SELECT wine_count, slot_hash, created_at, expires_at
      FROM cellar_analysis_cache
      WHERE analysis_type = ?
    `).get(analysisType);

    if (info) {
      const currentHash = await generateSlotHash();
      return {
        wineCount: info.wine_count,
        createdAt: info.created_at,
        expiresAt: info.expires_at,
        isValid: info.slot_hash === currentHash
      };
    }
  } catch (err) {
    logger.warn('Cache', `Analysis cache info lookup failed: ${err.message}`);
  }

  return null;
}
