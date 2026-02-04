/**
 * @fileoverview SERP client for benchmark fixture capture.
 * Wraps the existing BrightData SERP integration with rate limiting and retry logic.
 *
 * @module tests/benchmark/serpClient
 */

import logger from '../../src/utils/logger.js';

// BrightData API configuration
const BRIGHTDATA_API_URL = 'https://api.brightdata.com/request';

// Default configuration
const DEFAULT_CONFIG = {
  rateLimit: 1000,           // ms between requests (1 req/sec)
  timeout: 15000,            // 15 second timeout
  retries: 2,                // Number of retries on failure
  retryDelay: 2000,          // Delay between retries
  resultsPerPage: 10,        // Number of results to fetch
  locale: { hl: 'en', gl: 'us' }  // Default locale
};

/**
 * Sleep for specified milliseconds.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create abort controller with timeout.
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{ controller: AbortController, cleanup: Function }}
 */
function createTimeoutAbort(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    controller,
    cleanup: () => clearTimeout(timeoutId)
  };
}

/**
 * SERP client for benchmark operations.
 * Provides rate-limited access to Google SERP via BrightData.
 */
export class BenchmarkSerpClient {
  /**
   * Create a new SERP client.
   * @param {Object} [options] - Configuration options
   * @param {number} [options.rateLimit] - Milliseconds between requests
   * @param {number} [options.timeout] - Request timeout in ms
   * @param {number} [options.retries] - Number of retry attempts
   * @param {Object} [options.locale] - Locale settings { hl, gl }
   */
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.lastRequestTime = 0;
    this.requestCount = 0;

    // Get API credentials from environment
    this.apiKey = process.env.BRIGHTDATA_API_KEY;
    this.zone = process.env.BRIGHTDATA_SERP_ZONE;

    if (!this.apiKey || !this.zone) {
      console.warn('⚠️  BRIGHTDATA_API_KEY or BRIGHTDATA_SERP_ZONE not configured');
    }
  }

  /**
   * Check if client is configured.
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.apiKey && this.zone);
  }

  /**
   * Search Google via BrightData SERP API.
   * @param {string} query - Search query
   * @param {Object} [options] - Search options
   * @param {string[]} [options.domains] - Restrict to specific domains
   * @param {Object} [options.locale] - Override locale { hl, gl }
   * @returns {Promise<SerpResponse>}
   */
  async search(query, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('SERP client not configured. Set BRIGHTDATA_API_KEY and BRIGHTDATA_SERP_ZONE.');
    }

    const { domains = [], locale = this.config.locale } = options;

    // Apply rate limiting
    await this.waitForRateLimit();

    // Build query with domain restrictions
    let fullQuery = query;
    if (domains.length > 0 && domains.length <= 10) {
      const siteRestriction = domains.map(d => `site:${d}`).join(' OR ');
      fullQuery = `${query} (${siteRestriction})`;
    }

    // Execute with retries
    let lastError;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const result = await this.executeSearch(fullQuery, locale);
        this.requestCount++;
        return result;
      } catch (error) {
        lastError = error;
        if (attempt < this.config.retries) {
          console.log(`  Retry ${attempt + 1}/${this.config.retries} after ${this.config.retryDelay}ms...`);
          await sleep(this.config.retryDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute a single search request.
   * @param {string} query - Full query string
   * @param {Object} locale - Locale settings
   * @returns {Promise<SerpResponse>}
   */
  async executeSearch(query, locale) {
    const { hl, gl } = locale;
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${this.config.resultsPerPage}&hl=${hl}&gl=${gl}`;

    const { controller, cleanup } = createTimeoutAbort(this.config.timeout);

    try {
      const response = await fetch(BRIGHTDATA_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          zone: this.zone,
          url: googleUrl,
          format: 'json',
          method: 'GET'
        })
      });

      cleanup();

      if (!response.ok) {
        throw new Error(`BrightData API returned ${response.status}`);
      }

      const data = await response.json();

      if (!data.body) {
        throw new Error('No body in SERP response');
      }

      // Parse the SERP body
      const body = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;

      // Transform to standardized format
      return this.transformResponse(body, query);

    } catch (error) {
      cleanup();
      const errorMsg = error.name === 'AbortError' ? 'Request timeout' : error.message;
      throw new Error(`SERP search failed: ${errorMsg}`);
    }
  }

  /**
   * Transform BrightData response to standardized format.
   * @param {Object} body - Raw SERP body
   * @param {string} query - Original query
   * @returns {SerpResponse}
   */
  transformResponse(body, query) {
    const organic = body.organic || [];

    return {
      query,
      timestamp: new Date().toISOString(),
      totalResults: body.search_information?.total_results || organic.length,
      organic: organic.map((item, index) => ({
        position: index + 1,
        title: item.title || '',
        link: item.link || item.url || '',
        url: item.link || item.url || '',
        snippet: (item.description || item.snippet || '').replace(/Read more$/, '').trim(),
        source: this.extractDomain(item.link || item.url || '')
      })),
      // Include raw data for debugging
      _raw: {
        searchInformation: body.search_information,
        knowledgeGraph: body.knowledge_graph,
        featuredSnippet: body.featured_snippet,
        aiOverview: body.ai_overview
      }
    };
  }

  /**
   * Extract domain from URL.
   * @param {string} url - Full URL
   * @returns {string} Domain name
   */
  extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * Wait for rate limit.
   */
  async waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const wait = this.config.rateLimit - elapsed;

    if (wait > 0) {
      await sleep(wait);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Get request statistics.
   * @returns {Object}
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      rateLimit: this.config.rateLimit,
      configured: this.isConfigured()
    };
  }
}

/**
 * Create a mock SERP client for testing.
 * Returns empty results for all queries.
 * @returns {BenchmarkSerpClient}
 */
export function createMockSerpClient() {
  return {
    search: async (query) => ({
      query,
      timestamp: new Date().toISOString(),
      totalResults: 0,
      organic: [],
      _mock: true
    }),
    isConfigured: () => true,
    getStats: () => ({ requestCount: 0, rateLimit: 0, configured: true, mock: true })
  };
}

/**
 * Create a SERP client from fixtures.
 * Uses pre-recorded fixtures instead of live API.
 * @param {Object} fixtureMap - Map of query -> SerpResponse
 * @returns {Object}
 */
export function createFixtureSerpClient(fixtureMap) {
  let requestCount = 0;

  return {
    search: async (query) => {
      requestCount++;
      const fixture = fixtureMap[query];
      if (!fixture) {
        throw new Error(`No fixture found for query: ${query}`);
      }
      return fixture;
    },
    isConfigured: () => true,
    getStats: () => ({ requestCount, rateLimit: 0, configured: true, fixture: true })
  };
}

export default BenchmarkSerpClient;
