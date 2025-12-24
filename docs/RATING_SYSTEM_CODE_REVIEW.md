# Wine Rating System - Code Review Request

## Executive Summary

We have a wine cellar application that fetches ratings from multiple sources (critics, competitions, community sites) and aggregates them into a unified score. The system has been through multiple iterations but **tasting notes are not being extracted/displayed** despite ratings being fetched successfully.

**Test Case**: Chateau Auzias Cabardes 2017
- Vivino rating: 4.1 - WORKING
- Guide Hachette: 3 stars (85.0) - WORKING
- Tasting notes: NOT DISPLAYING

---

## Architecture Overview

### Two Configuration Files

#### 1. `src/config/sourceRegistry.js` - Search Planning
Defines which sources to search for which countries:
```javascript
export const SOURCE_REGISTRY = {
  // Each source has: id, domain, lens, priority, credibility, countries[]
  guide_hachette: {
    id: 'guide_hachette',
    domain: 'hachette-vins.com',
    lens: 'panel_guide',
    priority: 3,
    credibility: 0.80,
    countries: ['France']
  },
  // ... 40+ sources
};
```

#### 2. `src/config/ratingSources.js` - Score Normalization
Defines how to normalize different score types to 0-100 scale:
```javascript
export const RATING_SOURCES = {
  guide_hachette: {
    name: 'Guide Hachette des Vins',
    lens: 'panel_guide',
    credibility: 0.80,
    score_type: 'stars',
    stars_conversion: {
      3: { min: 92, max: 100, label: '3 Stars' },
      2: { min: 85, max: 91, label: '2 Stars' },
      1: { min: 78, max: 84, label: '1 Star' }
    }
  },
  // ... matching sources
};
```

### Three-Lens Rating System

Ratings are categorized into three "lenses":
1. **competition** - Wine competitions (Decanter, IWC, IWSC, Veritas, etc.)
2. **critics** - Individual critics + panel guides (mapped together for display)
   - `critic` lens: James Suckling, Jancis Robinson, Wine Advocate, etc.
   - `panel_guide` lens: Guide Hachette, Gambero Rosso, Halliday, etc.
3. **community** - User-driven sites (Vivino, CellarTracker)

### Data Flow

```
1. User clicks "Search for Ratings" on a wine
   |
2. fetchWineRatings(wine) in claude.js
   |
3. searchWineRatings(wineName, vintage, country, style) in searchProviders.js
   |-- getSourcesForWine(country, grape) - selects sources based on country
   |-- Country inference from style if country is missing
   |-- Google searches for each priority source
   |
4. fetchPageContent() - fetches actual page HTML
   |-- Uses BrightData for JS-rendered pages (Vivino)
   |-- Direct fetch for static pages
   |
5. Claude API parses page content to extract:
   |-- ratings (source, score, score_type)
   |-- tasting_notes (supposed to extract flavor descriptions)
   |
6. saveRatings() - normalizes and stores in database
   |
7. UI displays ratings panel
```

---

## Recent Changes Made

### 1. Added 21 Missing Sources to ratingSources.js

Sources in sourceRegistry.js but missing from ratingSources.js:
- grenaches_du_monde, halliday, guia_penin, gambero_rosso, bibenda
- guide_hachette, rvf, bettane_desseauve, falstaff, vinum
- revista_vinhos, elloinos, vinomanos, huon_hooke, bob_campbell
- wine_orbit, guia_proensa, vinous, doctor_wine, weinwisser, descorchados

### 2. Fixed Lens Terminology Mismatch

**Problem**: sourceRegistry used `critic` and `panel_guide`, but ratingSources used `critics` (plural).

**Solution**:
- Standardized ratingSources to use `critic` and `panel_guide` (matching sourceRegistry)
- Added `mapToDisplayLens()` function in ratings.js to consolidate for UI:
```javascript
function mapToDisplayLens(sourceLens) {
  if (sourceLens === 'panel_guide' || sourceLens === 'critic' || sourceLens === 'critics') {
    return 'critics';
  }
  return sourceLens;
}
```

### 3. Added Symbol Score Support

For Italian guides that use symbols instead of numbers:
```javascript
if (scoreType === 'symbol') {
  // Tre Bicchieri, grappoli, Coup de Coeur
  const symbolStr = rawScore.toLowerCase();
  if (symbolStr.includes('tre bicchieri') || symbolStr.includes('5 grappoli')) {
    return { min: 95, max: 100, mid: 97.5 };
  }
  // ... more patterns
}
```

