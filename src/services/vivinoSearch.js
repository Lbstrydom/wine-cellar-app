/**
 * @fileoverview Vivino wine search service.
 * Uses Google search (via Bright Data SERP API) to find Vivino wine pages,
 * then uses Puppeteer to scrape individual pages (faster than Web Unlocker).
 * @module services/vivinoSearch
 */

import logger from '../utils/logger.js';
import { scrapeVivinoPage } from './puppeteerScraper.js';
import { TIMEOUTS, GRAPE_KEYWORDS } from '../config/scraperConfig.js';

const BRIGHTDATA_SERP_URL = 'https://api.brightdata.com/serp/req';
const BRIGHTDATA_API_URL = 'https://api.brightdata.com/request';

// ============================================================================
// HELPER FUNCTIONS (DRY - extracted common patterns)
// ============================================================================

/**
 * Transform raw scraped wine data to standard format.
 * @param {Object} rawData - Raw wine data from scraper
 * @param {Object} options - Additional options
 * @param {number} [options.vivinoId] - Override Vivino ID
 * @param {number} [options.vintage] - Fallback vintage
 * @param {string} [options.wineUrl] - Fallback URL
 * @returns {Object} Normalized wine object
 */
function normalizeWineData(rawData, options = {}) {
  const {
    vivinoId = null,
    vintage = null,
    wineUrl = null
  } = options;

  return {
    vivinoId: rawData.vivinoId || vivinoId,
    vintageId: null,
    name: rawData.wineName || '',
    vintage: extractVintageFromName(rawData.wineName) || vintage || null,
    winery: {
      id: null,
      name: rawData.winery || extractWineryFromName(rawData.wineName) || ''
    },
    rating: rawData.rating || null,
    ratingCount: rawData.ratingCount || null,
    region: rawData.region || '',
    country: rawData.country || '',
    grapeVariety: rawData.grape || '',
    wineType: 'unknown',
    imageUrl: rawData.imageUrl || null,
    price: rawData.price || null,
    currency: null,
    vivinoUrl: rawData.url || wineUrl
  };
}

/**
 * Create a timeout with AbortController.
 * @param {number} ms - Timeout in milliseconds
 * @returns {{controller: AbortController, cleanup: Function}} Controller and cleanup function
 */
function createTimeoutAbort(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    controller,
    cleanup: () => clearTimeout(timeoutId)
  };
}

/**
 * Search Vivino for wines matching the given criteria.
 * Strategy: Use Google SERP to find Vivino wine pages, then use Puppeteer
 * to scrape individual pages (avoids Vivino's headless browser blocking on search).
 * @param {Object} params - Search parameters
 * @param {string} params.query - Wine name to search
 * @param {string} [params.producer] - Producer/winery name
 * @param {number} [params.vintage] - Year
 * @returns {Promise<{matches: Array, error: string|null}>}
 */
export async function searchVivinoWines({ query, producer, vintage }) {
  const bdApiKey = process.env.BRIGHTDATA_API_KEY;
  const bdSerpZone = process.env.BRIGHTDATA_SERP_ZONE;
  const bdWebZone = process.env.BRIGHTDATA_WEB_ZONE;

  if (!bdApiKey) {
    logger.warn('VivinoSearch', 'Bright Data API key not configured');
    return { matches: [], error: 'Search service not configured' };
  }

  // Build search query
  let searchQuery = query?.trim() || '';
  if (!searchQuery && producer) {
    searchQuery = producer.trim();
  }

  if (!searchQuery) {
    return { matches: [], error: 'No search query provided' };
  }

  // Simplify very long names
  const words = searchQuery.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 5) {
    searchQuery = words.slice(0, 5).join(' ');
  }

  logger.info('VivinoSearch', `Searching: "${searchQuery}"${vintage ? ` (${vintage})` : ''}`);

  try {
    // Step 1: Use Google SERP to find Vivino wine pages
    const vivinoUrls = await searchGoogleForVivino(searchQuery, vintage, bdApiKey, bdSerpZone, bdWebZone);

    if (vivinoUrls.length === 0) {
      logger.info('VivinoSearch', 'No Vivino URLs found in search results');
      return { matches: [], error: null };
    }

    logger.info('VivinoSearch', `Found ${vivinoUrls.length} Vivino URLs, fetching details via Puppeteer...`);

    // Step 2: Use Puppeteer to scrape top wine pages (faster than Web Unlocker)
    const matches = [];
    for (const url of vivinoUrls.slice(0, 3)) {
      try {
        const wine = await scrapeVivinoPage(url);
        if (wine) {
          matches.push(normalizeWineData(wine, { vintage, wineUrl: url }));
        }
      } catch (err) {
        logger.warn('VivinoSearch', `Failed to scrape ${url}: ${err.message}`);
      }
    }

    // Sort by vintage relevance
    const sortedMatches = sortByVintageRelevance(matches, vintage);
    logger.info('VivinoSearch', `Found ${sortedMatches.length} wine matches`);

    return { matches: sortedMatches, error: null };

  } catch (error) {
    const errorMsg = error.name === 'AbortError' ? 'Request timeout' : error.message;
    logger.error('VivinoSearch', `Search failed: ${errorMsg}`);
    return { matches: [], error: errorMsg };
  }
}

