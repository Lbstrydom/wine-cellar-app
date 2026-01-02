/**
 * @fileoverview Vivino wine search service.
 * Uses Bright Data Web Unlocker to search Vivino for wine matches.
 * @module services/vivinoSearch
 */

import logger from '../utils/logger.js';

const BRIGHTDATA_API_URL = 'https://api.brightdata.com/request';
const VIVINO_SEARCH_URL = 'https://www.vivino.com/search/wines';

/**
 * Search Vivino for wines matching the given criteria.
 * @param {Object} params - Search parameters
 * @param {string} params.query - Wine name to search
 * @param {string} [params.producer] - Producer/winery name
 * @param {number} [params.vintage] - Year
 * @returns {Promise<{matches: Array, error: string|null}>}
 */
export async function searchVivinoWines({ query, producer, vintage }) {
  const bdApiKey = process.env.BRIGHTDATA_API_KEY;
  const bdZone = process.env.BRIGHTDATA_WEB_ZONE;

  if (!bdApiKey || !bdZone) {
    logger.warn('VivinoSearch', 'Bright Data not configured');
    return { matches: [], error: 'Search service not configured' };
  }

  // Build search query - combine producer and wine name
  const searchTerms = [];
  if (producer) searchTerms.push(producer);
  if (query) searchTerms.push(query);
  const searchQuery = searchTerms.join(' ').trim();

  if (!searchQuery) {
    return { matches: [], error: 'No search query provided' };
  }

  // Build Vivino search URL
  const searchUrl = `${VIVINO_SEARCH_URL}?q=${encodeURIComponent(searchQuery)}`;
  logger.info('VivinoSearch', `Searching: "${searchQuery}"${vintage ? ` (${vintage})` : ''}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // Vivino SPA needs time

    const response = await fetch(BRIGHTDATA_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bdApiKey}`
      },
      body: JSON.stringify({
        zone: bdZone,
        url: searchUrl,
        format: 'raw'
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.error('VivinoSearch', `API returned ${response.status}`);
      return { matches: [], error: `Search failed (${response.status})` };
    }

    const html = await response.text();

    // Check for blocked page
    if (html.length < 1000 && (
      html.toLowerCase().includes('captcha') ||
      html.toLowerCase().includes('blocked') ||
      html.toLowerCase().includes('access denied')
    )) {
      logger.warn('VivinoSearch', 'Request blocked by Vivino');
      return { matches: [], error: 'Search temporarily unavailable' };
    }

    // Parse the HTML response
    const matches = parseVivinoSearchResults(html, vintage);
    logger.info('VivinoSearch', `Found ${matches.length} matches`);

    return { matches, error: null };

  } catch (error) {
    const errorMsg = error.name === 'AbortError' ? 'Request timeout' : error.message;
    logger.error('VivinoSearch', `Search failed: ${errorMsg}`);
    return { matches: [], error: errorMsg };
  }
}

/**
 * Parse Vivino search results from HTML.
 * Extracts wine cards from the search results page.
 * @param {string} html - Raw HTML from Vivino search
 * @param {number} [vintage] - Preferred vintage to rank higher
 * @returns {Array} Parsed wine matches
 */