### 4. Added 20-Point Scale Conversion

French critics use /20 scale:
```javascript
const TWENTY_POINT_SOURCES = ['jancis_robinson', 'rvf', 'bettane_desseauve', 'vinum'];

// In normalizeScore():
if (TWENTY_POINT_SOURCES.includes(source) && points <= 20) {
  const normalized = (points / 20) * 100;
  return { min: normalized, max: normalized, mid: normalized };
}
```

### 5. Added Country Inference from Wine Style

**Problem**: Wine has no country field set, so regional sources aren't searched.

**Solution**: Added `inferCountryFromStyle()` in searchProviders.js:
```javascript
const REGION_TO_COUNTRY = {
  // France
  'bordeaux': 'France', 'burgundy': 'France', 'languedoc': 'France',
  'cabardes': 'France', 'champagne': 'France', // ~30 French regions

  // Italy
  'tuscany': 'Italy', 'chianti': 'Italy', 'barolo': 'Italy', // ...

  // Spain
  'rioja': 'Spain', 'ribera del duero': 'Spain', // ...

  // Chile
  'maipo': 'Chile', 'colchagua': 'Chile', 'casablanca': 'Chile',

  // Argentina
  'mendoza': 'Argentina', 'salta': 'Argentina', 'patagonia': 'Argentina',

  // South Africa, Australia, New Zealand, USA, Portugal, Germany...
};

export function inferCountryFromStyle(style, region = null) {
  const textToSearch = `${style || ''} ${region || ''}`.toLowerCase();
  for (const [pattern, country] of Object.entries(REGION_TO_COUNTRY)) {
    if (textToSearch.includes(pattern)) {
      return country;
    }
  }
  return null;
}
```

Updated `searchWineRatings()`:
```javascript
export async function searchWineRatings(wineName, vintage, country, style = null) {
  let effectiveCountry = country;
  if (!country || country === 'Unknown' || country === '') {
    const inferredCountry = inferCountryFromStyle(style);
    if (inferredCountry) {
      logger.info('Search', `Inferred country "${inferredCountry}" from style "${style}"`);
      effectiveCountry = inferredCountry;
    }
  }
  const sources = getSourcesForWine(effectiveCountry, detectedGrape);
  // ...
}
```

---

## The Tasting Notes Problem

### How Tasting Notes SHOULD Work

1. Page content is fetched from rating sources
2. Claude API is given a prompt to extract ratings AND tasting notes
3. Tasting notes are saved to `wines.tasting_notes` column
4. Modal displays tasting notes from the wine record

### Current Code Path

In `claude.js`, the Claude prompt includes:
```javascript
const prompt = `Extract wine ratings from these pages for "${wineName}" ${vintage}.

Return JSON with:
{
  "ratings": [...],
  "tasting_notes": "Consolidated professional tasting notes (flavors, aromas, texture)"
}
`;
```

After Claude returns, we have:
```javascript
if (parsed.tasting_notes) {
  logger.info('Ratings', `Tasting notes extracted: ${parsed.tasting_notes.substring(0, 100)}...`);
} else {
  logger.info('Ratings', 'No tasting notes extracted from pages');
}
```

### Possible Issues

1. **Claude prompt may not be extracting tasting notes** - The prompt might need refinement
2. **Tasting notes not being saved** - Need to verify the save path
3. **Pages fetched may not contain tasting notes** - Need to verify content quality
4. **Database field not being updated** - Need to check UPDATE query

### Relevant Database Schema

```sql
-- wines table
CREATE TABLE wines (
  id INTEGER PRIMARY KEY,
  wine_name TEXT,
  vintage TEXT,
  style TEXT,
  country TEXT,
  tasting_notes TEXT,  -- This should be populated
  ...
);

-- wine_ratings table
CREATE TABLE wine_ratings (
  id INTEGER PRIMARY KEY,
  wine_id INTEGER,
  source TEXT,
  source_lens TEXT,
  raw_score TEXT,
  normalized_mid REAL,
  evidence_excerpt TEXT,  -- Snippet from page
  ...
);
```

---

## Test Cases

### Test 1: Chateau Auzias Cabardes 2017 (French wine)
- **Style**: "Languedoc Red Blend (cabardes)"
- **Country in DB**: Empty/Unknown
- **Expected behavior**:
  - Infer country as "France" from style containing "languedoc" and "cabardes"
  - Search French sources: guide_hachette, rvf, bettane_desseauve
  - Extract ratings AND tasting notes
