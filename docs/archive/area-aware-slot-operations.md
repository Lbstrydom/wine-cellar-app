# Plan: Area-Aware Slot Operations (Multi-Storage Phase 1)

- **Date**: 2026-03-06
- **Status**: Phase 1 shipped. Phase 2 complete (Fixes A/B/C/D all shipped 2026-03-06).
- **Author**: Claude + User
- **Parent**: [Multi-Storage-Area Architecture](../archive/multi-storage-area-architecture.md) — Phase 1
- **Prerequisites**: Phase 0 (Dynamic Fridge Stocking) — **shipped** in commit `2976afe`

---

## Reviewer Feedback (Incorporated)

### v1 Feedback

The v1 plan proposed relaxing `UNIQUE(cellar_id, location_code)` as the first step. A code review
identified five critical problems with that sequencing:

1. **Zone/analysis maps would collapse**: `cellarAllocation.js`, `cellarAnalysis.js`, `movePlanner.js`,
   and `layoutProposer.js` all key maps by `R#` / `R#C#` without area context. Duplicate location codes
   would silently overwrite entries.
2. **Location-param endpoints are unsafe**: `/:location/drink`, `/remove`, `/open`, `/seal` resolve
   slots by `(cellar_id, location_code)` alone. All frontend callers (`modals.js`, `pairing.js`,
   `wines.js`) send only location codes.
3. **execute-moves path untouched**: Most move execution flows through `/api/cellar/execute-moves` and
   `validateMovePlan` in `cellarReconfiguration.js`/`movePlanner.js`, both keyed solely by location_code.
   This powers move guide, layout diff, fridge moves, and transfers.
4. **Suggestion/layout payloads missing area**: Placement suggestion endpoints don't return
   `storage_area_id`; layout slot payloads in `stats.js` omit it; modal slot lookup uses
   `location_code` equality.
5. **Migration path wrong**: Migration runner reads `data/migrations/`, not `migrations/`; number
   039 is already taken by `039_layer0_knowledge_base.sql`.

**Accepted recommendation**: Convert slot identity end-to-end to `(storage_area_id, location_code)`
across all UI payloads, API contracts, and backend resolution **first**. Only then (Phase 1b) relax
the unique constraint.

### v2 Feedback

The v2 plan correctly split Phases 1a/1b but a second review identified four remaining problems:

1. **HIGH — Phase 1b still unsafe**: The constraint relaxation is scheduled before zone/analysis maps
   (`cellarAllocation.js`, `cellarAnalysis.js`, `layoutProposer.js`) stop keying by cellar-global
   `R#`/`R#C#` codes. Those maps would collapse with duplicate location codes across areas even after
   all slot *operations* are area-aware, because *analysis* remains cellar-global.
2. **HIGH — Cross-area moves need dual area IDs**: The execute-moves contract uses a single
   `storage_area_id` per move, but cross-area moves (already in use via `fridge.js` transfers) have
   different source and target areas. A single ID is insufficient — needs `from_storage_area_id` +
   `to_storage_area_id`.
3. **MEDIUM — Backward-compat fallback becomes ambiguous after 1b**: `resolveAreaFromSlot(cellarId,
   locationCode)` is only safe while `UNIQUE(cellar_id, location_code)` exists. After constraint
   relaxation, the same location code could match multiple slots. The fallback must be hardened or
   removed before constraint change.
4. **MEDIUM — Frontend file references mis-scoped**:
   - The slot-based drink/open/seal operations are correctly in `public/js/modals.js`, but
     `public/js/bottles/modal.js` also has `findSlotData(location)` which does location-only lookup
     and needs updating too.
   - `public/js/pairing.js` does not have slot objects with area metadata — it only has aggregated
     `rec.location` strings from the pairing response. Passing `storage_area_id` requires changing
     the pairing response shape first.

**Accepted recommendations**:
- **Defer Phase 1b entirely** to Phase 2, keeping `UNIQUE(cellar_id, location_code)` until zone/analysis
  maps are area-aware. Phase 1a becomes the complete scope of Phase 1.
- **Use dual area IDs** (`from_storage_area_id` + `to_storage_area_id`) in the execute-moves contract.
- **Harden the fallback**: `resolveAreaFromSlot()` must throw `AppError(409)` if multiple slots match
  the same `(cellar_id, location_code)` — but this is a defence-in-depth measure only, since the
  constraint will remain.
- **Fix frontend file references**: add `bottles/modal.js` to the file plan; add pairing response
  shape change as a prerequisite for `pairing.js`.

---

## 1. Context Summary

### What Exists Today

The DB schema (migration 038) supports multiple storage areas per cellar via `storage_areas`,
`storage_area_rows`, and `slots.storage_area_id`. However, virtually every operation resolves
slots using only `(cellar_id, location_code)` — which works today because `UNIQUE(cellar_id,
location_code)` prevents overlapping row numbers across areas.

**Key observations from codebase exploration:**

| Layer | Current State |
|-------|--------------|
| **DB constraint** | `UNIQUE(cellar_id, location_code)` — blocks overlapping rows across areas |
| **Slot CRUD** (`slots.js`) | All 8 endpoints use `WHERE cellar_id = $1 AND location_code = $2` |
| **Execute-moves** (`cellarReconfiguration.js`) | `validateMovePlan()` + execution use location_code only |
| **Move planner** (`movePlanner.js`) | Move objects keyed by `{from, to}` location codes |
| **Bottle add** (`bottles.js`) | `getGridLimits()` returns first cellar area only |
| **Slot schema** (`schemas/slot.js`) | No `storage_area_id` in any schema |
| **Layout API** (`stats.js`) | Dynamic areas path fetches `storage_area_id` but omits it from response |
| **Placement suggestions** (`cellar.js`) | `suggest-placement` endpoints don't return area ID |
| **Modals** (`modals.js`) | `drinkBottle(location)`, `openBottle(location)`, `sealBottle(location)` — location only |
| **Pairing** (`pairing.js`) | `drinkBottle(location, {pairing_session_id})` — location only |
| **Analysis/zones** (`cellarAnalysis.js`, `cellarAllocation.js`) | Map entries keyed by `R#` / `R#C#` — would collapse with duplicate codes |
| **Frontend grid** (`grid.js`) | Slot elements lack `data-storage-area-id` attribute |
| **Frontend drag-drop** (`dragdrop.js`) | Passes location codes only |
| **Frontend API** (`api/wines.js`, `api/cellar.js`) | `moveBottle()`, `executeCellarMoves()` — location only |
| **Migration runner** (`scripts/run-migrations.js`) | Reads from `data/migrations/`; 039 already taken |

### Patterns Already In Use

1. **Optional area param**: `getEmptyFridgeSlots(cellarId, storageAreaId = null)` — falls back to
   legacy regex when null.
2. **Dynamic grid limits**: `getGridLimits(cellarId)` in `bottles.js` — extensible to accept area ID.
3. **Zod validation**: All slot ops use validated schemas.
4. **Transaction-wrapped mutations**: `slots.js` and `cellarReconfiguration.js` use `db.transaction()`.

---

## 2. Proposed Architecture

### 2.1 Phasing (Revised in v3)

Phase 1 threads area identity end-to-end. The unique constraint stays until Phase 2.

| Phase | Scope | Gate |
|-------|-------|------|
| **Phase 1** — Thread area identity | Add `storage_area_id` to every slot-touching API contract, backend query, frontend payload, and response. **Keep existing `UNIQUE(cellar_id, location_code)` constraint.** | All slot resolution uses `(cellar_id, storage_area_id, location_code)`. Zero callers resolve by location_code alone. |
| **Phase 2** (separate plan) — Analysis-layer area threading + colour zones | Enrich analysis move execution with area IDs (frontend enrichment); area-scope validateMovePlan and execute-moves Phase 0 lock; add per-area colour_zone designation. **Constraint stays permanently** — see §Architectural Decision below. | Phase 1 complete. All six Phase 2 fixes delivered. |
| **Phase 3** (separate plan) — Cross-area UX + type-heuristic cleanup | Enable cross-area drag-drop; add area labels in UI; replace all `startsWith('R'/'F')` / `LIKE 'R%'` heuristics with `storage_type` metadata. | Phase 2 complete. |

