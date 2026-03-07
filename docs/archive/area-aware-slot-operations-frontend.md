# Plan: Area-Aware Slot Operations — Frontend Completion

- **Date**: 2026-03-06
- **Status**: Completed (2026-03-06) — audited & signed off (2026-03-06)
- **Author**: Claude + User
- **Parent**: [area-aware-slot-operations.md](area-aware-slot-operations.md) — Phase 2, Fix A
- **Scope**: Detailed implementation plan for Phase 2 Fix A — threading `storage_area_id` through
  the analysis move-execution pipeline (`moves.js`, `moveGuide.js`, `fridge.js`) via a shared
  `getAreaIdForLocation()` helper. Backend is fully area-aware; this plan covers the remaining
  frontend call sites.

---

## 1. Current UI Audit

### What Already Exists (Implemented)

Exploration of the live codebase reveals that **~85% of the Phase 1 plan is already shipped**.
The backend is fully area-aware, and most frontend paths already thread `storage_area_id`.

#### Backend — Fully Implemented

| Component | Status | Evidence |
|-----------|--------|----------|
| `storageAreaResolver.js` | ✅ Shipped | `resolveStorageAreaId()` + `resolveAreaFromSlot()` with 409 defence |
| `schemas/slot.js` | ✅ Shipped | `from_storage_area_id`, `to_storage_area_id`, `storage_area_id` — all optional UUID |
| `routes/slots.js` | ✅ Shipped | All 9 endpoints use 3-column `WHERE cellar_id AND location_code AND storage_area_id` |
| `routes/stats.js` | ✅ Shipped | Layout API returns `storage_area_id` in all slot data (legacy + dynamic paths) |
| `routes/cellar.js` | ✅ Shipped | `suggest-placement` returns `storage_area_id` |
| `routes/bottles.js` | ✅ Shipped | `getGridLimits(cellarId, storageAreaId)` accepts area |
| `routes/pairing.js` | ✅ Shipped | Response includes `storage_area_id` in wine/slot data |
| `routes/cellarReconfiguration.js` | ✅ Shipped | `/execute-moves` resolves missing area IDs via `resolveAreaFromSlot()`, uses area guards in UPDATE queries |
| `services/cellar/cellarLayout.js` | ✅ Shipped | `getStorageAreaRows(cellarId, areaId)` filters by area |

#### Frontend — Already Implemented

| File | Function | Passes Area ID? |
|------|----------|-----------------|
| `grid.js` | `createSlotElement()` | ✅ `data-storage-area-id` attribute on all slots |
| `modals.js` | `handleDrinkBottle()` | ✅ Extracts `currentSlot.storage_area_id`, passes to API |
| `modals.js` | `handleToggleOpenBottle()` | ✅ Passes to `openBottle()` / `sealBottle()` |
| `dragdrop.js` | `handleDrop()` + touch | ✅ Extracts from both source + target `dataset.storageAreaId` |
| `bottles/modal.js` | `findSlotData(location, areaId?)` | ✅ Matches on area when provided, falls back to location-only |
| `bottles/form.js` | `addBottlesToSlots()` | ✅ Passes `suggestion.storage_area_id` |
| `bottles/form.js` | `handleDeleteBottle()` | ✅ Passes `bottleState.editingStorageAreaId` |
| `api/wines.js` | `moveBottle(from, to, fromAreaId, toAreaId)` | ✅ Dual area params |
| `api/wines.js` | `directSwapBottles(a, b, areaA, areaB)` | ✅ Dual area params |
| `api/wines.js` | `drinkBottle(location, {storage_area_id})` | ✅ In opts object |
| `api/cellar.js` | `executeCellarMoves(moves)` | ✅ Accepts `from_storage_area_id` / `to_storage_area_id` per move |
| `cellarAnalysis/fridge.js` | `moveCandidate()` | ✅ Passes dual area IDs |
| `cellarAnalysis/fridge.js` | `swapFridgeCandidate()` | ✅ Both swap partners |
| `cellarAnalysis/fridge.js` | `executeTransfer()` | ✅ Cross-area with dual IDs |
| `pairing.js` | `showDrinkActionPanel()` | ⚠️ Intentionally omits — backend resolves via `resolveAreaFromSlot()` |