function parseVivinoSearchResults(html, vintage) {
  const matches = [];

  try {
    // Try to extract __NEXT_DATA__ JSON (Vivino is a Next.js app)
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);

    if (nextDataMatch) {
      const jsonData = JSON.parse(nextDataMatch[1]);
      const wines = extractWinesFromNextData(jsonData);

      if (wines.length > 0) {
        logger.info('VivinoSearch', `Extracted ${wines.length} wines from __NEXT_DATA__`);
        return sortByVintageRelevance(wines, vintage);
      }
    }

    // Fallback: Try to extract from ld+json structured data
    const ldJsonMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
    for (const match of ldJsonMatches) {
      try {
        const jsonData = JSON.parse(match[1]);
        if (jsonData['@type'] === 'Product' || jsonData['@type'] === 'Wine') {
          const wine = extractWineFromLdJson(jsonData);
          if (wine) matches.push(wine);
        }
        if (Array.isArray(jsonData)) {
          for (const item of jsonData) {
            if (item['@type'] === 'Product' || item['@type'] === 'Wine') {
              const wine = extractWineFromLdJson(item);
              if (wine) matches.push(wine);
            }
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }

    if (matches.length > 0) {
      logger.info('VivinoSearch', `Extracted ${matches.length} wines from ld+json`);
      return sortByVintageRelevance(matches, vintage);
    }

    // Fallback: Parse HTML directly for wine card data
    const wineCardMatches = parseWineCardsFromHtml(html);
    if (wineCardMatches.length > 0) {
      logger.info('VivinoSearch', `Extracted ${wineCardMatches.length} wines from HTML cards`);
      return sortByVintageRelevance(wineCardMatches, vintage);
    }

    logger.warn('VivinoSearch', 'Could not extract wine data from response');
    return [];

  } catch (error) {
    logger.error('VivinoSearch', `Parse error: ${error.message}`);
    return [];
  }
}

/**
 * Extract wines from Next.js __NEXT_DATA__ JSON.
 * @param {Object} jsonData - Parsed __NEXT_DATA__ object
 * @returns {Array} Wine objects
 */
function extractWinesFromNextData(jsonData) {
  const wines = [];

  try {
    // Navigate common paths in Vivino's Next.js structure
    const pageProps = jsonData?.props?.pageProps;

    // Search results are typically in explore_vintage.matches or similar
    const possiblePaths = [
      pageProps?.explore_vintage?.matches,
      pageProps?.wines,
      pageProps?.results,
      pageProps?.searchResults?.matches,
      pageProps?.data?.explore_vintage?.matches,
      pageProps?.data?.wines
    ];

    for (const path of possiblePaths) {
      if (Array.isArray(path)) {
        for (const item of path) {
          const wine = extractWineFromVivinoData(item);
          if (wine) wines.push(wine);
        }
        if (wines.length > 0) break;
      }
    }

    // Also check for single wine detail page
    if (wines.length === 0 && pageProps?.wine) {
      const wine = extractWineFromVivinoData({ vintage: { wine: pageProps.wine } });
      if (wine) wines.push(wine);
    }

  } catch (error) {
    logger.warn('VivinoSearch', `Next data extraction error: ${error.message}`);
  }

  return wines;
}

/**
 * Extract wine info from Vivino's internal data structure.
 * @param {Object} item - Vivino match object
 * @returns {Object|null} Normalized wine object
 */
function extractWineFromVivinoData(item) {
  try {
    // Handle both direct wine objects and nested vintage.wine
    const vintage = item?.vintage || item;
    const wine = vintage?.wine || item?.wine || item;
    const winery = wine?.winery || {};
    const region = wine?.region || {};
    const country = region?.country || {};
    const stats = vintage?.statistics || wine?.statistics || {};
    const image = vintage?.image || wine?.image || {};

    // Skip if no meaningful data
    if (!wine?.id && !wine?.name) return null;

    return {
      vivinoId: wine?.id || null,
      vintageId: vintage?.id || null,
      name: vintage?.name || wine?.name || '',
      vintage: vintage?.year || null,
      winery: {
        id: winery?.id || null,
        name: winery?.name || ''
      },
      rating: stats?.ratings_average || stats?.wine_ratings_average || null,
      ratingCount: stats?.ratings_count || stats?.wine_ratings_count || null,
      region: region?.name || '',
      country: country?.name || '',
      grapeVariety: wine?.style?.varietal_name || wine?.varietal?.name || '',
      wineType: getWineType(wine?.type_id),
      imageUrl: image?.variations?.bottle_medium ||
                image?.variations?.large ||
                image?.location || null,
      price: item?.price?.amount || null,
      currency: item?.price?.currency?.code || null,
      vivinoUrl: wine?.id ? `https://www.vivino.com/w/${wine.id}` : null
    };
  } catch (error) {
    return null;
  }
}

/**
 * Extract wine from ld+json structured data.
 * @param {Object} jsonData - Parsed ld+json object
 * @returns {Object|null} Normalized wine object
 */
function extractWineFromLdJson(jsonData) {
  try {
    const rating = jsonData.aggregateRating;

    // Extract Vivino ID from URL if present
    const url = jsonData.url || '';
    const idMatch = url.match(/\/w\/(\d+)/);
    const vivinoId = idMatch ? parseInt(idMatch[1]) : null;

    return {
      vivinoId,
      vintageId: null,
      name: jsonData.name || '',
      vintage: null, // ld+json doesn't typically include vintage
      winery: {
        id: null,
        name: jsonData.brand?.name || ''
      },
      rating: rating?.ratingValue || null,
      ratingCount: rating?.ratingCount || null,
      region: '',
      country: '',
      grapeVariety: '',
      wineType: 'unknown',
      imageUrl: jsonData.image || null,
      price: jsonData.offers?.price || null,
      currency: jsonData.offers?.priceCurrency || null,
      vivinoUrl: url || null
    };
  } catch {
    return null;
  }
}

/**
 * Parse wine cards directly from HTML.
 * Fallback when JSON extraction fails.
 * @param {string} html - Raw HTML
 * @returns {Array} Wine objects
 */
function parseWineCardsFromHtml(html) {
  const wines = [];

  // Look for wine card patterns in HTML
  // Vivino uses data attributes and specific class patterns

  // Pattern 1: data-wine attribute
  const dataWinePattern = /data-wine[^=]*=["'](\d+)["']/gi;
  const wineIds = new Set();
  let match;
  while ((match = dataWinePattern.exec(html)) !== null) {
    wineIds.add(match[1]);
  }

  // Pattern 2: /wines/ URLs with IDs
  const wineUrlPattern = /href=["'][^"']*\/wines\/(\d+)[^"']*["']/gi;
  while ((match = wineUrlPattern.exec(html)) !== null) {
    wineIds.add(match[1]);
  }

  // Pattern 3: /w/ short URLs
  const shortUrlPattern = /href=["'][^"']*\/w\/(\d+)[^"']*["']/gi;
  while ((match = shortUrlPattern.exec(html)) !== null) {
    wineIds.add(match[1]);
  }

  // Extract rating patterns near wine references
  const ratingPattern = /(\d[.,]\d)\s*(?:stars?|\/\s*5|rating)/gi;
  const ratings = [];
  while ((match = ratingPattern.exec(html)) !== null) {
    ratings.push(parseFloat(match[1].replace(',', '.')));
  }

  // If we found wine IDs, create basic wine entries
  // (detailed info would need individual page fetches)
  let ratingIndex = 0;
  for (const id of wineIds) {
    wines.push({
      vivinoId: parseInt(id),
      vintageId: null,
      name: '',
      vintage: null,
      winery: { id: null, name: '' },
      rating: ratings[ratingIndex] || null,
      ratingCount: null,
      region: '',
      country: '',
      grapeVariety: '',
      wineType: 'unknown',
      imageUrl: null,
      price: null,
      currency: null,
      vivinoUrl: `https://www.vivino.com/w/${id}`
    });
    ratingIndex++;
  }

  return wines;
}

/**
 * Convert Vivino wine type ID to string.
 * @param {number} typeId - Vivino type ID
 * @returns {string} Wine type
 */
function getWineType(typeId) {
  const types = {
    1: 'red',
    2: 'white',
    3: 'sparkling',
    4: 'rose',
    7: 'dessert',
    24: 'fortified'
  };
  return types[typeId] || 'unknown';
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

/**
 * Get detailed wine info by Vivino wine ID.
 * @param {number} wineId - Vivino wine ID
 * @returns {Promise<Object|null>} Wine details or null
 */
export async function getVivinoWineDetails(wineId) {
  const bdApiKey = process.env.BRIGHTDATA_API_KEY;
  const bdZone = process.env.BRIGHTDATA_WEB_ZONE;

  if (!bdApiKey || !bdZone) {
    return null;
  }

  const wineUrl = `https://www.vivino.com/w/${wineId}`;
  logger.info('VivinoSearch', `Fetching details for wine ID: ${wineId}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(BRIGHTDATA_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bdApiKey}`
      },
      body: JSON.stringify({
        zone: bdZone,
        url: wineUrl,
        format: 'raw'
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Extract wine data from page
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      const jsonData = JSON.parse(nextDataMatch[1]);
      const pageProps = jsonData?.props?.pageProps;

      if (pageProps?.wine) {
        const wine = extractWineFromVivinoData({ vintage: { wine: pageProps.wine } });
        if (wine) {
          logger.info('VivinoSearch', `Got details: ${wine.name} (${wine.rating}★)`);
          return wine;
        }
      }
    }

    return null;

  } catch (error) {
    logger.error('VivinoSearch', `Details fetch failed: ${error.message}`);
    return null;
  }
}

export default {
  searchVivinoWines,
  getVivinoWineDetails
};
