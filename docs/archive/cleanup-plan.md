# Plan: Multi-Storage Area — Cleanup & Remaining Work

- **Date**: 2026-03-07
- **Status**: Active
- **Author**: Claude + User
- **Purpose**: Consolidated tracker for outstanding work after Phase 1–3 delivery

---

## What Has Been Shipped

| Plan | Status |
|------|--------|
| [multi-storage-area-architecture.md](../archive/multi-storage-area-architecture.md) | ✅ Fully delivered (all phases defined, Phase 0–3 shipped) |
| [area-aware-slot-operations.md](../archive/area-aware-slot-operations.md) | ✅ Phase 1 + Phase 2 (Fixes A/B/C/D) fully shipped |
| [area-aware-slot-operations-frontend.md](../archive/area-aware-slot-operations-frontend.md) | ✅ `getAreaIdForLocation()` threaded through moves/moveGuide/fridge |
| [phase3-backend-storage-type-heuristics.md](../archive/phase3-backend-storage-type-heuristics.md) | ✅ Storage type config, heuristics, colour-zone migration — all shipped |
| [phase3-frontend-cross-area-ux.md](../archive/phase3-frontend-cross-area-ux.md) | ✅ Features A–J (minus 2 High gaps) shipped; audit addendum in §9 |

---

## Remaining Work

### 1. Wizard Edit Mode + Stable Row Identity (High Priority)

**Plan**: [phase3-wizard-edit-mode-and-row-rebase.md](phase3-wizard-edit-mode-and-row-rebase.md)

Two High-severity gaps found in the Phase 3 post-completion audit, expanded to full layout/slot
reconciliation after the third GPT-5.4 review (plan v4):

#### Fix A — Stable Row Identity (Preserve `row_num` Through Editing)

The wizard destroys global `row_num` identity during row deletion (renumbers survivors to 1..N)
and template apply (overwrites with template's 1..N). Since `row_num` is the physical join key
between `storage_area_rows` and `slots`, this silently breaks the grid layout.

**Approach**: Preserve original global `row_num` on each row throughout the editing session.
Never renumber to 1..N. Display labels use array index ("Row 1", "Row 2").

**Implementation needed** (see plan §3.1–3.4):

| File | Change |
|------|--------|
| `public/js/storageBuilder.js` | Remove renumbering line from `removeRow()` |
| `public/js/onboarding.js` | Remove renumbering from delete handler; add last-row guard (hide delete when `rows.length === 1`); remap template rows with `baseRow + i` for existing areas; pass `displayIndex` to `buildRowControl` |

#### Fix B — Add/Remove Area Controls in Wizard Edit Mode

When the wizard re-opens with existing areas, Step 2 has no way to add or remove areas.

**Implementation needed** (see plan §4.1–4.4):

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Add "Remove This Area" button (guarded by `window.confirm` for existing areas, `areas.length > 1` guard); add "+ Add Another Area" button; update header text in edit vs setup mode |
| `public/js/settings.js` | Add 409 error handling + `deletedCount` tracking + accurate toast in DELETE loop; keep wizard open on errors |

#### Fix C — Full Layout/Slot Reconciliation (v4)

The grid renders from **slot records** (`stats.js`, `grid.js`), NOT from `storage_area_rows`.
Layout changes (POST, PUT /layout, DELETE) updated `storage_area_rows` but never provisioned
or cleaned up slot records — making new rows/columns invisible and leaving orphaned slots on
shrink. Additionally, none of the mutation routes used transactions.

**Implementation needed** (see plan §3.5–3.8):

| File | Change |
|------|--------|
| `src/services/cellar/slotReconciliation.js` | **NEW**: `syncStorageAreaSlots()` (coordinate diff → insert/delete) + `resequenceFridgeSlots()` (two-pass contiguous F1..Fn) |
| `src/routes/storageAreas.js` | Wrap POST, PUT /layout, DELETE in `db.transaction()` + `wrapClient()`; call `syncStorageAreaSlots()` + `resequenceFridgeSlots()` within transactions |
| `src/routes/cellar.js` | Fix `getEmptyFridgeSlots()` sort: both area-scoped (`row_num, col_num`) and cross-cellar fallback (`display_order, row_num, col_num` via JOIN) |
| `src/services/acquisitionWorkflow.js` | Fix fridge slot lookup sort: `display_order, row_num, col_num` |
| `src/services/cellar/cellarHealth.js` | Fix `executeFillFridge()` fridge slot sort: `display_order, row_num, col_num` |
| `src/routes/bottles.js` | Include `kitchen_fridge` in `getGridLimits()` fridge capacity |

#### Unit Tests Needed

| Test | File |
|------|------|
| Row deletion preserves identity (via `setAreas`/`getAreas`) | `tests/unit/utils/storageBuilder.test.js` |
| Last-row guard prevents zero-row area (UI guard: delete button hidden) | `tests/unit/utils/onboarding.test.js` (or DOM-capable storageBuilder test) |
| First/last row deletion preserves remaining rows | `tests/unit/utils/storageBuilder.test.js` |
| `addRow` after gap appends `at(-1) + 1` | `tests/unit/utils/storageBuilder.test.js` |
| `syncStorageAreaSlots` provisions/cleans slots | `tests/unit/services/cellar/slotReconciliation.test.js` |
| `resequenceFridgeSlots` contiguous numbering | `tests/unit/services/cellar/slotReconciliation.test.js` |
| POST/PUT/DELETE route slot reconciliation | `tests/unit/routes/storageAreas.test.js` |
| Consumer fixes (fridge order, grid limits) | Various test files |

---

### 2. Test Coverage Gaps (Medium Priority)

These were identified in the §9 audit addendum of `phase3-frontend-cross-area-ux.md`:

| Gap | File | What's Needed |
|-----|------|---------------|
| `storageAreasSettings.test.js` tests the old multi-POST save pattern | `tests/unit/routes/storageAreas.test.js` | Update to reflect the current single-POST model used by `handleStorageAreasSave` |
| No dedicated test for cross-area swap confirmation | New test | Verify `showSwapConfirmDialog` shows "Swap Wines Across Areas?" title + area-prefixed labels when `fromAreaId !== toAreaId` |

---

## Implementation Order

### Phase I — Backend Slot Reconciliation (Fix C)
1. `slotReconciliation.js` — NEW: `syncStorageAreaSlots()` + `resequenceFridgeSlots()`
2. `storageAreas.js` — wrap POST/PUT/DELETE using `db.transaction()` + `wrapClient()`; call reconciliation helpers
3. Consumer fixes: `cellar.js` (sort order — both branches), `acquisitionWorkflow.js` (sort order), `cellarHealth.js` (sort order), `bottles.js` (kitchen_fridge)
4. Unit + route tests for reconciliation and consumer fixes

### Phase II — Frontend Stable Row Identity (Fix A)
5. `storageBuilder.js` — remove renumbering line from `removeRow()`
6. `onboarding.js` — remove renumbering + last-row guard + template remap + display labels
7. `tests/unit/utils/storageBuilder.test.js` — row identity preservation tests

### Phase III — Frontend Add/Remove Areas (Fix B)
8. `onboarding.js` — add Remove/Add area controls to Step 2; update header
9. `settings.js` — add 409 error handling + `deletedCount` tracking + accurate toast
10. Test coverage gaps below
11. Manual test: edit + template + delete + slot provisioning flow end-to-end
