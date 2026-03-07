# Scoping Document: Multi-Storage-Area Architecture

- **Date**: 2026-03-06
- **Status**: Scoping (pre-plan)
- **Author**: Claude + User
- **Type**: Architectural assessment & phased roadmap

---

## 1. Problem Statement

The system's DB schema supports multiple storage areas per cellar (e.g., two wine cellars, a wine fridge, and a kitchen fridge). However, virtually every layer of the application — backend services, zone management, analysis, and frontend rendering — assumes **one cellar area and one fridge area**. If we ship this commercially, each user will have a unique storage configuration.

**Goal**: Enable users to have N storage areas of any type, with each cellar-type area having its own independent zone layout, and the frontend able to display and manage all of them.

---

## 2. Current State: What the DB Already Supports

### Schema (migration 038)

```
storage_areas
  id UUID PK
  cellar_id UUID FK → cellars       -- tenant isolation
  name TEXT                          -- "Garage Cellar", "Kitchen Fridge"
  storage_type TEXT                  -- 'cellar', 'wine_fridge', 'kitchen_fridge', 'rack', 'other'
  temp_zone TEXT                     -- 'cellar', 'cool', 'cold', 'ambient'
  display_order INT
  notes TEXT

storage_area_rows
  id UUID PK
  storage_area_id UUID FK → storage_areas
  row_num INT
  col_count INT
  label TEXT
  UNIQUE(storage_area_id, row_num)   -- Row numbers are unique WITHIN an area

slots
  id UUID PK
  cellar_id UUID FK
  location_code TEXT                 -- 'R5C3', 'F2' — NO area prefix
  wine_id INT FK → wines
  storage_area_id UUID FK → storage_areas  -- Added in migration 038
  chilled_since TIMESTAMPTZ

zone_allocations
  zone_id TEXT PK
  cellar_id UUID FK
  assigned_rows TEXT                 -- JSON: ["R5", "R6"] — NO area prefix
  wine_count INT
```

### Key Observation: The Row ID Collision Problem

`storage_area_rows` guarantees uniqueness per area: `UNIQUE(storage_area_id, row_num)`. So "Garage Cellar" can have R1-R10 and "Dining Room Cellar" can also have R1-R10.

But `slots.location_code` uses flat `R5C3` format with **no area namespace**. And `zone_allocations.assigned_rows` stores `["R5", "R6"]` — also no area.

**Critical constraint**: `slots` has `UNIQUE(cellar_id, location_code)`. This means today, a cellar CANNOT have two areas both containing `R5C3` — the unique constraint prevents it. This is both a safety net and a blocker for true multi-cellar.

This means:
- Two cellar areas with overlapping row numbers **cannot coexist** under the current unique constraint
- Zone allocations can't distinguish which area's R5 they mean
- Moving a bottle "from R5C3 to R8C1" works only because location codes are globally unique per cellar
- The `slots.storage_area_id` FK was added in migration 038 — each slot knows which area it belongs to
- But `zone_allocations` and application code don't use area context

**Implication**: To support multiple cellar areas, we must either:
- (a) Relax the unique constraint to `UNIQUE(cellar_id, storage_area_id, location_code)` and add area-scoped queries everywhere, OR
- (b) Use area-prefixed location codes like `A1:R5C3`

Both require a DB migration. Option (a) is lower-risk — see Section 4.

---

## 3. Full Audit: Single-Area Assumptions

### 3.1 Backend — Location Code Prefix Assumptions (24 occurrences)

Every file that checks `startsWith('R')` or `startsWith('F')` to determine if a slot is cellar vs fridge is making a single-area assumption. With multiple cellars, there's no way to tell which cellar R5C3 belongs to from the location code alone.

