/**
 * @fileoverview Multi-provider search service for wine ratings.
 * @module services/searchProviders
 */

import { getSourcesForCountry, SOURCE_REGISTRY, REGION_SOURCE_PRIORITY, LENS } from '../config/sourceRegistry.js';
import logger from '../utils/logger.js';
import db from '../db/index.js';
import { decrypt } from './encryption.js';

// ============================================
// Grape Detection
// ============================================

/**
 * Grape variety patterns for detection from wine names.
 */
const GRAPE_PATTERNS = {
  chardonnay: /chardonnay/i,
  syrah: /syrah|shiraz/i,
  grenache: /grenache|garnacha/i,
  cabernet_sauvignon: /cabernet\s*sauvignon/i,
  merlot: /merlot/i,
  pinot_noir: /pinot\s*noir/i,
  sauvignon_blanc: /sauvignon\s*blanc/i,
  riesling: /riesling/i,
  malbec: /malbec/i,
  tempranillo: /tempranillo/i,
  nebbiolo: /nebbiolo|barolo|barbaresco/i,
  sangiovese: /sangiovese|chianti|brunello/i,
  pinotage: /pinotage/i,
  chenin_blanc: /chenin\s*blanc/i,
  viognier: /viognier/i,
  mourvedre: /mourv[eè]dre|monastrell/i,
  cabernet_franc: /cabernet\s*franc/i,
  gewurztraminer: /gew[uü]rztraminer/i,
  pinot_grigio: /pinot\s*gri[gs]io/i,
  zinfandel: /zinfandel|primitivo/i
};

/**
 * Detect grape variety from wine name.
 * @param {string} wineName - Wine name to analyze
 * @returns {string|null} Detected grape variety or null
 */
export function detectGrape(wineName) {
  if (!wineName) return null;

  for (const [grape, pattern] of Object.entries(GRAPE_PATTERNS)) {
    if (pattern.test(wineName)) {
      return grape;
    }
  }
  return null;
}

// ============================================
// Score Normalisation
// ============================================

/**
 * Score normalisation map for non-numeric scores.
 * Converts medals, symbols, and other formats to 0-100 scale.
 */
const SCORE_NORMALISATION = {
  // Medal awards
  'Grand Gold': 98,
  'Platinum': 98,
  'Trophy': 98,
  'Double Gold': 96,
  'Gold Outstanding': 96,
  'Gold': 94,
  'Silver': 88,
  'Bronze': 82,
  'Commended': 78,

  // Gambero Rosso (Italian)
  'Tre Bicchieri': 95,
  'Due Bicchieri Rossi': 90,
  'Due Bicchieri': 87,
  'Un Bicchiere': 82,

  // Bibenda grappoli (Italian)
  '5 grappoli': 95,
  'cinque grappoli': 95,
  '4 grappoli': 90,
  'quattro grappoli': 90,
  '3 grappoli': 85,
  'tre grappoli': 85,
  '2 grappoli': 80,
  'due grappoli': 80,

  // Hachette (French)
  '★★★': 94,
  '★★': 88,
  '★': 82,
  'Coup de Coeur': 96,
  'Coup de Cœur': 96
};

/**
 * Normalise a raw score to 0-100 scale.
 * @param {string} rawScore - Raw score string
 * @param {string} _scoreType - Type of score ('points', 'stars', 'medal', 'symbol') - reserved for future use
 * @returns {number|null} Normalised score or null if unable to convert
 */
