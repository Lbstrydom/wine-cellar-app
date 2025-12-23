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

/**
 * Evaluate wines against auto-rules and return candidates.
 * Does NOT add them automatically - user must confirm.
 * @route POST /api/reduce-now/evaluate
 */
router.post('/evaluate', (_req, res) => {
  // Get current settings
  const settings = {};
  const settingsRows = db.prepare('SELECT key, value FROM user_settings').all();
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  const rulesEnabled = settings.reduce_auto_rules_enabled === 'true';
  const ageThreshold = parseInt(settings.reduce_age_threshold || '10', 10);
  const ratingMinimum = parseFloat(settings.reduce_rating_minimum || '3.0');

  if (!rulesEnabled) {
    return res.json({
      enabled: false,
      message: 'Auto-rules are disabled',
      candidates: []
    });
  }

  const currentYear = new Date().getFullYear();

  // Find wines that match criteria and are NOT already in reduce-now
  const candidates = db.prepare(`
    SELECT
      w.id as wine_id,
      w.wine_name,
      w.vintage,
      w.style,
      w.colour,
      w.purchase_stars,
      w.vivino_rating,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(DISTINCT s.location_code) as locations,
      CASE
        WHEN w.vintage IS NOT NULL AND (? - w.vintage) >= ? THEN 'age'
        WHEN w.purchase_stars IS NOT NULL AND w.purchase_stars < ? THEN 'rating'
        WHEN w.purchase_stars IS NULL AND w.vivino_rating IS NOT NULL AND w.vivino_rating < ? THEN 'rating'
        ELSE 'unknown'
      END as match_reason,
      CASE
        WHEN w.vintage IS NOT NULL THEN ? - w.vintage
        ELSE NULL
      END as wine_age
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON rn.wine_id = w.id
    WHERE rn.id IS NULL
      AND (
        (w.vintage IS NOT NULL AND (? - w.vintage) >= ?)
        OR (w.purchase_stars IS NOT NULL AND w.purchase_stars < ?)
        OR (w.purchase_stars IS NULL AND w.vivino_rating IS NOT NULL AND w.vivino_rating < ?)
      )
    GROUP BY w.id
    HAVING bottle_count > 0
    ORDER BY
      CASE match_reason
        WHEN 'age' THEN 1
        WHEN 'rating' THEN 2
        ELSE 3
      END,
      wine_age DESC,
      w.purchase_stars ASC
  `).all(
    currentYear, ageThreshold,
    ratingMinimum, ratingMinimum,
    currentYear,
    currentYear, ageThreshold,
    ratingMinimum, ratingMinimum
  );

  // Format reasons for display
  const formattedCandidates = candidates.map(c => {
    let reason = '';
    if (c.match_reason === 'age') {
      reason = `Vintage ${c.vintage} is ${c.wine_age} years old (threshold: ${ageThreshold})`;
    } else if (c.match_reason === 'rating') {
      const rating = c.purchase_stars || c.vivino_rating;
      reason = `Rating ${rating?.toFixed(1)} is below ${ratingMinimum} stars`;
    }

    return {
      ...c,
      suggested_reason: reason,
      suggested_priority: c.match_reason === 'age' ? 2 : 3
    };
  });

  res.json({
    enabled: true,
    rules: {
      age_threshold: ageThreshold,
      rating_minimum: ratingMinimum
    },
    candidates: formattedCandidates
  });
});

/**
 * Batch add wines to reduce-now from evaluation.
 * @route POST /api/reduce-now/batch
 */
router.post('/batch', (req, res) => {
  const { wine_ids, priority, reason_prefix } = req.body;

  if (!Array.isArray(wine_ids) || wine_ids.length === 0) {
    return res.status(400).json({ error: 'wine_ids array required' });
  }

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO reduce_now (wine_id, priority, reduce_reason)
    VALUES (?, ?, ?)
  `);

  let added = 0;
  for (const wineId of wine_ids) {
    // Get wine info for reason
    const wine = db.prepare('SELECT wine_name, vintage FROM wines WHERE id = ?').get(wineId);
    if (wine) {
      const reason = reason_prefix ? `${reason_prefix}` : 'Auto-suggested';
      insertStmt.run(wineId, priority || 3, reason);
      added++;
    }
  }

  res.json({ message: `Added ${added} wines to reduce-now`, added });
});

export default router;
