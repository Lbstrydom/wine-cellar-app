# Phase 4b: Multi-Provider Rating Search Implementation

## Overview

Replace Claude's unreliable web search with a tiered provider architecture featuring:
1. **Google Programmable Search** - Domain-restricted search on credible rating sites
2. **Brave Search API** - General web fallback
3. **Claude Parse** - Extract structured ratings from fetched pages
4. **Geographic Query Planner** - Source selection based on wine origin
5. **Quality Weighting** - Credibility × relevance scoring

---

## Environment Setup

### 1. Create/Update .env file

Add these variables to your `.env` file in the project root:

```bash
# Anthropic (already have this)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Google Programmable Search
# Get from: https://console.cloud.google.com/apis/credentials
GOOGLE_SEARCH_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Get from: https://programmablesearchengine.google.com/controlpanel/all
GOOGLE_SEARCH_ENGINE_ID=a1b2c3d4e5f6g7h8i

# Brave Search API
# Get from: https://brave.com/search/api/
BRAVE_SEARCH_API_KEY=BSAxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. Update docker-compose.synology.yml

Add the new environment variables:

```yaml
services:
  wine-cellar:
    image: ghcr.io/lbstrydom/wine-cellar-app:latest
    container_name: wine-cellar
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - GOOGLE_SEARCH_API_KEY=${GOOGLE_SEARCH_API_KEY}
      - GOOGLE_SEARCH_ENGINE_ID=${GOOGLE_SEARCH_ENGINE_ID}
      - BRAVE_SEARCH_API_KEY=${BRAVE_SEARCH_API_KEY}
```

### 3. Google Programmable Search Engine Setup

1. Go to https://programmablesearchengine.google.com/controlpanel/create
2. Name it "Wine Ratings Search"
3. Under "Sites to search", select "Search the entire web" (we'll filter in code)
4. Click Create
5. Copy the Search Engine ID
6. Enable the Custom Search API in Google Cloud Console
7. Create an API key with Custom Search API access

---

## Files to Create

### 1. Create src/config/sourceRegistry.js

```javascript
/**
 * @fileoverview Wine rating source registry with geographic and quality metadata.
 * @module config/sourceRegistry
 */

/**
 * Source lenses (methodology categories).
 */
export const LENS = {
  COMPETITION: 'competition',    // Blind panel tastings
  PANEL_GUIDE: 'panel_guide',    // Multi-taster editorial guides
  CRITIC: 'critic',              // Single critic reviews
  COMMUNITY: 'community'         // Crowd-sourced ratings
};

/**
 * Credibility weights by lens.
 * Higher = more trusted for purchase decisions.
 */
export const LENS_CREDIBILITY = {
  [LENS.COMPETITION]: 3.0,
  [LENS.PANEL_GUIDE]: 2.5,
  [LENS.CRITIC]: 1.5,
  [LENS.COMMUNITY]: 1.0
};

/**
 * Master source registry.
 * Each source has metadata for search planning and result weighting.
 */