### Existing Design Language

- **Dark theme** with CSS variables (`--bg-dark`, `--bg-card`, `--bg-slot`, etc.)
- **Serif headings** (Cormorant Garamond) + **sans body** (DM Sans)
- **Slot size**: 90×60px desktop, 75×56px mobile
- **Wine colour border**: 3px left border (`--red-wine`, `--white-wine`, etc.)
- **Modal pattern**: Fixed overlay (`rgba(0,0,0,0.8)`) + centred card (max-width 400px, 12px border-radius)
- **Toast notifications**: For success/error feedback on all operations
- **Priority badges**: Position-absolute corner badges (N/S/H)

### Reusable Patterns

- **Context passing**: `dataset.*` attributes on DOM elements → extract in event handlers
- **Module state**: Closure variables (`currentSlot`, `bottleState`) hold operation context
- **API layer**: All calls through `api/` barrel — `apiFetch()` adds auth + cellar headers
- **Event delegation**: Grid click → `handleSlotClick(slotEl)` → route by state

### Pain Points Identified

None UX-visible — the remaining gaps are **invisible plumbing**. Area IDs are a backend
identity mechanism that users never see or interact with. The only user-facing consequence
of missing area IDs is a marginal performance cost (one extra DB lookup per operation via
`resolveAreaFromSlot()`) — which is imperceptible.

---

## 2. User Flow & Wireframe

### No User-Visible Changes

This plan involves **zero UI changes**. There are no new screens, modals, buttons, labels,
or visual elements. The change is entirely about threading an invisible identifier
(`storage_area_id`) through move execution paths that currently omit it.

**User flow is identical before and after:**

```
User triggers cellar analysis
  → AI generates move suggestions (from: R3C2, to: R7C4)
  → User clicks "Execute" or steps through Move Guide
  → Frontend calls executeCellarMoves([{ from, to, wineId, ... }])
  → Backend resolves area IDs + executes
  → Grid refreshes → Toast confirms

BEFORE this plan: Backend resolves missing area IDs via resolveAreaFromSlot() (extra query)
AFTER this plan:  Frontend sends area IDs upfront (zero extra queries)
```

### Why This Matters Despite No UX Change

1. **Performance**: Eliminates N extra DB queries per move batch (one per move without area ID)
2. **Consistency**: All `executeCellarMoves()` callers consistently supply area IDs, matching
   the pattern already used by fridge transfers, drag-drop, and modal operations
3. **Defence in depth**: Explicit area IDs prevent wrong-slot mutations if the backend
   `resolveAreaFromSlot()` fallback ever returns an unexpected result

---

## 3. UX Design Decisions

### Principle Application

Since this is invisible plumbing, most UX principles apply at the **meta/system** level:

| Principle | Application |
|-----------|-------------|
| **#11 Feedback & System Status** | No change — toast feedback remains identical. Move execution already shows success/failure toasts. |
| **#12 Error Prevention** | **Strengthened** — explicit area IDs prevent wrong-slot mutations if constraint ever relaxes. Backend's 409 defence-in-depth remains as secondary guard. |
| **#10 Consistency** | **Improved** — all `executeCellarMoves()` callers will consistently provide area IDs, matching the pattern already used by fridge transfers, drag-drop, and modal operations. |
| **#23 State Coverage** | No change — error/loading/success states already handled by existing toast + grid refresh pattern. |
| **#24 Performance Perception** | **Marginal improvement** — eliminating `resolveAreaFromSlot()` queries reduces backend latency by ~5-15ms per move in a batch, though users are unlikely to notice. |

### Gestalt Principles

Not applicable — no visual layout changes.

### Accessibility

Not applicable — no new interactive elements, ARIA attributes, or focus targets.

