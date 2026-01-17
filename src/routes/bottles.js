/**
 * @fileoverview Bottle management (add multiple, etc.).
 * @module routes/bottles
 */

import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';

const router = Router();

// Grid layout constants
const GRID_CONSTANTS = {
  FRIDGE_MAX_SLOT: 9,
  CELLAR_MAX_ROW: 19,
  CELLAR_ROW1_COLS: 7,
  CELLAR_OTHER_COLS: 9
};

// Input validation schema
const addBottlesSchema = z.object({
  wine_id: z.number().int().positive('wine_id must be a positive integer'),
  start_location: z.string()
    .min(2, 'start_location is required')
    .regex(/^(F\d+|R\d+C\d+)$/, 'Invalid location format (expected F# or R#C#)'),
  quantity: z.number().int().min(1).max(50).default(1)
});

/**
 * Add bottle(s) to consecutive slots.
 * @route POST /api/bottles/add
 */
router.post('/add', async (req, res) => {
  try {
    // Validate input
    const parseResult = addBottlesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.errors.map(e => e.message)
      });
    }

    const { wine_id, start_location, quantity } = parseResult.data;

    // Verify wine exists and belongs to this cellar
    const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wine_id);
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
        if (slotNum > GRID_CONSTANTS.FRIDGE_MAX_SLOT) break;
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
        const maxCol = row === 1 ? GRID_CONSTANTS.CELLAR_ROW1_COLS : GRID_CONSTANTS.CELLAR_OTHER_COLS;
        if (col > maxCol) {
          row++;
          col = 1;
          if (row > GRID_CONSTANTS.CELLAR_MAX_ROW) break;
        }
        slots.push(`R${row}C${col}`);
        col++;
      }
    }

    // Check which slots are empty
    const placeholders = slots.map((_, i) => `$${i + 1}`).join(',');
    const existingSlots = await db.prepare(
      'SELECT location_code, wine_id FROM slots WHERE location_code IN (' + placeholders + ')'
    ).all(...slots);
    // Safe: placeholders generated from slots array length, data passed to .all()

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
      await db.prepare('UPDATE slots SET wine_id = $1 WHERE location_code = $2').run(wine_id, loc);
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
