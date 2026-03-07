# Code Audit Report: Area-Aware Slot Operations (Multi-Storage Phase 1)

- **Plan**: `docs/plans/area-aware-slot-operations.md`
- **Date**: 2026-03-06
- **Auditor**: Claude (+ second reviewer pass)
- **Status**: All actionable findings implemented.

---

## Summary

- **Files Planned**: 27 (6 new, 21 modified) | **Files Found/Verified**: 25 | **Gaps**: 2 (partial implementations)
- **HIGH findings**: 0
- **MEDIUM findings**: 5 → all implemented
- **LOW findings**: 2 → L1 upgraded to MEDIUM and implemented; L2 deferred (Phase 2 scope)

**Overall verdict**: Implementation complete. All audit and reviewer findings have been addressed
except M1 (validateMovePlan area-scoping, deferred to Phase 2 gate) and L2 (execute-moves Phase 0
lock, safe to defer while constraint holds).

---

## Findings and Resolution

### MEDIUM Severity

#### [M1] Plan Compliance: `validateMovePlan` not area-scoped in slot lookups

- **File**: [src/services/cellar/movePlanner.js](src/services/cellar/movePlanner.js#L387-L393)
- **Lines**: ~L387–L413
- **Status**: ⚠️ Deferred — Phase 2 Fix B scope
- **Detail**: `validateMovePlan()` uses a cellar-global `SELECT location_code, wine_id FROM slots WHERE cellar_id = ?` with no `storage_area_id` filter. The area IDs are passed in the move objects but not used by the validator. The `execute-moves` route uses area IDs correctly in its Phase 1/2 UPDATEs, so actual mutations are area-scoped. With continuous row numbering and the unique constraint in place this is safe indefinitely.
- **Recommendation**: Update the slot fetch to use area-scoped queries when `from_storage_area_id` / `to_storage_area_id` are provided. Improves consistency and cross-area conflict detection. **Note**: constraint relaxation is no longer the trigger — this is a Phase 2 consistency improvement (Fix B).
- **Principle**: Plan compliance; Defensive Validation

---

#### [M2] Plan Compliance: `open` and `seal` endpoints missing body `storage_area_id` path

- **File**: [src/routes/slots.js](src/routes/slots.js), [public/js/api/wines.js](public/js/api/wines.js), [public/js/modals.js](public/js/modals.js)
- **Status**: ✅ Fixed
- **Fix**: Added `storage_area_id` body reading (via `storageAreaIdSchema.safeParse`) to open/seal/remove route handlers with `resolveStorageAreaId` ownership validation. Updated `openBottle(location, storageAreaId)` and `sealBottle(location, storageAreaId)` in `api/wines.js`. Updated `handleToggleOpenBottle()` in `modals.js` to pass `currentSlot.storage_area_id`.

---

#### [M3] Plan Compliance: `getGridLimits` not updated with `storageAreaId` parameter

- **File**: [src/routes/bottles.js](src/routes/bottles.js#L27-L43)
- **Status**: ✅ Fixed
- **Fix**: Added `storageAreaId = null` param to `getGridLimits(cellarId, storageAreaId)`. Now passes it to `getStorageAreaRows(cellarId, storageAreaId)`. Updated call site at ~L92 to pass `storage_area_id` from request body. Both adjacency SELECT queries (~L135 and ~L171) now append `AND storage_area_id = $N` when a storage area is provided, preventing cross-area slot suggestions in multi-area cellars.

---

#### [M4] Plan Compliance: Legacy layout path in `stats.js` missing `storage_area_id`

- **File**: [src/routes/stats.js](src/routes/stats.js#L70-L141)
- **Status**: ✅ Fixed
- **Fix**: Added `s.storage_area_id` to the legacy layout SELECT query and to the `slotData` object. All cellars (including those without dynamic storage areas) now receive `storage_area_id` in layout slot data, enabling area-aware drag-drop on the frontend.

---

#### [M5] Test file location mismatch

- **File**: `tests/unit/schemas/slot.test.js`
- **Status**: ✅ Fixed
- **Fix**: Moved `tests/unit/routes/slot.test.js` → `tests/unit/schemas/slot.test.js` to match plan location and project convention (alongside `wine.test.js`, `restaurantPairing.test.js`).

---

### Reviewer Additional Findings

#### [R1] Pairing drink sends wrong `storage_area_id` for multi-area wines

- **File**: [public/js/pairing.js](public/js/pairing.js#L133-L180)
- **Status**: ✅ Fixed (upgraded from L1)
- **Detail**: `showDrinkActionPanel()` displays `locations[0]` (first location code) but sent `rec.storage_area_id` which is `MIN(s.storage_area_id)` — an arbitrary UUID across all areas for multi-area wines. For a wine with bottles in both cellar and fridge, this mismatch causes the drink API call to fail with a "slot not found" error.
- **Fix**: Removed `storage_area_id` from the drink call in `pairing.js`. The backend `resolveAreaFromSlot(cellarId, location)` correctly looks up the area from the displayed location code, which is always correct.

---

#### [R2] `resolveStorageAreaId` never called for client-provided area UUIDs in `slots.js`

- **File**: [src/routes/slots.js](src/routes/slots.js)
- **Status**: ✅ Fixed
- **Detail**: Routes that accepted `storage_area_id` from the request body passed it directly to UPDATE queries without validating cellar ownership. A malicious client could supply a UUID from a different cellar, and while cellar-scoped DB queries would prevent data leakage, a wrong area ID would produce a confusing 404 with no explanation.
- **Fix**: All routes that accept a body-provided area ID now call `resolveStorageAreaId(req.cellarId, areaId)` for ownership validation, which returns a clean 404 if the area doesn't belong to the cellar, or uses `resolveAreaFromSlot()` as a fallback when no area ID is provided.

---

#### [R3] `editingStorageAreaId` missing from `bottleState` — remove/add use wrong area

- **Files**: [public/js/bottles/state.js](public/js/bottles/state.js), [public/js/bottles/modal.js](public/js/bottles/modal.js), [public/js/bottles/form.js](public/js/bottles/form.js)
- **Status**: ✅ Fixed
- **Detail**: `handleDeleteBottle()` in form.js called `removeBottle(bottleState.editingLocation)` without an area ID, always falling back to `resolveAreaFromSlot()`. The non-smart add path called `addBottles(wineId, location, quantity)` similarly. Both incurred unnecessary extra DB lookups even when the frontend had the area ID available from the layout.
- **Fix**:
  - Added `editingStorageAreaId: null` to `bottleState` and reset it in `resetBottleState()`.
  - `showAddBottleModal(location)` and `showEditBottleModal(location, wineId)` in `modal.js` now set `bottleState.editingStorageAreaId = findSlotData(location)?.storage_area_id || null`.
  - `handleDeleteBottle()` passes `bottleState.editingStorageAreaId` to `removeBottle()`.
  - Non-smart `addBottlesToSlots()` passes `bottleState.editingStorageAreaId` to `addBottles()`.

---

#### [R4] `cellarAnalysis/moves.js` and `moveGuide.js` callers don't pass area IDs

- **Files**: [public/js/cellarAnalysis/moves.js](public/js/cellarAnalysis/moves.js#L1362), [public/js/cellarAnalysis/moveGuide.js](public/js/cellarAnalysis/moveGuide.js#L462)
- **Status**: ⚠️ Documented — deferred to Phase 2
- **Detail**: These callers build move objects without `from_storage_area_id`/`to_storage_area_id` because the analysis layer doesn't return area IDs with its move suggestions. The backend `resolveAreaFromSlot()` fallback handles this correctly while the unique constraint is in place.
- **Recommendation**: When the analysis layer is extended in Phase 2 to return area IDs per move, thread them through `executeCellarMoves()` here.

---

### LOW Severity

#### [L2] Phase 0 SELECT FOR UPDATE in execute-moves not area-scoped

- **File**: [src/routes/cellarReconfiguration.js](src/routes/cellarReconfiguration.js#L997-L1002)
- **Status**: ⚠️ Deferred — Phase 2 scope
- **Detail**: The Phase 0 lock query doesn't include `storage_area_id`. With the unique constraint in place this is correct. The in-transaction snapshot maps `location_code → wine_id` without area context. Phase 1 and Phase 2 UPDATEs include `storage_area_id` as a conditional guard.
- **Recommendation**: Before Phase 2, update Phase 0 to include `storage_area_id` in the lock query and key the snapshot by `(storage_area_id, location_code)`.

---

## Plan Compliance Summary

| Planned Item | Status | Notes |
|-------------|--------|-------|
| `src/services/cellar/storageAreaResolver.js` | ✅ Implemented | Matches plan exactly, including 409 defence-in-depth |
| `src/schemas/slot.js` | ✅ Implemented | All 6 schemas updated; `storageAreaIdSchema` exported |
| `src/routes/slots.js` | ✅ Implemented | All 8 endpoints area-scoped; `resolveStorageAreaId` called for owned UUIDs |
| `src/routes/cellarReconfiguration.js` | ✅ Implemented | execute-moves dual area IDs, two-phase updates area-scoped |
| `src/services/cellar/movePlanner.js` | ⚠️ Partial | Area IDs in move objects; `validateMovePlan` not area-scoped (M1, Phase 2 gate) |
| `src/routes/cellar.js` | ✅ Implemented | `storage_area_id` in suggest-placement responses |
| `src/routes/stats.js` | ✅ Fixed | Legacy path now includes `storage_area_id` (M4) |
| `src/routes/bottles.js` | ✅ Fixed | `getGridLimits` area-param + adjacency queries area-scoped (M3) |
| `src/routes/pairing.js` | ✅ Implemented | Pairing drink fixed to use `resolveAreaFromSlot` (R1) |
| `src/services/cellar/cellarLayout.js` | ✅ Implemented | All 3 functions added/updated |
| `public/js/grid.js` | ✅ Implemented | `data-storageAreaId` set on slot elements |
| `public/js/modals.js` | ✅ Fixed | drink, open, and seal all pass area ID correctly (M2) |
| `public/js/bottles/modal.js` | ✅ Fixed | `editingStorageAreaId` set from `findSlotData()` on modal open (R3) |
| `public/js/bottles/state.js` | ✅ Fixed | `editingStorageAreaId` field added + reset (R3) |
| `public/js/bottles/form.js` | ✅ Fixed | removeBottle and addBottles pass `editingStorageAreaId` (R3) |
| `public/js/dragdrop.js` | ✅ Implemented | fromAreaId + toAreaId threaded through all drag paths |
| `public/js/api/wines.js` | ✅ Fixed | `openBottle`, `sealBottle`, `removeBottle` accept storageAreaId (M2) |
| `public/js/api/cellar.js` | ✅ Implemented | JSDoc updated; dual area IDs documented |
| `public/js/pairing.js` | ✅ Fixed | `storage_area_id` removed from drink call; backend resolves correctly (R1) |
| `public/js/bottles/form.js` | ✅ Implemented | `suggestion.storage_area_id` passed to `addBottles()` |
| `public/js/cellarAnalysis/fridge.js` | ✅ Implemented | Dual area IDs in moveFridge, swap, executeTransfer |
| `public/js/cellarAnalysis/moves.js` | ⚠️ Partial | No area IDs — resolveAreaFromSlot fallback handles it safely (R4, Phase 2) |
| `public/js/cellarAnalysis/moveGuide.js` | ⚠️ Partial | No area IDs — resolveAreaFromSlot fallback handles it safely (R4, Phase 2) |
| `public/sw.js` | ✅ Implemented | Cache bumped to `v198` |
| `tests/unit/services/cellar/storageAreaResolver.test.js` | ✅ Created | 16 tests, covers all paths including 409 |
| `tests/unit/schemas/slot.test.js` | ✅ Fixed | Moved from `tests/unit/routes/slot.test.js` (M5) |
| `tests/unit/routes/slots.test.js` | ✅ Created | 15 tests for all 4 tested endpoints |
| `tests/unit/routes/cellarReconfiguration.test.js` | ✅ Created | 7 tests for execute-moves area resolution |
| `tests/unit/services/cellar/cellarLayout.test.js` | ✅ Created | 21 tests for all 4 exported functions |
| `tests/unit/routes/bottles.test.js` | ✅ Modified | Area threading tests added |
| `tests/unit/services/cellar/movePlanner.test.js` | ✅ Modified | Dual area ID passthrough tests added |

---

## Security Verification

| Check | Result | Notes |
|-------|--------|-------|
| `cellar_id` scoping on all slot mutations | ✅ Pass | Every query includes `cellar_id = $N` |
| `storage_area_id` ownership validated for client-provided UUIDs | ✅ Pass | `resolveStorageAreaId` called in all slots.js routes |
| `storage_area_id` in all slot SELECT queries | ✅ Pass | slots.js, bottles.js all updated |
| `storage_area_id` in all slot UPDATE queries | ✅ Pass | Phase 1 + Phase 2 in execute-moves verified |
| Trusting client `cellar_id` | ✅ Pass | All routes use `req.cellarId` |
| `resolveAreaFromSlot` 409 guard | ✅ Pass | Implemented; throws on multiple matches |
| `resolveStorageAreaId` cellar ownership check | ✅ Pass | Validates area belongs to cellar |
| Auth middleware on all slot routes | ✅ Pass | Routes mounted behind `requireAuth + requireCellarContext` |
| Unique constraint preserved | ✅ Pass | No constraint migration in this phase |

---

## Phase 2 Scope (revised — constraint relaxation is no longer the trigger)

**Architectural note**: With continuous row numbering, `UNIQUE(cellar_id, location_code)` is
permanent. Constraint relaxation is off the table. The items below are Phase 2 consistency and
performance improvements, not safety gates:

1. **Fix A** — Enrich analysis move execution with area IDs (frontend, `getAreaIdForLocation(layout, code)`). Eliminates unnecessary `resolveAreaFromSlot()` fallback queries in batch move flows.
2. **Fix B** — `validateMovePlan` area-scoped slot queries (M1) — consistency; enables cross-area conflict detection.
3. **Fix C** — Phase 0 SELECT FOR UPDATE composite snapshot key (L2) — makes locking intent explicit.
4. **Fix D** — Per-area `colour_zone` designation — correctness for multi-area cellars.

`resolveAreaFromSlot()` is a **permanent valid fallback** (not transitional). It is retained for callers where the area is not cheaply known.