| File | Line(s) | Pattern | Impact |
|------|---------|---------|--------|
| `src/routes/cellarAnalysis.js` | 50, 54, 138, 142, 206, 210, 230 | `startsWith('F')` / `startsWith('R')` | Splits wines into cellar vs fridge — breaks with 2 cellars |
| `src/services/cellar/cellarAnalysis.js` | 88, 100, 403, 661 | `startsWith('R')` | Analysis only considers R-prefixed slots as "cellar" |
| `src/services/cellar/cellarMetrics.js` | 66, 267 | `startsWith('R')` | Zone metrics skip non-R slots |
| `src/services/cellar/bottleScanner.js` | 105 | `startsWith('R')` | Placement scanning |
| `src/services/cellar/fridgeStocking.js` | 226, 636, 666 | `startsWith('F')` / `startsWith('R')` | Fridge/cellar wine partitioning |
| `src/services/cellar/slotUtils.js` | 22 | `startsWith('F')` | Slot parsing |
| `src/routes/bottles.js` | 100, 151 | `startsWith('F')` / `startsWith('R')` | Bottle placement |
| `src/routes/cellarZoneLayout.js` | 240 | `startsWith('R')` | Zone layout |
| `src/services/pairing/pairingEngine.js` | 215 | `startsWith('F')` | Fridge temp boost |
| `src/services/wine/drinkingStrategy.js` | 60 | `startsWith('F')` | Drinking window |
| `src/services/acquisitionWorkflow.js` | 445 | `startsWith('F')` | Acquisition placement |

### 3.2 Backend — Single Area Queries

| File | Function | Issue |
|------|----------|-------|
| `src/services/cellar/cellarLayout.js:28` | `getStorageAreaRows()` | Filters `storage_type = 'cellar'` — returns rows from ALL cellar areas merged |
| `src/services/cellar/cellarLayout.js:82` | `getCellarRows()` uses `.find()` | Takes first cellar area |
| `src/routes/cellar.js:82` | `getFridgeStorageType()` | `LIMIT 1` — only detects first fridge area |
| `src/routes/cellar.js:65` | `getEmptyFridgeSlots()` | Queries all `F`-prefixed slots — no area filter |
| `src/routes/cellarZoneLayout.js` | Zone layout API | Builds one flat zone map for all R-rows |
| `src/services/cellar/cellarAllocation.js:73-77` | Zone allocation query | Loads all `zone_allocations` by cellar_id — no area scoping on `assigned_rows` |
| `src/services/cellar/cellarAllocation.js:285-302` | Orphan row repair | Uses `getCellarRowCount()` (first area only) — treats rows from other areas as orphans |
| `src/routes/bottles.js:29` | Bottle placement | `getStorageAreaRows()` returns first cellar area only — `cellarMaxRow` wrong for 2nd cellar |
| `src/routes/bottles.js:147-150` | Same-wine lookup | `WHERE cellar_id = ? AND wine_id = ?` — no area filter, returns bottles from ALL areas |
| `src/services/cellar/fridgeStocking.js:488` | Fridge analysis | `areasByType.wine_fridge || []` — only processes wine_fridge, never kitchen_fridge |
| `src/routes/cellarZoneLayout.js:291` | Fridge slot fallback | `totalFridgeSlots = 9` hardcoded when no area found |

### 3.3 Backend — Zone System (Critical)

| Component | Issue |
|-----------|-------|
| `zone_allocations.assigned_rows` | Stores `["R5", "R6"]` — no storage_area_id. If two cellars both have R5, zone system can't distinguish them |
| `rowAllocationSolver.js` | Operates on a flat row list. Assumes contiguous physical layout (whites-top, reds-bottom). Two separate cellars break contiguity |
| `zoneReconfigurationPlanner.js` | Plans row moves between zones assuming one physical cellar |
| `zoneAutoDiscovery.js` | Discovers zones by scanning all R-slots — merges both cellars |
| `zoneCapacityAdvisor.js` | Analyses zone capacity against total row count |
| `cellarZones.js` config | Zone definitions are global, not per-area |

### 3.4 Frontend — Single Area Assumptions

| File | Issue |
|------|-------|
| `public/js/grid.js:46` | `getElementById('fridge-grid')` — assumes single fridge grid element |
| `public/js/grid.js:83` | `getFridgeRows()` — `.find()` takes first `wine_fridge` area |
| `public/js/grid.js:100` | `getElementById('cellar-grid')` — assumes single cellar grid element |
| `public/js/grid.js:281` | `getCellarRows()` — `.find()` takes first `cellar` area |
| `public/js/grid.js:297` | `renderStorageAreas()` — loops all areas (correctly!) but renders in flat container |
| `public/js/grid.js:106,303` | `zoneMapCache = await getZoneMap()` — global zone map, no area scoping |
| `public/js/grid.js:388` | `zoneMapCache[rowId]` — keyed by row ID without area context |
| `public/js/grid.js:639,785` | `getElementById('cellar-grid')` in zoom controls — single grid |
| `public/index.html:358` | Single `#analysis-fridge` container |
| `public/js/cellarAnalysis/fridge.js:29` | Hardcoded 7 category columns |
| `public/js/cellarAnalysis/fridge.js:205-266` | All action handlers assume single `fridgeStatus` |
| `public/js/cellarAnalysis/analysis.js:278` | Calls `renderFridgeStatus(analysis.fridgeStatus)` — single object |
| `public/js/cellarAnalysis/issueDigest.js:210-211` | Issue digest assumes single `analysis.fridgeStatus` |
| `public/js/dragdrop.js:56-84` | Sets up drag on all `.slot` elements globally — no area isolation |
| `public/js/dragdrop.js:218` | `moveBottle(fromLocation, toLocation)` — no area context passed |
| `public/js/api/wines.js:141-190` | `removeBottle()`, `moveBottle()`, `directSwapBottles()` — location strings only, no `storage_area_id` |
| `public/js/bottles/form.js` | Location code picker doesn't indicate which area |

