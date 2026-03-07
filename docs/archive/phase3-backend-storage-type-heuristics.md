# Plan: Phase 3 Backend — Replace Location-Code Type Heuristics (Feature G)

- **Date**: 2026-03-06
- **Status**: Complete
- **Completed**: 2026-03-06
- **Author**: Claude + User
- **Parent**: [Area-Aware Slot Operations](area-aware-slot-operations.md) — Phase 3, Feature G
- **Prerequisites**: Phase 2 complete (shipped 2026-03-06)

---

## 1. Context Summary

### What Exists Today

23 instances across 17 files use `startsWith('R')`, `startsWith('F')`, `LIKE 'R%'`, or `LIKE 'F%'`
to determine whether a slot is in a cellar or fridge. This heuristic works today because:
- Cellar slots use `R#C#` notation and fridge slots use `F#` notation
- There is only one cellar area and one fridge area per user

With multiple storage areas (e.g. a garage rack using `R20C1`), the heuristic remains *coincidentally
correct* due to continuous row numbering, but it encodes a false assumption: that slot type is
determined by its location code prefix rather than by the `storage_type` field on its parent
`storage_areas` record.

### What Already Exists

1. **`storage_areas.storage_type`** — every area has a type: `cellar`, `wine_fridge`,
   `kitchen_fridge`, `rack`, `other`
2. **`getStorageAreasByType(cellarId)`** in `cellarLayout.js` — groups areas by type, returns
   `{ cellar: [...], wine_fridge: [...], ... }`
3. **`s.storage_area_id`** — already returned on wine objects from `getAllWinesWithSlots()` and
   present on slot records
4. **`resolveStorageAreaId()`** — returns `{ id, storage_type }` for any area
5. **`isFridgeType(storageType)`** pattern — used in `fridgeCategories.js` via `suitableFor` arrays

### Patterns to Reuse

- `getStorageAreasByType()` for building area-type lookup maps
- `storage_area_id` on wine/slot objects for reverse-lookup to storage_type
- Existing area-aware queries that filter by `storage_area_id` (Phase 1/2 pattern)

---

## 2. Proposed Architecture

### 2.1 Design Decision: Shared Config Module

**Decision**: Create `src/config/storageTypes.js` as the single source of truth for storage type
classification.

