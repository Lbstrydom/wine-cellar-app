/**
 * @fileoverview Shared fetch utilities for search modules.
 * Timeout management, conditional headers, and cache helpers.
 * @module services/shared/fetchUtils
 */

import crypto from 'crypto';

/**
 * Create a timeout with AbortController.
 * @param {number} ms - Timeout in milliseconds
 * @returns {{controller: AbortController, cleanup: Function}} Controller and cleanup function
 */
export function createTimeoutAbort(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    controller,
    cleanup: () => clearTimeout(timeoutId)
  };
}

/**
 * Build conditional HTTP headers for cache revalidation.
 * @param {Object} urlCache - Cached URL metadata with etag/lastModified
 * @returns {Object|null} Headers object or null
 */
export function buildConditionalHeaders(urlCache) {
  if (!urlCache) return null;
  if (urlCache.etag) return { 'If-None-Match': urlCache.etag };
  if (urlCache.lastModified) return { 'If-Modified-Since': urlCache.lastModified };
  return null;
}

/**
 * Resolve public cache status from HTTP response.
 * @param {number} statusCode - HTTP status code
 * @param {boolean} success - Whether the fetch was successful
 * @returns {string} Cache status: 'valid', 'gone', or 'error'
 */
export function resolvePublicCacheStatus(statusCode, success) {
  if (success) return 'valid';
  if (statusCode === 404 || statusCode === 410) return 'gone';
  return 'error';
}

/**
 * Compute SHA-256 hash of a buffer.
 * @param {Buffer} buffer - Buffer to hash
 * @returns {string} Hex-encoded hash
 */
export function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Calculate discovery confidence from results.
 * Based on number of relevant results from authoritative sources.
 * @param {Object[]} results - Targeted search results
 * @returns {number} Confidence 0-1
 */
export function calculateDiscoveryConfidence(results) {
  if (results.length === 0) return 0;

  // Weight by source type: producer sites are most confident
  let score = 0;
  const resultCount = Math.min(results.length, 5); // Cap at 5 for confidence calculation

  for (let i = 0; i < resultCount; i++) {
    const result = results[i];
    const relevanceScore = result.relevanceScore || 0;

    // Normalize relevance score to 0-1 (scores typically 0-100)
    let sourceWeight = 1.0;
    if (result.lens === 'producer') {
      sourceWeight = 1.5;
    } else if (result.lens === 'competition' || result.lens === 'critic' || result.lens === 'panel_guide') {
      sourceWeight = 1.2;
    } else if (result.lens === 'community') {
      sourceWeight = 0.8;
    }

    score += (Math.min(relevanceScore, 100) / 100) * sourceWeight;
  }

  // Normalize: max score is 5 results * 1.5 weight = 7.5
  return Math.min(1.0, score / 7.5);
}
