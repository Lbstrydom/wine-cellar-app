/**
 * @fileoverview Vivino wine search service.
 * Uses Google search (via Bright Data SERP API) to find Vivino wine pages,
 * then fetches individual pages which have reliable __NEXT_DATA__.
 * @module services/vivinoSearch
 */

import logger from '../utils/logger.js';

const BRIGHTDATA_API_URL = 'https://api.brightdata.com/request';
const BRIGHTDATA_SERP_URL = 'https://api.brightdata.com/serp/req';

/**
 * Search Vivino for wines matching the given criteria.
 * Strategy: Use Google SERP to find Vivino wine pages, then fetch top results
 * to get wine details from __NEXT_DATA__.
 * @param {Object} params - Search parameters
 * @param {string} params.query - Wine name to search
 * @param {string} [params.producer] - Producer/winery name
 * @param {number} [params.vintage] - Year
 * @returns {Promise<{matches: Array, error: string|null}>}
 */
export async function searchVivinoWines({ query, producer, vintage }) {
  const bdApiKey = process.env.BRIGHTDATA_API_KEY;
  const bdWebZone = process.env.BRIGHTDATA_WEB_ZONE;
  const bdSerpZone = process.env.BRIGHTDATA_SERP_ZONE;

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
    const vivinoUrls = await searchGoogleForVivino(searchQuery, vintage, bdApiKey, bdSerpZone);

    if (vivinoUrls.length === 0) {
      logger.info('VivinoSearch', 'No Vivino URLs found in search results');
      return { matches: [], error: null };
    }

    logger.info('VivinoSearch', `Found ${vivinoUrls.length} Vivino URLs, fetching details...`);

    // Step 2: Fetch top 3 wine pages to get details
    const matches = [];
    for (const url of vivinoUrls.slice(0, 3)) {
      const wine = await fetchVivinoWinePage(url, bdApiKey, bdWebZone);
      if (wine) {
        matches.push(wine);
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
 * Search Google for Vivino wine pages using SERP API.
 * @param {string} query - Search query
 * @param {number} vintage - Year
 * @param {string} apiKey - Bright Data API key
 * @param {string} serpZone - SERP zone name
 * @returns {Promise<string[]>} Array of Vivino URLs
 */
async function searchGoogleForVivino(query, vintage, apiKey, serpZone) {
  // Build Google search query targeting Vivino wine pages
  const googleQuery = `site:vivino.com ${query} ${vintage || ''} wine`.trim();

  logger.info('VivinoSearch', `Google query: "${googleQuery}"`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

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
    } else {
      // Fall back to direct Google search via Web Unlocker
      const bdWebZone = process.env.BRIGHTDATA_WEB_ZONE;
      if (!bdWebZone) {
        return [];
      }
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&num=10`;
      response = await fetch(BRIGHTDATA_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          zone: bdWebZone,
          url: googleUrl,
          format: 'raw'
        })
      });
    }

    clearTimeout(timeout);

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
        if (result.url?.includes('vivino.com/w/') ||
            result.link?.includes('vivino.com/w/')) {
          vivinoUrls.push(result.url || result.link);
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
 * Fetch a Vivino wine page and extract details from __NEXT_DATA__.
 * @param {string} url - Vivino wine page URL
 * @param {string} apiKey - Bright Data API key
 * @param {string} webZone - Web Unlocker zone name
 * @returns {Promise<Object|null>} Wine details or null
 */
async function fetchVivinoWinePage(url, apiKey, webZone) {
  if (!webZone) {
    // Try direct fetch if no Web Unlocker zone
    logger.warn('VivinoSearch', 'No Web Unlocker zone, skipping page fetch');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(BRIGHTDATA_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        zone: webZone,
        url: url,
        format: 'raw'
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Extract __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!nextDataMatch) {
      logger.warn('VivinoSearch', `No __NEXT_DATA__ in page: ${url}`);
      return null;
    }

    const jsonData = JSON.parse(nextDataMatch[1]);
    const pageProps = jsonData?.props?.pageProps;

    // Try different paths for wine data
    const vintage = pageProps?.vintage;
    const wine = vintage?.wine || pageProps?.wine;

    if (!wine) {
      return null;
    }

    return extractWineFromVivinoData({ vintage, wine });

  } catch (error) {
    logger.warn('VivinoSearch', `Failed to fetch ${url}: ${error.message}`);
    return null;
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

  // Log HTML length for debugging
  logger.info('VivinoSearch', `Response HTML length: ${html.length} bytes`);

  try {
    // Try to extract __NEXT_DATA__ JSON (Vivino is a Next.js app)
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);

    if (nextDataMatch) {
      logger.info('VivinoSearch', 'Found __NEXT_DATA__ block');
      const jsonData = JSON.parse(nextDataMatch[1]);
      const wines = extractWinesFromNextData(jsonData);

      if (wines.length > 0) {
        logger.info('VivinoSearch', `Extracted ${wines.length} wines from __NEXT_DATA__`);
        return sortByVintageRelevance(wines, vintage);
      } else {
        // Log the structure we found for debugging
        const pageProps = jsonData?.props?.pageProps;
        const keys = pageProps ? Object.keys(pageProps) : [];
        logger.info('VivinoSearch', `pageProps keys: ${keys.slice(0, 10).join(', ')}`);
      }
    } else {
      logger.info('VivinoSearch', 'No __NEXT_DATA__ block found');
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
    // Vivino frequently changes their data structure, so check many paths
    const possiblePaths = [
      pageProps?.explore_vintage?.matches,
      pageProps?.explore_vintage?.records,
      pageProps?.wines,
      pageProps?.results,
      pageProps?.searchResults?.matches,
      pageProps?.searchResults?.records,
      pageProps?.data?.explore_vintage?.matches,
      pageProps?.data?.explore_vintage?.records,
      pageProps?.data?.wines,
      pageProps?.vintages,
      pageProps?.topLists?.[0]?.items,
      // Apollo/GraphQL cache structure
      jsonData?.props?.apolloState,
    ];

    for (const path of possiblePaths) {
      if (Array.isArray(path)) {
        for (const item of path) {
          const wine = extractWineFromVivinoData(item);
          if (wine) wines.push(wine);
        }
        if (wines.length > 0) break;
      }
      // Handle Apollo state which is an object with keys
      if (path && typeof path === 'object' && !Array.isArray(path)) {
        for (const key of Object.keys(path)) {
          // Apollo stores wines with keys like "Wine:123456"
          if (key.startsWith('Wine:') || key.startsWith('Vintage:')) {
            const wine = extractWineFromVivinoData(path[key]);
            if (wine) wines.push(wine);
          }
        }
        if (wines.length > 0) break;
      }
    }

    // Also check for single wine detail page
    if (wines.length === 0 && pageProps?.wine) {
      const wine = extractWineFromVivinoData({ vintage: { wine: pageProps.wine } });
      if (wine) wines.push(wine);
    }

    // Check pageProps deeply for any arrays that might contain wine data
    if (wines.length === 0 && pageProps) {
      findWinesInObject(pageProps, wines, 0);
    }

  } catch (error) {
    logger.warn('VivinoSearch', `Next data extraction error: ${error.message}`);
  }

  return wines;
}

/**
 * Recursively search an object for wine data.
 * @param {Object} obj - Object to search
 * @param {Array} wines - Array to add found wines to
 * @param {number} depth - Current recursion depth
 */
function findWinesInObject(obj, wines, depth) {
  // Limit recursion depth
  if (depth > 5 || wines.length >= 10) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      // Check if this item looks like a wine object
      if (item && typeof item === 'object') {
        // Look for wine-like properties
        if (item.wine || item.vintage || (item.id && item.name && (item.winery || item.region))) {
          const wine = extractWineFromVivinoData(item);
          if (wine) wines.push(wine);
        } else {
          findWinesInObject(item, wines, depth + 1);
        }
      }
    }
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      // Skip circular refs and large props
      if (key === '__typename' || key === 'dehydratedState') continue;

      const value = obj[key];
      // Look for arrays named like wine collections
      if (Array.isArray(value) && value.length > 0 && value.length < 100) {
        const matchLikeKey = /wine|vintage|match|record|result|item/i.test(key);
        if (matchLikeKey) {
          for (const item of value) {
            if (item && typeof item === 'object') {
              const wine = extractWineFromVivinoData(item);
              if (wine) wines.push(wine);
            }
          }
          if (wines.length > 0) return;
        }
      }
      // Recurse into objects
      if (value && typeof value === 'object') {
        findWinesInObject(value, wines, depth + 1);
      }
    }
  }
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
