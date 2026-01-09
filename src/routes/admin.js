/**
 * @fileoverview Admin endpoints for AI review telemetry.
 * @module routes/admin
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * GET /api/admin/ai-reviews
 * Retrieve recent AI review telemetry for analysis.
 */
router.get('/ai-reviews', async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit || '20', 10), 100) || 20;
    const pendingOnly = req.query.pending === 'true';

    const query = `
      SELECT * FROM ai_review_telemetry
      ${pendingOnly ? 'WHERE sommelier_rating IS NULL' : ''}
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const reviews = await db.prepare(query).all(limit);
    res.json({ data: reviews, count: reviews.length });
  } catch (error) {
    console.error('Error fetching AI reviews:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/admin/ai-reviews/:id/rating
 * Add or update a sommelier rating.
 */
router.patch('/ai-reviews/:id/rating', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, notes } = req.body;
    const parsedRating = Number.parseInt(rating, 10);

    if (!parsedRating || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    await db.prepare(`
      UPDATE ai_review_telemetry
         SET sommelier_rating = $1,
             sommelier_notes = $2,
             reviewed_by_sommelier_at = NOW()
       WHERE id = $3
    `).run(parsedRating, notes || null, id);

    res.json({ message: 'Rating saved' });
  } catch (error) {
    console.error('Error saving AI review rating:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