export function normaliseScore(rawScore, _scoreType) {
  if (!rawScore) return null;

  const rawStr = String(rawScore).trim();

  // Direct lookup for symbols/medals
  if (SCORE_NORMALISATION[rawStr]) {
    return SCORE_NORMALISATION[rawStr];
  }

  // Check for partial matches in normalisation map
  for (const [key, value] of Object.entries(SCORE_NORMALISATION)) {
    if (rawStr.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  // Handle numeric scores
  const numericMatch = rawStr.match(/(\d+(?:\.\d+)?)/);
  if (numericMatch) {
    const value = parseFloat(numericMatch[1]);

    // Already on 100-point scale (50-100 range is typical for wine)
    if (value >= 50 && value <= 100) {
      return Math.round(value);
    }

    // 20-point scale (French system)
    if (value <= 20) {
      return Math.round((value / 20) * 100);
    }

    // 5-star scale
    if (value <= 5) {
      return Math.round((value / 5) * 100);
    }
  }

  return null; // Unable to normalise
}

// ============================================
// Drinking Window Parsing
// ============================================

/**
 * Drinking window patterns for extraction from text.
 * Each pattern has a regex and an extract function.
 */
const DRINKING_WINDOW_PATTERNS = [
  // "Drink 2024-2030" or "Drink 2024 - 2030"
  {
    pattern: /drink\s*(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Best 2025-2035"
  {
    pattern: /best\s*(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Drink now through 2028" or "Drink now-2028"
  {
    pattern: /drink\s*now\s*(?:through|[-–—to]+)\s*(\d{4})/i,
    extract: (m) => ({ drink_from: new Date().getFullYear(), drink_by: parseInt(m[1]) })
  },
  // "Drink after 2026"
  {
    pattern: /drink\s*after\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: null })
  },
  // "Hold until 2025" or "Cellar until 2030"
  {
    pattern: /(?:hold|cellar)\s*(?:until|till|to)\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: null })
  },
  // "Drinking window: 2024-2030"
  {
    pattern: /drinking\s*window[:\s]+(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Ready now" or "Drink now" (not followed by "through" or range)
  {
    pattern: /(?:ready|drink)\s*now(?!\s*(?:through|[-–—to]))/i,
    extract: () => ({ drink_from: new Date().getFullYear(), drink_by: null })
  },
  // "Past its peak" or "Drink up" or "Drink soon"
  {
    pattern: /past\s*(?:its\s*)?peak|drink\s*up|drink\s*soon/i,
    extract: () => ({ drink_from: null, drink_by: new Date().getFullYear(), is_urgent: true })
  },
  // Relative: "Best in 3-7 years" (requires vintage)
  {
    pattern: /best\s*in\s*(\d+)\s*[-–—to]+\s*(\d+)\s*years?/i,
    extract: (m, vintage) => vintage ? {
      drink_from: vintage + parseInt(m[1]),
      drink_by: vintage + parseInt(m[2])
    } : null
  },
  // "Peak 2027" or "Peak: 2027"
  {
    pattern: /peak[:\s]+(\d{4})/i,
    extract: (m) => ({ peak: parseInt(m[1]) })
  },
  // Italian: "Bere entro il 2030" (drink by 2030)
  {
    pattern: /bere\s*entro\s*(?:il\s*)?(\d{4})/i,
    extract: (m) => ({ drink_from: null, drink_by: parseInt(m[1]) })
  },
  // French: "À boire jusqu'en 2028" (drink until 2028)
  {
    pattern: /[àa]\s*boire\s*jusqu[''u]?en\s*(\d{4})/i,
    extract: (m) => ({ drink_from: null, drink_by: parseInt(m[1]) })
  },
  // "Now - 2028" or "now-2030"
  {
    pattern: /now\s*[-–—]\s*(\d{4})/i,
    extract: (m) => ({ drink_from: new Date().getFullYear(), drink_by: parseInt(m[1]) })
  }
];

/**
 * Parse drinking window from text.
 * @param {string} text - Text to parse
 * @param {number|null} vintage - Wine vintage year for relative calculations
 * @returns {object|null} - { drink_from, drink_by, peak, raw_text } or null
 */
export function parseDrinkingWindow(text, vintage = null) {
  if (!text) return null;

  for (const { pattern, extract } of DRINKING_WINDOW_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const result = extract(match, vintage);
      if (result) {
        return {
          drink_from_year: result.drink_from || null,
          drink_by_year: result.drink_by || null,
          peak_year: result.peak || null,
          raw_text: match[0],
          is_urgent: result.is_urgent || false
        };
      }
    }
  }
  return null;
}

/**
 * Parse Vivino relative window format.
 * @param {string} text - Vivino maturity text
 * @param {number} vintage - Wine vintage
 * @returns {object|null} - { drink_from_year, drink_by_year, raw_text } or null
 */
export function parseVivinoWindow(text, vintage) {
  if (!text || !vintage) return null;

  // "Best in 3-7 years"
  const relativeMatch = text.match(/best\s*in\s*(\d+)\s*[-–—to]+\s*(\d+)\s*years?/i);
  if (relativeMatch) {
    return {
      drink_from_year: vintage + parseInt(relativeMatch[1]),
      drink_by_year: vintage + parseInt(relativeMatch[2]),
      raw_text: relativeMatch[0]
    };
  }

  // "Drink within 2 years"
  const withinMatch = text.match(/(?:drink|best)\s*within\s*(\d+)\s*years?/i);
  if (withinMatch) {
    const currentYear = new Date().getFullYear();
    return {
      drink_from_year: currentYear,
      drink_by_year: currentYear + parseInt(withinMatch[1]),
      raw_text: withinMatch[0]
    };
  }

  return null;
}

// ============================================
// Enhanced Source Selection
// ============================================

/**
 * Get sources for a wine based on country and detected grape.
 * Prioritizes region-specific sources and adds grape-specific competitions.
 * @param {string} country - Wine's country of origin
 * @param {string|null} grape - Detected grape variety
 * @returns {Object[]} Array of source configs sorted by priority
 */
export function getSourcesForWine(country, grape = null) {
  // Get base sources using region priority mapping
  const countryKey = country && REGION_SOURCE_PRIORITY[country] ? country : '_default';
  const prioritySourceIds = REGION_SOURCE_PRIORITY[countryKey] || REGION_SOURCE_PRIORITY['_default'];

  // Build source list from priority IDs
  let sources = prioritySourceIds
    .map(id => {
      const config = SOURCE_REGISTRY[id];
      if (!config) return null;
      return { id, ...config, relevance: 1.0 };
    })
    .filter(Boolean);

  // Add grape-specific competitions if grape is known
  if (grape) {
    const grapeNormalised = grape.toLowerCase();
    const grapeCompetitions = [];

    for (const [id, config] of Object.entries(SOURCE_REGISTRY)) {
      if (
        config.lens === LENS.COMPETITION &&
        config.grape_affinity &&
        config.grape_affinity.some(g =>
          grapeNormalised.includes(g) || g.includes(grapeNormalised)
        )
      ) {
        // Don't add if already in sources
        if (!sources.some(s => s.id === id)) {
          grapeCompetitions.push({ id, ...config, relevance: 1.0 });
        }
      }
    }

    // Prepend grape competitions (highest priority)
    sources = [...grapeCompetitions, ...sources];
  }

  // Add global competitions that aren't already included
  for (const [id, config] of Object.entries(SOURCE_REGISTRY)) {
    if (
      config.lens === LENS.COMPETITION &&
      config.grape_affinity === null &&
      config.home_regions.length === 0 &&
      !sources.some(s => s.id === id)
    ) {
      sources.push({ id, ...config, relevance: 0.8 });
    }
  }

  // Fill in remaining sources from getSourcesForCountry for completeness
  const countrySources = getSourcesForCountry(country);
  for (const source of countrySources) {
    if (!sources.some(s => s.id === source.id)) {
      sources.push(source);
    }
  }

  return sources;
}

/**
 * Search using Google Programmable Search API.
 * @param {string} query - Search query
 * @param {string[]} domains - Domains to restrict search to
 * @returns {Promise<Object[]>} Search results
 */
export async function searchGoogle(query, domains = []) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !engineId) {
    logger.warn('Google', 'API not configured, skipping');
    return [];
  }

  let fullQuery = query;
  if (domains.length > 0 && domains.length <= 10) {
    const siteRestriction = domains.map(d => `site:${d}`).join(' OR ');
    fullQuery = `${query} (${siteRestriction})`;
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', engineId);
  url.searchParams.set('q', fullQuery);
  url.searchParams.set('num', '10');

  logger.info('Google', `Searching: "${query}" across ${domains.length} domains`);

  try {
    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.error) {
      logger.error('Google', `API error: ${data.error.message}`);
      return [];
    }

    const results = (data.items || []).map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      source: extractDomain(item.link)
    }));

    logger.info('Google', `Found ${results.length} results`);
    return results;

  } catch (error) {
    logger.error('Google', `Search failed: ${error.message}`);
    return [];
  }
}

