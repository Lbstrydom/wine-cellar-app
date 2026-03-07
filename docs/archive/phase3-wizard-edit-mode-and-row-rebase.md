# Plan: Phase 3 Completion — Wizard Edit Mode + Stable Row Identity

- **Date**: 2026-03-07
- **Status**: Complete
- **Author**: Claude + User
- **Parent**: [Phase 3 Frontend — Cross-Area UX Polish](../archive/phase3-frontend-cross-area-ux.md)
- **Triggered by**: Post-completion audit (2026-03-07)
- **Validated**: 2026-03-07 (both gaps confirmed against code + backend routes)
- **Revised**: 2026-03-07 (v2–v6: five GPT-5.4 external review cycles — see §6 Revision History)

---

## 1. Problem Statement

Two **High**-severity gaps were found in the Phase 3 audit:

### Gap A — Feature J: Existing-Area Row Numbers Are Destroyed During Editing

The wizard destroys global `row_num` identity in two places:

1. **Row deletion** (`onboarding.js:219`): `.map((x, i) => ({ row_num: i + 1, col_count: x.col_count }))` — renumbers survivors to 1..N.
2. **`removeRow()` in storageBuilder** (`storageBuilder.js:115`): Same pattern — `area.rows.map((r, i) => ({ row_num: i + 1, ... }))`.
3. **Template apply** (`onboarding.js:174`): `a.rows = normalized.rows.map(r => ({ row_num: r.row_num, ... }))` — templates always start at row 1.

**Why this is critical**: `row_num` is the physical join key between `storage_area_rows` and
`slots`. The `stats.js` layout endpoint (L235-240) joins via:

```javascript
rowKeyMap.set(`${area.id}:${row.row_num}`, row);
// ...
const rowKey = `${s.storage_area_id}:${s.row_num}`;
const row = rowKeyMap.get(rowKey);
if (!row) continue;  // ← Slot SILENTLY DROPPED if row_num doesn't match
```

If `persistArea` sends rows with destroyed row_nums (e.g., local 1..N instead of original
5..7), the backend `PUT /layout` replaces `storage_area_rows` but does NOT update `slots.row_num`.
Existing slot records still reference the original row_nums → the join breaks → **slots silently
vanish from the grid** despite still existing in the database.

Additionally, the backend's row-overlap guard (`storageAreas.js:283-291`) rejects rows with
**400** if the local 1..N numbers collide with another area's rows:

```javascript
const otherRowSet = new Set(otherAreaRows.map(r => r.row_num));
const overlapping = newRowNums.filter(rn => otherRowSet.has(rn));
if (overlapping.length > 0) {
  return res.status(400).json({ error: `Row numbers overlap...` });
}
```

**What already works**: `setAreas()` at wizard entry preserves original row numbers
(`r.row_num ?? idx + 1`). `addRow` in Step 3 also preserves global numbering
(`a.rows.at(-1)?.row_num + 1`). The bug only manifests on **template apply** and **row deletion**.

### Gap B — Edit/Delete Mode: No Add/Remove Area Controls in Wizard

The plan described "edit/delete mode" as implemented, but:

- The count step (Step 1) is skipped on re-entry (`onboarding.js:34`) — no replacement UI for
  adding/removing areas.
- `renderDetailsStep()` only iterates `getAreas()` and creates cards — no "Remove" button.
- There is no "Add Another Area" button in edit mode.
- `handleStorageAreasSave()` (`settings.js:147`) exits early when `areas.length === 0` — so even
  if the user somehow removed all areas, the DELETE calls never fire.

**Additional backend constraint**: The DELETE route (`storageAreas.js:358-400`) does **not**
cascade-delete occupied slots — it returns **409** if the area contains wines:

```javascript
if (occupied.count > 0) {
  return res.status(409).json({
    error: `Cannot delete "${area.name}" - it contains ${occupied.count} wine(s)`,
    suggestion: 'Move all wines to other storage areas first'
  });
}
```

This means the Remove button workflow must warn users that occupied areas cannot be deleted until
emptied, and the save handler must surface the 409 error clearly.

---

## 2. Out of Scope

- Bulk area reorder (drag to change `display_order`) — deferred in original plan.

### In Scope — Full Layout/Slot Reconciliation

**Core invariant**: After any `POST /storage-areas`, `PUT /:id/layout`, or `DELETE /:id`,
`storage_area_rows` and `slots` must describe the **same physical coordinates**. A layout change
is not complete unless new coordinates get real slot records and removed coordinates lose their
empty slot records.

The v3 plan only addressed row-level cleanup (`DELETE FROM slots WHERE row_num NOT IN ...`).
This is insufficient because:

1. **No slot provisioning on row/column growth** — PUT /layout replaces `storage_area_rows`
   definitions but never INSERTs new slot records. The grid (`stats.js:195+`, `grid.js:457`)
   renders from **slot records**, not `storage_area_rows`. New rows/columns are visible in the
   layout metadata but have no physical slots — bottles cannot be placed there.
2. **No slot provisioning on area creation** — POST /storage-areas creates area + rows but never
   INSERTs slot records. A fresh area has zero usable slots.
3. **No column-shrink cleanup** — The occupied-slot guard (`storageAreas.js:313`) correctly
   validates reduced `col_count` (rejects if wine in col > newColCount), but empty slot records
   beyond the new `col_count` are never deleted.
4. **No transaction wrapping** — PUT /layout executes DELETE + INSERT for `storage_area_rows`
   as separate statements (`storageAreas.js:339-345`) with no BEGIN/COMMIT. Adding slot cleanup
   and provisioning without a transaction risks leaving `storage_area_rows` and `slots` out of
   sync on partial failure.

**Solution**: Create a shared `syncStorageAreaSlots()` helper and use it from POST, PUT /layout,
and DELETE flows, all wrapped in a transaction. See §3.5 for full design.

---

## 3. Design

### Fix A — Stable Row Identity (Preserve `row_num` Through Editing)

**Previous approach (discarded)**: A `rebaseRows()` function would reconstruct global row_nums
from local 1..N at save time by mapping index → original row number. This fails because:
- Index-based reconstruction is lossy: deleting row 6 from [5,6,7] produces local [1,2], which
  maps to [5,6] instead of the correct [5,7]. The function has no information about **which** row
  was deleted.
- Row growth conflicts are understated: appending `maxOriginal + 1` fails for any area that is
  not physically last, because PUT /layout rejects overlap with later areas.

**New approach**: Preserve the original global `row_num` on each row throughout the editing
session. Never renumber to 1..N. The UI shows sequential display labels ("Row 1", "Row 2") using
the array index, while the internal `row_num` retains its database identity. At save time, rows
already carry their correct global row_nums — no reconstruction needed.

#### 3.1 Remove renumbering from row deletion

**`onboarding.js` — `buildRowControl()` delete handler (L219)**:

```javascript
// BEFORE (destroys identity):
area.rows = area.rows.filter(x => x.row_num !== row.row_num)
  .map((x, i) => ({ row_num: i + 1, col_count: x.col_count }));

// AFTER (preserves identity):
area.rows = area.rows.filter(x => x.row_num !== row.row_num);
```

**`storageBuilder.js` — `removeRow()` (L110-118)**:

