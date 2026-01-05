/**
 * @fileoverview Slot operations (move, drink, add to slot).
 * @module routes/slots
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Move bottle between slots.
 * @route POST /api/slots/move
 */
router.post('/move', (req, res) => {
  const { from_location, to_location } = req.body;

  const sourceSlot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(from_location);
  if (!sourceSlot || !sourceSlot.wine_id) {
    return res.status(400).json({ error: 'Source slot is empty' });
  }

  const targetSlot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(to_location);
  if (!targetSlot) {
    return res.status(404).json({ error: 'Target slot not found' });
  }
  if (targetSlot.wine_id) {
    return res.status(400).json({ error: 'Target slot is occupied' });
  }

  // Wrap in transaction to ensure atomic operation
  const moveTransaction = db.transaction(() => {
    db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(from_location);
    db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(sourceSlot.wine_id, to_location);
  });

  moveTransaction();

  res.json({ message: 'Bottle moved' });
});

/**
 * Swap two bottles between slots (3-way swap with temporary location).
 * @route POST /api/slots/swap
 */
router.post('/swap', (req, res) => {
  const { slot_a, slot_b, displaced_to } = req.body;

  // Get wine IDs from both slots
  const slotA = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(slot_a);
  const slotB = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(slot_b);

  if (!slotA || !slotA.wine_id) {
    return res.status(400).json({ error: 'First slot is empty' });
  }
  if (!slotB || !slotB.wine_id) {
    return res.status(400).json({ error: 'Second slot is empty - use move instead' });
  }

  const displacedSlot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(displaced_to);
  if (!displacedSlot) {
    return res.status(404).json({ error: 'Destination slot not found' });
  }
  if (displacedSlot.wine_id) {
    return res.status(400).json({ error: 'Destination slot is occupied' });
  }

  // Perform the swap in a transaction
  const swapTransaction = db.transaction(() => {
    // Move wine from slot_b to displaced_to
    db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(slotB.wine_id, displaced_to);
    // Move wine from slot_a to slot_b
    db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(slotA.wine_id, slot_b);
    // Clear slot_a
    db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(slot_a);
  });

  swapTransaction();

  res.json({
    message: 'Bottles swapped',
    moves: [
      { from: slot_b, to: displaced_to },
      { from: slot_a, to: slot_b }
    ]
  });
});

/**
 * Drink bottle (log consumption and clear slot).
 * @route POST /api/slots/:location/drink
 */
router.post('/:location/drink', (req, res) => {
  const { location } = req.params;
  const { occasion, pairing_dish, rating, notes } = req.body;

  const slot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
  if (!slot || !slot.wine_id) {
    return res.status(400).json({ error: 'Slot is empty' });
  }

  // Wrap in transaction to ensure atomic logging and slot clearing
  const drinkTransaction = db.transaction(() => {
    // Log consumption
    db.prepare(`
      INSERT INTO consumption_log (wine_id, slot_location, occasion, pairing_dish, rating, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(slot.wine_id, location, occasion || null, pairing_dish || null, rating || null, notes || null);

    // Clear slot
    db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(location);

    // Check remaining bottles
    const remaining = db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id = ?').get(slot.wine_id);

    // Remove from reduce_now if no bottles left
    if (remaining.count === 0) {
      db.prepare('DELETE FROM reduce_now WHERE wine_id = ?').run(slot.wine_id);
    }

    return remaining;
  });

  const remaining = drinkTransaction();

  res.json({
    message: 'Bottle consumed and logged',
    remaining_bottles: remaining.count
  });
});

/**
 * Add bottle to empty slot.
 * @route POST /api/slots/:location/add
 */
router.post('/:location/add', (req, res) => {
  const { location } = req.params;
  const { wine_id } = req.body;

  const slot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  if (slot.wine_id) {
    return res.status(400).json({ error: 'Slot is occupied' });
  }

  db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(wine_id, location);
  res.json({ message: 'Bottle added to slot' });
});

/**
 * Remove bottle from slot without logging consumption.
 * @route DELETE /api/slots/:location/remove
 */
router.delete('/:location/remove', (req, res) => {
  const { location } = req.params;

  const slot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  if (!slot.wine_id) {
    return res.status(400).json({ error: 'Slot is already empty' });
  }

  db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(location);

  res.json({ message: `Bottle removed from ${location}` });
});

export default router;
