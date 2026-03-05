# Dynamic Placement & Commercial Readiness Plan

> **Goal**: Replace hardcoded cellar layout assumptions and greedy grouping with a flexible, commercially-deployable system that supports variable cellar configurations, multiple storage areas, and adaptive zone management.

---

## Progress Tracker

### Section Overview

| Section | Name | Phases | Status | Progress |
|---------|------|--------|--------|----------|
| **A** | Core Grouping Engine | 1.1 – 1.4 | ✅ DONE | 4 / 4 |
| **B** | Analysis Infrastructure | 1.5 – 1.6 | ✅ DONE | 2 / 2 |
| **C** | Grouping UI | 1.7 | ✅ DONE | 1 / 1 |
| **D** | Full Hardcoding Removal | 2.1 – 2.3 | ✅ DONE | 3 / 3 |
| **E** | Multi-Storage-Area Grouping | 3.1 – 3.2 | NOT STARTED | 0 / 2 |
| **F** | Zone Auto-Discovery | 4.1 – 4.4 | NOT STARTED | 0 / 4 |

### Detailed Phase Tracker

| Phase | Description | Status | Owner | Notes |
|-------|-------------|--------|-------|-------|
| **1.1** | Layout provider service | ✅ DONE | — | cellarLayout.js + hardcoding removed from cellarMetrics/cellarSuggestions/cellarPlacement/bottleScanner |
| **1.2** | Target-first grouping algorithm | ✅ DONE | — | Branch-and-bound optimizer, cycle decomposition |
| **1.3** | Grouping test suite (unit + property) | ✅ DONE | — | 26 unit + 11 property tests (500 trials each) |
| **1.4** | Wire grouping into analysis pipeline | ✅ DONE | — | storageAreaRows threaded through grouping + compaction; groupingSteps in report; 2 new integration tests |
| **1.5** | Zone move fixes + swap metadata | ✅ DONE | — | 'Make room' string coupling replaced with isDisplacement flag in moves.js L1004/L1006/L1040 |
| **1.6** | Cache fingerprint update | ✅ DONE | — | storage_area_rows added to hash; ANALYSIS_LOGIC_VERSION bumped 7→8 |
| **1.7** | Frontend step UI + progress | ✅ DONE | — | renderGroupingSteps: numbered step cards (move/swap/rotation), local progress Set, Execute All, per-step execute. Rotation steps show all k moves explicitly. CSS: move-step-badge, move-step--next/completed, move-progress-bar. sw.js v193→v194. |
| **2.1** | Backend: zone planner & solver | ✅ DONE | — | cellarLayoutSettings, rowAllocationSolver (totalRows param), zoneReconfigurationPlanner (getCellarRowCount/getStorageAreaRows), zoneLayoutProposal (getStorageAreaRows/getCellarRowCount/getRowCapacity) |
| **2.2** | Backend: bottles route & fridge | ✅ DONE | — | bottles.js: getGridLimits() async factory; bottleScanner: storageAreaRows param in scanBottles/rowCleanlinessSweep; fridgeStocking: dynamic fridge slot count via getStorageAreasByType |
| **2.3** | Frontend: grid + fridge + layout API | ✅ DONE | — | GET /api/cellar/layout added to cellarZoneLayout.js; fridge.js line 266 uses findEmptyFridgeSlot(); grid.js already dynamic |
| **3.1** | Storage-area-scoped grouping | NOT STARTED | — | Depends on 2.3. ⚠️ Reviewer flag: add candidate count limiter for extreme cases (W>5 multi-bottle wines, maxCol>20) to cap backtracking in `findAssignment` |
| **3.2** | Cross-storage-area suggestions | NOT STARTED | — | Depends on 3.1 |
| **4.1** | Zone proposal engine | NOT STARTED | — | Depends on 2.3 |
| **4.2** | Zone proposal API & UI | NOT STARTED | — | Depends on 4.1 |
| **4.3** | Per-cellar zone configuration | NOT STARTED | — | Depends on 4.2 |
| **4.4** | Collection-aware zone suggestions | NOT STARTED | — | Depends on 4.3 |

### Dependency Graph

