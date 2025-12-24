# Wine Rating Search Architecture

## Overview

The wine rating search system uses a multi-provider approach combining:
1. **Bright Data SERP API** - Structured Google search results
2. **Direct page fetching** - For accessible wine review sites
3. **Snippet extraction** - Fallback for blocked/paywalled sites
4. **Claude AI extraction** - Parsing ratings from page content

---

## Current Configuration

### Environment Variables (`.env`)
```
BRIGHTDATA_API_KEY=<api-key>
BRIGHTDATA_SERP_ZONE=wine_serp          # SERP API for Google searches
# BRIGHTDATA_ZONE=web_unlocker          # Web Unlocker (not configured)
GOOGLE_SEARCH_API_KEY=<fallback>        # Fallback if SERP not available
GOOGLE_SEARCH_ENGINE_ID=<engine-id>
ANTHROPIC_API_KEY=<claude-api-key>
```

### API Priority
1. **Bright Data SERP API** (preferred) - Returns structured JSON with organic results
2. **Google Custom Search API** (fallback) - Used if SERP zone not configured

---

## Search Flow

### Step 1: Source Selection (`searchProviders.js`)

Based on wine's **country** and **detected grape variety**, sources are prioritized:

```javascript
// Example for South African wine
Top sources: platters, tim_atkin, veritas, vivino, decanter, iwc, iwsc,
             concours_mondial, mundus_vini, chardonnay_du_monde
```

**Issue identified**: If wine's `country` field is NULL, falls back to generic sources and misses regional specialists like Platter's.

### Step 2: Wine Name Variations

The system generates search variations to handle naming inconsistencies:

```javascript
Input: "Kleine Zalze Chenin Blanc (vineyard Selection)"
Variations:
  1. "Kleine Zalze Chenin Blanc (vineyard Selection)"  // Original
  2. "Kleine Zalze Chenin Blanc vineyard Selection"    // Parens removed, content kept
  3. "Kleine Zalze Chenin Blanc"                       // Parens content removed
```

### Step 3: SERP API Searches

**Targeted searches** (6 parallel requests to specific domains):
```
- site:chardonnaydumond.com "wine name" vintage
- site:veritas.co.za "wine name" vintage
- site:decanter.com "wine name" vintage award medal
- site:internationalwinechallenge.com "wine name" vintage
- site:iwsc.net "wine name" vintage
- site:winemag.com "wine name" vintage
```

**Broad search** (1 request across multiple domains):
```
"wine name" vintage rating (site:domain1 OR site:domain2 OR ...)
```

**Variation searches** (if <5 results):
```
"variation name" vintage wine rating
```

### Step 4: Page Fetching

Top 8 search results are fetched directly:

| Domain | Fetch Result | Issue |
|--------|--------------|-------|
| internationalwinechallenge.com | Success | Works well |
| iwsc.net | Success | Works well |
| decanter.com | Success | Works well |
| cellartracker.com | 157 chars | Login required |
| winemag.com | HTTP 403 | Blocked |
| vivino.com | SPA shell | No rating data |
| jancisrobinson.com | Paywalled | Scores hidden |
| vinello.co.uk | HTTP 403 | Blocked |

### Step 5: Claude Extraction

**For successfully fetched pages**, Claude extracts:
- Source identifier
- Lens (competition/critic/community)
- Score type (points/stars/medal/symbol)
- Raw score
- Normalized score (0-100 scale)
- Drinking window
- Evidence excerpt
- Vintage match confidence

**For failed fetches**, snippet extraction runs separately:
- Uses search result title + snippet
- Lower confidence but catches blocked sites
- Currently finding CellarTracker scores this way

---

## Current Results Analysis

### Test Case: Kleine Zalze Chenin Blanc Vineyard Selection 2021

**Search Results:**
- 15-18 relevant results found
- Top sources: IWC, IWSC, CellarTracker, WineAlign, Platter's

**Extracted Ratings:**

| Source | Score | Normalized | Lens | Vintage Match | Method |
|--------|-------|------------|------|---------------|--------|
| WineAlign | 91 pts | 91 | community | exact | Page fetch |
| CellarTracker | CT89 | 87.5 | community | inferred | Snippet |
| Platter's | 5 stars | 97.5 | panel_guide | inferred | Page fetch |

