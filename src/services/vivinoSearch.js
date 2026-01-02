/**
 * @fileoverview Vivino wine search service.
 * Uses Google search (via Bright Data SERP API) to find Vivino wine pages,
 * then uses Web Unlocker to scrape individual pages (works in Docker).
 * Falls back to Puppeteer for local development if Web Unlocker fails.
 * @module services/vivinoSearch
 */

import logger from '../utils/logger.js';
import { scrapeVivinoPage } from './puppeteerScraper.js';
import { TIMEOUTS, GRAPE_KEYWORDS } from '../config/scraperConfig.js';

const BRIGHTDATA_API_URL = 'https://api.brightdata.com/request';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Decode HTML entities in a string.
 * @param {string} str - String with HTML entities
 * @returns {string} Decoded string
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

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

  // Decode HTML entities in text fields
  const wineName = decodeHtmlEntities(rawData.wineName) || '';
  const winery = decodeHtmlEntities(rawData.winery) || extractWineryFromName(wineName) || '';
  const region = decodeHtmlEntities(rawData.region) || '';
  const grape = decodeHtmlEntities(rawData.grape) || '';

  return {
    vivinoId: rawData.vivinoId || vivinoId,
    vintageId: null,
    name: wineName,
    vintage: extractVintageFromName(wineName) || vintage || null,
    winery: {
      id: null,
      name: winery
    },
    rating: rawData.rating || null,
    ratingCount: rawData.ratingCount || null,
    region: region,
    country: rawData.country || '',
    grapeVariety: grape,
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
 * Extract wine data from Vivino HTML using regex patterns.
 * Works with Web Unlocker responses where __NEXT_DATA__ may not be present.
 * @param {string} html - HTML content
 * @param {string} url - Original URL (for extracting wine ID)
 * @returns {Object|null} Extracted wine data or null
 */
function extractWineDataFromHtml(html, url) {
  // Try __NEXT_DATA__ first (if page was server-rendered)
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const pageProps = nextData?.props?.pageProps;
      const wineData = pageProps?.vintage || pageProps?.wine;

      if (wineData) {
        return {
          wineName: wineData.wine?.name || wineData.name,
          rating: wineData.statistics?.ratings_average || wineData.statistics?.wine_ratings_average,
          ratingCount: wineData.statistics?.ratings_count || wineData.statistics?.wine_ratings_count,
          winery: wineData.wine?.winery?.name || wineData.winery?.name,
          region: wineData.wine?.region?.name || wineData.region?.name,
          country: wineData.wine?.region?.country?.name || wineData.region?.country?.name,
          grape: wineData.wine?.grapes?.map(g => g.name).join(', ') || '',
          vivinoId: wineData.wine?.id || wineData.id,
          imageUrl: wineData.image?.location,
          url
        };
      }
    } catch {
      // Fall through to regex extraction
    }
  }

  // Regex fallback for client-rendered pages
  const ratingMatch = html.match(/averageValue[^>]*>([0-9.]+)</);
  const ratingCountMatch = html.match(/(\d[\d,]*)\s*ratings/i);
  const countMatch2 = html.match(/caption[^>]*>([0-9,]+)\s*ratings/i);
  const ratingCount = ratingCountMatch?.[1] || countMatch2?.[1];

  // Winery patterns
  const wineryMatch = html.match(/wineries\/[^"]*"[^>]*>([^<]+)</i) ||
                      html.match(/"winery"[^}]*"name"\s*:\s*"([^"]+)"/);

  // Region patterns
  const regionMatch = html.match(/wine-regions\/[^"]*"[^>]*>([^<]+)</i) ||
                      html.match(/"region"[^}]*"name"\s*:\s*"([^"]+)"/);

  // Grape patterns
  const grapeMatch = html.match(/grapes\/[^"]*"[^>]*>([^<]+)</i) ||
                     html.match(/"grape[^"]*"[^}]*"name"\s*:\s*"([^"]+)"/);

  // Title/name patterns
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const h1Match = html.match(/<h1[^>]*>([^<]+)</);

  // Extract wine ID from URL
  const idMatch = url.match(/\/w\/(\d+)/);
  const vivinoId = idMatch ? parseInt(idMatch[1], 10) : null;

  // Check for JSON-LD structured data
  let jsonLdRating = null;
  let jsonLdCount = null;
  let jsonLdWinery = null;
  let jsonLdName = null;

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  if (jsonLdMatch) {
    try {
      const jsonLd = JSON.parse(jsonLdMatch[1]);
      if (jsonLd.aggregateRating) {
        jsonLdRating = parseFloat(jsonLd.aggregateRating.ratingValue);
        jsonLdCount = parseInt(jsonLd.aggregateRating.ratingCount);
      }
      if (jsonLd.brand?.name) jsonLdWinery = jsonLd.brand.name;
      if (jsonLd.name) jsonLdName = jsonLd.name;
    } catch {
      // Ignore JSON-LD parse errors
    }
  }

  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : jsonLdRating;

  // Only return if we found at least a rating
  if (!rating) {
    return null;
  }

  return {
    wineName: h1Match?.[1]?.trim() || titleMatch?.[1]?.split('|')[0]?.trim() || jsonLdName,
    rating,
    ratingCount: ratingCount ? parseInt(ratingCount.replace(/,/g, '')) : jsonLdCount,
    winery: wineryMatch?.[1]?.trim() || jsonLdWinery,
    region: regionMatch?.[1]?.trim(),
    grape: grapeMatch?.[1]?.trim(),
    vivinoId,
    url
  };
}

/**
 * Scrape a Vivino wine page using Web Unlocker.
 * @param {string} url - Vivino wine page URL
 * @param {string} apiKey - Bright Data API key
 * @param {string} webZone - Web Unlocker zone name
 * @returns {Promise<Object|null>} Wine data or null
 */
async function scrapeVivinoWithWebUnlocker(url, apiKey, webZone) {
  logger.info('VivinoSearch', `Fetching via Web Unlocker: ${url}`);

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
        zone: webZone,
        url,
        format: 'raw'
      })
    });

    cleanup();

    if (!response.ok) {
      logger.warn('VivinoSearch', `Web Unlocker returned ${response.status}`);
      return null;
    }

    const html = await response.text();
    logger.info('VivinoSearch', `Got ${html.length} bytes from Web Unlocker`);

    const wineData = extractWineDataFromHtml(html, url);

    if (wineData) {
      logger.info('VivinoSearch', `Web Unlocker extracted: ${wineData.wineName} - ${wineData.rating}★`);
    } else {
      logger.warn('VivinoSearch', 'Web Unlocker: Could not extract wine data from HTML');
    }

    return wineData;

  } catch (error) {
    cleanup();
    if (error.name === 'AbortError') {
      logger.warn('VivinoSearch', 'Web Unlocker request timed out');
    } else {
      logger.warn('VivinoSearch', `Web Unlocker error: ${error.message}`);
    }
    return null;
  }
}