**Principles**: DRY (#1), Single Source of Truth (#10), Open/Closed (#3).

```javascript
export const FRIDGE_TYPES = new Set(['wine_fridge', 'kitchen_fridge']);
export const CELLAR_TYPES = new Set(['cellar', 'rack', 'other']);

export function isFridgeType(storageType) { return FRIDGE_TYPES.has(storageType); }
export function isCellarType(storageType) { return CELLAR_TYPES.has(storageType); }
```

**Why a config module, not inline checks**: 14 files need this classification. Inlining
`storageType === 'wine_fridge' || storageType === 'kitchen_fridge'` in each creates a maintenance
hazard — if a new fridge type is added (e.g. `serving_fridge`), 14 files need updating. With the
config module, one edit covers all consumers.

### 2.2 Design Decision: Area-Type Lookup Map

**Decision**: Services that process arrays of wines (cellarAnalysis, bottleScanner, cellarMetrics,
fridgeStocking, drinkingStrategy) will receive or build an `areaTypeMap: Map<string, string>`
mapping `storage_area_id → storage_type`. This avoids N+1 lookups per wine.

**Principles**: N+1 Prevention (#17), Modularity (#7).

**Construction**: One query per analysis call via `getStorageAreasByType()` (already called in
most of these flows), then flatten:

```javascript
function buildAreaTypeMap(areasByType) {
  const map = new Map();
  for (const [type, areas] of Object.entries(areasByType)) {
    for (const area of areas) map.set(area.id, type);
  }
  return map;
}
```

This helper belongs in `src/config/storageTypes.js` alongside the type predicates.

### 2.3 Heuristic Replacement Strategy

Three categories of heuristics, each with a different replacement approach:

| Category | Current Pattern | Replacement | Files |
|----------|----------------|-------------|-------|
| **SQL filter** | `LIKE 'R%'` / `LIKE 'F%'` | JOIN `storage_areas sa` + `WHERE sa.storage_type IN (...)` or use existing `storage_area_id` filter | 9 instances in 7 files |
| **JS wine filter** | `startsWith('R')` / `startsWith('F')` on `wine.slot_id` | Look up `wine.storage_area_id` in `areaTypeMap` → `isCellarType()` / `isFridgeType()` | 11 instances in 9 files |
| **JS slot parser** | `isCellarSlot()` / `isFridgeSlot()` regex in `slotUtils.js` | **Keep as-is** — these are pure format validators, not type classifiers. They validate that a string *looks like* a slot code, which is orthogonal to storage type. | 3 instances in 1 file |

### 2.4 slotUtils.js — Keep, Don't Replace

`parseSlot()`, `isCellarSlot()`, `isFridgeSlot()` in `slotUtils.js` are **format parsers**, not
type classifiers. `parseSlot('R3C5')` returns `{row: 3, col: 5}` — it parses the *format* of a
slot code, not its *purpose*. These remain valid regardless of what storage type the slot belongs
to. All cellar-type slots (cellar, rack, other) use `R#C#` format; all fridge-type slots use `F#`
format. The format and type are correlated by design, but the parsers serve a different role.

**Exception**: Callers that use `isCellarSlot()` / `isFridgeSlot()` as type proxies (e.g.
`bottleScanner.js` line 105: `slot.startsWith('R')` to mean "is a cellar wine") should switch
to the area-type lookup. The parsers themselves stay unchanged.

---

## 3. Sustainability Notes

### Assumptions That Could Change

| Assumption | Likelihood | Mitigation |
|-----------|-----------|------------|
| Fridge slots always use `F#` format | Medium | `storageTypes.js` decouples type from format |
| New storage types stay in cellar-or-fridge dichotomy | Low | `CELLAR_TYPES` and `FRIDGE_TYPES` sets are easy to extend |
| `storage_area_id` available on all wine objects | Already true | `getAllWinesWithSlots()` returns it; other queries can JOIN |

### Extension Points

1. **New storage type**: Add to `FRIDGE_TYPES` or `CELLAR_TYPES` in one file
2. **Type-specific behaviour**: Use `storageType` directly instead of the binary helper
3. **Hybrid types**: If needed, add a third category set (e.g. `DISPLAY_TYPES`)

---

## 4. File-Level Plan

### 4.1 New — `src/config/storageTypes.js`

**Purpose**: Single source of truth for storage type classification.
**Principles**: DRY (#1), Single Source of Truth (#10), Open/Closed (#3).
**Dependencies**: None. Imported by 14+ files.

```javascript
/**
 * @fileoverview Storage type classification constants and helpers.
 * @module config/storageTypes
 */

/** Storage types that represent fridge-like areas */
export const FRIDGE_TYPES = new Set(['wine_fridge', 'kitchen_fridge']);

/** Storage types that represent cellar-like areas */
export const CELLAR_TYPES = new Set(['cellar', 'rack', 'other']);

/** @param {string} storageType @returns {boolean} */
export function isFridgeType(storageType) { return FRIDGE_TYPES.has(storageType); }

/** @param {string} storageType @returns {boolean} */
export function isCellarType(storageType) { return CELLAR_TYPES.has(storageType); }

/**
 * Build a Map<storage_area_id, storage_type> from the output of getStorageAreasByType().
 * @param {Object} areasByType - { cellar: [...], wine_fridge: [...], ... }
 * @returns {Map<string, string>}
 */
export function buildAreaTypeMap(areasByType) {
  const map = new Map();
  for (const [type, areas] of Object.entries(areasByType)) {
    for (const area of areas) map.set(area.id, type);
  }
  return map;
}
```

---

### 4.2 Modified — SQL Query Heuristics (7 files, 9 instances)

Each SQL `LIKE 'R%'` or `LIKE 'F%'` is replaced by a JOIN to `storage_areas` + type filter,
or by using the existing `storage_area_id` column.

#### 4.2.1 `src/services/shared/cellarLayoutSettings.js` — Line 140

**Current**: `AND s.location_code LIKE 'R%'` (no-storageAreaId path of `countColourFamilies`)
**Replace with**:
```sql
AND s.storage_area_id IN (
  SELECT sa.id FROM storage_areas sa
  WHERE sa.cellar_id = $1 AND sa.storage_type IN ('cellar', 'rack', 'other')
)
```
**Why**: The storageAreaId path already uses `storage_area_id = $2`. The fallback path should
use type-based filtering instead of prefix matching.

#### 4.2.2 `src/services/zone/zoneLayoutProposal.js` — Lines 52, 264, 271

**Current**: Three SQL queries with `AND s.location_code LIKE 'R%'`
**Replace with**: Same subquery pattern as 4.2.1, or add a JOIN:
```sql
JOIN storage_areas sa ON sa.id = s.storage_area_id AND sa.storage_type IN ('cellar', 'rack', 'other')
```
**Note**: All three queries already join `slots s` — adding the `storage_areas` JOIN is minimal.

#### 4.2.3 `src/services/zone/zoneAutoDiscovery.js` — Line 82

**Current**: `AND s.location_code LIKE 'R%'`
**Replace with**: Same JOIN pattern as 4.2.2.

#### 4.2.4 `src/services/recipe/buyingGuide.js` — Line 169

**Current**: `SELECT COUNT(*) as count FROM slots WHERE cellar_id = $1 AND location_code LIKE 'R%'`
**Replace with**:
```sql
SELECT COUNT(*) as count FROM slots s
JOIN storage_areas sa ON sa.id = s.storage_area_id AND sa.storage_type IN ('cellar', 'rack', 'other')
WHERE s.cellar_id = $1
```

#### 4.2.5 `src/services/cellar/cellarHealth.js` — Lines 31, 547

**Line 31** (in_fridge computed column):
**Current**: `MAX(CASE WHEN s.location_code LIKE 'F%' THEN 1 ELSE 0 END) as in_fridge`
**Replace with**:
```sql
MAX(CASE WHEN sa_type.storage_type IN ('wine_fridge', 'kitchen_fridge') THEN 1 ELSE 0 END) as in_fridge
```
Add JOIN: `LEFT JOIN storage_areas sa_type ON sa_type.id = s.storage_area_id`

**Line 547** (empty fridge slots):
**Current**: `WHERE cellar_id = ? AND location_code LIKE 'F%' AND wine_id IS NULL`
**Replace with**:
```sql
WHERE s.cellar_id = $1 AND wine_id IS NULL
  AND s.storage_area_id IN (
    SELECT sa.id FROM storage_areas sa
    WHERE sa.cellar_id = $1 AND sa.storage_type IN ('wine_fridge', 'kitchen_fridge')
  )
```

#### 4.2.6 `src/routes/recipes.js` — Line 431

**Current**: `MAX(CASE WHEN s.location_code LIKE 'F%' THEN 1 ELSE 0 END) as in_fridge`
**Replace with**: Same pattern as 4.2.5 Line 31 — JOIN storage_areas + type check.

#### 4.2.7 `src/routes/pairing.js` — Line 277

**Current**: `MAX(CASE WHEN s.location_code LIKE 'F%' THEN 1 ELSE 0 END) as in_fridge`
**Replace with**: Same pattern as 4.2.5 Line 31.
**Note**: This query already selects `MIN(s.storage_area_id) as storage_area_id` (line 282),
so the storage_areas JOIN is incremental.

#### 4.2.8 `src/services/acquisitionWorkflow.js` — Line 428

**Current**: `SELECT location_code FROM slots WHERE cellar_id = ? AND location_code LIKE 'F%' AND wine_id IS NULL`
**Replace with**:
```sql
SELECT s.location_code FROM slots s
JOIN storage_areas sa ON sa.id = s.storage_area_id
  AND sa.storage_type IN ('wine_fridge', 'kitchen_fridge')
WHERE s.cellar_id = $1 AND s.wine_id IS NULL
ORDER BY s.location_code
```

---

### 4.3 Modified — JS Wine Filter Heuristics (9 files, 11 instances)

These replace `wine.slot_id.startsWith('R')` / `.startsWith('F')` with area-type-map lookups.

**Shared pattern**: Each function that filters wines by type needs access to an `areaTypeMap`.
Most of these are called from `cellarAnalysis.js` or route handlers that already call
`getStorageAreasByType()`. The map is built once and passed down.

#### 4.3.1 `src/services/cellar/cellarAnalysis.js` — Lines 88, 100, 403, 661

**Current**: 4× `slotId.startsWith('R')` to filter cellar wines

**Change**:
- `getStorageAreasByType()` is already called at line 81 → build `areaTypeMap` from it
- Replace each `slotId.startsWith('R')` with:
  ```javascript
  const areaType = areaTypeMap.get(w.storage_area_id);
  return areaType && isCellarType(areaType);
  ```
- Import `{ isCellarType, buildAreaTypeMap }` from `config/storageTypes.js`

**No signature change**: `areasByType` is already in scope; `buildAreaTypeMap()` is called once.

#### 4.3.2 `src/services/cellar/bottleScanner.js` — Line 105

**Current**: `slot.startsWith('R')` to filter cellar wines
**Change**: Accept `areaTypeMap` as 4th parameter to `scanBottles()`:
```javascript
export function scanBottles(wines, zoneMap, storageAreaRows = [], areaTypeMap = null)
```
When `areaTypeMap` is null (backward compat), fall back to `isCellarSlot()` from `slotUtils.js`.
When provided, use `isCellarType(areaTypeMap.get(w.storage_area_id))`.

**Callers**: `cellarAnalysis.js` (already has `areasByType`).

#### 4.3.3 `src/services/cellar/cellarMetrics.js` — Lines 66, 267

**Current**: 2× `slotId.startsWith('R')` to filter cellar wines
**Change**: Accept `areaTypeMap` parameter in `detectScatteredWines()` and
`calculateFragmentationScore()`:
```javascript
export function detectScatteredWines(wines, areaTypeMap = null)
```
Same pattern: when provided, use type lookup; when null, fall back to `isCellarSlot()`.

**Callers**: `cellarAnalysis.js` (has `areasByType`).

#### 4.3.4 `src/services/cellar/fridgeStocking.js` — Lines 631, 659

**Current**: `slot.startsWith('R')` and `slot.startsWith('F')` in `generateCrossAreaSuggestions()`
**Change**: Accept `areaTypeMap` parameter:
```javascript
export function generateCrossAreaSuggestions(wines, fridgeStatus, areaTypeMap = null)
```
Replace:
- `slot.startsWith('R')` → `isCellarType(areaTypeMap?.get(w.storage_area_id)) ?? isCellarSlot(slot)`
- `slot.startsWith('F')` → `isFridgeType(areaTypeMap?.get(w.storage_area_id)) ?? isFridgeSlot(slot)`

**Callers**: `cellarAnalysis.js` (has `areasByType`).

#### 4.3.5 `src/services/wine/drinkingStrategy.js` — Line 60

**Current**: `slotId.startsWith('F')` to skip fridge wines
**Change**: Accept `areaTypeMap` parameter in `getFridgeCandidates()`:
```javascript
export function getFridgeCandidates(wines, currentYear, areaTypeMap = null)
```
Replace: `slotId.startsWith('F')` → `isFridgeType(areaTypeMap?.get(w.storage_area_id)) ?? isFridgeSlot(slotId)`

**Callers**: `cellarHealth.js` (needs to build map from `getStorageAreasByType()`).

#### 4.3.6 `src/services/pairing/pairingEngine.js` — Line 215

**Current**: `slotId.startsWith('F')` for fridge convenience bonus
**Change**: Wine objects from `pairing.js:getAllWinesWithSlots()` do NOT include `storage_area_id`
(unlike `cellar.js`). Two options:

- **Option A (preferred)**: Add `MIN(s.storage_area_id) as storage_area_id` to the pairing query
  (line 282 already does this!) — so `wine.storage_area_id` is available. Accept `areaTypeMap`
  parameter in the scoring function.
- **Option B**: Use `in_fridge` computed column (line 277) which is already in the query result.
  Replace `slotId.startsWith('F')` with `wine.in_fridge == 1`. This requires no parameter change
  and is already computed.

**Recommendation**: Option B — `in_fridge` is already computed and present. But `in_fridge` itself
uses `LIKE 'F%'` (fixed in 4.2.7), so once that SQL is fixed, this JS check can just use
`wine.in_fridge`.

#### 4.3.7 `src/routes/cellarZoneLayout.js` — Line 240

**Current**: `slot?.startsWith('R')` to filter cellar wines for zone chat
**Change**: Build `areaTypeMap` from `getStorageAreasByType(req.cellarId)` and filter using
`isCellarType(areaTypeMap.get(w.storage_area_id))`.

**Note**: `getAllWinesWithSlots()` (from `cellar.js`) already returns `storage_area_id`.

#### 4.3.8 `src/routes/bottles.js` — Lines 102, 154

**Current**: `start_location.startsWith('F')` and `loc.startsWith('R')` for placement logic
**Change**: `storage_area_id` is already in scope (received in request body, resolved at line 90).
Look up its type via a single query or import `resolveStorageAreaId()` (already used in this file):
```javascript
const area = await resolveStorageAreaId(cellarId, storage_area_id);
const isFridge = isFridgeType(area.storage_type);
```

#### 4.3.9 `src/services/acquisitionWorkflow.js` — Lines 448, 450

**Current**: `targetSlot.startsWith('F')` and `F${fridgeNum}` for consecutive fridge slot logic
**Change**: The fridge slot SQL (line 428) is already fixed in 4.2.8 to use storage_type.
Lines 448/450 parse the slot format to compute next consecutive slot — this is **format parsing**
(like `slotUtils.js`), not type classification. Keep `startsWith('F')` here for format branching,
but add a comment clarifying it's format detection, not type detection.

---

### 4.4 Not Modified — `src/services/cellar/slotUtils.js`

**Rationale**: `parseSlot()`, `isCellarSlot()`, `isFridgeSlot()` are format validators. They answer
"does this string look like a cellar/fridge slot code?" not "is this slot in a cellar/fridge area?"
Kept as-is per §2.4.

---

## 5. Risk & Trade-off Register

### Trade-offs

| Trade-off | Rationale |
|-----------|-----------|
| Optional `areaTypeMap` parameter with fallback | Backward compatibility — callers that don't have area context still work via format check. New callers pass the map for correctness. |
| SQL subquery vs JOIN for type filter | Subquery is cleaner when the main query doesn't need other storage_area columns. JOIN when it does. Choose per-instance. |
| Keep `slotUtils.js` format parsers unchanged | They serve a different purpose (format validation vs type classification). Renaming/removing would break 15+ callers with no benefit. |
| `pairingEngine.js` uses `in_fridge` column instead of areaTypeMap | Simpler — no parameter threading needed. The SQL fix (4.2.7) makes the column reliable. |

### What Could Go Wrong

| Risk | Impact | Mitigation |
|------|--------|------------|
| JOIN to `storage_areas` adds latency | LOW — indexed FK, small table (<10 rows) | `storage_areas` is tiny; JOIN cost negligible |
| `areaTypeMap` is null when it shouldn't be | LOW — fallback to `isCellarSlot()` keeps existing behaviour | Explicit fallback in every filter function |
| New storage type not added to sets | MEDIUM — type would be classified as neither fridge nor cellar | Add regression test that all DB enum values appear in exactly one set |
| Test mocks need updating for new parameter | LOW — optional param with default null | Existing tests pass without change |

### Deliberately Deferred

| Item | Why | When |
|------|-----|------|
| Frontend `startsWith` heuristics | Covered in Phase 3 Frontend plan (Features E/F/G-frontend) | Same phase, frontend plan |
| `slotUtils.js` refactor | Format parsers are correct; no value in changing | Never (unless slot format changes) |
| Remove `in_fridge` computed column | Still useful for consumers that don't need full area context | Never |

---

## 6. Testing Strategy

### Unit Tests

| Test File | What It Tests |
|-----------|--------------|
| `tests/unit/config/storageTypes.test.js` | **Create**. `isFridgeType()` for each type; `isCellarType()` for each type; `buildAreaTypeMap()` from mock `areasByType`; verify every known DB enum value is in exactly one set |
| `tests/unit/services/cellar/cellarAnalysis.test.js` | **Modify** (exists). Add case: wine with `storage_area_id` pointing to rack area + `location_code='R20C1'` → classified as cellar (not rejected by format mismatch) |
| `tests/unit/services/cellar/bottleScanner.test.js` | **Modify** (exists). Add case: `scanBottles()` with `areaTypeMap` param filters by type; without param falls back to format |
| `tests/unit/services/cellar/cellarMetrics.test.js` | **Modify** (exists). Add case: `detectScatteredWines()` with `areaTypeMap` skips fridge wines by type |
| `tests/unit/services/cellar/fridgeStocking.test.js` | **Modify** (exists). Add case: `generateCrossAreaSuggestions()` with `areaTypeMap` identifies cellar/fridge wines by type |
| `tests/unit/services/shared/cellarLayoutSettings.test.js` | **Modify** (exists). Verify `countColourFamilies()` no-area path uses type-based SQL (check SQL doesn't contain `LIKE 'R%'`) |

### Regression Test

| Test File | What It Tests |
|-----------|--------------|
| `tests/unit/config/storageTypes.test.js` | Verify `FRIDGE_TYPES ∪ CELLAR_TYPES` covers all values in `createStorageAreaSchema.storage_type` enum — catches new types that aren't classified |

### Grep Audit (Post-Implementation)

```bash
grep -rn "startsWith('R')\|startsWith('F')\|LIKE 'R%'\|LIKE 'F%'" src/ --include="*.js" \
  | grep -v slotUtils.js \
  | grep -v '// format' \
  | grep -v test
```
Target: zero hits on type-classification uses. Format-parsing uses (slotUtils, acquisitionWorkflow
L448/450) are expected and annotated with `// format parsing, not type classification`.

---

## 7. Implementation Order

Each step is independently testable. All steps are backend-only.

1. **`src/config/storageTypes.js`** — new config module + unit tests
2. **SQL fixes — cellarLayoutSettings.js** — replace `LIKE 'R%'` in `countColourFamilies()`
3. **SQL fixes — zone services** — `zoneLayoutProposal.js` (3 instances), `zoneAutoDiscovery.js`
4. **SQL fixes — route queries** — `cellarHealth.js`, `recipes.js`, `pairing.js`, `buyingGuide.js`
5. **SQL fixes — acquisitionWorkflow.js** — fridge slot query (line 428 only)
6. **JS fixes — cellarAnalysis.js** — build `areaTypeMap`, replace 4× `startsWith('R')`
7. **JS fixes — bottleScanner.js** — add `areaTypeMap` parameter
8. **JS fixes — cellarMetrics.js** — add `areaTypeMap` parameter
9. **JS fixes — fridgeStocking.js** — add `areaTypeMap` parameter
10. **JS fixes — drinkingStrategy.js** — add `areaTypeMap` parameter
11. **JS fixes — pairingEngine.js** — use `wine.in_fridge` instead of `startsWith('F')`
12. **JS fixes — cellarZoneLayout.js** — build map, filter by type
13. **JS fixes — bottles.js** — use `resolveStorageAreaId()` type
14. **Annotate — acquisitionWorkflow.js** — comment lines 448/450 as format parsing
15. **Run grep audit** — verify zero unaddressed hits

---

## 8. Files Summary

| File | Action | Step | Instances Fixed |
|------|--------|------|----------------|
| `src/config/storageTypes.js` | **Create** | 1 | N/A (new) |
| `src/services/shared/cellarLayoutSettings.js` | Modify | 2 | 1 SQL |
| `src/services/zone/zoneLayoutProposal.js` | Modify | 3 | 3 SQL |
| `src/services/zone/zoneAutoDiscovery.js` | Modify | 3 | 1 SQL |
| `src/services/cellar/cellarHealth.js` | Modify | 4 | 2 SQL |
| `src/routes/recipes.js` | Modify | 4 | 1 SQL |
| `src/routes/pairing.js` | Modify | 4 | 1 SQL |
| `src/services/recipe/buyingGuide.js` | Modify | 4 | 1 SQL |
| `src/services/acquisitionWorkflow.js` | Modify | 5 + 14 | 1 SQL + 2 annotated |
| `src/services/cellar/cellarAnalysis.js` | Modify | 6 | 4 JS |
| `src/services/cellar/bottleScanner.js` | Modify | 7 | 1 JS |
| `src/services/cellar/cellarMetrics.js` | Modify | 8 | 2 JS |
| `src/services/cellar/fridgeStocking.js` | Modify | 9 | 2 JS |
| `src/services/wine/drinkingStrategy.js` | Modify | 10 | 1 JS |
| `src/services/pairing/pairingEngine.js` | Modify | 11 | 1 JS |
| `src/routes/cellarZoneLayout.js` | Modify | 12 | 1 JS |
| `src/routes/bottles.js` | Modify | 13 | 2 JS |
| `tests/unit/config/storageTypes.test.js` | **Create** | 1 | N/A |
| `tests/unit/services/shared/cellarLayoutSettings.test.js` | Modify | 2 | SQL assertion |
| Various existing test files | Modify | 6-13 | New test cases |

**Total**: 1 new source file, 1 new test file, 14 modified source files, ~6 modified test files.
**Instances addressed**: 9 SQL + 11 JS + 3 annotated (slotUtils kept) = 23 total.

---

## 9. Implementation Log

### Completed: 2026-03-06

All 15 steps implemented successfully. 3469 unit tests passing, zero failures.

### Files Created (2)
| File | Purpose |
|------|---------|
| `src/config/storageTypes.js` | Single source of truth: `FRIDGE_TYPES`, `CELLAR_TYPES`, `isFridgeType`, `isCellarType`, `buildAreaTypeMap`, `isWineInCellar`, `isWineInFridge` |
| `tests/unit/config/storageTypes.test.js` | 28 tests covering all helpers + schema regression guard |

### Files Modified — Source (18)
| File | What Changed |
|------|-------------|
| `src/services/shared/cellarLayoutSettings.js` | `LIKE 'R%'` → `JOIN storage_areas` in `countColourFamilies()` |
| `src/services/zone/zoneLayoutProposal.js` | 3× `LIKE 'R%'` → `JOIN storage_areas` |
| `src/services/zone/zoneAutoDiscovery.js` | `LIKE 'R%'` → `JOIN storage_areas` |
| `src/services/recipe/buyingGuide.js` | `LIKE 'R%'` → `JOIN storage_areas` |
| `src/services/cellar/cellarHealth.js` | 2× `LIKE 'F%'` → `JOIN storage_areas` + type filter |
| `src/routes/recipes.js` | `in_fridge` column via `storage_type` JOIN |
| `src/routes/pairing.js` | `in_fridge` column via `storage_type` JOIN |
| `src/services/acquisitionWorkflow.js` | Fridge slot SQL → `JOIN storage_areas`; lines 448/450 annotated |
| `src/services/cellar/cellarAnalysis.js` | 4× `startsWith('R')` → `isWineInCellar()`; passes `areaTypeMap` to `scanBottles`, `detectScatteredWines`, `detectDuplicatePlacements`, `proposeIdealLayout` |
| `src/services/cellar/bottleScanner.js` | `startsWith('R')` → `isWineInCellar()` with `areaTypeMap` param |
| `src/services/cellar/cellarMetrics.js` | 2× `startsWith('R')` → `isWineInCellar()` with `areaTypeMap` param |
| `src/services/cellar/fridgeStocking.js` | `startsWith('R')` + `startsWith('F')` → `isWineInCellar()` + `isWineInFridge()` |
| `src/services/wine/drinkingStrategy.js` | `startsWith('F')` → `isWineInFridge()` |
| `src/services/pairing/pairingEngine.js` | `startsWith('F')` → `wine.in_fridge` (pre-computed) |
| `src/services/pairing/pairing.js` | `s.zone = 'fridge'` → `LEFT JOIN storage_areas sa_type` + type filter |
| `src/routes/cellarZoneLayout.js` | `startsWith('R')` → `isWineInCellar()` with real `areaTypeMap` |
| `src/routes/bottles.js` | `startsWith('F')` → `isFridgeType()` DB lookup; same-wine query uses `JOIN storage_areas` |
| `src/services/cellar/layoutProposer.js` | `isCellarSlot()` type proxy → `isWineInCellar()` with `areaTypeMap`; passes map to `scanBottles` |

### Files Modified — Caller Wiring (3)
| File | What Changed |
|------|-------------|
| `src/routes/cellarAnalysis.js` | Builds `areaTypeMap` in `runAnalysis()` and `/analyse` handler; passes to `getFridgeCandidates()` and `generateCrossAreaSuggestions()` |
| `src/routes/cellarReconfiguration.js` | Builds `areaTypeMap` for `proposeIdealLayout()` call |
| `src/schemas/storageArea.js` | Exported `STORAGE_TYPES` array for test import |

### Files Modified — Tests (3)
| File | What Changed |
|------|-------------|
| `tests/unit/config/storageTypes.test.js` | Imports `STORAGE_TYPES` from schema (not hardcoded) |
| `tests/unit/services/shared/cellarLayoutSettings.test.js` | Updated SQL assertion: expects `storage_type IN` instead of `LIKE 'R%'` |
| `tests/unit/routes/bottles.test.js` | Updated mock SQL matcher for new JOIN query |

### Post-Audit Fixes (2026-03-06)

Four findings from `/audit-code` were addressed in a follow-up pass:

1. **cellarAnalysis route gaps** — `runAnalysis()` and `/analyse` now build `areaTypeMap` and pass it to `getFridgeCandidates()` and `generateCrossAreaSuggestions()` (were using fallback)
2. **layoutProposer type proxy** — `isCellarSlot()` replaced with `isWineInCellar()`; `areaTypeMap` threaded through `proposeIdealLayout()` → `scanBottles()` → `buildCurrentLayout()`. Callers in `cellarReconfiguration.js` and `cellarZoneLayout.js` build real maps
3. **Legacy pairing fridge classifier** — `s.zone = 'fridge'` in `pairing.js` `scorePairing()` replaced with `LEFT JOIN storage_areas` + `storage_type` filter, matching the hybrid pairing query
4. **Test schema coupling** — `storageTypes.test.js` now imports `STORAGE_TYPES` from `schemas/storageArea.js` instead of hardcoding; new types are caught automatically

### Grep Audit Results

```
startsWith('R'/'F') remaining in src/:
  - slotUtils.js:22        — format parser (kept per §4.4)
  - acquisitionWorkflow.js:452 — format parsing, annotated
  - bottles.js:103         — format fallback with DB type override
  - storageTypes.js:4      — comment only

LIKE 'R%'/'F%' remaining: zero
s.zone = 'fridge' remaining: zero
isCellarSlot() as type proxy: zero
```