/**
 * Search using Brave Search API (fallback).
 * @param {string} query - Search query
 * @returns {Promise<Object[]>} Search results
 */
export async function searchBrave(query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    logger.warn('Brave', 'API not configured, skipping');
    return [];
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');

  logger.info('Brave', `Searching: "${query}"`);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      logger.error('Brave', `HTTP error: ${response.status}`);
      return [];
    }

    const data = await response.json();

    const results = (data.web?.results || []).map(item => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
      source: extractDomain(item.url)
    }));

    logger.info('Brave', `Found ${results.length} results`);
    return results;

  } catch (error) {
    logger.error('Brave', `Search failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetch page content for parsing.
 * Returns detailed status for observability.
 * @param {string} url - URL to fetch
 * @param {number} maxLength - Maximum content length
 * @returns {Promise<Object>} { content, success, status, blocked, error }
 */
export async function fetchPageContent(url, maxLength = 8000) {
  const domain = extractDomain(url);
  logger.info('Fetch', `Fetching: ${url}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const status = response.status;

    if (!response.ok) {
      logger.info('Fetch', `HTTP ${status} from ${domain}`);
      return {
        content: '',
        success: false,
        status,
        blocked: status === 403 || status === 429,
        error: `HTTP ${status}`
      };
    }

    const html = await response.text();

    // Check for blocked/consent indicators
    const isBlocked =
      html.length < 500 && (
        html.toLowerCase().includes('captcha') ||
        html.toLowerCase().includes('consent') ||
        html.toLowerCase().includes('verify') ||
        html.toLowerCase().includes('cloudflare') ||
        html.toLowerCase().includes('access denied')
      );

    if (isBlocked) {
      logger.info('Fetch', `Blocked/consent page from ${domain} (${html.length} chars)`);
      return {
        content: '',
        success: false,
        status,
        blocked: true,
        error: 'Blocked or consent page'
      };
    }

    // Special handling for Vivino (Next.js) - extract JSON data
    let text = '';
    if (domain.includes('vivino')) {
      text = extractVivinoData(html);
    }

    // If no special extraction or it failed, use standard HTML stripping
    if (!text) {
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Check if we got meaningful content
    if (text.length < 200) {
      logger.info('Fetch', `Short response from ${domain}: ${text.length} chars`);
      return {
        content: text,
        success: false,
        status,
        blocked: true,
        error: `Too short (${text.length} chars)`
      };
    }

    logger.info('Fetch', `Got ${text.length} chars from ${domain}`);

    return {
      content: text.substring(0, maxLength),
      success: true,
      status,
      blocked: false,
      error: null
    };

  } catch (error) {
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    logger.error('Fetch', `Failed for ${url}: ${errorMsg}`);
    return {
      content: '',
      success: false,
      status: null,
      blocked: false,
      error: errorMsg
    };
  }
}

/**
 * Extract rating data from Vivino's Next.js JSON payload.
 * @param {string} html - Raw HTML
 * @returns {string} Extracted text or empty string
 */
function extractVivinoData(html) {
  try {
    // Try __NEXT_DATA__ script
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      const jsonData = JSON.parse(nextDataMatch[1]);
      const wine = jsonData?.props?.pageProps?.wine;
      if (wine) {
        const parts = [
          `Wine: ${wine.name || ''}`,
          `Rating: ${wine.statistics?.ratings_average || ''} stars`,
          `Ratings count: ${wine.statistics?.ratings_count || ''}`,
          `Region: ${wine.region?.name || ''}`,
          `Country: ${wine.region?.country?.name || ''}`,
        ];
        logger.info('Fetch', `Extracted Vivino data: ${wine.statistics?.ratings_average} stars, ${wine.statistics?.ratings_count} ratings`);
        return parts.join('\n');
      }
    }

    // Try ld+json
    const ldJsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (ldJsonMatch) {
      const jsonData = JSON.parse(ldJsonMatch[1]);
      if (jsonData.aggregateRating) {
        return `Rating: ${jsonData.aggregateRating.ratingValue} stars (${jsonData.aggregateRating.ratingCount} ratings)`;
      }
    }

    // Try meta tags
    const ratingMatch = html.match(/content="(\d+\.?\d*)"[^>]*property="og:rating"/i) ||
                        html.match(/property="og:rating"[^>]*content="(\d+\.?\d*)"/i);
    if (ratingMatch) {
      return `Rating: ${ratingMatch[1]} stars`;
    }

  } catch (e) {
    logger.info('Fetch', `Vivino JSON extraction failed: ${e.message}`);
  }

  return '';
}

