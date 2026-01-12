/**
 * @fileoverview Slot operations (move, drink, add to slot).
 * @module routes/slots
 */

import { Router } from 'express';
import db from '../db/index.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  moveBottleSchema,
  swapBottleSchema,
  directSwapSchema,
  addToSlotSchema,
  drinkBottleSchema,
  locationParamSchema
} from '../schemas/slot.js';
import { invalidateAnalysisCache } from '../services/cacheService.js';

const router = Router();

/**
 * Move bottle between slots.
 * Uses database transaction for atomicity.
 * @route POST /api/slots/move
 */
router.post('/move', validateBody(moveBottleSchema), async (req, res) => {
  try {
    const { from_location, to_location } = req.body;

    // Validate slots exist and have correct state before transaction
    const sourceSlot = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, from_location);
    if (!sourceSlot?.wine_id) {
      return res.status(400).json({ error: 'Source slot is empty' });
    }

    const targetSlot = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, to_location);
    if (!targetSlot) {
      return res.status(404).json({ error: 'Target slot not found' });
    }
    if (targetSlot.wine_id) {
      return res.status(400).json({ error: 'Target slot is occupied' });
    }

    // Perform move atomically using transaction
    await db.transaction(async (client) => {
      await client.query('UPDATE slots SET wine_id = NULL WHERE cellar_id = $1 AND location_code = $2', [req.cellarId, from_location]);
      await client.query('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3', [sourceSlot.wine_id, req.cellarId, to_location]);
    });

    // Invalidate analysis cache since slot assignments changed
    await invalidateAnalysisCache();

    res.json({ message: 'Bottle moved' });
  } catch (error) {
    console.error('Move error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Swap two bottles between slots (3-way swap with temporary location).
 * Uses database transaction for atomicity.
 * @route POST /api/slots/swap
 */
router.post('/swap', validateBody(swapBottleSchema), async (req, res) => {
  try {
    const { slot_a, slot_b, displaced_to } = req.body;

    // Get wine IDs from both slots
    const slotA = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, slot_a);
    const slotB = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, slot_b);

    if (!slotA?.wine_id) {
      return res.status(400).json({ error: 'First slot is empty' });
    }
    if (!slotB?.wine_id) {
      return res.status(400).json({ error: 'Second slot is empty - use move instead' });
    }

    const displacedSlot = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, displaced_to);
    if (!displacedSlot) {
      return res.status(404).json({ error: 'Destination slot not found' });
    }
    if (displacedSlot.wine_id) {
      return res.status(400).json({ error: 'Destination slot is occupied' });
    }

    // Perform the swap atomically using transaction
    await db.transaction(async (client) => {
      // Move wine from slot_b to displaced_to
      await client.query('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3', [slotB.wine_id, req.cellarId, displaced_to]);
      // Move wine from slot_a to slot_b
      await client.query('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3', [slotA.wine_id, req.cellarId, slot_b]);
      // Clear slot_a
      await client.query('UPDATE slots SET wine_id = NULL WHERE cellar_id = $1 AND location_code = $2', [req.cellarId, slot_a]);
    });

    // Invalidate analysis cache since slot assignments changed
    await invalidateAnalysisCache();

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
 * Uses database transaction for atomicity.
 * @route POST /api/slots/direct-swap
 */
router.post('/direct-swap', validateBody(directSwapSchema), async (req, res) => {
  try {
    const { slot_a, slot_b } = req.body;

    // Get wine IDs from both slots
    const slotA = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, slot_a);
    const slotB = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, slot_b);

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

    // Perform the direct swap atomically using transaction
    await db.transaction(async (client) => {
      await client.query('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3', [slotB.wine_id, req.cellarId, slot_a]);
      await client.query('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3', [slotA.wine_id, req.cellarId, slot_b]);
    });

    // Invalidate analysis cache since slot assignments changed
    await invalidateAnalysisCache();

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
 * Uses database transaction for atomicity.
 * @route POST /api/slots/:location/drink
 */
router.post('/:location/drink', validateParams(locationParamSchema), validateBody(drinkBottleSchema), async (req, res) => {
  try {
    const { location } = req.params;
    const { occasion, pairing_dish, rating, notes } = req.body;

    const slot = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, location);
    if (!slot?.wine_id) {
      return res.status(400).json({ error: 'Slot is empty' });
    }

    const wineId = slot.wine_id;
    let remainingCount = 0;

    // Perform drink operation atomically using PostgreSQL transaction
    await db.transaction(async (client) => {
      // Log consumption
      await client.query(
        `INSERT INTO consumption_log (wine_id, slot_location, cellar_id, occasion, pairing_dish, rating, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [wineId, location, req.cellarId, occasion || null, pairing_dish || null, rating || null, notes || null]
      );

      // Clear slot
      await client.query('UPDATE slots SET wine_id = NULL WHERE cellar_id = $1 AND location_code = $2', [req.cellarId, location]);

      // Check remaining bottles
      const remaining = await client.query('SELECT COUNT(*) as count FROM slots WHERE cellar_id = $1 AND wine_id = $2', [req.cellarId, wineId]);
      remainingCount = parseInt(remaining.rows[0].count) || 0;

      // Remove from reduce_now if no bottles left
      if (remainingCount === 0) {
        await client.query('DELETE FROM reduce_now WHERE cellar_id = $1 AND wine_id = $2', [req.cellarId, wineId]);
      }
    });

    // Invalidate analysis cache since slot assignments changed
    await invalidateAnalysisCache();

    res.json({
      message: 'Bottle consumed and logged',
      remaining_bottles: remainingCount
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
router.post('/:location/add', validateParams(locationParamSchema), validateBody(addToSlotSchema), async (req, res) => {
  try {
    const { location } = req.params;
    const { wine_id } = req.body;

    const slot = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, location);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (slot.wine_id) {
      return res.status(400).json({ error: 'Slot is occupied' });
    }

    await db.prepare('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3').run(wine_id, req.cellarId, location);

    // Invalidate analysis cache since slot assignments changed
    await invalidateAnalysisCache();

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
router.delete('/:location/remove', validateParams(locationParamSchema), async (req, res) => {
  try {
    const { location } = req.params;

    const slot = await db.prepare('SELECT wine_id FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, location);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (!slot.wine_id) {
      return res.status(400).json({ error: 'Slot is already empty' });
    }

    await db.prepare('UPDATE slots SET wine_id = NULL WHERE cellar_id = $1 AND location_code = $2').run(req.cellarId, location);

    // Invalidate analysis cache since slot assignments changed
    await invalidateAnalysisCache();

    res.json({ message: `Bottle removed from ${location}` });
  } catch (error) {
    console.error('Remove error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mark bottle as open.
 * @route PUT /api/slots/:location/open
 */
router.put('/:location/open', validateParams(locationParamSchema), async (req, res) => {
  try {
    const { location } = req.params;

    const slot = await db.prepare('SELECT wine_id, is_open FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, location);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (!slot.wine_id) {
      return res.status(400).json({ error: 'Slot is empty' });
    }
    if (slot.is_open) {
      return res.status(400).json({ error: 'Bottle is already open' });
    }

    await db.prepare('UPDATE slots SET is_open = TRUE, opened_at = CURRENT_TIMESTAMP WHERE cellar_id = $1 AND location_code = $2').run(req.cellarId, location);

    res.json({ message: 'Bottle marked as open', location });
  } catch (error) {
    console.error('Open bottle error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mark bottle as sealed/closed (undo open).
 * @route PUT /api/slots/:location/seal
 */
router.put('/:location/seal', validateParams(locationParamSchema), async (req, res) => {
  try {
    const { location } = req.params;

    const slot = await db.prepare('SELECT wine_id, is_open FROM slots WHERE cellar_id = $1 AND location_code = $2').get(req.cellarId, location);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    if (!slot.wine_id) {
      return res.status(400).json({ error: 'Slot is empty' });
    }
    if (!slot.is_open) {
      return res.status(400).json({ error: 'Bottle is not open' });
    }

    await db.prepare('UPDATE slots SET is_open = FALSE, opened_at = NULL WHERE cellar_id = $1 AND location_code = $2').run(req.cellarId, location);

    res.json({ message: 'Bottle marked as sealed', location });
  } catch (error) {
    console.error('Seal bottle error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all open bottles.
 * @route GET /api/slots/open
 */
router.get('/open', async (req, res) => {
  try {
    const openBottles = await db.prepare(`
      SELECT
        s.location_code,
        s.opened_at,
        s.zone,
        w.id as wine_id,
        w.wine_name,
        w.vintage,
        w.colour,
        w.style
      FROM slots s
      JOIN wines w ON w.id = s.wine_id AND w.cellar_id = $1
      WHERE s.cellar_id = $1 AND s.is_open = TRUE
      ORDER BY s.opened_at DESC
    `).all(req.cellarId);

    res.json({
      count: openBottles.length,
      bottles: openBottles
    });
  } catch (error) {
    console.error('Get open bottles error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