/**
 * Search Google for Vivino wine pages using SERP API or Web Unlocker.
 * @param {string} query - Search query
 * @param {number} vintage - Year
 * @param {string} apiKey - Bright Data API key
 * @param {string} serpZone - SERP zone name
 * @param {string} webZone - Web Unlocker zone name
 * @returns {Promise<string[]>} Array of Vivino URLs
 */
async function searchGoogleForVivino(query, vintage, apiKey, serpZone, webZone) {
  // Build Google search query targeting Vivino wine pages
  const googleQuery = `site:vivino.com ${query} ${vintage || ''} wine`.trim();

  logger.info('VivinoSearch', `Google query: "${googleQuery}"`);

  try {
    const { controller, cleanup } = createTimeoutAbort(TIMEOUTS.SERP_API_TIMEOUT);

    // Use SERP API if zone is configured, otherwise fall back to Web Unlocker
    let response;
    if (serpZone) {
      response = await fetch(BRIGHTDATA_SERP_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          zone: serpZone,
          query: googleQuery,
          country: 'us',
          search_engine: 'google'
        })
      });
    } else if (webZone) {
      // Fall back to direct Google search via Web Unlocker
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&num=10`;
      response = await fetch(BRIGHTDATA_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          zone: webZone,
          url: googleUrl,
          format: 'raw'
        })
      });
    } else {
      logger.warn('VivinoSearch', 'No SERP or Web Unlocker zone configured');
      return [];
    }

    cleanup();

    if (!response.ok) {
      logger.error('VivinoSearch', `SERP API returned ${response.status}`);
      return [];
    }

    const data = await response.json().catch(() => null);
    const text = data ? null : await response.text();

    // Extract Vivino URLs from results
    const vivinoUrls = [];

    if (data?.organic) {
      // SERP API JSON response
      for (const result of data.organic) {
        const url = result.url || result.link;
        if (url?.includes('vivino.com/') && url.includes('/w/')) {
          vivinoUrls.push(url);
        }
      }
    } else if (text) {
      // HTML response - extract URLs
      const urlPattern = /https?:\/\/(?:www\.)?vivino\.com\/[^"'\s]*\/w\/\d+[^"'\s]*/gi;
      const matches = text.match(urlPattern) || [];
      vivinoUrls.push(...new Set(matches));
    }

    return vivinoUrls;

  } catch (error) {
    logger.error('VivinoSearch', `SERP search failed: ${error.message}`);
    return [];
  }
}

/**
 * Get detailed wine info by Vivino wine ID.
 * Uses Puppeteer to scrape the wine page.
 * @param {number} wineId - Vivino wine ID
 * @returns {Promise<Object|null>} Wine details or null
 */
export async function getVivinoWineDetails(wineId) {
  const wineUrl = `https://www.vivino.com/w/${wineId}`;
  logger.info('VivinoSearch', `Fetching details for wine ID: ${wineId}`);

  try {
    const wineData = await scrapeVivinoPage(wineUrl);

    if (!wineData) {
      return null;
    }

    const result = normalizeWineData(wineData, { vivinoId: wineId, wineUrl });

    logger.info('VivinoSearch', `Got details: ${result.name} (${result.rating}★)`);
    return result;

  } catch (error) {
    logger.error('VivinoSearch', `Details fetch failed: ${error.message}`);
    return null;
  }
}

/**
 * Extract vintage year from wine name.
 * @param {string} name - Wine name
 * @returns {number|null} Vintage year or null
 */
function extractVintageFromName(name) {
  if (!name) return null;
  const match = name.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Extract winery name from wine name (first 1-2 words before grape variety).
 * @param {string} name - Wine name
 * @returns {string} Winery name
 */
function extractWineryFromName(name) {
  if (!name) return '';

  const words = name.split(/\s+/);
  const wineryWords = [];

  for (const word of words) {
    const lower = word.toLowerCase();
    if (GRAPE_KEYWORDS.some(g => lower.includes(g))) break;
    if (/^\d{4}$/.test(word)) break; // Stop at vintage
    wineryWords.push(word);
    if (wineryWords.length >= 2) break;
  }

  return wineryWords.join(' ');
}

/**
 * Sort wines by relevance to requested vintage.
 * @param {Array} wines - Wine matches
 * @param {number} [preferredVintage] - Vintage to prioritize
 * @returns {Array} Sorted wines
 */
function sortByVintageRelevance(wines, preferredVintage) {
  if (!preferredVintage) return wines;

  return [...wines].sort((a, b) => {
    // Exact vintage match gets priority
    const aMatch = a.vintage === preferredVintage;
    const bMatch = b.vintage === preferredVintage;
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;

    // Then by rating count (more ratings = more reliable)
    const aCount = a.ratingCount || 0;
    const bCount = b.ratingCount || 0;
    return bCount - aCount;
  });
}

export default {
  searchVivinoWines,
  getVivinoWineDetails
};