```javascript
// BEFORE (destroys identity):
function removeRow(areaIndex, rowNum) {
  const area = state.areas[areaIndex];
  if (!area) return;
  const idx = area.rows.findIndex(r => r.row_num === rowNum);
  if (idx >= 0) {
    area.rows.splice(idx, 1);
    area.rows = area.rows.map((r, i) => ({ row_num: i + 1, col_count: r.col_count }));
    emitChange();
  }
}

// AFTER (preserves identity):
function removeRow(areaIndex, rowNum) {
  const area = state.areas[areaIndex];
  if (!area) return;
  const idx = area.rows.findIndex(r => r.row_num === rowNum);
  if (idx >= 0) {
    area.rows.splice(idx, 1);
    emitChange();
  }
}
```

After filtering, an area that originally had rows [5, 6, 7] and whose row 6 was deleted now
holds [5, 7]. The gap is intentional — `storage_area_rows` supports non-contiguous row_nums, and
the `stats.js` join matches on exact `(storage_area_id, row_num)` pairs.

**Last-row guard**: The delete button MUST be hidden/disabled when `area.rows.length === 1`.
Zero-row areas are not supported: `persistArea` (L123) skips layout updates when `rows.length
=== 0`, and `updateLayoutSchema` (storageArea.js L53) rejects empty row arrays (`.min(1)`).
The guard is applied in `buildRowControl()`:

```javascript
// Only show delete button when area has more than one row
if (area.rows.length > 1) {
  deleteBtn.style.display = '';
} else {
  deleteBtn.style.display = 'none';
}
```

This is consistent with the "cannot remove last area" guard (`areas.length > 1`) in §4.1.

#### 3.2 Remap template rows for existing areas

When a template is applied to an **existing** area (has `id`), the template's 1..N row_nums must
be remapped to start from the area's original base row. For a **new** area (no `id`), templates
keep their 1..N rows because `applyRowOffsets()` will shift them at save time.

**`onboarding.js` — template apply handler (L174)**:

```javascript
// BEFORE (overwrites with template's 1..N):
a.rows = normalized.rows.map(r => ({ row_num: r.row_num, col_count: r.col_count }));

// AFTER (preserves global position for existing areas):
const baseRow = a.id && a.rows.length > 0
  ? Math.min(...a.rows.map(r => r.row_num))
  : 1;
a.rows = normalized.rows.map((r, i) => ({
  row_num: baseRow + i,
  col_count: r.col_count
}));
```

For an existing area with original rows [5, 6, 7] and a template with 4 rows, the result is
[5, 6, 7, 8]. The area grows sequentially from its original base — exactly what the backend's
row-overlap guard expects.

**Edge case — template shrinks area**: If the template has fewer rows than the original (e.g., 2
rows applied to [5, 6, 7]), the result is [5, 6]. Row 7's slots are orphaned from the layout
(still exist in DB but not rendered). The backend's occupied-slot guard blocks this if row 7 has
wines:

```javascript
// storageAreas.js L295-305 — rejects removal of occupied rows
const removedOccupied = occupiedSlots.filter(s => !newRowSet.has(s.row_num));
if (removedOccupied.length > 0) {
  return res.status(409).json({
    error: 'Cannot remove rows containing wines',
    occupied_slots: removedOccupied.map(s => s.location_code)
  });
}
```

**Edge case — template grows past adjacent area**: If the area is at rows [5, 6, 7] and the next
area starts at row 10, a template with 8 rows produces [5..12] which overlaps. The backend
returns 400. Clear error message; user can reduce the template or reshuffle areas.

#### 3.3 Display labels use array index, not `row_num`

Since `row_num` now carries global identity (e.g., 5, 7 after deleting row 6), the UI labels
must use the sequential array index for user-friendly display.

**`onboarding.js` — `buildRowControl()` (L203)**:

```javascript
// BEFORE (displays internal row_num):
label.textContent = `Row ${row.row_num} columns:`;

// AFTER (displays sequential position):
// displayIndex is passed as parameter (0-based → 1-based for display)
label.textContent = `Row ${displayIndex + 1} columns:`;
```

Update `buildRowControl` signature to accept `displayIndex`:

```javascript
function buildRowControl(area, row, displayIndex) {
  // ...
  label.textContent = `Row ${displayIndex + 1} columns:`;
  // ...
}
```

And the caller in `renderLayoutStep()` passes the index:

```javascript
a.rows.forEach((r, idx) => areaCtl.appendChild(buildRowControl(a, r, idx)));
```

The `renderPreview()` function in `storageBuilder.js` still shows `R${r.row_num}C${c}` in slot
labels — this is correct because it reflects the actual location codes that map to physical slots.

#### 3.4 No changes to `persistArea` or save handler

With stable row identity, existing areas already carry their correct global row_nums through the
editing session. `persistArea` sends them as-is to `updateStorageAreaLayout`. No `rebaseRows()`,
no `layoutAreaMap`, no changes to the function signature.

`applyRowOffsets()` continues to work correctly:
- **Existing areas** (with `id`): returned as-is — their rows already have correct global row_nums.
- **New areas** (no `id`): rows still start at 1..N, offset by `applyRowOffsets()` at save time.

#### Files changed (Fix A)

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Remove `.map((x, i) => ...)` renumbering from delete handler; remap template rows with `baseRow + i` for existing areas; pass `displayIndex` to `buildRowControl`; update label to use `displayIndex + 1`; add last-row guard (hide delete button when `area.rows.length === 1`) |
| `public/js/storageBuilder.js` | Remove renumbering line from `removeRow()` |

---

### Fix C — Full Layout/Slot Reconciliation (Backend)

**Goal**: After any POST, PUT /layout, or DELETE on storage areas, the `slots` table must
contain exactly one record per physical coordinate defined by `storage_area_rows`. Growth
provisions new empty slots; shrink removes empty slots; occupied coordinates are always protected.

#### 3.5 Shared reconciliation helper — `syncStorageAreaSlots()`

Create `src/services/cellar/slotReconciliation.js`:

```javascript
/**
 * Synchronise slot records with storage_area_rows definitions.
 * Must be called INSIDE an existing transaction.
 *
 * @param {Object} txDb - Transaction-scoped DB handle
 * @param {Object} params
 * @param {string} params.cellarId - Cellar UUID
 * @param {string} params.areaId - Storage area UUID
 * @param {string} params.storageType - 'cellar' | 'wine_fridge' | etc.
 * @param {Array<{row_num: number, col_count: number}>} params.rows - Desired layout
 */
export async function syncStorageAreaSlots(txDb, { cellarId, areaId, storageType, rows }) {
  // 1. Load existing slots for this area
  const existingSlots = await txDb.prepare(`
    SELECT id, row_num, col_num, location_code, wine_id
    FROM slots
    WHERE storage_area_id = $1 AND cellar_id = $2
  `).all(areaId, cellarId);

  // 2. Build desired coordinate set from row definitions
  const desired = new Set();
  for (const row of rows) {
    for (let col = 1; col <= row.col_count; col++) {
      desired.add(`${row.row_num}:${col}`);
    }
  }

  // 3. Classify existing slots
  const toDelete = [];  // empty slots outside desired coordinates
  const kept = new Set(); // coordinates that already have a slot
  for (const slot of existingSlots) {
    const key = `${slot.row_num}:${slot.col_num}`;
    if (desired.has(key)) {
      kept.add(key);
    } else if (slot.wine_id === null) {
      toDelete.push(slot.id);
    }
    // Occupied slots outside desired coords: already rejected by caller's validation
  }

  // 4. Delete empty slots outside desired coordinates (rows AND columns)
  if (toDelete.length > 0) {
    // Batch delete in chunks to avoid parameter limit
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      const placeholders = batch.map((_, j) => `$${j + 1}`).join(',');
      await txDb.prepare(`DELETE FROM slots WHERE id IN (${placeholders})`).run(...batch);
    }
  }

  // 5. Insert new empty slots for coordinates not yet covered
  const zone = isFridgeType(storageType) ? 'fridge' : 'cellar';
  for (const row of rows) {
    for (let col = 1; col <= row.col_count; col++) {
      const key = `${row.row_num}:${col}`;
      if (!kept.has(key)) {
        // Location code is provisional for fridge types (resequenced later)
        const locationCode = isFridgeType(storageType)
          ? `F_TEMP_${row.row_num}_${col}`
          : `R${row.row_num}C${col}`;
        await txDb.prepare(`
          INSERT INTO slots (cellar_id, storage_area_id, zone, row_num, col_num, location_code)
          VALUES ($1, $2, $3, $4, $5, $6)
        `).run(cellarId, areaId, zone, row.row_num, col, locationCode);
      }
    }
  }
}
```

