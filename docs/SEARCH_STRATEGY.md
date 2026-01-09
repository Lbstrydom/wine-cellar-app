# Wine Rating & Tasting Notes Search Strategy

## Expert Review Document

This document explains how the Wine Cellar App discovers and retrieves wine ratings, tasting notes, and awards from external sources. It covers the complete pipeline from wine entry to aggregated scores.

---

## Executive Summary

The app uses a **multi-tier search strategy** combining:
- **Google Custom Search API** for initial discovery
- **Bright Data SERP API** as primary search provider (with Google fallback)
- **Bright Data Web Unlocker** for scraping JavaScript-rendered and bot-protected sites
- **Claude AI** for parsing unstructured content into structured data

Key architectural decisions:
- 70+ sources organized into 6 credibility-weighted categories
- Country/grape-aware source prioritization
- Multi-level caching (SERP results, page content, aggregated ratings)
- Circuit breaker and rate limiting for external service protection
- Structured provenance tracking for audit trails

---

## 1. Source Registry

All sources are defined in `src/config/unifiedSources.js` with metadata for normalization, credibility, and access patterns.

### Source Categories (Lenses)

| Lens | Credibility Multiplier | Examples |
|------|----------------------|----------|
| **Competitions** | 3.0x | Decanter WWA, IWC, IWSC, Mundus Vini, Veritas, Old Mutual Trophy |
| **Panel Guides** | 2.5x | Platter's (SA), Halliday (AU), Gambero Rosso (IT), Guía Peñín (ES), Guide Hachette (FR) |
| **Critics** | 1.5x | Wine Advocate, Wine Spectator, James Suckling, Jancis Robinson, Vinous |
| **Community** | 1.0x | Vivino, CellarTracker, WineAlign |
| **Aggregators** | 0.85x | Wine-Searcher, Dan Murphy's, Bodeboca, Wine.co.za |
| **Producer Sites** | Variable | Official winery award pages |

### Score Format Normalization

Different sources use different scoring systems. Each source definition includes a `normalize` function:

```javascript
// 100-point scales (most critics)
normalize: (s) => s  // Already 0-100

// 20-point scales (France, Germany)
normalize: (s) => (s - 10) * 10  // 15/20 → 50, 20/20 → 100

// 5-star scales (Vivino, Platter's)
normalize: (s) => (s - 1) * 25   // 4.0★ → 75, 5.0★ → 100

// Medal systems
normalize: (s) => {
  'Grand Gold': 98, 'Gold': 92, 'Silver': 85, 'Bronze': 78
}[s]

// Symbolic ratings
normalize: (s) => {
  'Tre Bicchieri': 95,     // Gambero Rosso top award
  'Due Bicchieri Rossi': 90,
  'Coup de Cœur': 92       // Guide Hachette heart symbol
}[s]
```

### Regional Source Priority

Sources are prioritized by wine origin country:

```javascript
REGION_SOURCE_PRIORITY = {
  'South Africa': ['platters', 'wine-co-za', 'veritas', 'old-mutual', 'tim-atkin-sa'],
  'Australia':    ['halliday', 'huon-hooke', 'gourmet-traveller', 'dan-murphys'],
  'France':       ['hachette', 'rvf', 'bettane-desseauve', 'jancis-robinson'],
  'Italy':        ['gambero-rosso', 'bibenda', 'doctor-wine', 'vinous'],
  'Spain':        ['guia-penin', 'guia-proensa', 'bodeboca'],
  'USA':          ['wine-spectator', 'wine-enthusiast', 'wine-advocate'],
  'Germany':      ['falstaff', 'vinum', 'weinwisser'],
  // ... etc
}
```

---

## 2. Search Flow

When ratings are requested for a wine, the system executes a multi-tier search strategy.

### Phase 1: Wine Analysis

