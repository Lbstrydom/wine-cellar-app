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

### 1. Wizard Edit Mode + Row Rebase Safety (High Priority)

**Plan**: [phase3-wizard-edit-mode-and-row-rebase.md](phase3-wizard-edit-mode-and-row-rebase.md)

Two High-severity gaps found in the Phase 3 post-completion audit:

#### Fix A — Row Rebase on Save for Existing Areas

`applyRowOffsets()` skips areas that already have an `id`. When template apply or row deletion
renumbers rows to 1..N in the builder, `persistArea` sends those 1..N rows to
`updateStorageAreaLayout`, which can be rejected by the global row-uniqueness constraint
in multi-area cellars.

**Implementation needed** (see plan §3.1–3.4):

| File | Change |
|------|--------|
| `public/js/storageBuilder.js` | Add `export function rebaseRows(localRows, originalArea)` |
| `public/js/settings.js` | Update `persistArea` to accept `layoutAreaMap` and call `rebaseRows`; build `layoutAreaMap` from `currentLayout.areas` in `handleStorageAreasSave` |

#### Fix B — Add/Remove Area Controls in Wizard Edit Mode

When the wizard re-opens with existing areas, Step 2 has no way to add or remove areas.
Also, `handleStorageAreasSave` has a premature `areas.length === 0` early-exit that prevents
the DELETE loop from running when all areas are removed.

**Implementation needed** (see plan §4.1–4.4):

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Add "Remove This Area" button (guarded by `window.confirm` for existing areas); add "+ Add Another Area" button at bottom of Step 2; update header text in edit vs setup mode |
| `public/js/settings.js` | Remove `areas.length === 0` from early-exit guard |

#### Unit Tests Needed

| Test | File |
|------|------|
| `rebaseRows` — area shrinks (original [20,21,22] → local [1,2] → rebased [20,21]) | `tests/unit/utils/storageBuilder.test.js` |
| `rebaseRows` — area grows (original [20,21] → local [1,2,3] → rebased [20,21,22]) | `tests/unit/utils/storageBuilder.test.js` |
| `rebaseRows` — no change | `tests/unit/utils/storageBuilder.test.js` |
| `rebaseRows` — no original area (returns localRows as-is) | `tests/unit/utils/storageBuilder.test.js` |
| `rebaseRows` — after template apply | `tests/unit/utils/storageBuilder.test.js` |

---

### 2. Test Coverage Gaps (Medium Priority)

These were identified in the §9 audit addendum of `phase3-frontend-cross-area-ux.md`:

| Gap | File | What's Needed |
|-----|------|---------------|
| `storageAreasSettings.test.js` tests the old multi-POST save pattern | `tests/unit/routes/storageAreas.test.js` | Update to reflect the current single-POST model used by `handleStorageAreasSave` |
| No dedicated test for cross-area swap confirmation | New test | Verify `showSwapConfirmDialog` shows "Swap Wines Across Areas?" title + area-prefixed labels when `fromAreaId !== toAreaId` |

---

## Implementation Order

1. `storageBuilder.js` — add `rebaseRows()` export
2. `settings.js` — update `persistArea` + fix early-exit guard + build `layoutAreaMap`
3. `onboarding.js` — add Remove/Add controls to Step 2; update header text
4. `tests/unit/utils/storageBuilder.test.js` — add `rebaseRows` unit tests
5. Test coverage gaps above
6. Manual test: edit + template + delete flow end-to-end (see plan §4 Manual Test Plan)