```
Section A (Core Grouping)          Section B (Infrastructure)
  1.1 Layout Provider ──────────────► 1.5 Zone Move Fixes
    │                                  1.6 Cache Update (independent)
    ▼
  1.2 Grouping Algorithm (parallel)
    │
    ▼
  1.3 Test Suite
    │
    ▼
  1.4 Wire into Pipeline ──────────► Section C: 1.7 Frontend UI
    │
    ▼
Section D (Hardcoding Removal)
  2.1 Zone Planner ─┐
  2.2 Bottles/Fridge ┤
                     ▼
  2.3 Frontend Grid ─────────────────► Section E: 3.1, 3.2 Multi-Area
                     │
                     └───────────────► Section F: 4.1 → 4.2 → 4.3 → 4.4
```

---

## Context

The wine cellar app is being prepared for commercial deployment. Two blocking problems:

1. **Grouping algorithm**: The greedy forward-simulation in `cellarSuggestions.js` produces circular swaps and fragmentation. Step 1 (contiguous-pair penalty heuristic) is deployed as a stopgap — a proper target-first algorithm is needed.

2. **Hardcoded layout assumptions**: 60+ locations hardcode `TOTAL_ROWS=19`, `R1=7 cols`, `others=9 cols`, `fridge=F1-F9`. This prevents deployment to cellars with different configurations. The `storage_areas` + `storage_area_rows` tables already support variable layouts, but most service code ignores them.

An expert review identified valid issues with the original plan — this revision addresses all of them.

### Key Expert Feedback Incorporated

- **Step model**: Output is `steps[]` (atomic batches), not flat `moves[]` — compatible with existing `execute-moves` 2-phase transaction pattern in `cellarReconfiguration.js`
- **Swaps are valid**: A→B + B→A within a single step is a legitimate atomic swap — the invariant is no *cross-step* circular dependencies
- **`allocatedTargets` already exists** in `cellarSuggestions.js` L251 — confirmed, no duplicate work
- **Splice removal already safe** (descending sort at L548-550) — confirmed
- **Cache gap**: Storage area layout not in cache fingerprint — addressed in Phase 1.6
- **`'Make room'` string coupling**: Frontend uses string prefix matching to detect swap partners — replaced with structured metadata
- **No `getStorageAreaRows()` helper exists** — created in Phase 1.1

### Storage Type Classification

The DB already supports `storage_type IN ('wine_fridge', 'kitchen_fridge', 'cellar', 'rack', 'other')`:
- **cellar**: R#C# slots, variable rows/cols, zone-allocated
- **wine_fridge**: Temperature-controlled (10-14°C), long-term storage
- **kitchen_fridge**: Chilling-only (4-8°C), short-term, different par-level logic
- **rack/other**: Ambient, no zone allocation

---

# SECTION A: Core Grouping Engine

> **Team scope**: Backend algorithm + test suite. No frontend, no DB schema changes.
> **Phases**: 1.1, 1.2, 1.3, 1.4
> **Deliverable**: Reliable bottle grouping with variable cellar layouts, fully tested.

---

## Phase 1.1: Layout Provider Service

> Prerequisite for everything else. Creates the central service that all other phases consume.

### Problem

`getRowCapacity(rowId, storageAreaRows)` exists in `slotUtils.js` but callers must manually fetch `storageAreaRows` from the DB. There is **no `getStorageAreaRows()` helper** — each caller writes its own query. Most callers skip it and hardcode `row === 1 ? 7 : 9`.

### Solution

Create a cellar-scoped row-capacity provider.

**Create**: `src/services/cellar/cellarLayout.js`

```javascript
/**
 * Get storage area rows for a cellar's primary cellar-type storage area.
 * Returns [{row_num, col_count, label}] or [] (triggers legacy fallback in getRowCapacity).
 */
export async function getStorageAreaRows(cellarId) { ... }

/**
 * Get total row count for a cellar (from storage_area_rows or legacy fallback).
 */
export async function getCellarRowCount(cellarId) { ... }

/**
 * Get all slot IDs for a row (respects dynamic col_count).
 */
export function getRowSlotIds(rowId, storageAreaRows) { ... }

/**
 * Get storage areas grouped by type for a cellar.
 */
export async function getStorageAreasByType(cellarId) { ... }
```

### Hardcoding removal (grouping-blocking files only)