/**
 * Extract domain from URL.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

/**
 * Build a source-specific search query.
 * @param {Object} source - Source config
 * @param {string} wineName
 * @param {string|number} vintage
 * @returns {string} Search query
 */
function buildSourceQuery(source, wineName, vintage) {
  if (source.query_template) {
    return source.query_template
      .replace('{wine}', `"${wineName}"`)
      .replace('{vintage}', vintage || '');
  }
  return `"${wineName}" ${vintage}`;
}

/**
 * Generate wine name variations for better search coverage.
 * Handles wines with numeric prefixes, abbreviations, etc.
 * @param {string} wineName - Original wine name
 * @returns {string[]} Array of name variations
 */
function generateWineNameVariations(wineName) {
  const variations = [wineName];

  // For wines starting with numbers (like "1865 Selected Vineyards")
  // Try adding common producer prefixes
  if (/^\d+\s/.test(wineName)) {
    // 1865 is a brand from Viña San Pedro
    if (wineName.startsWith('1865')) {
      variations.push(`Viña San Pedro ${wineName}`);
      variations.push(`San Pedro ${wineName}`);
    }
  }

  // Try without "Selected Vineyards" or "Single Vineyard" etc.
  const simplified = wineName
    .replace(/\s+Selected\s+Vineyards?/i, '')
    .replace(/\s+Single\s+Vineyards?/i, '')
    .replace(/\s+Reserve/i, '')
    .trim();
  if (simplified !== wineName && simplified.length > 5) {
    variations.push(simplified);
  }

  return [...new Set(variations)]; // Remove duplicates
}

/**
 * Check if a URL appears to be the producer/winery's own website.
 * @param {string} url - URL to check
 * @param {string} wineNameLower - Lowercase wine name
 * @param {string[]} keyWords - Key words from wine name
 * @returns {boolean} True if likely a producer site
 */