**Final Aggregates:**
- Competition Index: null (no competition ratings found)
- Critics Index: 97.5 (from Platter's)
- Community Index: 91 (avg of WineAlign + CT)
- Purchase Score: 93.7
- Purchase Stars: 4.5

**Tasting Notes Captured:**
> "The Kleine Zalze Chenin Blanc Vineyard Selection 2019 has flavours of melon, peach, guava and a hint of minerality..."

---

## Data Flow to UI

### Backend (`routes/ratings.js`)

```
POST /api/wines/:wineId/ratings/fetch
  -> fetchWineRatings(wine) in claude.js
    -> searchWineRatings() - SERP searches
    -> fetchPageContent() - Direct page fetches
    -> Claude extraction - Parse ratings
    -> Snippet extraction - Fallback for failures
  -> Transaction: Delete old + Insert new ratings
  -> calculateWineRatings() - Compute aggregates
  -> Update wines table with aggregates
  -> Return JSON response
```

### Response Format

```json
{
  "message": "Found 3 ratings (replaced 1 existing)",
  "search_notes": "Found 2 ratings: 1 exact match...",
  "tasting_notes": "Flavours of melon, peach...",
  "competition_index": null,
  "critics_index": 97.5,
  "community_index": 91,
  "purchase_score": 93.7,
  "purchase_stars": 4.5,
  "confidence_level": "medium",
  "lens_details": {
    "competition": { "index": null, "sourceCount": 0 },
    "critics": { "index": 97.5, "sourceCount": 1 },
    "community": { "index": 91, "sourceCount": 2 }
  }
}
```

### Frontend (`ratings.js`)

The `renderRatingsPanel()` function displays:
- Star rating (large, from purchase_stars)
- Numeric score (purchase_score)
- Confidence badge (high/medium/low)
- Lens breakdown (Competition/Critics/Community icons with values)
- Individual ratings list (expandable)
- Refresh button (triggers fetch)
- Add Manual button (for user overrides)

### Database Schema

**wine_ratings table:**
```sql
- wine_id, vintage, source, source_lens
- score_type, raw_score, raw_score_numeric
- normalized_min, normalized_max, normalized_mid
- award_name, competition_year, rating_count
- source_url, evidence_excerpt, matched_wine_label
- vintage_match, match_confidence
- fetched_at, is_user_override, override_note
```

**wines table (aggregates):**
```sql
- competition_index, critics_index, community_index
- purchase_score, purchase_stars, confidence_level
- tasting_notes, ratings_updated_at
```

---

## Known Issues & Limitations

### 1. Blocked/Paywalled Sites
| Site | Issue | Workaround |
|------|-------|------------|
| Vivino | SPA (JavaScript rendered) | Snippet extraction only |
| CellarTracker | Login required | Snippet extraction |
| WineMag | HTTP 403 | None - blocked |
| JancisRobinson | Paywall | Scores not visible |
| Vinello | HTTP 403 | None - blocked |

**Potential solution**: Enable Bright Data Web Unlocker zone for JS rendering.

### 2. Country Field Not Set
Many wines have `country: null`, causing:
- Regional sources (Platter's, Tim Atkin SA) not prioritized
- Falls back to generic global sources

**Fix needed**: Ensure country is populated when adding wines.

### 3. Vintage Matching
- "exact" match: Score found for exact vintage
- "inferred": Score from nearby vintage (e.g., 2019 for 2021 wine)
- "non_vintage": Generic/NV rating

Current extraction sometimes assigns "inferred" when it could be more precise.

### 4. Score Normalization Edge Cases
| Input | Expected | Current |
|-------|----------|---------|
| "Medal awarded (type not specified)" | 82.5 (generic medal) | 82.5 |
| "CT89" | 89 | 87.5 (treating as range) |
| "16/20" (Jancis) | 80 | Works correctly |
| "5 stars" (Platter's) | 100 | 97.5 (conservative) |

### 5. Missing Sources
Not currently finding/extracting from:
- Jancis Robinson (paywalled)
- Wine Advocate/Robert Parker (paywalled)
- Wine Spectator (paywalled)
- Decanter Magazine reviews (different from DWWA)

---

## Performance Metrics

Typical search timing:
- SERP API calls: 6-8 parallel requests, ~1-2 seconds total
- Page fetches: 8 parallel requests, ~2-5 seconds total
- Claude extraction: ~8-12 seconds
- Snippet extraction: ~4-6 seconds
- **Total**: 15-25 seconds per wine

---

## Recommendations for Improvement

### High Priority
1. **Enable Web Unlocker** - Would unlock Vivino, potentially others
2. **Populate wine country** - Better source prioritization
3. **Add Jancis Robinson targeted search** - Even if paywalled, snippets may contain scores

### Medium Priority
4. **Cache search results** - Avoid re-searching same wine within X hours
5. **Batch processing** - "Refresh all wines" option for cellar-wide update
6. **Drinking window extraction** - Save to drinking_windows table (code exists but may not be called)

### Low Priority
7. **Add more regional sources** - German (Falstaff), French (RVF), etc.
8. **Wine-Searcher integration** - Aggregate scores displayed in their results
9. **Producer website detection** - Often have awards listed

---

## File References

- `src/services/searchProviders.js` - SERP API, search logic, page fetching
- `src/services/claude.js` - AI extraction, prompt building
- `src/routes/ratings.js` - API endpoints
- `src/services/ratings.js` - Score normalization, aggregate calculation
- `src/config/sourceRegistry.js` - Source definitions and priorities
- `public/js/ratings.js` - Frontend UI rendering
