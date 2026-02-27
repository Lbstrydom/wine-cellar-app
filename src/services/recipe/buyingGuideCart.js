/**
 * @fileoverview Buying guide cart service — CRUD, state machine,
 * summary, and active items for virtual inventory.
 * @module services/recipe/buyingGuideCart
 */

import db from '../../db/index.js';
import logger from '../../utils/logger.js';
import { inferStyleForItem } from './styleInference.js';
import { invalidateBuyingGuideCache } from './buyingGuide.js';

/**
 * Valid status transitions (state machine).
 * Key = current status, value = set of allowed next statuses.
 */
const VALID_TRANSITIONS = {
  planned:   new Set(['ordered', 'arrived', 'cancelled']),
  ordered:   new Set(['arrived', 'cancelled']),
  arrived:   new Set([]),          // conversion handled separately
  cancelled: new Set(['planned'])  // recovery path
};

/**
 * List buying guide items for a cellar with optional filters.
 * @param {string} cellarId - Cellar UUID
 * @param {Object} [filters] - Optional filters
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.style_id] - Filter by style bucket
 * @param {number} [filters.limit=50] - Page size
 * @param {number} [filters.offset=0] - Page offset
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function listItems(cellarId, filters = {}) {
  const { status, style_id, limit = 50, offset = 0 } = filters;

  const ORDER_SUFFIX =
    ' ORDER BY CASE status' +
    " WHEN 'planned' THEN 1 WHEN 'ordered' THEN 2" +
    " WHEN 'arrived' THEN 3 WHEN 'cancelled' THEN 4 END," +
    ' created_at DESC';

  let countResult, items;

  if (status && style_id) {
    countResult = await db.prepare(
      'SELECT COUNT(*) as count FROM buying_guide_items' +
      ' WHERE cellar_id = $1 AND status = $2 AND style_id = $3'
    ).get(cellarId, status, style_id);
    items = await db.prepare(
      'SELECT * FROM buying_guide_items' +
      ' WHERE cellar_id = $1 AND status = $2 AND style_id = $3' +
      ORDER_SUFFIX + ' LIMIT $4 OFFSET $5'
    ).all(cellarId, status, style_id, limit, offset);
  } else if (status) {
    countResult = await db.prepare(
      'SELECT COUNT(*) as count FROM buying_guide_items' +
      ' WHERE cellar_id = $1 AND status = $2'
    ).get(cellarId, status);
    items = await db.prepare(
      'SELECT * FROM buying_guide_items' +
      ' WHERE cellar_id = $1 AND status = $2' +
      ORDER_SUFFIX + ' LIMIT $3 OFFSET $4'
    ).all(cellarId, status, limit, offset);
  } else if (style_id) {
    countResult = await db.prepare(
      'SELECT COUNT(*) as count FROM buying_guide_items' +
      ' WHERE cellar_id = $1 AND style_id = $2'
    ).get(cellarId, style_id);
    items = await db.prepare(
      'SELECT * FROM buying_guide_items' +
      ' WHERE cellar_id = $1 AND style_id = $2' +
      ORDER_SUFFIX + ' LIMIT $3 OFFSET $4'
    ).all(cellarId, style_id, limit, offset);
  } else {
    countResult = await db.prepare(
      'SELECT COUNT(*) as count FROM buying_guide_items' +
      ' WHERE cellar_id = $1'
    ).get(cellarId);
    items = await db.prepare(
      'SELECT * FROM buying_guide_items' +
      ' WHERE cellar_id = $1' +
      ORDER_SUFFIX + ' LIMIT $2 OFFSET $3'
    ).all(cellarId, limit, offset);
  }

  return { items, total: Number(countResult?.count) || 0 };
}

/**
 * Get a single buying guide item.
 * @param {string} cellarId - Cellar UUID
 * @param {number} id - Item ID
 * @returns {Promise<Object|null>}
 */
export async function getItem(cellarId, id) {
  return db.prepare(
    'SELECT * FROM buying_guide_items WHERE id = $1 AND cellar_id = $2'
  ).get(id, cellarId);
}

/**
 * Create a buying guide item.
 * Auto-infers style when not provided using the style inference pipeline.
 * @param {string} cellarId - Cellar UUID
 * @param {Object} data - Item data (validated by schema)
 * @returns {Promise<Object>} Created item (includes style_inferred flag)
 */
export async function createItem(cellarId, data) {
  // Auto-infer style if not provided
  let styleId = data.style_id || null;
  let styleConfidence = null;
  let styleInferred = false;

  if (!styleId) {
    const inference = inferStyleForItem(data);
    if (inference.styleId) {
      styleId = inference.styleId;
      styleConfidence = inference.confidence;
      styleInferred = true;
    }
  }

  const result = await db.prepare(`
    INSERT INTO buying_guide_items (
      cellar_id, wine_name, producer, quantity, style_id,
      inferred_style_confidence, price, currency, vendor_url,
      vintage, colour, grapes, region, country, notes,
      source, source_gap_style
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING *
  `).get(
    cellarId,
    data.wine_name,
    data.producer || null,
    data.quantity ?? 1,
    styleId,
    styleConfidence,
    data.price ?? null,
    data.currency || 'ZAR',
    data.vendor_url || null,
    data.vintage ?? null,
    data.colour || null,
    data.grapes || null,
    data.region || null,
    data.country || null,
    data.notes || null,
    data.source || 'manual',
    data.source_gap_style || null
  );

  // Attach inference metadata (not persisted, response-only)
  if (result && styleInferred) {
    result.style_inferred = true;
    result.needs_style_confirmation = styleConfidence === 'low';
  }

  // Invalidate buying guide cache (virtual inventory changed)
  invalidateBuyingGuideCache(cellarId).catch(() => {});

  return result;
}

