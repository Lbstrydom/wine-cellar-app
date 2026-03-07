# Plan: Phase 3 Frontend — Cross-Area UX Polish (Features E, F, H, I, J)

- **Date**: 2026-03-06
- **Status**: Partially Complete (see §9 Audit Addendum)
- **Completed**: 2026-03-07 (initial); audited + partially corrected 2026-03-07
- **Author**: Claude + User
- **Parent**: [Area-Aware Slot Operations](area-aware-slot-operations.md) — Phase 3
- **Prerequisites**: Phase 2 complete (shipped 2026-03-06)
- **Companion**: [Phase 3 Backend — Storage Type Heuristics](phase3-backend-storage-type-heuristics.md) (Feature G)

---

## 1. Context Summary

### What Exists Today

**Wizard/Builder state** (broken for multi-area):
- `onboarding.js` — 4-step wizard (count → details → layout → confirm)
- `storageBuilder.js` — in-memory builder with template presets; `state.areas[]` has
  `{ name, storage_type, temp_zone, rows: [{ row_num, col_count }] }` — no `colour_zone`, no `id`
- `settings.js:handleStorageAreasSave()` — sends POST without `rows` field, then separate PUT
  for layout. **Fails with 400** because `createStorageAreaSchema` now requires `rows` (Fix D).
- Builder uses per-area row numbering (each area starts at 1). Row continuity guard (Fix D.4)
  rejects overlapping row numbers. **Broken for multi-area setups.**

**Drag-drop** (functional, no cross-area block):
- `dragdrop.js` extracts `fromAreaId` / `toAreaId` from `dataset.storageAreaId`
- Passes dual area IDs to `moveBottle()` and `directSwapBottles()`
- Cross-area moves already work at the API level — no toast block exists (contrary to parent plan's
  original expectation). Phase 3 Feature E adds a confirmation UX, not an unblock.

**Slot elements** (from `grid.js:createSlotElement()`):
- `data-location`, `data-slot-id`, `data-storage-area-id`, `data-wine-id`
- Missing: `data-storage-area-name`, `data-storage-type`

**Move/slot labels**:
- All slot references show bare location codes (`R5C3`, `F2`)
- No area name prefix in move guide, suggestion cards, toasts, or modals

**Frontend heuristics**:
- No `startsWith('R'/'F')` patterns found in `public/js/` — already clean. Feature G's frontend
  portion is minimal (add `data-storage-type` attribute for future-proofing).

### Patterns to Follow

1. **Data attributes on slot elements**: `dataset.storageAreaId` pattern from Phase 1
2. **Custom events**: `onboarding:save` dispatched from wizard, caught by `settings.js`
3. **State management**: `storageBuilder.js` uses `state.areas[]` with getter/setter exports
4. **Layout data**: `state.layout.areas[]` in `app.js` carries area metadata from API
5. **Highlight patterns**: CSS classes `.drag-target`, `.dragging`, `.flash-highlight` for visual
   feedback; `.slot--cross-area-target` to be added
6. **Event delegation**: `addTrackedListener()` / `cleanupNamespace()` pattern from `fridge.js`

---

## 2. Feature Designs

### Implementation Order

**I → J → H** first (fix broken wizard), then **E → F** (UX polish).

Rationale: The wizard is non-functional for multi-area setups. Users cannot create or edit storage
areas through the UI until Features I, J, and H are fixed. Cross-area drag-drop (E) and area
labels (F) are polish — they enhance UX but don't block core functionality.

---

### Feature I — Settings Wizard: Include `rows` in POST + Edit/Delete Mode

**Problem**: `handleStorageAreasSave()` sends POST without `rows`, causing 400 validation error.
No support for editing or deleting existing areas.