| File | Current hardcoding | Fix |
|------|-------------------|-----|
| `cellarSuggestions.js` L741 | `row === 'R1' ? 7 : 9` | `getRowCapacity(rowId, storageAreaRows)` |
| `cellarSuggestions.js` L920 | `anchorRow === 1 ? 7 : 9` | `getRowCapacity(...)` |
| `cellarMetrics.js` L43 | `9 - prev.col` in fragmentation | `getRowCapacity(...)` |
| `cellarMetrics.js` L47 | `rows.length * 9` | dynamic capacity sum |
| `cellarMetrics.js` L501-502 | `row <= 19`, `row === 1 ? 7 : 9` | iterate from storageAreaRows |
| `cellarPlacement.js` L543, L583, L637 | `row === 1 ? 7 : 9` | `getRowCapacity(...)` |
| `bottleScanner.js` L69-70 | `SLOTS_ROW_1=7`, `SLOTS_PER_ROW_DEFAULT=9` | Import from `cellarLayout.js` |

### Files

- **Create**: `src/services/cellar/cellarLayout.js`
- **Modify**: `src/services/cellar/cellarSuggestions.js`, `cellarMetrics.js`, `cellarPlacement.js`, `bottleScanner.js`
- **Modify**: `src/services/cellar/cellarAnalysis.js` (fetch `storageAreaRows` and pass through call chain)

---

## Phase 1.2: Target-First Grouping Algorithm

> Pure function with zero DB dependencies — can be developed and tested in isolation.

### New module: `src/services/cellar/cellarGrouping.js`

**Core idea**: For each row, compute the optimal contiguous arrangement first, then derive the minimal swap/move sequence.

#### `planRowGrouping(board, maxCol)` — pure function

- **Input**: `board` — `Map<col, { wineId, wineName }>`, `maxCol` — integer column count
- **Output**: `{ steps: Step[], cost: number }`
- **Step**: `{ moves: [{from, to, wineId, wineName}], stepNumber: number }`
  - 1 move = simple move to empty slot
  - 2 moves = atomic swap (A→B + B→A)
  - 3+ moves = cycle rotation (executed as atomic batch)

**Algorithm**:
1. **Identify wine groups**: Scan board → `Map<wineId, col[]>` (wines with 2+ bottles only)
2. **For each wine group** (sorted by group size desc, then leftmost position):
   - Generate candidate anchor positions where the group could sit contiguously
   - For each anchor, compute displacement cost = Σ |current_col − target_col|
   - Pick minimum-cost contiguous block that doesn't overlap already-committed groups
3. **Build target permutation**: Map current positions → target positions
4. **Decompose into cycles**: Length 1 = no-op, length 2 = swap, length k = k-move rotation
5. **Order steps**: Moves to empty slots first (no dependencies), then swaps, then longer cycles
6. **Validate post-conditions**:
   - Conservation: same wine IDs before and after
   - Every multi-bottle wine group ends contiguous
   - No unresolved cross-step dependencies

**Key design decisions**:
- Output is `steps[]` (atomic batches), NOT flat `moves[]` — compatible with `execute-moves` 2-phase transaction
- Swaps (A→B + B→A) are **valid and expected** within a single step
- The real invariant: no *cross-step* circular dependency

#### Cross-row grouping

For wines split across rows:
- Find anchor row: (a) most bottles of this wine, (b) most free slots as tiebreaker
- Generate cross-row moves to bring bottles to anchor row
- Run `planRowGrouping` on the consolidated row

### Files
- **Create**: `src/services/cellar/cellarGrouping.js`

---

## Phase 1.3: Grouping Test Suite

> Test the pure function before wiring it into the pipeline.

### Deterministic unit tests: `tests/unit/services/cellar/cellarGrouping.test.js`

Handcrafted boards:
- Already-contiguous → 0 steps
- Single-bottle wines → 0 steps
- Simple 2-bottle gap → 1 move step
- Two wines needing swap → 1 swap step
- Full row reorganization → multiple ordered steps
- Variable column counts (5, 7, 9, 12, 15, 20)
- Empty row → 0 steps
- Row with 1 column → 0 steps

### Property-based tests: `tests/unit/services/cellar/cellarGrouping.property.test.js`

**Random board generator** (inline LCG, no external deps):

```javascript
function mulberry32(seed) { /* 32-bit seeded RNG */ }
function randomBoard(seed, { colCounts, maxWines, maxGroupSize }) { ... }
```

**Structural invariants** (500+ random trials):
1. **Conservation**: Same wine IDs and counts before/after
2. **Contiguity**: Every multi-bottle wine occupies consecutive columns after all steps
3. **Step-order safety**: Executing steps in order, each atomically, never produces a collision
4. **No cross-step circular deps**: Step N's targets are not Step M's sources (M > N)
5. **Bounded cost**: Total moves ≤ 2 × board_size
6. **Idempotency**: Running algorithm on its own output produces 0 steps