### 3.5 Frontend — What Already Works

| File | What Works |
|------|-----------|
| `public/js/grid.js:297` | `renderStorageAreas()` already iterates `state.layout.areas` and renders all |
| `public/js/onboarding.js:79` | Storage type picker supports all types |
| `public/js/storageBuilder.js` | Templates include `wine_fridge`, `kitchen_fridge` variants |

---

## 4. Architecture Options for Row Namespacing

This is the core decision. Everything else flows from how we solve the row ID collision.

### Option A: Prefixed Location Codes

Change `location_code` from `R5C3` to `A1:R5C3` (storage area index prefix).

| Pro | Con |
|-----|-----|
| Globally unique — eliminates all ambiguity | **Massive migration** — every slot in DB gets new code |
| Simple string parsing | Breaks all `startsWith('R')` checks |
| URL-friendly for deep linking | Every frontend display needs to strip prefix |
| | Existing cellar exports, bookmarks, user memory of slot codes break |

**Estimated touch points**: ~100+ files. Very high risk.

### Option B: Area-Scoped Queries (Recommended)

Keep `location_code` as `R5C3` but always pair with `storage_area_id` for disambiguation.

```sql
-- DB migration: relax unique constraint
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_cellar_id_location_code_key;
CREATE UNIQUE INDEX idx_slots_area_location
  ON slots(cellar_id, storage_area_id, location_code);

-- Then query:
SELECT * FROM slots WHERE location_code = 'R5C3' AND storage_area_id = ?
```

| Pro | Con |
|-----|-----|
| Minimal data migration — existing codes unchanged | Must pass `storage_area_id` through every code path |
| Backward compatible — single-area cellars work as before | Zone allocations need storage_area_id column |
| Incremental adoption — can migrate one service at a time | More parameters in function signatures |
| Users keep their familiar R5C3 codes | Display must show area name alongside code when ambiguous |
| `slots.storage_area_id` FK already exists | Unique constraint migration needed |

**Estimated touch points**: ~40 files (add `storageAreaId` parameter). Much lower risk.

### Option C: Hybrid — Area-Scoped + Display Prefix

Use Option B internally, but show `[Garage] R5C3` in the UI when multiple cellars exist.

| Pro | Con |
|-----|-----|
| Best of both worlds | Slightly more frontend logic |
| Internal code stays simple | Users see different format based on config |
| No DB migration | |

**Recommendation: Option C** — Area-scoped queries internally, display prefix only when ambiguous.

---

## 5. Zone System: Independent Per-Area Zones

### Current Model

```
cellar_zones (global definitions)  →  zone_allocations (rows per zone, per cellar_id)
                                       assigned_rows: ["R5", "R6"]
```

### Required Model

```
cellar_zones (global definitions)  →  zone_allocations (rows per zone, per cellar_id, per storage_area_id)
                                       storage_area_id: UUID FK
                                       assigned_rows: ["R5", "R6"]  (unique within that area)
```

**Migration**: Add `storage_area_id` to `zone_allocations`. Backfill existing rows to the user's first/only cellar area. Update unique constraint to `(cellar_id, storage_area_id, zone_id)`.

**Zone solver**: Each call to `rowAllocationSolver` operates on one storage area's rows. The solver input changes from "all cellar rows" to "rows for storage area X".

**Zone UI**: Zone map keyed by `{storageAreaId, rowId}` instead of just `rowId`.

---

## 6. Combined View Question

> "Can we run multiple cellar locations into one combined zone layout plan?"

