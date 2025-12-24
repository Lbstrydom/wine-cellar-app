# Wine Rating Search System - Code Review Document

## Overview

This document describes the current implementation of the wine rating search system in `src/services/claude.js` (function `fetchWineRatings`). The system uses Claude's web search capability to find professional wine ratings, competition results, and tasting notes.

---

## Architecture

### Two-Step Approach

1. **Step 1: Web Search** - Claude performs web searches to gather rating information
2. **Step 2: JSON Formatting** - A second API call formats the results into structured JSON

```
User clicks "Search Ratings"
       ↓
fetchWineRatings(wine)
       ↓
Build search prompt with wine details
       ↓
Claude API call #1 (with web_search tool)
       ↓
Extract text from search results
       ↓
Claude API call #2 (format as JSON)
       ↓
Parse JSON and return ratings
```

---

## Current Implementation Details

### Input Data

The function receives a `wine` object with:
- `wine_name` - e.g., "Springfield Estate Special Cuvée Sauvignon Blanc"
- `vintage` - e.g., 2024
- `style` - e.g., "Sauvignon Blanc"
- `country` - e.g., "South Africa" (often NULL/missing)

### Country Detection Logic (Lines 335-344)

**Current Code:**
```javascript
const saRegionsAndProducers = [
  'robertson', 'stellenbosch', 'franschhoek', 'paarl', 'swartland',
  'constantia', 'elgin', 'hemel-en-aarde', 'cape', 'walker bay',
  'springfield', 'kanonkop', 'meerlust', 'rustenberg', 'thelema',
  'boekenhoutskloof', 'mullineux', 'sadie', 'raats', 'waterford'
];
const wineName = wine.wine_name?.toLowerCase() || '';
const isSouthAfrican = wine.country === 'South Africa' ||
  saRegionsAndProducers.some(term => wineName.includes(term));
```

**Issues:**
1. ❌ Hardcoded list of SA producers/regions - doesn't scale
2. ❌ Only handles South Africa - no similar logic for France, Italy, Spain, etc.
3. ❌ Substring matching is fragile - "cape" could match unrelated wines
4. ❌ Overfitting to one region based on user's cellar composition

### Search Prompt Construction (Lines 367-393)

**Current prompt structure:**
```
Search for professional wine ratings, competition results, and tasting notes for:

Wine: {wine_name}
Vintage: {vintage}
Style/Grape: {style}
Country: {country}

IMPORTANT: Please perform multiple searches:

1. First search specifically on Vivino: site:vivino.com "{wine_name}" {vintage}
   Look for the star rating (out of 5) and number of reviews on vivino.com

2. Search for Tim Atkin rating: "{wine_name}" {vintage} site:timatkin.com OR "Tim Atkin" rating
   [Only for SA wines]

3. Then search for competition awards and professional ratings:
- Decanter World Wine Awards (DWWA)
- International Wine Challenge (IWC)
- [etc...]
- [SA-specific sources if detected]

4. Also search for professional tasting notes...
```

**Issues:**
1. ❌ Prescribing specific search queries (site:vivino.com) - Claude's web search may not support this syntax
2. ❌ Numbered list implies order/priority which may confuse the model
3. ❌ Tim Atkin gets special treatment only for SA wines - asymmetric
4. ❌ No equivalent logic for other regional critics (e.g., Robert Parker for Bordeaux, James Suckling for Italy)
5. ❌ Long prompt with lots of conditional content

### API Calls (Lines 396-460)

**Call #1: Web Search**
```javascript
const searchResponse = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 2000,
  tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  messages: [{ role: 'user', content: searchPrompt }]
});
```

**Call #2: Format as JSON**
```javascript
const formatResponse = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 1500,
  messages: [
    { role: 'user', content: searchPrompt },
    { role: 'assistant', content: searchText },
    { role: 'user', content: formatPrompt }
  ]
});
```

**Issues:**
1. ⚠️ Two API calls per rating search - cost and latency
2. ⚠️ The second call doesn't have web search enabled - it's just formatting
3. ⚠️ If searchText is empty/short, we return early but don't surface why

### JSON Parsing (Lines 468-500)