```
Input: { name: "Kleine Zalze Chenin Blanc", vintage: 2021, country: "South Africa" }
         ↓
    Grape Detection → "Chenin Blanc" (from name parsing)
         ↓
    Country Inference → if missing, infer from style/name patterns
         ↓
    Source Selection → SA-specific sources (Platter's, Veritas, Tim Atkin)
```

### Phase 2: Targeted Searches

Each search tier uses site-restricted Google queries:

**Tier 1: Grape-Specific Competitions**
```
"Kleine Zalze Chenin Blanc 2021 site:veritas.co.za medal OR award"
"Kleine Zalze Chenin Blanc 2021 site:winesofsa.co.uk trophy"
```

**Tier 2: Top Regional Critics**
```
"Kleine Zalze Chenin Blanc 2021 site:platterswineguide.com rating"
"Kleine Zalze Chenin Blanc 2021 site:timatkin.com score"
```

**Tier 3: Global Community**
```
"Kleine Zalze Chenin Blanc 2021 site:vivino.com stars rating"
"Kleine Zalze Chenin Blanc 2021 site:cellartracker.com review"
```

**Tier 4: Name Variations** (if results < 5)
- Remove parenthetical content: "Estate Selection" → stripped
- Remove descriptors: "Selected Vineyards" → stripped
- Normalize accents: "Château" → "Chateau"

