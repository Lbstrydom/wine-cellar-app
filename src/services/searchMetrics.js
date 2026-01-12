/**
 * @fileoverview Search metrics collection and analysis for wine search operations.
 * Tracks cost, success rate, and performance metrics across all search phases.
 * @module services/searchMetrics
 */

/**
 * Collects and aggregates metrics from search operations
 */
export class SearchMetricsCollector {
  constructor() {
    this.metrics = {
      serpCalls: 0,
      unlockerCalls: 0,
      claudeExtractions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitsByLens: {},     // { competition: { hits: 5, misses: 2 }, ... }
      hitsByDomain: {},   // { 'vivino.com': { hits: 10, blocked: 2 }, ... }
      costEstimate: 0,    // Running cost estimate in cents
      startTime: Date.now(),
      endTime: null
    };
  }

  /**
   * Record a SERP call
   * @param {string} query - The search query
   * @param {number} resultCount - Number of results returned
   * @param {string} [domain] - Domain searched (optional)
   * @param {number} [costCents=0.5] - Cost in cents
   */
  recordSerpCall(query, resultCount, domain = null, costCents = 0.5) {
    this.metrics.serpCalls++;
    this.metrics.costEstimate += costCents;
    
    if (domain) {
      if (!this.metrics.hitsByDomain[domain]) {
        this.metrics.hitsByDomain[domain] = { calls: 0, hits: 0, blocked: 0 };
      }
      this.metrics.hitsByDomain[domain].calls++;
      
      if (resultCount > 0) {
        this.metrics.hitsByDomain[domain].hits++;
      } else if (resultCount === -1) {
        // -1 indicates blocked/no results
        this.metrics.hitsByDomain[domain].blocked++;
      }
    }
  }

  /**
   * Record an unlocker call
   * @param {string} domain - Domain being unblocked
   * @param {boolean} success - Whether unlocker succeeded
   * @param {number} [costCents=2] - Cost in cents
   */
  recordUnlockerCall(domain, success, costCents = 2) {
    this.metrics.unlockerCalls++;
    this.metrics.costEstimate += costCents;
    
    if (domain) {
      if (!this.metrics.hitsByDomain[domain]) {
        this.metrics.hitsByDomain[domain] = { calls: 0, hits: 0, blocked: 0 };
      }
      
      if (success) {
        this.metrics.hitsByDomain[domain].hits++;
      } else {
        this.metrics.hitsByDomain[domain].blocked++;
      }
    }
  }

  /**
   * Record a Claude extraction call
   * @param {string} lens - The search lens/category (e.g., 'competition', 'critic')
   * @param {number} sourceCount - Number of sources provided to Claude
   * @param {number} tokensUsed - Tokens used in the extraction
   * @param {number} [costCents=5] - Cost in cents
   */
  recordClaudeExtraction(lens, sourceCount, tokensUsed, costCents = 5) {
    this.metrics.claudeExtractions++;
    this.metrics.costEstimate += costCents;
    
    if (!this.metrics.hitsByLens[lens]) {
      this.metrics.hitsByLens[lens] = { extractions: 0, totalTokens: 0 };
    }
    
    this.metrics.hitsByLens[lens].extractions++;
    this.metrics.hitsByLens[lens].totalTokens += tokensUsed;
  }

  /**
   * Record a cache hit
   * @param {string} _type - Type of cache (reserved for future use)
   */
  recordCacheHit(_type = 'general') {
    this.metrics.cacheHits++;
  }

  /**
   * Record a cache miss
   * @param {string} _type - Type of cache (reserved for future use)
   */
  recordCacheMiss(_type = 'general') {
    this.metrics.cacheMisses++;
  }

  /**
   * Record successful result finding for a lens
   * @param {string} lens - The search lens/category
   * @param {boolean} found - Whether result was found
   */
  recordLensResult(lens, found) {
    if (!this.metrics.hitsByLens[lens]) {
      this.metrics.hitsByLens[lens] = { hits: 0, misses: 0 };
    }
    
    if (found) {
      this.metrics.hitsByLens[lens].hits = (this.metrics.hitsByLens[lens].hits || 0) + 1;
    } else {
      this.metrics.hitsByLens[lens].misses = (this.metrics.hitsByLens[lens].misses || 0) + 1;
    }
  }

  /**
   * Finalize metrics and calculate summary
   * @returns {Object} Complete metrics summary
   */
  getSummary() {
    this.metrics.endTime = Date.now();
    const duration = this.metrics.endTime - this.metrics.startTime;
    
    const totalCacheChecks = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = totalCacheChecks > 0 
      ? (this.metrics.cacheHits / totalCacheChecks) 
      : 0;

    // Calculate domain stats
    const domainStats = Object.entries(this.metrics.hitsByDomain).reduce((acc, [domain, stats]) => {
      acc[domain] = {
        ...stats,
        hitRate: stats.calls > 0 ? (stats.hits / stats.calls) : 0
      };
      return acc;
    }, {});

    // Calculate lens stats
    const lensStats = Object.entries(this.metrics.hitsByLens).reduce((acc, [lens, stats]) => {
      const total = (stats.hits || 0) + (stats.misses || 0);
      acc[lens] = {
        ...stats,
        hitRate: total > 0 ? ((stats.hits || 0) / total) : 0,
        avgTokensPerExtraction: (stats.extractions || 0) > 0 
          ? (stats.totalTokens / stats.extractions) 
          : 0
      };
      return acc;
    }, {});

    return {
      summary: {
        totalDuration: duration,
        totalCost: `$${(this.metrics.costEstimate / 100).toFixed(2)}`,
        costCents: this.metrics.costEstimate
      },
      apiCalls: {
        serpCalls: this.metrics.serpCalls,
        unlockerCalls: this.metrics.unlockerCalls,
        claudeExtractions: this.metrics.claudeExtractions
      },
      cache: {
        hits: this.metrics.cacheHits,
        misses: this.metrics.cacheMisses,
        hitRate: cacheHitRate.toFixed(3)
      },
      byDomain: domainStats,
      byLens: lensStats,
      costBreakdown: {
        serp: this.metrics.serpCalls * 0.5,
        unlocker: this.metrics.unlockerCalls * 2,
        claude: this.metrics.claudeExtractions * 5
      }
    };
  }

  /**
   * Get current metrics without finalizing
   * @returns {Object} Current metrics
   */
  getCurrent() {
    return structuredClone(this.metrics);
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      serpCalls: 0,
      unlockerCalls: 0,
      claudeExtractions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitsByLens: {},
      hitsByDomain: {},
      costEstimate: 0,
      startTime: Date.now(),
      endTime: null
    };
  }

  /**
   * Export metrics as JSON for dashboard/persistence
   * @returns {string} JSON representation
   */
  toJSON() {
    return JSON.stringify(this.getSummary(), null, 2);
  }

  /**
   * Format metrics for logging
   * @returns {string} Formatted summary
   */
  toString() {
    const summary = this.getSummary();
    return `
Search Metrics Summary
======================
Duration: ${summary.summary.totalDuration}ms
Total Cost: ${summary.summary.totalCost}
API Calls: ${summary.apiCalls.serpCalls} SERP, ${summary.apiCalls.unlockerCalls} Unlocker, ${summary.apiCalls.claudeExtractions} Claude
Cache Hit Rate: ${(Number.parseFloat(summary.cache.hitRate) * 100).toFixed(1)}%
    `;
  }
}

export default SearchMetricsCollector;
