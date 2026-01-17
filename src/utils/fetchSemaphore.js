/**
 * @fileoverview Global semaphore for controlling concurrent HTTP fetches.
 * Prevents resource exhaustion from parallel scraping operations.
 * @module utils/fetchSemaphore
 */

import { LIMITS } from '../config/scraperConfig.js';
import logger from './logger.js';

/**
 * Semaphore for limiting concurrent operations.
 * Uses a queue-based approach with FIFO scheduling.
 */
class FetchSemaphore {
  /**
   * @param {number} maxConcurrent - Maximum number of concurrent operations
   */
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.currentCount = 0;
    this.queue = [];
    this.stats = {
      totalAcquired: 0,
      totalReleased: 0,
      peakConcurrent: 0,
      totalWaitTime: 0,
      queuedCount: 0
    };
  }

  /**
   * Acquire a semaphore slot. Waits if at capacity.
   * @returns {Promise<void>}
   */
  async acquire() {
    const startWait = Date.now();
    
    // If under capacity, acquire immediately
    if (this.currentCount < this.maxConcurrent) {
      this.currentCount++;
      this.stats.totalAcquired++;
      this.stats.peakConcurrent = Math.max(this.stats.peakConcurrent, this.currentCount);
      return;
    }

    // Otherwise, queue and wait
    this.stats.queuedCount++;
    logger.debug('Semaphore', `Fetch queued (${this.queue.length + 1} waiting, ${this.currentCount}/${this.maxConcurrent} active)`);

    await new Promise((resolve) => {
      this.queue.push(resolve);
    });

    this.currentCount++;
    this.stats.totalAcquired++;
    this.stats.peakConcurrent = Math.max(this.stats.peakConcurrent, this.currentCount);
    this.stats.totalWaitTime += Date.now() - startWait;
  }

  /**
   * Release a semaphore slot. Resolves next queued operation if any.
   */
  release() {
    this.currentCount--;
    this.stats.totalReleased++;

    // If queue has waiting operations, resolve the next one
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      resolve();
    }
  }

  /**
   * Execute a function with semaphore protection.
   * Automatically acquires before execution and releases after completion.
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of the function
   */
  async withSemaphore(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current semaphore statistics.
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      currentActive: this.currentCount,
      currentQueued: this.queue.length,
      avgWaitTime: this.stats.queuedCount > 0 
        ? Math.round(this.stats.totalWaitTime / this.stats.queuedCount) 
        : 0
    };
  }

  /**
   * Reset statistics (useful for testing).
   */
  resetStats() {
    this.stats = {
      totalAcquired: 0,
      totalReleased: 0,
      peakConcurrent: 0,
      totalWaitTime: 0,
      queuedCount: 0
    };
  }
}

/**
 * Global semaphore instance for all HTTP fetches.
 * Limits concurrent external requests to prevent resource exhaustion.
 */
export const globalFetchSemaphore = new FetchSemaphore(LIMITS.MAX_CONCURRENT_FETCHES);

/**
 * Wrap a fetch call with semaphore protection.
 * @param {string|URL} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function semaphoredFetch(url, options = {}) {
  return await globalFetchSemaphore.withSemaphore(async () => {
    logger.debug('Semaphore', `Fetching: ${url.toString().substring(0, 80)}...`);
    return await fetch(url, options);
  });
}

export default globalFetchSemaphore;