**API-executability test**: Verify generated steps pass `hasMoveDependencies()` and match `POST /api/cellar/execute-moves` contract (2-phase transaction in `cellarReconfiguration.js`).

### Files
- **Create**: `tests/unit/services/cellar/cellarGrouping.test.js`
- **Create**: `tests/unit/services/cellar/cellarGrouping.property.test.js`
- **No external deps** (no `seedrandom` — use inline LCG)

---

## Phase 1.4: Wire Grouping into Analysis Pipeline

> Connect the new algorithm to the existing analysis and suggestion system.

### Backend wiring

Replace the body of `generateSameWineGroupingMoves` in `cellarSuggestions.js`:
- Call `planRowGrouping(board, getRowCapacity(rowId, storageAreaRows))`
- Convert output to existing move format with `reason` strings for backward compat
- Swap pairs within a step get `reason: 'Swap: grouping ${wineName} in ${rowId}'`

Add `groupingSteps` field to analysis report alongside `sameRowGroupingMoves` (backward compat: keep flat list for existing consumers).

### Update regression tests: `tests/unit/services/cellar/cellarSuggestions.test.js`

- Keep the 2 regression tests (circular prevention, fragmentation prevention)
- Update assertions for `steps[]` format
- Add integration test: full `generateSameWineGroupingMoves` with mock `storageAreaRows`

### Files
- **Modify**: `src/services/cellar/cellarSuggestions.js`
- **Modify**: `src/services/cellar/cellarAnalysis.js`
- **Modify**: `tests/unit/services/cellar/cellarSuggestions.test.js`

---

# SECTION B: Analysis Infrastructure

> **Team scope**: Backend fixes to zone moves and caching. Independent of Section A's algorithm work.
> **Phases**: 1.5, 1.6
> **Deliverable**: Zone move hardcoding fixed, cache correctly invalidates on layout changes.

---

## Phase 1.5: Zone Move Fixes + Structured Swap Metadata

### What's already done (expert confirmed)
- `allocatedTargets` Set exists and is used (L251+) — no work needed
- Splice removal is reverse-index safe (L548-550, descending sort) — no work needed

### What remains
- **Fix hardcoded `maxCol`** in `generateMoveSuggestions` — use `getRowCapacity(rowId, storageAreaRows)`
- **Replace `'Make room'` reason strings** with structured swap metadata so the UI can use the new step format consistently across both grouping and zone moves

### Files
- **Modify**: `src/services/cellar/cellarSuggestions.js`

---

## Phase 1.6: Cache Fingerprint Update

### Problem
Cache hash includes wine metadata and zone allocations but NOT storage area row definitions. If a user changes their layout, stale analysis is served.

### Solution
Include `storage_area_rows` layout in the cache hash:

```javascript
// Add to generateSlotHash() in cacheService.js:
const layoutRows = await db.prepare(`
  SELECT sar.row_num, sar.col_count
  FROM storage_area_rows sar
  JOIN storage_areas sa ON sa.id = sar.storage_area_id
  WHERE sa.cellar_id = ? ORDER BY sar.row_num
`).all(cellarId);
const layoutData = layoutRows.map(r => `${r.row_num}:${r.col_count}`).join('|');
// Hash: `v${VERSION}|slots:...|alloc:...|layout:${layoutData}`
```

Bump `ANALYSIS_LOGIC_VERSION` from 7 → 8.

### Files
- **Modify**: `src/services/shared/cacheService.js`

---

# SECTION C: Grouping UI

> **Team scope**: Frontend only. Depends on Section A backend being complete.
> **Phases**: 1.7
> **Deliverable**: Numbered step cards with progress tracking, no full-page reload between steps.

---

## Phase 1.7: Frontend Step UI + Progress Tracking

### Problems being solved
1. `'Make room'` string prefix used to detect swap partners (fragile coupling)
2. Full analysis re-fetch after each move execution (kills progress state)

### Frontend changes in `public/js/cellarAnalysis/moves.js`

- Render steps as numbered cards; each card shows its atomic move batch
- Step indicator badge with sequential numbers
- **Progress state**: Track completed steps in local state (not server-side). After executing a step, mark it done locally and advance to next — do NOT re-fetch full analysis
- Only re-fetch after ALL steps are done (or on explicit refresh)
- Remove `'Make room'` string matching — use structured `steps[].moves[]` format directly
- "Execute All" button runs steps sequentially with visual progress

