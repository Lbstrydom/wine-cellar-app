# Wine Rating Search - Technical Report

**Date:** December 2024
**Status:** Production (with known limitations)

---

## Executive Summary

The wine rating search system aggregates ratings from multiple sources using a multi-tier strategy: authenticated API access where possible, followed by web search with page fetching, falling back to search snippet extraction. The system supports 40+ rating sources across competitions, critics, panel guides, and community platforms.

**Current State:**
- ✅ Web search + Claude extraction working
- ✅ Decanter authenticated access working (with fix for relative URLs)
- ⚠️ Vivino blocked by CloudFront WAF (snippet fallback works)
- ❌ CellarTracker credentials removed (only searched user's cellar, not global DB)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        fetchWineRatings()                           │
│                         (claude.js:335)                             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐     ┌─────────────────┐     ┌─────────────────────┐
│ Authenticated │     │   Web Search    │     │  Snippet Fallback   │
│    Sources    │     │ (Google/Brave)  │     │  (if pages blocked) │
└───────┬───────┘     └────────┬────────┘     └──────────┬──────────┘
        │                      │                         │
        ▼                      ▼                         ▼
┌───────────────┐     ┌─────────────────┐     ┌─────────────────────┐
│ - Vivino API  │     │ fetchPageContent│     │ Claude extracts     │
│   (blocked)   │     │ (top 8 results) │     │ from title+snippet  │
│ - Decanter    │     └────────┬────────┘     └─────────────────────┘
│   (working)   │              │
└───────────────┘              ▼
                      ┌─────────────────┐
                      │ Claude extracts │
                      │  from HTML/text │
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │  Merge Results  │
                      │ (dedupe, enrich │
                      │  with metadata) │
                      └─────────────────┘
```

---

## Data Flow Detail

### Step 1: Authenticated Sources (searchProviders.js:1374-1395)

**Entry Point:** `fetchAuthenticatedRatings(wineName, vintage)`

Attempts direct API/scraping access for sources where user has stored credentials:

| Source | Status | Method | Limitation |
|--------|--------|--------|------------|
| **Vivino** | ⚠️ Blocked | Login → API search | CloudFront WAF blocks server-side requests |
| **Decanter** | ✅ Working | Login → Search → Parse review page | Requires valid subscription |
| **CellarTracker** | ❌ Removed | xlquery.asp API | Only searched user's personal cellar |

**Vivino Flow (searchProviders.js:1033-1151):**
```
1. POST /api/login with credentials
2. Extract session cookies
3. GET /api/explore/explore?q={wine}
4. Parse JSON response for rating
```
→ Usually fails at step 3 due to CloudFront blocking

**Decanter Flow (searchProviders.js:1165-1463):**
```
1. POST /wp-login.php with credentials
2. Extract session cookies from 302 redirect
3. GET /?s={wine}&post_type=wine with cookies
4. Parse HTML for review URL (absolute OR relative)
5. GET review page with cookies
6. Extract score via multiple patterns:
   - itemprop="ratingValue"
   - data-rating attribute
   - class="rating" spans
   - "XX points" text pattern
7. Extract drinking window if present
```

### Step 2: Web Search (searchProviders.js:824-976)

**Entry Point:** `searchWineRatings(wineName, vintage, country)`

**Source Selection Logic:**
1. Detect grape variety from wine name (Chardonnay, Shiraz, etc.)
2. Get region-prioritized sources from `REGION_SOURCE_PRIORITY`
3. Add grape-specific competitions (Chardonnay du Monde, etc.)
4. Include global competitions and critics

**Search Strategy:**
```javascript
// Parallel targeted searches for priority sources
prioritySources = [grapeCompetitions, topCompetitions, topCritics].slice(0, 6)
for each source:
  Google: "{wine}" {vintage} site:{domain}

// Broad search in parallel
Google: "{wine}" {vintage} rating (across remaining domains)
Brave:  {wine} {vintage} wine rating review

// Name variation fallback (if <5 results)
Brave: {variation} {vintage} wine rating
```

**Relevance Scoring (searchProviders.js:749-802):**
```javascript
score = 0
score += titleMatchCount * 3      // Wine name words in title
score += snippetMatchCount * 1    // Wine name words in snippet
score += hasVintageInTitle ? 5 : 0
score += hasVintageInSnippet ? 2 : 0
score += isRatingPage ? 3 : 0
score += isProducerSite ? 5 : 0   // Winery's own website
score -= isGenericAwardPage ? 5 : 0
```

### Step 3: Page Fetching (searchProviders.js:470-577)

**Entry Point:** `fetchPageContent(url, maxLength=8000)`

For each of top 8 search results:
1. Fetch with 10s timeout
2. Check for blocking indicators (captcha, cloudflare, consent)
3. Special Vivino handling: extract from `__NEXT_DATA__` JSON
4. Strip HTML (scripts, styles, nav, footer)
5. Return success/failure with detailed status

**Blocking Detection:**
```javascript
isBlocked = html.length < 500 && (
  html.includes('captcha') ||
  html.includes('consent') ||
  html.includes('cloudflare') ||
  html.includes('access denied')
)
```

### Step 4: Claude Extraction (claude.js:457-500)

**Full Page Extraction:**
- Sends up to 8 page contents (4000 chars each) to Claude
- Prompt instructs extraction of: source, lens, score_type, raw_score, normalised_score, drinking_window, evidence_excerpt
- Supports 50+ source identifiers and score formats

**Snippet Fallback (claude.js:394-454):**
- Triggered when no pages could be fetched (all blocked)
- Extracts from search result titles + snippets
- Lower confidence ("medium" instead of "high")

---

## Source Registry (sourceRegistry.js)

### Lens Categories & Credibility Weights

| Lens | Credibility | Description |
|------|-------------|-------------|
| `competition` | 3.0x | Blind-tasted medal competitions |
| `panel_guide` | 2.5x | Multi-critic panels/guides |
| `critic` | 1.5x | Individual expert reviews |
| `community` | 1.0x | User ratings (Vivino, CellarTracker) |

### Supported Sources (40+)

**Global Competitions:**
- Decanter World Wine Awards (DWWA)
- International Wine Challenge (IWC)
- International Wine & Spirit Competition (IWSC)
- Concours Mondial de Bruxelles
- Mundus Vini

**Grape-Specific Competitions:**
- Chardonnay du Monde
- Syrah du Monde
- Grenaches du Monde

**Regional Sources:**
- South Africa: Platter's, Veritas, Old Mutual, Tim Atkin SA
- Australia: Halliday, Huon Hooke, Gourmet Traveller Wine
- New Zealand: Bob Campbell MW, Wine Orbit
- Spain: Guía Peñín, Guía Proensa
- Italy: Gambero Rosso, Bibenda, Doctor Wine, Vinous
- France: Guide Hachette, RVF, Bettane+Desseauve
- Chile/Argentina: Descorchados, Vinómanos

**Global Critics:**
- James Suckling
- Wine Spectator
- Wine Advocate / Robert Parker
- Wine Enthusiast
- Jancis Robinson

**Community:**
- Vivino (blocked but snippet works)
- CellarTracker (via search only)

---

## Score Normalisation (searchProviders.js:65-146)

All scores are normalised to a 100-point scale:

| Format | Normalisation |
|--------|---------------|
| 100-point scale | As-is (50-100 range) |
| 20-point scale (French) | × 5 |
| 5-star scale | × 20 |
| Medals | Grand Gold=98, Gold=94, Silver=88, Bronze=82, Commended=78 |
| Tre Bicchieri | 95 |
| Due Bicchieri Rossi | 90 |
| 5 grappoli | 95 |
| Coup de Coeur | 96 |

---

## Drinking Window Extraction

Extracted alongside ratings when present. Patterns supported:

- `Drink 2024-2030` / `Drink 2024 to 2030`
- `Best now through 2028`
- `Drink after 2026` / `Hold until 2025`
- `Ready now` / `Drink now`
- `Peak 2027`
- `Past its peak` / `Drink up`
- Italian: `Bere entro il 2030`
- French: `À boire jusqu'en 2028`

Windows are saved to `drinking_windows` table and used for reduce-now prioritisation.

---

## Known Issues & Limitations

### 1. Vivino API Blocking
**Problem:** CloudFront WAF blocks all server-side requests after login.
**Impact:** Cannot get accurate Vivino ratings via API.
**Workaround:** Snippet extraction from search results often captures the rating (e.g., "3.8 stars").
**Potential Fix:** Headless browser (Playwright/Puppeteer) would bypass blocking but adds ~300MB dependency and slower execution.

### 2. CellarTracker Limited Utility
**Problem:** Their xlquery.asp API only searches the user's personal cellar inventory, not the global wine database.
**Resolution:** Removed credential support. CellarTracker ratings are still found via web search.

### 3. Page Blocking Varies
**Problem:** Many wine sites block automated access (consent walls, CloudFront, etc.).
**Impact:** Page fetching success rate varies (typically 3-5 of 8 pages succeed).
**Mitigation:** Snippet fallback ensures ratings are still extracted from search results.

### 4. Rate Limiting
**Problem:** Google Custom Search has daily limits (100 free/day, 10,000 paid).
**Impact:** Heavy usage may exhaust quota.
**Mitigation:** Brave Search used in parallel as fallback.

### 5. Producer Website Detection
**Current:** Attempts to identify winery's own website for awards/specs.
**Limitation:** Heuristic-based, may miss some or false-positive on retailers.

---

## Configuration Requirements

### Environment Variables (.env)

```bash
# Required for Claude extraction
ANTHROPIC_API_KEY=sk-ant-...

# Required for web search (at least one)
GOOGLE_SEARCH_API_KEY=AIza...
GOOGLE_SEARCH_ENGINE_ID=a1b2c3...
BRAVE_SEARCH_API_KEY=BSA...

# Optional - for encrypted credential storage
CREDENTIAL_ENCRYPTION_KEY=<base64-32-bytes>
```

### User Credentials (Settings UI)

| Source | What's Needed | Value |
|--------|---------------|-------|
| Vivino | Email + Password | Limited (CloudFront blocks) |
| Decanter | Email + Password | Full reviews + drinking windows |

---

## API Usage

### Endpoint: `POST /api/wines/:id/ratings/fetch`

Triggers rating search for a specific wine.

**Response:**
```json
{
  "ratings": [
    {
      "source": "decanter",
      "lens": "competition",
      "score_type": "medal",
      "raw_score": "Gold",
      "normalised_score": 94,
      "drinking_window": {
        "drink_from_year": 2024,
        "drink_by_year": 2030,
        "raw_text": "Drink 2024-2030"
      },
      "source_url": "https://...",
      "match_confidence": "high"
    }
  ],
  "tasting_notes": "...",
  "search_notes": "Found 3 ratings from 2 sources"
}
```

---

## Performance Characteristics

| Operation | Typical Duration |
|-----------|------------------|
| Authenticated fetch (Decanter) | 2-4 seconds |
| Web search (Google + Brave parallel) | 1-2 seconds |
| Page fetching (8 pages parallel) | 3-8 seconds |
| Claude extraction | 2-4 seconds |
| **Total typical** | **8-15 seconds** |

---

## Recommendations for Future Improvement

### Short-term
1. **Add request caching** - Cache successful lookups to avoid repeated searches
2. **Improve Decanter parsing** - Test against more review page templates
3. **Better error surfacing** - Show user which sources succeeded/failed

### Medium-term
4. **Manual URL hint** - Allow user to paste a known review URL for direct parsing
5. **Source reliability tracking** - Track success rates per source over time

### Long-term (if Vivino accuracy is critical)
6. **Headless browser integration** - Playwright/Puppeteer for CloudFront bypass
7. **Proxy service** - Residential proxy to avoid bot detection

---

## File Reference

| File | Purpose |
|------|---------|
| `src/services/claude.js` | Main orchestration, Claude prompts |
| `src/services/searchProviders.js` | Web search, page fetching, auth sources |
| `src/config/sourceRegistry.js` | Source definitions, lens weights |
| `src/services/encryption.js` | Credential encryption |
| `src/routes/settings.js` | Credential management API |
| `src/routes/ratings.js` | Rating fetch endpoints |

---

## Appendix: Search Flow Diagram

```
User clicks "Fetch Ratings" for wine
            │
            ▼
    fetchWineRatings(wine)
            │
            ├──► fetchAuthenticatedRatings()
            │         │
            │         ├─► Vivino: POST /api/login → GET /api/explore
            │         │   └── Usually blocked by CloudFront
            │         │
            │         └─► Decanter: POST /wp-login → Search → Parse
            │             └── Returns rating + drinking window
            │
            ├──► searchWineRatings(name, vintage, country)
            │         │
            │         ├─► Detect grape variety
            │         ├─► Get region-prioritized sources
            │         ├─► Targeted Google searches (6 sources)
            │         ├─► Broad Google search
            │         └─► Brave search (parallel)
            │
            ├──► fetchPageContent() × 8 pages
            │         │
            │         ├─► Success: Return cleaned text
            │         └─► Blocked: Return error status
            │
            ├──► IF pages fetched successfully:
            │         │
            │         └─► Claude extracts from page contents
            │
            ├──► ELSE (all pages blocked):
            │         │
            │         └─► Claude extracts from search snippets
            │
            └──► Merge authenticated + scraped ratings
                      │
                      ▼
            Return deduplicated ratings with metadata
```
