/**
 * @fileoverview Statistics and layout endpoints.
 * @module routes/stats
 */

import { Router } from 'express';
import db from '../db/index.js';
import { asyncHandler } from '../utils/errorResponse.js';

const router = Router();

/**
 * Get cellar statistics.
 * @route GET /api/stats
 */
router.get('/', asyncHandler(async (req, res) => {
  const totalBottles = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE cellar_id = $1 AND wine_id IS NOT NULL').get(req.cellarId);
  const byColour = await db.prepare(`
    SELECT w.colour, COUNT(s.id) as count
    FROM slots s
    JOIN wines w ON w.id = s.wine_id AND w.cellar_id = $1
    WHERE s.cellar_id = $1
    GROUP BY w.colour
  `).all(req.cellarId);
  const reduceNowCount = await db.prepare('SELECT COUNT(*) as count FROM reduce_now WHERE cellar_id = $1').get(req.cellarId);
  const emptySlots = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE cellar_id = $1 AND wine_id IS NULL').get(req.cellarId);
  const recentConsumption = await db.prepare(`
    SELECT COUNT(*) as count FROM consumption_log
    WHERE cellar_id = $1 AND consumed_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
  `).get(req.cellarId);
  const openBottles = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE cellar_id = $1 AND is_open = TRUE').get(req.cellarId);
  const grapeHealth = await db.prepare(`
    SELECT COUNT(DISTINCT w.id) AS total,
           COUNT(DISTINCT w.id) FILTER (WHERE w.grapes IS NULL OR w.grapes = '') AS missing
    FROM wines w
    JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1
    WHERE w.cellar_id = $1
  `).get(req.cellarId);

  const byColourNormalized = (byColour || []).map((row) => ({
    ...row,
    count: Number(row?.count ?? 0)
  }));

  res.json({
    total_bottles: Number(totalBottles?.count ?? 0),
    by_colour: byColourNormalized,
    reduce_now_count: Number(reduceNowCount?.count ?? 0),
    empty_slots: Number(emptySlots?.count ?? 0),
    consumed_last_30_days: Number(recentConsumption?.count ?? 0),
    open_bottles: Number(openBottles?.count ?? 0),
    grape_total: Number(grapeHealth?.total ?? 0),
    grape_missing: Number(grapeHealth?.missing ?? 0)
  });
}));

/**
 * Get full cellar layout.
 * @route GET /api/stats/layout
 */