Multiple fallback strategies for parsing:
1. Direct JSON.parse
2. Extract from ```json code blocks
3. Regex match for `{..."ratings"...}`

**Issues:**
1. ⚠️ Complex fallback logic suggests the model often doesn't follow the format
2. ⚠️ No validation of the parsed structure

---

## Rating Sources Configuration

Defined in `src/config/ratingSources.js`:

| Source | Type | Scope | Notes |
|--------|------|-------|-------|
| decanter | competition | global | DWWA |
| iwc | competition | global | |
| iwsc | competition | global | |
| concours_mondial | competition | global | |
| mundus_vini | competition | global | |
| veritas | competition | national (SA) | |
| old_mutual | competition | national (SA) | |
| chardonnay_du_monde | competition | varietal | |
| syrah_du_monde | competition | varietal | |
| tim_atkin | critics | regional (SA, Argentina) | |
| platters | critics | national (SA) | |
| vivino | community | global | |

**Missing major sources:**
- Wine Advocate / Robert Parker
- Wine Spectator
- James Suckling
- Jancis Robinson
- Wine Enthusiast
- Falstaff (Austria/Germany)
- Gambero Rosso (Italy)
- Guía Peñín (Spain)

---

## Problems Identified

### 1. Overfitting to South African Wines
The code has extensive SA-specific logic but nothing for other major wine regions. This creates asymmetric behavior.

### 2. Unreliable Country Detection
The `country` field is often NULL. Substring matching on wine names is fragile and doesn't scale.

### 3. Prescriptive Search Queries
Telling Claude exactly what to search for (e.g., `site:vivino.com`) may not work with the web search tool's actual behavior.

### 4. Missing Major Critics
No support for Wine Advocate, Wine Spectator, James Suckling - some of the most influential rating sources globally.

### 5. Two API Calls Per Search
Adds latency and cost. Could potentially be combined.

### 6. No Caching or Rate Limiting
Each click triggers new API calls. No deduplication or caching.

---

## Recommendations

### Short-term Fixes

1. **Remove prescriptive search syntax** - Let Claude decide how to search
2. **Simplify the prompt** - One clear instruction instead of numbered steps
3. **Add major global critics** to the source list and prompt

### Medium-term Improvements

1. **Fix country data at the source** - Ensure wines have country set when added
2. **Remove region-specific detection logic** - Trust the country field
3. **Add caching** - Don't re-search wines that were searched recently
4. **Consider single API call** - Ask for JSON directly in the search response

### Long-term Considerations

1. **Direct API integrations** - Vivino has an (unofficial) API; some critics publish structured data
2. **User feedback loop** - Let users confirm/correct ratings to improve accuracy
3. **Background refresh** - Periodically update ratings instead of on-demand

---

## Proposed Simplified Search Prompt

```
Find professional wine ratings and tasting notes for:

Wine: {wine_name}
Vintage: {vintage}
Grape/Style: {style}
Country: {country}

Search for:
- Vivino rating (star rating out of 5, number of reviews)
- Competition medals (Decanter, IWC, IWSC, etc.)
- Critic scores (Wine Advocate, Wine Spectator, James Suckling, Tim Atkin, Jancis Robinson, regional guides)
- Professional tasting notes

Return results as JSON:
{
  "ratings": [
    {
      "source": "vivino|decanter|iwc|wine_advocate|tim_atkin|etc",
      "lens": "competition|critics|community",
      "score_type": "medal|points|stars",
      "raw_score": "Gold|92|4.2",
      "competition_year": 2024,
      "rating_count": 1500,
      "source_url": "https://...",
      "match_confidence": "high|medium|low"
    }
  ],
  "tasting_notes": "Description of aromas, flavors, and character...",
  "search_notes": "Summary of what was found"
}
```

---

## Files Involved

- `src/services/claude.js` - Main search logic (lines 325-501)
- `src/config/ratingSources.js` - Source definitions and normalization
- `src/services/ratings.js` - Score normalization and aggregation
- `src/routes/ratings.js` - API endpoint that calls fetchWineRatings

---

## Testing Considerations

Currently no automated tests. Manual testing should cover:

1. Wine with known Vivino rating
2. Wine with known competition medal
3. Wine with known critic score (Tim Atkin, Wine Advocate, etc.)
4. Wine with no ratings anywhere
5. Obscure wine that search won't find
6. Wine where name is ambiguous (e.g., "Chardonnay" without producer)

---

*Document generated for code review - December 2024*