**Key design decisions**:

- **Covers both axes**: Handles removed rows AND reduced `col_count` on surviving rows in one
  pass, not a row-only cleanup.
- **Provisional fridge codes**: Fridge slots get temporary `F_TEMP_*` location codes during sync.
  The subsequent `resequenceFridgeSlots()` call (§3.6) assigns contiguous `F1..Fn` codes.
- **Chunked deletes**: Avoids hitting the PostgreSQL bind-parameter limit (~32k) for large areas.
- **No direct FK dependency**: Works around the missing `slots → storage_area_rows` FK by using
  the coordinate-set comparison approach.
- **Caller validates first**: The helper trusts that the caller has already rejected any layout
  change that would remove occupied slots (the existing guards at `storageAreas.js:310-325`).

#### 3.6 Fridge slot resequencing — `resequenceFridgeSlots()`

Fridge slots use `F1..Fn` location codes — a single contiguous sequence across all fridge areas
in a cellar. When fridge areas are created, resized, or deleted, the sequence must be rebuilt.

Add to `src/services/cellar/slotReconciliation.js`:

```javascript
/**
 * Resequence all fridge slot location_codes to contiguous F1..Fn.
 * Must be called INSIDE an existing transaction.
 * Uses a two-pass approach to avoid unique-key collisions on location_code.
 *
 * Canonical ordering: fridge areas by display_order, then rows by row_num,
 * then columns by col_num.
 *
 * @param {Object} txDb - Transaction-scoped DB handle
 * @param {string} cellarId - Cellar UUID
 */
export async function resequenceFridgeSlots(txDb, cellarId) {
  // Get all fridge slots in canonical order
  const fridgeSlots = await txDb.prepare(`
    SELECT s.id, s.location_code
    FROM slots s
    JOIN storage_areas sa ON sa.id = s.storage_area_id
    WHERE s.cellar_id = $1
      AND sa.storage_type IN ('wine_fridge', 'kitchen_fridge')
    ORDER BY sa.display_order, s.row_num, s.col_num
  `).all(cellarId);

  if (fridgeSlots.length === 0) return;

  // Pass 1: Move all to temporary codes to avoid unique-key collisions
  for (const slot of fridgeSlots) {
    await txDb.prepare(`
      UPDATE slots SET location_code = $1 WHERE id = $2
    `).run(`__reseq_${slot.id}`, slot.id);
  }

  // Pass 2: Assign contiguous F1..Fn
  for (let i = 0; i < fridgeSlots.length; i++) {
    await txDb.prepare(`
      UPDATE slots SET location_code = $1 WHERE id = $2
    `).run(`F${i + 1}`, fridgeSlots[i].id);
  }
}
```

**When to call**:
- `POST /storage-areas` — if the new area is a fridge type
- `PUT /:id/layout` — if the area is a fridge type
- `DELETE /:id` — if the deleted area was a fridge type (remaining fridge slots need resequencing)

**Performance**: The two-pass approach is O(2n) UPDATEs where n = total fridge slots. For a
typical cellar with <50 fridge slots, this adds ~100ms inside the transaction. Acceptable for
a low-frequency admin operation.

#### 3.7 Transactional route wiring

All three storage-area mutation routes must use `db.transaction()` + `wrapClient()` from
`src/db/postgres.js` / `src/db/index.js`. This is the repo-standard pattern (see `bottles.js:238`)
that guarantees all statements run on the same pooled client. **Do NOT use bare
`db.prepare('BEGIN').run()`** — the pool-backed `db.prepare()` dispatches each statement to an
arbitrary client, so BEGIN/COMMIT may land on different connections.

```javascript
import { wrapClient } from '../db/index.js';
import db from '../db/index.js';
```

**POST /storage-areas** (`storageAreas.js:155-180`):

```javascript
const result = await db.transaction(async (client) => {
  const txDb = wrapClient(client);

  // 1. INSERT storage_areas (existing code)
  const area = await txDb.prepare(`INSERT INTO storage_areas ...`).get(...);

  // 2. INSERT storage_area_rows (existing code)
  for (const row of rows) {
    await txDb.prepare(`INSERT INTO storage_area_rows ...`).run(area.id, row.row_num, row.col_count);
  }

  // 3. NEW: Provision slots
  await syncStorageAreaSlots(txDb, {
    cellarId, areaId: area.id, storageType: storage_type, rows
  });

  // 4. NEW: Resequence fridge codes if applicable
  if (isFridgeType(storage_type)) {
    await resequenceFridgeSlots(txDb, cellarId);
  }

  return area;
});
res.status(201).json({ message: `Storage area "${name}" created`, data: { ...result, rows } });
```

**PUT /:id/layout** (`storageAreas.js:266-356`):

```javascript
// After validation guards pass (occupied-slot check, row-overlap check)...
await db.transaction(async (client) => {
  const txDb = wrapClient(client);

  // 1. Replace storage_area_rows (existing code, moved into txn)
  await txDb.prepare('DELETE FROM storage_area_rows WHERE storage_area_id = $1').run(id);
  for (const row of rows) {
    await txDb.prepare('INSERT INTO storage_area_rows ...').run(id, row.row_num, row.col_count);
  }

  // 2. NEW: Sync slots (delete orphans + provision new)
  const area = await txDb.prepare('SELECT storage_type FROM storage_areas WHERE id = $1').get(id);
  await syncStorageAreaSlots(txDb, {
    cellarId, areaId: id, storageType: area.storage_type, rows
  });

  // 3. NEW: Resequence fridge codes if applicable
  if (isFridgeType(area.storage_type)) {
    await resequenceFridgeSlots(txDb, cellarId);
  }
});
res.json({ message: 'Layout updated successfully', data: { storage_area_id: id, rows } });
```

**DELETE /:id** (`storageAreas.js:360-400`):