**Principle**: Defensive Validation (#12) — never allow duplicate location codes until every consumer
(operations *and* analysis) is provably area-aware. The constraint acts as a safety net.

**Why the constraint is permanent**: See §Architectural Decision: Continuous Row Numbering in the
Phase 2 section. With continuous numbering the constraint never needs relaxing. `resolveAreaFromSlot()`
remains permanently valid — location codes are always globally unique per cellar.

### 2.2 Design Decision: Area-Scoped Queries, Not Prefixed Codes

**Decision**: Thread `storage_area_id` through queries rather than rewriting location codes.
**Principles**: Backward Compatibility (#18), DRY (#1), No Hardcoding (#8).
**Rationale**: Location codes remain `R5C3`; disambiguation via FK, not string encoding.

### 2.3 Design Decision: Storage Area Resolver Helper

**Decision**: Create `resolveStorageAreaId(cellarId, storageAreaId, storageType)` that:
- Returns `storageAreaId` if provided and valid (belongs to this cellar)
- Otherwise returns the first area of `storageType` for the cellar
- Throws `AppError(404)` if no area exists

**Principles**: DRY (#1), Single Source of Truth (#10), Defensive Validation (#12).

### 2.4 Component Interaction (Phase 1)

```
Request (with storage_area_id — required for body-based, resolved from slot for param-based)
  │
  ├─ Zod validation (schemas/slot.js) ← optional storage_area_id in body schemas
  │
  ├─ Route handler (slots.js, bottles.js, cellarReconfiguration.js)
  │     │
  │     ├─ Body-based endpoints: resolveStorageAreaId(cellarId, body.storage_area_id)
  │     │
  │     ├─ Param-based endpoints: look up slot → get storage_area_id from row
  │     │
  │     └─ Move endpoints: resolve from_storage_area_id + to_storage_area_id independently
  │
  ├─ DB queries: WHERE cellar_id = $1 AND storage_area_id = $2 AND location_code = $3
  │
  └─ Response: includes storage_area_id in slot data
```

### 2.5 Data Flow: Move Bottle

```
Frontend: slot elements have data-storage-area-id from layout response
  → dragdrop.js extracts area ID from source AND target slots
  → api/wines.js: moveBottle(from, to, fromAreaId, toAreaId)
  → POST /api/slots/move { from_location, to_location, from_storage_area_id, to_storage_area_id }
  → Zod validates (both optional UUIDs)
  → resolveStorageAreaId() validates each area belongs to cellar
  → SELECT FROM slots WHERE cellar_id=$1 AND storage_area_id=$2 AND location_code=$3 (for each)
  → Transaction: UPDATE slots ...
  → Response: { message: 'Bottle moved' }
```

### 2.6 Data Flow: Drink Bottle (Param-Based)

```
Frontend: modals.js has slot object with storage_area_id from layout
  → api/wines.js: drinkBottle(location, { storage_area_id, ...opts })
  → POST /api/slots/:location/drink { storage_area_id, occasion, ... }
  → Route: resolve area from body OR look up from slot row
  → SELECT FROM slots WHERE cellar_id=$1 AND storage_area_id=$2 AND location_code=$3
  → Transaction: log consumption, clear slot
  → Response: { message: 'Bottle consumed and logged', ... }
```

### 2.7 Data Flow: Execute-Moves (Reconfiguration/Fridge/MoveGuide)

```
Frontend: cellar.js executeCellarMoves(moves)
  → POST /api/cellar/execute-moves { moves: [{ wineId, from, to, from_storage_area_id, to_storage_area_id }] }
  → cellarReconfiguration.js: validateMovePlan resolves each area independently
  → Source slot: WHERE cellar_id=$1 AND storage_area_id=$2 AND location_code=$3
  → Target slot: WHERE cellar_id=$1 AND storage_area_id=$4 AND location_code=$5
  → Transaction: execute validated moves
  → Response: { executed, failed }
```

**Why dual area IDs**: Fridge transfers (`fridge.js:executeTransfer()`) already move wines across
areas (e.g., cellar → wine_fridge). A single `storage_area_id` cannot represent both the source
and target area. Swap operations (`swapFridgeCandidate`) similarly move two wines between different
areas in a single batch.

---

## 3. Sustainability Notes

### Assumptions That Could Change

| Assumption | Likelihood | Mitigation |
|-----------|-----------|------------|
| Location codes stay R#C# / F# | Low | area_id FK handles disambiguation |
| Zone allocations stay cellar-global | High (Phase 2) | Phase 2 adds area to zone_allocations |
| Single cellar area per user | Medium | Phase 1 makes multi-area operations safe; Phase 2 makes analysis safe |
| `UNIQUE(cellar_id, location_code)` stays | Until Phase 2 | Constraint protects against analysis map collapse |

### Extension Points

1. **`resolveStorageAreaId()`** — new storage types require zero resolution changes
2. **Zod schemas** — `storage_area_id` optional now, promotable to required later
3. **Layout API** — `storage_area_id` in slot payloads enables future area-specific UIs

---

## 4. File-Level Plan

### Phase 1a: Thread Area Identity End-to-End

#### 4.1 New — `src/services/cellar/storageAreaResolver.js`

**Purpose**: Single source of truth for resolving and validating storage area IDs.
**Principles**: DRY (#1), Single Responsibility (#2), Defensive Validation (#12).
**Dependencies**: Imports `db`, `AppError`. Imported by routes and services.

```javascript
/**
 * Resolve and validate a storage area ID for a cellar.
 * @param {string} cellarId
 * @param {string|null} storageAreaId - From request body/query
 * @param {string} [storageType='cellar'] - Fallback type when storageAreaId is null
 * @returns {Promise<{id: string, storage_type: string}>} Validated area
 * @throws {AppError} 404 if not found or doesn't belong to cellar
 */
export async function resolveStorageAreaId(cellarId, storageAreaId, storageType = 'cellar') {}

/**
 * Look up the storage_area_id for a slot by (cellar_id, location_code).
 * Used by param-based endpoints where the caller sends location only.
 * @param {string} cellarId
 * @param {string} locationCode
 * @returns {Promise<string>} storage_area_id
 * @throws {AppError} 404 if slot not found
 * @throws {AppError} 409 if multiple slots match (defence-in-depth — should not
 *   happen while UNIQUE(cellar_id, location_code) constraint exists, but prevents
 *   silent wrong-slot resolution if constraint is ever relaxed)
 */
export async function resolveAreaFromSlot(cellarId, locationCode) {}
```

#### 4.2 Modified — `src/schemas/slot.js`

**Changes**:
- Add `storageAreaIdSchema = z.string().uuid().optional().nullable()`
- Add `from_storage_area_id` + `to_storage_area_id` to `moveBottleSchema`, `swapBottleSchema`, `directSwapSchema`
- Add `storage_area_id` to `addToSlotSchema`, `drinkBottleSchema`
- Location param schema unchanged

#### 4.3 Modified — `src/routes/slots.js` — ALL 8 endpoints

Every endpoint gets area-scoped queries. The distinction is how area is resolved:

| Endpoint | Area Source | Query Change |
|----------|-----------|-------------|
| `POST /move` | `req.body.from_storage_area_id` + `req.body.to_storage_area_id` → `resolveStorageAreaId()` each | `AND storage_area_id = $X` on source and target lookups independently |
| `POST /swap` | `req.body.from_storage_area_id` + `req.body.to_storage_area_id` → `resolveStorageAreaId()` each | `AND storage_area_id = $X` on all slot lookups (source area for slot A, target area for slot B) |
| `POST /direct-swap` | `req.body.from_storage_area_id` + `req.body.to_storage_area_id` → `resolveStorageAreaId()` each | `AND storage_area_id = $X` on each lookup independently |
| `POST /:location/drink` | `req.body.storage_area_id` OR `resolveAreaFromSlot()` | `AND storage_area_id = $2` on slot lookup |
| `POST /:location/add` | `req.body.storage_area_id` → `resolveStorageAreaId()` | `AND storage_area_id = $3` on lookup + update |
| `DELETE /:location/remove` | `req.body.storage_area_id` OR `resolveAreaFromSlot()` | `AND storage_area_id = $2` on lookup |
| `PUT /:location/open` | `req.body.storage_area_id` OR `resolveAreaFromSlot()` | `AND storage_area_id = $2` |
| `PUT /:location/seal` | `req.body.storage_area_id` OR `resolveAreaFromSlot()` | `AND storage_area_id = $2` |

**Param-based dual resolution**: For `drink`, `remove`, `open`, `seal` — if `storage_area_id` is in the
body, use it directly. If not, call `resolveAreaFromSlot(cellarId, location)` to look it up. This
maintains backward compatibility while providing an opt-in fast path that avoids the extra query.

**Permanent fallback**: With continuous row numbering, `UNIQUE(cellar_id, location_code)` holds
permanently, so `resolveAreaFromSlot()` is always correct. It is retained as a convenience path for
callers that cannot cheaply determine the area (e.g. `pairing.js`). Phase 2 Fix A eliminates the
unnecessary fallback calls in analysis move execution (performance, not correctness).

#### 4.4 Modified — `src/routes/cellarReconfiguration.js` — execute-moves path

**Purpose**: Thread area through the primary move execution pipeline.
**Principles**: Transaction Safety (#14), Defensive Validation (#12).

**Changes**:
- Move object schema: add optional `from_storage_area_id` + `to_storage_area_id` per move
- `validateMovePlan()`: resolve each area independently per move; validate source slot with
  `AND storage_area_id = $from` and target slot with `AND storage_area_id = $to`
- Execution queries: use respective area IDs on source and target slot UPDATEs
- For moves without area IDs (backward compat): resolve from source/target slots respectively
- Cross-area moves (fridge transfers): source and target may have different area IDs

#### 4.5 Modified — `src/services/cellar/movePlanner.js`

**Purpose**: Area context in move generation and validation.

**Changes**:
- `validateMovePlan()` accepts `from_storage_area_id` + `to_storage_area_id` per move; adds to
  respective slot lookups
- `generateMoveSuggestions()` includes `from_storage_area_id` and `to_storage_area_id` from
  source/target slots in each suggestion
- Move object shape: `{ wineId, from, to, zoneId, from_storage_area_id, to_storage_area_id }`

#### 4.6 Modified — `src/routes/bottles.js`

**Changes**:
- `addBottlesSchema`: add optional `storage_area_id`
- `getGridLimits(cellarId, storageAreaId)`: accept optional area; filter rows to that area
- `POST /add`: resolve area; pass to grid limits; filter adjacency search to area

#### 4.7 Modified — `src/services/cellar/cellarLayout.js`

**Changes**:
- `getStorageAreaRows(cellarId, storageAreaId = null)`: when area provided, filter to it
- `getCellarRowCount(cellarId, storageAreaId = null)`: pass through
- New: `getStorageAreaRowsForArea(storageAreaId)` — direct lookup by area UUID

#### 4.8 Modified — `src/routes/cellar.js` — Placement suggestions

**Purpose**: Return `storage_area_id` in suggestion responses.
**Principle**: Complete Contracts (#12).

**Changes**:
- `POST /suggest-placement` and `GET /suggest-placement/:wineId`:
  include `storage_area_id` from the suggested slot in the response
- `findAvailableSlot()` return shape: add `storageAreaId` field (looked up from the slot's row
  or resolved from the target zone's allocated rows)

#### 4.9 Modified — `src/routes/stats.js` — Layout payloads

**Purpose**: Include `storage_area_id` in slot data returned by layout API.

**Changes**:
- Dynamic areas path: include `storage_area_id` in the `row.slots[].push()` response object
  (already fetched in query, just not returned)
- Legacy path: look up and include `storage_area_id` for each slot

#### 4.10 Modified — `public/js/grid.js`

**Changes**:
- `createSlotElement()`: add `data-storage-area-id="${slot.storage_area_id}"` attribute
  (now available from layout payload)
- `renderStorageAreas()`: pass area ID when creating placeholder slots
- `renderFridge()`: pass area ID to fridge slot elements
- Export `getSlotAreaId(slotEl)` helper

#### 4.11 Modified — `public/js/modals.js`

**Purpose**: Area-aware slot operations in modal dialogs.
**Principle**: Complete surface coverage.

**Changes**:
- Store `currentSlot.storage_area_id` from layout data when opening a slot modal
- Pass `storage_area_id` to `drinkBottle()`, `openBottle()`, `sealBottle()` calls
- Slot lookup: use `(storage_area_id, location_code)` pair, not location_code alone

#### 4.12 Modified — `public/js/dragdrop.js`

**Changes**:
- `handleDragStart()`: extract `data-storage-area-id` from dragged slot (source area)
- `handleDrop()`: extract target area ID from drop target; pass both `fromAreaId` and `toAreaId`
  to `moveBottle()`; block cross-area drag-drop with toast (Phase 1 — UX design needed for Phase 3)
- `showSwapConfirmDialog()`: pass both area IDs to `directSwapBottles()`
- Touch handlers: same pattern

#### 4.13 Modified — `public/js/api/wines.js`

**Changes**:
- `moveBottle(from, to, fromAreaId = null, toAreaId = null)`: include `from_storage_area_id` +
  `to_storage_area_id` in body
- `directSwapBottles(slotA, slotB, fromAreaId = null, toAreaId = null)`: include both area IDs
- `removeBottle(location, storageAreaId = null)`: include `storage_area_id` in body or query
- `drinkBottle(location, opts)`: accept `storage_area_id` in opts object

#### 4.14 Modified — `public/js/api/cellar.js`

**Changes**:
- `executeCellarMoves(moves)`: move schema gains `from_storage_area_id` + `to_storage_area_id` per move
- `getSuggestedPlacement()`: extract `storage_area_id` from response

#### 4.15 Modified — `public/js/pairing.js`

**Purpose**: Area context in pairing-initiated drink actions.
**Prerequisite**: The pairing response (from `src/routes/pairing.js`) must be updated to include
`storage_area_id` alongside `location` in recommendation objects. Currently `rec.location` is an
aggregated comma-separated string with no area metadata.

**Changes**:
- Backend: pairing response includes `storage_area_id` per recommendation location
- Frontend: extract `storage_area_id` from `rec` and pass to `drinkBottle()` call
- `showDrinkActionPanel()`: store area ID on drink button `data-storage-area-id` attribute

#### 4.16 Modified — `public/js/bottles/modal.js`

**Purpose**: Area-aware slot lookup in bottle modal.

**Changes**:
- `findSlotData(location)`: currently finds slot by `location_code` equality alone via
  `getAllSlotsFromLayout()`. Update to accept optional `storageAreaId` param and match on both
  `location_code` and `storage_area_id` when provided.
- `showAddBottleModal(location)`: pass area ID through to form context
- `showEditBottleModal(location)`: pass area ID through to form context

#### 4.17 Modified — `public/js/bottles/form.js`

**Changes**:
- Extract `storage_area_id` from placement suggestion response
- Pass to `addBottles()` API call
- When multiple cellar areas exist: show area name alongside suggested slot

#### 4.18 Modified — `public/js/cellarAnalysis/fridge.js`

**Changes**:
- `moveFridgeCandidate()`: include `from_storage_area_id` + `to_storage_area_id` in move objects
  passed to `executeCellarMoves()` (source area from candidate's current slot, target from fridge area)
- `swapFridgeCandidate()`: include dual area IDs in both swap move objects
- `executeTransfer()`: include `from_storage_area_id` (source area) + `to_storage_area_id` (target
  fridge area) — this is the primary cross-area move path today
- `handleOrganizeFridge()`: pass area IDs through to move batch

---

### Deferred to Phase 2: Relax Unique Constraint

The constraint migration (`UNIQUE(cellar_id, location_code)` → `UNIQUE(cellar_id, storage_area_id,
location_code)`) is **deferred to Phase 2**. It requires:

1. Zone/analysis maps (`cellarAllocation.js`, `cellarAnalysis.js`, `layoutProposer.js`) refactored
   to key by `(areaId, rowId)` instead of cellar-global `R#`/`R#C#`
2. `resolveAreaFromSlot()` fallback either removed or hardened (currently throws 409 on ambiguity
   as defence-in-depth, but should not be relied upon as a primary resolution path)
3. All existing Phase 1 tests pass with no location-code-only resolution paths remaining

The migration SQL from v2 (`data/migrations/040_area_scoped_slot_constraint.sql`) remains valid
but will be scheduled in the Phase 2 plan after the analysis refactor.

---

## 5. Risk & Trade-off Register

### Trade-offs

| Trade-off | Rationale |
|-----------|-----------|
| **Constraint relaxation deferred to Phase 2** | Second reviewer correctly identified that zone/analysis maps would collapse even after all slot *operations* are area-aware. The constraint stays until analysis is also area-scoped. |
| **Dual area IDs (`from_storage_area_id` + `to_storage_area_id`) instead of single** | Cross-area moves already exist (fridge transfers). A single `storage_area_id` cannot represent both source and target areas. |
| **Optional area IDs in all schemas** | More parameter noise, but backward-compatible for single-area cellars. Callers that omit them get resolved via `resolveAreaFromSlot()` (one extra query). |
| **Block cross-area drag-drop** | Phase 3 concern. Simple toast in Phase 1. |
| **No zone system changes** | Zones stay cellar-global. Phase 2 adds per-area zones. |
| **Pairing response shape change** | Required to give `pairing.js` area metadata for drink actions. Small backend change but widens the API surface delta. |

### What Could Go Wrong

| Risk | Impact | Mitigation |
|------|--------|------------|
| Missed code path still resolves by location_code alone | MEDIUM — safe while constraint exists, blocks Phase 2 | Grep audit before Phase 2: `WHERE cellar_id = $X AND location_code = $Y` without `storage_area_id`. Constraint stays until zero hits. |
| `resolveAreaFromSlot()` returns wrong slot if constraint ever relaxed without hardening | HIGH — silent wrong-slot mutation | Defence-in-depth: throws `AppError(409)` if multiple slots match. Constraint remains as primary guard. |
| `resolveAreaFromSlot()` adds latency to param endpoints | LOW — single indexed lookup | Cache-friendly; only used when caller omits area ID |
| Analysis/zone maps use `R#` keys without area | MEDIUM — exists today, no worse in Phase 1 | Safe because constraint prevents duplicates. Phase 2 addresses maps before constraint relaxation. |
| Pairing response shape change breaks existing consumers | LOW — additive change | New `storage_area_id` field is added alongside existing `location` string; no fields removed |

### Deliberately Deferred

| Item | Why Deferred | When |
|------|-------------|------|
| **Relaxing unique constraint** | **Not needed — continuous row numbering makes constraint permanent.** Migration `040_area_scoped_slot_constraint.sql` is permanently obsolete. | Never |
| Analysis/zone map refactor to `(areaId, rowId)` keys | **Not needed** — continuous numbering means `R#` keys remain globally unique per cellar; maps are correct indefinitely. | Never |
| Remove `resolveAreaFromSlot()` fallback | **Not removed** — permanently valid fallback with continuous numbering; retained for callers (e.g. `pairing.js`) that cannot cheaply determine area. | N/A |
| ~~Enforce continuous row numbering at area creation~~ | ~~Requires UI + backend validation to reject overlapping `row_num` values~~ | ~~Phase 2 Fix D.4~~ — **shipped** |
| Area IDs in analysis move execution | Performance: eliminates `resolveAreaFromSlot()` queries; correctness not at risk | Phase 2 Fix A |
| `validateMovePlan` area-scoped slot queries | Consistency; safe while constraint holds | Phase 2 Fix B |
| ~~Per-area colour zone designation~~ | ~~Correctness in multi-area cellars~~ | ~~Phase 2 Fix D~~ — **shipped** |
| Cross-area drag-drop | UX design needed | Phase 3 Feature E |
| Area display prefix `\[Garage\] R5C3` | Only needed with 2+ cellar areas | Phase 3 Feature F |
| `startsWith('R'/'F')` / `LIKE 'R%'` replacement (~20 instances across 15+ files) | Works within single area; area-type metadata available after Phase 1 | Phase 3 Feature G |
| Colour zone selector in onboarding/builder UI | Backend ready (Fix D); frontend form missing | Phase 3 Feature H |
| Settings wizard single POST with rows + edit/delete mode | Wizard POST fails validation without `rows` (Fix D regression) | Phase 3 Feature I |
| Builder cellar-global row numbering (offset on save) | Builder resets to row 1 per area; rejected by row continuity guard | Phase 3 Feature J |

---

## 6. Testing Strategy

### Unit Tests

| Test File | What It Tests |
|-----------|--------------|
| `tests/unit/services/cellar/storageAreaResolver.test.js` | **New**. `resolveStorageAreaId()`: valid, wrong cellar, null fallback, none found. `resolveAreaFromSlot()`: found, not found, **multiple matches → 409** |
| `tests/unit/schemas/slot.test.js` | **New** (no existing slot schema tests). `from_storage_area_id`/`to_storage_area_id` optional UUID; `storage_area_id` optional UUID; reject non-UUID |
| `tests/unit/routes/slots.test.js` | **New** (no existing slot route tests). All 8 endpoints with/without area; dual area IDs for move/swap; area resolution called |
| `tests/unit/routes/bottles.test.js` | **Modified** (exists). Add `getGridLimits` with area; fridge add scoping |
| `tests/unit/routes/cellarReconfiguration.test.js` | **New** (no existing reconfiguration route tests). execute-moves with dual area IDs per move; cross-area moves |
| `tests/unit/services/cellar/movePlanner.test.js` | **Modified** (exists). Add validateMovePlan with dual area IDs |
| `tests/unit/services/cellar/cellarLayout.test.js` | **New** (no existing cellarLayout tests). Area-specific row filtering |

### Integration Tests

| Scenario | Verifies |
|----------|---------|
| Move bottle with dual area IDs | Area-scoped lookup + update on both source and target |
| Move bottle without area (backward compat) | `resolveAreaFromSlot()` fallback |
| Cross-area move (fridge transfer) | Different `from_storage_area_id` and `to_storage_area_id` |
| Drink bottle via modal (area from body) | Param-based endpoint with area |
| execute-moves with mixed area/no-area moves | Per-move resolution |
| Placement suggestion returns area | Response contract |
| Layout API includes storage_area_id | Slot payload completeness |

### Phase 2 Readiness Tests (for future constraint relaxation)

Before the constraint can be relaxed in Phase 2:
1. **Grep audit**: `grep -rn "cellar_id.*location_code" src/ --include="*.js" | grep -v storage_area_id`
   — must return zero hits on slot-mutating queries
2. **Zone/analysis map audit**: verify `cellarAllocation.js`, `cellarAnalysis.js`, `layoutProposer.js`
   all key by `(areaId, rowId)` — no cellar-global `R#`/`R#C#` keys
3. **`resolveAreaFromSlot()` usage audit**: all callers should send area ID explicitly; fallback
   should be dead code or throw on ambiguity
4. **All existing tests pass** with no code changes to the test assertions (pure backward compat)
5. **Manual test**: Add storage area in onboarding → all slot operations work with area context

---

## 7. Implementation Order

### Phase 1 — Thread Area Identity

Each step is independently testable. Backend first, then frontend.

1. **`storageAreaResolver.js`** — new service + unit tests (incl. 409 on ambiguous match)
2. **Schema updates** — add `from_storage_area_id`/`to_storage_area_id` to move schemas;
   `storage_area_id` to param-based schemas
3. **`cellarLayout.js`** — area-aware `getStorageAreaRows(cellarId, areaId)`
4. **`slots.js`** — all 8 endpoints: area resolution + scoped queries; dual area IDs for move/swap
5. **`cellarReconfiguration.js` + `movePlanner.js`** — execute-moves with dual area IDs; cross-area support
6. **`cellar.js`** — placement suggestions return `storage_area_id`
7. **`stats.js`** — layout payload includes `storage_area_id` per slot
8. **`bottles.js`** — area-aware bottle add
9. **Backend: `pairing.js` route** — include `storage_area_id` in recommendation response
10. **Frontend: `grid.js`** — `data-storage-area-id` on all slot elements
11. **Frontend: `modals.js`** — area in drink/open/seal calls
12. **Frontend: `bottles/modal.js`** — area-aware `findSlotData()`
13. **Frontend: `dragdrop.js`** — dual area IDs in drag state + cross-area block
14. **Frontend: `api/wines.js`** — dual area params in move/swap; single area in drink/remove
15. **Frontend: `api/cellar.js`** — dual area IDs in `executeCellarMoves` schema
16. **Frontend: `pairing.js`** — area from updated response in drink calls
17. **Frontend: `bottles/form.js`** — area from suggestion response
18. **Frontend: `cellarAnalysis/fridge.js`** — dual area IDs in all move/swap/transfer ops

---

## 8. Files Summary

| File | Action | Phase |
|------|--------|-------|
| `src/services/cellar/storageAreaResolver.js` | **Create** | 1 |
| `src/schemas/slot.js` | **Modify** | 1 |
| `src/routes/slots.js` | **Modify** | 1 |
| `src/routes/cellarReconfiguration.js` | **Modify** | 1 |
| `src/services/cellar/movePlanner.js` | **Modify** | 1 |
| `src/routes/cellar.js` | **Modify** | 1 |
| `src/routes/stats.js` | **Modify** | 1 |
| `src/routes/bottles.js` | **Modify** | 1 |
| `src/routes/pairing.js` | **Modify** | 1 (response shape: add `storage_area_id`) |
| `src/services/cellar/cellarLayout.js` | **Modify** | 1 |
| `public/js/grid.js` | **Modify** | 1 |
| `public/js/modals.js` | **Modify** | 1 |
| `public/js/bottles/modal.js` | **Modify** | 1 (area-aware `findSlotData()`) |
| `public/js/dragdrop.js` | **Modify** | 1 |
| `public/js/api/wines.js` | **Modify** | 1 |
| `public/js/api/cellar.js` | **Modify** | 1 |
| `public/js/pairing.js` | **Modify** | 1 |
| `public/js/bottles/form.js` | **Modify** | 1 |
| `public/js/cellarAnalysis/fridge.js` | **Modify** | 1 |
| `public/sw.js` | **Modify** | 1 (bump cache version) |
| `tests/unit/services/cellar/storageAreaResolver.test.js` | **Create** | 1 |
| `tests/unit/schemas/slot.test.js` | **Create** | 1 |
| `tests/unit/routes/slots.test.js` | **Create** | 1 |
| `tests/unit/routes/cellarReconfiguration.test.js` | **Create** | 1 |
| `tests/unit/services/cellar/cellarLayout.test.js` | **Create** | 1 |
| `tests/unit/routes/bottles.test.js` | **Modify** | 1 |
| `tests/unit/services/cellar/movePlanner.test.js` | **Modify** | 1 |

**Phase 1 total**: 6 new files (1 source + 5 test), 21 modified files (19 source + 2 test), ~45 touch points.
**Phase 2** (below): performance fixes for the deferred analysis-layer items. Constraint stays permanently.

---

## Phase 2: Analysis Layer Area Threading

- **Status**: Complete — all fixes (A/B/C/D) shipped on 2026-03-06.
- **Prerequisite**: Phase 1 complete and deployed.

### Progress Snapshot (2026-03-06)

- Completed: Fix A (frontend area threading), Fix B (`validateMovePlan` area-aware lookups), Fix C (Phase 0 composite slot snapshot), Fix D (`colour_zone` per storage area). All verified via full unit test suite (3437 tests, 0 failures).
- Phase 2 status: **Complete**. All fixes shipped.
- Verification: targeted `npm run test:unit -- tests/unit/cellarAnalysis/moves.test.js tests/unit/cellarAnalysis/moveGuide.test.js tests/unit/cellarAnalysis/layoutDiffOrchestrator.test.js tests/unit/services/cellar/movePlanner.test.js tests/unit/routes/cellarReconfiguration.test.js tests/unit/routes/executeMoves.test.js tests/unit/services/shared/cellarLayoutSettings.test.js tests/unit/schemas/storageArea.test.js`.

### Architectural Decision: Continuous Row Numbering

Storage areas use **globally unique, continuous row numbering** within a cellar. If a main cellar
occupies rows 1–19, a second storage area (garage, overflow rack) starts at row 20. This means
`UNIQUE(cellar_id, location_code)` holds permanently — `R20C1` in the garage is distinct from
`R5C3` in the main cellar by construction. No constraint relaxation is ever needed, and
zone/analysis maps keyed by `R#` remain correct indefinitely.

**Consequences**:
- `resolveAreaFromSlot()` remains valid forever — location codes are always unambiguous per cellar
- Zone/analysis maps in `cellarAllocation.js`, `cellarAnalysis.js`, `layoutProposer.js` need no refactoring
- The Phase 2 Readiness Tests in §6 (grep for cellar-global location queries) are informational, not gates
- Phase 2 scope shrinks to three targeted performance fixes

---

### Fix A — Analysis move execution enriched with area IDs (frontend, not backend)

- **Status**: Completed on 2026-03-06.

> **Detailed plan**: [`docs/plans/area-aware-slot-operations-frontend.md`](area-aware-slot-operations-frontend.md)
> covers this fix end-to-end: shared helper design, all 6 call sites in `moves.js`, the
> `moveGuide.js` and `fridge.js` gaps, module-cycle avoidance, trade-off register, and full
> testing strategy. **Follow the frontend plan, not the file list below, for implementation.**

**Problem**: `cellarAnalysis/moves.js` and `moveGuide.js` call `executeCellarMoves()` with move
objects that have no area IDs. The backend falls back to `resolveAreaFromSlot()` — one extra
DB query per slot, per move. A batch of 20 moves = 40 unnecessary queries in the most-used
analysis flow.

**Ownership decision — frontend enrichment (Option A from the companion plan)**:
Move suggestions are generated by `cellarSuggestions.js` (AI analysis path) and
`layoutProposal.sortPlan` (`analysis.js` line ~302, AI layout path) — **not** by
`movePlanner.planMoves()`. Enriching at the backend suggestion source is therefore not
straightforward (two distinct producers). Instead, area IDs are looked up at execution time
from the live `state.layout` via a shared frontend helper `getAreaIdForLocation(layout, locationCode)`.
This is the same pattern already used by `fridge.js` transfer/swap calls.

**Why not backend enrichment**: Suggestions may be stale at execution time (minutes between
generation and execution); the live layout is a fresher source. When the helper cannot find the
slot (stale layout), `null` is returned and the backend's `resolveAreaFromSlot()` handles it
gracefully — no data loss, one extra query.

**Implemented progress note**: This is now shipped across the analysis execution flows, including
`moves.js`, `moveGuide.js`, the shared `getAreaIdForLocation()` helper, and the layout-diff
`sortPlan` apply path in `layoutDiffOrchestrator.js`.

**Files**:

| File | Change |
|------|--------|
| `public/js/utils.js` | Add `getAreaIdForLocation(layout, locationCode)` — takes layout as parameter to avoid import cycle with `app.js` |
| `public/js/cellarAnalysis/moves.js` | All 6 `executeCellarMoves()` call sites enriched with `from_storage_area_id` + `to_storage_area_id` |
| `public/js/cellarAnalysis/moveGuide.js` | `executeCurrentMove()` enriched with area IDs |
| `public/js/cellarAnalysis/layoutDiffOrchestrator.js` | Enrich `layoutProposal.sortPlan` moves before `validateMoves()` and `executeCellarMoves()` |

**Shape change** (move object):
```javascript
// Before (Phase 1)
{ wineId, from: 'R5C3', to: 'R8C1' }

// After (Phase 2 Fix A)
{ wineId, from: 'R5C3', to: 'R8C1', from_storage_area_id: uuid|null, to_storage_area_id: uuid|null }
```

**Tests**: `tests/unit/utils/getAreaIdForLocation.test.js` (new); verify area IDs in
`executeCellarMoves()` payload across `moves.test.js`, `moveGuide.test.js`, and
`layoutDiffOrchestrator.test.js`.

---

### Fix B — `validateMovePlan` uses area IDs when present

- **Status**: Completed on 2026-03-06.

**Problem**: `validateMovePlan()` in `movePlanner.js` fetches slots with a cellar-global
`SELECT location_code, wine_id FROM slots WHERE cellar_id = ?` — area IDs on the move objects
are ignored. With continuous numbering this is always correct, but it misses the opportunity to
detect cross-area conflicts and is inconsistent with the rest of the area-aware pipeline.

**File**: `src/services/cellar/movePlanner.js` ~L387–L413

**Change**: When `from_storage_area_id` / `to_storage_area_id` are present on move objects, add
`AND storage_area_id = $N` to the respective slot lookups. Fall back to cellar-global when absent.

**Tests**: `tests/unit/services/cellar/movePlanner.test.js` — area-scoped conflict detection.

---

### Fix C — execute-moves Phase 0 lock includes `storage_area_id`

- **Status**: Completed on 2026-03-06.

**Problem**: Phase 0 `SELECT ... FOR UPDATE` in `cellarReconfiguration.js` (~L997) locks by
`cellar_id + location_code` only. The `slotSnap` revalidation map is keyed by `location_code`
alone. Both work correctly with continuous numbering, but including area ID makes the locking
intent explicit and defensive.

**File**: `src/routes/cellarReconfiguration.js` ~L997–L1022

**Change**:
```javascript
const locked = await txDb.prepare(`
  SELECT location_code, storage_area_id, wine_id
  FROM slots
  WHERE cellar_id = $1 AND location_code = ANY($2)
  FOR UPDATE
`).all(cellarId, locationCodes);

// Snapshot keyed by (areaId, locationCode) — explicit, not ambiguous
const slotSnap = new Map(
  locked.map(r => [`${r.storage_area_id}:${r.location_code}`, r.wine_id])
);
```

**Tests**: `tests/unit/routes/cellarReconfiguration.test.js` — verify snapshot key format.

---

### Phase 2 Progress Summary

| Fix | Status | Notes |
|-----|--------|-------|
| A | Completed (2026-03-06) | Frontend move execution now sends area IDs; helper + analysis flows + layout-diff apply path covered by tests |
| B | Completed (2026-03-06) | `validateMovePlan()` uses area-scoped slot checks when move objects include area IDs |
| C | Completed (2026-03-06) | Phase 0 lock query selects `storage_area_id`; locked snapshot keyed by `areaId:locationCode` |
| D | Complete (2026-03-06) | Per-area `colour_zone` model — migration 066, schema, per-area `getDynamicColourRowRanges`, row continuity guard, route wiring. 50 new tests. |

**Phase 2 progress**: 4 of 4 fixes complete. Phase 2 fully shipped.

---

### Fix D — Per-area colour zone designation (white / red / mixed)

- **Status**: Completed on 2026-03-06.

**Problem**: `getDynamicColourRowRanges(cellarId, colourOrder)` counts all bottles across the
entire cellar and derives a single white/red row boundary for all rows. With a second storage
area (garage rack, overflow shelving) this boundary is wrong: the garage's rows are pulled into
the proportional split even if the garage is entirely red wine. The analysis layer then
misclassifies placements in both areas.

**Example**: Main cellar rows 1–19 (mixed), garage rack rows 20–30 (all reds). Current logic
counts 60 red + 20 white bottles → allocates ~7 white rows out of 30. Those 7 white rows span
into the garage's range, so garage bottles are told they belong in white-region rows — false.

**Design decision**: Add a `colour_zone` field to `storage_areas` (`'white'`, `'red'`, `'mixed'`,
default `'mixed'`). The white/red row boundary is computed **per area** using each area's own
bottle counts and its own continuous row range. Areas marked `'white'` or `'red'` need no split
computation — all their rows are unconditionally that colour.

**Why not a per-area split point configured by the user?**: The existing proportional split
machinery in `computeDynamicRowSplit()` already gives a data-driven split within any area's row
range. Exposing a manual split point is additional UI complexity that adds little value — the
proportional split adapts automatically as the cellar fills. The only choice the user needs to
make is the coarse designation: is this area for whites, reds, or both?

---

#### Fix D.1 — DB migration: `colour_zone` column on `storage_areas`

**File**: `data/migrations/066_storage_area_colour_zone.sql`

(Note: `040_area_scoped_slot_constraint.sql` from Phase 1 planning is permanently obsolete due
to continuous row numbering. Slot 040 was taken by `040_producer_crawler.sql`; this migration
uses slot 066.)

```sql
-- Add colour_zone column to storage_areas
-- Values: 'white' | 'red' | 'mixed' (default)
ALTER TABLE storage_areas
  ADD COLUMN IF NOT EXISTS colour_zone TEXT NOT NULL DEFAULT 'mixed'
  CONSTRAINT storage_areas_colour_zone_check
    CHECK (colour_zone IN ('white', 'red', 'mixed'));

COMMENT ON COLUMN storage_areas.colour_zone IS
  'Colour family this area is dedicated to. white = white-family only, '
  'red = reds only, mixed = proportional split computed from inventory.';
```

---

#### Fix D.2 — Schema: extend `storageArea.js`

**File**: `src/schemas/storageArea.js`

**Changes**:
- Add `COLOUR_ZONES = ['white', 'red', 'mixed']` constant
- Add `colour_zone: z.enum(COLOUR_ZONES).default('mixed')` to `createStorageAreaSchema`
- Add `colour_zone: z.enum(COLOUR_ZONES).optional()` to `updateStorageAreaSchema`

---

#### Fix D.3 — Service: area-aware `getDynamicColourRowRanges()`

**File**: `src/services/shared/cellarLayoutSettings.js`

**Current behaviour**: Counts all cellar bottles → single global split → `whiteRows` and
`redRows` as flat arrays of row numbers spanning all areas.

**New behaviour**: Iterate storage areas; derive white/red rows per area based on its
`colour_zone`; merge results into a unified `whiteRows` / `redRows` map keyed by row number.

**New function** (replaces monolithic approach for multi-area cellars):

```javascript
/**
 * Build white/red row sets for a cellar, respecting each area's colour_zone.
 * - 'white' areas: all their rows are white rows
 * - 'red'   areas: all their rows are red rows
 * - 'mixed' areas: proportional split within that area's row range
 *
 * @param {string} cellarId
 * @param {ColourOrder} colourOrder - 'whites-top' | 'reds-top' (applies within mixed areas)
 * @returns {Promise<{whiteRows: number[], redRows: number[], ...}>}
 */
export async function getDynamicColourRowRanges(cellarId, colourOrder = 'whites-top') { ... }
```

**Implementation sketch**:
1. Fetch `storage_areas` for the cellar, including `colour_zone` and their row ranges
   (`storage_area_rows`)
2. For each area:
   - If `colour_zone = 'white'`: push all area row numbers into `whiteRowSet`
   - If `colour_zone = 'red'`: push all into `redRowSet`
   - If `colour_zone = 'mixed'`:
     - Count white-family vs red bottles **within this area's rows only** (filter
       `countColourFamilies` by `storage_area_id`)
     - Apply `computeDynamicRowSplit()` against this area's row count
     - Apply `getColourRowRanges()` with the area's actual starting row number offset
     - Push resulting rows into respective sets
3. Return merged `{ whiteRows, redRows, whiteRowCount, redRowCount }` — same shape as today for
   backward compatibility with all callers

**`countColourFamilies` update**: Accept optional `storageAreaId` parameter to filter the
bottle count query to a specific area.

```javascript
export async function countColourFamilies(cellarId, storageAreaId = null) {
  // Add: AND s.storage_area_id = $2 when storageAreaId provided
}
```

**Callers remain unchanged** — all six consumers call `getDynamicColourRowRanges(cellarId,
colourOrder)` and receive the same `{whiteRows, redRows}` shape. Only the internal computation
changes.

---

#### Fix D.4 — Row continuity enforcement at area creation

**Problem**: The `colour_zone` model depends on row numbers being globally unique per cellar
(continuous numbering). If the area creation endpoint allows arbitrary `row_num` values that
overlap existing rows, the model breaks.

**File**: `src/routes/storageAreas.js` (or wherever `POST /api/storage-areas` is handled)

**Change**: On `POST /` (create area), after Zod validation:
1. Fetch `MAX(row_num) FROM storage_area_rows WHERE cellar_id = $1`
2. If any `rows[].row_num` ≤ current max → reject with `400`:
   `"Row numbers must be continuous. Next valid start: ${maxRow + 1}"`
3. Document this invariant in the API response schema and error message

This is a light guard — the migration does not backfill existing areas, and single-area cellars
(the current common case) trivially satisfy the constraint (max = 0).

---

#### Fix D.5 — UI: colour purpose selector on storage area form

**Scope**: Whichever view handles storage area creation/editing. Based on existing patterns, this
is likely `src/routes/storageAreas.js` (backend) + a frontend modal or settings panel.

**Backend** (`src/routes/storageAreas.js`):
- `GET /api/storage-areas` response: include `colour_zone` in each area object
- `POST /` and `PUT /:id`: accept and persist `colour_zone` via updated schemas (Fix D.2)

**Frontend** (storage area create/edit form — create if not exists):
- Add a "Colour purpose" radio/select field:
  - `mixed` (default) — "White and red wines (auto-split)"
  - `white` — "White wines only"
  - `red` — "Red wines only"
- Show a one-line explanation: "Affects where the boundary between whites and reds is drawn."
- Default `mixed` for new areas; existing areas remain `mixed` after migration (safe default)

---

#### Fix D.6 — Analysis consumers: no code change needed

Because `getDynamicColourRowRanges()` returns the same `{whiteRows, redRows}` shape, all six
consumers require no changes:

| Consumer | How it uses the result | Impact of Fix D |
|----------|----------------------|-----------------|
| `cellarAllocation.js` | Checks if a row number is in `whiteRows` set | Now area-aware automatically |
| `cellarAnalysis.js` | Builds misplacement flags per bottle | Now area-aware automatically |
| `zoneReconfigurationPlanner.js` | Avoids assigning zones to wrong-colour rows | Now area-aware automatically |
| `cellarPlacement.js` | Finds empty slots in correct colour region | Now area-aware automatically |
| `layoutProposer.js` | Proposes layout rows for zones by colour | Now area-aware automatically |
| `cellarReconfiguration.js` | Colour guard in `reallocateRowTransactional` | Now area-aware automatically |

---

#### Fix D — File Summary

| File | Action |
|------|--------|
| `data/migrations/066_storage_area_colour_zone.sql` | **Create** — add `colour_zone` column |
| `src/schemas/storageArea.js` | **Modify** — add `colour_zone` enum to create/update schemas |
| `src/services/shared/cellarLayoutSettings.js` | **Modify** — per-area `getDynamicColourRowRanges()`, area-aware `countColourFamilies()` |
| `src/routes/storageAreas.js` | **Modify** — row continuity guard on create; expose `colour_zone` in responses |
| Frontend storage area form | **Modify/Create** — colour purpose selector |
| `tests/unit/shared/cellarLayoutSettings.test.js` | **Modify** — tests for per-area split, white/red/mixed area designation |
| `tests/unit/routes/storageAreas.test.js` | **Modify** — row continuity guard; `colour_zone` in CRUD |

**Fix D total**: 1 migration, 3 source files modified, 1 frontend form change, 2 test files modified.

#### Fix D — Post-Audit Fixes (2026-03-06)

Audit findings addressed:

| Finding | Severity | Disposition |
|---------|----------|-------------|
| `totalWhiteCount`/`totalRedCount` under-reported for dedicated white/red areas | MEDIUM | **Fixed** — `countColourFamilies()` now called for every area, not just mixed |
| `GET /storage-areas` slot count used `LIKE (sa.id || '%')` instead of `storage_area_id` | MEDIUM | **Fixed** — join uses `s.storage_area_id = sa.id` |
| `PUT /:id/layout` missing row-overlap guard | HIGH | **Fixed** — queries other areas' rows and rejects overlaps |
| `col_count` schema allows 50 but DB CHECK says ≤ 20 | MEDIUM | **Fixed** — schema `.max(20)` aligned with DB |
| `PUT /:id` parameter-index off-by-one | HIGH | **Fixed** (prior session) — regression tests added |
| Fix D.5 frontend colour-zone selector | HIGH | **Deferred** → Phase 3 Feature H — colour zone `<select>` in onboarding Step 2 + builder state |
| Settings wizard posts without `rows` field | HIGH | **Deferred** → Phase 3 Feature I — single POST with rows; add edit/delete mode |
| Builder normalizes rows starting at 1 | HIGH | **Deferred** → Phase 3 Feature J — offset-on-save with `applyRowOffsets()` helper |

---

## Phase 2 Overall File Summary

Implementation note (2026-03-06): all fixes (A, B, C, D) are complete. Supporting implementation
updates also landed in the layout-diff frontend path and its tests.

| File | Action | Fix |
|------|--------|-----|
| `public/js/utils.js` | Modify | A |
| `public/js/cellarAnalysis/moves.js` | Modify | A |
| `public/js/cellarAnalysis/moveGuide.js` | Modify | A |
| `src/services/cellar/movePlanner.js` | Modify | B only |
| `src/routes/cellarReconfiguration.js` | Modify | C |
| `src/services/shared/cellarLayoutSettings.js` | Modify | D |
| `src/schemas/storageArea.js` | Modify | D |
| `src/routes/storageAreas.js` | Modify | D |
| `data/migrations/066_storage_area_colour_zone.sql` | **Create** | D |
| Frontend storage area form | Modify/Create | D |
| `tests/unit/services/cellar/movePlanner.test.js` | Modify | A + B |
| `tests/unit/routes/cellarReconfiguration.test.js` | Modify | C |
| `tests/unit/cellarAnalysis/moves.test.js` | **Create** | A |
| `tests/unit/shared/cellarLayoutSettings.test.js` | Modify | D |
| `tests/unit/routes/storageAreas.test.js` | Modify | D |

**Phase 2 total**: 1 migration, 8 source files (4 modified + 1 create + frontend), 5 test files (3 modified + 2 new).

---

## Phase 3: Cross-Area UX Polish

- **Status**: Planned (not yet started)
- **Prerequisite**: Phase 2 complete and deployed.
- **Detailed plans**:
  - Backend (Feature G): [`docs/plans/phase3-backend-storage-type-heuristics.md`](phase3-backend-storage-type-heuristics.md)
  - Frontend (Features E, F, H, I, J): [`docs/plans/phase3-frontend-cross-area-ux.md`](phase3-frontend-cross-area-ux.md)
- **Implementation order**: Features I → J → H first (fix broken wizard), then E → F → G (UX polish).

Phase 3 addresses UX items deferred from Phases 1–2. Features E–G are polish for multi-area
cellars. Features H–J are prerequisite fixes for the storage area wizard/builder — the wizard
is currently broken for multi-area setups due to the `rows` requirement (Fix D) and row
continuity guard (Fix D.4). Feature H adds the colour zone selector that completes Fix D.5.

---

### Feature E — Cross-area drag-drop

**Current state (Phase 1)**: `dragdrop.js` passes dual area IDs to `moveBottle()` and
`directSwapBottles()`. Cross-area moves already work at the API level — no blocking toast exists.

**Problem**: Cross-area drag-drop works silently (no visual distinction from same-area moves).
Users may accidentally move bottles across areas without realizing it. A confirmation step is
needed to prevent unintended cross-area transfers.

**Design**:
1. **Visual affordance**: When a drag starts, highlight valid drop targets differently for
   same-area slots (existing green tint) vs cross-area slots (blue tint, labelled with the
   target area name on hover). Non-droppable slots remain grey.
2. **Confirmation step**: Cross-area drops open a small confirmation popover:
   `"Move [Wine Name] from [Source Area] → [Target Area]?"` with Confirm / Cancel buttons.
   Same-area drops proceed immediately (existing behaviour).
3. **API call**: On confirm, call `moveBottle(from, to, fromAreaId, toAreaId)` — already
   supported by Phase 1 backend. No backend changes needed.
4. **Touch support**: Same confirmation flow on touch drag end.
5. **Swap cross-area**: `directSwapBottles` likewise allows cross-area swaps after confirmation.

**Files**:

| File | Change |
|------|--------|
| `public/js/dragdrop.js` | Remove toast block; add cross-area detection + popover confirmation |
| `public/css/components.css` | Add `.slot--cross-area-target` highlight style (blue tint + area label) |
| `public/js/grid.js` | `getSlotAreaId()` already available from Phase 1; expose area `name` on slot element as `data-storage-area-name` |

**Tests**: `tests/unit/dragdrop.test.js` — cross-area drop opens confirmation; same-area drop
proceeds without confirmation; cancel restores drag state.

---

### Feature F — Area display prefix in slot labels and move descriptions

**Current state**: All slot references show bare location codes (`R5C3`, `F2`). With a single
cellar area this is unambiguous. With two areas both using R-notation, `R20C1` and `R5C1` look
like they might be the same area to a casual user.

**Problem**: Move guide steps, analysis suggestions, and toast messages don't indicate *which
storage area* a location belongs to. This becomes confusing once a second area is set up.

**Design**: Prefix location codes with the area name in all human-readable contexts:
`"[Garage] R20C1"` vs `"[Main Cellar] R5C1"`. Machine-readable API payloads keep bare codes
plus the `storage_area_id` UUID — no format change there.

**Where prefixes appear**:

| Surface | Example |
|---------|---------|
| Move guide step text | "Move Kanonkop Pinotage from **\[Main Cellar\] R5C3** to **\[Main Cellar\] R8C1**" |
| Analysis suggestion cards (`moves.js`) | "From: **\[Garage\] R20C1**" |
| Toast on drag-drop / drink | "Bottle consumed from **\[Main Cellar\] R5C3**" |
| Bottle modal subtitle | "Location: **\[Garage\] R20C1**" |
| Fridge transfer summary | "Moved to **\[Wine Fridge\] F3**" |

**Implementation approach**:
- New utility `formatSlotLabel(locationCode, storageAreaName)`:
  - When only one storage area exists in the cellar (the common case today): returns bare code
    (`R5C3`) — no visual change for single-area users
  - When two or more areas exist: returns `[AreaName] R5C3`
- `state.layout` already carries area names from the layout API; no extra fetch needed
- `public/js/utils.js`: add `formatSlotLabel(locationCode, areaId)` helper that looks up the
  area name from `state.layout`

**Files**:

| File | Change |
|------|--------|
| `public/js/utils.js` | Add `formatSlotLabel(locationCode, areaId)` |
| `public/js/cellarAnalysis/moveGuide.js` | Use `formatSlotLabel` in step text |
| `public/js/cellarAnalysis/moves.js` | Use `formatSlotLabel` in suggestion cards |
| `public/js/modals.js` | Use `formatSlotLabel` in modal subtitle + toast |
| `public/js/bottles/modal.js` | Use `formatSlotLabel` in bottle modal subtitle |
| `public/js/cellarAnalysis/fridge.js` | Use `formatSlotLabel` in transfer toasts |

**Tests**: `tests/unit/utils/formatSlotLabel.test.js` — single area → bare code; two areas →
prefixed; unknown area ID → bare code (graceful fallback).

---

### Feature G — Replace location-code type heuristics with area-type metadata

**Current state**: Roughly 15 places across backend and frontend use `startsWith('R')` to mean
"cellar slot" and `startsWith('F')` to mean "fridge slot". This worked when there was one cellar
grid and one fridge, but it is a hardcoded assumption that cannot survive a second storage area
whose row prefix happens to collide, or a rack stored in a wine-fridge `storage_type` area.

**Confirmed heuristic instances** (from grep across full codebase — 20+ instances in 15 backend files):

> **Pre-implementation requirement**: Run `grep -rn "startsWith\(['\"]R\|startsWith\(['\"]F\|LIKE 'R%'" src/ public/js/ --include="*.js"` and address every hit. The table below is the current snapshot; new instances may appear as the codebase grows.

| File | Line(s) | Heuristic | Currently means |
|------|---------|-----------|----------------|
| `src/routes/bottles.js` | L102, L154 | `startsWith('F')`, `startsWith('R')` | Fridge vs cellar placement algorithm |
| `src/services/cellar/cellarAnalysis.js` | L88, L100, L403, L661 | `startsWith('R')` × 4 | Cellar-only slot counts and filters |
| `src/services/cellar/cellarMetrics.js` | L66, L267 | `startsWith('R')` × 2 | Count cellar bottles only |
| `src/services/cellar/bottleScanner.js` | L105 | `startsWith('R')` | Identify cellar slots |
| `src/services/cellar/fridgeStocking.js` | L631, L659 | `startsWith('R')`, `startsWith('F')` | Cellar vs fridge slot classification |
| `src/services/cellar/slotUtils.js` | L22 | `startsWith('F')` | Fridge slot detection |
| `src/services/zone/zoneLayoutProposal.js` | L52, L264, L271 | `LIKE 'R%'` × 3 | Cellar-only slot queries |
| `src/services/zone/zoneAutoDiscovery.js` | L82 | `LIKE 'R%'` | Cellar-only slot query |
| `src/services/wine/drinkingStrategy.js` | L60 | `startsWith('F')` | Skip fridge wines from cellar strategy |
| `src/services/pairing/pairingEngine.js` | L215 | `startsWith('F')` | Fridge vs cellar for pairing |
| `src/services/acquisitionWorkflow.js` | L448 | `startsWith('F')` | Classify target slot type |
| `src/services/shared/cellarLayoutSettings.js` | L132 | `LIKE 'R%'` | Cellar bottles for colour split |
| `src/services/recipe/buyingGuide.js` | L169 | `LIKE 'R%'` | Count cellar bottles only |
| `src/routes/cellarZoneLayout.js` | L240 | `startsWith('R')` | Filter cellar slots in zone layout |
| `public/js/grid.js` | TBD | `startsWith('F')` | Render fridge cell vs cellar cell |
| `public/js/cellarAnalysis/fridge.js` | TBD | `startsWith('F')` | Identify fridge candidates |

**Proper fix**: After Phase 1, every slot operation has the area's `storage_type` available
(returned by `resolveStorageAreaId()` and present in layout payload). Use it instead.

**Design**:
- Backend: `resolveStorageAreaId()` already returns `{ id, storage_type }`. Replace each
  `startsWith('F')` check with `area.storage_type === 'wine_fridge' || area.storage_type === 'kitchen_fridge'`.
  Replace `startsWith('R')` with `area.storage_type === 'cellar' || area.storage_type === 'rack'`.
- New shared constant in `src/config/storageTypes.js`:
  ```javascript
  export const FRIDGE_TYPES = new Set(['wine_fridge', 'kitchen_fridge']);
  export const CELLAR_TYPES = new Set(['cellar', 'rack', 'other']);
  export function isFridgeType(storageType) { return FRIDGE_TYPES.has(storageType); }
  export function isCellarType(storageType) { return CELLAR_TYPES.has(storageType); }
  ```
- Frontend: slot elements carry `data-storage-type` (add in Phase 3 alongside existing
  `data-storage-area-id` from Phase 1). All frontend heuristics replaced with
  `slotEl.dataset.storageType`.
- SQL `LIKE 'R%'` filter in `countColourFamilies()` (Phase 2 already fixes this via
  `storage_area_id` join, but the explicit `LIKE` should be removed there as cleanup).

**Backward compatibility**: Single-area cellars today have all rows starting with `R` for cellar
slots and `F` for fridge slots. The new check produces identical results for them — zero
behaviour change, only the decision mechanism changes.

**Files**:

| File | Change |
|------|--------|
| `src/config/storageTypes.js` | **Create** — `FRIDGE_TYPES`, `CELLAR_TYPES`, `isFridgeType()`, `isCellarType()` |
| `src/routes/bottles.js` | Replace `startsWith('F'/'R')` with `isFridgeType` / `isCellarType` |
| `src/services/cellar/cellarAnalysis.js` | Replace 4× `startsWith('R')` with area-type filter |
| `src/services/cellar/cellarMetrics.js` | Replace 2× `startsWith('R')` with area-type filter |
| `src/services/cellar/bottleScanner.js` | Replace `startsWith('R')` |
| `src/services/cellar/fridgeStocking.js` | Replace `startsWith('R'/'F')` |
| `src/services/cellar/slotUtils.js` | Replace `startsWith('F')` |
| `src/services/zone/zoneLayoutProposal.js` | Replace 3× `LIKE 'R%'` SQL with area-type join |
| `src/services/zone/zoneAutoDiscovery.js` | Replace `LIKE 'R%'` SQL |
| `src/services/wine/drinkingStrategy.js` | Replace `startsWith('F')` |
| `src/services/pairing/pairingEngine.js` | Replace `startsWith('F')` |
| `src/services/acquisitionWorkflow.js` | Replace `startsWith('F')` |
| `src/services/shared/cellarLayoutSettings.js` | Remove `LIKE 'R%'`; filter by area type |
| `src/services/recipe/buyingGuide.js` | Replace `LIKE 'R%'` |
| `src/routes/cellarZoneLayout.js` | Replace `startsWith('R')` |
| `public/js/grid.js` | Add `data-storage-type` to slot elements; replace `startsWith('F')` |
| `public/js/cellarAnalysis/fridge.js` | Replace `startsWith('F')` with `dataset.storageType` |
| `tests/unit/config/storageTypes.test.js` | **Create** — `isFridgeType`, `isCellarType` |

**Tests**: Run the grep audit after implementation to confirm zero remaining hits.
Each modified service's test file gains a case where `storage_type` disagrees with the
location code prefix — confirming the fix is not silently passing because the heuristic
still happens to match.

---

### Feature H — Colour zone selector in onboarding/builder UI

**Current state**: Backend fully supports `colour_zone` (Fix D: schema, migration, routes, analysis).
Frontend has no UI for selecting it — new areas default to `'mixed'` silently.

**Problem**: Users cannot designate a storage area as white-only or red-only from the UI. They
must use a raw API call (`PUT /api/storage-areas/:id { colour_zone: 'red' }`). This defeats the
purpose of Fix D — the per-area colour zone model is invisible to users.

**Design**:

1. **Onboarding Step 2** (`public/js/onboarding.js:renderDetailsStep`): Add a "Colour purpose"
   `<select>` below the temperature zone selector for each area card:
   - `mixed` (default) — "White and red wines (auto-split)"
   - `white` — "White wines only (rosé, sparkling, dessert, fortified)"
   - `red` — "Red wines only"
   - Add a one-line hint: `"Affects where the white/red boundary is drawn in analysis."`
   - Wire `change` event to set `a.colour_zone = select.value`

2. **Builder state** (`public/js/storageBuilder.js`):
   - Add `colour_zone` to `state.areas[]` shape (default `'mixed'`)
   - `addArea()`: include `colour_zone: 'mixed'` in new area
   - `setAreas()`: preserve `colour_zone` from loaded areas
   - `getAreas()`: return `colour_zone` with each area
   - `renderPreview()`: show colour badge next to area title — e.g. `"(reds only)"` or
     `"(whites only)"` when not mixed

3. **Template application** (`onboarding.js:renderDetailsStep`): When a template is applied
   (e.g. `cellar_large`), reset `colour_zone` to `'mixed'` (templates are neutral). User
   can override after template application.

4. **Settings wizard save** (`public/js/settings.js:handleStorageAreasSave`): Include
   `colour_zone` in the POST body sent to `createStorageArea()`:
   ```javascript
   const areaData = {
     name: area.name,
     storage_type: area.storage_type,
     temp_zone: area.temp_zone,
     colour_zone: area.colour_zone || 'mixed',
     rows: area.rows,  // Fix I — include rows in POST
     display_order: createdAreas.length + 1
   };
   ```

5. **Edit flow**: When the wizard loads existing areas via `fetchLayoutLite()` → `setAreas()`,
   the existing `colour_zone` value flows through. When the user changes it and saves, the
   save handler must detect existing areas (those with `id`) and call `updateStorageArea(id,
   { colour_zone })` via PUT instead of creating a new area.

**Conditional visibility**: Only show the colour zone selector when `storage_type` is `'cellar'`,
`'rack'`, or `'other'`. Fridge types (`wine_fridge`, `kitchen_fridge`) skip it — the
`getDynamicColourRowRanges()` function already filters out fridge-type areas from colour
zone processing.

**Files**:

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Add colour zone `<select>` to Step 2 area cards |
| `public/js/storageBuilder.js` | Add `colour_zone` to state, `addArea()`, `setAreas()`, `getAreas()`, `renderPreview()` |
| `public/js/settings.js` | Include `colour_zone` in create/update API calls |
| `public/js/api/profile.js` | No change — `createStorageArea` already sends full body |

**Tests**: Manual test only (frontend UI). Verify:
- New area form shows colour zone dropdown for cellar/rack types
- Fridge type hides the dropdown
- Template application resets colour zone to mixed
- Edit existing area → change colour zone → save → verify via GET response

---

### Feature I — Settings wizard: include `rows` in POST and support edit mode

**Current state**: `handleStorageAreasSave()` in `settings.js` (L113-136) sends POST without
`rows`, then sends a separate `PUT /:id/layout`. But `createStorageAreaSchema` requires `rows`
(added in Fix D). This means the wizard's save flow **fails with a 400 validation error**
when creating new areas.

**Root cause**: The two-step pattern (POST area metadata → PUT layout) was written before the
Zod schema required `rows`. The schema was added to ensure row continuity validation runs
at creation time (Fix D.4), which requires rows to be present in the POST body.

**Design — single POST with rows**:

1. **Remove the two-step pattern**: Instead of POST (metadata only) + PUT (layout), send
   a single POST with rows included:
   ```javascript
   const areaData = {
     name: area.name,
     storage_type: area.storage_type,
     temp_zone: area.temp_zone,
     colour_zone: area.colour_zone || 'mixed',
     rows: area.rows  // Include rows in the POST
   };
   const result = await createStorageArea(areaData);
   ```
   Remove the separate `updateStorageAreaLayout()` loop for new areas.

2. **Edit mode — detect existing vs new areas**: When the wizard loads existing areas via
   `fetchLayoutLite()`, each area has an `id`. The save handler must distinguish:
   - **New areas** (no `id`): POST to `/api/storage-areas` with full body including `rows`
   - **Existing areas** (has `id`): PUT `/api/storage-areas/:id` for metadata changes
     (name, storage_type, temp_zone, colour_zone) + PUT `/:id/layout` for row changes
   - **Deleted areas** (existed before but removed in wizard): DELETE `/api/storage-areas/:id`

3. **Builder state tracks `id`**: `setAreas()` already preserves `id` from loaded areas.
   `addArea()` creates areas without `id`. The save handler checks `area.id` to determine
   the API method.

4. **Row numbering alignment for new areas**: Before POSTing new areas, the save handler
   must fetch the current max row number in the cellar and offset the new area's local
   row numbers accordingly. See Feature J for full details.

**Files**:

| File | Change |
|------|--------|
| `public/js/settings.js` | Rewrite `handleStorageAreasSave()`: single POST with rows for new areas; PUT for existing; DELETE for removed |
| `public/js/api/profile.js` | No change needed — functions already support full bodies |

**Tests**:
- `tests/unit/settings/storageAreaSave.test.js` — **Create**: mock API calls, verify new
  area POST includes `rows`; existing area uses PUT; deleted area uses DELETE
- Manual: open wizard → add area → save → verify 201 response (not 400)

---

### Feature J — Builder cellar-global row numbering

**Current state**: `storageBuilder.js` uses per-area row numbering (each area starts at 1).
When `removeRow()` is called, remaining rows are renumbered 1..N. The onboarding wizard
shows `R1C1`, `R2C1` etc. for every area, even when the cellar already has rows 1–19.

**Problem**: The backend row continuity guard (Fix D.4) rejects POST requests where
`row_num ≤ currentMaxRow`. If the main cellar occupies rows 1–19 and the user adds a
garage rack with the builder, the builder assigns rows starting at 1 — which overlaps
rows 1–19 and gets rejected.

**Current workaround**: The settings wizard could send rows starting at 1 and the backend
would reject them. There is no workaround — the wizard is broken for multi-area setups.

**Design — offset-aware builder**:

1. **Fetch existing max row on wizard open**: `openStorageAreasWizard()` fetches the layout
   via `fetchLayoutLite()`. From this, compute the cellar's current max row number:
   ```javascript
   const maxRow = layout?.areas?.reduce((max, a) =>
     Math.max(max, ...a.rows.map(r => r.row_num)), 0) ?? 0;
   ```
   Store this as `ui.maxExistingRow` in the onboarding state.

2. **Builder: offset row numbers on save, not during editing**: Users see local row numbers
   (1, 2, 3...) while editing — this is intuitive for a visual editor. The offset is applied
   **at save time** in `handleStorageAreasSave()`:
   ```javascript
   let nextRow = ui.maxExistingRow;
   for (const area of newAreas) {
     const offset = nextRow;
     area.rows = area.rows.map(r => ({
       row_num: r.row_num + offset,
       col_count: r.col_count
     }));
     nextRow = offset + area.rows.length;
   }
   ```
   This keeps the builder simple (local numbering) while satisfying the backend guard
   (cellar-global numbering).

3. **Existing areas keep their row numbers**: When editing an existing area that was loaded
   from `fetchLayoutLite()`, the area already has cellar-global row numbers. The builder
   displays these as-is (the user sees the actual row numbers). No offset is applied on
   save for existing areas.

4. **Preview shows actual row numbers**: `renderPreview()` already shows `R${r.row_num}C${c}`.
   For new areas during editing, this shows local numbers (R1C1, R2C1). This is acceptable —
   the user sees the visual layout, and exact row numbers are an internal detail. The
   review step (Step 4 JSON preview) should show the offset-applied row numbers so the
   user can verify before saving.

5. **Apply offset in review step**: `renderConfirmStep()` should display the offset-applied
   area data (not the local builder state). This means `renderConfirmStep()` must compute
   the offset and display the adjusted row numbers:
   ```javascript
   const adjustedAreas = applyRowOffsets(getAreas(), ui.maxExistingRow);
   summary.textContent = JSON.stringify({ areas: adjustedAreas }, null, 2);
   ```

**Alternative considered — live cellar-global numbering in builder**: Rejected because it
makes the builder harder to use: adding a row to a garage area would show "Row 23" when the
user expects "Row 4". The builder is a visual tool — intuitive local numbering during editing,
with automatic offset on save, is the better UX.

**Files**:

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Add `ui.maxExistingRow` state; pass to `renderConfirmStep()` for offset preview |
| `public/js/storageBuilder.js` | Add `applyRowOffsets(areas, baseRow)` exported helper |
| `public/js/settings.js` | Compute `maxExistingRow` from layout; apply offsets to new areas before POST |

**Tests**:
- `tests/unit/storageBuilder.test.js` — **Create**: `applyRowOffsets` with 0 base (first
  area), with 19 base (second area after 19-row cellar), with multiple new areas (sequential
  offsets)
- Manual: existing 19-row cellar → add garage rack → save → verify POST rows start at 20

---

### Phase 3 File Summary

| File | Action | Feature |
|------|--------|---------|
| `public/js/dragdrop.js` | Modify — cross-area confirmation flow | E |
| `public/css/components.css` | Modify — `.slot--cross-area-target` style | E |
| `public/js/grid.js` | Modify — `data-storage-area-name` + `data-storage-type` on slot elements | E + F + G |
| `public/js/utils.js` | Modify — add `formatSlotLabel()` | F |
| `public/js/cellarAnalysis/moveGuide.js` | Modify — area-prefixed step text | F |
| `public/js/cellarAnalysis/moves.js` | Modify — area-prefixed suggestion cards | F |
| `public/js/modals.js` | Modify — area-prefixed toasts and subtitle | F |
| `public/js/bottles/modal.js` | Modify — area-prefixed modal subtitle | F |
| `public/js/cellarAnalysis/fridge.js` | Modify — replace `startsWith('F')` + area-prefixed toasts | F + G |
| `src/config/storageTypes.js` | **Create** — `FRIDGE_TYPES`, `CELLAR_TYPES`, helper fns | G |
| `src/routes/bottles.js` | Modify — replace `startsWith('F')` with `isFridgeType()` | G |
| `src/services/cellar/cellarLayout.js` | Modify — replace `startsWith('R')` with area-type filter | G |
| `src/services/cellar/cellarMetrics.js` | Modify — replace `startsWith('R')` with area-type filter | G |
| `src/services/shared/cellarLayoutSettings.js` | Modify — remove `LIKE 'R%'`; filter by area type | G |
| `src/services/cellar/movePlanner.js` | Modify — replace `startsWith('R')` with area-type checks | G |
| `tests/unit/dragdrop.test.js` | Modify — cross-area confirmation tests | E |
| `tests/unit/utils/formatSlotLabel.test.js` | **Create** — label formatting tests | F |
| `tests/unit/config/storageTypes.test.js` | **Create** — `isFridgeType`, `isCellarType` | G |
| `public/js/onboarding.js` | Modify — colour zone selector (Step 2), `maxExistingRow` state, offset preview (Step 4) | H + J |
| `public/js/storageBuilder.js` | Modify — `colour_zone` in state/add/set/get/preview; `applyRowOffsets()` helper | H + J |
| `public/js/settings.js` | Modify — single POST with rows + colour_zone; edit/delete mode; row offset for new areas | H + I + J |
| `tests/unit/storageBuilder.test.js` | **Create** — `applyRowOffsets`, colour_zone state management | H + J |
| `tests/unit/settings/storageAreaSave.test.js` | **Create** — POST includes rows, edit mode PUT, delete mode DELETE | I |

**Phase 3 total**: 1 new config file, ~28 source files modified (14 backend + 10 frontend; run grep audit before implementation to confirm exact count), 5 test files (1 modified, 4 new).
No migration required — all necessary data is available from Phase 1/2 area threading and Fix D.
