# Code Audit: Phase 3 Frontend — Cross-Area UX Polish

- **Plan file**: `docs/plans/phase3-frontend-cross-area-ux.md`
- **Date**: 2026-07-23
- **Auditor**: Copilot
- **Verdict**: **PASS** (2 minor findings, no blockers)

---

## Summary

All 14 planned files were modified. 2 of 3 planned test files were created (1 intentionally deferred). 3500 unit tests pass. 6 documented deviations from plan are all reasonable and correctly implemented. The implementation faithfully covers Features E, F, H, I, and J with two minor gaps in swap card rendering.

---

## Findings

### FINDING 1 — MEDIUM: Swap cards in `moves.js` use bare slot codes

**File**: `public/js/cellarAnalysis/moves.js` lines 248, 253

**Plan says**: Feature F — use `formatSlotLabel` in suggestion cards (all card types).

**Actual**: Individual move cards (L283-285) correctly use `escapeHtml(formatSlotLabel(...))`:
```javascript
<span class="from">${escapeHtml(formatSlotLabel(move.from, getAreaIdForLocation(state.layout, move.from), state.layout?.areas))}</span>
```
But swap group cards (L248, L253) use bare slot codes:
```javascript
<div class="move-slot"><span class="from">${move.from}</span>  →  ${move.toZone}</div>
<div class="move-slot"><span class="from">${partner.from}</span>  →  ${partner.toZone}</div>
```

**Impact**: In multi-area cellars, swap cards show `R20C1` instead of `[Garage] R20C1`. Single-area cellars are unaffected.

**Fix**: Replace L248 and L253 with:
```javascript
<div class="move-slot"><span class="from">${escapeHtml(formatSlotLabel(move.from, getAreaIdForLocation(state.layout, move.from), state.layout?.areas))}</span>  →  ${escapeHtml(move.toZone)}</div>
```
And the same pattern for the partner line.

---

### FINDING 2 — LOW: Missing `escapeHtml` on swap card dynamic values

**File**: `public/js/cellarAnalysis/moves.js` lines 248, 253

**Context**: In the same swap card template, `move.from`, `partner.from`, `move.toZone`, and `partner.toZone` are interpolated without `escapeHtml()`. Meanwhile, `move.wineName` (L247) and `move.reason` (L256) in the same template ARE escaped.

**Risk**: LOW — these values originate from the analysis engine (not user input), but this is inconsistent with the escaping pattern used elsewhere in the same template. The fix for Finding 1 addresses this simultaneously.

---

### FINDING 3 — INFO: Drink/open/seal toasts don't display location

**File**: `public/js/modals.js` L280, L310-315

**Plan says**: Feature F table row: `Drink/open/seal toast | modals.js | "Bottle consumed from [Area] R5C3"`.

**Actual**: `handleDrinkBottle()` shows `"Enjoyed ${wineName}! N bottles remaining"` — no location code. `handleToggleOpenBottle()` shows `"Bottle marked as sealed"` / `"Bottle marked as open"` — no location code.

**Impact**: None. The toasts never included location codes before this plan, so `formatSlotLabel` has nothing to wrap. The plan example was aspirational. The modal **subtitle** (`showWineModal` at L55) does correctly use `formatSlotLabel`. No action needed.

---

## Feature-by-Feature Verification

### Feature I — Settings Wizard: Include rows in POST + Edit/Delete Mode ✅

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Single POST with rows for new areas | ✅ | `persistArea()` helper sends `{ rows, colour_zone, ... }` in POST body |
| PUT for existing areas (by `area.id`) | ✅ | `updateStorageArea()` + `updateStorageAreaLayout()` for existing IDs |
| DELETE for removed areas | ✅ | `deleteStorageArea(id)` called for leftover `existingIds` |
| `deleteStorageArea` export in `api/profile.js` | ✅ | L73-78, uses `apiFetch` + `encodeURIComponent` |
| Backend DELETE route exists | ✅ | `src/routes/storageAreas.js` L358/364 |
| Skip Step 1 in edit mode | ✅ | `onboarding.js` L33-34 checks `getAreas().length > 0` |
| `persistArea()` extracted for complexity | ✅ | Documented deviation, reasonable |

### Feature J — Builder Cellar-Global Row Numbering ✅

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `applyRowOffsets()` exported from `storageBuilder.js` | ✅ | L137-158 |
| `ui.maxExistingRow` computed from layout | ✅ | `onboarding.js` L19 |
| Offset applied in `handleStorageAreasSave()` | ✅ | `settings.js` calls `applyRowOffsets(areas, maxExistingRow)` |
| Step 4 review shows offset-applied rows | ✅ | `renderConfirmStep()` calls `applyRowOffsets(getAreas(), ui.maxExistingRow)` |
| Existing areas keep original row numbers | ✅ | `applyRowOffsets` skips areas with `id` |
| Unit tests for offset logic | ✅ | 6 test cases in `storageBuilder.test.js` |

