# Wine Cellar App - Consolidated Code Review

**Purpose:** Unified technical review and action plan for the coding LLM.

---

## Executive Summary

Two independent reviews identified overlapping issues and complementary recommendations. The critical blocker is **tasting notes not displaying after fetch** due to frontend state synchronisation failure. Secondary priorities include consolidating duplicate source configurations, fixing domain logic flaws in country inference, and improving code modularity.

---

## 1. Critical Bug: Tasting Notes Not Displaying

### Root Cause (Confirmed by Both Reviews)

The backend correctly extracts and persists `tasting_notes` to the `wines` table. The break occurs on the frontend:

1. `handleFetchRatings()` in `public/js/ratings.js` triggers the background job and then calls `getWineRatings(wineId)`.
2. `getWineRatings()` fetches only from the `wine_ratings` table - it does **not** fetch updated wine details where `tasting_notes` lives.
3. The modal's `slot` object retains stale data; `updateTastingNotesDisplay()` receives nothing new.

### Fix (Implement Immediately)

Refactor `handleFetchRatings` in `public/js/ratings.js`:

```javascript
async function handleFetchRatings(wineId, useAsync = true) {
  // ... existing setup code ...

  try {
    if (useAsync) {
      // ... existing polling logic ...
    } else {
      // ... existing sync logic ...
    }

    // FIX: Refresh BOTH ratings AND wine details
    const [ratingsData, wineData] = await Promise.all([
      getWineRatings(wineId),
      fetch(`/api/wines/${wineId}`).then(res => res.json())
    ]);

    // 1. Update Ratings Panel
    const panel = document.querySelector('.ratings-panel-container');
    if (panel) {
      panel.innerHTML = renderRatingsPanel(ratingsData);
      initRatingsPanel(wineId);
    }

    // 2. Update Tasting Notes in the Modal
    const notesField = document.getElementById('modal-tasting-notes');
    const notesContainer = document.getElementById('modal-tasting-notes-field');
    
    if (notesField && notesContainer) {
      if (wineData.tasting_notes) {
        notesField.textContent = wineData.tasting_notes;
        notesContainer.style.display = 'block';
        notesContainer.style.animation = 'highlight 1s'; // Optional visual feedback
      } else {
        notesContainer.style.display = 'none';
      }
    }

    // 3. Update local slot state for consistency
    if (window.currentSlot) {
      window.currentSlot.tasting_notes = wineData.tasting_notes;
    }

  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    // ... existing cleanup ...
  }
}
```

**Alternative approach:** Extend the `GET /wines/:id/ratings` endpoint to include `tasting_notes` in its response, since the client already re-fetches ratings after the job completes.

---

## 2. Schema & Database Issues

### 2.1 Missing Column in schema.sql

**Problem:** `tasting_notes` column exists via migration 003 but is absent from `data/schema.sql`. Fresh deployments will break.

**Fix:** Add to `wines` table definition in `schema.sql`:
```sql
tasting_notes TEXT
```

### 2.2 Missing Index

**Problem:** Heavy queries on `wine_name` in `searchProviders.js` (`WHERE wine_name LIKE ?`) lack an index.

**Fix:**
```sql
CREATE INDEX idx_wines_name ON wines(wine_name);
```

### 2.3 Foreign Key Enforcement (Optional)

Consider enabling SQLite foreign keys and adding cascades for `wine_ratings` → `wines`. Currently the code manually deletes ratings, but cascades would prevent orphaned records if a wine is deleted.

---

## 3. Configuration Redundancy (DRY Violation)

### Problem

Two files define overlapping source metadata:
- `src/config/ratingSources.js` - display names, lens category, normalisation rules
- `src/config/sourceRegistry.js` - domain URLs, query templates, regional affinities

**Risk:** `guide_hachette` and others appear in both. Changes in one file may not propagate to the other.

### Fix

Merge into a single `src/config/ratings_config.js`:
```javascript
export const SOURCE_CONFIG = {
  guide_hachette: {
    displayName: 'Guide Hachette',
    lens: 'competition',
    credibility: 0.85,
    domain: 'hachette-vins.com',
    countries: ['France'],
    normalisation: { type: 'stars', maxStars: 3 }
    // ... all metadata in one place
  },
  // ...
};
```

Both search and rating logic reference this single source of truth.

---

## 4. Domain Logic Flaw: Country Inference

### Problem

`inferCountryFromStyle()` incorrectly infers country from style names that are geographical but not origin indicators.

**Example:** A South African wine labelled "Bordeaux Blend" triggers inference of France. The system then searches Guide Hachette (French source) instead of Platter's (SA source).

### Affected Wines

Any New World wine using Old World style terminology: Bordeaux Blend, Champagne Method, Chianti-style, etc.

### Fix

Only infer country when:
1. The style is a true **region** (e.g., "Stellenbosch" → South Africa), not a **style** (e.g., "Bordeaux Blend")
2. OR the wine record already has explicit country data

**Implementation:**
```javascript
const PROTECTED_GEOGRAPHICAL_STYLES = [
  'bordeaux', 'champagne', 'burgundy', 'chianti', 'rioja', 'barolo'
];

function inferCountryFromStyle(style) {
  const normalised = style.toLowerCase();
  if (PROTECTED_GEOGRAPHICAL_STYLES.some(pgi => normalised.includes(pgi))) {
    return null; // Do not infer - ambiguous
  }
  // ... existing region-to-country mapping for unambiguous cases
}
```