**Short answer: No, and we shouldn't try.** Zones represent physical adjacency — wines in the same zone should be physically nearby for easy retrieval. Two cellars in different rooms/buildings can't share zones meaningfully.

**What we CAN offer**:
1. **Per-area zone layouts** — each cellar gets its own independent zone plan
2. **Cross-area summary dashboard** — "You have 45 reds across 2 cellars, 20 whites in your wine fridge"
3. **Cross-area recommendations** — "Your Garage Cellar is full. Consider moving overflow Pinot Noir to your Dining Room Cellar where there's space"
4. **Unified wine inventory** — all wines still belong to one cellar_id, visible in one list, searchable together

---

## 7. Phased Roadmap

### Phase 0: Dynamic Fridge Stocking (Ready to Ship)
**Scope**: Already planned in `docs/plans/dynamic-fridge-stocking.md` + `dynamic-fridge-stocking-frontend.md`
**What it delivers**: Multiple fridge areas with per-type par-level allocation
**Dependencies**: None — self-contained
**Risk**: Low

### Phase 1: Area-Aware Slot Operations
**Scope**: Thread `storage_area_id` through slot CRUD operations
**What it delivers**: Safe multi-area slot management (no collisions)

**Backend changes**:
- Add `storageAreaId` parameter to move/swap/place operations
- Query slots with `WHERE storage_area_id = ?` alongside `location_code`
- Route handlers accept `storageAreaId` from request (from area context in UI)
- `getEmptyFridgeSlots(cellarId, storageAreaId)` — scoped per area

**Frontend changes**:
- Grid rendering already iterates areas — add `data-area-id` to slot elements
- Drag-drop payloads include `storageAreaId`
- Bottle form shows area selector when multiple cellars exist
- API calls include `storageAreaId` parameter

**Key file changes**:
| File | Change |
|------|--------|
| `src/routes/slots.js` | Accept `storageAreaId` in move/swap endpoints |
| `src/routes/bottles.js` | Accept `storageAreaId` in placement |
| `src/services/cellar/slotUtils.js` | `parseSlot()` returns area context |
| `public/js/dragdrop.js` | Carry `storageAreaId` in drag data |
| `public/js/bottles/form.js` | Area picker in location selection |

**Estimated effort**: Medium (20-30 files)
**Dependencies**: None

### Phase 2: Per-Area Zone Management
**Scope**: Each cellar-type storage area gets independent zone allocation
**What it delivers**: Separate zone layouts per cellar

**DB migration**:
```sql
ALTER TABLE zone_allocations
  ADD COLUMN storage_area_id UUID REFERENCES storage_areas(id);

-- Backfill: assign to first cellar area
UPDATE zone_allocations za
SET storage_area_id = (
  SELECT sa.id FROM storage_areas sa
  WHERE sa.cellar_id = za.cellar_id AND sa.storage_type = 'cellar'
  ORDER BY sa.display_order NULLS LAST, sa.created_at
  LIMIT 1
);

ALTER TABLE zone_allocations ALTER COLUMN storage_area_id SET NOT NULL;

-- New unique constraint
DROP INDEX IF EXISTS idx_zone_allocations_cellar_zone;
CREATE UNIQUE INDEX idx_zone_allocations_area_zone
  ON zone_allocations(storage_area_id, zone_id);
```

**Backend changes**:
| Component | Change |
|-----------|--------|
| `cellarLayout.js` | `getStorageAreaRows(cellarId, storageAreaId)` — scope to one area |
| `zoneAutoDiscovery.js` | Run per area, not globally |
| `rowAllocationSolver.js` | Accept area-scoped row list |
| `zoneReconfigurationPlanner.js` | Plan per area |
| `zoneCapacityAdvisor.js` | Analyse per area |
| `cellarAnalysis.js` | Run zone analysis per cellar area, merge results |
| Zone layout API | Accept `storageAreaId` parameter |

**Frontend changes**:
| Component | Change |
|-----------|--------|
| Zone map API calls | Pass `storageAreaId` |
| Zone overlay on grid | Per-area zone labels (already works in `renderStorageAreas`) |
| Zone reconfiguration modal | Area selector / runs per area |
| Analysis zone narratives | Per-area zone summaries |

**Estimated effort**: Large (30-40 files)
**Dependencies**: Phase 1

### Phase 3: Multi-Area Frontend Polish
**Scope**: UI refinements for multi-area experience
**What it delivers**: Cohesive multi-area management UX

