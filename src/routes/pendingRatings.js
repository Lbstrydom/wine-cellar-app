/**
 * @fileoverview Pending rating reminder endpoints.
 * Tracks consumed wines awaiting user rating (drink-now-rate-later flow).
 * @module routes/pendingRatings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody } from '../middleware/validate.js';
import { resolvePendingRatingSchema } from '../schemas/pendingRating.js';
import { recordFeedback } from '../services/pairing/pairingSession.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * GET /api/pending-ratings
 * Get unresolved pending ratings for this cellar.
 * Joins with consumption_log, wines (previous rating), and pairing_sessions (pairing context).
 */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await db.prepare(`
    SELECT pr.id, pr.consumption_log_id, pr.wine_id, pr.wine_name,
           pr.vintage, pr.colour, pr.style, pr.location_code, pr.consumed_at,
           pr.pairing_session_id,
           cl.rating AS existing_rating, cl.notes AS existing_notes,
           w.personal_rating AS previous_rating,
           COALESCE(ps.dish_description, ps_h.dish_description) AS pairing_dish,
           ps.pairing_fit_rating AS pairing_already_rated,
           ps_h.id AS heuristic_session_id
    FROM pending_ratings pr
    LEFT JOIN consumption_log cl ON cl.id = pr.consumption_log_id
    LEFT JOIN wines w ON w.id = pr.wine_id AND w.cellar_id = $1
    LEFT JOIN pairing_sessions ps ON ps.id = pr.pairing_session_id AND ps.cellar_id = $1
    LEFT JOIN LATERAL (
      SELECT ps2.id, ps2.dish_description
      FROM pairing_sessions ps2
      WHERE ps2.cellar_id = $1
        AND ps2.chosen_wine_id = pr.wine_id
        AND pr.pairing_session_id IS NULL
        AND ps2.created_at BETWEEN pr.consumed_at - INTERVAL '48 hours' AND pr.consumed_at
      ORDER BY ps2.created_at DESC
      LIMIT 1
    ) ps_h ON TRUE
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

  // Heuristic back-fill: retroactively link any session found by the lateral join
  // for rows where pairing_session_id was not written at drink time (plan §3 failure-mode mitigation).
  // Best-effort — fire-and-forget DB patch so subsequent GETs use the direct JOIN path.
  const toBackfill = [...needsRating, ...alreadyRated].filter(r => r.heuristic_session_id);
  if (toBackfill.length > 0) {
    for (const r of toBackfill) {
      r.pairing_session_id = r.heuristic_session_id;
    }
    Promise.allSettled(
      toBackfill.map(r =>
        db.prepare(
          'UPDATE pending_ratings SET pairing_session_id = $1 WHERE id = $2 AND cellar_id = $3 AND pairing_session_id IS NULL'
        ).run(r.heuristic_session_id, r.id, req.cellarId)
      )
    ).catch(() => {});
  }
  // Strip internal heuristic field before sending
  for (const r of rows) delete r.heuristic_session_id;

  res.json({ needsRating, alreadyRated });
}));

/**
 * PUT /api/pending-ratings/:id/resolve
 * Mark a pending rating as rated or dismissed.
 * When 'rated', updates both consumption_log event and wines.personal_rating.
 * Idempotency: only resolves if status is still 'pending'.
 */
router.put('/:id/resolve', validateBody(resolvePendingRatingSchema), asyncHandler(async (req, res) => {
  const { status, rating, notes, pairingFeedback } = req.body;

  // Idempotency: only act on pending rows (second submit returns 404)
  const pending = await db.prepare(
    'SELECT consumption_log_id, wine_id, pairing_session_id FROM pending_ratings WHERE id = $1 AND cellar_id = $2 AND status = $3'
  ).get(req.params.id, req.cellarId, 'pending');
  if (!pending) return res.status(404).json({ error: 'Pending rating not found or already resolved' });

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

  // Save pairing feedback if provided (non-atomic — partial success is acceptable)
  if (pending.pairing_session_id && pairingFeedback?.pairingFitRating) {
    try {
      await recordFeedback(pending.pairing_session_id, {
        pairingFitRating: pairingFeedback.pairingFitRating,
        wouldPairAgain: pairingFeedback.wouldPairAgain,
        failureReasons: pairingFeedback.failureReasons || null,
        notes: pairingFeedback.notes || null
      }, req.cellarId);
    } catch (err) {
      // Wine rating saved, pairing feedback failed — return partial-success signal
      logger.warn('PairingFeedback', `Failed for session ${pending.pairing_session_id}: ${err.message}`);
      return res.json({ success: true, pairingFeedbackError: 'Pairing feedback could not be saved' });
    }
  }

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
