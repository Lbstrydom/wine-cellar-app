# User Test Issues - Implementation Plan

**Date**: 7 January 2026
**Source**: User testing on mobile device

---

## Issue Summary

| # | Issue | Priority | Effort | Category |
|---|-------|----------|--------|----------|
| 1 | "Transaction is not a function" error on fridge add | P1-Critical | Low | Bug |
| 2 | Fridge suggestions should prioritize Reduce-Now wines | P2-High | Medium | Enhancement |
| 3 | Horizontal viewing mode for mobile | P3-Medium | Medium | Feature |
| 4 | "Open bottle" classification and visual indicator | P3-Medium | High | Feature |
| 5 | Cache cellar analysis results | P2-High | Medium | Performance |
| 6 | Fridge zone ordering/categorization | P3-Medium | Medium | Feature |
| 7 | Mobile scroll vs drag conflict | P1-Critical | Medium | UX Bug |

---

## Issue 1: "Transaction is not a function" Error

### Status: RESOLVED (Legacy)
This error is from a legacy code path that no longer exists. No action needed.

---

## Issue 2: Prioritize Reduce-Now Wines for Fridge Suggestions

### Current Behavior
- `fridgeStocking.js` scores wines by:
  - Drink-by urgency (+100 for past, +80 within 1 year)
  - Preferred zones (+30)
  - Wine ID (newer = slight bonus)

### Problem
- Doesn't explicitly check if wine is in Reduce-Now list
- Should prioritize wines already flagged for urgent drinking

### Fix Plan
1. Fetch reduce-now wine IDs before candidate selection
2. Add +150 bonus for wines in reduce-now list
3. Fall back to regular scoring if no reduce-now wines in category

### Implementation
```javascript
// In fridgeStocking.js - findSuitableWines()
const reduceNowIds = await getReduceNowWineIds();

// Add to scoring
if (reduceNowIds.has(wine.id)) {
  score += 150; // Highest priority
  reason = 'Flagged for drinking soon';
}
```

### Files to Modify
- `src/services/fridgeStocking.js` - Add reduce-now bonus scoring
- `src/routes/cellar.js` - Pass reduce-now context to fridge analysis

---

## Issue 3: Horizontal Viewing Mode for Mobile

### Current State
- Fixed portrait layout
- Grid is 9 columns wide, hard to see on phone

### Design Options

**Option A: CSS Rotate Transform**
- Rotate grid 90 degrees
- Swap touch coordinates
- Simple but awkward scroll behavior

**Option B: Landscape Lock Button**
- Use Screen Orientation API
- `screen.orientation.lock('landscape')`
- Only works in fullscreen/PWA mode

**Option C: Zoom/Pan with Pinch Gesture (Recommended)**
- Add pinch-to-zoom on grid area
- Add pan gesture when zoomed
- Keep natural scroll when not zoomed
- Most intuitive for mobile users

### Implementation Plan
1. Add CSS transforms for zoom: `transform: scale(${zoomLevel})`
2. Detect pinch gesture distance changes
3. Implement pan with touch-move when zoomed
4. Add zoom controls (+ / - buttons) as fallback
5. Store zoom preference in localStorage

### Files to Modify
- `public/js/grid.js` - Add zoom state and transforms
- `public/css/styles.css` - Zoom container styles
- `public/index.html` - Add zoom controls

---

## Issue 4: "Open Bottle" Classification

### Concept
- Wine can be in cellar/fridge but partially consumed
- Visual indicator: different color/icon on grid
- Pairing suggestions should prefer open bottles
- Full UI/UX integration

### Database Schema Change
```sql
ALTER TABLE slots ADD COLUMN is_open BOOLEAN DEFAULT FALSE;
ALTER TABLE slots ADD COLUMN opened_at TIMESTAMP;
ALTER TABLE slots ADD COLUMN remaining_ml INTEGER; -- Optional: track remaining
```

