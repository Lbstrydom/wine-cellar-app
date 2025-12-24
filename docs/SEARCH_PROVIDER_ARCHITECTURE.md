# Wine Rating Search - Multi-Provider Architecture

## Overview

Replace Claude's unreliable web search with a tiered approach using domain-specific search (Google Programmable Search) + general fallback (Brave) + Claude for parsing.

## Architecture

```
User clicks "Search Ratings"
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    fetchWineRatings()                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Tier 1: Google Programmable Search (Domain Whitelist)│   │
│  │ - Search known rating domains only                   │   │
│  │ - Cost: $5/1K queries                                │   │
│  │ - Reliability: High (official Google API)            │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Tier 2: Brave Search API (General Fallback)          │   │
│  │ - If Tier 1 found < 2 results                        │   │
│  │ - Cost: $3/1K queries                                │   │
│  │ - Reliability: Good (own index, AI-friendly)         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Tier 3: Claude Parse                                 │   │
│  │ - Fetch top URLs from search results                 │   │
│  │ - Extract structured rating data                     │   │
│  │ - Already have Claude API access                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
    Return ratings
```

---

## Domain Whitelists

### Global Rating Sources (all wines)

```javascript
const GLOBAL_DOMAINS = [
  // Community
  'vivino.com',
  
  // Major Competitions
  'decanter.com',              // Decanter World Wine Awards
  'internationalwinechallenge.com', // IWC
  'iwsc.net',                  // IWSC
  'concoursmondial.com',       // Concours Mondial de Bruxelles
  'mundusvini.com',            // Mundus Vini
  
  // Major Critics
  'robertparker.com',          // Wine Advocate
  'winespectator.com',         // Wine Spectator
  'jamessuckling.com',         // James Suckling
  'jancisrobinson.com',        // Jancis Robinson MW
  'wine-searcher.com',         // Aggregator (useful for discovery)
];
```

### South African Sources

```javascript
const SOUTH_AFRICA_DOMAINS = [
  'timatkin.com',              // Tim Atkin SA Report
  'wineonaplatter.com',        // Platter's Guide
  'platterwineguide.com',      // Platter's alternate
  'winemag.co.za',             // SA Wine Magazine
  'veritas.co.za',             // Veritas Awards
  'trophywineshow.co.za',      // Old Mutual Trophy Wine Show
  'grape.co.za',               // Grape Magazine
];
```

### Argentine Sources

```javascript
const ARGENTINA_DOMAINS = [
  'timatkin.com',              // Tim Atkin Argentina Report
  'descorchados.com',          // Descorchados
  'winesofargentina.org',      // Wines of Argentina
];
```

### Australian/NZ Sources

```javascript
const AUSTRALIA_NZ_DOMAINS = [
  'winecompanion.com.au',      // Halliday Wine Companion
  'langtons.com.au',           // Langton's Classification
  'realmreview.com',           // Real Review (Huon Hooke)
];
```

### European Sources

```javascript
const EUROPE_DOMAINS = [
  'guiapenin.com',             // Spain - Guía Peñín
  'gamberorosso.it',           // Italy - Gambero Rosso
  'falstaff.com',              // Austria/Germany - Falstaff
  'gaultmillau.com',           // France - Gault Millau
  'revueduvindefrance.com',    // France - RVF
];
```

---

## Implementation

### 1. Environment Variables

Add to `.env`:

```bash
# Google Programmable Search
GOOGLE_SEARCH_API_KEY=your_google_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id

# Brave Search (fallback)
BRAVE_SEARCH_API_KEY=your_brave_api_key
```

### 2. Create src/services/search.js

