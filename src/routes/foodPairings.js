/**
 * @fileoverview Food pairings routes — list, rate, and add pairings per wine.
 * Pairings are AI-suggested (source='search') or user-added (source='manual').
 * User ratings use the same 1-5 star scale as wine ratings.
 * @module routes/foodPairings
 */

import { Router } from 'express';
import db from '../db/index.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/errorResponse.js';

const router = Router({ mergeParams: true });

/**
 * List all food pairings for a wine, including user ratings.
 * @route GET /api/wines/:wineId/food-pairings
 */
router.get('/:wineId/food-pairings', asyncHandler(async (req, res) => {
  const wineId = parseInt(req.params.wineId, 10);
  if (isNaN(wineId)) return res.status(400).json({ error: 'Invalid wineId' });

  // Verify wine belongs to this cellar
  const wine = await db.prepare(
    'SELECT id FROM wines WHERE id = $1 AND cellar_id = $2'
  ).get(wineId, req.cellarId);
  if (!wine) return res.status(404).json({ error: 'Wine not found' });

  const pairings = await db.prepare(`
    SELECT id, pairing, source, user_rating, notes, rated_at, created_at
    FROM wine_food_pairings
    WHERE wine_id = $1 AND cellar_id = $2
    ORDER BY
      user_rating DESC NULLS LAST,
      created_at ASC
  `).all(wineId, req.cellarId);

  res.json({ data: pairings, count: pairings.length });
}));

/**
 * Rate an existing pairing (1-5 stars, optional notes).
 * @route PATCH /api/wines/:wineId/food-pairings/:pairingId
 * @body {number} user_rating - 1 to 5
 * @body {string} [notes] - Optional tasting note
 */
router.patch('/:wineId/food-pairings/:pairingId', asyncHandler(async (req, res) => {
  const wineId = parseInt(req.params.wineId, 10);
  const pairingId = parseInt(req.params.pairingId, 10);
  if (isNaN(wineId) || isNaN(pairingId)) {
    return res.status(400).json({ error: 'Invalid wineId or pairingId' });
  }

  const { user_rating, notes } = req.body;

  if (user_rating !== null && user_rating !== undefined) {
    const rating = parseInt(user_rating, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'user_rating must be an integer between 1 and 5' });
    }
  }

  const result = await db.prepare(`
    UPDATE wine_food_pairings
    SET
      user_rating = $1,
      notes = COALESCE($2, notes),
      rated_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND wine_id = $4 AND cellar_id = $5
    RETURNING id, pairing, source, user_rating, notes, rated_at
  `).get(
    user_rating !== undefined ? parseInt(user_rating, 10) : null,
    notes ?? null,
    pairingId,
    wineId,
    req.cellarId
  );

  if (!result) return res.status(404).json({ error: 'Pairing not found' });

  logger.info('FoodPairings', `Rated pairing ${pairingId} for wine ${wineId}: ${user_rating} stars`);
  res.json({ message: 'Rating saved', data: result });
}));

/**
 * Add a manual food pairing for a wine.
 * @route POST /api/wines/:wineId/food-pairings
 * @body {string} pairing - Food pairing description
 * @body {number} [user_rating] - Optional immediate rating (1-5)
 * @body {string} [notes] - Optional notes
 */
router.post('/:wineId/food-pairings', asyncHandler(async (req, res) => {
  const wineId = parseInt(req.params.wineId, 10);
  if (isNaN(wineId)) return res.status(400).json({ error: 'Invalid wineId' });

  const { pairing, user_rating, notes } = req.body;
  if (!pairing || typeof pairing !== 'string' || !pairing.trim()) {
    return res.status(400).json({ error: 'pairing is required' });
  }
  if (user_rating !== undefined && user_rating !== null) {
    const r = parseInt(user_rating, 10);
    if (isNaN(r) || r < 1 || r > 5) {
      return res.status(400).json({ error: 'user_rating must be between 1 and 5' });
    }
  }

  // Verify wine belongs to this cellar
  const wine = await db.prepare(
    'SELECT id FROM wines WHERE id = $1 AND cellar_id = $2'
  ).get(wineId, req.cellarId);
  if (!wine) return res.status(404).json({ error: 'Wine not found' });

  const ratingVal = user_rating ? parseInt(user_rating, 10) : null;

  try {
    const row = await db.prepare(`
      INSERT INTO wine_food_pairings (wine_id, cellar_id, pairing, source, user_rating, notes, rated_at)
      VALUES ($1, $2, $3, 'manual', $4, $5, CASE WHEN $4 IS NOT NULL THEN CURRENT_TIMESTAMP END)
      ON CONFLICT (wine_id, cellar_id, pairing) DO UPDATE SET
        user_rating = COALESCE(EXCLUDED.user_rating, wine_food_pairings.user_rating),
        notes = COALESCE(EXCLUDED.notes, wine_food_pairings.notes),
        rated_at = CASE WHEN EXCLUDED.user_rating IS NOT NULL THEN CURRENT_TIMESTAMP ELSE wine_food_pairings.rated_at END
      RETURNING id, pairing, source, user_rating, notes, rated_at, created_at
    `).get(wineId, req.cellarId, pairing.trim(), ratingVal, notes ?? null);

    logger.info('FoodPairings', `Added manual pairing for wine ${wineId}: "${pairing.trim()}"`);
    res.status(201).json({ message: 'Pairing added', data: row });
  } catch (err) {
    logger.error('FoodPairings', `Failed to add pairing: ${err.message}`);
    res.status(500).json({ error: 'Failed to save pairing' });
  }
}));

export default router;