export const SOURCE_REGISTRY = {
  // ═══════════════════════════════════════════════════════════════
  // COMPETITIONS (lens: competition, credibility: 3.0)
  // ═══════════════════════════════════════════════════════════════
  decanter: {
    name: 'Decanter World Wine Awards',
    short_name: 'DWWA',
    lens: LENS.COMPETITION,
    domain: 'decanter.com',
    home_regions: [],  // Global
    score_type: 'medal',
    query_template: '{wine} {vintage} site:decanter.com award medal',
    medal_bands: {
      platinum: { min: 97, max: 100 },
      gold: { min: 95, max: 96 },
      silver: { min: 90, max: 94 },
      bronze: { min: 86, max: 89 },
      commended: { min: 83, max: 85 }
    }
  },
  
  iwc: {
    name: 'International Wine Challenge',
    short_name: 'IWC',
    lens: LENS.COMPETITION,
    domain: 'internationalwinechallenge.com',
    home_regions: [],
    score_type: 'medal',
    query_template: '{wine} {vintage} site:internationalwinechallenge.com',
    medal_bands: {
      trophy: { min: 97, max: 100 },
      gold: { min: 95, max: 100 },
      silver: { min: 90, max: 94 },
      bronze: { min: 85, max: 89 }
    }
  },
  
  iwsc: {
    name: 'International Wine & Spirit Competition',
    short_name: 'IWSC',
    lens: LENS.COMPETITION,
    domain: 'iwsc.net',
    home_regions: [],
    score_type: 'medal',
    query_template: '{wine} {vintage} site:iwsc.net',
    medal_bands: {
      gold_outstanding: { min: 98, max: 100 },
      gold: { min: 95, max: 97 },
      silver: { min: 90, max: 94 },
      bronze: { min: 85, max: 89 }
    }
  },
  
  concours_mondial: {
    name: 'Concours Mondial de Bruxelles',
    short_name: 'CMB',
    lens: LENS.COMPETITION,
    domain: 'concoursmondial.com',
    home_regions: [],
    score_type: 'medal',
    query_template: '{wine} {vintage} site:concoursmondial.com',
    medal_bands: {
      grand_gold: { min: 92, max: 100 },
      gold: { min: 85, max: 91 },
      silver: { min: 82, max: 84 }
    }
  },
  
  mundus_vini: {
    name: 'Mundus Vini',
    short_name: 'Mundus Vini',
    lens: LENS.COMPETITION,
    domain: 'mundusvini.com',
    home_regions: [],
    score_type: 'medal',
    query_template: '{wine} {vintage} site:mundusvini.com',
    medal_bands: {
      grand_gold: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 }
    }
  },
  
  // Regional competitions
  veritas: {
    name: 'Veritas Awards',
    short_name: 'Veritas',
    lens: LENS.COMPETITION,
    domain: 'veritas.co.za',
    home_regions: ['South Africa'],
    score_type: 'medal',
    query_template: '{wine} {vintage} Veritas award',
    medal_bands: {
      double_gold: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 },
      bronze: { min: 80, max: 84 }
    }
  },
  
  old_mutual: {
    name: 'Old Mutual Trophy Wine Show',
    short_name: 'Old Mutual',
    lens: LENS.COMPETITION,
    domain: 'trophywineshow.co.za',
    home_regions: ['South Africa'],
    score_type: 'medal',
    query_template: '{wine} {vintage} Old Mutual Trophy',
    medal_bands: {
      trophy: { min: 95, max: 100 },
      gold: { min: 90, max: 94 },
      silver: { min: 85, max: 89 },
      bronze: { min: 80, max: 84 }
    }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // PANEL GUIDES (lens: panel_guide, credibility: 2.5)
  // ═══════════════════════════════════════════════════════════════
  platters: {
    name: "Platter's Wine Guide",
    short_name: "Platter's",
    lens: LENS.PANEL_GUIDE,
    domain: 'wineonaplatter.com',
    alt_domains: ['platterwineguide.com'],
    home_regions: ['South Africa'],
    score_type: 'stars',
    query_template: '{wine} {vintage} Platter\'s stars rating',
    stars_to_points: {
      5: 95, 4.5: 90, 4: 85, 3.5: 80, 3: 75
    }
  },
  
  halliday: {
    name: 'Halliday Wine Companion',
    short_name: 'Halliday',
    lens: LENS.PANEL_GUIDE,
    domain: 'winecompanion.com.au',
    home_regions: ['Australia', 'New Zealand'],
    score_type: 'points',
    query_template: '{wine} {vintage} site:winecompanion.com.au'
  },
  
  guia_penin: {
    name: 'Guía Peñín',
    short_name: 'Peñín',
    lens: LENS.PANEL_GUIDE,
    domain: 'guiapenin.com',
    home_regions: ['Spain'],
    score_type: 'points',
    query_template: '{wine} {vintage} Guía Peñín puntos'
  },
  
  gambero_rosso: {
    name: 'Gambero Rosso',
    short_name: 'Gambero Rosso',
    lens: LENS.PANEL_GUIDE,
    domain: 'gamberorosso.it',
    home_regions: ['Italy'],
    score_type: 'glasses',  // 1-3 glasses
    query_template: '{wine} {vintage} Gambero Rosso bicchieri'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // CRITICS (lens: critic, credibility: 1.5)
  // ═══════════════════════════════════════════════════════════════
  tim_atkin: {
    name: 'Tim Atkin MW',
    short_name: 'Tim Atkin',
    lens: LENS.CRITIC,
    domain: 'timatkin.com',
    home_regions: ['South Africa', 'Argentina'],
    score_type: 'points',
    query_template: '{wine} {vintage} site:timatkin.com'
  },
  
  jancis_robinson: {
    name: 'Jancis Robinson',
    short_name: 'Jancis Robinson',
    lens: LENS.CRITIC,
    domain: 'jancisrobinson.com',
    home_regions: [],  // Global, but Burgundy/Bordeaux focus
    score_type: 'points',
    points_scale: 20,  // Uses 20-point scale
    query_template: '{wine} {vintage} site:jancisrobinson.com'
  },
  
  wine_advocate: {
    name: 'Wine Advocate / Robert Parker',
    short_name: 'Wine Advocate',
    lens: LENS.CRITIC,
    domain: 'robertparker.com',
    home_regions: [],  // Global, but Bordeaux/Napa focus
    score_type: 'points',
    query_template: '{wine} {vintage} Wine Advocate OR Robert Parker points'
  },
  
  wine_spectator: {
    name: 'Wine Spectator',
    short_name: 'Wine Spectator',
    lens: LENS.CRITIC,
    domain: 'winespectator.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} site:winespectator.com'
  },
  
  james_suckling: {
    name: 'James Suckling',
    short_name: 'Suckling',
    lens: LENS.CRITIC,
    domain: 'jamessuckling.com',
    home_regions: [],
    score_type: 'points',
    query_template: '{wine} {vintage} site:jamessuckling.com'
  },
  
  descorchados: {
    name: 'Descorchados',
    short_name: 'Descorchados',
    lens: LENS.CRITIC,
    domain: 'descorchados.com',
    home_regions: ['Chile', 'Argentina'],
    score_type: 'points',
    query_template: '{wine} {vintage} Descorchados puntos'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // COMMUNITY (lens: community, credibility: 1.0)
  // ═══════════════════════════════════════════════════════════════
  vivino: {
    name: 'Vivino',
    short_name: 'Vivino',
    lens: LENS.COMMUNITY,
    domain: 'vivino.com',
    home_regions: [],  // Global
    score_type: 'stars',
    query_template: '{wine} {vintage} site:vivino.com',
    min_ratings_for_confidence: 100,
    stars_to_points: {
      4.5: 92, 4.2: 88, 4.0: 85, 3.7: 82, 3.4: 78, 3.0: 74
    }
  }
};

/**
 * Get sources relevant for a given country.
 * Returns sources sorted by expected value (credibility × relevance).
 * @param {string} country - Wine's country of origin
 * @returns {Object[]} Sorted array of source configs with relevance scores
 */
export function getSourcesForCountry(country) {
  const sources = [];
  
  for (const [id, config] of Object.entries(SOURCE_REGISTRY)) {
    const isHomeRegion = config.home_regions.length === 0 || 
                         config.home_regions.includes(country);
    
    const relevance = isHomeRegion ? 1.0 : 0.2;
    const credibility = LENS_CREDIBILITY[config.lens] || 1.0;
    const score = credibility * relevance;
    
    sources.push({
      id,
      ...config,
      relevance,
      credibility,
      score
    });
  }
  
  // Sort by score descending (highest value sources first)
  return sources.sort((a, b) => b.score - a.score);
}

/**
 * Get domains to search for a given country.
 * @param {string} country - Wine's country of origin
 * @returns {string[]} Array of domains
 */
export function getDomainsForCountry(country) {
  const sources = getSourcesForCountry(country);
  const domains = new Set();
  
  for (const source of sources) {
    if (source.relevance >= 0.5) {  // Only include relevant sources
      domains.add(source.domain);
      if (source.alt_domains) {
        source.alt_domains.forEach(d => domains.add(d));
      }
    }
  }
  
  return Array.from(domains);
}

/**
 * Get source config by ID.
 * @param {string} sourceId
 * @returns {Object|null}
 */
export function getSourceConfig(sourceId) {
  return SOURCE_REGISTRY[sourceId] || null;
}
```

### 2. Create src/services/searchProviders.js

```javascript
/**
 * @fileoverview Multi-provider search service for wine ratings.
 * @module services/searchProviders
 */

import { getDomainsForCountry, getSourcesForCountry } from '../config/sourceRegistry.js';

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
    console.warn('[Google] API not configured, skipping');
    return [];
  }
  
  // Build domain-restricted query if domains provided
  let fullQuery = query;
  if (domains.length > 0 && domains.length <= 10) {
    // Google CSE supports up to 10 site: operators
    const siteRestriction = domains.map(d => `site:${d}`).join(' OR ');
    fullQuery = `${query} (${siteRestriction})`;
  }
  
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', engineId);
  url.searchParams.set('q', fullQuery);
  url.searchParams.set('num', '10');
  
  console.log(`[Google] Searching: "${query}" across ${domains.length} domains`);
  
  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    
    if (data.error) {
      console.error('[Google] API error:', data.error.message);
      return [];
    }
    
    const results = (data.items || []).map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      source: extractDomain(item.link)
    }));
    
    console.log(`[Google] Found ${results.length} results`);
    return results;
    
  } catch (error) {
    console.error('[Google] Search failed:', error.message);
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
    console.warn('[Brave] API not configured, skipping');
    return [];
  }
  
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  
  console.log(`[Brave] Searching: "${query}"`);
  
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      console.error('[Brave] HTTP error:', response.status);
      return [];
    }
    
    const data = await response.json();
    
    const results = (data.web?.results || []).map(item => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
      source: extractDomain(item.url)
    }));
    
    console.log(`[Brave] Found ${results.length} results`);
    return results;
    
  } catch (error) {
    console.error('[Brave] Search failed:', error.message);
    return [];
  }
}

