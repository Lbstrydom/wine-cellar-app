/**
 * @fileoverview Scraping governance wrapper.
 * Combines cache checking, rate limiting, circuit breaking, and provenance recording.
 * @module services/scrapingGovernance
 */

import { hasFreshData, recordProvenance, RETRIEVAL_METHODS } from './provenance.js';
import { waitForRateLimit, getRateLimit } from './rateLimiter.js';
import { isCircuitOpen, recordFailure, recordSuccess, getHealthStatus } from './circuitBreaker.js';
import { getSource } from '../config/unifiedSources.js';
import logger from '../utils/logger.js';

/**
 * Result status codes for governed scrape operations.
 */
export const GOVERNANCE_STATUS = {
  CACHED: 'cached',           // Fresh data exists, no scrape needed
  SUCCESS: 'success',         // Scraped successfully
  CIRCUIT_OPEN: 'circuit_open', // Circuit breaker prevented attempt
  RATE_LIMITED: 'rate_limited', // Rate limited (waited then proceeded)
  ERROR: 'error',             // Scrape failed
  SKIPPED: 'skipped'          // Skipped for other reason
};

/**
 * Wrap a scraping function with governance controls.
 * Does NOT change the scraping logic itself.
 *
 * @param {string} sourceId - Source identifier
 * @param {number} wineId - Wine ID
 * @param {string} fieldName - Field being retrieved (e.g., 'rating_score')
 * @param {Function} scrapeFn - Async function that performs the scrape
 * @param {Object} [options] - Additional options
 * @param {string} [options.sourceUrl] - URL being scraped
 * @param {boolean} [options.forceRefresh=false] - Skip cache check
 * @param {number} [options.confidence=1.0] - Confidence score for provenance
 * @returns {Promise<Object>} Result with status and data
 */
export async function withGovernance(sourceId, wineId, fieldName, scrapeFn, options = {}) {
  const {
    sourceUrl = null,
    forceRefresh = false,
    confidence = 1.0
  } = options;

  const config = getSource(sourceId);

  // 1. Cache check - skip scrape if we have fresh data
  if (!forceRefresh && hasFreshData(wineId, sourceId, fieldName)) {
    logger.debug(`[Governance] ${sourceId}/${fieldName}: using cached data`);
    return {
      status: GOVERNANCE_STATUS.CACHED,
      data: null,
      message: 'Fresh data exists in cache'
    };
  }

  // 2. Circuit breaker check - fail fast if source is down
  if (isCircuitOpen(sourceId)) {
    const health = getHealthStatus(sourceId);
    logger.warn(`[Governance] ${sourceId}: circuit open - ${health.message}`);
    return {
      status: GOVERNANCE_STATUS.CIRCUIT_OPEN,
      data: null,
      message: health.message,
      retryAt: health.retriesAt
    };
  }

  // 3. Rate limit - wait if needed
  const rateLimit = getRateLimit(sourceId, config);
  await waitForRateLimit(sourceId, rateLimit);

  // 4. Execute the scrape function
  try {
    logger.debug(`[Governance] ${sourceId}/${fieldName}: executing scrape`);
    const result = await scrapeFn();

    // Record success in circuit breaker
    recordSuccess(sourceId);

    // 5. Record provenance for successful scrape
    if (result !== null && result !== undefined) {
      try {
        recordProvenance({
          wineId,
          fieldName,
          sourceId,
          sourceUrl,
          retrievalMethod: RETRIEVAL_METHODS.SCRAPE,
          confidence,
          rawContent: typeof result === 'string' ? result : JSON.stringify(result)
        });
      } catch (provError) {
        logger.error(`[Governance] Failed to record provenance: ${provError.message}`);
        // Don't fail the overall operation for provenance errors
      }
    }

    return {
      status: GOVERNANCE_STATUS.SUCCESS,
      data: result,
      message: 'Scrape completed successfully'
    };
  } catch (error) {
    // Record failure in circuit breaker
    recordFailure(sourceId, error);

    logger.error(`[Governance] ${sourceId}/${fieldName}: scrape failed - ${error.message}`);
    return {
      status: GOVERNANCE_STATUS.ERROR,
      data: null,
      message: error.message,
      error
    };
  }
}

/**
 * Execute multiple governed scrapes in parallel with overall governance.
 *
 * @param {Array<Object>} tasks - Array of { sourceId, wineId, fieldName, scrapeFn, options }
 * @returns {Promise<Array<Object>>} Results for each task
 */
export async function withGovernanceBatch(tasks) {
  // Group by source to respect per-source rate limits
  const tasksBySource = new Map();
  for (const task of tasks) {
    const existing = tasksBySource.get(task.sourceId) || [];
    existing.push(task);
    tasksBySource.set(task.sourceId, existing);
  }

  // Execute tasks grouped by source (sequential within source, parallel across sources)
  const sourcePromises = [];

  for (const [_sourceId, sourceTasks] of tasksBySource.entries()) {
    const sourcePromise = (async () => {
      const results = [];
      for (const task of sourceTasks) {
        const result = await withGovernance(
          task.sourceId,
          task.wineId,
          task.fieldName,
          task.scrapeFn,
          task.options
        );
        results.push({ ...task, result });
      }
      return results;
    })();
    sourcePromises.push(sourcePromise);
  }

  const allResults = await Promise.all(sourcePromises);
  return allResults.flat();
}

/**
 * Check if a source is currently available for scraping.
 *
 * @param {string} sourceId - Source identifier
 * @returns {Object} Availability status
 */
export function checkSourceAvailability(sourceId) {
  const circuitOpen = isCircuitOpen(sourceId);

  if (circuitOpen) {
    const health = getHealthStatus(sourceId);
    return {
      available: false,
      reason: 'circuit_open',
      message: health.message,
      retryAt: health.retriesAt
    };
  }

  return {
    available: true,
    reason: null,
    message: 'Source available'
  };
}

/**
 * Get governance statistics for all sources.
 * @returns {Object} Governance statistics
 */
export function getGovernanceStats() {
  const { getCircuitStats } = require('./circuitBreaker.js');
  const { getRateLimitStats } = require('./rateLimiter.js');
  const { getProvenanceStats } = require('./provenance.js');

  return {
    circuits: getCircuitStats(),
    rateLimits: getRateLimitStats(),
    provenance: getProvenanceStats()
  };
}

/**
 * Record a manual/external scrape result.
 * Use when scrape was done outside governance wrapper.
 *
 * @param {string} sourceId - Source identifier
 * @param {number} wineId - Wine ID
 * @param {string} fieldName - Field retrieved
 * @param {boolean} success - Whether scrape succeeded
 * @param {Object} [options] - Additional options for provenance
 */
export function recordExternalScrape(sourceId, wineId, fieldName, success, options = {}) {
  if (success) {
    recordSuccess(sourceId);
    if (options.sourceUrl || options.rawContent) {
      recordProvenance({
        wineId,
        fieldName,
        sourceId,
        sourceUrl: options.sourceUrl,
        retrievalMethod: options.retrievalMethod || RETRIEVAL_METHODS.SCRAPE,
        confidence: options.confidence || 1.0,
        rawContent: options.rawContent
      });
    }
  } else {
    recordFailure(sourceId, options.error);
  }
}

export default {
  withGovernance,
  withGovernanceBatch,
  checkSourceAvailability,
  getGovernanceStats,
  recordExternalScrape,
  GOVERNANCE_STATUS
};
