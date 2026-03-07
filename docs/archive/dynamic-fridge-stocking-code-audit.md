# Code Audit: Dynamic Fridge Stocking (Backend)

**Plan**: `docs/plans/dynamic-fridge-stocking.md` (rev 5)
**Plan type**: Backend
**Audit date**: 2025-07-16
**Auditor**: Copilot (Claude Opus 4.6)

---

## Summary

The backend implementation closely follows the plan's architecture: category registry, dynamic allocator, multi-area orchestration, and slot-level reservation are all implemented correctly. One high-severity functional gap exists (`detectFridgeTransfers()` does not consume destination capacity, allowing conflicting advice), and three planned test files are missing entirely. The code is clean, well-documented, and correctly scoped for multi-tenant security.

| Severity | Count |
|----------|-------|
| HIGH | 3 |
| MEDIUM | 2 |
| LOW | 1 |

---

## Findings

### HIGH-1: `detectFridgeTransfers()` does not consume destination capacity

**Plan reference**: Decision 8 (section 2), step 4; rev 3 finding #10
**File**: `src/services/cellar/fridgeAllocator.js` lines 217-265

The plan explicitly requires:
> "Transfers consume destination capacity: each accepted transfer reduces the destination area's remaining gap count for that category (or flex count). If a transfer fills the last chillableRed gap in the wine fridge, the candidate that was assigned to that gap is demoted to `alternatives`."
> "No conflicting advice: the response never shows both 'add wine X from cellar' and 'transfer wine Y from kitchen fridge' competing for the same slot."

**Actual implementation**: `detectFridgeTransfers()` identifies misplaced wines and suggests transfers, but:
1. Does **not** check if the destination area has remaining gap or flex capacity
2. Does **not** consume destination capacity when emitting a transfer
3. Does **not** demote candidates that were targeting the same gap to `alternatives`
4. Could produce conflicting advice: a candidate and a transfer both targeting the same category slot

**Impact**: Users could see both "add Chardonnay from cellar to wine fridge chillableRed slot" **and** "transfer Pinot Noir from kitchen fridge to wine fridge chillableRed slot" for the same slot. This creates confusion and the total suggestions may exceed available capacity.

**Fix**: Implement destination capacity tracking as specified:
1. Build a per-area remaining-gap map from each `areaResult.unfilledGaps` + flex count
2. Before emitting a transfer, check `remainingGaps[targetAreaId][category] > 0` (or flex > 0)
3. Decrement the gap count when a transfer is emitted
4. When a transfer consumes the last gap for a category, find the candidate in `targetAreaResult.candidates` for that category and move it to `targetAreaResult.alternatives`
5. In the orchestrator (`cellarAnalysis.js`), apply these mutations after `detectFridgeTransfers()` returns

---

### HIGH-2: Missing test file `fridgeAllocator.test.js`

**Plan reference**: Section 5 "Test Cases", `tests/unit/services/cellar/fridgeAllocator.test.js`
**Expected tests** (12+ cases):
- Proportional allocation with representative inventory
- Flex slots = `max(1, floor(capacity * 0.1))`
- Kitchen fridge: only eligible categories get slots
- Floor guarantee: every stocked category gets at least 1 slot
- Scale-down: lowest-priority cut first when over-allocated
- Redistribution: remaining slots go to highest-priority under-served categories
- Stock cap: no category gets more slots than its stock count; excess goes to flex
- Stock cap: user with 1 sparkling, 48-slot fridge → sparkling gets 1 slot
- Global stock cap: second area gets `min(slots, stock - priorAllocations)`
- Global stock cap: two fridges collectively never target more than total stock
- `countInventoryByCategory()` counts ALL wines (including fridge wines)
- `getWinesByArea()` returns only wines matching the given `storage_area_id`
- `getAvailableCandidates()` excludes wines in any fridge area AND reserved slot IDs
- `getAvailableCandidates()` multi-bottle wine: reserving one slot does NOT block other slots
- `sortFridgeAreasByPriority()` wine_fridge before kitchen_fridge

**Impact**: Core allocation algorithm has zero dedicated test coverage. Any regression in `computeParLevels()` (proportional math, floor guarantees, scale-down, stock cap) would go undetected.