/**
 * Fetch page content for parsing.
 * @param {string} url - URL to fetch
 * @param {number} maxLength - Maximum content length
 * @returns {Promise<Object>} { content, success, error }
 */
export async function fetchPageContent(url, maxLength = 10000) {
  console.log(`[Fetch] Fetching: ${url}`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      return { content: '', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    
    // Basic HTML to text conversion
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, maxLength);
    
    console.log(`[Fetch] Got ${text.length} chars from ${extractDomain(url)}`);
    
    return { content: text, success: true, error: null };
    
  } catch (error) {
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    console.error(`[Fetch] Failed for ${url}: ${errorMsg}`);
    return { content: '', success: false, error: errorMsg };
  }
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
 * Multi-tier search for wine ratings.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {string} country - Country of origin
 * @returns {Promise<Object>} Search results with URLs and metadata
 */
export async function searchWineRatings(wineName, vintage, country) {
  const query = `"${wineName}" ${vintage} rating`;
  const domains = getDomainsForCountry(country);
  const sources = getSourcesForCountry(country);
  
  console.log(`[Search] Wine: "${wineName}" ${vintage}`);
  console.log(`[Search] Country: ${country || 'Unknown'}`);
  console.log(`[Search] Relevant domains: ${domains.slice(0, 5).join(', ')}...`);
  
  // Tier 1: Google domain-restricted search
  let results = await searchGoogle(query, domains.slice(0, 10));
  
  // Tier 2: Brave fallback if Google found < 3 results
  if (results.length < 3) {
    console.log('[Search] Tier 1 insufficient, trying Brave fallback');
    const braveResults = await searchBrave(`${wineName} ${vintage} wine rating review`);
    results = [...results, ...braveResults];
  }
  
  // Deduplicate by URL
  const seen = new Set();
  results = results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
  
  // Enrich results with source metadata
  results = results.map(r => {
    const sourceConfig = sources.find(s => 
      r.source.includes(s.domain) || 
      s.alt_domains?.some(d => r.source.includes(d))
    );
    
    return {
      ...r,
      sourceId: sourceConfig?.id || 'unknown',
      lens: sourceConfig?.lens || 'unknown',
      credibility: sourceConfig?.credibility || 0.5,
      relevance: sourceConfig?.relevance || 0.5
    };
  });
  
  // Sort by credibility × relevance
  results.sort((a, b) => (b.credibility * b.relevance) - (a.credibility * a.relevance));
  
  return {
    query,
    country,
    results: results.slice(0, 10),
    sources_searched: domains.length,
    tier1_count: results.filter(r => r.credibility >= 2).length,
    tier2_count: results.filter(r => r.credibility < 2).length
  };
}
```

### 3. Update src/services/claude.js

Replace the `fetchWineRatings` function:

```javascript
import { searchWineRatings, fetchPageContent } from './searchProviders.js';
import { SOURCE_REGISTRY, LENS_CREDIBILITY, getSourceConfig } from '../config/sourceRegistry.js';

/**
 * Fetch wine ratings using multi-provider search + Claude parse.
 * @param {Object} wine - Wine object
 * @returns {Promise<Object>} Fetched ratings
 */
export async function fetchWineRatings(wine) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const wineName = wine.wine_name || 'Unknown';
  const vintage = wine.vintage || '';
  const country = wine.country || '';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Ratings] Starting search for: ${wineName} ${vintage}`);
  console.log(`${'='.repeat(60)}`);

  // Step 1: Search for relevant pages
  const searchResults = await searchWineRatings(wineName, vintage, country);
  
  if (searchResults.results.length === 0) {
    console.log('[Ratings] No search results found');
    return {
      ratings: [],
      search_notes: 'No search results found'
    };
  }

  console.log(`[Ratings] Found ${searchResults.results.length} potential pages`);

  // Step 2: Fetch top pages (prioritize high credibility sources)
  const pagesToFetch = searchResults.results.slice(0, 5);
  const fetchPromises = pagesToFetch.map(async (result) => {
    const fetched = await fetchPageContent(result.url, 8000);
    return {
      ...result,
      content: fetched.content,
      fetchSuccess: fetched.success,
      fetchError: fetched.error
    };
  });

  const pages = await Promise.all(fetchPromises);
  const validPages = pages.filter(p => p.fetchSuccess && p.content.length > 200);
  
  console.log(`[Ratings] Successfully fetched ${validPages.length}/${pagesToFetch.length} pages`);

  if (validPages.length === 0) {
    // Return search results even if fetch failed (user can click links)
    return {
      ratings: [],
      search_notes: `Found ${searchResults.results.length} results but could not fetch page contents`,
      search_results: searchResults.results.map(r => ({
        source: r.sourceId,
        url: r.url,
        title: r.title
      }))
    };
  }

  // Step 3: Ask Claude to extract ratings from page contents
  const parsePrompt = buildExtractionPrompt(wineName, vintage, validPages);
  
  console.log('[Ratings] Sending to Claude for extraction...');
  
  const parseResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: parsePrompt }]
  });

  const responseText = parseResponse.content[0].text;
  const parsed = parseRatingResponse(responseText, 'Extraction');
  
  // Enrich ratings with source metadata
  if (parsed.ratings) {
    parsed.ratings = parsed.ratings.map(r => {
      const config = getSourceConfig(r.source);
      return {
        ...r,
        lens: config?.lens || r.lens,
        credibility: LENS_CREDIBILITY[config?.lens] || 1.0
      };
    });
  }
  
  console.log(`[Ratings] Extracted ${parsed.ratings?.length || 0} ratings`);
  console.log(`${'='.repeat(60)}\n`);

  return parsed;
}

/**
 * Build extraction prompt for Claude.
 */
function buildExtractionPrompt(wineName, vintage, pages) {
  const pageTexts = pages.map((p, i) => 
    `--- PAGE ${i + 1}: ${p.sourceId} (${p.url}) ---
