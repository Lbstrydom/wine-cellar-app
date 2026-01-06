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
router.post('/move', async (req, res) => {
  try {
    const { from_location, to_location } = req.body;

    const sourceSlot = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(from_location);
    if (!sourceSlot || !sourceSlot.wine_id) {
      return res.status(400).json({ error: 'Source slot is empty' });
    }

    const targetSlot = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(to_location);
    if (!targetSlot) {
      return res.status(404).json({ error: 'Target slot not found' });
    }
    if (targetSlot.wine_id) {
      return res.status(400).json({ error: 'Target slot is occupied' });
    }

    // Perform move - for PostgreSQL we don't have built-in transaction helper,
    // but these two operations should be atomic enough for this use case
    await db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(from_location);
    await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(sourceSlot.wine_id, to_location);

    res.json({ message: 'Bottle moved' });
  } catch (error) {
    console.error('Move error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Swap two bottles between slots (3-way swap with temporary location).
 * @route POST /api/slots/swap
 */
router.post('/swap', async (req, res) => {
  try {
    const { slot_a, slot_b, displaced_to } = req.body;

    // Get wine IDs from both slots
    const slotA = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(slot_a);
    const slotB = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(slot_b);

    if (!slotA || !slotA.wine_id) {
      return res.status(400).json({ error: 'First slot is empty' });
    }
    if (!slotB || !slotB.wine_id) {
      return res.status(400).json({ error: 'Second slot is empty - use move instead' });
    }

    const displacedSlot = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(displaced_to);
    if (!displacedSlot) {
      return res.status(404).json({ error: 'Destination slot not found' });
    }
    if (displacedSlot.wine_id) {
      return res.status(400).json({ error: 'Destination slot is occupied' });
    }

    // Perform the swap
    // Move wine from slot_b to displaced_to
    await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(slotB.wine_id, displaced_to);
    // Move wine from slot_a to slot_b
    await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(slotA.wine_id, slot_b);
    // Clear slot_a
    await db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(slot_a);

    res.json({
      message: 'Bottles swapped',
      moves: [
        { from: slot_b, to: displaced_to },
        { from: slot_a, to: slot_b }
      ]
    });
  } catch (error) {
    console.error('Swap error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Direct swap between two occupied slots.
 * @route POST /api/slots/direct-swap
 */
router.post('/direct-swap', async (req, res) => {
  try {
    const { slot_a, slot_b } = req.body;

    if (!slot_a || !slot_b) {
      return res.status(400).json({ error: 'Both slot_a and slot_b are required' });
    }

    // Get wine IDs from both slots
    const slotA = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(slot_a);
    const slotB = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(slot_b);

    if (!slotA) {
      return res.status(404).json({ error: `Slot ${slot_a} not found` });
    }
    if (!slotB) {
      return res.status(404).json({ error: `Slot ${slot_b} not found` });
    }
    if (!slotA.wine_id) {
      return res.status(400).json({ error: `Slot ${slot_a} is empty` });
    }
    if (!slotB.wine_id) {
      return res.status(400).json({ error: `Slot ${slot_b} is empty - use move instead` });
    }

    // Perform the direct swap
    // Swap the wine IDs between the two slots
    await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(slotB.wine_id, slot_a);
    await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(slotA.wine_id, slot_b);

    res.json({
      message: 'Bottles swapped',
      swap: { slot_a, slot_b }
    });
  } catch (error) {
    console.error('Direct swap error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Drink bottle (log consumption and clear slot).
 * @route POST /api/slots/:location/drink
 */
router.post('/:location/drink', async (req, res) => {
  try {
    const { location } = req.params;
    const { occasion, pairing_dish, rating, notes } = req.body;

    const slot = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
    if (!slot || !slot.wine_id) {
      return res.status(400).json({ error: 'Slot is empty' });
    }

    const wineId = slot.wine_id;

    // Log consumption
    await db.prepare(`
      INSERT INTO consumption_log (wine_id, slot_location, occasion, pairing_dish, rating, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(wineId, location, occasion || null, pairing_dish || null, rating || null, notes || null);

    // Clear slot
    await db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(location);

    // Check remaining bottles
    const remaining = await db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id = ?').get(wineId);

    // Remove from reduce_now if no bottles left
    if (remaining.count === 0 || remaining.count === '0') {
      await db.prepare('DELETE FROM reduce_now WHERE wine_id = ?').run(wineId);
    }

    res.json({
      message: 'Bottle consumed and logged',
      remaining_bottles: parseInt(remaining.count) || 0
    });
  } catch (error) {
    console.error('Drink error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add bottle to empty slot.
 * @route POST /api/slots/:location/add
 */
router.post('/:location/add', async (req, res) => {
  try {
    const { location } = req.params;
    const { wine_id } = req.body;

    const slot = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (slot.wine_id) {
      return res.status(400).json({ error: 'Slot is occupied' });
    }

    await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(wine_id, location);
    res.json({ message: 'Bottle added to slot' });
  } catch (error) {
    console.error('Add to slot error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Remove bottle from slot without logging consumption.
 * @route DELETE /api/slots/:location/remove
 */
router.delete('/:location/remove', async (req, res) => {
  try {
    const { location } = req.params;

    const slot = await db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (!slot.wine_id) {
      return res.status(400).json({ error: 'Slot is already empty' });
    }

    await db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(location);

    res.json({ message: `Bottle removed from ${location}` });
  } catch (error) {
    console.error('Remove error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
