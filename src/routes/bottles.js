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
router.post('/add', (req, res) => {
  const { wine_id, start_location, quantity = 1 } = req.body;

  if (!wine_id || !start_location) {
    return res.status(400).json({ error: 'wine_id and start_location required' });
  }

  // Verify wine exists
  const wine = db.prepare('SELECT id FROM wines WHERE id = ?').get(wine_id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Parse start location and find consecutive slots
  const isFridge = start_location.startsWith('F');
  let slots = [];

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
  const existingSlots = db.prepare(`
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
  const updateStmt = db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?');

  for (const loc of slotsToFill) {
    updateStmt.run(wine_id, loc);
  }

  res.json({
    message: `Added ${slotsToFill.length} bottle(s)`,
    locations: slotsToFill
  });
});

export default router;