router.get('/layout', asyncHandler(async (req, res) => {
  const isLite = String(req.query.lite).toLowerCase() === 'true';

  // Detect dynamic storage areas for this cellar
  const areaCountRow = await db.prepare(`
    SELECT COUNT(*) AS count FROM storage_areas WHERE cellar_id = $1
  `).get(req.cellarId);
  const hasDynamicAreas = Number(areaCountRow?.count ?? 0) > 0;

  if (!hasDynamicAreas) {
    // Legacy layout fallback (fridge + cellar)
    const slots = await db.prepare(`
      SELECT
        s.id as slot_id,
        s.zone,
        s.location_code,
        s.row_num,
        s.col_num,
        s.is_open,
        s.opened_at,
        w.id as wine_id,
        w.style,
        w.colour,
        w.wine_name,
        w.vintage,
        w.vivino_rating,
        w.price_eur,
        w.drink_from,
        w.drink_peak,
        w.drink_until,
        w.tasting_notes,
        rn.priority as reduce_priority,
        rn.reduce_reason
      FROM slots s
      LEFT JOIN wines w ON s.wine_id = w.id AND w.cellar_id = $1
      LEFT JOIN reduce_now rn ON rn.wine_id = w.id AND rn.cellar_id = $1
      WHERE s.cellar_id = $1
      ORDER BY s.zone DESC, s.row_num, s.col_num
    `).all(req.cellarId);

    const layout = {
      fridge: { rows: [{ slots: [] }, { slots: [] }] },
      cellar: { rows: [] }
    };

    for (let r = 1; r <= 19; r++) {
      const maxCol = r === 1 ? 7 : 9;
      layout.cellar.rows.push({ row: r, maxCols: maxCol, slots: [] });
    }

    slots.forEach(slot => {
      const slotData = {
        slot_id: slot.slot_id,
        location_code: slot.location_code,
        wine_id: slot.wine_id,
        wine_name: slot.wine_name,
        vintage: slot.vintage,
        colour: slot.colour,
        style: slot.style,
        rating: slot.vivino_rating,
        price: slot.price_eur,
        drink_from: slot.drink_from,
        drink_peak: slot.drink_peak,
        drink_until: slot.drink_until,
        tasting_notes: slot.tasting_notes,
        reduce_priority: slot.reduce_priority,
        reduce_reason: slot.reduce_reason,
        is_open: slot.is_open,
        opened_at: slot.opened_at
      };

      if (slot.zone === 'fridge') {
        const fridgeRow = slot.row_num - 1;
        layout.fridge.rows[fridgeRow].slots.push(slotData);
      } else {
        layout.cellar.rows[slot.row_num - 1].slots.push(slotData);
      }
    });

    return res.json(layout);
  }

  // Dynamic storage areas path
  // Fetch areas metadata
  const areas = await db.prepare(`
    SELECT id, name, storage_type, temp_zone, display_order
    FROM storage_areas
    WHERE cellar_id = $1
    ORDER BY display_order, created_at
  `).all(req.cellarId);

  // Dynamic storage areas format: { areas: [...] }
  // Fetch all rows for these areas
  const areaIds = areas.map(a => a.id);
  let rows = [];
  if (areaIds.length > 0) {
    rows = await db.prepare(`
      SELECT storage_area_id, row_num, col_count, label
      FROM storage_area_rows
      WHERE storage_area_id = ANY($1)
      ORDER BY storage_area_id, row_num
    `).all(areaIds);
  }

  // Build base structure
  const layout = { areas: [] };
  const areaMap = new Map();
  for (const area of areas) {
    const entry = {
      id: area.id,
      name: area.name,
      storage_type: area.storage_type,
      temp_zone: area.temp_zone,
      rows: []
    };
    layout.areas.push(entry);
    areaMap.set(area.id, entry);
  }

  for (const r of rows) {
    const parent = areaMap.get(r.storage_area_id);
    if (parent) {
      parent.rows.push({ row_num: r.row_num, col_count: r.col_count, label: r.label });
    }
  }

  if (isLite) {
    // Lite mode: return only structure without slot occupancy
    return res.json(layout);
  }

  // Full mode: include slot occupancy per area/row/col
  const slotRows = await db.prepare(`
    SELECT
      s.id as slot_id,
      s.storage_area_id,
      s.location_code,
      s.row_num,
      s.col_num,
      s.is_open,
      s.opened_at,
      w.id as wine_id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      w.price_eur,
      w.drink_from,
      w.drink_peak,
      w.drink_until,
      w.tasting_notes,
      rn.priority as reduce_priority,
      rn.reduce_reason
    FROM slots s
    LEFT JOIN wines w ON s.wine_id = w.id AND w.cellar_id = $1
    LEFT JOIN reduce_now rn ON rn.wine_id = w.id AND rn.cellar_id = $1
    WHERE s.cellar_id = $1
    ORDER BY s.storage_area_id, s.row_num, s.col_num
  `).all(req.cellarId);

  // Create row slots arrays
  for (const area of layout.areas) {
    for (const row of area.rows) {
      row.slots = [];
    }
  }

  // Helper map for row lookup
  const rowKeyMap = new Map();
  for (const area of layout.areas) {
    for (const row of area.rows) {
      rowKeyMap.set(`${area.id}:${row.row_num}`, row);
    }
  }

  for (const s of slotRows) {
    const rowKey = `${s.storage_area_id}:${s.row_num}`;
    const row = rowKeyMap.get(rowKey);
    if (!row) continue;

    row.slots.push({
      slot_id: s.slot_id,
      location_code: s.location_code,
      wine_id: s.wine_id,
      wine_name: s.wine_name,
      vintage: s.vintage,
      colour: s.colour,
      style: s.style,
      rating: s.vivino_rating,
      price: s.price_eur,
      drink_from: s.drink_from,
      drink_peak: s.drink_peak,
      drink_until: s.drink_until,
      tasting_notes: s.tasting_notes,
      reduce_priority: s.reduce_priority,
      reduce_reason: s.reduce_reason,
      is_open: s.is_open,
      opened_at: s.opened_at
    });
  }

  return res.json(layout);
}));

/**
 * Get consumption history with wine details and ratings.
 * @route GET /api/stats/consumption
 */
router.get('/consumption', asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const log = await db.prepare(`
    SELECT
      cl.id,
      cl.wine_id,
      cl.slot_location,
      cl.consumed_at,
      cl.occasion,
      cl.pairing_dish,
      cl.rating as consumption_rating,
      cl.notes as consumption_notes,
      w.wine_name,
      w.vintage,
      w.style,
      w.colour,
      w.country,
      w.personal_rating,
      w.personal_notes,
      w.purchase_score,
      w.purchase_stars
    FROM consumption_log cl
    JOIN wines w ON w.id = cl.wine_id
    WHERE cl.cellar_id = $1
    ORDER BY cl.consumed_at DESC
    LIMIT $2 OFFSET $3
  `).all(req.cellarId, limit, offset);

  const total = await db.prepare('SELECT COUNT(*) as count FROM consumption_log WHERE cellar_id = $1').get(req.cellarId);

  res.json({
    items: log || [],
    total: total?.count || 0,
    limit: Number.parseInt(limit, 10),
    offset: Number.parseInt(offset, 10)
  });
}));

export default router;
