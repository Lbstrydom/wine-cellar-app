/**
 * @fileoverview Budget tracking for search operations.
 * Limits SERP calls, document fetches, bytes, and wall-clock time.
 * @module services/search/searchBudget
 */

import { SEARCH_BUDGET } from '../../config/scraperConfig.js';

/**
 * Create a new search budget tracker.
 * @returns {Object} Budget tracker with limits from scraperConfig
 */
export function createSearchBudgetTracker() {
  return {
    id: `budget-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    startTime: Date.now(),
    serpCalls: 0,
    documentFetches: 0,
    totalBytes: 0,
    limits: SEARCH_BUDGET
  };
}

/**
 * Check if wall-clock budget has not been exceeded.
 * @param {Object} budget - Budget tracker
 * @returns {boolean} True if still within wall-clock budget
 */
export function hasWallClockBudget(budget) {
  if (!budget) return true;
  return (Date.now() - budget.startTime) <= budget.limits.MAX_WALL_CLOCK_MS;
}

/**
 * Reserve a SERP call from the budget.
 * @param {Object} budget - Budget tracker
 * @returns {boolean} True if call was reserved successfully
 */
export function reserveSerpCall(budget) {
  if (!budget) return true;
  if (!hasWallClockBudget(budget)) return false;
  if (budget.serpCalls >= budget.limits.MAX_SERP_CALLS) return false;
  budget.serpCalls += 1;
  return true;
}

/**
 * Reserve a document fetch from the budget.
 * @param {Object} budget - Budget tracker
 * @returns {boolean} True if fetch was reserved successfully
 */
export function reserveDocumentFetch(budget) {
  if (!budget) return true;
  if (!hasWallClockBudget(budget)) return false;
  if (budget.documentFetches >= budget.limits.MAX_DOCUMENT_FETCHES) return false;
  budget.documentFetches += 1;
  return true;
}

/**
 * Check if byte budget can accommodate more bytes.
 * @param {Object} budget - Budget tracker
 * @param {number} bytes - Number of bytes to check
 * @returns {boolean} True if within byte budget
 */
export function canConsumeBytes(budget, bytes) {
  if (!budget) return true;
  return (budget.totalBytes + bytes) <= budget.limits.MAX_TOTAL_BYTES;
}

/**
 * Record consumed bytes in the budget.
 * @param {Object} budget - Budget tracker
 * @param {number} bytes - Number of bytes consumed
 */
export function recordBytes(budget, bytes) {
  if (!budget) return;
  budget.totalBytes = Math.min(budget.limits.MAX_TOTAL_BYTES, budget.totalBytes + bytes);
}
