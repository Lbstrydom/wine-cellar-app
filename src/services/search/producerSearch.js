/**
 * @fileoverview Producer-specific search logic.
 * Searches for producer official websites and award documents.
 * @module services/search/producerSearch
 */

import logger from '../../utils/logger.js';
import { searchGoogle } from './searchGoogle.js';
import { extractSearchTokens, extractProducerName } from '../wine/nameProcessing.js';
import { checkIfProducerSite } from './relevanceScoring.js';

/**
 * Search for producer's official website and awards page.
 * Includes searches for PDF/DOC award documents - producers often publish award lists as documents.
 * Respects AbortController signal for cancellation.
 * @param {string} wineName - Wine name
 * @param {string} vintage - Vintage year
 * @param {string|null} country - Wine country
 * @param {Object} budget - Per-search budget tracker
 * @param {AbortSignal} signal - Optional abort signal for cancellation
 * @returns {Promise<Object[]>} Array of search results
 */
export async function searchProducerWebsite(wineName, vintage, _country, budget = null, signal = null) {
  if (signal?.aborted) {
    logger.info('Producer', 'Producer search aborted');
    return [];
  }

  const producerName = extractProducerName(wineName);
  if (!producerName || producerName.length < 3) {
    return [];
  }

  logger.info('Producer', `Extracted producer name: "${producerName}" from "${wineName}"`);

  const producerTokens = extractSearchTokens(producerName);

  // Try different queries to find producer's awards page
  const queries = [
    // Standard web searches
    `"${producerName}" winery official site awards`,
    `${producerTokens.join(' ')} wine estate awards medals`,
    // Document searches
    `"${producerName}" awards filetype:pdf`,
    `"${producerName}" awards filetype:doc`,
    `"${producerName}" medals accolades filetype:pdf`
  ];

  const results = [];

  // Run web searches and document searches with a limit
  for (const query of queries.slice(0, 4)) {
    if (signal?.aborted) {
      logger.info('Producer', 'Producer search aborted mid-loop');
      break;
    }

    logger.info('Producer', `Search query: "${query}"`);

    try {
      const isDocumentQuery = query.includes('filetype:');
      const queryType = isDocumentQuery ? 'serp_producer_document' : 'serp_producer';
      const searchResults = await searchGoogle(query, [], queryType, budget);

      const filteredResults = searchResults.filter(r => {
        if (isDocumentQuery) {
          const urlLower = (r.url || '').toLowerCase();
          const titleLower = (r.title || '').toLowerCase();
          const producerLower = producerName.toLowerCase();
          return urlLower.includes(producerLower.replace(/\s+/g, '')) ||
                 titleLower.includes(producerLower) ||
                 producerTokens.some(t => titleLower.includes(t.toLowerCase()));
        }
        const tokens = extractSearchTokens(producerName);
        return checkIfProducerSite(r.url, producerName.toLowerCase(), tokens);
      });

      if (filteredResults.length > 0) {
        logger.info('Producer', `Found ${filteredResults.length} result(s) for "${query.substring(0, 50)}..."`);
        results.push(...filteredResults.map(r => {
          const isDocument = /\.(pdf|doc|docx|xls|xlsx)(\?|$)/i.test(r.url);
          return {
            ...r,
            sourceId: isDocument ? 'producer_document' : 'producer_website',
            lens: 'producer',
            credibility: isDocument ? 1.4 : 1.2,
            relevance: 1.0,
            isProducerSite: true,
            isDocument
          };
        }));
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.info('Producer', 'Search aborted');
        break;
      }
      logger.error('Producer', `Search failed: ${err.message}`);
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  const uniqueResults = results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  logger.info('Producer', `Total unique producer results: ${uniqueResults.length}`);
  return uniqueResults;
}