### CSS in `public/css/components.css`

- `.move-step-badge` — numbered circle
- `.move-step--completed` / `.move-step--next` — visual progress
- `.move-progress-bar` — X of N indicator

### Files
- **Modify**: `public/js/cellarAnalysis/moves.js`
- **Modify**: `public/css/components.css`
- **Modify**: `public/sw.js` — bump `CACHE_VERSION` if new frontend files added

---

# SECTION D: Full Hardcoding Removal

> **Team scope**: Backend + frontend refactor. Consumes the layout provider from Phase 1.1.
> **Phases**: 2.1, 2.2, 2.3
> **Deliverable**: All hardcoded row/col/fridge constants replaced with dynamic values. New layout API endpoint.

---

## Phase 2.1: Backend — Zone Planner & Solver

These files have local constants duplicating layout assumptions. Replace with dynamic values from `cellarLayout.js`.

| File | Lines | Current | Fix |
|------|-------|---------|-----|
| `zoneReconfigurationPlanner.js` L31 | `TOTAL_CELLAR_ROWS = 19` | `await getCellarRowCount(cellarId)` |
| `zoneReconfigurationPlanner.js` L32 | `SLOTS_PER_ROW = 9` | Remove — use `getRowCapacity()` per row |
| `zoneReconfigurationPlanner.js` L340, L1209 | `row1Slots: 7` | `getRowCapacity('R1', storageAreaRows)` |
| `rowAllocationSolver.js` L25 | `TOTAL_ROWS = 19` | Accept as parameter |
| `rowAllocationSolver.js` L26 | `SLOTS_PER_ROW = 9` | Accept `storageAreaRows`, use `getRowCapacity()` |
| `cellarLayoutSettings.js` L21 | `TOTAL_ROWS = 19` | `computeDynamicRowSplit()` already accepts `totalRows` param — update callers |
| `cellarLayoutSettings.js` L94 | `const total = TOTAL_ROWS` | Use passed `totalRows` parameter |

**Key challenge**: `rowAllocationSolver.js` uses `TOTAL_ROWS` and `SLOTS_PER_ROW` to build constraint matrices. Capacity becomes an array `[7, 9, 9, ...]` instead of a scalar.

**Approach**: Add `rowCapacities: number[]` parameter to solver entry point. Replace `SLOTS_PER_ROW * rowCount` with `rowCapacities.slice(0, rowCount).reduce((a, b) => a + b, 0)`.

### Files
- **Modify**: `src/services/zone/zoneReconfigurationPlanner.js`
- **Modify**: `src/services/zone/rowAllocationSolver.js`
- **Modify**: `src/services/shared/cellarLayoutSettings.js`
- **Modify**: `src/services/zone/zoneLayoutProposal.js`

### Tests
- Update `tests/unit/services/zone/` tests to use variable row configs
- Property test: solver produces valid allocations for random cellar sizes (3-30 rows, 4-15 cols)

---

## Phase 2.2: Backend — Bottles Route & Fridge

| File | Lines | Current | Fix |
|------|-------|---------|-----|
| `bottles.js` L21-24 | `GRID_CONSTANTS = { FRIDGE_MAX_SLOT: 9, ... }` | Fetch from `cellarLayout.js` per request |
| `bottles.js` L99 | `row === 1 ? ROW1_COLS : OTHER_COLS` | `getRowCapacity(...)` |
| `bottles.js` L103 | `row > CELLAR_MAX_ROW` | `row > totalRowCount` |
| `fridgeStocking.js` L486 | fallback `['F1'...'F9']` | Query `storage_area_rows` for fridge-type areas |
| `bottleScanner.js` L69-70 | `SLOTS_PER_ROW_DEFAULT=9`, `SLOTS_ROW_1=7` | Use `getRowCapacity()` |

**bottles.js refactor**: `GRID_CONSTANTS` becomes an async factory:

```javascript
async function getGridLimits(cellarId) {
  const storageAreaRows = await getStorageAreaRows(cellarId);
  const totalRows = storageAreaRows.length || 19; // legacy fallback
  return {
    cellarMaxRow: totalRows,
    getColCount: (row) => getRowCapacity(`R${row}`, storageAreaRows),
    fridgeSlots: await getFridgeSlotCount(cellarId)
  };
}
```