/**
 * Search Vivino for wines matching the given criteria.
 * Strategy:
 * 1. Use Google SERP to find Vivino wine pages
 * 2. Use Web Unlocker to scrape individual pages (works in Docker)
 * 3. Fall back to Puppeteer for local development if Web Unlocker fails
 *
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

  // Sanitize query: remove apostrophes and special chars that cause SERP API issues
  // Replace fancy quotes/apostrophes with nothing, keep accented letters
  searchQuery = searchQuery
    .replace(/[''`]/g, '')        // Remove apostrophes (L'Oratoire → LOratoire)
    .replace(/[""]/g, '')          // Remove fancy quotes
    .replace(/[^\w\s\u00C0-\u017F-]/g, ' ')  // Keep letters, numbers, spaces, accented chars, hyphens
    .replace(/\s+/g, ' ')          // Collapse multiple spaces
    .trim();

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

    logger.info('VivinoSearch', `Found ${vivinoUrls.length} Vivino URLs, fetching details...`);

    // Step 2: Scrape wine pages - try Web Unlocker first (works in Docker)
    const matches = [];

    for (const url of vivinoUrls.slice(0, 3)) {
      let wineData = null;

      // Try Web Unlocker first (preferred - works in Docker, faster)
      if (bdWebZone) {
        wineData = await scrapeVivinoWithWebUnlocker(url, bdApiKey, bdWebZone);
      }

      // Fall back to Puppeteer for local development
      if (!wineData) {
        try {
          logger.info('VivinoSearch', `Trying Puppeteer fallback for: ${url}`);
          const puppeteerData = await scrapeVivinoPage(url);
          if (puppeteerData) {
            wineData = puppeteerData;
          }
        } catch (err) {
          logger.warn('VivinoSearch', `Puppeteer fallback failed: ${err.message}`);
          // If Puppeteer fails completely, create URL-only match
          if (err.message.includes('timed out') || err.message.includes('Failed to start')) {
            wineData = createUrlOnlyMatch(url, searchQuery, vintage);
          }
        }
      }

      if (wineData) {
        matches.push(normalizeWineData(wineData, { vintage, wineUrl: url }));
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
 * Create a minimal match object from just the URL.
 * Used when both Web Unlocker and Puppeteer fail.
 * @param {string} url - Vivino URL
 * @param {string} searchQuery - Original search query
 * @param {number} vintage - Vintage year
 * @returns {Object} Minimal wine data
 */