- **Actual result**:
  - Vivino: 4.1 - WORKING
  - Guide Hachette: 85.0 - WORKING
  - Tasting notes: NOT SHOWING

### Test 2: Chilean Wine (hypothetical)
- **Style**: "Maipo Valley Cabernet Sauvignon"
- **Expected behavior**:
  - Infer country as "Chile" from "maipo"
  - Search: descorchados, vinomanos, james_suckling, vivino
- **Status**: NOT YET TESTED

### Test 3: Argentine Wine (hypothetical)
- **Style**: "Mendoza Malbec"
- **Expected behavior**:
  - Infer country as "Argentina" from "mendoza"
  - Search: descorchados, tim_atkin, vinomanos, vivino
- **Status**: NOT YET TESTED

---

## Files to Review

### Core Rating Logic
1. **`src/services/searchProviders.js`** (~1300 lines)
   - `getSourcesForWine()` - source selection
   - `searchWineRatings()` - main search orchestration
   - `inferCountryFromStyle()` - country inference (new)
   - `fetchPageContent()` - page fetching with BrightData

2. **`src/services/claude.js`** (~700 lines)
   - `fetchWineRatings()` - orchestrates search + Claude extraction
   - Claude prompt for rating extraction
   - Tasting notes extraction logic

3. **`src/services/ratings.js`** (~460 lines)
   - `normalizeScore()` - score normalization
   - `saveRatings()` - database persistence
   - `calculateWineRatings()` - aggregation

### Configuration
4. **`src/config/sourceRegistry.js`** - search planning config
5. **`src/config/ratingSources.js`** - score normalization config

### Frontend
6. **`public/js/ratings.js`** - UI rendering
7. **`public/js/modals.js`** - modal display (tasting notes field)

---

## Specific Questions for Reviewer

1. **Tasting Notes Flow**: Where in the code path are tasting notes being lost? Are they:
   - Not being extracted by Claude?
   - Not being saved to the database?
   - Not being fetched/displayed in the UI?

2. **Country Inference**: Is `inferCountryFromStyle()` being called correctly? The logs should show "Inferred country" messages.

3. **Source Selection**: For a French wine, are we actually searching French sources (guide_hachette, rvf)?

4. **Data Quality**: Are the fetched pages actually containing tasting note content?

5. **Architecture**: Is having two separate config files (sourceRegistry vs ratingSources) the right approach, or should they be merged?

---

## How to Debug

### Check Server Logs
```bash
# Start server and watch logs
node src/server.js
```

Look for:
- `[Search] Country: France (inferred from "Languedoc Red Blend (cabardes)")`
- `[Search] Targeted sources: guide_hachette, rvf, ...`
- `[Ratings] Tasting notes extracted: ...`

### Check Database
```sql
-- Check if tasting notes are saved
SELECT id, wine_name, tasting_notes FROM wines WHERE id = <wine_id>;

-- Check what ratings were saved
SELECT source, raw_score, evidence_excerpt FROM wine_ratings WHERE wine_id = <wine_id>;
```

### Test Endpoints
```bash
# Get wine ratings
curl http://localhost:3000/api/wines/<id>/ratings

# Trigger rating fetch
curl -X POST http://localhost:3000/api/wines/<id>/fetch-ratings
```

---

## Summary of What's Working vs Broken

### Working
- Rating scores from Vivino (community)
- Rating scores from Guide Hachette (panel_guide)
- Score normalization (stars, points, medals)
- Three-lens aggregation display
- Manual rating entry
- **Country inference IS WORKING** - logs show: `Inferred country "France" from style "Languedoc Red Blend (cabardes)"`
- **French sources ARE being searched** - logs show: `Top sources: guide_hachette, rvf, bettane_desseauve, jancis_robinson...`
- **Tasting notes ARE being extracted** - logs show: `Tasting notes extracted: From Vivino (Gloria Mundi Cabardès 2017): Vanilla, chocolate, coffee...`
- **Tasting notes ARE saved to database** - verified via direct DB query
- **Tasting notes ARE returned by API** - `/api/stats/layout` includes them

### Broken/Unclear
- **Tasting notes display in UI** - Despite being in DB and API, they don't show in modal after refresh
- Frontend state refresh issue - `updateTastingNotesDisplay()` may not be finding the slot correctly

### Not Yet Tested
- Chilean wine source selection
- Argentine wine source selection
- Italian symbol scores (Tre Bicchieri)
- 20-point scale conversion

---

## Detailed Trace: Tasting Notes Issue

### What We Found