---

## 5. Source Selection Improvements

### Problem

`REGION_SOURCE_PRIORITY` in `sourceRegistry.js` is keyed by **country** only. This is too coarse.

**Example:** A high-end Barolo (Piedmont, Italy) should prioritise Vinous (Antonio Galloni is the Barolo authority) over generic Italian sources like Vivino.

### Fix

Add region-level priority:
```javascript
const REGION_SOURCE_PRIORITY = {
  Italy: {
    default: ['vivino', 'gambero_rosso'],
    Piedmont: ['vinous', 'gambero_rosso', 'wine_spectator'],
    Tuscany: ['wine_spectator', 'gambero_rosso']
  },
  // ...
};
```

Modify `getSourcesForWine()` to check `wine.region` before falling back to country-level defaults.

---

## 6. Code Quality (SOLID Principles)

### 6.1 Single Responsibility Violation in claude.js

**Problem:** `src/services/claude.js` handles:
- AI prompt construction
- Database queries (`getSommelierRecommendation`)
- Scraping orchestration

**Fix:** Extract DB logic to `src/services/wineService.js` or `src/services/sommelier.js`. `claude.js` should accept data and return AI responses only.

### 6.2 Redundant Fetch/Parse Logic

Fetch logic exists in both:
- `searchProviders.js` (`fetchPageContent`)
- `claude.js` (snippet extraction)

Vivino "blocked domain" handling is scattered across both files.

**Fix:** Create `src/services/parserService.js` that centralises all "Text to Rating" parsing. `searchProviders.js` handles raw fetching only.

---

## 7. Frontend State Management

### Problem

`ratings.js` and `modals.js` are tightly coupled but unaware of each other's state changes. Direct DOM manipulation leads to race conditions and "layout thrashing".

### Fix Options

**Option A - Event Bus:**
```javascript
// After ratings fetch completes
document.dispatchEvent(new CustomEvent('wine-data-updated', { 
  detail: { wineId, tasting_notes: wineData.tasting_notes } 
}));

// In modals.js
document.addEventListener('wine-data-updated', (e) => {
  if (e.detail.wineId === currentModalWineId) {
    updateModalDisplay(e.detail);
  }
});
```

**Option B - Shared State Object:**
```javascript
// appState.js
export const appState = {
  wines: {},
  updateWine(id, data) {
    this.wines[id] = { ...this.wines[id], ...data };
    this.notify(id);
  },
  subscribe(callback) { /* ... */ }
};
```

---

## 8. UX Improvements

| Issue | Current Behaviour | Recommended Fix |
|-------|-------------------|-----------------|
| Tasting notes after fetch | Not visible until modal reopened | Update DOM immediately (see Section 1) |
| Manual rating added | No visual confirmation of recalculated score | Refresh ratings panel after save |
| Fetch in progress | Progress bar only | Add "Checking for notes..." in tasting notes section |
| Grid/modal desync | Grid shows stale data after modal changes | Call `refreshData()` or patch single wine in state |
| Override indicator | User doesn't know if score includes their input | Show icon/text "(includes your rating)" |

---

## Action Plan

### Immediate (Before Next Deploy)

1. **Fix tasting notes bug** - Implement the `handleFetchRatings` refactor (Section 1)
2. **Update schema.sql** - Add `tasting_notes` column
3. **Add wine_name index** - Performance improvement

### Short Term (Next Sprint)

4. **Merge source configs** - Consolidate `ratingSources.js` and `sourceRegistry.js`
5. **Fix country inference** - Exclude protected geographical styles
6. **Add region-level source priority** - For Piedmont, Burgundy, Napa, etc.

### Medium Term (Backlog)

7. **Refactor claude.js** - Extract DB logic to separate service
8. **Centralise parsing** - Create `parserService.js`
9. **Implement event bus or shared state** - For frontend synchronisation
10. **UI polish** - Override indicators, better progress feedback

---

## Files to Modify

| File | Changes |
|------|---------|
| `public/js/ratings.js` | Fix `handleFetchRatings` to fetch wine details |
| `data/schema.sql` | Add `tasting_notes` column, add index |
| `src/config/ratingSources.js` | Merge into unified config |
| `src/config/sourceRegistry.js` | Merge into unified config, add region priority |
| `src/services/searchProviders.js` | Update `inferCountryFromStyle`, use new config |
| `src/services/claude.js` | Extract DB logic (medium term) |
| `public/js/modals.js` | Listen for state updates (medium term) |

---

## Test Cases for Validation

1. **Tasting Notes:** Fetch ratings for a wine → notes should appear immediately in modal without reopening
2. **Bordeaux Blend (SA):** Add a South African "Bordeaux Blend" → should search Platter's, not Guide Hachette
3. **Barolo:** Add a Barolo → should prioritise Vinous over generic Italian sources
4. **Manual Rating:** Add a manual rating → aggregated score should update immediately
5. **Fresh Deploy:** Run against fresh schema.sql → `tasting_notes` column should exist
