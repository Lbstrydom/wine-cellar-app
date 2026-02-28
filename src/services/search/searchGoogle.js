/**
 * @fileoverview Google SERP API integration via Bright Data.
 * @module services/search/searchGoogle
 */

import logger from '../../utils/logger.js';
import { createRequestDeduper } from '../../utils/requestDedup.js';
import { extractDomain } from '../../utils/url.js';
import {
  getCachedSerpResults, cacheSerpResults
} from '../shared/cacheService.js';
import { TIMEOUTS } from '../../config/scraperConfig.js';
import { BRIGHTDATA_API_URL } from './searchConstants.js';
import { hasWallClockBudget, reserveSerpCall } from './searchBudget.js';
import { createTimeoutAbort } from '../shared/fetchUtils.js';

const serpRequestDeduper = createRequestDeduper();

/**
 * Search using Bright Data SERP API.
 * Uses caching to avoid redundant API calls.
 * @param {string} query - Search query
 * @param {string[]} domains - Domains to restrict search to
 * @param {string} queryType - Type of query for cache categorization
 * @param {Object} budget - Budget tracker
 * @param {Object} localeOptions - Locale options { hl, gl }
 * @returns {Promise<Object[]>} Search results
 */
export async function searchGoogle(query, domains = [], queryType = 'serp_broad', budget = null, localeOptions = {}) {
  const domainList = [...domains].sort();
  const { hl = 'en', gl = 'us' } = localeOptions; // Extract locale params
  const dedupeKey = `${budget?.id || 'global'}|${queryType}|${query}|${domainList.join(',')}|${hl}-${gl}`;

  return serpRequestDeduper.run(dedupeKey, async () => {
    if (budget && !hasWallClockBudget(budget)) {
      logger.warn('Budget', 'Wall-clock budget exceeded before SERP call');
      return [];
    }

    const queryParams = { query, domains: domainList, hl, gl };

    // Check cache first
    try {
      const cached = await getCachedSerpResults(queryParams);
      if (cached) {
        logger.info('Cache', `SERP HIT: ${query.substring(0, 50)}... (${hl}/${gl})`);
        return cached.results;
      }
    } catch (err) {
      logger.warn('Cache', `SERP lookup failed: ${err.message}`);
    }

    if (budget && !reserveSerpCall(budget)) {
      logger.warn('Budget', 'SERP call limit reached, skipping query');
      return [];
    }

    const brightDataApiKey = process.env.BRIGHTDATA_API_KEY;
    const serpZone = process.env.BRIGHTDATA_SERP_ZONE;

    if (!brightDataApiKey || !serpZone) {
      logger.warn('Search', 'No search API configured (need BRIGHTDATA_API_KEY + BRIGHTDATA_SERP_ZONE)');
      return [];
    }

    let results = await searchBrightDataSerp(query, domainList, { hl, gl });

    // Cache results
    try {
      if (results.length > 0) {
        await cacheSerpResults(queryParams, queryType, results);
      }
    } catch (err) {
      logger.warn('Cache', `SERP cache write failed: ${err.message}`);
    }

    // Query operator fallback: If results are empty and query has operators, try without operators
    if (results.length === 0 && (query.includes('filetype:') || query.includes('inurl:') || query.includes('"'))) {
      logger.info('Search', `Zero results for operator-based query; trying fallback without operators`);

      // Remove operators and retry
      const simplifiedQuery = query
        .replace(/filetype:\S+/g, '') // Remove filetype operators
        .replace(/inurl:\S+/g, '') // Remove inurl operators
        .replace(/"([^"]*)"/g, '$1') // Convert exact phrases to plain text
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();

      if (simplifiedQuery !== query) {
        logger.info('Search', `Fallback query: "${simplifiedQuery}"`);

        try {
          const fallbackResults = await searchGoogle(simplifiedQuery, domains, queryType, budget, localeOptions);
          if (fallbackResults.length > 0) {
            results = fallbackResults;
            logger.info('Search', `Fallback successful: found ${results.length} results`);
          }
        } catch (err) {
          logger.warn('Search', `Fallback query failed: ${err.message}`);
        }
      }
    }

    // Brave Search fallback (FUTURE): Track zero-result rate across all searches
    // If zero-result rate > 10% on any queryType, conditionally enable Brave Search API
    // as secondary fallback source for increased coverage.
    // This requires BRAVE_SEARCH_API_KEY and optional Brave subscription.
    // Implementation: Track zeroResults counter, check rate, call searchBrave() if enabled.

    return results;
  });
}

/**
 * Search using Bright Data SERP API.
 * Returns structured Google search results via Bright Data's proxy infrastructure.
 * @param {string} query - Search query
 * @param {string[]} domains - Domains to restrict search to
 * @param {Object} localeOptions - Locale options { hl, gl }
 * @returns {Promise<Object[]>} Search results
 */
async function searchBrightDataSerp(query, domains = [], localeOptions = {}) {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const zone = process.env.BRIGHTDATA_SERP_ZONE;
  const { hl = 'en', gl = 'us' } = localeOptions;

  let fullQuery = query;
  if (domains.length > 0 && domains.length <= 10) {
    const siteRestriction = domains.map(d => `site:${d}`).join(' OR ');
    fullQuery = `${query} (${siteRestriction})`;
  }

  // Build Google search URL with locale parameters
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}&num=10&hl=${hl}&gl=${gl}`;

  logger.info('SERP', `Searching: "${query}" across ${domains.length} domains (${hl}/${gl})`);

  const { controller, cleanup } = createTimeoutAbort(TIMEOUTS.WEB_UNLOCKER_TIMEOUT);

  try {
    const response = await fetch(BRIGHTDATA_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        zone: zone,
        url: googleUrl,
        format: 'json',
        method: 'GET'
      })
    });

    cleanup();

    if (!response.ok) {
      logger.error('SERP', `API returned ${response.status}`);
      return [];
    }

    const data = await response.json();

    // SERP API returns {status_code, headers, body} where body is a JSON string
    if (!data.body) {
      logger.error('SERP', 'No body in response');
      return [];
    }

    const body = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
    const organic = body.organic || [];

    const results = organic.map(item => ({
      title: item.title || '',
      url: item.link || item.url || '',
      snippet: (item.description || item.snippet || '').replace(/Read more$/, '').trim(),
      source: extractDomain(item.link || item.url || '')
    }));

    logger.info('SERP', `Found ${results.length} results`);
    return results;

  } catch (error) {
    cleanup();
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    logger.error('SERP', `Search failed: ${errorMsg}`);
    return [];
  }
}