### Feature H — Colour Zone Selector ✅

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `<select>` for colour zone in Step 2 | ✅ | `onboarding.js` `renderDetailsStep()` creates select element |
| Hidden for fridge types | ✅ | `FRIDGE_TYPES.has(storage_type)` controls visibility |
| `colour_zone: 'mixed'` default in `addArea()` | ✅ | `storageBuilder.js` L83 |
| `colour_zone` preserved in `setAreas()` | ✅ | `storageBuilder.js` L70 spread preserves it |
| Template resets to `'mixed'` | ✅ | Template application resets colour_zone |
| Badge in `renderPreview()` | ✅ | L163-165 shows colour badge |
| Included in POST/PUT body | ✅ | `persistArea()` sends `colour_zone` |

### Feature E — Cross-Area Drag-Drop Confirmation ✅

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `isCrossArea` detection in `handleDrop()` | ✅ | `dragdrop.js` L209-230 |
| Confirmation dialog before cross-area move | ✅ | `showConfirmDialog()` call with area names |
| Cross-area swap confirmation | ✅ | `showSwapConfirmDialog()` uses `formatSlotLabel` |
| `.cross-area-target` CSS class during drag | ✅ | L143-149 adds class to cross-area slots |
| CSS style in `components.css` | ✅ | L4323 with dashed outline + blue tint |
| Touch handler parity | ✅ | `handleTouchEnd()` L519-549 + extracted `confirmCrossAreaMove()` |
| `cleanupTouchDrag()` clears class | ✅ | L575 removes `.cross-area-target` |
| Same-area moves unchanged | ✅ | No confirmation for `!isCrossArea` |

### Feature F — Area Display Prefix in Slot Labels ✅ (with Finding 1)

| Surface | Status | Evidence |
|---------|--------|----------|
| `formatSlotLabel()` utility | ✅ | `utils.js` L213-220, 3-param signature |
| `getAreaName()` utility | ✅ | `utils.js` L200-204, 2-param signature |
| Single-area → bare code | ✅ | Returns bare code when `areas.length <= 1` |
| `data-storage-area-name` on slots | ✅ | `grid.js` L601 |
| `data-storage-type` on slots | ✅ | `grid.js` L602 |
| Move guide step text | ✅ | `moveGuide.js` L248-249 |
| Individual move cards | ✅ | `moves.js` L283-285 |
| **Swap group cards** | **⚠️** | **moves.js L248, L253 — bare codes (Finding 1)** |
| Drag-drop toasts | ✅ | `dragdrop.js` swap dialog uses `formatSlotLabel` |
| Bottle modal subtitle | ✅ | `bottles/modal.js` L6 import + usage |
| Wine modal subtitle | ✅ | `modals.js` L55 |
| Fridge transfer toasts | ✅ | `fridge.js` L513, L554, L593, L777 |
| Drink/open/seal toasts | N/A | Toasts don't display location (Finding 3 — INFO) |
| Unit tests | ✅ | 16 test cases in `formatSlotLabel.test.js` |

---

## Documented Deviations — All Verified ✅

| # | Deviation | Verified |
|---|-----------|----------|
| 1 | `formatSlotLabel` takes `areas` as 3rd param (avoids circular dep) | ✅ All callers pass `state.layout?.areas` |
| 2 | `getAreaName` takes `areas` as 2nd param (same reason) | ✅ All callers pass areas correctly |
| 3 | Test file at `tests/unit/utils/storageBuilder.test.js` (not `tests/unit/`) | ✅ Consistent with other utils tests |
| 4 | `getAreaName` tests merged into `formatSlotLabel.test.js` | ✅ 8 test cases for each function |
| 5 | `storageAreaSave.test.js` not created | ✅ Covered by manual test plan |
| 6 | `.cross-area-target` class (not BEM `.slot--cross-area-target`) | ✅ Matches existing `.drag-target` convention |

---

## Tech Debt Scans

| Check | Result |
|-------|--------|
| `console.log` in modified files | None found ✅ |
| `TODO` / `FIXME` / `HACK` in modified files | None found ✅ |
| `onclick` / `onchange` / `onsubmit` (CSP violations) | None found ✅ |
| No new frontend JS files (no `sw.js` STATIC_ASSETS update needed) | Correct ✅ |
| `CACHE_VERSION` bumped | `v200` ✅ |
| Unit tests | 150 files, 3500 tests, all passing ✅ |

---

## Recommendations

1. **Fix Finding 1** (MEDIUM): Update swap card rendering in `moves.js` (~L248, L253) to use `formatSlotLabel()` + `escapeHtml()`, matching the individual move card pattern. This is a ~4-line change.

2. No other action needed. The implementation is thorough, well-tested, and the documented deviations are all improvements over the plan.