### UI/UX Integration
1. **Grid Visual**: Distinct slot styling (e.g., amber/gold border, wine glass icon)
2. **Quick Action**: Tap slot → "Mark as Open" button in bottle modal
3. **Context Menu**: Long-press shows "Open/Seal" option
4. **Wine List**: Filter by "Open Bottles"
5. **Fridge Priority**: Open bottles shown first in fridge view
6. **Pairing Panel**: "You have an open bottle of X that pairs well"
7. **Notifications**: "Open bottle reminder: Finish within 3-5 days"
8. **Stats Panel**: "Open bottles: 2" in dashboard

### Implementation Plan
1. Add migration for `is_open`, `opened_at` columns
2. Add API endpoints: `PUT /api/slots/:location/open`, `PUT /api/slots/:location/seal`
3. Update slot rendering with open styling (gold/amber indicator)
4. Add "Mark as Open" button to bottle detail modal
5. Modify pairing algorithm to boost open bottles (+200 score)
6. Add "Open Bottles" quick filter in wine list
7. Show open bottle suggestions in pairing results
8. Add open bottle count to stats API

### Files to Modify
- `data/migrations/017_open_bottles.sql` - Schema
- `src/routes/slots.js` - Open/seal endpoints
- `src/routes/stats.js` - Open bottle count
- `public/js/grid.js` - Visual styling with open indicator
- `public/js/modals.js` - "Mark as Open" button
- `public/css/styles.css` - Open bottle styles (gold border, icon)
- `src/services/pairing.js` - Prefer open bottles in suggestions
- `src/services/drinkNowAI.js` - Include open bottles in recommendations

---

## Issue 5: Cache Cellar Analysis Results

### Current State
- Analysis recalculated on every tab switch
- No persistence between page reloads
- Expensive AI calls repeated unnecessarily

### Caching Strategy (3-Tier)

**Tier 1: Database (Supabase/PostgreSQL) - Primary**
- Store analysis results in `cellar_analysis_cache` table
- Survives page reloads and device switches
- Single source of truth
- Invalidated when wines/slots change

**Tier 2: localStorage - Fast Load**
- Cache last analysis for instant display
- Show immediately while checking for updates
- Fallback if offline

**Tier 3: In-Memory - Session**
- `currentAnalysis` variable for tab switches
- No API call needed within session

### Database Schema
```sql
CREATE TABLE cellar_analysis_cache (
  id SERIAL PRIMARY KEY,
  analysis_type VARCHAR(50) NOT NULL, -- 'full', 'fridge', 'zones'
  analysis_data JSONB NOT NULL,
  wine_count INTEGER, -- For invalidation check
  slot_hash VARCHAR(64), -- Hash of slot assignments for change detection
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  UNIQUE(analysis_type)
);
```

### Cache Flow
```
1. User opens Cellar Analysis tab
2. Check localStorage → show cached data immediately (if exists)
3. Call GET /api/cellar/analysis/cached
4. If valid cache exists in DB:
   - Compare slot_hash with current state
   - If match: use cached analysis
   - If mismatch: invalidate and re-analyze
5. If no cache or stale: run analysis, store in DB
6. Update localStorage with fresh data
```

### Invalidation Triggers
- Wine added/deleted/updated
- Slot assignment changed (move, swap, remove)
- Manual "Refresh Analysis" click
- Cache older than 24 hours

### Implementation Plan
1. Add migration for `cellar_analysis_cache` table
2. Add API endpoints:
   - `GET /api/cellar/analysis/cached` - Get cached or compute fresh
   - `DELETE /api/cellar/analysis/cache` - Invalidate cache
3. Add slot hash computation (MD5 of wine_id assignments)
4. Update frontend to use cache-first strategy
5. Add cache invalidation calls to wine/slot mutations
6. Show "Last analyzed: X minutes ago" in UI

### Files to Modify
- `data/migrations/017_analysis_cache.sql` - Schema
- `src/routes/cellar.js` - Cache endpoints
- `src/services/cellarAnalysis.js` - Cache logic
- `public/js/cellarAnalysis.js` - Cache-first loading
- `public/js/api.js` - Cache invalidation on mutations
- `public/js/app.js` - Invalidate on data changes

---

## Issue 6: Fridge Zone Ordering/Categorization

### Current State
- Fridge slots (F1-F9) have no zone assignment
- Cellar zones work well (Everyday, Premium, etc.)
- Fridge analysis shows category breakdown but not slot organization

