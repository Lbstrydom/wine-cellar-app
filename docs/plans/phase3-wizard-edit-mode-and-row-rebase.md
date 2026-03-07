# Plan: Phase 3 Completion — Wizard Edit Mode + Row Rebase Safety

- **Date**: 2026-03-07
- **Status**: Draft
- **Author**: Claude + User
- **Parent**: [Phase 3 Frontend — Cross-Area UX Polish](phase3-frontend-cross-area-ux.md)
- **Triggered by**: Post-completion audit (2026-03-07)

---

## 1. Problem Statement

Two **High**-severity gaps were found in the Phase 3 audit:

### Gap A — Feature J: Existing-Area Row Numbers Are Not Rebased on Save

`applyRowOffsets()` only offsets areas **without** an `id`. Areas *with* an `id` are returned as-is.
But the UI rewrites row numbers to local 1..N in two places for existing areas:

1. **Template apply** (`onboarding.js:174`): `a.rows = normalized.rows.map(r => ({ row_num: r.row_num, ... }))` — templates always start at row 1.
2. **Row deletion** (`onboarding.js:219`): `.map((x, i) => ({ row_num: i + 1, ... }))` — re-numbers from 1.

When `persistArea` then calls `updateStorageAreaLayout(area.id, area.rows)` with those 1..N rows,
the backend's global row-uniqueness constraint rejects them if rows 1..N are already occupied by
another area. **This can silently corrupt or block saves for multi-area cellars.**

### Gap B — Edit/Delete Mode: No Add/Remove Area Controls in Wizard

The plan described "edit/delete mode" as implemented, but:

- The count step (Step 1) is skipped on re-entry — no replacement UI for adding/removing areas.
- `renderDetailsStep()` only edits metadata of already-loaded areas.
- There is no "Remove Area" button on existing area cards.
- There is no "Add Another Area" button in edit mode.
- `handleStorageAreasSave()` exits early when `areas.length === 0` — so even if the user somehow
  removed all areas, the DELETE calls never fire.

---

## 2. Out of Scope

- Changing the builder's local row numbering during editing (1, 2, 3... stays — it's intuitive UX).
- Bulk area reorder (drag to change `display_order`) — deferred in original plan.
- Comprehensive wizard tests (`storageAreaSave.test.js`) — covered by this plan's manual test section.

---

## 3. Design

### Fix A — Row Rebase on Save for Existing Areas

**Goal**: When `persistArea` processes an existing area, remap its 1..N rows to the area's
original global row range before calling `updateStorageAreaLayout`.

**Approach**: Pass the `currentLayout.areas` (fetched once in `handleStorageAreasSave`) into
`persistArea`. Compute the area's original `minRow` from the layout data. Remap `area.rows`.

#### 3.1 Updated `persistArea` signature

```javascript
// settings.js
async function persistArea(area, displayOrder, existingIds, layoutAreaMap) {
  if (area.id && existingIds.has(area.id)) {
    // Remap rows to original global range
    const original = layoutAreaMap.get(area.id);
    const rows = rebaseRows(area.rows, original);
    await updateStorageArea(area.id, {
      name: area.name,
      storage_type: area.storage_type,
      temp_zone: area.temp_zone,
      colour_zone: area.colour_zone || 'mixed',
      display_order: displayOrder
    });
    if (rows.length > 0) {
      await updateStorageAreaLayout(area.id, rows);
    }
    existingIds.delete(area.id);
    return 'updated';
  }
  // NEW area — rows already offset by applyRowOffsets()
  const result = await createStorageArea({ ...buildMetadata(area, displayOrder), rows: area.rows });
  if (!(result.data?.id || result.id)) {
    throw new Error(`Failed to create area: ${area.name}`);
  }
  return 'created';
}
```

#### 3.2 `rebaseRows(localRows, originalArea)` helper