### Files
- **Modify**: `src/routes/bottles.js`
- **Modify**: `src/services/cellar/fridgeStocking.js`
- **Modify**: `src/services/cellar/bottleScanner.js`

### Tests
- Update `tests/unit/services/cellar/cellarPlacement.test.js` for non-standard layouts
- Add bottles route test with variable grid dimensions

---

## Phase 2.3: Frontend — Grid, Fridge & Layout API

### New API endpoint: `GET /api/cellar/layout`

```json
{
  "storageAreas": [
    {
      "id": "uuid",
      "name": "Main Cellar",
      "storageType": "cellar",
      "rows": [
        { "rowNum": 1, "colCount": 7, "label": null },
        { "rowNum": 2, "colCount": 9, "label": null }
      ]
    },
    {
      "id": "uuid",
      "name": "Wine Fridge",
      "storageType": "wine_fridge",
      "rows": [
        { "rowNum": 1, "colCount": 4, "label": "Top shelf" },
        { "rowNum": 2, "colCount": 5, "label": "Bottom shelf" }
      ]
    }
  ],
  "totalCellarSlots": 169,
  "totalFridgeSlots": 9
}
```

### Frontend hardcoding removal

| File | Lines | Current | Fix |
|------|-------|---------|-----|
| `public/js/grid.js` L51, L74, L86, L90 | Fridge rows extraction, layout assumptions | Fetch layout from `/api/cellar/layout` |
| `public/js/cellarAnalysis/fridge.js` L266, L546 | `['F1','F2',...,'F9']` | Use dynamic fridge slots from analysis report |
| `public/js/cellarAnalysis/moves.js` L867-872 | `{ whiteRows, redRows }` layout | Already fetched from API — verify dynamic |

The frontend grid renderer reads the layout API response and builds the grid dynamically.

### Files
- **Create**: `GET /api/cellar/layout` endpoint (in `src/routes/cellar.js` or `src/routes/cellarLayout.js`)
- **Modify**: `public/js/grid.js`
- **Modify**: `public/js/cellarAnalysis/fridge.js`
- **Modify**: `public/js/cellarAnalysis/moves.js`
- **Modify**: `public/sw.js` — bump `CACHE_VERSION`

### Tests
- Add layout endpoint integration test
- Frontend: manual test with wine fridge template (2×6) vs cellar_large (19 rows)

---

# SECTION E: Multi-Storage-Area Grouping

> **Team scope**: Backend service + frontend rendering. Extends grouping across storage boundaries.
> **Phases**: 3.1, 3.2
> **Deliverable**: Per-area grouping + cross-area move suggestions (cellar↔fridge).

---

## Phase 3.1: Storage-Area-Scoped Grouping

### Problem
Grouping currently only operates within cellar R# rows. A user with a wine fridge and cellar needs independent grouping per area.

### Solution
Extend `generateSameWineGroupingMoves` and `generateCrossRowGroupingMoves` to accept a `storageAreaId` filter:

```javascript
const cellarMoves = planStorageAreaGrouping(slotToWine, mainCellarRows);
const fridgeMoves = planStorageAreaGrouping(slotToWine, wineFridgeRows);
```

Analysis report includes grouping per storage area:
```json
{
  "groupingByArea": {
    "main-cellar-uuid": { "steps": [...], "areaName": "Main Cellar" },
    "wine-fridge-uuid": { "steps": [...], "areaName": "Wine Fridge" }
  }
}
```

### Files
- **Modify**: `src/services/cellar/cellarGrouping.js` (add `planStorageAreaGrouping` wrapper)
- **Modify**: `src/services/cellar/cellarAnalysis.js` (iterate storage areas, per-area reports)
- **Modify**: `public/js/cellarAnalysis/moves.js` (render per-area grouping sections)

### Tests
- Multi-area grouping unit tests with mock 2-area cellar
- Integration test: analysis report with 2 storage areas

---

## Phase 3.2: Cross-Storage-Area Suggestions

Higher-level analysis that considers temperature zones and drinking windows:
- Wine within 6 months of optimal drinking → suggest move to fridge
- Wine fridge full, low-priority wines → suggest move back to cellar
- Kitchen fridge wines held >48 hours → warn about extended chilling

Builds on existing `fridgeStocking.js` logic (`analyseFridge`, `getFridgeCandidates`) but generalizes to any storage type combination.

### Files
- **Modify**: `src/services/cellar/fridgeStocking.js` (generalize to multi-area awareness)
- **Modify**: `src/services/cellar/cellarAnalysis.js` (cross-area section in report)
- **Modify**: `public/js/cellarAnalysis/moves.js` (render cross-area suggestions)