---

### HIGH-3: Missing test file `fridgeAllocator.crossArea.test.js`

**Plan reference**: Section 5 "Test Cases", `tests/unit/services/cellar/fridgeAllocator.crossArea.test.js`
**Expected tests** (10 cases):
- Two-area scenario: same wine is NOT recommended to both areas
- Wine fridge gets priority access to candidate pool
- Total recommendations across areas ≤ total available candidates
- Reserved slot IDs accumulate correctly across sequential area planning
- Multi-bottle wine: both fridges can each get one bottle of the same wine
- `detectFridgeTransfers()` — chillable red in kitchen_fridge → suggested transfer to wine_fridge
- `detectFridgeTransfers()` — sparkling in wine_fridge with kitchen_fridge gap → NO transfer
- `detectFridgeTransfers()` — no transfer suggested when destination has no remaining capacity
- `detectFridgeTransfers()` — transfer consumes destination gap; candidate demoted to alternative
- `detectFridgeTransfers()` — no conflicting advice for same slot

**Note**: `crossAreaSuggestions.test.js` exists (12 tests) but covers `generateCrossAreaSuggestions()` — a different function (cellar↔fridge moves based on drinking windows, not fridge↔fridge transfers based on category eligibility). These are NOT replacements for the planned cross-area allocator tests.

---

### MEDIUM-4: Missing test file `fridgeCategories.test.js`

**Plan reference**: Section 5 "Test Cases", `tests/unit/config/fridgeCategories.test.js`
**Expected tests**:
- All 7 categories present in `CATEGORY_REGISTRY`
- Each category has required fields (`priority`, `suitableFor`, `matchRules`, etc.)
- `FRIDGE_CATEGORY_ORDER` includes all categories + flex
- `CATEGORY_DISPLAY_NAMES` covers all entries
- Kitchen fridge exclusion: `textureWhite`, `chillableRed`, `dessertFortified` are wine_fridge only

**Impact**: Config changes (e.g., adding a new category, changing suitableFor) won't be caught by tests.

---

### MEDIUM-5: Incomplete `fridgeStocking.test.js` coverage

**Plan reference**: Section 5, `fridgeStocking.test.js` update requirements
**File**: `tests/unit/services/cellar/fridgeStocking.test.js`

Missing planned test cases:
1. `analyseFridge()` with `kitchen_fridge` — verify no red/oaked candidates in output
2. `analyseFridge()` without par-levels → should throw (no silent fallback)
3. `categoriseWine()` — dessertFortified test cases (port, sherry, fortified, etc.)

The existing 13 tests cover gap vs flex prioritization and sparkling keyword matching well, but the plan required additional coverage for the modified API surface.

---

### LOW-6: `sortFridgeAreasByPriority` tiebreak differs from plan

**Plan reference**: Section 5 test bullet `sortFridgeAreasByPriority() — wine_fridge before kitchen_fridge, larger capacity first`
**File**: `src/services/cellar/fridgeAllocator.js` line 203

Plan specifies tie-breaking by **larger capacity first** within the same storage type. Implementation ties-breaks by **area ID** (`a.id - b.id`).

```javascript
// Current: deterministic by ID
return a.id - b.id;

// Plan: larger capacity first
return Number(b.capacity) - Number(a.capacity);
```

**Impact**: With 2+ wine_fridge areas, the larger-capacity one should be planned first (it gets the wider category spread). Area ID ordering is arbitrary and may not give the most efficient allocation. In practice this only matters for cellars with multiple areas of the same type, which is rare.

---

## Plan Compliance