```javascript
/**
 * Remap locally-numbered rows (1..N) back to the area's original global row range.
 * If the original area has rows [20, 21, 22] and the editor produced [1, 2] (one deleted),
 * the result is [20, 21] — preserving the global base and column counts from the edit.
 *
 * Strategy: sort both sides, map index → original row number.
 * If the user added MORE rows than the original had (via "Add Row"), allocate sequentially
 * after the area's original max row.
 *
 * @param {Array<{row_num, col_count}>} localRows - Locally-numbered rows from the editor
 * @param {Object|undefined} originalArea - Area object from currentLayout (may be undefined for new areas)
 * @returns {Array<{row_num, col_count}>} Rows with corrected global row numbers
 */
export function rebaseRows(localRows, originalArea) {
  if (!originalArea?.rows?.length) {
    // No original row data — keep as-is (new area or no rows)
    return localRows;
  }

  const originalNums = originalArea.rows.map(r => r.row_num).sort((a, b) => a - b);
  const maxOriginal = originalNums[originalNums.length - 1];

  return localRows
    .sort((a, b) => a.row_num - b.row_num)
    .map((r, i) => ({
      row_num: i < originalNums.length ? originalNums[i] : maxOriginal + (i - originalNums.length + 1),
      col_count: r.col_count
    }));
}
```

**Key properties**:
- Existing rows keep their original global row numbers in order.
- If the user deleted rows: the area shrinks from the top of its range (first rows are reused, last are dropped).
- If the user added rows beyond the original count: they are allocated after `maxOriginal`, which is safe as long as no other area starts immediately after. This is an edge case — the backend will reject with 409 if overlap occurs, giving a clear error.

#### 3.3 Build `layoutAreaMap` in `handleStorageAreasSave`

```javascript
const layoutAreaMap = new Map(existingAreas.map(a => [a.id, a]));
// Pass to persistArea calls:
const outcome = await persistArea(adjustedAreas[idx], idx + 1, remainingIds, layoutAreaMap);
```

#### 3.4 Export `rebaseRows` from `storageBuilder.js`

`rebaseRows` is a pure transformation — add it to `storageBuilder.js` alongside `applyRowOffsets`.

#### Files

| File | Change |
|------|--------|
| `public/js/storageBuilder.js` | Add `export function rebaseRows(localRows, originalArea)` |
| `public/js/settings.js` | Update `persistArea(area, displayOrder, existingIds, layoutAreaMap)` to call `rebaseRows`; build `layoutAreaMap` in `handleStorageAreasSave` |

---

### Fix B — Add/Remove Area Controls in Wizard Edit Mode

**Goal**: When the wizard opens with existing areas, Step 2 (Details) must allow:
1. Removing an existing area (marks it for deletion).
2. Adding a new area.

**Approach**: Step 2 shows a "Remove" button on each existing area card and an "Add Area" button
at the bottom. The wizard state already distinguishes new vs existing areas via `area.id`.

#### 4.1 "Remove Area" button on each card in `renderDetailsStep()`

```javascript
// Only show remove button when more than one area remains
if (areas.length > 1) {
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove This Area';
  removeBtn.className = 'btn-danger-small';
  removeBtn.addEventListener('click', () => {
    // Confirm before removing existing (persisted) areas
    if (a.id) {
      const ok = window.confirm(`Remove "${a.name}"? This will delete all its slots.`);
      if (!ok) return;
    }
    const updated = getAreas().filter(x => x !== a);
    setAreas(updated);
    renderStep();
  });
  card.appendChild(removeBtn);
}
```

Note: `window.confirm` is acceptable here as a low-cost guard for a destructive action. The
wizard's Step 4 review is the final confirmation gate before any DELETE hits the API.

#### 4.2 "Add Area" button at bottom of Step 2

```javascript
const addBtn = document.createElement('button');
addBtn.textContent = '+ Add Another Area';
addBtn.addEventListener('click', () => {
  addArea({ name: `Area ${getAreas().length + 1}`, storage_type: 'cellar', temp_zone: 'cellar' });
  renderStep(); // Re-render Step 2 with the new card appended
});
ui.container.appendChild(addBtn);
```