1. **Server logs show tasting notes ARE extracted**:
```
[2025-12-24T09:24:09.923Z] [INFO] [Ratings] Tasting notes extracted: From Vivino (Gloria Mundi Cabardès 2017): Vanilla, chocolate, coffee (oaky - 31 mentions), blackberr...
```

2. **Database shows tasting notes ARE saved**:
```sql
SELECT tasting_notes FROM wines WHERE wine_name LIKE '%Auzias%';
-- Result: "From Vivino (Gloria Mundi Cabardès 2017): Vanilla, chocolate, coffee..."
```

3. **API returns tasting notes**:
```bash
curl "http://localhost:3000/api/stats/layout" | grep -o 'Auzias.*tasting_notes[^}]*'
# Returns: tasting_notes: "From Vivino..."
```

4. **BUT: Modal doesn't display them**

### Potential Frontend Issues

The flow after clicking "Refresh" on ratings:

```javascript
// public/js/ratings.js line 315-319
state.layout = await fetchLayout();  // Fetches new data
updateTastingNotesDisplay(wineId);   // Should update modal
```

The `updateTastingNotesDisplay` function:
```javascript
function updateTastingNotesDisplay(wineId) {
  if (!state.layout) return;  // Possible: state.layout is undefined?

  const allSlots = [
    ...state.layout.fridge.rows.flatMap(r => r.slots),
    ...state.layout.cellar.rows.flatMap(r => r.slots)
  ];
  const slot = allSlots.find(s => s.wine_id === wineId);

  if (!slot) return;  // Possible: slot not found?

  // Update DOM
  const tastingNotesField = document.getElementById('modal-tasting-notes-field');
  const tastingNotesText = document.getElementById('modal-tasting-notes');

  if (tastingNotesField && tastingNotesText) {  // Possible: elements don't exist?
    if (slot.tasting_notes) {
      tastingNotesField.style.display = 'block';
      tastingNotesText.textContent = slot.tasting_notes;
    }
  }
}
```

### Theories

1. **State not updated**: `state.layout` might not have the fresh data
2. **Slot not found**: `wine_id` comparison might be failing (type mismatch? string vs number?)
3. **DOM elements missing**: The modal might have been removed/recreated
4. **Race condition**: The modal might be re-rendered after `updateTastingNotesDisplay` runs

### Suggested Debug Steps

Add console.log statements to `updateTastingNotesDisplay`:
```javascript
function updateTastingNotesDisplay(wineId) {
  console.log('updateTastingNotesDisplay called with wineId:', wineId, typeof wineId);
  console.log('state.layout exists:', !!state.layout);

  if (!state.layout) return;

  const allSlots = [...];
  console.log('Total slots found:', allSlots.length);

  const slot = allSlots.find(s => s.wine_id === wineId);
  console.log('Slot found:', !!slot, slot?.wine_id, slot?.tasting_notes?.substring(0, 50));

  // ... rest of function
}
```

---

## Appendix: Key Code Snippets

### Country Inference Call Chain

```javascript
// claude.js line 374
const searchResults = await searchWineRatings(wineName, vintage, country, style);

// searchProviders.js line 1151
export async function searchWineRatings(wineName, vintage, country, style = null) {
  let effectiveCountry = country;
  if (!country || country === 'Unknown' || country === '') {
    const inferredCountry = inferCountryFromStyle(style);
    if (inferredCountry) {
      logger.info('Search', `Inferred country "${inferredCountry}" from style "${style}"`);
      effectiveCountry = inferredCountry;
    }
  }
  const sources = getSourcesForWine(effectiveCountry, detectedGrape);
  // ...
}
```

### Source Selection for France

```javascript
// sourceRegistry.js - French sources
guide_hachette: { countries: ['France'], priority: 3 },
rvf: { countries: ['France'], priority: 4 },
bettane_desseauve: { countries: ['France'], priority: 5 },
```

### Tasting Notes in Claude Prompt

```javascript
// claude.js - prompt sent to Claude
const prompt = `Extract wine ratings from these pages for "${wineName}" ${vintage}.

For each rating found, identify:
- source (e.g., "vivino", "wine_spectator", "decanter")
- score_type: "points", "stars", "medal", or "symbol"
- raw_score: the actual score/award (e.g., "92", "4.2", "Gold Medal")
...

Return JSON:
{
  "ratings": [...],
  "tasting_notes": "Consolidated professional tasting notes describing flavors, aromas, texture, and overall impression. Combine notes from multiple critics if available."
}
`;
```