---

## 4. Technical Architecture

### Data Flow: Move Object Enrichment

The key architectural question is: **where should area IDs be added to move objects?**

```
cellarSuggestions.js generates moves  ← NO area IDs (location_code only)
         │
         ▼
Backend returns analysis response with moves array
         │
         ▼
Frontend receives moves ← moves have {from, to, wineId, ...} but NO area IDs
         │
         ├─ moves.js          ← calls executeCellarMoves()
         ├─ moveGuide.js      ← calls executeCellarMoves()
         └─ fridge.js         ← calls executeCellarMoves() (organize only)
```

**Two options for enrichment:**

#### Option A: Enrich at the frontend before calling API (requires slot lookup)

```javascript
// Frontend would need to look up area IDs from layout state
const enrichedMoves = moves.map(move => ({
  ...move,
  from_storage_area_id: findSlotAreaId(move.from),
  to_storage_area_id: findSlotAreaId(move.to),
}));
await executeCellarMoves(enrichedMoves);
```

**Pros**: Frontend sends complete data; zero extra backend queries.
**Cons**: Requires a helper to look up area ID from `state.layout` by location code.

#### Option B: Enrich at the backend (already implemented)

The `/execute-moves` endpoint already resolves missing area IDs via `resolveAreaFromSlot()`.
This is the **current production behaviour** and works correctly.

**Pros**: Zero frontend changes needed.
**Cons**: N extra DB queries per batch (one per move); callers remain inconsistent with the rest
of the pipeline.

#### Decision: Option A (Frontend Enrichment)

