/**
 * @fileoverview Retry budget tracker for search operations.
 * Implements budget of 1 total retry per search session to prevent cascading failures.
 * Phase 1: Implement retry budget (1 total)
 * @module services/shared/retryBudget
 */

import logger from '../../utils/logger.js';

/**
 * Create a new retry budget for a search session.
 * Budget is 1 total retry across all domains in a single search.
 *
 * @param {Object} options - Budget options
 * @param {number} [options.maxRetries] - Max retries total (default: 1)
 * @param {number} [options.timeoutMs] - Timeout for entire search in MS (default: 30000)
 * @returns {Object} Budget tracker
 */
export function createRetryBudget(options = {}) {
  const {
    maxRetries = 1,
    timeoutMs = 30000
  } = options;

  return {
    id: `retry-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    maxRetries,
    usedRetries: 0,
    retriedDomains: new Set(),
    timeoutMs,
    startTime: Date.now(),
    history: []
  };
}

/**
 * Check if retry budget is available.
 *
 * @param {Object} budget - Retry budget
 * @returns {boolean} True if retries available
 */
export function hasRetryBudget(budget) {
  if (!budget) return true;
  return budget.usedRetries < budget.maxRetries;
}

/**
 * Reserve a retry from the budget.
 * Prevents the same domain from being retried twice.
 *
 * @param {Object} budget - Retry budget
 * @param {string} domain - Domain being retried
 * @param {Object} reason - Retry reason (reason, statusCode, etc.)
 * @returns {boolean} True if retry was reserved
 */
export function reserveRetry(budget, domain, reason = {}) {
  if (!budget) return true;

  // Don't retry if budget exhausted
  if (!hasRetryBudget(budget)) {
    logger.info('RetryBudget', `No budget remaining. Skipping retry for ${domain}`);
    return false;
  }

  // Don't retry same domain twice
  if (budget.retriedDomains.has(domain)) {
    logger.info('RetryBudget', `${domain} already retried. Skipping.`);
    return false;
  }

  // Check wall clock timeout
  const elapsed = Date.now() - budget.startTime;
  if (elapsed > budget.timeoutMs * 0.8) {
    logger.info('RetryBudget', `Near timeout (${elapsed}ms). Skipping retry.`);
    return false;
  }

  // Reserve the retry
  budget.usedRetries += 1;
  budget.retriedDomains.add(domain);

  budget.history.push({
    timestamp: new Date().toISOString(),
    domain,
    reason: reason.reason || 'unknown',
    statusCode: reason.statusCode || null
  });

  logger.info('RetryBudget', `Reserved retry for ${domain} (${budget.usedRetries}/${budget.maxRetries})`);
  return true;
}

/**
 * Get budget status for logging/debugging.
 *
 * @param {Object} budget - Retry budget
 * @returns {Object} Status summary
 */
export function getBudgetStatus(budget) {
  if (!budget) {
    return {
      unlimited: true
    };
  }

  const elapsed = Date.now() - budget.startTime;

  return {
    id: budget.id,
    remaining: budget.maxRetries - budget.usedRetries,
    total: budget.maxRetries,
    used: budget.usedRetries,
    retriedDomains: Array.from(budget.retriedDomains),
    elapsedMs: elapsed,
    timeoutMs: budget.timeoutMs,
    history: budget.history
  };
}

/**
 * Log retry budget exhaustion.
 *
 * @param {Object} budget - Retry budget
 * @param {string} context - Context string (e.g., domain, operation)
 */
export function logRetryExhausted(budget, context = '') {
  if (!budget) return;

  logger.warn('RetryBudget', [
    `Retry budget exhausted for: ${context}`,
    `Used: ${budget.usedRetries}/${budget.maxRetries}`,
    `Retried domains: ${Array.from(budget.retriedDomains).join(', ')}`,
    `History: ${JSON.stringify(budget.history)}`
  ].join(' | '));
}
