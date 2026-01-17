/**
 * @fileoverview Wine search cache service for Phase 6 pipeline.
 * @module services/searchCache
 */

import db from '../db/index.js';
import { nowFunc } from '../db/helpers.js';

const DEFAULT_TTL_DAYS = 14;
const REFRESH_TTL_DAYS = 7;

function getExpiryTimestamp(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Lookup cached wine search results.
 * @param {number} cellarId
 * @param {string} fingerprint
 * @param {number} pipelineVersion
 * @returns {Promise<Object|null>}
 */
export async function lookupWineSearchCache(cellarId, fingerprint, pipelineVersion) {
  // Safe: nowFunc() is a helper that returns CURRENT_TIMESTAMP SQL function
  const currentTime = nowFunc();

  if (cellarId) {
    const cachedSql = [
      'SELECT search_result, expires_at',
      'FROM wine_search_cache',
      'WHERE cellar_id = $1 AND fingerprint = $2 AND pipeline_version = $3',
      "  AND cache_scope = 'cellar'",
      '  AND expires_at > ' + currentTime
    ].join('\n');
    const cached = await db.prepare(cachedSql).get(cellarId, fingerprint, pipelineVersion);

    if (cached) {
      // Refresh TTL on hit
      const updateSql = [
        'UPDATE wine_search_cache',
        'SET last_hit_at = ' + currentTime + ',',
        '    expires_at = $1',
        'WHERE cellar_id = $2 AND fingerprint = $3 AND pipeline_version = $4',
        "  AND cache_scope = 'cellar'"
      ].join('\n');
      await db.prepare(updateSql).run(
        getExpiryTimestamp(REFRESH_TTL_DAYS),
        cellarId,
        fingerprint,
        pipelineVersion
      );

      return cached.search_result;
    }
  }

  const globalSql = [
    'SELECT search_result, expires_at',
    'FROM wine_search_cache',
    'WHERE cellar_id IS NULL AND fingerprint = $1 AND pipeline_version = $2',
    "  AND cache_scope = 'global'",
    '  AND expires_at > ' + currentTime
  ].join('\n');
  const globalCached = await db.prepare(globalSql).get(fingerprint, pipelineVersion);

  if (!globalCached) return null;

  const updateGlobalSql = [
    'UPDATE wine_search_cache',
    'SET last_hit_at = ' + currentTime + ',',
    '    expires_at = $1',
    'WHERE cellar_id IS NULL AND fingerprint = $2 AND pipeline_version = $3',
    "  AND cache_scope = 'global'"
  ].join('\n');
  await db.prepare(updateGlobalSql).run(
    getExpiryTimestamp(REFRESH_TTL_DAYS),
    fingerprint,
    pipelineVersion
  );

  return globalCached.search_result;
}

/**
 * Store wine search results.
 * @param {number} cellarId
 * @param {string} fingerprint
 * @param {string} queryHash
 * @param {number} pipelineVersion
 * @param {Object} result
 */
export async function storeWineSearchCache(
  cellarId,
  fingerprint,
  queryHash,
  pipelineVersion,
  result,
  options = {}
) {
  const { alsoStoreGlobal = true } = options;
  // Safe: nowFunc() is a helper that returns CURRENT_TIMESTAMP SQL function
  const currentTime = nowFunc();
  const expiresAt = getExpiryTimestamp(DEFAULT_TTL_DAYS);

  if (cellarId) {
    const insertCellarSql = [
      'INSERT INTO wine_search_cache (',
      '  cellar_id, fingerprint, query_hash, pipeline_version, search_result, expires_at, cache_scope',
      ") VALUES ($1, $2, $3, $4, $5, $6, 'cellar')",
      'ON CONFLICT (cellar_id, fingerprint, pipeline_version) DO UPDATE SET',
      '  search_result = EXCLUDED.search_result,',
      '  query_hash = EXCLUDED.query_hash,',
      '  expires_at = EXCLUDED.expires_at,',
      '  last_hit_at = ' + currentTime
    ].join('\n');
    await db.prepare(insertCellarSql).run(
      cellarId,
      fingerprint,
      queryHash,
      pipelineVersion,
      JSON.stringify(result),
      expiresAt
    );
  }

  if (alsoStoreGlobal) {
    const insertGlobalSql = [
      'INSERT INTO wine_search_cache (',
      '  cellar_id, fingerprint, query_hash, pipeline_version, search_result, expires_at, cache_scope',
      ") VALUES (NULL, $1, $2, $3, $4, $5, 'global')",
      'ON CONFLICT (fingerprint, pipeline_version)',
      "WHERE cellar_id IS NULL AND cache_scope = 'global'",
      'DO UPDATE SET',
      '  search_result = EXCLUDED.search_result,',
      '  query_hash = EXCLUDED.query_hash,',
      '  expires_at = EXCLUDED.expires_at,',
      '  last_hit_at = ' + currentTime
    ].join('\n');
    await db.prepare(insertGlobalSql).run(
      fingerprint,
      queryHash,
      pipelineVersion,
      JSON.stringify(result),
      expiresAt
    );
  }
}

/**
 * Invalidate wine search cache for a fingerprint.
 * @param {number} cellarId
 * @param {string} fingerprint
 */
export async function invalidateWineSearchCache(cellarId, fingerprint, options = {}) {
  const { includeGlobal = false } = options;

  if (cellarId) {
    await db.prepare(`
      DELETE FROM wine_search_cache
      WHERE cellar_id = $1 AND fingerprint = $2 AND cache_scope = 'cellar'
    `).run(cellarId, fingerprint);
  }

  if (includeGlobal) {
    await db.prepare(`
      DELETE FROM wine_search_cache
      WHERE cellar_id IS NULL AND fingerprint = $1 AND cache_scope = 'global'
    `).run(fingerprint);
  }
}

export default {
  lookupWineSearchCache,
  storeWineSearchCache,
  invalidateWineSearchCache
};
