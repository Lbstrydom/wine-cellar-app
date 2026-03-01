/**
 * @fileoverview Pending rating reminder endpoints.
 * Tracks consumed wines awaiting user rating (drink-now-rate-later flow).
 * @module routes/pendingRatings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { asyncHandler } from '../utils/errorResponse.js';

const router = Router();

/**
 * GET /api/pending-ratings
 * Get unresolved pending ratings for this cellar.
 * Joins with consumption_log to check if event already has a rating.
 */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
    SELECT pr.id, pr.consumption_log_id, pr.wine_id, pr.wine_name,
           pr.vintage, pr.colour, pr.style, pr.location_code, pr.consumed_at,
           cl.rating as existing_rating, cl.notes as existing_notes
    FROM pending_ratings pr
    LEFT JOIN consumption_log cl ON cl.id = pr.consumption_log_id
    WHERE pr.cellar_id = $1 AND pr.status = 'pending'
    ORDER BY pr.consumed_at DESC
  `).all(req.cellarId);

  // Separate: needs rating vs already has a rating on the consumption event
  const needsRating = [];
  const alreadyRated = [];
  for (const row of rows) {
    if (row.existing_rating != null) {
      alreadyRated.push(row);
    } else {
      needsRating.push(row);
    }
  }

  res.json({ needsRating, alreadyRated });
}));

/**
 * PUT /api/pending-ratings/:id/resolve
 * Mark a pending rating as rated or dismissed.
 * When 'rated', updates both consumption_log event and wines.personal_rating.
 */
router.put('/:id/resolve', asyncHandler(async (req, res) => {
  const { status, rating, notes } = req.body;
  if (!['rated', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status — must be "rated" or "dismissed"' });
  }

  const pending = await db.prepare(
    'SELECT consumption_log_id, wine_id FROM pending_ratings WHERE id = $1 AND cellar_id = $2'
  ).get(req.params.id, req.cellarId);
  if (!pending) return res.status(404).json({ error: 'Pending rating not found' });

  // If rated, update the consumption_log event AND wines.personal_rating
  if (status === 'rated' && rating != null) {
    await db.prepare(
      'UPDATE consumption_log SET rating = $1, notes = $2 WHERE id = $3 AND cellar_id = $4'
    ).run(rating, notes || null, pending.consumption_log_id, req.cellarId);

    // Also update wine-level personal rating (latest rating wins)
    await db.prepare(
      'UPDATE wines SET personal_rating = $1, personal_notes = $2, personal_rated_at = CURRENT_TIMESTAMP WHERE id = $3 AND cellar_id = $4'
    ).run(rating, notes || null, pending.wine_id, req.cellarId);
  }

  await db.prepare(
    'UPDATE pending_ratings SET status = $1, resolved_at = CURRENT_TIMESTAMP WHERE id = $2 AND cellar_id = $3'
  ).run(status, req.params.id, req.cellarId);

  res.json({ success: true });
}));

/**
 * PUT /api/pending-ratings/dismiss-all
 * Dismiss all pending ratings for this cellar.
 */
router.put('/dismiss-all', asyncHandler(async (req, res) => {
  await db.prepare(
    `UPDATE pending_ratings SET status = 'dismissed', resolved_at = CURRENT_TIMESTAMP
     WHERE cellar_id = $1 AND status = 'pending'`
  ).run(req.cellarId);
  res.json({ success: true });
}));

export default router;