| Plan Section | File | Status | Notes |
|---|---|---|---|
| 4.1 CREATE `fridgeCategories.js` | `src/config/fridgeCategories.js` | ✅ Compliant | All 7 categories + flex, suitableFor, matchRules, display names |
| 4.2 CREATE `fridgeAllocator.js` | `src/services/cellar/fridgeAllocator.js` | ⚠️ Partial | All functions except `detectFridgeTransfers` capacity consumption (HIGH-1) |
| 4.3 MODIFY `fridgeStocking.js` | `src/services/cellar/fridgeStocking.js` | ✅ Compliant | Imports from fridgeCategories, accepts computed par-levels, area-scoped |
| 4.4 MODIFY `cellarAnalysis.js` | `src/routes/cellarAnalysis.js` | ✅ Compliant | Sequential loop, slot reservation, prior allocations, transfer detection |
| 4.5 MODIFY `cellar.js` | `src/routes/cellar.js` | ✅ Compliant | `getFridgeAreas()`, per-area `getEmptyFridgeSlots()`, `storage_area_id` in SELECT |
| 4.6 DELETE `fridgeParLevels.js` | — | ✅ Compliant | File deleted, no source imports remain |
| 4.7 MODIFY `cellarZones.js` | `src/config/cellarZones.js` | ✅ Compliant | Fridge entry stripped of hardcoded slots/capacity |
| 5.1 Tests `fridgeCategories.test.js` | — | ❌ Missing | HIGH-2 |
| 5.2 Tests `fridgeAllocator.test.js` | — | ❌ Missing | HIGH-2 |
| 5.3 Tests `fridgeAllocator.crossArea.test.js` | — | ❌ Missing | HIGH-3 |
| 5.4 Tests `fridgeStocking.test.js` (update) | `tests/unit/services/cellar/fridgeStocking.test.js` | ⚠️ Partial | Missing kitchen_fridge, no-par-levels, dessertFortified cases (MEDIUM-5) |

---

## Wiring Verification

| Path | Status | Notes |
|---|---|---|
| `cellarAnalysis.js` → `fridgeAllocator.js` → `fridgeCategories.js` | ✅ | Import chain correct |
| `cellarAnalysis.js` → `fridgeStocking.js` → `fridgeCategories.js` | ✅ | Import chain correct |
| `cellarAnalysis.js` → `cellar.js` (DB queries) | ✅ | `getAllWinesWithSlots`, `getEmptyFridgeSlots`, `getFridgeAreas` |
| `buildFridgeAnalysis()` → `runAnalysis()` → route handler | ✅ | Results attached to analysis report |
| `GET /api/cellar/zones` → `getFridgeAreas()` | ✅ | Dynamic fridge area data |
| Cellar-ID scoping in all DB queries | ✅ | `req.cellarId` used throughout |
| No raw `console.log` in new code | ✅ | Clean |
| No TODO/FIXME/HACK markers | ✅ | Clean |
| JSDoc on all exported functions | ✅ | All functions documented |
| `fridgeParLevels.js` imports removed everywhere | ✅ | No source references remain |

---

## Backend Principle Audit

| Principle | Status | Notes |
|---|---|---|
| SRP | ✅ | Clear separation: config, allocator, stocking service, orchestrator route |
| DRY | ✅ | Category registry centralized; no duplication of allocation logic |
| Security (cellar_id) | ✅ | All DB calls use `req.cellarId`; pure functions only filter pre-scoped data |
| Async/await | ✅ | All route handlers async; all DB calls awaited |
| Error handling | ✅ | `asyncHandler` wrapper on all routes |
| N+1 queries | ✅ | Single `getAllWinesWithSlots()` load + in-memory filtering; one `getEmptyFridgeSlots()` per area (bounded) |
| Nullish coalescing | ✅ | `??` used correctly where 0 is valid |
| Transaction wrapping | N/A | No multi-step mutations (analysis is read-only) |

---

## Recommendations

### Must Fix (before deploy)
1. **HIGH-1**: Implement destination capacity consumption in `detectFridgeTransfers()` — check remaining gaps/flex, decrement on transfer, demote competing candidates
2. **HIGH-2/3**: Create `fridgeAllocator.test.js` and `fridgeAllocator.crossArea.test.js` with the planned test cases

### Should Fix (before next release)
3. **MEDIUM-4**: Create `fridgeCategories.test.js` to protect the config schema
4. **MEDIUM-5**: Add missing test cases to `fridgeStocking.test.js` (kitchen_fridge, no-par-levels error, dessertFortified)

### Nice to Have
5. **LOW-6**: Update `sortFridgeAreasByPriority` tiebreak to use capacity instead of area ID
