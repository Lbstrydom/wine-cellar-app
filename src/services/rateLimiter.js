/**
 * @fileoverview Rate limiter for web scraping operations.
 * Prevents excessive requests to external sources.
 * @module services/rateLimiter
 */

import logger from '../utils/logger.js';

/**
 * Default rate limits by source type (in milliseconds).
 */
export const DEFAULT_RATE_LIMITS = {
  // Competitions - typically allow moderate frequency
  competition: 2000,
  // Panel guides - often regional, be respectful
  panel_guide: 3000,
  // Critics - personal sites, be very respectful
  critic: 5000,
  // Community sites - usually handle traffic well
  community: 1000,
  // Aggregators - commercial sites, moderate rate
  aggregator: 2000,
  // Producer websites - be very respectful
  producer: 5000,
  // Default fallback
  default: 3000
};

/**
 * Map to track last request time per source.
 * @type {Map<string, number>}
 */
const lastRequestTime = new Map();

/**
 * Map to track pending rate limit waits.
 * @type {Map<string, Promise<void>>}
 */
const pendingWaits = new Map();

/**
 * Get the rate limit for a source.
 * @param {string} sourceId - Source identifier
 * @param {Object} [sourceConfig] - Source configuration with lens and rateLimitMs
 * @returns {number} Rate limit in milliseconds
 */
export function getRateLimit(sourceId, sourceConfig = null) {
  // Check for custom rate limit in source config
  if (sourceConfig?.rateLimitMs) {
    return sourceConfig.rateLimitMs;
  }

  // Fall back to lens-based defaults
  if (sourceConfig?.lens) {
    return DEFAULT_RATE_LIMITS[sourceConfig.lens] || DEFAULT_RATE_LIMITS.default;
  }

  return DEFAULT_RATE_LIMITS.default;
}

/**
 * Wait if needed to respect rate limit for a source.
 * Returns immediately if enough time has passed.
 *
 * @param {string} sourceId - Source identifier
 * @param {number} [minDelayMs] - Minimum delay in milliseconds
 * @returns {Promise<void>} Resolves when it's safe to proceed
 */
export async function waitForRateLimit(sourceId, minDelayMs = null) {
  const delay = minDelayMs || DEFAULT_RATE_LIMITS.default;

  // If there's already a pending wait for this source, wait for that too
  const pending = pendingWaits.get(sourceId);
  if (pending) {
    await pending;
  }

  const lastTime = lastRequestTime.get(sourceId) || 0;
  const elapsed = Date.now() - lastTime;

  if (elapsed < delay) {
    const waitTime = delay - elapsed;
    logger.debug(`[RateLimiter] ${sourceId}: waiting ${waitTime}ms`);

    const waitPromise = new Promise(resolve => setTimeout(resolve, waitTime));
    pendingWaits.set(sourceId, waitPromise);

    await waitPromise;
    pendingWaits.delete(sourceId);
  }

  lastRequestTime.set(sourceId, Date.now());
}

/**
 * Check if we need to wait before making a request.
 * Does not actually wait - just checks.
 *
 * @param {string} sourceId - Source identifier
 * @param {number} [minDelayMs] - Minimum delay in milliseconds
 * @returns {Object} { needsWait: boolean, waitTimeMs: number }
 */
export function checkRateLimit(sourceId, minDelayMs = null) {
  const delay = minDelayMs || DEFAULT_RATE_LIMITS.default;
  const lastTime = lastRequestTime.get(sourceId) || 0;
  const elapsed = Date.now() - lastTime;

  if (elapsed < delay) {
    return {
      needsWait: true,
      waitTimeMs: delay - elapsed
    };
  }

  return {
    needsWait: false,
    waitTimeMs: 0
  };
}

/**
 * Record that a request was made to a source.
 * Use this if you bypass waitForRateLimit but still want to track timing.
 *
 * @param {string} sourceId - Source identifier
 */
export function recordRequest(sourceId) {
  lastRequestTime.set(sourceId, Date.now());
}

/**
 * Get the time elapsed since last request to a source.
 *
 * @param {string} sourceId - Source identifier
 * @returns {number|null} Milliseconds since last request, or null if never requested
 */
export function getTimeSinceLastRequest(sourceId) {
  const lastTime = lastRequestTime.get(sourceId);
  if (!lastTime) return null;
  return Date.now() - lastTime;
}

/**
 * Reset rate limit tracking for a source.
 * Useful for testing or after extended downtime.
 *
 * @param {string} sourceId - Source identifier (or null to reset all)
 */
export function resetRateLimit(sourceId = null) {
  if (sourceId) {
    lastRequestTime.delete(sourceId);
    pendingWaits.delete(sourceId);
  } else {
    lastRequestTime.clear();
    pendingWaits.clear();
  }
}

/**
 * Get rate limit statistics.
 * @returns {Object} Statistics about rate limiting
 */
export function getRateLimitStats() {
  const stats = {
    trackedSources: lastRequestTime.size,
    pendingWaits: pendingWaits.size,
    sources: {}
  };

  for (const [sourceId, lastTime] of lastRequestTime.entries()) {
    stats.sources[sourceId] = {
      lastRequestAt: new Date(lastTime).toISOString(),
      elapsedMs: Date.now() - lastTime
    };
  }

  return stats;
}

export default {
  waitForRateLimit,
  checkRateLimit,
  recordRequest,
  getTimeSinceLastRequest,
  resetRateLimit,
  getRateLimitStats,
  getRateLimit,
  DEFAULT_RATE_LIMITS
};
