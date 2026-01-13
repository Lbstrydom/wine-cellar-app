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

  const cached = await db.prepare(`
    SELECT search_result, expires_at
    FROM wine_search_cache
    WHERE cellar_id = $1 AND fingerprint = $2 AND pipeline_version = $3
      AND expires_at > ${currentTime}
  `).get(cellarId, fingerprint, pipelineVersion);

  if (!cached) return null;

  // Refresh TTL on hit
  await db.prepare(`
    UPDATE wine_search_cache
    SET last_hit_at = ${currentTime},
        expires_at = $1
    WHERE cellar_id = $2 AND fingerprint = $3 AND pipeline_version = $4
  `).run(
    getExpiryTimestamp(REFRESH_TTL_DAYS),
    cellarId,
    fingerprint,
    pipelineVersion
  );

  return cached.search_result;
}

/**
 * Store wine search results.
 * @param {number} cellarId
 * @param {string} fingerprint
 * @param {string} queryHash
 * @param {number} pipelineVersion
 * @param {Object} result
 */
export async function storeWineSearchCache(cellarId, fingerprint, queryHash, pipelineVersion, result) {
  // Safe: nowFunc() is a helper that returns CURRENT_TIMESTAMP SQL function
  const currentTime = nowFunc();
  const expiresAt = getExpiryTimestamp(DEFAULT_TTL_DAYS);

  await db.prepare(`
    INSERT INTO wine_search_cache (
      cellar_id, fingerprint, query_hash, pipeline_version, search_result, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (cellar_id, fingerprint, pipeline_version) DO UPDATE SET
      search_result = EXCLUDED.search_result,
      query_hash = EXCLUDED.query_hash,
      expires_at = EXCLUDED.expires_at,
      last_hit_at = ${currentTime}
  `).run(
    cellarId,
    fingerprint,
    queryHash,
    pipelineVersion,
    JSON.stringify(result),
    expiresAt
  );
}

/**
 * Invalidate wine search cache for a fingerprint.
 * @param {number} cellarId
 * @param {string} fingerprint
 */
export async function invalidateWineSearchCache(cellarId, fingerprint) {
  await db.prepare(`
    DELETE FROM wine_search_cache
    WHERE cellar_id = $1 AND fingerprint = $2
  `).run(cellarId, fingerprint);
}

export default {
  lookupWineSearchCache,
  storeWineSearchCache,
  invalidateWineSearchCache
};