Title: ${p.title}
Content:
${p.content.substring(0, 4000)}
`
  ).join('\n\n');

  return `Extract wine ratings for "${wineName}" ${vintage} from these pages.

${pageTexts}

---

TASK: Extract any ratings found for this specific wine.

For each rating, provide:
- source: Use these identifiers ONLY:
  Competitions: decanter, iwc, iwsc, concours_mondial, mundus_vini, veritas, old_mutual
  Panel Guides: platters, halliday, guia_penin, gambero_rosso
  Critics: tim_atkin, jancis_robinson, wine_advocate, wine_spectator, james_suckling, descorchados
  Community: vivino
  
- lens: "competition", "panel_guide", "critic", or "community"
- score_type: "medal", "points", or "stars"
- raw_score: The actual score (e.g., "Gold", "92", "4.2", "91/100")
- competition_year: Year of the rating if mentioned
- rating_count: Number of ratings (Vivino only)
- source_url: The page URL where you found this
- evidence_excerpt: A SHORT quote (max 50 chars) proving the rating
- vintage_match: "exact" if vintage matches, "inferred" if close vintage, "non_vintage" if NV rating
- match_confidence: "high" if clearly this wine, "medium" if probably, "low" if uncertain

Return ONLY valid JSON:
{
  "ratings": [
    {
      "source": "tim_atkin",
      "lens": "critic",
      "score_type": "points",
      "raw_score": "91",
      "competition_year": 2024,
      "rating_count": null,
      "source_url": "https://timatkin.com/...",
      "evidence_excerpt": "Springfield Special Cuvee 91/100",
      "vintage_match": "exact",
      "match_confidence": "high"
    }
  ],
  "tasting_notes": "Any tasting notes found (combine from multiple sources)",
  "search_notes": "Summary: found X ratings from Y sources"
}

