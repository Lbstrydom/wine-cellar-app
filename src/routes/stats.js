/**
 * @fileoverview Statistics and layout endpoints.
 * @module routes/stats
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get cellar statistics.
 * @route GET /api/stats
 */
router.get('/', (req, res) => {
  const totalBottles = db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL').get();
  const byColour = db.prepare(`
    SELECT w.colour, COUNT(s.id) as count
    FROM slots s
    JOIN wines w ON w.id = s.wine_id
    GROUP BY w.colour
  `).all();
  const reduceNowCount = db.prepare('SELECT COUNT(*) as count FROM reduce_now').get();
  const emptySlots = db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NULL').get();
  const recentConsumption = db.prepare(`
    SELECT COUNT(*) as count FROM consumption_log
    WHERE consumed_at > datetime('now', '-30 days')
  `).get();

  res.json({
    total_bottles: totalBottles.count,
    by_colour: byColour,
    reduce_now_count: reduceNowCount.count,
    empty_slots: emptySlots.count,
    consumed_last_30_days: recentConsumption.count
  });
});

/**
 * Get full cellar layout.
 * @route GET /api/stats/layout
 */
router.get('/layout', (req, res) => {
  const slots = db.prepare(`
    SELECT
      s.id as slot_id,
      s.zone,
      s.location_code,
      s.row_num,
      s.col_num,
      w.id as wine_id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      w.price_eur,
      (SELECT rn.priority FROM reduce_now rn WHERE rn.wine_id = w.id) as reduce_priority,
      (SELECT rn.reduce_reason FROM reduce_now rn WHERE rn.wine_id = w.id) as reduce_reason
    FROM slots s
    LEFT JOIN wines w ON s.wine_id = w.id
    ORDER BY s.zone DESC, s.row_num, s.col_num
  `).all();

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
      reduce_priority: slot.reduce_priority,
      reduce_reason: slot.reduce_reason
    };

    if (slot.zone === 'fridge') {
      const fridgeRow = slot.row_num - 1;
      layout.fridge.rows[fridgeRow].slots.push(slotData);
    } else {
      layout.cellar.rows[slot.row_num - 1].slots.push(slotData);
    }
  });

  res.json(layout);
});

/**
 * Get consumption log.
 * @route GET /api/stats/consumption
 */
router.get('/consumption', (req, res) => {
  const log = db.prepare(`
    SELECT
      cl.*,
      w.wine_name,
      w.vintage,
      w.style,
      w.colour
    FROM consumption_log cl
    JOIN wines w ON w.id = cl.wine_id
    ORDER BY cl.consumed_at DESC
    LIMIT 50
  `).all();
  res.json(log);
});

export default router;
