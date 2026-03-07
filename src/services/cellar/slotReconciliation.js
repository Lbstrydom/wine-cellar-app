/**
 * @fileoverview Slot reconciliation helpers for storage area mutations.
 * Ensures the slots table stays in sync with storage_area_rows definitions
 * after any POST, PUT /layout, or DELETE on storage areas.
 * @module services/cellar/slotReconciliation
 */

import { isFridgeType } from '../../config/storageTypes.js';

/**
 * Synchronise slot records with storage_area_rows definitions.
 * Must be called INSIDE an existing transaction.
 *
 * Growth path: inserts empty slot records for new coordinates.
 * Shrink path: deletes empty slot records outside desired coordinates (rows AND columns).
 * Occupied slots outside desired coords must already be rejected by the caller's validation.
 *
 * @param {Object} txDb - Transaction-scoped DB handle (from wrapClient)
 * @param {Object} params
 * @param {string} params.cellarId - Cellar UUID
 * @param {string} params.areaId - Storage area UUID
 * @param {string} params.storageType - 'cellar' | 'wine_fridge' | 'kitchen_fridge' | etc.
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

  // 3. Classify existing slots into kept (inside desired coords) and toDelete (outside, empty).
  //    For kept slots, rewrite location_code and zone when the area's storage_type has changed
  //    (e.g. wine_fridge → cellar leaves stale F... codes behind; cellar → wine_fridge leaves R...C... codes).
  const toDelete = [];
  const kept = new Set();
  let needsResequence = false;
  const targetFridge = isFridgeType(storageType);

  for (const slot of existingSlots) {
    const key = `${slot.row_num}:${slot.col_num}`;
    if (desired.has(key)) {
      kept.add(key);
      const slotIsFridge = slot.location_code.startsWith('F');
      if (targetFridge && !slotIsFridge) {
        // non-fridge → fridge: assign provisional fridge code (resequenceFridgeSlots will finalise)
        await txDb.prepare(
          `UPDATE slots SET location_code = $1, zone = 'fridge' WHERE id = $2`
        ).run(`F_TEMP_${slot.row_num}_${slot.col_num}`, slot.id);
      } else if (!targetFridge && slotIsFridge) {
        // fridge → non-fridge: assign cellar-style code and flag that remaining frids need resequencing
        await txDb.prepare(
          `UPDATE slots SET location_code = $1, zone = 'cellar' WHERE id = $2`
        ).run(`R${slot.row_num}C${slot.col_num}`, slot.id);
        needsResequence = true;
      }
    } else if (slot.wine_id === null) {
      toDelete.push(slot.id);
    }
    // Occupied slots outside desired coords: caller's validation must have already rejected this
  }

  // 4. Delete empty slots outside desired coordinates (handles row shrink AND column shrink)
  if (toDelete.length > 0) {
    // Batch in chunks to avoid hitting PostgreSQL bind-parameter limit
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      const placeholders = batch.map((_, j) => `$${j + 1}`).join(',');
      await txDb.prepare(`DELETE FROM slots WHERE id IN (${placeholders})`).run(...batch);
    }
  }

  // 5. Insert new empty slots for coordinates not already covered
  const zone = targetFridge ? 'fridge' : 'cellar';
  for (const row of rows) {
    for (let col = 1; col <= row.col_count; col++) {
      const key = `${row.row_num}:${col}`;
      if (!kept.has(key)) {
        // Fridge slots get provisional codes; resequenceFridgeSlots() assigns final F1..Fn
        const locationCode = targetFridge
          ? `F_TEMP_${row.row_num}_${col}`
          : `R${row.row_num}C${col}`;
        await txDb.prepare(`
          INSERT INTO slots (cellar_id, storage_area_id, zone, row_num, col_num, location_code)
          VALUES ($1, $2, $3, $4, $5, $6)
        `).run(cellarId, areaId, zone, row.row_num, col, locationCode);
      }
    }
  }

  return { needsResequence };
}

/**
 * Resequence all fridge slot location_codes to contiguous F1..Fn.
 * Must be called INSIDE an existing transaction.
 *
 * Uses a two-pass approach to avoid unique-key collisions when swapping codes (e.g. F1↔F2).
 * Canonical ordering: fridge areas by display_order, then rows by row_num, then cols by col_num.
 *
 * @param {Object} txDb - Transaction-scoped DB handle (from wrapClient)
 * @param {string} cellarId - Cellar UUID
 */
export async function resequenceFridgeSlots(txDb, cellarId) {
  const fridgeSlots = await txDb.prepare(`
    SELECT s.id, s.location_code
    FROM slots s
    JOIN storage_areas sa ON sa.id = s.storage_area_id
    WHERE s.cellar_id = $1
      AND sa.storage_type IN ('wine_fridge', 'kitchen_fridge')
    ORDER BY sa.display_order, s.row_num, s.col_num
  `).all(cellarId);

  if (fridgeSlots.length === 0) return;

  // Pass 1: Move all slots to temporary codes to avoid unique-key collisions
  for (const slot of fridgeSlots) {
    await txDb.prepare(`
      UPDATE slots SET location_code = $1 WHERE id = $2
    `).run(`__reseq_${slot.id}`, slot.id);
  }

  // Pass 2: Assign contiguous F1..Fn in canonical order
  for (let i = 0; i < fridgeSlots.length; i++) {
    await txDb.prepare(`
      UPDATE slots SET location_code = $1 WHERE id = $2
    `).run(`F${i + 1}`, fridgeSlots[i].id);
  }
}