function checkIfProducerSite(url, wineNameLower, keyWords) {
  // Known retailer/aggregator domains to exclude
  const knownRetailers = [
    'vivino.com', 'wine-searcher.com', 'cellartracker.com', 'totalwine.com',
    'wine.com', 'winespectator.com', 'decanter.com', 'jancisrobinson.com',
    'jamessuckling.com', 'robertparker.com', 'winemag.com', 'nataliemaclean.com',
    'winealign.com', 'internationalwinechallenge.com', 'iwsc.net', 'amazon.com',
    'wikipedia.org', 'facebook.com', 'instagram.com', 'twitter.com'
  ];

  // Check if it's a known retailer
  if (knownRetailers.some(r => url.includes(r))) {
    return false;
  }

  // Extract domain from URL
  let domain = '';
  try {
    domain = new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch {
    return false;
  }

  // Check if domain contains any key words from wine name (producer name)
  // This catches things like "springfieldestate.com" for "Springfield Estate"
  const domainWithoutTld = domain.replace(/\.(com|co\.za|wine|fr|it|es|de|cl|ar|au|nz)$/, '');

  for (const word of keyWords) {
    if (word.length >= 4 && domainWithoutTld.includes(word.replace(/[^a-z0-9]/g, ''))) {
      return true;
    }
  }

  // Check for common winery URL patterns
  const wineryPatterns = ['/product/', '/wines/', '/our-wines/', '/wine/', '/shop/'];
  if (wineryPatterns.some(p => url.includes(p))) {
    // Could be a winery site with product pages
    // Extra check: domain should look like a winery name (not generic)
    if (domainWithoutTld.length > 5 && !domainWithoutTld.includes('wine-shop')) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate relevance score for a search result.
 * Higher score = more specifically about this wine.
 * @param {Object} result - Search result with title and snippet
 * @param {string} wineName - Wine name to look for
 * @param {string|number} vintage - Vintage year
 * @returns {Object} { relevant: boolean, score: number }
 */
function calculateResultRelevance(result, wineName, vintage) {
  const title = (result.title || '').toLowerCase();
  const snippet = (result.snippet || '').toLowerCase();
  const titleAndSnippet = `${title} ${snippet}`;
  const wineNameLower = wineName.toLowerCase();

  // Extract key words from wine name (at least 2 chars)
  const keyWords = wineNameLower
    .split(/\s+/)
    .filter(w => w.length >= 2 && !['the', 'and', 'de', 'du', 'la', 'le'].includes(w));

  // Count matches in title vs snippet (title matches are more valuable)
  const titleMatchCount = keyWords.filter(w => title.includes(w)).length;
  const snippetMatchCount = keyWords.filter(w => snippet.includes(w)).length;
  const hasVintageInTitle = vintage && title.includes(String(vintage));
  const hasVintageInSnippet = vintage && snippet.includes(String(vintage));

  // Calculate relevance score
  let score = 0;
  score += titleMatchCount * 3; // Title matches are worth 3x
  score += snippetMatchCount * 1; // Snippet matches worth 1x
  score += hasVintageInTitle ? 5 : 0; // Vintage in title is very good
  score += hasVintageInSnippet ? 2 : 0; // Vintage in snippet is good

  // Bonus for rating/review sites appearing specific to this wine
  const isRatingPage = titleAndSnippet.includes('rating') ||
    titleAndSnippet.includes('review') ||
    titleAndSnippet.includes('points') ||
    titleAndSnippet.includes('score');
  if (isRatingPage && titleMatchCount >= 2) {
    score += 3;
  }

  // Bonus for producer/winery websites - they often have awards, tech specs, tasting notes
  const url = (result.url || '').toLowerCase();
  const isProducerSite = checkIfProducerSite(url, wineNameLower, keyWords);
  if (isProducerSite) {
    score += 5; // Producer sites are very valuable
  }

  // Penalty for generic competition/award list pages
  const isGenericAwardPage =
    (title.includes('results') || title.includes('winners') || title.includes('champion')) &&
    titleMatchCount < 2;
  if (isGenericAwardPage) {
    score -= 5;
  }

  // Must have at least 2 key words matching somewhere, or vintage + 1 word
  const totalMatches = titleMatchCount + snippetMatchCount;
  const relevant = totalMatches >= 2 || (totalMatches >= 1 && (hasVintageInTitle || hasVintageInSnippet));

  return { relevant, score, isProducerSite };
}

/**
 * Check if a search result is relevant to the wine (legacy wrapper).
 * @param {Object} result - Search result
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage
 * @returns {boolean} True if relevant
 */
function _isResultRelevant(result, wineName, vintage) {
  return calculateResultRelevance(result, wineName, vintage).relevant;
}

/**
 * Multi-tier search for wine ratings.
 * Runs Google and Brave searches in parallel for better coverage.
 * Uses grape detection for grape-specific competition sources.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {string} country - Country of origin
 * @returns {Promise<Object>} Search results
 */
export async function searchWineRatings(wineName, vintage, country) {
  // Detect grape variety from wine name
  const detectedGrape = detectGrape(wineName);

  // Get sources using enhanced selection (includes grape-specific competitions)
  const sources = getSourcesForWine(country, detectedGrape);
  const topSources = sources.slice(0, 10); // Top 10 by priority (increased from 8)
  const wineNameVariations = generateWineNameVariations(wineName);

  logger.separator();
  logger.info('Search', `Wine: "${wineName}" ${vintage}`);
  logger.info('Search', `Country: ${country || 'Unknown'}`);
  if (detectedGrape) {
    logger.info('Search', `Detected grape: ${detectedGrape}`);
  }
  logger.info('Search', `Name variations: ${wineNameVariations.join(', ')}`);
  logger.info('Search', `Top sources: ${topSources.map(s => s.id).join(', ')}`);

  // Strategy 1: Targeted searches for diverse sources
  // Include grape-specific competitions, top competitions, AND top critics for balanced coverage
  const targetedResults = [];

  // Get grape-specific competitions first (if grape detected)
  const grapeCompetitions = detectedGrape
    ? topSources.filter(s => s.lens === 'competition' && s.grape_affinity).slice(0, 2)
    : [];
  // Get top 3 global competitions
  const topCompetitions = topSources.filter(s => s.lens === 'competition' && !s.grape_affinity).slice(0, 3);
  // Get top 2 critics/guides (James Suckling, Wine Spectator, regional guides)
  const topCritics = topSources.filter(s => s.lens === 'critic' || s.lens === 'panel_guide').slice(0, 2);

  const prioritySources = [...grapeCompetitions, ...topCompetitions, ...topCritics].slice(0, 6);
  logger.info('Search', `Targeted sources: ${prioritySources.map(s => s.id).join(', ')}`);

  // Run all targeted searches in parallel for better performance
  const targetedSearchPromises = prioritySources.map(source => {
    const query = buildSourceQuery(source, wineName, vintage);
    logger.info('Search', `Targeted search for ${source.id}: "${query}"`);

    return searchGoogle(query, [source.domain]).then(results =>
      results.map(r => ({
        ...r,
        sourceId: source.id,
        lens: source.lens,
        credibility: source.credibility,
        relevance: source.relevance
      }))
    );
  });

  const targetedResultsArrays = await Promise.all(targetedSearchPromises);
  targetedResultsArrays.forEach(results => targetedResults.push(...results));

  logger.info('Search', `Targeted searches found: ${targetedResults.length} results`);

  // Strategy 2: Broad Google search + Brave search IN PARALLEL
  const remainingDomains = topSources.slice(3).map(s => s.domain);
  const broadQuery = `"${wineName}" ${vintage} rating`;

  // Always run both broad Google and Brave in parallel for better coverage
  const [broadResults, braveResults] = await Promise.all([
    remainingDomains.length > 0
      ? searchGoogle(broadQuery, remainingDomains)
      : Promise.resolve([]),
    searchBrave(`${wineName} ${vintage} wine rating review`)
  ]);

  logger.info('Search', `Broad search found: ${broadResults.length} results`);
  logger.info('Search', `Brave found: ${braveResults.length} results`);

  // Strategy 3: Try name variations if we still have few results
  const variationResults = [];
  if (targetedResults.length + broadResults.length + braveResults.length < 5 && wineNameVariations.length > 1) {
    logger.info('Search', 'Trying wine name variations...');
    for (const variation of wineNameVariations.slice(1)) { // Skip first (original)
      const varResults = await searchBrave(`${variation} ${vintage} wine rating`);
      variationResults.push(...varResults);
      if (variationResults.length >= 5) break;
    }
    logger.info('Search', `Variation searches found: ${variationResults.length} results`);
  }

  // Combine and deduplicate by URL
  const allResults = [...targetedResults, ...broadResults, ...braveResults, ...variationResults];
  const seen = new Set();
  const uniqueResults = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Filter and score results by relevance
  const scoredResults = uniqueResults
    .map(r => {
      const { relevant, score, isProducerSite } = calculateResultRelevance(r, wineName, vintage);
      return { ...r, relevant, relevanceScore: score, isProducerSite };
    })
    .filter(r => r.relevant);

  // Log producer sites found
  const producerSites = scoredResults.filter(r => r.isProducerSite);
  if (producerSites.length > 0) {
    logger.info('Search', `Found ${producerSites.length} producer website(s): ${producerSites.map(r => r.source).join(', ')}`);
  }

  logger.info('Search', `Filtered to ${scoredResults.length} relevant results (from ${uniqueResults.length})`);

  // Enrich results without source metadata
  const enrichedResults = scoredResults.map(r => {
    if (r.sourceId) return r; // Already enriched

    const matchedSource = sources.find(s =>
      r.source?.includes(s.domain) ||
      s.alt_domains?.some(d => r.source?.includes(d))
    );

    return {
      ...r,
      sourceId: matchedSource?.id || 'unknown',
      lens: matchedSource?.lens || 'unknown',
      credibility: matchedSource?.credibility || 0.5,
      relevance: matchedSource?.relevance || 0.5
    };
  });

  // Sort by relevance score first, then by source credibility
  // This ensures wine-specific pages rank above generic competition pages
  enrichedResults.sort((a, b) => {
    // Primary: relevance score (how specific is this result to our wine?)
    const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (Math.abs(scoreDiff) > 2) return scoreDiff; // Significant difference

    // Secondary: source credibility × regional relevance
    return (b.credibility * b.relevance) - (a.credibility * a.relevance);
  });

  // Log top results for debugging
  if (enrichedResults.length > 0) {
    logger.info('Search', `Top result: "${enrichedResults[0].title}" (score: ${enrichedResults[0].relevanceScore}, source: ${enrichedResults[0].sourceId})`);
  }

  return {
    query: broadQuery,
    country: country || 'Unknown',
    detected_grape: detectedGrape,
    results: enrichedResults.slice(0, 10),
    sources_searched: topSources.length,
    targeted_hits: targetedResults.length,
    broad_hits: broadResults.length,
    brave_hits: braveResults.length,
    variation_hits: variationResults.length
  };
}

// ============================================
// Authenticated Scraping Functions
// ============================================

/**
 * Get decrypted credentials for a source.
 * @param {string} sourceId - Source ID (vivino, decanter, cellartracker)
 * @returns {Object|null} { username, password } or null if not configured
 */
export function getCredentials(sourceId) {
  try {
    const cred = db.prepare(
      'SELECT username_encrypted, password_encrypted, auth_status FROM source_credentials WHERE source_id = ?'
    ).get(sourceId);

    if (!cred || !cred.username_encrypted || !cred.password_encrypted) {
      return null;
    }

    const username = decrypt(cred.username_encrypted);
    const password = decrypt(cred.password_encrypted);

    if (!username || !password) {
      return null;
    }

    return { username, password, authStatus: cred.auth_status };
  } catch (err) {
    logger.error('Credentials', `Failed to get credentials for ${sourceId}: ${err.message}`);
    return null;
  }
}

/**
 * Update credential auth status.
 * @param {string} sourceId - Source ID
 * @param {string} status - 'valid', 'failed', or 'none'
 */
export function updateCredentialStatus(sourceId, status) {
  try {
    db.prepare(
      'UPDATE source_credentials SET auth_status = ?, last_used_at = CURRENT_TIMESTAMP WHERE source_id = ?'
    ).run(status, sourceId);
  } catch (err) {
    logger.error('Credentials', `Failed to update status for ${sourceId}: ${err.message}`);
  }
}

/**
 * Authenticate with Vivino and fetch wine data using their API.
 * Uses stored credentials to establish a session before searching.
 * @param {string} wineName - Wine name to search
 * @param {string|number} vintage - Vintage year
 * @returns {Promise<Object|null>} Wine data or null
 */
export async function fetchVivinoAuthenticated(wineName, vintage) {
  const creds = getCredentials('vivino');
  if (!creds) {
    logger.info('Vivino', 'No credentials configured, skipping authenticated fetch');
    return null;
  }

  logger.info('Vivino', `Attempting authenticated search for: ${wineName} ${vintage}`);

  try {
    // Step 1: Authenticate with Vivino to get session token
    const loginResponse = await fetch('https://www.vivino.com/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        email: creds.username,
        password: creds.password
      })
    });

    if (!loginResponse.ok) {
      if (loginResponse.status === 401 || loginResponse.status === 403) {
        updateCredentialStatus('vivino', 'failed');
        logger.info('Vivino', 'Authentication failed - invalid credentials');
      } else {
        logger.info('Vivino', `Login API returned ${loginResponse.status}`);
      }
      return null;
    }

    // Extract session cookies from login response
    const loginCookies = loginResponse.headers.getSetCookie?.() ||
      [loginResponse.headers.get('set-cookie')].filter(Boolean);

    if (!loginCookies || loginCookies.length === 0) {
      logger.info('Vivino', 'No session cookies received from login');
      // Still try the search - some data may be available
    }

    // Parse cookies into a single Cookie header string
    const cookieString = loginCookies
      .map(cookie => cookie.split(';')[0])
      .join('; ');

    // Step 2: Search with authenticated session
    const searchUrl = new URL('https://www.vivino.com/api/explore/explore');
    searchUrl.searchParams.set('q', `${wineName} ${vintage}`.trim());
    searchUrl.searchParams.set('limit', '5');

    const searchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    // Include session cookies if we got them
    if (cookieString) {
      searchHeaders['Cookie'] = cookieString;
    }

    const response = await fetch(searchUrl.toString(), {
      headers: searchHeaders
    });

    if (!response.ok) {
      logger.info('Vivino', `Search API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    const matches = data.explore_vintage?.matches || [];

    if (matches.length === 0) {
      logger.info('Vivino', 'No matches found in API response');
      return null;
    }

    // Find best match
    const bestMatch = matches.find(m => {
      const wName = m.vintage?.wine?.name?.toLowerCase() || '';
      const wVintage = m.vintage?.year;
      return wName.includes(wineName.toLowerCase().split(' ')[0]) &&
             (!vintage || wVintage === parseInt(vintage, 10));
    }) || matches[0];

    const wine = bestMatch.vintage?.wine;
    const stats = bestMatch.vintage?.statistics || wine?.statistics;

    if (!stats?.ratings_average) {
      logger.info('Vivino', 'Match found but no rating data');
      return null;
    }

    updateCredentialStatus('vivino', 'valid');

    const result = {
      source: 'vivino',
      lens: 'community',
      score_type: 'stars',
      raw_score: stats.ratings_average.toFixed(1),
      rating_count: stats.ratings_count || null,
      wine_name: wine?.name,
      vintage_found: bestMatch.vintage?.year,
      source_url: `https://www.vivino.com/w/${wine?.id}`,
      match_confidence: 'high'
    };

    logger.info('Vivino', `Found: ${result.raw_score} stars (${result.rating_count} ratings)`);
    return result;

  } catch (err) {
    logger.error('Vivino', `Authenticated fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch wine data from CellarTracker using credentials.
 * @param {string} wineName - Wine name to search
 * @param {string|number} vintage - Vintage year
 * @returns {Promise<Object|null>} Wine data or null
 */
export async function fetchCellarTrackerAuthenticated(wineName, vintage) {
  const creds = getCredentials('cellartracker');
  if (!creds) {
    logger.info('CellarTracker', 'No credentials configured, skipping authenticated fetch');
    return null;
  }

  logger.info('CellarTracker', `Attempting authenticated search for: ${wineName} ${vintage}`);

  try {
    // CellarTracker requires basic auth for their API
    const authHeader = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');

    // Search wines
    const searchUrl = new URL('https://www.cellartracker.com/xlquery.asp');
    searchUrl.searchParams.set('User', creds.username);
    searchUrl.searchParams.set('Password', creds.password);
    searchUrl.searchParams.set('Format', 'json');
    searchUrl.searchParams.set('Table', 'Wines');
    searchUrl.searchParams.set('Wine', wineName);
    if (vintage) {
      searchUrl.searchParams.set('Vintage', vintage);
    }

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        updateCredentialStatus('cellartracker', 'failed');
        logger.info('CellarTracker', 'Authentication failed');
      }
      return null;
    }

    const data = await response.json();

    if (!data || !Array.isArray(data) || data.length === 0) {
      logger.info('CellarTracker', 'No matches found');
      return null;
    }

    // Find the best match with community score
    const matchWithScore = data.find(w => w.CT && parseFloat(w.CT) > 0);
    if (!matchWithScore) {
      logger.info('CellarTracker', 'No matches with ratings found');
      return null;
    }

    updateCredentialStatus('cellartracker', 'valid');

    const result = {
      source: 'cellartracker',
      lens: 'community',
      score_type: 'points',
      raw_score: parseFloat(matchWithScore.CT).toFixed(1),
      rating_count: matchWithScore.CNotes || null,
      wine_name: matchWithScore.Wine,
      vintage_found: matchWithScore.Vintage,
      source_url: `https://www.cellartracker.com/wine.asp?iWine=${matchWithScore.iWine}`,
      match_confidence: 'high'
    };

    logger.info('CellarTracker', `Found: ${result.raw_score} points`);
    return result;

  } catch (err) {
    logger.error('CellarTracker', `Authenticated fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetch wine data from Decanter using credentials.
 * Note: Decanter doesn't have a public API, but logged-in users can access more content.
 * @param {string} wineName - Wine name to search
 * @param {string|number} vintage - Vintage year
 * @returns {Promise<Object|null>} Wine data or null
 */
export async function fetchDecanterAuthenticated(wineName, vintage) {
  const creds = getCredentials('decanter');
  if (!creds) {
    logger.info('Decanter', 'No credentials configured, skipping authenticated fetch');
    return null;
  }

  logger.info('Decanter', `Attempting authenticated search for: ${wineName} ${vintage}`);

  try {
    // First, authenticate to get session cookies
    const loginResponse = await fetch('https://www.decanter.com/wp-login.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({
        'log': creds.username,
        'pwd': creds.password,
        'wp-submit': 'Log In',
        'redirect_to': 'https://www.decanter.com/'
      }),
      redirect: 'manual'
    });

    // Check if login was successful (redirect)
    if (loginResponse.status !== 302) {
      updateCredentialStatus('decanter', 'failed');
      logger.info('Decanter', 'Authentication failed');
      return null;
    }

    // Get ALL cookies from login response (WordPress sets multiple cookies)
    // Use getSetCookie() for modern Node.js, fallback to getAll() or manual parsing
    let allCookies = [];

    if (typeof loginResponse.headers.getSetCookie === 'function') {
      // Node.js 18.14.1+ / undici
      allCookies = loginResponse.headers.getSetCookie();
    } else if (typeof loginResponse.headers.raw === 'function') {
      // node-fetch style
      const rawHeaders = loginResponse.headers.raw();
      allCookies = rawHeaders['set-cookie'] || [];
    } else {
      // Fallback: try to get the single combined header (may lose some cookies)
      const singleCookie = loginResponse.headers.get('set-cookie');
      if (singleCookie) {
        allCookies = [singleCookie];
      }
    }

    if (!allCookies || allCookies.length === 0) {
      logger.info('Decanter', 'No session cookies received');
      return null;
    }

    logger.info('Decanter', `Received ${allCookies.length} cookie(s) from login`);

    // Parse cookies into a single Cookie header string (extract name=value parts)
    const cookieString = allCookies
      .map(cookie => cookie.split(';')[0]) // Get just the name=value part
      .join('; ');

    updateCredentialStatus('decanter', 'valid');

    // Search Decanter with authenticated session
    const searchQuery = encodeURIComponent(`${wineName} ${vintage}`.trim());
    const searchUrl = `https://www.decanter.com/?s=${searchQuery}&post_type=wine`;

    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    });

    if (!searchResponse.ok) {
      logger.info('Decanter', `Search returned ${searchResponse.status}`);
      return null;
    }

    const html = await searchResponse.text();

    // Look for rating in search results (Decanter uses points out of 100)
    // Pattern: "XX points" or "Score: XX"
    const ratingMatch = html.match(/(\d{2,3})\s*points/i) ||
                        html.match(/score[:\s]+(\d{2,3})/i);

    if (!ratingMatch) {
      logger.info('Decanter', 'No rating found in search results');
      return null;
    }

    const score = parseInt(ratingMatch[1], 10);
    if (score < 50 || score > 100) {
      logger.info('Decanter', `Invalid score found: ${score}`);
      return null;
    }

    const result = {
      source: 'decanter',
      lens: 'panel_guide',
      score_type: 'points',
      raw_score: String(score),
      rating_count: null,
      wine_name: wineName,
      vintage_found: vintage,
      source_url: searchUrl,
      match_confidence: 'medium' // Lower confidence since we're parsing HTML
    };

    logger.info('Decanter', `Found: ${result.raw_score} points`);
    return result;

  } catch (err) {
    logger.error('Decanter', `Authenticated fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Try authenticated fetches for wine ratings.
 * Returns ratings from sources where we have valid credentials.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @returns {Promise<Object[]>} Array of ratings from authenticated sources
 */
export async function fetchAuthenticatedRatings(wineName, vintage) {
  const ratings = [];

  // Try all authenticated sources in parallel
  const [vivinoResult, cellarTrackerResult, decanterResult] = await Promise.all([
    fetchVivinoAuthenticated(wineName, vintage),
    fetchCellarTrackerAuthenticated(wineName, vintage),
    fetchDecanterAuthenticated(wineName, vintage)
  ]);

  if (vivinoResult) {
    ratings.push(vivinoResult);
  }

  if (cellarTrackerResult) {
    ratings.push(cellarTrackerResult);
  }

  if (decanterResult) {
    ratings.push(decanterResult);
  }

  return ratings;
}
