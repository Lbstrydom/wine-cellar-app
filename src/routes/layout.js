/**
 * @fileoverview Legacy layout endpoint.
 * @module routes/layout
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get cellar layout.
 * Legacy endpoint kept for integration tests / older clients.
 * @route GET /api/layout
 */
router.get('/', async (req, res) => {
  try {
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
        w.tasting_notes
      FROM slots s
      LEFT JOIN wines w ON s.wine_id = w.id
      WHERE s.cellar_id = $1
      ORDER BY s.zone DESC, s.row_num, s.col_num
    `).all(req.cellarId);

    const fridge = [];
    const cellar = [];

    (slots || []).forEach((slot) => {
      const slotData = {
        slot_id: slot.slot_id,
        location_code: slot.location_code,
        row_num: slot.row_num,
        col_num: slot.col_num,
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
        is_open: slot.is_open,
        opened_at: slot.opened_at
      };

      if (slot.zone === 'fridge') {
        fridge.push(slotData);
      } else {
        cellar.push(slotData);
      }
    });

    res.json({ fridge, cellar });
  } catch (error) {
    console.error('Legacy layout error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