```javascript
/**
 * @fileoverview Multi-provider search service for wine ratings.
 * @module services/search
 */

// Domain whitelists by region
const GLOBAL_DOMAINS = [
  'vivino.com',
  'decanter.com',
  'internationalwinechallenge.com',
  'iwsc.net',
  'concoursmondial.com',
  'mundusvini.com',
  'robertparker.com',
  'winespectator.com',
  'jamessuckling.com',
  'jancisrobinson.com',
  'wine-searcher.com',
];

const REGIONAL_DOMAINS = {
  'South Africa': [
    'timatkin.com',
    'wineonaplatter.com',
    'platterwineguide.com',
    'winemag.co.za',
    'veritas.co.za',
    'trophywineshow.co.za',
  ],
  'Argentina': [
    'timatkin.com',
    'descorchados.com',
    'winesofargentina.org',
  ],
  'Australia': [
    'winecompanion.com.au',
    'langtons.com.au',
  ],
  'New Zealand': [
    'winecompanion.com.au',
  ],
  'Spain': [
    'guiapenin.com',
  ],
  'Italy': [
    'gamberorosso.it',
  ],
  'France': [
    'revueduvindefrance.com',
  ],
  'Germany': [
    'falstaff.com',
  ],
  'Austria': [
    'falstaff.com',
  ],
};

/**
 * Get relevant domains for a wine based on country.
 * @param {string} country - Wine's country of origin
 * @returns {string[]} Array of domains to search
 */
export function getDomainsForCountry(country) {
  const domains = [...GLOBAL_DOMAINS];
  
  if (country && REGIONAL_DOMAINS[country]) {
    domains.push(...REGIONAL_DOMAINS[country]);
  }
  
  return [...new Set(domains)]; // Deduplicate
}

/**
 * Search using Google Programmable Search API.
 * @param {string} query - Search query
 * @param {string[]} domains - Domains to search within
 * @returns {Promise<Object[]>} Search results
 */
export async function searchGoogle(query, domains) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
  
  if (!apiKey || !engineId) {
    console.warn('[Search] Google API not configured');
    return [];
  }
  
  // Build site-restricted query
  const siteQuery = domains.length > 0 
    ? `${query} (${domains.map(d => `site:${d}`).join(' OR ')})`
    : query;
  
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', engineId);
  url.searchParams.set('q', siteQuery);
  url.searchParams.set('num', '10');
  
  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    
    if (data.error) {
      console.error('[Search] Google API error:', data.error.message);
      return [];
    }
    
    return (data.items || []).map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      source: new URL(item.link).hostname.replace('www.', '')
    }));
    
  } catch (error) {
    console.error('[Search] Google search failed:', error.message);
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
    console.warn('[Search] Brave API not configured');
    return [];
  }
  
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      }
    });
    
    const data = await response.json();
    
    return (data.web?.results || []).map(item => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
      source: new URL(item.url).hostname.replace('www.', '')
    }));
    
  } catch (error) {
    console.error('[Search] Brave search failed:', error.message);
    return [];
  }
}

/**
 * Fetch page content for parsing.
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} Page content (text)
 */
export async function fetchPageContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WineCellarBot/1.0)',
      },
      timeout: 10000,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // Basic HTML to text conversion (Claude will parse properly)
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 15000); // Limit to ~15K chars for Claude
      
  } catch (error) {
    console.error(`[Search] Failed to fetch ${url}:`, error.message);
    return '';
  }
}

/**
 * Multi-tier search for wine ratings.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {string} country - Country of origin
 * @returns {Promise<Object>} Search results with URLs and snippets
 */
export async function searchWineRatings(wineName, vintage, country) {
  const query = `${wineName} ${vintage} rating review`;
  const domains = getDomainsForCountry(country);
  
  console.log(`[Search] Query: "${query}"`);
  console.log(`[Search] Domains: ${domains.length} sources for ${country || 'global'}`);
  
  // Tier 1: Google domain-restricted search
  let results = await searchGoogle(query, domains);
  console.log(`[Search] Google found: ${results.length} results`);
  
  // Tier 2: Brave fallback if Google found < 2 results
  if (results.length < 2) {
    const braveResults = await searchBrave(query);
    console.log(`[Search] Brave fallback found: ${braveResults.length} results`);
    results = [...results, ...braveResults];
  }
  
  // Deduplicate by URL
  const seen = new Set();
  results = results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
  
  return {
    query,
    results: results.slice(0, 10), // Top 10
    sources_searched: domains.length,
  };
}
```

### 3. Update src/services/claude.js

Replace the web search approach with search + parse:

```javascript
import { searchWineRatings, fetchPageContent } from './search.js';

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

  console.log(`[Ratings] Searching for: ${wineName} ${vintage}`);

  // Step 1: Search for relevant pages
  const searchResults = await searchWineRatings(wineName, vintage, country);
  
  if (searchResults.results.length === 0) {
    return {
      ratings: [],
      search_notes: 'No search results found'
    };
  }

  // Step 2: Fetch top 3-5 pages
  const pagesToFetch = searchResults.results.slice(0, 5);
  const pageContents = await Promise.all(
    pagesToFetch.map(async (result) => {
      const content = await fetchPageContent(result.url);
      return {
        url: result.url,
        source: result.source,
        title: result.title,
        content: content.substring(0, 5000), // Limit per page
      };
    })
  );

  // Filter out empty pages
  const validPages = pageContents.filter(p => p.content.length > 100);
  
  if (validPages.length === 0) {
    return {
      ratings: [],
      search_notes: 'Could not fetch page contents'
    };
  }

  console.log(`[Ratings] Fetched ${validPages.length} pages for parsing`);

  // Step 3: Ask Claude to extract ratings from page contents
  const parsePrompt = buildParsePrompt(wineName, vintage, validPages);
  
  const parseResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: parsePrompt }]
  });

  const responseText = parseResponse.content[0].text;
  return parseRatingResponse(responseText, 'Multi-source');
}

/**
 * Build prompt for Claude to parse page contents.
 */
function buildParsePrompt(wineName, vintage, pages) {
  const pageTexts = pages.map((p, i) => 
    `--- PAGE ${i + 1}: ${p.source} (${p.url}) ---\n${p.content}`
  ).join('\n\n');

  return `Extract wine ratings for "${wineName}" ${vintage} from these pages.

${pageTexts}

---

For each rating found, extract:
- source: Use these identifiers: vivino, decanter, iwc, iwsc, concours_mondial, mundus_vini, veritas, old_mutual, tim_atkin, platters, wine_advocate, wine_spectator, james_suckling, jancis_robinson, decanter_magazine
- lens: "competition" for medals, "critics" for critic scores, "community" for Vivino
- score_type: "medal" for Gold/Silver/Bronze, "points" for numeric scores, "stars" for star ratings
- raw_score: The actual score (e.g., "Gold", "92", "4.2")
- competition_year: Year if mentioned
- rating_count: Number of ratings (Vivino only)
- source_url: The page URL
- match_confidence: "high" if exact match, "medium" if close, "low" if uncertain

Return ONLY valid JSON:
{
  "ratings": [...],
  "tasting_notes": "Any tasting notes found",
  "search_notes": "Summary of what was found"
}

Rules:
- Only include ratings that clearly match "${wineName}" ${vintage}
- Don't fabricate ratings - only extract what's actually in the text
- If a page doesn't contain a rating for this wine, skip it
- For Vivino, include the rating_count if visible`;
}
```

---

## Setup Instructions

### 1. Google Programmable Search Engine

1. Go to https://programmablesearchengine.google.com/
2. Create new search engine
3. Add sites to search (or leave blank for whole web, then filter in code)
4. Get your Search Engine ID
5. Go to https://console.cloud.google.com/
6. Enable "Custom Search API"
7. Create API key

### 2. Brave Search API

1. Go to https://brave.com/search/api/
2. Sign up for API access
3. Get your API key

### 3. Environment Variables

Add to your `.env`:

```bash
GOOGLE_SEARCH_API_KEY=AIza...
GOOGLE_SEARCH_ENGINE_ID=abc123...
BRAVE_SEARCH_API_KEY=BSA...
```

---

## Cost Estimate

| Usage | Provider | Queries/mo | Cost |
|-------|----------|------------|------|
| 100 wines searched | Google | 100 | $0.50 |
| 30 fallbacks | Brave | 30 | $0.09 |
| Claude parsing | Anthropic | 100 | ~$0.50 |
| **Total** | | | **~$1-2/mo** |

Compare to SerpAPI at $50/mo.

---

## Caching Strategy

Add caching to reduce costs further:

```javascript
// In src/services/search.js

const searchCache = new Map();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function searchWineRatingsWithCache(wineName, vintage, country) {
  const cacheKey = `${wineName}|${vintage}|${country}`;
  
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[Search] Cache hit');
    return cached.data;
  }
  
  const results = await searchWineRatings(wineName, vintage, country);
  
  searchCache.set(cacheKey, {
    data: results,
    timestamp: Date.now()
  });
  
  return results;
}
```

---

## Summary

This approach:
1. Uses **known, credible domains** (whitelisted)
2. Uses **official Google API** (stable, legal)
3. Falls back to **Brave** (own index, AI-friendly)
4. Lets **Claude parse** the actual page content
5. Costs **~$1-2/month** instead of $50

And most importantly: **it will actually find Tim Atkin** because we're searching directly on timatkin.com via Google's index.