`addArea()` already creates areas without an `id`, so new additions will correctly be POSTed
(not PUT) by `persistArea`.

#### 4.3 Fix `handleStorageAreasSave` early-exit guard

```javascript
// Replace:
if (!Array.isArray(areas) || areas.length === 0) {
  showToast('No areas to save');
  return;
}

// With:
if (!Array.isArray(areas)) {
  showToast('No areas to save');
  return;
}
// areas.length === 0 is valid when the user deleted all areas — the DELETE loop handles it.
```

#### 4.4 Wizard header clarification

Update the Step 2 header to show "Edit Storage Areas" when `hasExistingAreas`:

```javascript
// In renderStep():
const isEdit = getAreas().some(a => a.id);
header.textContent = isEdit
  ? `Edit Storage Areas (Step ${ui.step}/4)`
  : `Setup Storage Areas (Step ${ui.step}/4)`;
```

#### Files

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Add "Remove Area" button to each card in `renderDetailsStep()`; add "Add Area" button at bottom; update header text for edit mode |
| `public/js/settings.js` | Remove `areas.length === 0` early-exit guard |

---

## 4. Testing Strategy

### Unit Tests

| Test | File | What It Tests |
|------|------|---------------|
| `rebaseRows` — area shrinks | `storageBuilder.test.js` | Original [20,21,22] → user deletes 1 → local [1,2] → rebased [20,21] |
| `rebaseRows` — area grows | `storageBuilder.test.js` | Original [20,21] → user adds row → local [1,2,3] → rebased [20,21,22] |
| `rebaseRows` — no change | `storageBuilder.test.js` | Original [20,21,22] → local [1,2,3] → rebased [20,21,22] |
| `rebaseRows` — no original | `storageBuilder.test.js` | `originalArea = undefined` → returns localRows unchanged |
| `rebaseRows` — template apply | `storageBuilder.test.js` | After template apply, rows 1..N are rebased to original global range |

### Manual Test Plan

| Scenario | Verifies | Feature |
|----------|----------|---------|
| Existing 19-row area → apply template → save → rows remain 1-19 in DB (not 1-N of template) | Row rebase on template apply | Fix A |
| Existing 5-row area → delete 2 rows → save → remaining 3 rows keep original row numbers | Row rebase on row deletion | Fix A |
| Existing 3-row area → add 2 rows → save → 5 rows: first 3 keep original, last 2 are max+1, max+2 | Row extension | Fix A |
| Open wizard with 2 areas → Remove one → save → 1 area remains, other deleted | Remove area | Fix B |
| Open wizard with 2 areas → Remove both → should be blocked (remove button hidden at 1 area) | Guard: can't remove last area | Fix B |
| Open wizard with existing areas → Add Area → new area POSTed, existing PUTed | Add area in edit mode | Fix B |
| Wizard with 0 areas in state (all removed) → should now reach DELETE loop | Early-exit bug fix | Fix B |

---

## 5. Risk & Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| `rebaseRows` row extension conflicts with adjacent area | LOW — rare edge case; backend returns 409 | Clear error message; user retries after checking layout |
| Row ordering: user adds row at "top" in UI but gets bottom global number | LOW — row_num is opaque to users (they see "Row 1, Row 2") | Acceptable; area layout is maintained correctly |
| Remove button shows `window.confirm` | LOW — acceptable for this low-frequency action | Could be replaced with inline toast-style confirmation if design changes |
| Backend DELETE storage-area must cascade-delete slots | HIGH — must be verified | `deleteStorageArea` endpoint exists; verify CASCADE in DB schema |

---

## 6. Implementation Order

1. `storageBuilder.js` — add `rebaseRows()` export
2. `settings.js` — update `persistArea` to use `rebaseRows`; fix early-exit guard; build `layoutAreaMap`
3. `onboarding.js` — add Remove/Add controls to Step 2; fix header text
4. Unit tests — `storageBuilder.test.js` (rebaseRows cases)
5. Manual test — edit + template + delete flow end-to-end
