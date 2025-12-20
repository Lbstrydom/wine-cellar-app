/**
 * @fileoverview Reduce-now list management.
 * @module routes/reduceNow
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get reduce-now list.
 * @route GET /api/reduce-now
 */
router.get('/', (req, res) => {
  const list = db.prepare(`
    SELECT
      rn.id,
      rn.priority,
      rn.reduce_reason,
      w.id as wine_id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(s.location_code) as locations
    FROM reduce_now rn
    JOIN wines w ON w.id = rn.wine_id
    LEFT JOIN slots s ON s.wine_id = w.id
    GROUP BY rn.id
    ORDER BY rn.priority, w.wine_name
  `).all();
  res.json(list);
});

/**
 * Add wine to reduce-now list.
 * @route POST /api/reduce-now
 */
router.post('/', (req, res) => {
  const { wine_id, priority, reduce_reason } = req.body;

  db.prepare(`
    INSERT OR REPLACE INTO reduce_now (wine_id, priority, reduce_reason)
    VALUES (?, ?, ?)
  `).run(wine_id, priority || 3, reduce_reason || null);

  res.json({ message: 'Added to reduce-now' });
});

/**
 * Remove wine from reduce-now list.
 * @route DELETE /api/reduce-now/:wine_id
 */
router.delete('/:wine_id', (req, res) => {
  db.prepare('DELETE FROM reduce_now WHERE wine_id = ?').run(req.params.wine_id);
  res.json({ message: 'Removed from reduce-now' });
});

export default router;