```javascript
// After occupied-slot guard passes...
const areaInfo = await db.prepare(
  'SELECT storage_type FROM storage_areas WHERE id = $1'
).get(id);

await db.transaction(async (client) => {
  const txDb = wrapClient(client);

  // CASCADE deletes storage_area_rows and slots (existing behaviour)
  await txDb.prepare('DELETE FROM storage_areas WHERE id = $1 AND cellar_id = $2').run(id, cellarId);

  // NEW: Resequence remaining fridge slots if deleted area was a fridge
  if (isFridgeType(areaInfo.storage_type)) {
    await resequenceFridgeSlots(txDb, cellarId);
  }
});
res.json({ message: `Storage area "${area.name}" deleted` });
```

#### 3.8 Consumer fixes

Three consumers rely on lexicographic `ORDER BY location_code` for fridge slots, which produces
incorrect ordering when slot numbers exceed 9 (F1, F10, F11, ..., F2):

**`src/routes/cellar.js` — `getEmptyFridgeSlots()` both branches (~L71, ~L80)**:

The function has two branches: area-scoped (when `storageAreaId` is provided) and cross-cellar
fallback. Both use `ORDER BY location_code` and both must be fixed.

```javascript
// Branch 1: area-scoped (~L71)
// BEFORE: ORDER BY location_code  (lexicographic: F1, F10, F2)
// AFTER:  ORDER BY row_num, col_num (physical order within area)
if (storageAreaId != null) {
  const rows = await db.prepare(`
    SELECT location_code FROM slots
    WHERE cellar_id = $1
      AND storage_area_id = $2
      AND wine_id IS NULL
    ORDER BY row_num, col_num
  `).all(cellarId, storageAreaId);
  return rows.map(r => r.location_code);
}

// Branch 2: cross-cellar fallback (~L80)
// BEFORE: ORDER BY location_code  (lexicographic across all fridge areas)
// AFTER:  ORDER BY sa.display_order, s.row_num, s.col_num (canonical fridge order)
const rows = await db.prepare(`
  SELECT s.location_code FROM slots s
  JOIN storage_areas sa ON sa.id = s.storage_area_id
    AND sa.storage_type IN ('wine_fridge', 'kitchen_fridge')
  WHERE s.cellar_id = $1
    AND s.wine_id IS NULL
  ORDER BY sa.display_order, s.row_num, s.col_num
`).all(cellarId);
return rows.map(r => r.location_code);
```

**`src/services/acquisitionWorkflow.js` — fridge slot lookup (~L430)**:

```javascript
// BEFORE: ORDER BY s.location_code
// AFTER:  ORDER BY sa.display_order, s.row_num, s.col_num
const fridgeSlots = await query.prepare(`
  SELECT s.location_code FROM slots s
  JOIN storage_areas sa ON sa.id = s.storage_area_id
    AND sa.storage_type IN ('wine_fridge', 'kitchen_fridge')
  WHERE s.cellar_id = ? AND s.wine_id IS NULL
  ORDER BY sa.display_order, s.row_num, s.col_num
`).all(cellarId);
```

**`src/services/cellar/cellarHealth.js` — `executeFillFridge()` (~L553)**:

```javascript
// BEFORE: ORDER BY s.location_code
// AFTER:  ORDER BY sa.display_order, s.row_num, s.col_num
const emptyFridge = await db.prepare(`
  SELECT s.location_code FROM slots s
  JOIN storage_areas sa ON sa.id = s.storage_area_id
    AND sa.storage_type IN ('wine_fridge', 'kitchen_fridge')
  WHERE s.cellar_id = ? AND s.wine_id IS NULL
  ORDER BY sa.display_order, s.row_num, s.col_num
`).all(cellarId);
```

**`src/routes/bottles.js` — `getGridLimits()` (~L30)**:

Currently only counts `wine_fridge` capacity. Update to include `kitchen_fridge`:

```javascript
// BEFORE: const fridgeAreas = areasByType.wine_fridge || [];
// AFTER:
const fridgeAreas = [
  ...(areasByType.wine_fridge || []),
  ...(areasByType.kitchen_fridge || [])
];
```

#### Files changed (Fix C)

| File | Change |
|------|--------|
| `src/services/cellar/slotReconciliation.js` | **NEW**: `syncStorageAreaSlots()` + `resequenceFridgeSlots()` |
| `src/routes/storageAreas.js` | Wrap POST, PUT /layout, DELETE in `db.transaction()` + `wrapClient()`; call `syncStorageAreaSlots()` and `resequenceFridgeSlots()` via `txDb` |
| `src/routes/cellar.js` | Fix `getEmptyFridgeSlots()` sort order in BOTH branches: area-scoped (`row_num, col_num`) and cross-cellar fallback (`display_order, row_num, col_num` via JOIN) |
| `src/services/acquisitionWorkflow.js` | Fix fridge slot lookup sort order |
| `src/services/cellar/cellarHealth.js` | Fix `executeFillFridge()` fridge slot sort order |
| `src/routes/bottles.js` | Include `kitchen_fridge` in `getGridLimits()` fridge capacity |

---

### Fix B — Add/Remove Area Controls in Wizard Edit Mode

**Goal**: When the wizard opens with existing areas, Step 2 (Details) must allow:
1. Removing an existing area (marks it for deletion on save).
2. Adding a new area.

**Approach**: Step 2 shows a "Remove" button on each existing area card and an "Add Area" button
at the bottom. The wizard state already distinguishes new vs existing areas via `area.id`.

#### 4.1 "Remove Area" button on each card in `renderDetailsStep()`

Add at the bottom of each card, after the template row:

```javascript
// Only show remove button when more than one area remains
if (areas.length > 1) {
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove This Area';
  removeBtn.className = 'btn btn-danger btn-small';
  removeBtn.addEventListener('click', () => {
    // Confirm before removing existing (persisted) areas
    if (a.id) {
      const ok = window.confirm(
        `Remove "${a.name}"? This will delete the area and all its empty slots on save.\n\n` +
        'Note: Areas containing wines must be emptied first.'
      );
      if (!ok) return;
    }
    const updated = getAreas().filter(x => x !== a);
    setAreas(updated);
    renderStep();
  });
  card.appendChild(removeBtn);
}
```

**Note on `window.confirm`**: Acceptable for this low-frequency destructive action. The wizard's
Step 4 review is the final confirmation gate before any DELETE hits the API. The confirm dialog
also warns about occupied areas — the backend returns 409 if they contain wines.

**Zero-area guard**: The UI blocks removing the last area (`areas.length > 1` condition on
the Remove button). The save handler also keeps its `areas.length === 0` early-exit as a
defensive belt. Both are consistent: zero-area cellars are not allowed.

#### 4.2 "Add Area" button at bottom of Step 2

Add after the card list but before the Next button, with `maxAreas` guard:

```javascript
// Add Area button — only when under the max limit
if (areas.length < ui.maxAreas) {
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add Another Area';
  addBtn.className = 'btn btn-secondary btn-small';
  addBtn.addEventListener('click', () => {
    addArea({
      name: `Area ${getAreas().length + 1}`,
      storage_type: 'cellar',
      temp_zone: 'cellar'
    });
    renderStep();
  });
  ui.container.appendChild(addBtn);
}
```

`addArea()` already creates areas without an `id`, so new additions will correctly be POSTed
(not PUT) by `persistArea`.

#### 4.3 Wizard header shows edit vs setup mode

The header is built in `renderStep()` (`onboarding.js:42-44`). Update it to reflect mode:

```javascript
const isEdit = getAreas().some(a => a.id);
header.textContent = isEdit
  ? `Edit Storage Areas (Step ${ui.step}/4)`
  : `Setup Storage Areas (Step ${ui.step}/4)`;
```

This applies to ALL steps, so the header stays consistent through the wizard.

#### 4.4 Surface backend errors during save

**Partial-save mitigation**: The current `handleStorageAreasSave()` runs creates/updates in a
loop THEN deletes (`settings.js:161-175`). A failed delete (409 for occupied area) leaves the
config partially applied. Reordering to delete-first is risky (losing an area before successful
creates could leave zero areas).

**Pragmatic fix**: Add 409 error handling to the DELETE loop, track actual successes, and
surface failures clearly. The current success path (`settings.js:167-178`) always reports
`${remainingIds.size} deleted` in the toast — but a 409 failure means fewer areas were actually
deleted. The fix tracks actual deletes and adjusts the summary:

```javascript
// In the DELETE loop (settings.js):
let deletedCount = 0;
const deleteErrors = [];
for (const deletedId of remainingIds) {
  try {
    await deleteStorageArea(deletedId);
    deletedCount++;
  } catch (err) {
    if (err.message?.includes('contains')) {
      deleteErrors.push(err.message);
      showToast(`Cannot delete area — ${err.message}`);
    } else {
      throw err;
    }
  }
}

// Success path — use actual counts:
const parts = [];
if (savedCount > 0) parts.push(`${savedCount} area(s) saved`);
if (deletedCount > 0) parts.push(`${deletedCount} area(s) deleted`);
if (deleteErrors.length > 0) parts.push(`${deleteErrors.length} delete(s) blocked`);
showToast(parts.join(', ') || 'No changes');

// Only close wizard if there were no errors
if (deleteErrors.length === 0) {
  wizardContainer.style.display = 'none';
}
```

This replaces the current unconditional `${remainingIds.size} deleted` with accurate counts
and keeps the wizard open when deletes are blocked, allowing the user to address the issue.

#### Files changed (Fix B)

| File | Change |
|------|--------|
| `public/js/onboarding.js` | Add "Remove Area" button to each card in `renderDetailsStep()`; add "Add Area" button with `maxAreas` guard; update header in `renderStep()` for edit mode |
| `public/js/settings.js` | Add 409 error handling in DELETE loop; track `deletedCount` + `deleteErrors`; replace unconditional `remainingIds.size` toast with accurate counts; keep wizard open on errors |

---

## 4. Testing Strategy

### 4.1 Unit Tests — Builder State

Add to `tests/unit/utils/storageBuilder.test.js`:

**Note**: `removeRow` is a private function (not exported from `storageBuilder.js`). Tests
exercise it indirectly through the public API — `setAreas()` + state mutation + `getAreas()` —
which mirrors the actual user code path (onboarding delete handler filters `area.rows` then
calls `setAreas()`).

| Test | What It Tests |
|------|---------------|
| row deletion preserves identity | `setAreas([{rows:[{row_num:5,...},{row_num:6,...},{row_num:7,...}]}])`, filter out row 6, `setAreas` with result → `getAreas()[0].rows` is `[{row_num:5,...}, {row_num:7,...}]` (gap preserved) |
| last-row guard prevents zero-row | Verify `buildRowControl` hides delete button when `area.rows.length === 1`. This is a **UI guard** — test must assert that the delete control's `display` style is `'none'` for single-row areas and visible for multi-row areas. |
| first row deletion | Filter out row 5 from [5,6,7] → `[{row_num:6,...}, {row_num:7,...}]` |
| last row deletion | Filter out row 7 from [5,6,7] → `[{row_num:5,...}, {row_num:6,...}]` |
| `addRow` after gap | Area has [5,7] (gap at 6) → addRow → appends `{row_num:8,...}` (uses `at(-1) + 1`, not `maxRow + 1`) |

### 4.2 Unit Tests — Slot Reconciliation Service

Add `tests/unit/services/cellar/slotReconciliation.test.js`:

**`syncStorageAreaSlots()`**:

| Test | What It Tests |
|------|---------------|
| provisions slots for a new cellar area | Given zero existing slots, rows `[{row_num:1,col_count:3}]` → inserts 3 slots with `location_code` R1C1..R1C3, `zone='cellar'` |
| provisions fridge slots with temp codes | Given zero existing slots, fridge area with rows `[{row_num:1,col_count:2}]` → inserts 2 slots with `location_code` `F_TEMP_<areaId>_1_1` etc., `zone='fridge'` |
| row growth adds new slots | Existing slots for rows [1,2] × 3 cols, new layout adds row 3 × 3 cols → 3 new slots inserted, existing 6 untouched |
| column growth adds new slots | Existing row 1 has 3 slots, new layout `col_count=5` → 2 new slots inserted (col 4, col 5), existing 3 untouched |
| row shrink deletes empty slots | Existing rows [1,2,3] × 3 cols, row 3 removed from layout, all row-3 slots empty → row-3 slots deleted |
| column shrink deletes empty slots | Existing row 1 has 5 slots, new layout `col_count=3`, cols 4+5 empty → cols 4+5 deleted |
| shrink blocked by occupied slots | Row 3 has one occupied slot (wine_id set), row 3 removed from layout → function does NOT delete row-3 slots (caller's occupied-slot guard catches this at route level) |
| mixed growth + shrink | Row 2 removed (empty), row 4 added, col_count grew → deletes row 2, inserts row-4 slots and extra column slots |
| idempotent on no-change | Layout identical to existing slots → zero inserts, zero deletes |
| cellar slot location codes | Cellar slots use `R${row_num}C${col_num}` format |
| fridge slot location codes | Fridge slots use `F_TEMP_${areaId}_${row}_${col}` format (resequenced later) |

**`resequenceFridgeSlots()`**:

| Test | What It Tests |
|------|---------------|
| contiguous numbering from F1 | 3 fridge slots across 2 areas → resequenced to F1, F2, F3 ordered by `display_order, row_num, col_num` |
| two-pass avoids collisions | Slot currently named F1 needs to become F2, another F2→F1 → temp codes prevent unique-key violation |
| temp codes replaced | Slots with `F_TEMP_*` codes → resequenced to final F1..Fn |
| no-op when already contiguous | F1, F2, F3 already in order → no UPDATE queries executed |
| respects display_order | Area A (display_order=1) gets lower F-numbers than Area B (display_order=2) |
| handles occupied slots | Occupied fridge slots are resequenced (location_code changes, wine_id preserved) |

### 4.3 Route Tests — Backend Slot Reconciliation

Add `tests/unit/routes/storageAreas.test.js` (or extend if it exists):

**POST /storage-areas**:

| Test | What It Tests |
|------|---------------|
| POST creates area + rows + slots | POST with 2 rows × 3 cols → area created, 2 `storage_area_rows`, 6 empty slots (R1C1..R2C3) |
| POST fridge area triggers resequence | POST fridge area with 2 slots → fridge slots resequenced to F(n+1)..F(n+2) |
| POST rollback on slot error | If slot INSERT fails, entire operation (area + rows) is rolled back |

**PUT /:id/layout**:

| Test | What It Tests |
|------|---------------|
| add row provisions new slots | Area has rows [1,2], PUT with [1,2,3] → 3 new empty slots created for row 3 |
| add column provisions new slots | Area has row 1 × 3 cols, PUT with row 1 × 5 cols → 2 new slots created (col 4, col 5) |
| remove empty row deletes slots | Area has rows [1,2,3], row 3 empty, PUT with [1,2] → row-3 slots deleted |
| shrink columns deletes empty slots | Row 1 has 5 cols, cols 4+5 empty, PUT with 3 cols → cols 4+5 deleted |
| occupied row removal returns 409 | Row 3 has wine, PUT removes row 3 → 409 + `"Cannot remove rows/columns that contain wines"` |
| occupied column shrink returns 409 | Col 5 has wine, PUT shrinks to 3 cols → 409 |
| fridge layout change triggers resequence | Modify fridge area layout → fridge slots renumbered F1..Fn |
| transaction rollback on error | Simulated failure mid-transaction → no partial state changes |
| row-overlap guard still works | PUT tries to assign row already owned by another area → 400 |

**DELETE /:id**:

| Test | What It Tests |
|------|---------------|
| DELETE cascades area + rows + slots | Delete area → area, rows, AND slots all removed |
| DELETE fridge area triggers resequence | Delete fridge area → remaining fridge slots renumbered to fill gap |
| DELETE occupied area returns 409 | Area has wines → 409 + `"Area contains N wine(s)"` |

### 4.4 Route Tests — Consumer Fixes

| Test | Where | What It Tests |
|------|-------|---------------|
| `getEmptyFridgeSlots` returns physical order | `cellar.test.js` | F1, F2, F10 returned in order [F1, F2, F10] not [F1, F10, F2] — both area-scoped and cross-cellar branches |
| `getGridLimits` includes kitchen_fridge | `bottles.test.js` | Kitchen fridge capacity counted in `fridgeMaxSlot` |
| acquisition fridge lookup physical order | `acquisitionWorkflow.test.js` | Fridge slots ordered by `display_order, row_num, col_num` |
| `executeFillFridge` fridge physical order | `cellarHealth.test.js` | Fill-fridge targets ordered by `display_order, row_num, col_num` not lexicographic |

### 4.5 Manual Test Plan

| Scenario | Verifies | Fix |
|----------|----------|-----|
| Existing 3-row area → delete middle row → save → DB has [5,7] not [5,6] | Row identity survives deletion | A |
| Existing 3-row area [5,6,7] → apply 4-row template → save → DB has [5,6,7,8] | Template remaps from base | A |
| Existing 3-row area [5,6,7] → apply 2-row template → save → DB has [5,6] | Template shrink from base | A |
| Existing area → delete/add rows → Step 4 preview shows correct global slot codes (R5C1, etc.) | Preview reflects stable identity | A |
| Existing area → edit name/type only → save → rows unchanged | No-op pass-through | A |
| New area added in edit mode → save → rows offset correctly by `applyRowOffsets` | New area offset still works | A |
| Open wizard with 2 areas → Remove one → save → 1 area remains, other deleted | Remove area | B |
| Open wizard with 2 areas → try to Remove both → Remove button disappears at 1 | Guard: can't remove last area | B |
| Open wizard with existing areas → Add Area → new area POSTed, existing PUTed | Add area in edit mode | B |
| Remove an area that contains wines → save → 409 error toast appears | Backend occupied-area guard | B |
| Wizard header shows "Edit Storage Areas" when editing, "Setup" for new | Header mode text | B |
| Add row to existing area → save → new row's slots appear in grid (placeable) | Slot provisioning on row growth | C |
| Increase col_count on existing area → save → new column slots appear in grid | Slot provisioning on column growth | C |
| Remove empty row → save → grid no longer shows that row's slots; stats updated | Slot cleanup on row shrink | C |
| Shrink col_count → save → extra empty column slots removed from grid | Slot cleanup on column shrink | C |
| Create new fridge area → fridge grid shows contiguous F-numbers starting after existing | Fridge resequencing on create | C |
| Delete fridge area → remaining fridge slots renumbered to fill gap | Fridge resequencing on delete | C |
| Place bottle in fridge slot F10+ → "Drink suggestions" lists it in correct physical order | Consumer fix: fridge ordering | C |
| Kitchen fridge capacity shows in grid limits | Consumer fix: getGridLimits includes kitchen_fridge | C |

---

## 5. Risk & Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Template grows past adjacent area (row overlap) | LOW — backend returns 400 | Clear error message; user reduces template or adjusts areas |
| Non-contiguous row_nums after deletion (e.g., [5,7]) | NONE — `storage_area_rows` supports gaps; `stats.js` join matches exact `(area_id, row_num)` pairs | No mitigation needed — architectural design supports this |
| `addRow` after gap appends `at(-1)+1` not `max+1` | NONE — `at(-1)` IS the max when rows are sorted, which they are at load time and after filter | Verify rows stay sorted |
| Partial-save on failed delete (409) | LOW — only occupied areas trigger this; user saw warning | Track actual `deletedCount`; keep wizard open on errors; accurate toast |
| Remove button shows `window.confirm` | LOW — acceptable for low-frequency action | Could be replaced with inline confirmation later |
| Backend DELETE must cascade-delete empty slots | VERIFIED — `ON DELETE CASCADE` on `storage_area_id` FK in `slots` table (migration 038 L72) | No risk |
| Orphaned empty slots on row/column removal | RESOLVED by `syncStorageAreaSlots()` — deletes empty slots outside the desired coordinate set within the same transaction | Occupied-slot guard blocks removal of wine-containing coordinates at route level |
| Zero-row area after deleting all rows | BLOCKED — `updateLayoutSchema` rejects `.min(1)`; `persistArea` skips zero-row layouts | UI last-row guard hides delete button at `rows.length === 1` (§3.1) |
| Transaction failure mid-reconciliation | LOW — `db.transaction()` handles ROLLBACK automatically via try/catch in `postgres.js:135` | Route error handler returns 500; frontend shows toast |
| Fridge resequencing performance on large cellars | LOW — two-pass UPDATE with temp codes is O(n) where n = total fridge slots; typical cellars have <50 fridge slots | Batch UPDATEs in chunks if needed |
| Unique-key collision during fridge resequence | RESOLVED — two-pass approach (temp codes → final codes) avoids F1↔F2 swap collision | Temp code format `F_TEMP_SEQ_<n>` is distinct from final `F<n>` pattern |
| `getGridLimits()` kitchen_fridge inclusion changes capacity display | LOW — makes capacity display more accurate, not less | Previous omission was the bug |

---

## 6. Revision History

### v4 (2026-03-07) — Third GPT-5.4 external review: Full Layout/Slot Reconciliation

**Findings incorporated** (all confirmed against codebase):

1. **HIGH: PUT /layout doesn't provision slots for growth** — The v3 backend change only
   reconciled row removal (deleting orphaned empty slots). But grid rendering (`stats.js:195+`,
   `grid.js:457`) uses **slot records** as the source of truth, not `storage_area_rows`. Adding
   rows or increasing `col_count` via PUT /layout produced `storage_area_rows` entries but zero
   usable slots — the grid showed nothing for new coordinates.
   **Resolution**: Created `syncStorageAreaSlots()` helper (§3.5) that computes the full desired
   coordinate set from `storage_area_rows`, compares against existing slot records, inserts
   missing slots and deletes empty orphans — handling both axes (row AND column) in both
   directions (growth AND shrink).

2. **HIGH: POST /storage-areas doesn't provision slots** — `storageAreas.js:155-180` creates
   the area and inserts `storage_area_rows` but never creates slot records. New areas had zero
   usable grid cells.
   **Resolution**: POST now calls `syncStorageAreaSlots()` after inserting rows (§3.7), within
   the same transaction.

3. **MEDIUM: No transaction in PUT /layout** — The existing code runs `DELETE FROM
   storage_area_rows` then `INSERT` as bare statements without BEGIN/COMMIT. A failure between
   the two leaves the area with zero rows.
   **Resolution**: All three mutation routes (POST, PUT /layout, DELETE) now wrapped in
   `db.transaction()` + `wrapClient()` (§3.7).

4. **MEDIUM: Test plan lacked route tests** — §4 only had builder-state unit tests and manual
   scenarios. No automated tests for backend slot provisioning, reconciliation, or fridge
   resequencing.
   **Resolution**: Added §4.2 (slot reconciliation service tests), §4.3 (route tests for POST,
   PUT, DELETE covering growth, shrink, occupied guards, fridge resequencing, transaction
   rollback), §4.4 (consumer fix tests).

**Additional bugs discovered during evidence gathering**:

5. **MEDIUM: Fridge slot ordering bug** — `cellar.js:75` and `acquisitionWorkflow.js:430` use
   `ORDER BY location_code` which sorts lexicographically: F1, F10, F11, ..., F2. Breaks at 10+
   fridge slots.
   **Resolution**: Changed sort to `row_num, col_num` (cellar.js) and `display_order, row_num,
   col_num` (acquisitionWorkflow.js) — see §3.8.

6. **LOW: `getGridLimits()` excludes kitchen_fridge** — `bottles.js:30` only counts
   `wine_fridge` capacity, ignoring `kitchen_fridge` areas.
   **Resolution**: Include both fridge types in capacity calculation (§3.8).

### v5 (2026-03-07) — Fourth GPT-5.4 external review: Transaction pattern + missed consumers

**Findings incorporated** (all confirmed against codebase):

1. **HIGH: Transaction wiring uses wrong pattern** — The v4 plan's §3.7 used
   `db.prepare('BEGIN').run()` / `db.prepare('COMMIT').run()`, but `db.prepare()` dispatches via
   `self.pool.query()` (`postgres.js:93`) which uses arbitrary pooled clients per call. BEGIN and
   COMMIT could land on different connections, making the transaction ineffective. The repo already
   has a correct pattern: `db.transaction(async (client) => { const txDb = wrapClient(client); })`
   used in `bottles.js:238`.
   **Resolution**: Rewrote §3.7 to use `db.transaction()` + `wrapClient()` from `src/db/index.js`.
   All three routes (POST, PUT, DELETE) now acquire a single client, BEGIN/COMMIT/ROLLBACK is
   handled by `db.transaction()`, and both `syncStorageAreaSlots()` and `resequenceFridgeSlots()`
   receive the `txDb` handle. §3.5 and §3.6 already documented `txDb` as their first parameter.

2. **MEDIUM: Missing fridge-order consumer — cellarHealth.js** — `executeFillFridge()` in
   `cellarHealth.js:553` selects empty fridge slots with `ORDER BY s.location_code`. This is a
   third fridge-ordering consumer not covered in the v4 plan's "two consumers" claim.
   **Resolution**: Added `cellarHealth.js` to §3.8 consumer fixes with the same
   `display_order, row_num, col_num` ordering fix. Updated the files-changed table.

3. **LOW: `getEmptyFridgeSlots()` fallback branch underspecified** — The v4 plan only updated
   the area-scoped branch (`cellar.js:71`), but the function also has a cross-cellar fallback
   (`cellar.js:80`) that selects all `F*` slots ordered lexicographically. For cross-area output
   the sort must be `display_order, row_num, col_num` via a JOIN to `storage_areas`, not just
   `row_num, col_num`.
   **Resolution**: Expanded §3.8 to show both branches of `getEmptyFridgeSlots()` with their
   respective ORDER BY clauses.

**Open question resolved**:
- **"Is this phase intended to make row/column growth and shrink produce real usable slots?"**
  — YES. The reconciliation invariant is: *After any POST, PUT /layout, or DELETE on storage
  areas, `storage_area_rows` and `slots` must describe the same physical coordinates.* This is
  the core gap that made layout changes invisible in the grid.

**Scope change**: Expanded from "stable row identity + row-only slot cleanup" (v3) to "full
coordinate-based layout/slot reconciliation." Added new service file
(`slotReconciliation.js`), fridge resequencing helper, transactional wiring for all three
routes, consumer fixes, and comprehensive route test plan. Implementation order reorganized
into four phases (backend reconciliation → consumer fixes → frontend identity → frontend areas).

### v6 (2026-03-07) — Fifth GPT-5.4 external review: Document synchronization

**Findings incorporated** (all confirmed against plan content):

1. **MEDIUM: Implementation order stale** — §7 Phase I Step 2 still said "wrap … in
   BEGIN/COMMIT/ROLLBACK" and Phase II omitted `cellarHealth.js`. Both contradicted the
   canonical §3.7 (db.transaction + wrapClient) and §3.8 (three consumers) sections.
   **Resolution**: Rewrote §7 to match §3.7 transaction pattern and added `cellarHealth.js` as
   Step 7 in Phase II. Fixed cleanup-plan.md implementation order to match.

2. **MEDIUM: Out-of-scope bullet contradicts core invariant** — §2 listed "Slot provisioning
   for brand-new cellars (first-time onboarding)" as out of scope, but POST /storage-areas
   provisioning is explicitly part of the reconciliation invariant in §2 gaps #2 and §3.7.
   Since `settings.js:130` calls `createStorageArea()` via POST, fixing POST covers first-time
   setup too.
   **Resolution**: Removed the stale out-of-scope bullet.

3. **LOW: Last-row guard test assigned to wrong layer** — §4.1 and cleanup-plan.md assigned the
   last-row guard test to `storageBuilder.test.js`, but the guard is a UI behavior in
   `buildRowControl()` (§3.1) — hiding/showing the delete button. Testing via pure state
   (`getAreas`) would not verify the DOM behavior.
   **Resolution**: Removed the "or test via getAreas state" hedge in §4.1. Reassigned the test
   in cleanup-plan.md to an onboarding/DOM-capable test file.

4. **LOW: Revision dates internally inconsistent** — v2–v4 history entries used 2026-03-08 but
   all reviews occurred on 2026-03-07.
   **Resolution**: Corrected all revision dates to 2026-03-07. Consolidated the `Revised` header
   line to reference the full v2–v6 range.

### v3 (2026-03-07) — Second GPT-5.4 external review

**Findings incorporated** (all confirmed against codebase):

1. **HIGH: Orphaned empty slots on row removal** — PUT /layout (`storageAreas.js:339`) deletes
   `storage_area_rows` but NOT the corresponding `slots` records. Empty slots persist orphaned
   because there is no FK from `slots` to `storage_area_rows` (only to `storage_areas`). These
   inflate `emptySlots` in stats (L28) and appear in `getEmptyFridgeSlots()`.
   **Resolution**: Brought one targeted backend change into scope — add `DELETE FROM slots WHERE
   wine_id IS NULL AND row_num NOT IN (new_rows)` in the PUT /layout transaction (§2).
   Occupied-slot guard already blocks wine-containing rows.

2. **HIGH: Zero-row areas conflict** — Plan test matrix expected `removeRow` on single-row area
   to yield `[]`, but `updateLayoutSchema` requires `.min(1)` rows, and `persistArea` skips
   layout updates when `rows.length === 0`.
   **Resolution**: Added last-row guard — hide/disable delete button when `area.rows.length ===
   1` (§3.1). Removed zero-row test case. Consistent with "cannot remove last area" guard.

3. **MEDIUM: Save summary wrong after 409** — The catch-and-continue pattern in §4.4 didn't fix
   the success path which unconditionally reports `${remainingIds.size} deleted`. After a 409,
   the toast message would overstate actual deletes.
   **Resolution**: Track `deletedCount` separately, build toast from actual counts, keep wizard
   open when delete errors occur (§4.4).

4. **LOW: `removeRow` is private** — Test plan listed `removeRow` unit tests but the function
   is not exported from `storageBuilder.js` (plain `function`, not `export function`).
   **Resolution**: Rewrote test plan to exercise row deletion via public API (`setAreas()` +
   `.filter()` + `getAreas()`) — same code path as the onboarding delete handler (§4).

5. **LOW: `cleanup-plan.md` stale** — §1 still described discarded `rebaseRows()` design,
   `layoutAreaMap`, and wrong implementation order.
   **Resolution**: Updated `cleanup-plan.md` §1 to reflect stable row identity approach.

### v2 (2026-03-07) — GPT-5.4 external review

**Findings incorporated** (all confirmed against codebase):

1. **HIGH: Lossy row identity** — `rebaseRows()` index-based reconstruction is fundamentally broken.
   Deleting row 6 from [5,6,7] produces local [1,2] which maps back to [5,6] — the WRONG rows.
   **Resolution**: Replaced `rebaseRows()` with stable row identity (preserve `row_num` through
   editing, never renumber to 1..N).

2. **HIGH: Row-growth conflicts understated** — appending `maxOriginal + 1` fails for non-last
   areas because PUT /layout row-overlap guard rejects collision with later areas.
   **Resolution**: Template remap uses `baseRow + i` which extends sequentially from the area's
   actual global position. Backend still validates; error is now clear and rare.

3. **MEDIUM: Partial-save on delete** — creates/updates run before deletes; a failed 409 delete
   leaves config partially applied.
   **Resolution**: Added 409 catch/toast in DELETE loop. Full transactional batch endpoint
   deferred (backend change out of scope).

4. **MEDIUM: Step 4 preview misleading** — showed local 1..N for existing areas.
   **Resolution**: With stable identity, existing areas already carry real global row_nums.
   `applyRowOffsets()` returns them as-is. `renderPreview()` shows correct `R${row_num}C${col}`
   slot codes. No change needed.

5. **LOW: Broken parent link** — plan pointed to `docs/plans/` but parent plan is in `docs/archive/`.
   **Resolution**: Updated link to `../archive/phase3-frontend-cross-area-ux.md`.

**Open questions resolved**:
- **Zero-area cellars**: UI blocks removing last area (`areas.length > 1`). Save handler keeps
  `areas.length === 0` early-exit as defensive belt. Both consistent.
- **Stable row identity vs save-time reconstruction**: Adopted stable identity. Eliminates
  `rebaseRows()`, `layoutAreaMap`, and the 4th parameter to `persistArea()`. Simpler, safer,
  correct.

---

## 7. Implementation Order

### Phase I — Backend Slot Reconciliation (Fix C)

1. `src/services/cellar/slotReconciliation.js` — **NEW**: implement `syncStorageAreaSlots()` and `resequenceFridgeSlots()`
2. `src/routes/storageAreas.js` — wrap PUT /:id/layout, POST /storage-areas, and DELETE /:id using `db.transaction()` + `wrapClient()` (repo-standard pattern from `bottles.js:238`); call `syncStorageAreaSlots(txDb, ...)` after row mutations; call `resequenceFridgeSlots(txDb, cellarId)` for fridge areas
3. `tests/unit/services/cellar/slotReconciliation.test.js` — unit tests for syncStorageAreaSlots + resequenceFridgeSlots
4. `tests/unit/routes/storageAreas.test.js` — route tests for POST/PUT/DELETE slot provisioning + reconciliation

### Phase II — Consumer Fixes (Fix C)

5. `src/routes/cellar.js` — fix `getEmptyFridgeSlots()` sort order: `row_num, col_num` (area-scoped) and `display_order, row_num, col_num` (cross-cellar fallback)
6. `src/services/acquisitionWorkflow.js` — fix fridge slot lookup sort order: `display_order, row_num, col_num`
7. `src/services/cellar/cellarHealth.js` — fix `executeFillFridge()` sort order: `display_order, row_num, col_num`
8. `src/routes/bottles.js` — include `kitchen_fridge` in `getGridLimits()` fridge capacity
9. Unit tests for consumer fixes (cellar.test.js, acquisitionWorkflow.test.js, cellarHealth.test.js, bottles.test.js)

### Phase III — Frontend Stable Row Identity (Fix A)

10. `storageBuilder.js` — remove renumbering line from `removeRow()`
11. `onboarding.js` — remove renumbering from delete handler; add last-row guard; remap template rows for existing areas; pass `displayIndex` to `buildRowControl`; update row label
12. Unit tests — `storageBuilder.test.js` (row identity preservation via setAreas/getAreas)

### Phase IV — Frontend Add/Remove Areas (Fix B)

13. `onboarding.js` — add Remove/Add area controls to Step 2; update header for edit mode
14. `settings.js` — add 409 error handling + `deletedCount` tracking + accurate toast in DELETE loop
15. Manual test — edit + template + delete + slot provisioning flow end-to-end

---

## Implementation Log

### 2026-03-07
- **Completed**: All 15 steps implemented; 3528 unit tests pass (151 files)
- **Phase I**: `slotReconciliation.js` created with `syncStorageAreaSlots()` + `resequenceFridgeSlots()`; wired into `storageAreas.js` POST/PUT/DELETE via `db.transaction()` + `wrapClient()`
- **Phase II**: Fridge sort order fixed in `cellar.js` (both branches), `acquisitionWorkflow.js`, `cellarHealth.js`; `getGridLimits()` includes `kitchen_fridge`
- **Phase III**: `storageBuilder.js` `removeRow()` no longer renumbers; `onboarding.js` uses `displayIndex` labels, filter-only delete, `baseRow+i` template remap
- **Phase IV**: Add/Remove area controls in `onboarding.js`; `settings.js` surfaces 409 per-area toasts and holds wizard open on blocked deletes
- **Post-review fix (High)**: `syncStorageAreaSlots` now detects and rewrites kept slot `location_code`/`zone` on `storage_type` change (fridge↔non-fridge); returns `{ needsResequence }` so `PUT /:id/layout` triggers `resequenceFridgeSlots` to close F-sequence gaps
- **Post-review fix (High)**: Removed unconditional `finally` listener re-add in `handleStorageAreasSave`; listener re-registered only in stay-open paths (deleteErrors > 0, catch)
- **Post-review fix (Medium)**: `openStorageAreasWizard` unconditionally calls `setAreas(layout?.areas || [])` before `startOnboarding` to clear stale builder state
- **Deviations**: None — all phases implemented as designed; post-review fixes were additional hardening beyond the original plan scope