**Rationale** (Principles #1 DRY, #10 Consistency):
- Aligns with the pattern already used by `fridge.js` (transfers/swaps), `dragdrop.js`, and `modals.js`
- Eliminates avoidable `resolveAreaFromSlot()` fallback queries on the most-used analysis paths

### Component Interaction

```
state.layout (app.js)
    │
    └─ Contains slot objects with storage_area_id
         │
         ├─ grid.js: createSlotElement() adds data-storage-area-id to DOM ─────────────────┐
         │                                                                                   │
         ├─ moves.js: getAreaIdForLocation() helper looks up area from layout ──────┐       │
         │    └─ executeSingleMove() enriches move with area IDs                     │       │
         │    └─ executeAllMoves() enriches batch                                    │       │
         │    └─ executeBatchMoves() enriches batch                                  │       │
         │                                                                           │       │
         ├─ moveGuide.js: executeCurrentMove() enriches move with area IDs ─────────┤       │
         │                                                                           │       │
         └─ fridge.js: executeFridgeOrganizeMove() enriches move with area IDs ─────┤       │
                                                                                     │       │
                                                                            Uses shared helper
                                                                      getAreaIdForLocation()
```

### Shared Helper: `getAreaIdForLocation()`

A small utility to look up `storage_area_id` from a layout snapshot by location code.
This avoids duplicating the lookup logic across 3 files.

**Module-cycle constraint**: `app.js` already imports `utils.js` (line 31). Adding an import
of `app.js` (for `state`) into `utils.js` would create a cycle and break module loading. The
helper therefore accepts `layout` as an explicit parameter — callers pass `state.layout` directly.
`utils.js` gains **no new imports**.

```javascript
/**
 * Look up storage_area_id for a location code from a layout snapshot.
 * Returns null if not found (backend will resolve via fallback).
 * @param {Object|null} layout - Current layout (pass state.layout from caller)
 * @param {string} locationCode - e.g., "R5C3", "F2"
 * @returns {string|null} storage_area_id UUID or null
 */
export function getAreaIdForLocation(layout, locationCode) {
  if (!layout) return null;

  // Dynamic areas path
  if (layout.areas) {
    for (const area of layout.areas) {
      for (const row of area.rows || []) {
        for (const slot of row.slots || []) {
          if (slot.location_code === locationCode) return slot.storage_area_id || area.id;
        }
      }
    }
  }

  // Legacy path: cellar + fridge rows
  for (const section of ['cellar', 'fridge']) {
    const rows = layout[section]?.rows || [];
    for (const row of rows) {
      for (const slot of row.slots || []) {
        if (slot.location_code === locationCode) return slot.storage_area_id || null;
      }
    }
  }

  return null;
}
```

**Callers** (`moves.js`, `moveGuide.js`, `fridge.js`) already import `state` from `app.js`.
They pass `state.layout` as the first argument:
```javascript
from_storage_area_id: getAreaIdForLocation(state.layout, move.from),
to_storage_area_id:   getAreaIdForLocation(state.layout, move.to),
```

**Location**: `public/js/utils.js` — already the home for shared frontend utilities. No
new imports added to `utils.js`; no module cycle introduced.

**Why a helper instead of inline**: Three separate files need the same lookup. Inlining
would violate DRY (#29) and create three slightly different implementations that could
drift over time.

---

## 5. State Map

### No New Components or Visual States

Since this plan adds no UI elements, the standard state map (empty/loading/error/success)
does not apply to new components. All affected components already have complete state handling:

| Component | Empty | Loading | Error | Success |
|-----------|-------|---------|-------|---------|
| Move execution (moves.js) | N/A (only invoked with moves) | "Executing move…" progress | Toast: "Move failed: {reason}" | Toast: "✓ Move executed" + grid refresh |
| Move Guide (moveGuide.js) | "No moves to execute" | Step progress indicator | Toast: error message | Next step or "All moves complete" |
| Fridge organize (fridge.js) | "No reorganisation needed" | "Organising…" spinner | Toast: error message | Grid refresh + success toast |

### Edge Cases

| Scenario | Current Handling | Change |
|----------|-----------------|--------|
| **Layout not loaded when move executes** | `state.layout` is null → `getAreaIdForLocation()` returns null → backend resolves | No change — graceful fallback |
| **Slot not in layout** (stale layout) | Helper returns null → backend resolves | No change — graceful fallback |
| **Move to newly created area** (layout stale) | Helper returns null → backend resolves | No change — graceful fallback |

The `|| null` fallback in `getAreaIdForLocation()` ensures the backend's `resolveAreaFromSlot()`
acts as a safety net for any case where the frontend layout is stale or incomplete.

---

## 6. File-Level Plan

### 6.1 Modified — `public/js/utils.js`

**Purpose**: Add `getAreaIdForLocation()` shared helper.
**Principle**: DRY (#29) — three files need the same layout-to-area lookup.
**Dependencies**: No new imports — callers pass `state.layout` explicitly to avoid an `app.js`
import cycle. Imported by `moves.js`, `moveGuide.js`, `fridge.js`.

**Changes**:
- Add `getAreaIdForLocation(layout, locationCode)` function
- Export it alongside existing utility functions

**Key export**:
```javascript
export function getAreaIdForLocation(layout, locationCode)
```

### 6.2 Modified — `public/js/cellarAnalysis/moves.js`

**Purpose**: Thread area IDs through all `executeCellarMoves()` call sites.
**Principle**: Consistency (#10) — match the pattern already used by fridge transfers and drag-drop.
**Dependencies**: Imports `getAreaIdForLocation` from `utils.js`.

**Changes** (7 call sites — verified in shipped code):

Each `executeCellarMoves([{ wineId, from, to, ... }])` call gains:
```javascript
from_storage_area_id: getAreaIdForLocation(state.layout, move.from),
to_storage_area_id: getAreaIdForLocation(state.layout, move.to),
```

**Call sites** (from shipped code):
1. Swap execution (swap move map)
2. Single move execution
3. Batch all-moves execution
4. Compaction `getExecuteMoves`
5. Grouping `getExecuteMoves` (primary move)
6. Grouping `getExecuteMoves` (swap partner)
7. `wireCrossRowButtons` step execution

### 6.3 Modified — `public/js/cellarAnalysis/moveGuide.js`

**Purpose**: Thread area IDs through the Move Guide step-by-step execution.
**Principle**: Consistency (#10).
**Dependencies**: Imports `getAreaIdForLocation` from `utils.js`.

**Changes** (1 call site):

`executeCurrentMove()` (~L444-467):
```javascript
const movesToExecute = [{
  wineId: move.wineId,
  wineName: move.wineName,
  from: move.from,
  to: move.to,
  from_storage_area_id: getAreaIdForLocation(state.layout, move.from),
  to_storage_area_id: getAreaIdForLocation(state.layout, move.to),
  ...(move.toZoneId ? { zoneId: move.toZoneId, confidence: move.confidence } : {})
}];
```

### 6.4 Modified — `public/js/cellarAnalysis/fridge.js`

**Purpose**: Thread area IDs through fridge organize moves (the only remaining gap in fridge.js).
**Principle**: Consistency (#10) — other fridge operations already pass area IDs.
**Dependencies**: Imports `getAreaIdForLocation` from `utils.js`.

**Changes** (2 functions):

`executeFridgeOrganizeMove()` (~L770):
```javascript
await executeCellarMoves([{
  wineId: move.wineId,
  from: move.from,
  to: move.to,
  from_storage_area_id: getAreaIdForLocation(state.layout, move.from),
  to_storage_area_id: getAreaIdForLocation(state.layout, move.to),
}]);
```

`executeAllFridgeOrganizeMoves()` (~L807) — same pattern for the batch variant.

---

## 7. Risk & Trade-off Register

### Trade-offs

| Trade-off | Rationale |
|-----------|-----------|
| **Helper looks up area from layout (O(slots) scan)** | Layout is small in practice (~200-400 slots). A Map would be premature optimisation. If needed later, `getAreaIdForLocation()` can be refactored to use a Map cache without changing callers. |
| **Null fallback instead of hard error** | Backend's `resolveAreaFromSlot()` already handles the missing-area case. Making the frontend helper throw would break execution when layout is stale — worse than an extra DB query. |
| **No changes to suggestion generation** | Move suggestion objects in `cellarSuggestions.js` remain area-ID-free. Area IDs are looked up at execution time from the live layout state, not baked into the suggestion. This is correct because move suggestions may be executed minutes after generation, during which the layout state is refreshed. |
| **`pairing.js` unchanged** | Deliberately remains as-is. The pairing drink action uses aggregated `rec.location` strings (`MIN()` across slots). The correct area for a multi-slot wine cannot be determined without knowing which specific slot the user intends to drink from. The backend fallback is the correct resolution path here. |

### What Could Go Wrong

| Risk | Impact | Mitigation |
|------|--------|------------|
| `getAreaIdForLocation()` returns wrong area for stale layout | LOW — backend 3-column WHERE clause prevents wrong-slot mutation; UPDATE would affect 0 rows → no data corruption, move fails gracefully | Backend's `resolveAreaFromSlot()` handles the retry; toast shows error |
| Import cycle: `utils.js` → `app.js` → `utils.js` | MEDIUM — would break module loading | Avoided by design: helper accepts `layout` as parameter; `utils.js` gains no new imports. Callers pass `state.layout` from their own existing `app.js` import. |
| `moves.js` has 6+ call sites to update | LOW — mechanical change | Each site follows identical pattern; unit tests cover all paths |
| Frontend helper diverges from backend resolution | LOW — both use same layout data | Both resolve from the same `storage_area_id` field in slot data |

### Deliberately Deferred

| Item | Why Deferred | When |
|------|-------------|------|
| **Area IDs in suggestion objects** (`cellarSuggestions.js`) | Suggestions may be stale at execution time; fresher to resolve from live `state.layout` at execution | If profiling shows `getAreaIdForLocation()` returning null too often |
| **`pairing.js` area enrichment** | Multi-slot wines need slot-specific user intent | Phase 2+ (if pairing UI gets per-slot drink buttons) |
| **Map cache for `getAreaIdForLocation()`** | O(slots) scan is fast enough for <500 slots | If profiling shows bottleneck |
| **`backend movePlanner.js` validateMovePlan area-awareness** | Validation currently uses location_code; safe while UNIQUE constraint exists | Phase 2 |

---

## 8. Testing Strategy

### Unit Tests

| Test File | What It Tests |
|-----------|--------------|
| `tests/unit/utils/getAreaIdForLocation.test.js` | **Created**. Helper with dynamic layout, legacy layout, missing slot, null layout, slot in fridge area (15 tests) |
| `tests/unit/cellarAnalysis/moveGuide.test.js` | **Modified**. Updated mocks for `getAreaIdForLocation` and `state`; verifies `executeCurrentMove()` includes area IDs |
| `tests/unit/cellarAnalysis/fridgeSwap.test.js` | **Modified**. Updated mocks for `getAreaIdForLocation` and `state`; verifies fridge organize calls include area IDs |

### Manual Testing Checklist

Since there are no visual changes, manual testing focuses on confirming operations still work:

- [ ] **Cellar Analysis → Execute single move**: Move executes, toast confirms, grid refreshes
- [ ] **Cellar Analysis → Execute all moves**: Batch executes, progress shown, grid refreshes
- [ ] **Move Guide → Step through moves**: Each step executes correctly
- [ ] **Fridge → Organize**: Fridge reorganisation executes, success feedback shown
- [ ] **Drag-drop → Move bottle**: Still works (already area-aware, regression check)
- [ ] **Modal → Drink bottle**: Still works (already area-aware, regression check)
- [ ] **Stale layout → Execute move**: Move still succeeds (backend fallback resolves area)

### Accessibility Testing

Not applicable — no new interactive elements or focus targets added.

### Responsive Breakpoints

Not applicable — no visual changes.

### Edge Case Scenarios

| Scenario | Expected Behaviour |
|----------|-------------------|
| Execute move with layout not loaded | `getAreaIdForLocation()` returns null → backend resolves → move succeeds |
| Execute move after adding new area | If layout is stale, returns null → backend resolves → move succeeds |
| Execute 50-move batch | Each move enriched individually; area IDs sent → zero fallback queries |
| Move between cellar and fridge area | `from_storage_area_id` ≠ `to_storage_area_id` → correct cross-area behaviour |

---

## 9. Implementation Order

1. **`utils.js`** — add `getAreaIdForLocation()` helper + unit tests
2. **`moves.js`** — enrich all 7 `executeCellarMoves()` call sites + update tests
3. **`moveGuide.js`** — enrich `executeCurrentMove()` + update tests
4. **`fridge.js`** — enrich 2 organize functions + update tests
5. **`sw.js`** — bump `CACHE_VERSION` (no new files, but code changed)
6. **Run `npm run test:unit`** — verify all tests pass

**Estimated scope**: ~4 files modified, ~1 test file created, ~4 test files modified.
No new visual components, CSS, or HTML changes.

---

## 10. Files Summary

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `public/js/utils.js` | **Modify** — add `getAreaIdForLocation()` | +25 |
| `public/js/cellarAnalysis/moves.js` | **Modify** — 6 call sites enriched | +12 |
| `public/js/cellarAnalysis/moveGuide.js` | **Modify** — 1 call site enriched | +2 |
| `public/js/cellarAnalysis/fridge.js` | **Modify** — 2 functions enriched | +4 |
| `public/sw.js` | **Modify** — bump cache version | +1 |
| `tests/unit/utils/getAreaIdForLocation.test.js` | **Created** — helper tests (15 tests) | +165 |
| `tests/unit/cellarAnalysis/moveGuide.test.js` | **Modified** — mock `getAreaIdForLocation` + `state`; area ID assertions | +10 |
| `tests/unit/cellarAnalysis/fridgeSwap.test.js` | **Modified** — mock `getAreaIdForLocation` + `state`; area ID assertions | +10 |

**Total**: 5 source files modified, 1 test file created, 2 test files modified.