### Tests
- Cross-area suggestion unit tests with cellar + fridge mock data
- Property test: suggestions never propose moves to full storage areas

---

# SECTION F: Zone Auto-Discovery & Per-Cellar Configuration

> **Team scope**: Backend engine + DB migration + frontend modal. Major feature.
> **Phases**: 4.1, 4.2, 4.3, 4.4
> **Deliverable**: System proposes optimal zone sets based on collection, users customize per cellar.

---

## Phase 4.1: Zone Proposal Engine

### Problem
31 hardcoded zone definitions in `src/config/cellarZones.js`. A 20-bottle cellar doesn't need 31 zones. A 500-bottle collector may need more granular zones.

### Architecture

```
User's wine collection
  ↓
[1] findBestZone() per wine  (cellarPlacement.js — already exists)
  ↓
[2] Aggregate: bottles per zone, confidence distribution
  ↓
[3] Zone filtering: drop zones with <threshold bottles
  ↓
[4] Zone merging: combine small zones into parent/buffer zones
  ↓
[5] Layout proposal: proposeZoneLayout() (zoneLayoutProposal.js — already exists)
  ↓
[6] User confirmation UI
  ↓
[7] Apply: saveZoneLayout() → zone_allocations table
```

### New module: `src/services/zone/zoneAutoDiscovery.js`

```javascript
/**
 * Analyse a cellar's collection and propose an optimal set of zones.
 * @param {string} cellarId
 * @param {Object} options
 * @param {number} [options.minBottlesPerZone=5] - Threshold for zone creation
 * @param {number} [options.maxZones] - Cap on zone count (defaults to totalRows)
 * @returns {Promise<ZoneProposal>}
 */
export async function proposeZones(cellarId, options = {}) { ... }
```

**Algorithm**:
1. **Classify all wines** using existing `findBestZone()` (31-zone vocabulary)
2. **Count bottles per zone** — build `Map<zoneId, { count, wines[], avgConfidence }>`
3. **Filter**: Zones below `minBottlesPerZone` → mark as "merge candidates"
4. **Merge strategy**:
   - Group merge candidates by colour family (white/red)
   - Check if parent buffer zone exists → merge into it
   - If no buffer, merge small zones with closest sibling (by grape/region affinity)
   - Never merge across colour families
5. **Propose active zones**: Only zones with bottles above threshold
6. **Allocate rows** using existing `proposeZoneLayout()` machinery
7. **Return proposal**:
   - Active zones with bottle counts and assigned rows
   - Merged zones (showing what was combined)
   - Unassigned rows (spare capacity)
   - Confidence summary (% of wines at high/medium/low confidence)

### Files
- **Create**: `src/services/zone/zoneAutoDiscovery.js`

### Tests
- `tests/unit/services/zone/zoneAutoDiscovery.test.js` — various collection sizes
- Property test: proposals never exceed available rows, never merge across colours

---

## Phase 4.2: Zone Proposal API & UI

**API endpoints**:
- `POST /api/cellar/zones/propose` → returns `ZoneProposal`
- `POST /api/cellar/zones/apply` → persists chosen proposal, triggers consolidation moves

**UI modal** (`public/js/cellarAnalysis/zoneProposal.js`):
- Proposed zone list with bottle counts
- Visual row allocation preview
- Merged zones with explanation
- "Apply" / "Customize" / "Cancel" actions
- Customization allows user to split/merge/rename zones before applying

### Files
- **Create**: `public/js/cellarAnalysis/zoneProposal.js`
- **Modify**: `src/routes/cellarAnalysis.js` (add proposal endpoints)
- **Modify**: `public/sw.js` (add new JS to `STATIC_ASSETS`, bump `CACHE_VERSION`)

---

## Phase 4.3: Per-Cellar Zone Configuration

Currently `cellarZones.js` exports a global array. For per-cellar customization:

**New table**: `cellar_zone_config`
```sql
CREATE TABLE cellar_zone_config (
  cellar_id UUID REFERENCES cellars(id),
  zone_id TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  display_name TEXT,         -- user override
  custom_rules JSONB,        -- optional rule overrides
  sort_order INTEGER,
  PRIMARY KEY (cellar_id, zone_id)
);
```

When `cellar_zone_config` rows exist → filter/customize the global zone list. When absent → fall back to full 31-zone set.