function createUrlOnlyMatch(url, searchQuery, vintage) {
  const idMatch = url.match(/\/w\/(\d+)/);
  const vivinoId = idMatch ? parseInt(idMatch[1], 10) : null;

  const slugMatch = url.match(/vivino\.com\/[^/]*\/([^/]+)\/w\//);
  const nameFromSlug = slugMatch
    ? slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : searchQuery;

  return {
    wineName: nameFromSlug,
    vivinoId,
    vintage: vintage || null,
    rating: null,
    ratingCount: null,
    winery: null,
    region: null,
    grape: null,
    url
  };
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
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&num=10&hl=en&gl=us`;

    if (serpZone) {
      response = await fetch(BRIGHTDATA_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          zone: serpZone,
          url: googleUrl,
          format: 'raw'
        })
      });
    } else if (webZone) {
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
      for (const result of data.organic) {
        const url = result.url || result.link;
        if (url?.includes('vivino.com/') && url.includes('/w/')) {
          vivinoUrls.push(url);
        }
      }
    } else if (text) {
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
 * Uses Web Unlocker (preferred) or Puppeteer fallback.
 * @param {number} wineId - Vivino wine ID
 * @returns {Promise<Object|null>} Wine details or null
 */
export async function getVivinoWineDetails(wineId) {
  const wineUrl = `https://www.vivino.com/w/${wineId}`;
  const bdApiKey = process.env.BRIGHTDATA_API_KEY;
  const bdWebZone = process.env.BRIGHTDATA_WEB_ZONE;

  logger.info('VivinoSearch', `Fetching details for wine ID: ${wineId}`);

  try {
    let wineData = null;

    // Try Web Unlocker first
    if (bdApiKey && bdWebZone) {
      wineData = await scrapeVivinoWithWebUnlocker(wineUrl, bdApiKey, bdWebZone);
    }

    // Fall back to Puppeteer
    if (!wineData) {
      logger.info('VivinoSearch', 'Trying Puppeteer fallback for details');
      wineData = await scrapeVivinoPage(wineUrl);
    }

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
    if (/^\d{4}$/.test(word)) break;
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
    const aMatch = a.vintage === preferredVintage;
    const bMatch = b.vintage === preferredVintage;
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;

    const aCount = a.ratingCount || 0;
    const bCount = b.ratingCount || 0;
    return bCount - aCount;
  });
}

export default {
  searchVivinoWines,
  getVivinoWineDetails
};