RULES:
- ONLY include ratings that clearly match "${wineName}"
- Check vintage carefully - only "exact" if vintage matches exactly
- Do NOT fabricate ratings - only extract what's in the text
- Include evidence_excerpt to prove the rating exists
- For Platter's, convert stars to "stars" score_type (e.g., "4.5")
- For Jancis Robinson, scores are out of 20 (e.g., "17" means 17/20)
- If no ratings found for this wine: {"ratings": [], "search_notes": "No ratings found"}`;
}

// Keep existing parseRatingResponse function
```

### 4. Update src/routes/ratings.js

Update the fetch endpoint to handle the new response format:

```javascript
/**
 * Fetch ratings from web using multi-provider search.
 * @route POST /api/wines/:wineId/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', async (req, res) => {
  const { wineId } = req.params;

  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  try {
    const result = await fetchWineRatings(wine);

    // Delete existing auto-fetched ratings (keep manual ones)
    db.prepare(`
      DELETE FROM wine_ratings 
      WHERE wine_id = ? AND (is_user_override = 0 OR is_user_override IS NULL)
    `).run(wineId);

    // Insert new ratings
    const insertStmt = db.prepare(`
      INSERT INTO wine_ratings (
        wine_id, vintage, source, source_lens, score_type, raw_score, raw_score_numeric,
        normalized_min, normalized_max, normalized_mid,
        award_name, competition_year, rating_count,
        source_url, evidence_excerpt, matched_wine_label,
        vintage_match, match_confidence, fetched_at, is_user_override
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
    `);

    for (const rating of result.ratings || []) {
      const sourceConfig = RATING_SOURCES[rating.source];
      if (!sourceConfig) {
        console.warn(`[Ratings] Unknown source: ${rating.source}, skipping`);
        continue;
      }

      const normalized = normalizeScore(rating.source, rating.score_type, rating.raw_score);
      const numericScore = parseFloat(rating.raw_score) || null;

      insertStmt.run(
        wineId,
        wine.vintage,
        rating.source,
        rating.lens || sourceConfig.lens,
        rating.score_type,
        rating.raw_score,
        numericScore,
        normalized.min,
        normalized.max,
        normalized.mid,
        rating.award_name || null,
        rating.competition_year || null,
        rating.rating_count || null,
        rating.source_url || null,
        rating.evidence_excerpt || null,
        rating.matched_wine_label || null,
        rating.vintage_match || 'inferred',
        rating.match_confidence || 'medium'
      );
    }

    // Update aggregates
    const ratings = db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
    const prefSetting = db.prepare("SELECT value FROM user_settings WHERE key = 'rating_preference'").get();
    const preference = parseInt(prefSetting?.value || '40');
    const aggregates = calculateWineRatings(ratings, wine, preference);

    const tastingNotes = result.tasting_notes || null;

    db.prepare(`
      UPDATE wines SET
        competition_index = ?, critics_index = ?, community_index = ?,
        purchase_score = ?, purchase_stars = ?, confidence_level = ?,
        tasting_notes = COALESCE(?, tasting_notes),
        ratings_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      aggregates.competition_index,
      aggregates.critics_index,
      aggregates.community_index,
      aggregates.purchase_score,
      aggregates.purchase_stars,
      aggregates.confidence_level,
      tastingNotes,
      wineId
    );

    res.json({
      message: `Found ${result.ratings?.length || 0} ratings`,
      search_notes: result.search_notes,
      tasting_notes: tastingNotes,
      ...aggregates
    });

  } catch (error) {
    console.error('Rating fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

---

## Testing

### 1. Test Search Providers Individually

Create a test script `test-search.js`:

```javascript
import 'dotenv/config';
import { searchGoogle, searchBrave } from './src/services/searchProviders.js';

const testWine = 'Springfield Estate Special Cuvee Sauvignon Blanc';
const testVintage = '2024';

console.log('Testing Google Search...');
const googleResults = await searchGoogle(
  `"${testWine}" ${testVintage} rating`,
  ['timatkin.com', 'vivino.com', 'decanter.com']
);
console.log('Google results:', googleResults.length);
googleResults.forEach(r => console.log(`  - ${r.source}: ${r.title}`));

console.log('\nTesting Brave Search...');
const braveResults = await searchBrave(`${testWine} ${testVintage} wine rating`);
console.log('Brave results:', braveResults.length);
braveResults.forEach(r => console.log(`  - ${r.source}: ${r.title}`));
```

Run with: `node test-search.js`

### 2. Test Full Rating Fetch

In the app, search for:
1. **SA wine**: Springfield Estate Special Cuvee Sauvignon Blanc 2024
   - Should find: Tim Atkin, Vivino, possibly Platter's
2. **French wine**: Any Burgundy/Bordeaux
   - Should find: Vivino, possibly Decanter, Wine Spectator
3. **Unknown wine**: Something obscure
   - Should find: Vivino only (or nothing)

---

## Expected Logs

When searching for Springfield Estate:

```
============================================================
[Ratings] Starting search for: Springfield Estate Special Cuvee Sauvignon Blanc 2024
============================================================
[Search] Wine: "Springfield Estate Special Cuvee Sauvignon Blanc" 2024
[Search] Country: South Africa
[Search] Relevant domains: timatkin.com, vivino.com, veritas.co.za...
[Google] Searching: "Springfield Estate Special Cuvee Sauvignon Blanc" 2024 rating
[Google] Found 7 results
[Ratings] Found 7 potential pages
[Fetch] Fetching: https://timatkin.com/tasting-notes/springfield-estate-special-cuvee-sauvignon-blanc/
[Fetch] Got 3500 chars from timatkin.com
[Fetch] Fetching: https://www.vivino.com/...
[Fetch] Got 2100 chars from vivino.com
[Ratings] Successfully fetched 5/5 pages
[Ratings] Sending to Claude for extraction...
[Ratings] Extracted 3 ratings
============================================================
```

---

## Deployment

After testing locally:

```bash
# Commit changes
git add .
git commit -m "feat: replace Claude web search with multi-provider architecture"
git push

# On Synology - update .env first!
ssh Lstrydom@100.121.86.46
cd ~/Apps/wine-cellar-app

# Add API keys to .env
nano .env
# Add: GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID, BRAVE_SEARCH_API_KEY

# Pull and restart
sudo docker compose -f docker-compose.synology.yml pull
sudo docker compose -f docker-compose.synology.yml up -d
```

---

## Summary

| Component | Before | After |
|-----------|--------|-------|
| Search Provider | Claude web_search (unreliable) | Google + Brave (reliable) |
| Domain Coverage | Random | Whitelisted rating sites |
| Geographic Awareness | Hardcoded SA checks | Source registry with home_regions |
| Quality Weighting | Simple tiers | Lens credibility × regional relevance |
| Cost | Claude API only | ~$2/mo Google + Brave |
| Tim Atkin | Not found | ✅ Found via timatkin.com search |