**Tier 5: Producer Website Discovery**
- Extract producer: "Kleine Zalze" from wine name
- Search: "Kleine Zalze winery official site awards"
- Filter out retailers (Dan Murphy's, Wine-Searcher, etc.)

### Result Relevance Scoring

Each search result is scored for relevance before scraping:

| Factor | Points |
|--------|--------|
| Wine name exact match in title | +15 |
| Wine name fuzzy match (80%+ similarity) | +8 |
| Vintage appears in title | +5 |
| Rating/review page indicators | +3 |
| Producer official site | +5 |
| Known review URL pattern | +3 |

Results with score < 5 are discarded.

---

## 3. Search API Integration

### Primary: Bright Data SERP API

```javascript
// Configuration
BRIGHTDATA_API_KEY = "..."
BRIGHTDATA_SERP_ZONE = "serp_zone_name"

// Request
POST https://api.brightdata.com/request
{
  zone: "serp_zone_name",
  query: "Kleine Zalze Chenin Blanc 2021 site:vivino.com",
  country: "za",  // Local search results
  format: "json"
}

// Response
{
  organic: [
    {
      title: "Kleine Zalze Chenin Blanc 2021 - Vivino",
      url: "https://www.vivino.com/kleine-zalze-chenin-blanc/2021",
      snippet: "4.0 rating · 2,156 ratings · From South Africa..."
    }
  ]
}
```

### Fallback: Google Custom Search API

Used when Bright Data is unavailable or quota exceeded:

```javascript
// Configuration
GOOGLE_SEARCH_API_KEY = "..."
GOOGLE_SEARCH_ENGINE_ID = "..."

// Request
GET https://www.googleapis.com/customsearch/v1
?key={API_KEY}
&cx={ENGINE_ID}
&q=Kleine+Zalze+Chenin+Blanc+2021+site:vivino.com
&num=10

// Response
{
  items: [
    {
      title: "Kleine Zalze Chenin Blanc 2021",
      link: "https://www.vivino.com/...",
      snippet: "..."
    }
  ]
}
```

### SERP Result Caching

To minimize API costs, SERP results are cached:

```javascript
// Cache key: hash of query parameters
getCachedSerpResults({ query, source, vintage })

// Cache entry includes:
{
  results: [...],
  cachedAt: timestamp,
  ttl: 7 days  // SERP results age more slowly
}
```

---

## 4. Page Content Fetching

Once relevant URLs are identified, the app fetches and parses page content.

### Path A: Direct Fetch (Accessible Sites)

For sites without bot protection:

```javascript
fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9'
  },
  timeout: 10000  // 10 seconds
})
```

### Path B: Bright Data Web Unlocker (Protected Sites)

For sites with CloudFront WAF, Cloudflare, or JavaScript rendering:

```javascript
// Configuration
BRIGHTDATA_WEB_ZONE = "web_unlocker_zone"

// Request
POST https://api.brightdata.com/request
{
  zone: "web_unlocker_zone",
  url: "https://www.vivino.com/kleine-zalze-chenin-blanc/2021",
  format: "raw",       // Full HTML
  data_format: "markdown",  // Or pre-converted markdown
  render_js: true,     // Execute JavaScript
  wait_for: ".rating"  // Wait for rating element (Vivino SPA)
}

// Timeout: 30 seconds (proxy overhead)
```

### Sites Requiring Web Unlocker

| Site | Reason | Special Handling |
|------|--------|------------------|
| **Vivino** | CloudFront WAF + React SPA | Wait for `.rating` element, extract from `__NEXT_DATA__` |
| **Decanter** | Cloudflare | Standard Web Unlocker |
| **Wine-Searcher** | Bot detection | Standard Web Unlocker |
| **Dan Murphy's** | Cloudflare | Standard Web Unlocker |
| **Bodeboca** | Bot detection | Standard Web Unlocker |

### Content Extraction

After fetching, content is cleaned and structured:

```javascript
// 1. Remove noise
stripTags(['script', 'style', 'nav', 'footer', 'aside'])

// 2. Extract structured data
// Many sites embed JSON-LD or __NEXT_DATA__
const jsonLd = extractJsonLd(html);
if (jsonLd?.aggregateRating) {
  return {
    score: jsonLd.aggregateRating.ratingValue,
    count: jsonLd.aggregateRating.ratingCount,
    source: 'json-ld'
  };
}

// 3. Vivino special case - SPA data in script tag
const nextData = html.match(/__NEXT_DATA__.*?({.*?})<\/script>/);
if (nextData) {
  const data = JSON.parse(nextData[1]);
  return {
    score: data.props.pageProps.vintage.statistics.ratings_average,
    count: data.props.pageProps.vintage.statistics.ratings_count
  };
}

// 4. Fallback to AI extraction
return await extractWithClaude(cleanedHtml);
```

---

## 5. AI-Powered Extraction

When structured data isn't available, Claude parses the content.

### Rating Extraction

```javascript
const prompt = `Extract wine rating information from this content:

${pageContent}

Return JSON:
{
  "score": <number 0-100 or original scale>,
  "scale": <"100" | "20" | "5star" | "medal">,
  "source": <"Wine Spectator" | "Vivino" | etc>,
  "vintage": <number or null>,
  "confidence": <"high" | "medium" | "low">,
  "evidence": <quote from page supporting the rating>
}`;

const response = await claude.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 500
});
```

### Tasting Notes Extraction

For converting prose notes to structured profiles:

```javascript
// Input
"This wine shows intense blackcurrant and plum with hints of
violet and graphite. Full-bodied with silky tannins and fresh acidity."

// Output (structured to controlled vocabulary)
{
  "nose": {
    "primary_fruit": ["blackcurrant", "plum"],
    "secondary": ["violet", "graphite"],
    "intensity": "pronounced"
  },
  "palate": {
    "body": "full",
    "tannin": "silky",
    "acidity": "fresh"
  },
  "style_tags": ["full_bodied", "fruit_forward"]
}
```

The controlled vocabulary (`src/config/tastingVocabulary.js`) includes 170+ standardized terms to ensure consistent tagging across sources.

### Drinking Window Extraction

```javascript
// Patterns recognized
"Drink 2024-2030"
"Best from 2025"
"Drink now through 2028"
"Peak 2026-2029"

// Output
{
  "drink_from": 2024,
  "drink_peak": 2027,
  "drink_until": 2030,
  "confidence": "high",  // Direct statement
  "source": "decanter"
}
```

---

## 6. Rate Limiting

Each source lens has different rate limits to respect server resources:

```javascript
RATE_LIMITS = {
  competition: 2000,    // 2 seconds between requests
  panel_guide: 3000,    // 3 seconds
  critic: 5000,         // 5 seconds (personal sites)
  community: 1000,      // 1 second (APIs designed for load)
  aggregator: 2000,     // 2 seconds
  producer: 5000,       // 5 seconds (small sites)
  default: 3000         // 3 seconds
}
```

Implementation uses a per-source queue:

```javascript
async function waitForRateLimit(sourceId, minDelayMs) {
  const lastRequest = lastRequestTime[sourceId] || 0;
  const elapsed = Date.now() - lastRequest;

  if (elapsed < minDelayMs) {
    await sleep(minDelayMs - elapsed);
  }

  lastRequestTime[sourceId] = Date.now();
}
```

---

## 7. Circuit Breaker

Protects against repeatedly failing sources:

```
CLOSED (normal operation)
    │
    ├─ 3 failures
    ▼
OPEN (fast-fail for 1 hour)
    │
    ├─ 1 hour elapsed
    ▼
HALF_OPEN (test with single request)
    │
    ├─ Success → CLOSED
    ├─ Failure → OPEN (24 hour extended timeout)
```

```javascript
// Usage
if (isCircuitOpen('vivino')) {
  return { status: 'CIRCUIT_OPEN', message: 'Source temporarily unavailable' };
}

try {
  const result = await fetchFromVivino(wine);
  recordSuccess('vivino');
  return result;
} catch (error) {
  recordFailure('vivino', error);
  throw error;
}
```

---

## 8. Governance Wrapper

All external calls go through a unified governance layer (`src/services/scrapingGovernance.js`):

```javascript
async function withGovernance(sourceId, wineId, fieldName, scrapeFn) {
  // 1. Check cache first
  const cached = await getCached(sourceId, wineId, fieldName);
  if (cached && !isExpired(cached)) {
    return { status: 'CACHED', data: cached.data };
  }

  // 2. Check circuit breaker
  if (isCircuitOpen(sourceId)) {
    return { status: 'CIRCUIT_OPEN' };
  }

  // 3. Apply rate limiting
  await waitForRateLimit(sourceId);

  // 4. Execute scrape
  try {
    const data = await scrapeFn();

    // 5. Record success
    recordSuccess(sourceId);

    // 6. Save provenance
    await saveProvenance(wineId, fieldName, sourceId, {
      retrievedAt: new Date(),
      expiresAt: new Date(Date.now() + TTL),
      confidence: data.confidence
    });

    // 7. Cache result
    await cache(sourceId, wineId, fieldName, data);

    return { status: 'SUCCESS', data };
  } catch (error) {
    recordFailure(sourceId, error);
    return { status: 'ERROR', error: error.message };
  }
}
```

---

## 9. Rating Aggregation

After collecting ratings from multiple sources, they're aggregated into a purchase score.

### Normalization Pipeline

```
Raw Ratings (various scales)
    ↓
Normalize to 0-100
    ↓
Filter by Vintage Match
    - Exact match: full weight
    - Different vintage: 0.7x weight
    - No vintage: 0.5x weight
    ↓
Group by Lens
    ↓
Calculate Weighted Median per Lens
    - Weight = Credibility × Region Relevance
    ↓
Calculate Confidence per Lens
    - Factors: count, variance, vintage match quality
```

### Purchase Score Calculation

```javascript
function calculatePurchaseScore(lensScores, userPreference) {
  // userPreference: -100 (favor community) to +100 (favor competition)

  const competitionWeight = 0.5 + (userPreference / 200);  // 0.0 to 1.0
  const criticsWeight = 0.3;  // Fixed
  const communityWeight = 0.5 - (userPreference / 200);    // 1.0 to 0.0

  return (
    lensScores.competition * competitionWeight +
    lensScores.critics * criticsWeight +
    lensScores.community * communityWeight
  ) / (competitionWeight + criticsWeight + communityWeight);
}
```

### Output Structure

```javascript
{
  // Individual lens scores (0-100)
  competition_index: 92,
  critics_index: 88,
  community_index: 85,

  // Aggregated score
  purchase_score: 89,

  // Display values
  stars: 4.5,  // 0-5 scale

  // Quality indicators
  confidence: 'high',  // high | medium | low
  rating_count: 8,     // Total ratings found

  // Per-lens details
  lens_details: {
    competition: {
      count: 2,
      sources: ['decanter-wwwa', 'veritas'],
      confidence: 0.95
    },
    critics: {
      count: 3,
      sources: ['platters', 'tim-atkin', 'jancis-robinson'],
      confidence: 0.85
    },
    community: {
      count: 3,
      sources: ['vivino', 'cellartracker', 'wine-searcher'],
      confidence: 0.90
    }
  }
}
```

---

## 10. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER ENTRY POINT                             │
│              Wine scan / manual entry / label photo                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         WINE ANALYSIS                               │
│                                                                     │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐  │
│   │   Grape     │   │  Country    │   │   Source                │  │
│   │  Detection  │──▶│  Inference  │──▶│   Prioritization        │  │
│   └─────────────┘   └─────────────┘   └─────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MULTI-TIER SEARCH                              │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │  Bright Data SERP API (primary)                              │ │
│   │  Google Custom Search API (fallback)                         │ │
│   └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│   Tier 1: Grape competitions    ─────────────────┐                 │
│   Tier 2: Regional critics      ─────────────────┼──▶ Results      │
│   Tier 3: Global community      ─────────────────┤                 │
│   Tier 4: Name variations       ─────────────────┤                 │
│   Tier 5: Producer websites     ─────────────────┘                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     RELEVANCE FILTERING                             │
│                                                                     │
│   Score each result:                                                │
│   - Title/snippet matches (+3 to +15 points)                        │
│   - Vintage presence (+5 points)                                    │
│   - Review page pattern (+3 points)                                 │
│   - Producer site bonus (+5 points)                                 │
│                                                                     │
│   Filter: score >= 5, dedupe by URL                                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GOVERNANCE LAYER                                 │
│                                                                     │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐  │
│   │   Cache     │   │  Circuit    │   │   Rate                  │  │
│   │   Check     │──▶│  Breaker    │──▶│   Limiter               │  │
│   └─────────────┘   └─────────────┘   └─────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CONTENT FETCH                                  │
│                                                                     │
│   ┌────────────────────────┐    ┌────────────────────────────────┐ │
│   │   Direct Fetch         │    │   Bright Data Web Unlocker     │ │
│   │   (accessible sites)   │    │   (protected sites)            │ │
│   │   Timeout: 10s         │    │   Timeout: 30s                 │ │
│   └────────────────────────┘    └────────────────────────────────┘ │
│                                                                     │
│   Protected: Vivino, Decanter, Wine-Searcher, Dan Murphy's         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     DATA EXTRACTION                                 │
│                                                                     │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐  │
│   │   JSON-LD       │   │  __NEXT_DATA__  │   │  Claude AI      │  │
│   │   (structured)  │   │  (SPAs)         │   │  (unstructured) │  │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘  │
│                                                                     │
│   Extract: score, scale, source, vintage, tasting notes, window    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AGGREGATION                                    │
│                                                                     │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐  │
│   │  Normalize  │   │  Group by   │   │   Calculate             │  │
│   │  to 0-100   │──▶│  Lens       │──▶│   Weighted Median       │  │
│   └─────────────┘   └─────────────┘   └─────────────────────────┘  │
│                                                                     │
│   Output: competition_index, critics_index, community_index,        │
│           purchase_score, stars, confidence                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE                                    │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │  wine_ratings table                                         │  │
│   │  - source_id, score, normalized_score, scale                │  │
│   │  - vintage_match (exact, inferred, assumed)                 │  │
│   │  - evidence (quote from page)                               │  │
│   │  - source_url                                               │  │
│   │  - is_user_override                                         │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │  data_provenance table                                      │  │
│   │  - wine_id, field_name, source_id                           │  │
│   │  - retrieved_at, expires_at                                 │  │
│   │  - confidence, raw_hash                                     │  │
│   └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 11. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GOOGLE_SEARCH_API_KEY` | For fallback | Google Custom Search API key |
| `GOOGLE_SEARCH_ENGINE_ID` | For fallback | Google CSE engine ID |
| `BRIGHTDATA_API_KEY` | Primary | Bright Data account API key |
| `BRIGHTDATA_SERP_ZONE` | Primary | Zone for search queries |
| `BRIGHTDATA_WEB_ZONE` | Primary | Zone for Web Unlocker (protected sites) |
| `ANTHROPIC_API_KEY` | Yes | Claude for AI extraction |

---

## 12. Key Files

| File | Purpose |
|------|---------|
| `src/config/unifiedSources.js` | 70+ source definitions with normalization |
| `src/services/searchProviders.js` | Multi-tier search logic, content fetching |
| `src/services/ratings.js` | Aggregation, normalization, purchase score |
| `src/services/rateLimiter.js` | Per-source rate limiting |
| `src/services/circuitBreaker.js` | Failure protection |
| `src/services/scrapingGovernance.js` | Unified wrapper combining all patterns |
| `src/services/tastingExtractor.js` | AI-powered tasting note parsing |
| `src/services/provenance.js` | Data origin tracking |
| `src/config/tastingVocabulary.js` | 170+ controlled tasting terms |
| `src/routes/ratings.js` | API endpoints for rating fetch |

---

## 13. Optimization Strategies

### Current Optimizations

1. **Multi-level caching** - SERP results (7 days), page content (24 hours), aggregated ratings (until slot change)

2. **Parallel source searches** - Country-specific sources searched concurrently

3. **Early exit** - If high-confidence competition + critic ratings found, skip community

4. **Structured data preference** - JSON-LD/embedded JSON before AI parsing

5. **Batch operations** - Multiple wines can share SERP queries for same source

### Potential Improvements

1. **Predictive caching** - Pre-fetch ratings for wines in "reduce now" list

2. **Collaborative filtering** - Use other users' successful matches to guide searches

3. **Source health monitoring** - Track success rates to deprioritize unreliable sources

4. **Embedding search** - Use wine embeddings to find similar wines with ratings

---

## 14. Quality Indicators

### Confidence Calculation

```javascript
confidence = calculateConfidence({
  sourceCount,      // More sources = higher
  scoreVariance,    // Lower variance = higher
  vintageMatch,     // Exact > inferred > assumed
  lensBalance,      // Coverage across competition/critics/community
  recency           // Recent ratings > old ratings
});
```

### Vintage Sensitivity

Different wine types have different vintage tolerance:

```javascript
VINTAGE_SENSITIVITY = {
  'Champagne':     'low',    // NV common, vintage less critical
  'Port':          'low',    // Long-lived, vintage less critical
  'Burgundy':      'high',   // Highly vintage-dependent
  'Bordeaux':      'high',   // Highly vintage-dependent
  'New World Red': 'medium', // Moderate variance
  'Entry White':   'low'     // Drink young, vintage less critical
}
```

---

## 15. Error Handling

### Graceful Degradation

```
Full search → Partial results → Cached results → No results

If Bright Data fails:
  → Fallback to Google Custom Search

If all SERP fails:
  → Return cached ratings if available

If content fetch fails:
  → Record circuit breaker failure
  → Continue with other sources

If AI extraction fails:
  → Return raw data for manual review
```

### User Feedback

When ratings are incomplete, the UI shows:

- Source count: "Based on 3 sources"
- Confidence indicator: High/Medium/Low badge
- Missing lens indicator: "No competition ratings found"
- Action button: "Search again" / "Add manual rating"

---

*Document created: 9 January 2026*
*For review by: Wine search strategy expert*