/**
 * Update a buying guide item (partial update).
 * @param {string} cellarId - Cellar UUID
 * @param {number} id - Item ID
 * @param {Object} data - Fields to update
 * @returns {Promise<Object|null>} Updated item or null if not found
 */
export async function updateItem(cellarId, id, data) {
  // Build SET clause dynamically from provided fields
  const allowedFields = [
    'wine_name', 'producer', 'quantity', 'style_id',
    'inferred_style_confidence', 'price', 'currency', 'vendor_url',
    'vintage', 'colour', 'grapes', 'region', 'country', 'notes',
    'source', 'source_gap_style'
  ];

  const sets = [];
  const params = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (field in data) {
      sets.push(field + ' = $' + idx);
      params.push(data[field] ?? null);
      idx++;
    }
  }

  if (sets.length === 0) return getItem(cellarId, id);

  // Always update updated_at explicitly (no triggers)
  sets.push('updated_at = NOW()');

  params.push(id, cellarId);
  const result = await db.prepare(
    'UPDATE buying_guide_items SET ' + sets.join(', ') +
    ' WHERE id = $' + idx + ' AND cellar_id = $' + (idx + 1) +
    ' RETURNING *'
  ).get(...params);

  return result || null;
}

/**
 * Update item status with state machine validation.
 * @param {string} cellarId - Cellar UUID
 * @param {number} id - Item ID
 * @param {string} newStatus - Target status
 * @returns {Promise<{item: Object|null, error: string|null}>}
 */
export async function updateItemStatus(cellarId, id, newStatus) {
  const item = await getItem(cellarId, id);
  if (!item) return { item: null, error: 'Item not found' };

  const allowed = VALID_TRANSITIONS[item.status];
  if (!allowed || !allowed.has(newStatus)) {
    return {
      item: null,
      error: `Cannot transition from '${item.status}' to '${newStatus}'`
    };
  }

  const updated = await db.prepare(`
    UPDATE buying_guide_items
    SET status = $1, status_changed_at = NOW(), updated_at = NOW()
    WHERE id = $2 AND cellar_id = $3
    RETURNING *
  `).get(newStatus, id, cellarId);

  invalidateBuyingGuideCache(cellarId).catch(() => {});

  return { item: updated, error: null };
}

/**
 * Batch update status for multiple items.
 * Validates each transition individually; skips invalid ones.
 * @param {string} cellarId - Cellar UUID
 * @param {number[]} ids - Item IDs
 * @param {string} newStatus - Target status
 * @returns {Promise<{updated: number, skipped: Array<{id: number, reason: string}>}>}
 */
export async function batchUpdateStatus(cellarId, ids, newStatus) {
  const skipped = [];
  let updated = 0;

  for (const id of ids) {
    const result = await updateItemStatus(cellarId, id, newStatus);
    if (result.error) {
      skipped.push({ id, reason: result.error });
    } else {
      updated++;
    }
  }

  return { updated, skipped };
}

/**
 * Delete a buying guide item (non-converted only).
 * @param {string} cellarId - Cellar UUID
 * @param {number} id - Item ID
 * @returns {Promise<{deleted: boolean, error: string|null}>}
 */
export async function deleteItem(cellarId, id) {
  const item = await getItem(cellarId, id);
  if (!item) return { deleted: false, error: 'Item not found' };

  if (item.converted_wine_id != null) {
    return { deleted: false, error: 'Cannot delete a converted item' };
  }

  await db.prepare(
    'DELETE FROM buying_guide_items WHERE id = $1 AND cellar_id = $2'
  ).run(id, cellarId);

  invalidateBuyingGuideCache(cellarId).catch(() => {});

  return { deleted: true, error: null };
}

/**
 * Get cart summary: counts by status + currency-segmented totals.
 * @param {string} cellarId - Cellar UUID
 * @returns {Promise<Object>} Summary with status counts and totals by currency
 */
export async function getCartSummary(cellarId) {
  // Status counts
  const statusRows = await db.prepare(`
    SELECT status, COUNT(*) as count, SUM(quantity) as bottles
    FROM buying_guide_items
    WHERE cellar_id = $1
    GROUP BY status
  `).all(cellarId);

  const counts = {};
  for (const row of statusRows) {
    counts[row.status] = {
      items: Number(row.count),
      bottles: Number(row.bottles)
    };
  }

  // Currency-segmented totals (only non-cancelled items with a price)
  const costRows = await db.prepare(`
    SELECT currency, SUM(quantity) as bottles, SUM(price * quantity) as cost
    FROM buying_guide_items
    WHERE cellar_id = $1 AND status != 'cancelled' AND price IS NOT NULL
    GROUP BY currency
  `).all(cellarId);

  const totals = {};
  for (const row of costRows) {
    const cur = row.currency || 'ZAR';
    totals[cur] = {
      bottles: Number(row.bottles),
      cost: Number(row.cost)
    };
  }

  return { counts, totals };
}

/**
 * Get active (non-converted) items for virtual inventory projection.
 * Includes planned + ordered + arrived where converted_wine_id IS NULL.
 * @param {string} cellarId - Cellar UUID
 * @returns {Promise<Array>} Active items
 */
export async function getActiveItems(cellarId) {
  return db.prepare(`
    SELECT * FROM buying_guide_items
    WHERE cellar_id = $1
      AND status IN ('planned', 'ordered', 'arrived')
      AND converted_wine_id IS NULL
    ORDER BY created_at DESC
  `).all(cellarId);
}