### Files
- **Create**: `data/migrations/065_cellar_zone_config.sql`
- **Modify**: `src/config/cellarZones.js` (add `getZonesForCellar(cellarId)`)
- **Modify**: `src/services/cellar/cellarPlacement.js` (use cellar-scoped zones)
- **Modify**: `src/services/zone/zoneLayoutProposal.js` (accept filtered zone list)

### Tests
- Integration test: propose → apply → verify zone_allocations updated

---

## Phase 4.4: Collection-Aware Zone Suggestions

When a user adds wines that don't fit current zones:
- Track classification confidence over time
- When >10 wines land in buffer/fallback with high confidence for a specific zone → suggest enabling that zone
- When a zone drops below threshold → suggest merging into buffer
- Surface as notifications in the analysis report

### Files
- **Modify**: `src/services/cellar/cellarAnalysis.js` (zone suggestion logic)
- **Modify**: `public/js/cellarAnalysis/analysis.js` (render zone suggestion notifications)

### Tests
- Unit test: suggestion triggers at correct thresholds
- Unit test: no suggestions when all zones are healthy

---

# Verification (applies to all sections)

### Automated
- `npm run test:unit` — all existing + new tests pass after each phase
- Property tests: 500+ random trials verifying structural invariants
- API-executability tests: generated steps match `execute-moves` contract
- Regression tests updated for new output formats

### Manual
1. Local dev server → cellar analysis → verify numbered step cards
2. Execute steps in order → bottles end contiguous
3. Test with mixed wine groups in a single row
4. Test fridge rows (small column counts)
5. Verify cache invalidates on layout change
6. Test with non-standard cellar template (e.g., `wine_fridge_small`: 2×6)

---

# Full Hardcoding Audit Reference

Complete list of all 60+ hardcoded layout locations found in the codebase:

### Row count: `TOTAL_ROWS = 19`
| File | Line | Context |
|------|------|---------|
| `cellarLayoutSettings.js` | 21 | `export const TOTAL_ROWS = 19` |
| `zoneReconfigurationPlanner.js` | 31 | `const TOTAL_CELLAR_ROWS = 19` |
| `rowAllocationSolver.js` | 25 | `const TOTAL_ROWS = 19` |
| `bottles.js` | 22 | `CELLAR_MAX_ROW: 19` |
| `cellarMetrics.js` | 501 | `row <= 19` |

### Column counts: `R1=7, others=9`
| File | Line | Pattern |
|------|------|---------|
| `bottleScanner.js` | 69-70 | `SLOTS_PER_ROW_DEFAULT=9`, `SLOTS_ROW_1=7` |
| `cellarSuggestions.js` | 741 | `rowId === 'R1' ? 7 : 9` |
| `cellarSuggestions.js` | 920 | `anchorRow === 1 ? 7 : 9` |
| `cellarMetrics.js` | 43 | `9 - prev.col` |
| `cellarMetrics.js` | 47 | `rows.length * 9` |
| `cellarMetrics.js` | 502 | `row === 1 ? 7 : 9` |
| `cellarPlacement.js` | 543, 583, 637 | `row === 1 ? 7 : 9` |
| `bottles.js` | 23-24, 99 | `CELLAR_ROW1_COLS: 7`, `CELLAR_OTHER_COLS: 9` |
| `zoneReconfigurationPlanner.js` | 32, 340, 1209 | `SLOTS_PER_ROW=9`, `row1Slots: 7` |
| `rowAllocationSolver.js` | 26 | `SLOTS_PER_ROW = 9` |
| `zoneLayoutProposal.js` | 17 | `rowNum === 1 ? 7 : 9` |

### Fridge slots: `F1-F9`
| File | Line | Context |
|------|------|---------|
| `cellarZones.js` | 9 | `['F1','F2',...,'F9']` |
| `bottles.js` | 21 | `FRIDGE_MAX_SLOT: 9` |
| `fridge.js` (frontend) | 266, 546 | Hardcoded `['F1'...'F9']` |
| `fridgeStocking.js` | 486 | Fallback `['F1'...'F9']` |
| `fridgeParLevels.js` | 110 | `FRIDGE_CAPACITY = 9` |

### Capacity calculations
| File | Line | Calculation |
|------|------|-------------|
| `zoneReconfigurationPlanner.js` | — | `(19-1) * 9 + 7 = 169` |
| `cellarMetrics.js` | 47 | `rows.length * 9` |
