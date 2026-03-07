# Code Audit Report: Area-Aware Slot Operations — Fix D

- **Plan**: `docs/plans/area-aware-slot-operations.md` (Phase 2, Fix D)
- **Date**: 2026-03-06
- **Auditor**: Claude
- **Scope**: Fix D — Per-area colour zone designation (white / red / mixed)
- **Prior audits**: Fixes A, B, C all PASS (124/124 tests, 0 findings)

---

## Summary

- **Files Planned**: 7 (1 migration, 3 source, 1 frontend, 2 test)
- **Files Found**: 6 | **Missing**: 1 (frontend colour selector — D.5)
- **HIGH findings**: 1 (fixed during audit)
- **MEDIUM findings**: 1
- **LOW findings**: 2
- **Tests**: 54 passing (13 route + 41 service), 3439/3439 full suite

### Verdict: **CONDITIONAL PASS**

All backend items (D.1–D.4, D.6) are correctly implemented and tested.
One HIGH bug was found and fixed during audit (PUT parameter indexing).
Fix D.5 (frontend UI) is not implemented — backend is ready but users
cannot set `colour_zone` via the UI. This is the only remaining gap.

---

## Findings

### HIGH Severity

#### [H1] Route: PUT /:id WHERE clause off-by-one parameter indices — **FIXED**

- **File**: `src/routes/storageAreas.js` ~L247-248
- **Detail**: After the dynamic SET field loop, `paramIndex` equals N+1 (for N fields).
  `id` is pushed to params at SQL position `$${paramIndex}`, `cellarId` at `$${paramIndex+1}`.
  But the WHERE clause referenced `$${paramIndex+1}` and `$${paramIndex+2}` — off by one.

  With 1 field updated: params = `[value, id, cellarId]` → SQL references `$3` and `$4`,
  but `id` is at `$2` and `cellarId` at `$3`. The missing `$4` causes a PostgreSQL runtime
  error against a real database. Unit tests did not catch this because `db.prepare` was fully
  mocked.

- **Fix applied**:
  ```javascript
  // Before (buggy):
  'WHERE id = $' + (paramIndex + 1) + ' AND cellar_id = $' + (paramIndex + 2),
  // After (correct):
  'WHERE id = $' + paramIndex + ' AND cellar_id = $' + (paramIndex + 1),
  ```

- **Regression tests added**: Two new tests verify correct `$N` indices in the generated SQL
  for single-field and multi-field updates.
- **Principle**: Robustness — parameterized query correctness

---

### MEDIUM Severity

#### [M1] Fix D.5: Frontend colour purpose selector NOT IMPLEMENTED

- **Plan requirement**: Add a "Colour purpose" radio/select field to the storage area
  create/edit form with options: mixed (default), white, red.
- **Evidence**: `grep` for `colour_zone|colour-zone|colorZone|Colour purpose` in `public/**`
  returns zero matches. No frontend JS, HTML, or CSS references exist.
- **Impact**: Backend fully supports `colour_zone` (migration, schema, route, service all
  wired). But the only way to set it is via direct API call — there is no UI. All areas
  default to `'mixed'`, so the feature is inert without the selector.
- **Recommendation**: Implement the frontend selector per plan D.5 spec. This is a
  self-contained UI task: add a radio group to the storage area form, send `colour_zone`
  in the POST/PUT body via the `api/` module.

---

### LOW Severity

#### [L1] Migration number differs from plan (066 vs 040)

- **Plan**: `data/migrations/040_area_scoped_slot_constraint.sql`
- **Actual**: `data/migrations/066_storage_area_colour_zone.sql`
- **Reason**: Slot 040 was taken by `040_producer_crawler.sql` during concurrent development.
  The plan notes this correctly. No functional impact — migration content matches spec exactly.
- **Action**: None needed. Plan already documents the slot change.

#### [L2] `from-template` endpoint does not support `colour_zone` override

- **File**: `src/routes/storageAreas.js` ~L493-499
- **Detail**: The `POST /from-template` body rewrite passes `name`, `storage_type`,
  `temp_zone`, `rows`, `notes` but not `colour_zone`. The `fromTemplateSchema` also does
  not accept it. New areas from templates default to `'mixed'` via the DB default, which is
  a safe default.
- **Impact**: Minimal — templates are for quick setup. Users would set colour_zone via PUT
  after creation (once D.5 UI exists).
- **Action**: Consider adding `colour_zone` passthrough in a future iteration if needed.

---

## Plan Compliance Summary

| Planned Item | Status | Notes |
|-------------|--------|-------|
| D.1 — `data/migrations/066_storage_area_colour_zone.sql` | ✅ Implemented | Column, CHECK constraint, COMMENT all correct. Migration number 066 (not 040). |
| D.2 — `src/schemas/storageArea.js` | ✅ Implemented | `COLOUR_ZONES` constant, create/update schemas with enum. |
| D.3 — `src/services/shared/cellarLayoutSettings.js` | ✅ Implemented | Per-area `getDynamicColourRowRanges()`, area-aware `countColourFamilies()`, legacy fallback, fridge skip. 41 unit tests. |
| D.4 — Row continuity guard in `src/routes/storageAreas.js` | ✅ Implemented | POST handler validates `minNewRow > currentMax`, rejects overlap with descriptive error. 3 guard tests. |
| D.5 — Frontend colour purpose selector | ❌ Not implemented | Zero frontend references to `colour_zone`. Backend ready, UI missing. |
| D.6 — Analysis consumers (no changes needed) | ✅ Verified | All 6 consumers confirmed using same `getDynamicColourRowRanges(cellarId, colourOrder)` interface: `cellarAllocation.js`, `cellarAnalysis.js`, `cellarPlacement.js`, `layoutProposer.js`, `zoneReconfigurationPlanner.js`, `cellarReconfiguration.js`. |
| `tests/unit/routes/storageAreas.test.js` | ✅ Implemented | 13 tests (11 original + 2 added during audit for parameter index verification). |
| `tests/unit/services/shared/cellarLayoutSettings.test.js` | ✅ Implemented | 41 tests covering all edge cases: white/red/mixed areas, multiple areas, reds-top order, fridge skip, null rows, default colour_zone. |

---

## Wiring Verification

| Layer | Component | Status | Notes |
|-------|-----------|--------|-------|
| DB → Service | `getDynamicColourRowRanges` reads `colour_zone` | ✅ Wired | Queries `storage_areas` with `colour_zone` column, handles null as 'mixed' |
| Service → Consumers | 6 callers receive same shape | ✅ Wired | Backward-compatible return shape `{whiteRows, redRows, ...}` |
| Route → Schema | POST/PUT validate `colour_zone` | ✅ Wired | Zod enum validation before handler executes |
| Route → DB | POST inserts, PUT updates `colour_zone` | ✅ Wired | PUT parameter indices corrected during audit |
| Frontend → Route | Colour selector → API call | ❌ Not wired | D.5 not implemented — no frontend UI exists |

---

## Changes Made During Audit

1. **Fixed [H1]**: `src/routes/storageAreas.js` L247-248 — corrected WHERE clause parameter indices from `paramIndex+1`/`paramIndex+2` to `paramIndex`/`paramIndex+1`.
2. **Added 2 regression tests**: `tests/unit/routes/storageAreas.test.js` — "uses correct parameter indices in WHERE clause" and "uses correct parameter indices with multiple fields".

---

## Recommendations

1. **[M1]** Implement Fix D.5 frontend colour selector — self-contained UI task, backend is ready
2. **[L2]** Consider adding `colour_zone` to `fromTemplateSchema` and template body rewrite — low priority, can wait for D.5