### Design Options

**Option A: Visual Grouping Only**
- Group fridge display by category (Sparkling, Crisp White, etc.)
- No physical reorganization
- Show category labels in UI

**Option B: Suggested Positions**
- Assign categories to slot ranges (F1-F2: Sparkling, F3-F5: White, etc.)
- Show suggestions when adding to fridge
- Color-code slots by category

**Option C: Auto-Arrange Feature (Recommended)**
- "Organize Fridge" button
- AI suggests optimal arrangement
- User confirms moves
- Slots get category metadata

### Implementation Plan
1. Add fridge category display in Cellar Analysis
2. Add `fridge_zone` column to slots table (optional categorization)
3. Create fridge layout suggestion algorithm
4. Add "Organize Fridge" button that generates moves
5. Color-code fridge slots by detected category

### Files to Modify
- `data/migrations/018_fridge_zones.sql` - Optional schema
- `src/services/fridgeStocking.js` - Category arrangement logic
- `public/js/grid.js` - Fridge category rendering
- `public/css/styles.css` - Category colors

---

## Issue 7: Mobile Scroll vs Drag Conflict (CRITICAL)

### Problem
- Touching a bottle initiates drag
- Cannot scroll the cellar view
- Must use browser scrollbar (not accessible on mobile)

### Root Cause
- Touch events on slots are captured immediately
- `touchstart` begins drag state
- No way to distinguish scroll intent from drag intent

### Solution Options

**Option A: Long-Press to Drag (Recommended)**
- Normal touch = scroll
- Long-press (500ms) = start drag
- Visual feedback: slot pulses before entering drag mode
- Most intuitive for mobile users

**Option B: Drag Handle**
- Add drag icon/handle to each slot
- Only dragging handle initiates move
- Takes up visual space

**Option C: Edit Mode Toggle**
- Add "Edit Mode" button
- Normal mode = scroll only
- Edit mode = drag enabled
- Extra step for users

### Implementation Plan (Option A: Long-Press)
1. Add `longPressTimer` to touch state
2. On `touchstart`: start timer, don't initiate drag
3. After 500ms: trigger drag start, show visual feedback
4. On `touchmove` before timer: cancel timer, allow scroll
5. On `touchend` before timer: cancel timer (was a tap)
6. Add CSS animation for "entering drag mode"

### Code Changes
```javascript
// In dragdrop.js
const LONG_PRESS_DURATION = 500; // ms
let longPressTimer = null;
let touchStartPos = null;

function handleTouchStart(e) {
  const slot = e.target.closest('.slot');
  if (!slot?.dataset.wineId) return;

  touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };

  // Start long-press timer
  longPressTimer = setTimeout(() => {
    // Haptic feedback if available
    navigator.vibrate?.(50);
    initiateDrag(slot, e);
  }, LONG_PRESS_DURATION);
}

function handleTouchMove(e) {
  if (longPressTimer) {
    // Check if moved significantly (scroll intent)
    const dx = Math.abs(e.touches[0].clientX - touchStartPos.x);
    const dy = Math.abs(e.touches[0].clientY - touchStartPos.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      // Allow native scroll
      return;
    }
  }
  // ... existing drag logic
}
```

### Files to Modify
- `public/js/dragdrop.js` - Long-press detection
- `public/css/styles.css` - Drag-pending animation

---

## Recommended Implementation Order

### Phase 1: Critical Fixes
1. **Issue 7**: Mobile scroll vs drag - most impactful UX fix
2. ~~**Issue 1**: Transaction error~~ - RESOLVED (legacy)

### Phase 2: High Priority
3. **Issue 5**: Cache analysis results (with DB storage) - performance improvement
4. **Issue 2**: Reduce-Now prioritization - better suggestions

### Phase 3: New Features
5. **Issue 6**: Fridge categorization
6. **Issue 4**: Open bottle tracking (with full UI/UX)
7. **Issue 3**: Horizontal/zoom viewing

---

## Estimated Effort

