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
router.get('/', async (req, res) => {
  try {
    const totalBottles = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL').get();
    const byColour = await db.prepare(`
      SELECT w.colour, COUNT(s.id) as count
      FROM slots s
      JOIN wines w ON w.id = s.wine_id
      GROUP BY w.colour
    `).all();
    const reduceNowCount = await db.prepare('SELECT COUNT(*) as count FROM reduce_now').get();
    const emptySlots = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NULL').get();
    const recentConsumption = await db.prepare(`
      SELECT COUNT(*) as count FROM consumption_log
      WHERE consumed_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
    `).get();

    res.json({
      total_bottles: totalBottles?.count || 0,
      by_colour: byColour || [],
      reduce_now_count: reduceNowCount?.count || 0,
      empty_slots: emptySlots?.count || 0,
      consumed_last_30_days: recentConsumption?.count || 0
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get full cellar layout.
 * @route GET /api/stats/layout
 */
router.get('/layout', async (req, res) => {
  try {
    // Optimized: Use LEFT JOIN instead of correlated subqueries for reduce_now
    // This reduces 342 subqueries (2 per slot) to a single JOIN
    const slots = await db.prepare(`
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
        w.drink_from,
        w.drink_peak,
        w.drink_until,
        w.tasting_notes,
        rn.priority as reduce_priority,
        rn.reduce_reason
      FROM slots s
      LEFT JOIN wines w ON s.wine_id = w.id
      LEFT JOIN reduce_now rn ON rn.wine_id = w.id
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
      drink_from: slot.drink_from,
      drink_peak: slot.drink_peak,
      drink_until: slot.drink_until,
      tasting_notes: slot.tasting_notes,
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
  } catch (error) {
    console.error('Layout error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get consumption history with wine details and ratings.
 * @route GET /api/stats/consumption
 */
router.get('/consumption', async (req, res) => {
  try {
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
      ORDER BY cl.consumed_at DESC
      LIMIT $1 OFFSET $2
    `).all(limit, offset);

    const total = await db.prepare('SELECT COUNT(*) as count FROM consumption_log').get();

    res.json({
      items: log || [],
      total: total?.count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Consumption error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