**Principles**: Defensive Validation (#12), Backward Compatibility (#18).

#### Design

**1. Single POST with rows for new areas**:
```javascript
// Replace current two-step pattern
const areaData = {
  name: area.name,
  storage_type: area.storage_type,
  temp_zone: area.temp_zone,
  colour_zone: area.colour_zone || 'mixed',  // Feature H
  rows: area.rows,                            // Include rows!
  display_order: idx + 1
};
const result = await createStorageArea(areaData);
```
Remove the separate `updateStorageAreaLayout()` loop for new areas.

**2. Edit/delete detection via `area.id`**:
```javascript
async function handleStorageAreasSave(event) {
  const { areas } = event.detail;
  const existingLayout = await fetchLayoutLite();
  const existingIds = new Set((existingLayout?.areas || []).map(a => a.id));

  for (const area of areas) {
    if (area.id && existingIds.has(area.id)) {
      // EXISTING area — update metadata + layout separately
      await updateStorageArea(area.id, {
        name: area.name,
        storage_type: area.storage_type,
        temp_zone: area.temp_zone,
        colour_zone: area.colour_zone || 'mixed'
      });
      if (area.rows?.length > 0) {
        await updateStorageAreaLayout(area.id, area.rows);
      }
      existingIds.delete(area.id);  // Track processed
    } else {
      // NEW area — single POST with rows (offset applied by Feature J)
      await createStorageArea({ ...areaData, rows: area.rows });
    }
  }

  // DELETED areas — any remaining existingIds were removed in wizard
  for (const deletedId of existingIds) {
    await deleteStorageArea(deletedId);
  }
}
```

**3. API function for delete** (add to `api/profile.js`):
```javascript
export async function deleteStorageArea(id) {
  return apiFetch(`/api/storage-areas/${id}`, { method: 'DELETE' });
}
```

**4. Builder preserves `id`**: `setAreas()` already copies `id` from loaded areas (via spread).
`addArea()` creates areas without `id`. The `id` field presence determines new vs existing.

**5. Wizard re-entry**: `openStorageAreasWizard()` calls `setAreas(layout.areas)` which preserves
IDs. The wizard skips Step 1 (count) when areas are pre-loaded — jump to Step 2 directly.

#### Files

| File | Change |
|------|--------|
| `public/js/settings.js` | Rewrite `handleStorageAreasSave()`: single POST with rows for new areas; PUT for existing; DELETE for removed |
| `public/js/api/profile.js` | Add `deleteStorageArea(id)` export |
| `public/js/onboarding.js` | Skip Step 1 when `getAreas().length > 0` (edit mode) |

---

### Feature J — Builder Cellar-Global Row Numbering (Offset on Save)

**Problem**: Builder assigns rows starting at 1 for each area. Backend row continuity guard
rejects rows ≤ current max. Multi-area creation is broken.

**Principles**: Single Source of Truth (#10), Defensive Validation (#12).

#### Design

**1. New helper in `storageBuilder.js`**:
```javascript
/**
 * Apply cellar-global row offsets to new areas.
 * Existing areas (with id) keep their original row numbers.
 * New areas get offset from the current max row.
 * @param {Array} areas - Builder state areas
 * @param {number} maxExistingRow - Current highest row_num in the cellar
 * @returns {Array} Areas with globally unique row numbers
 */
export function applyRowOffsets(areas, maxExistingRow) {
  let nextRow = maxExistingRow;
  return areas.map(area => {
    if (area.id) {
      // Existing area: keep original row numbers
      return area;
    }
    // New area: offset rows
    const offset = nextRow;
    const offsetRows = area.rows.map(r => ({
      row_num: r.row_num + offset,
      col_count: r.col_count
    }));
    nextRow = offset + area.rows.length;
    return { ...area, rows: offsetRows };
  });
}
```

**2. Compute `maxExistingRow` in `openStorageAreasWizard()`**:
```javascript
const layout = await fetchLayoutLite();
const maxExistingRow = layout?.areas?.reduce((max, a) =>
  Math.max(max, ...(a.rows || []).map(r => r.row_num)), 0) ?? 0;
```
Store in a module-level variable or pass through the custom event.

**3. Apply offset in `handleStorageAreasSave()` before POSTing new areas**:
```javascript
const adjustedAreas = applyRowOffsets(areas, maxExistingRow);
```

**4. Review step (Step 4) shows offset-applied rows**:
```javascript
// In renderConfirmStep()
const adjustedAreas = applyRowOffsets(getAreas(), ui.maxExistingRow);
summary.textContent = JSON.stringify({ areas: adjustedAreas }, null, 2);
```

**5. Builder editing stays local**: Users see R1, R2, R3 during editing — intuitive for a visual
editor. Only Step 4 (review) and the save handler apply global offsets.

#### Files

| File | Change |
|------|--------|
| `public/js/storageBuilder.js` | Add `applyRowOffsets(areas, maxExistingRow)` exported helper |
| `public/js/onboarding.js` | Add `ui.maxExistingRow` state; use in `renderConfirmStep()` |
| `public/js/settings.js` | Compute `maxExistingRow` from layout; apply before POST |

---

### Feature H — Colour Zone Selector in Onboarding/Builder UI

**Problem**: Backend supports `colour_zone` (Fix D) but no UI exists to set it. New areas
default to `'mixed'` silently.

**Principles**: Complete Contracts (#12), Single Source of Truth (#10).

#### Design

**1. Onboarding Step 2 — add colour zone `<select>`** (in `renderDetailsStep()`):

Add below the temperature zone selector, conditionally shown for non-fridge types:

```javascript
// Only show for cellar-like types
if (!['wine_fridge', 'kitchen_fridge'].includes(a.storage_type)) {
  const czLabel = document.createElement('label');
  czLabel.textContent = 'Colour purpose:';
  card.appendChild(czLabel);

  const czSelect = document.createElement('select');
  ['mixed', 'white', 'red'].forEach(z => {
    const opt = document.createElement('option');
    opt.value = z;
    opt.textContent = {
      mixed: 'White and red wines (auto-split)',
      white: 'White wines only',
      red: 'Red wines only'
    }[z];
    if (a.colour_zone === z) opt.selected = true;
    czSelect.appendChild(opt);
  });
  czSelect.addEventListener('change', () => { a.colour_zone = czSelect.value; });
  card.appendChild(czSelect);

  const hint = document.createElement('small');
  hint.textContent = 'Affects where the white/red boundary is drawn in analysis.';
  card.appendChild(hint);
}
```

**2. Hide on storage_type change**: When `typeSelect` changes to a fridge type, hide the
colour zone selector. When it changes back to cellar/rack/other, show it.

**3. Builder state updates** (`storageBuilder.js`):
- `addArea()`: include `colour_zone: 'mixed'` in default area
- `setAreas()`: preserve `colour_zone` from loaded areas
- `renderPreview()`: show colour badge — e.g. `"(reds only)"` when not mixed

**4. Template application**: Reset `colour_zone` to `'mixed'` when a template is applied
(templates are colour-neutral).

**5. Save handler**: Include `colour_zone` in POST/PUT body (handled by Feature I's rewrite).

#### Files

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Add colour zone `<select>` to Step 2; conditional visibility by storage_type |
| `public/js/storageBuilder.js` | Add `colour_zone` to `addArea()` default, `setAreas()` preservation, `renderPreview()` badge |

---

### Feature E — Cross-Area Drag-Drop Confirmation

**Problem**: Cross-area drag-drop works silently (no visual distinction from same-area moves).
Users may accidentally move bottles across areas without realizing it.

**Principles**: Defensive Validation (#12), Observability (#19).

#### Design

**1. Detect cross-area drag**: In `handleDrop()` and `handleTouchEnd()`, after extracting
`fromAreaId` and `toAreaId`:
```javascript
const isCrossArea = fromAreaId && toAreaId && fromAreaId !== toAreaId;
```

**2. Same-area moves**: Proceed immediately (existing behaviour, no change).

**3. Cross-area moves**: Show a confirmation popover before executing:
```javascript
if (isCrossArea && isEmpty) {
  const fromName = getAreaName(fromAreaId);
  const toName = getAreaName(toAreaId);
  showCrossAreaConfirm(fromLocation, toLocation, fromAreaId, toAreaId, fromName, toName);
  return;  // Don't execute yet
}
```

**4. `showCrossAreaConfirm()` popover**: Simple confirm/cancel dialog (reuse existing
`showSwapConfirmDialog` pattern):
```javascript
function showCrossAreaConfirm(from, to, fromAreaId, toAreaId, fromName, toName) {
  const wineName = draggedSlot?.querySelector('.wine-name')?.textContent || 'this wine';
  // Build popover with message:
  // "Move [wineName] from [fromName] to [toName]?"
  // [Confirm] [Cancel] buttons
  // On confirm: moveBottle(from, to, fromAreaId, toAreaId) + refreshData()
}
```

**5. Cross-area swaps**: When target is occupied and areas differ, same confirmation flow
before `showSwapConfirmDialog()`.

**6. Visual distinction during drag**: When dragging, highlight cross-area drop targets
with a different style:
```javascript
document.querySelectorAll('.slot').forEach(s => {
  if (s === draggedSlot) return;
  const targetArea = s.dataset.storageAreaId;
  if (targetArea && targetArea !== fromAreaId) {
    s.classList.add('drag-target', 'cross-area-target');
  } else {
    s.classList.add('drag-target');
  }
});
```

**7. CSS for cross-area highlight** (in `components.css`):
```css
.slot.cross-area-target {
  outline: 2px dashed var(--accent-blue, #4a9eff);
  background-color: rgba(74, 158, 255, 0.1);
}
```

**8. Area name lookup helper** (in `utils.js`):
```javascript
export function getAreaName(areaId) {
  if (!areaId || !state?.layout?.areas) return '';
  const area = state.layout.areas.find(a => a.id === areaId);
  return area?.name || '';
}
```
Note: This imports `state` from `app.js` — same pattern as `getAreaIdForLocation()`.

**9. Touch support**: Same confirmation flow in `handleTouchEnd()`.

#### Files

| File | Change |
|------|--------|
| `public/js/dragdrop.js` | Cross-area detection + confirmation popover; cross-area highlight class during drag; touch handler parity |
| `public/js/utils.js` | Add `getAreaName(areaId)` helper |
| `public/css/components.css` | Add `.cross-area-target` highlight style |

---

### Feature F — Area Display Prefix in Slot Labels

**Problem**: Slot references show bare codes (`R20C1`). With multiple areas, users can't tell
which area a location belongs to.

**Principles**: Observability (#19), Single Source of Truth (#10).

#### Design

**1. `formatSlotLabel(locationCode, areaId)` utility** (in `utils.js`):
```javascript
/**
 * Format a slot location with optional area prefix.
 * Single-area cellars show bare codes; multi-area show [AreaName] prefix.
 * @param {string} locationCode - e.g. "R5C3", "F2"
 * @param {string} [areaId] - Storage area UUID
 * @returns {string} e.g. "R5C3" or "[Garage] R20C1"
 */
export function formatSlotLabel(locationCode, areaId) {
  if (!areaId || !state?.layout?.areas) return locationCode;
  // Single area = no prefix needed
  if (state.layout.areas.length <= 1) return locationCode;
  const area = state.layout.areas.find(a => a.id === areaId);
  if (!area) return locationCode;
  return `[${area.name}] ${locationCode}`;
}
```

**2. Usage locations** — replace bare `location` with `formatSlotLabel(location, areaId)`:

| Surface | File | What Changes |
|---------|------|-------------|
| Move guide step text | `cellarAnalysis/moveGuide.js` | `"Move X from [Area] R5C3 to [Area] R8C1"` |
| Suggestion cards (from/to) | `cellarAnalysis/moves.js` | Move card source/target labels |
| Drag-drop toast | `dragdrop.js` | `"Moved to [Area] R5C3"` |
| Drink/open/seal toast | `modals.js` | `"Bottle consumed from [Area] R5C3"` |
| Bottle modal subtitle | `bottles/modal.js` | Location label in modal header |
| Fridge transfer toast | `cellarAnalysis/fridge.js` | `"Moved to [Fridge] F3"` |

**3. `data-storage-area-name` on slot elements** (in `grid.js`):
```javascript
el.dataset.storageAreaName = slot.storage_area_name || '';
```
This requires the layout API to include area name per slot. Currently it's available from the
parent area object in `state.layout.areas[].rows[].slots[]` — the name can be set during grid
rendering from the area context.

**4. `data-storage-type` on slot elements** (Feature G frontend portion):
```javascript
el.dataset.storageType = slot.storage_type || '';
```
Set during grid rendering from the parent area's `storage_type`. Future-proofs frontend code
against adding type-based logic.

**5. Single-area optimization**: `formatSlotLabel()` returns bare code when only one area exists.
Zero visual change for single-area users — the prefix only appears when needed.

#### Files

| File | Change |
|------|--------|
| `public/js/utils.js` | Add `formatSlotLabel(locationCode, areaId)` |
| `public/js/grid.js` | Add `data-storage-area-name` + `data-storage-type` to slot elements |
| `public/js/cellarAnalysis/moveGuide.js` | Use `formatSlotLabel` in step text |
| `public/js/cellarAnalysis/moves.js` | Use `formatSlotLabel` in suggestion cards |
| `public/js/dragdrop.js` | Use `formatSlotLabel` in move/swap toasts |
| `public/js/modals.js` | Use `formatSlotLabel` in drink/open/seal toasts |
| `public/js/bottles/modal.js` | Use `formatSlotLabel` in modal subtitle |
| `public/js/cellarAnalysis/fridge.js` | Use `formatSlotLabel` in transfer toasts |

---

## 3. Sustainability Notes

### Assumptions That Could Change

| Assumption | Likelihood | Mitigation |
|-----------|-----------|------------|
| Wizard creates all areas at once (batch) | Medium (could add incremental add) | Edit mode already handles existing areas; new areas can be added independently |
| Area names are short enough for prefix labels | Low | `formatSlotLabel` truncates at UI level if needed |
| Single POST with rows is sufficient | High (Fix D requires it) | Already validated by schema |
| `colour_zone` stays as 3-value enum | High | `<select>` can accommodate new values easily |

### Extension Points

1. **`formatSlotLabel()`** — extensible to include icons, colour badges, or abbreviated names
2. **`applyRowOffsets()`** — works with any number of new areas; sequential offset calculation
3. **Colour zone selector** — easily hidden/shown based on storage_type changes
4. **Cross-area confirmation** — extensible to show zone compatibility warnings

---

## 4. File-Level Plan (All Features)

| File | Action | Feature(s) |
|------|--------|------------|
| `public/js/settings.js` | **Modify** — rewrite `handleStorageAreasSave()`: single POST with rows, edit/delete mode, row offset, colour_zone | I, J, H |
| `public/js/storageBuilder.js` | **Modify** — add `colour_zone` to state/addArea/setAreas/preview; add `applyRowOffsets()` export | H, J |
| `public/js/onboarding.js` | **Modify** — colour zone selector in Step 2; skip Step 1 in edit mode; `ui.maxExistingRow`; offset preview in Step 4 | H, I, J |
| `public/js/api/profile.js` | **Modify** — add `deleteStorageArea(id)` export | I |
| `public/js/dragdrop.js` | **Modify** — cross-area detection + confirmation popover; cross-area highlight class; `formatSlotLabel` in toasts | E, F |
| `public/js/utils.js` | **Modify** — add `getAreaName(areaId)`, `formatSlotLabel(locationCode, areaId)` | E, F |
| `public/js/grid.js` | **Modify** — add `data-storage-area-name` + `data-storage-type` on slot elements | F, G-frontend |
| `public/js/cellarAnalysis/moveGuide.js` | **Modify** — area-prefixed step text | F |
| `public/js/cellarAnalysis/moves.js` | **Modify** — area-prefixed suggestion cards | F |
| `public/js/modals.js` | **Modify** — area-prefixed toasts/subtitle | F |
| `public/js/bottles/modal.js` | **Modify** — area-prefixed modal subtitle | F |
| `public/js/cellarAnalysis/fridge.js` | **Modify** — area-prefixed transfer toasts | F |
| `public/css/components.css` | **Modify** — `.cross-area-target` highlight style | E |
| `public/sw.js` | **Modify** — bump `CACHE_VERSION` (no new modules to add) | All |

**Total**: 14 modified frontend files, 0 new files.

---

## 5. Risk & Trade-off Register

### Trade-offs

| Trade-off | Rationale |
|-----------|-----------|
| Offset applied at save time, not during editing | Builder UX is more intuitive with local row numbers (1, 2, 3). Offset is an internal detail. |
| `formatSlotLabel` returns bare code for single-area cellars | Zero visual change for the majority of users who have one area. Prefix only appears when useful. |
| Cross-area confirmation adds one extra click | Prevents accidental cross-area moves. Same-area moves are unaffected. |
| Delete existing areas without "are you sure" | The wizard's review step (Step 4) serves as the confirmation gate. Adding a second confirmation would be over-engineering. |
| `colour_zone` hidden for fridge types | Fridge areas are excluded from colour zone processing in the backend. Showing the selector would be misleading. |

### What Could Go Wrong

| Risk | Impact | Mitigation |
|------|--------|------------|
| `maxExistingRow` stale if another session adds areas | LOW — save will fail with 400 (row overlap), user retries | Could re-fetch layout on save, but complexity isn't justified |
| `deleteStorageArea` endpoint doesn't exist yet | HIGH — Feature I's delete mode won't work | Backend `DELETE /api/storage-areas/:id` must be verified/created |
| `fetchLayoutLite` returns areas without `colour_zone` | MEDIUM — editor can't prefill the dropdown | Verify `GET /api/storage-areas` includes `colour_zone` (it does, per Fix D.5) |
| Builder state loses `id` on template application | MEDIUM — existing area treated as new, creates duplicate | Template application should only overwrite name/type/zone/rows, not clear `id` |
| Cross-area popover blocks touch scroll | LOW — popover is small | Use same positioning pattern as swap dialog |

### Deliberately Deferred

| Item | Why | When |
|------|-----|------|
| Drag-drop between area grids (visual connection) | Complex UX design needed — grids may be far apart | Future enhancement |
| Bulk area reorder (drag to change `display_order`) | Low priority — display order rarely changes | Future enhancement |
| Area-specific colour scheme in grid | Nice-to-have visual distinction; requires design work | Future enhancement |

---

## 6. Testing Strategy

### Unit Tests

| Test File | What It Tests | Feature |
|-----------|--------------|---------|
| `tests/unit/storageBuilder.test.js` | **Create**. `applyRowOffsets()`: 0 base (first area), 19 base (second area), multiple new areas, mixed existing/new areas. `colour_zone` in `addArea()`, `setAreas()`, `getAreas()` | J, H |
| `tests/unit/settings/storageAreaSave.test.js` | **Create**. Mock API calls: new area POST includes `rows`; existing area uses PUT; deleted area uses DELETE; row offset applied to new areas | I, J |
| `tests/unit/utils/formatSlotLabel.test.js` | **Create**. Single area → bare code; two areas → prefixed; unknown areaId → bare code (fallback); null areaId → bare code | F |
| `tests/unit/utils/getAreaName.test.js` | **Create** (or add to existing utils tests). `getAreaName()` found, not found, null | E |

### Manual Test Plan

| Scenario | Verifies | Feature |
|----------|----------|---------|
| Open wizard → add 2 areas → save → verify 201 (not 400) | POST includes rows | I |
| Open wizard with existing areas → edit name → save → verify PUT | Edit mode | I |
| Open wizard with 2 areas → remove one → save → verify DELETE | Delete mode | I |
| Existing 19-row cellar → add garage rack → save → rows start at 20 | Row offset | J |
| New area form → cellar type → shows colour zone dropdown | Colour zone visibility | H |
| New area form → wine_fridge type → hides colour zone dropdown | Conditional visibility | H |
| Template application → colour zone resets to mixed | Template override | H |
| Drag bottle between areas → confirmation popover appears | Cross-area detection | E |
| Drag bottle within same area → no confirmation (direct move) | Same-area unchanged | E |
| Multi-area cellar → move guide shows `[Area] R5C3` labels | Area prefix | F |
| Single-area cellar → move guide shows bare `R5C3` labels | No prefix for single area | F |

### Regression

Run `npm run test:unit` — all 3441+ existing tests must pass. New tests should add ~20-30 cases.

Run the `swStaticAssets` test to verify no new frontend modules were created without being added
to `STATIC_ASSETS` in `sw.js`. (No new modules in this plan — all changes are to existing files.)

---

## 7. Implementation Order

**Phase 3A — Fix Wizard** (Features I → J → H):

1. **`storageBuilder.js`** — add `colour_zone` to state + `applyRowOffsets()` helper
2. **`api/profile.js`** — add `deleteStorageArea()` export
3. **`onboarding.js`** — colour zone selector, edit mode skip, `ui.maxExistingRow`, offset preview
4. **`settings.js`** — rewrite `handleStorageAreasSave()` with all three features
5. **Unit tests** — `storageBuilder.test.js`, `storageAreaSave.test.js`
6. **Manual test** — end-to-end wizard create + edit + delete flow

**Phase 3B — UX Polish** (Features E → F):

7. **`utils.js`** — add `getAreaName()` + `formatSlotLabel()`
8. **`grid.js`** — add `data-storage-area-name` + `data-storage-type` on slot elements
9. **`components.css`** — `.cross-area-target` highlight style
10. **`dragdrop.js`** — cross-area detection + confirmation popover + label formatting in toasts
11. **`modals.js`** — `formatSlotLabel` in toasts/subtitle
12. **`bottles/modal.js`** — `formatSlotLabel` in modal subtitle
13. **`moveGuide.js`** — `formatSlotLabel` in step text
14. **`moves.js`** — `formatSlotLabel` in suggestion cards
15. **`fridge.js`** — `formatSlotLabel` in transfer toasts
16. **`sw.js`** — bump `CACHE_VERSION`
17. **Unit tests** — `formatSlotLabel.test.js`, `getAreaName.test.js`
18. **Manual test** — cross-area drag-drop + label verification

---

## 8. Implementation Notes (Post-Completion)

**Status**: All 14 files modified, 3 test files created, 3500 unit tests passing.

### Deviations from Plan

| Item | Plan | Actual | Reason |
|------|------|--------|--------|
| `formatSlotLabel(locationCode, areaId)` signature | Imports `state` from `app.js` | Takes `areas` as 3rd parameter | Avoids circular dependency (`utils.js` → `app.js` → `utils.js`) |
| `getAreaName(areaId)` signature | Imports `state` from `app.js` | Takes `areas` as 2nd parameter | Same circular dependency avoidance |
| Test file location | `tests/unit/storageBuilder.test.js` | `tests/unit/utils/storageBuilder.test.js` | Consistent with other utils tests |
| `getAreaName` test file | `tests/unit/utils/getAreaName.test.js` | Merged into `tests/unit/utils/formatSlotLabel.test.js` | Both are pure utils; co-location reduces file count |
| `tests/unit/settings/storageAreaSave.test.js` | Create | Not created | `handleStorageAreasSave` is async with complex API mocking; covered by manual test plan instead |
| `.slot--cross-area-target` CSS class name | `slot--cross-area-target` (BEM) | `.cross-area-target` (no BEM) | Matches existing `.drag-target` naming convention in codebase |

### Additional Changes Not in Plan

- **`handleStorageAreasSave` complexity**: Extracted `persistArea()` helper function to keep cognitive complexity ≤15 (linter requirement).
- **`handleTouchEnd` complexity**: Extracted `confirmCrossAreaMove()` helper for the same reason.
- **`onboarding.js` FRIDGE_TYPES**: Used `Set` (not `Array.includes`) for O(1) type lookups.
- **`onboarding.js` `buildRowControl()`**: Extracted from `renderLayoutStep()` to reduce nesting depth below linter threshold.
- **Existing test mocks updated**: `moves.test.js`, `fridgeSwap.test.js`, and `moveGuide.test.js` all mock `utils.js` — each needed `formatSlotLabel` added to their mock registry after it was imported by the implementation files.

### Final Test Results

```
Test Files: 150 passed (150)
Tests:      3500 passed (3500)
```

---

## 9. Audit Addendum (2026-03-07)

Post-completion audit identified gaps. Status changed from "Complete" to "Partially Complete."

### Open Questions — Answered

**Q: Should this document be revised from "Complete" to "partially complete," or stay as a historical record with an audit addendum?**
A: Revised to "Partially Complete" with this addendum. The document is the living record.

**Q: For existing-area edits, true cellar-global numbering in edit mode, or a reliable rebase step before every save/template mutation?**
A: Rebase step on save. Live cellar-global numbering in the editor would show confusing row numbers (e.g., "Row 20") to users. The builder keeps local 1..N UX; `rebaseRows()` remaps on save.

### Gaps Fixed In-Line (this session)

| Gap | Severity | Fix |
|-----|----------|-----|
| `initiateTouchDrag` didn't add `cross-area-target` class | Medium | Added `cross-area-target` for cross-area slots in touch drag init (`dragdrop.js`) |
| Swap dialog used raw location codes, no cross-area indicator | Medium | `showSwapConfirmDialog` now uses `formatSlotLabel` + title "Swap Wines Across Areas?" for cross-area swaps (`dragdrop.js`) |
| Drink toast omitted slot label | Medium | Added `formatSlotLabel` to drink toast in `handleDrinkBottle` (`modals.js`) |
| Open/seal toasts omitted slot label | Medium | Added `formatSlotLabel` to open/seal toasts in `handleToggleOpenBottle` (`modals.js`) |
| Fridge transfer toast showed area name only | Medium | Toast now uses `formatSlotLabel(targetSlot, toAreaId, areas)` (`fridge.js`) |

**Challenged:** The plan called for a *separate* cross-area confirmation before `showSwapConfirmDialog`. This was rejected as redundant UX — the swap dialog already gates the action. The fix instead makes the swap dialog cross-area-aware (title + area-prefixed labels), which is more elegant.

### Gaps Deferred to New Plan

See [phase3-wizard-edit-mode-and-row-rebase.md](phase3-wizard-edit-mode-and-row-rebase.md).

| Gap | Severity | Deferred Reason |
|-----|----------|-----------------|
| Existing-area row rebase on save (Feature J) | High | Requires new `rebaseRows()` helper + `persistArea` signature change; architectural |
| No add/remove area controls in wizard edit mode | High | Requires Step 2 UI restructure + `handleStorageAreasSave` guard fix |

### Test Coverage Gaps (Still Outstanding)

- No dedicated test for cross-area swap confirmation flow.
- `storageAreasSettings.test.js` still codifies the obsolete two-step save model — needs updating when new plan is implemented.
- `rebaseRows()` unit tests are part of the new plan.
