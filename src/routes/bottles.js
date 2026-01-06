/**
 * @fileoverview Bottle management (add multiple, etc.).
 * @module routes/bottles
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Add bottle(s) to consecutive slots.
 * @route POST /api/bottles/add
 */
router.post('/add', async (req, res) => {
  try {
    const { wine_id, start_location, quantity = 1 } = req.body;

    if (!wine_id || !start_location) {
      return res.status(400).json({ error: 'wine_id and start_location required' });
    }

    // Verify wine exists
    const wine = await db.prepare('SELECT id FROM wines WHERE id = ?').get(wine_id);
    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    // Parse start location and find consecutive slots
    const isFridge = start_location.startsWith('F');
    const slots = [];

    if (isFridge) {
      const startNum = parseInt(start_location.substring(1));
      for (let i = 0; i < quantity; i++) {
        const slotNum = startNum + i;
        if (slotNum > 9) break;
        slots.push(`F${slotNum}`);
      }
    } else {
      const match = start_location.match(/R(\d+)C(\d+)/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid location format' });
      }

      let row = parseInt(match[1]);
      let col = parseInt(match[2]);

      for (let i = 0; i < quantity; i++) {
        const maxCol = row === 1 ? 7 : 9;
        if (col > maxCol) {
          row++;
          col = 1;
          if (row > 19) break;
        }
        slots.push(`R${row}C${col}`);
        col++;
      }
    }

    // Check which slots are empty
    const placeholders = slots.map(() => '?').join(',');
    const existingSlots = await db.prepare(`
      SELECT location_code, wine_id FROM slots WHERE location_code IN (${placeholders})
    `).all(...slots);

    const emptySlots = slots.filter(loc => {
      const slot = existingSlots.find(s => s.location_code === loc);
      return slot && !slot.wine_id;
    });

    if (emptySlots.length < quantity) {
      return res.status(400).json({
        error: `Not enough consecutive empty slots. Found ${emptySlots.length}, need ${quantity}.`
      });
    }

    // Fill slots
    const slotsToFill = emptySlots.slice(0, quantity);

    // Add bottles one by one (PostgreSQL doesn't have the same transaction API)
    for (const loc of slotsToFill) {
      await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(wine_id, loc);
    }

    res.json({
      message: `Added ${slotsToFill.length} bottle(s)`,
      locations: slotsToFill
    });
  } catch (error) {
    console.error('Add bottles error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