**Features**:
- Area switcher/tabs in analysis workspace (or stacked view)
- Cross-area summary dashboard (total bottles, style distribution across all areas)
- Cross-area recommendations ("move overflow to other cellar")
- Area display prefix `[Garage] R5C3` when multiple cellars exist
- Storage area reordering (drag display_order)

**Estimated effort**: Medium
**Dependencies**: Phase 2

### Phase 4: Cross-Area Intelligence
**Scope**: AI-powered cross-area recommendations
**What it delivers**: Smart suggestions spanning multiple storage areas

**Features**:
- "Your Dining Cellar has unused rows. Consider redistributing Pinot Noir from Garage Cellar"
- Temperature-aware recommendations: "Move this ageing Barolo from wine fridge to cellar for long-term storage"
- Unified buying guide considering all storage capacity
- Cross-area acquisition workflow ("place new bottles in area with most space")

**Estimated effort**: Medium
**Dependencies**: Phase 3

---

## 8. Risk Assessment

### High Risk
| Risk | Mitigation |
|------|-----------|
| `startsWith('R')`/`startsWith('F')` pervasive — refactoring could break everything | Phase 1 adds `storageAreaId` alongside existing logic. Old pattern continues to work for single-area cellars. Deprecate gradually. |
| Zone allocation migration corrupts existing layouts | Backfill migration assigns all existing zone rows to first cellar area. No data loss — just adds FK. |

### Medium Risk
| Risk | Mitigation |
|------|-----------|
| Performance: N separate zone analyses per cellar area | Zone analysis is fast (~50ms). Even 3 areas = 150ms. Cache per area. |
| Frontend complexity explosion with N areas | Start with stacked view (simple). Area tabs as Phase 3 enhancement. |
| Backward compatibility: cached analysis missing `storageAreaId` | Fallback: if no `storageAreaId` on zone allocation, treat as legacy single-area |

### Low Risk
| Risk | Mitigation |
|------|-----------|
| Users confused by per-area zones | Clear area labels + onboarding tooltip |
| API breaking changes | All new parameters are optional — defaults to first/only area |

---

## 9. Key Design Decisions

### Decision 1: Don't combine zone layouts across areas
Physical separation means zones can't span areas. Each area is an independent zone universe. Cross-area intelligence (Phase 4) operates at a higher level — recommending transfers, not shared zones.

### Decision 2: `storage_area_id` threading, not location code refactoring
Adding an area FK to queries is safer and more incremental than rewriting location codes. The R5C3 format stays — disambiguation happens via context, not encoding.

### Decision 3: Backward-compatible defaults everywhere
Every function that gains a `storageAreaId` parameter defaults to the first/only area when not provided. Single-area cellars (the current majority) see zero behavior change.

### Decision 4: Phase 0 (fridge) ships independently
The dynamic fridge stocking plans are self-contained and don't depend on any multi-area infrastructure. Ship them first for immediate user value.

---

## 10. Open Questions (Require User Input)

1. **Area naming**: Should we enforce unique area names per cellar, or allow "Wine Cellar" + "Wine Cellar"?
2. **Cross-area drag-drop**: Should users be able to drag a bottle from Cellar A grid to Cellar B grid? Or use a "Transfer" action?
3. **Default area for new bottles**: When adding a bottle via the form, should it default to the area with most empty space, or always ask?
4. **Zone sharing**: Should zone *definitions* (e.g., "Pinot Noir zone — serve at 16C") be global (shared across areas) or per-area? Global definitions with per-area *allocations* seems cleanest.
5. **Rack/Other areas**: Do rack-type areas get any zone management, or are they unmanaged storage only?

---

## 11. Effort Estimates (Rough)

| Phase | Files Touched | New Files | DB Migration | Estimated Scope |
|-------|---------------|-----------|-------------|----------------|
| Phase 0: Fridge | ~8 | 2 | 0 | Small-Medium |
| Phase 1: Area-Aware Slots | ~25 | 0 | 0 | Medium |
| Phase 2: Per-Area Zones | ~35 | 1-2 | 1 | Large |
| Phase 3: Multi-Area UI | ~15 | 2-3 | 0 | Medium |
| Phase 4: Cross-Area AI | ~10 | 2-3 | 0 | Medium |
| **Total** | **~90** | **~10** | **1** | |

Phases are independently shippable. Each phase delivers value on its own.
