/**
 * @fileoverview Multi-provider search service for wine ratings.
 * @module services/searchProviders
 */

import { getDomainsForCountry, getSourcesForCountry } from '../config/sourceRegistry.js';
import logger from '../utils/logger.js';

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

  return { relevant, score };
}

/**
 * Check if a search result is relevant to the wine (legacy wrapper).
 * @param {Object} result - Search result
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage
 * @returns {boolean} True if relevant
 */
function isResultRelevant(result, wineName, vintage) {
  return calculateResultRelevance(result, wineName, vintage).relevant;
}

/**
 * Multi-tier search for wine ratings.
 * Runs Google and Brave searches in parallel for better coverage.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {string} country - Country of origin
 * @returns {Promise<Object>} Search results
 */
export async function searchWineRatings(wineName, vintage, country) {
  const sources = getSourcesForCountry(country);
  const topSources = sources.slice(0, 8); // Top 8 by credibility × relevance
  const wineNameVariations = generateWineNameVariations(wineName);

  logger.separator();
  logger.info('Search', `Wine: "${wineName}" ${vintage}`);
  logger.info('Search', `Country: ${country || 'Unknown'}`);
  logger.info('Search', `Name variations: ${wineNameVariations.join(', ')}`);
  logger.info('Search', `Top sources: ${topSources.map(s => s.id).join(', ')}`);

  // Strategy 1: Targeted searches for diverse sources
  // Include top competitions AND top critics for balanced coverage
  const targetedResults = [];

  // Get top 3 competitions
  const topCompetitions = topSources.filter(s => s.lens === 'competition').slice(0, 3);
  // Get top 2 critics (James Suckling, Wine Spectator, etc.) - lens is 'critic' not 'critics'
  const topCritics = topSources.filter(s => s.lens === 'critic' || s.lens === 'panel_guide').slice(0, 2);

  const prioritySources = [...topCompetitions, ...topCritics].slice(0, 5);
  logger.info('Search', `Targeted sources: ${prioritySources.map(s => s.id).join(', ')}`);

  for (const source of prioritySources) {
    const query = buildSourceQuery(source, wineName, vintage);
    logger.info('Search', `Targeted search for ${source.id}: "${query}"`);

    const results = await searchGoogle(query, [source.domain]);
    if (results.length > 0) {
      targetedResults.push(...results.map(r => ({
        ...r,
        sourceId: source.id,
        lens: source.lens,
        credibility: source.credibility,
        relevance: source.relevance
      })));
    }
  }

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
  let variationResults = [];
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
      const { relevant, score } = calculateResultRelevance(r, wineName, vintage);
      return { ...r, relevant, relevanceScore: score };
    })
    .filter(r => r.relevant);

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
    results: enrichedResults.slice(0, 10),
    sources_searched: topSources.length,
    targeted_hits: targetedResults.length,
    broad_hits: broadResults.length,
    brave_hits: braveResults.length,
    variation_hits: variationResults.length
  };
}