| Issue | Complexity | Hours | Dependencies |
|-------|------------|-------|--------------|
| 1 | N/A | 0 | Resolved |
| 2 | Medium | 4 | None |
| 3 | Medium | 6 | None |
| 4 | High | 10 | DB migration |
| 5 | Medium | 6 | DB migration |
| 6 | Medium | 6 | Issue 5 |
| 7 | Medium | 4 | None |

**Total Estimated: ~36 hours**

---

*Created: 7 January 2026*
*Status: ALL ISSUES COMPLETE*

---

## Implementation Summary (7 January 2026)

### Completed

**Phase 1 - Issue 7: Mobile Scroll vs Drag (DONE)**
- Added long-press (500ms) to initiate drag on mobile
- Normal touch allows scroll; only long-press starts drag
- Added `drag-pending` CSS animation for visual feedback
- Modified `handleTouchStart`, `handleTouchMove`, `handleTouchEnd` in dragdrop.js

**Phase 2a - Issue 5: Cache Analysis Results (DONE)**
- Created `cellar_analysis_cache` table (migration 021)
- Added cache functions to `cacheService.js`:
  - `generateSlotHash()` - MD5 hash of slot assignments for invalidation
  - `getCachedAnalysis()` - retrieves cached analysis, validates hash
  - `cacheAnalysis()` - stores analysis with 24h TTL
  - `invalidateAnalysisCache()` - clears cache on slot changes
- Updated `/api/cellar/analyse` to use cache-first strategy
- Added `?refresh=true` query param to force fresh analysis
- Added cache status display in UI ("Cached Xm ago")
- Cache automatically invalidated when slots change (move, swap, drink, add, remove)

**Phase 2b - Issue 2: Reduce-Now Prioritization (DONE)**
- Modified `findSuitableWines()` in fridgeStocking.js to fetch reduce-now wine IDs
- Wines in reduce-now list get +150 score bonus (highest priority)
- Added `isReduceNow` flag to fridge candidates
- Pre-fetches reduce-now IDs once per analysis to avoid N+1 queries

**Phase 3a - Issue 4: Open Bottle Tracking (DONE)**
- Created migration 022 for `is_open`, `opened_at` columns on slots table
- Added API endpoints: `PUT /api/slots/:location/open`, `PUT /api/slots/:location/seal`, `GET /api/slots/open`
- Added "Mark Open/Sealed" toggle button in bottle modal
- Added gold border visual indicator for open bottles (🍷 icon)
- Added `open_bottles` count to stats API
- Added CSS for `.is-open`, `.btn-warning` styling

**Phase 3b - Issue 6: Fridge Zone Categorization (DONE)**
- Added `suggestFridgeOrganization()` function to fridgeStocking.js
- Groups fridge wines by category in temperature order (coldest at top)
- Added `GET /api/cellar/fridge-organize` endpoint
- Added "Organize Fridge" button in Cellar Analysis fridge status
- Shows suggested moves to group wines by category
- Execute individual moves or all at once

**Phase 3c - Issue 3: Zoom/Pan Viewing Mode (DONE)**
- Added pinch-to-zoom gesture support for touch devices
- Added pan gestures when zoomed in (>1x)
- Added zoom controls (+, -, reset) in cellar header
- Zoom level persisted in localStorage
- Ctrl+scroll wheel zoom for desktop
- CSS transforms for smooth scaling

### Files Modified
- `public/js/dragdrop.js` - Long-press to drag implementation
- `public/js/grid.js` - Zoom controls, pinch-to-zoom, pan gestures
- `public/js/app.js` - Import and init zoom controls
- `public/js/modals.js` - Open bottle toggle button
- `public/js/api.js` - openBottle, sealBottle, getOpenBottles, getFridgeOrganization
- `public/js/cellarAnalysis.js` - Fridge organize UI
- `public/css/styles.css` - Open bottle styles, zoom controls, fridge organize panel
- `public/index.html` - Zoom controls, open bottle button
- `src/routes/slots.js` - Open/seal endpoints
- `src/routes/stats.js` - is_open in layout, open_bottles count
- `src/routes/cellar.js` - fridge-organize endpoint
- `src/services/fridgeStocking.js` - suggestFridgeOrganization()
- `data/migrations/022_open_bottles.sql` - Schema
- `data/migrations/postgres/supabase_missing_objects.sql` - Supabase updates
