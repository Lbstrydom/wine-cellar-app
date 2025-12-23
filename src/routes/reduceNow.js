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
 * Uses drinking window data as primary signal, with age/rating as fallback.
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
  const urgencyMonths = parseInt(settings.reduce_window_urgency_months || '12', 10);
  const includeNoWindow = settings.reduce_include_no_window !== 'false';
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
  const urgencyYear = currentYear + Math.ceil(urgencyMonths / 12);

  const candidates = [];
  const seenWineIds = new Set();

  // Priority 1: Wines PAST their drinking window (critical urgency)
  const pastWindow = db.prepare(`
    SELECT DISTINCT
      w.id as wine_id, w.wine_name, w.vintage, w.style, w.colour,
      w.purchase_stars, w.vivino_rating,
      dw.drink_by_year, dw.drink_from_year, dw.peak_year, dw.source as window_source,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(DISTINCT s.location_code) as locations
    FROM wines w
    JOIN drinking_windows dw ON w.id = dw.wine_id
    JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON rn.wine_id = w.id
    WHERE rn.id IS NULL
      AND dw.drink_by_year IS NOT NULL
      AND dw.drink_by_year < ?
    GROUP BY w.id
    HAVING bottle_count > 0
    ORDER BY dw.drink_by_year ASC
  `).all(currentYear);

  for (const wine of pastWindow) {
    if (seenWineIds.has(wine.wine_id)) continue;
    seenWineIds.add(wine.wine_id);
    candidates.push({
      ...wine,
      priority: 1,
      suggested_reason: `Past drinking window (ended ${wine.drink_by_year})`,
      suggested_priority: 1,
      urgency: 'critical'
    });
  }

  // Priority 2: Wines within urgency threshold (closing soon)
  const closingWindow = db.prepare(`
    SELECT DISTINCT
      w.id as wine_id, w.wine_name, w.vintage, w.style, w.colour,
      w.purchase_stars, w.vivino_rating,
      dw.drink_by_year, dw.drink_from_year, dw.peak_year, dw.source as window_source,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(DISTINCT s.location_code) as locations
    FROM wines w
    JOIN drinking_windows dw ON w.id = dw.wine_id
    JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON rn.wine_id = w.id
    WHERE rn.id IS NULL
      AND dw.drink_by_year IS NOT NULL
      AND dw.drink_by_year >= ?
      AND dw.drink_by_year <= ?
    GROUP BY w.id
    HAVING bottle_count > 0
    ORDER BY dw.drink_by_year ASC
  `).all(currentYear, urgencyYear);

  for (const wine of closingWindow) {
    if (seenWineIds.has(wine.wine_id)) continue;
    seenWineIds.add(wine.wine_id);
    const yearsRemaining = wine.drink_by_year - currentYear;
    candidates.push({
      ...wine,
      priority: 2,
      suggested_reason: yearsRemaining === 0
        ? `Final year of drinking window (${wine.drink_by_year})`
        : `Drinking window closes ${wine.drink_by_year} (${yearsRemaining} year${yearsRemaining > 1 ? 's' : ''} left)`,
      suggested_priority: yearsRemaining === 0 ? 1 : 2,
      urgency: yearsRemaining === 0 ? 'high' : 'medium'
    });
  }

  // Priority 3: Wines at peak year
  const atPeak = db.prepare(`
    SELECT DISTINCT
      w.id as wine_id, w.wine_name, w.vintage, w.style, w.colour,
      w.purchase_stars, w.vivino_rating,
      dw.drink_by_year, dw.drink_from_year, dw.peak_year, dw.source as window_source,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(DISTINCT s.location_code) as locations
    FROM wines w
    JOIN drinking_windows dw ON w.id = dw.wine_id
    JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON rn.wine_id = w.id
    WHERE rn.id IS NULL
      AND dw.peak_year = ?
    GROUP BY w.id
    HAVING bottle_count > 0
  `).all(currentYear);

  for (const wine of atPeak) {
    if (seenWineIds.has(wine.wine_id)) continue;
    seenWineIds.add(wine.wine_id);
    candidates.push({
      ...wine,
      priority: 3,
      suggested_reason: `At peak drinking year (${wine.peak_year})`,
      suggested_priority: 2,
      urgency: 'peak'
    });
  }

  // Priority 4: No window data but old vintage (fallback)
  if (includeNoWindow) {
    const noWindowOld = db.prepare(`
      SELECT
        w.id as wine_id, w.wine_name, w.vintage, w.style, w.colour,
        w.purchase_stars, w.vivino_rating,
        (? - w.vintage) as wine_age,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations
      FROM wines w
      JOIN slots s ON s.wine_id = w.id
      LEFT JOIN drinking_windows dw ON w.id = dw.wine_id
      LEFT JOIN reduce_now rn ON rn.wine_id = w.id
      WHERE rn.id IS NULL
        AND dw.id IS NULL
        AND w.vintage IS NOT NULL
        AND (? - w.vintage) >= ?
      GROUP BY w.id
      HAVING bottle_count > 0
      ORDER BY wine_age DESC
    `).all(currentYear, currentYear, ageThreshold);

    for (const wine of noWindowOld) {
      if (seenWineIds.has(wine.wine_id)) continue;
      seenWineIds.add(wine.wine_id);
      candidates.push({
        ...wine,
        priority: 4,
        suggested_reason: `No drinking window data; vintage ${wine.vintage} is ${wine.wine_age} years old`,
        suggested_priority: 3,
        needs_window_data: true,
        urgency: 'unknown'
      });
    }
  }

  // Priority 5: Low rating (original logic, kept as fallback)
  const lowRated = db.prepare(`
    SELECT
      w.id as wine_id, w.wine_name, w.vintage, w.style, w.colour,
      w.purchase_stars, w.vivino_rating,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(DISTINCT s.location_code) as locations
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON rn.wine_id = w.id
    WHERE rn.id IS NULL
      AND (w.purchase_stars < ? OR (w.purchase_stars IS NULL AND w.vivino_rating IS NOT NULL AND w.vivino_rating < ?))
    GROUP BY w.id
    HAVING bottle_count > 0
  `).all(ratingMinimum, ratingMinimum);

  for (const wine of lowRated) {
    if (seenWineIds.has(wine.wine_id)) continue;
    seenWineIds.add(wine.wine_id);
    const rating = wine.purchase_stars || wine.vivino_rating;
    candidates.push({
      ...wine,
      priority: 5,
      suggested_reason: `Low rating (${rating?.toFixed(1)} stars) - consider drinking soon`,
      suggested_priority: 3,
      urgency: 'low'
    });
  }

  res.json({
    enabled: true,
    candidates,
    settings_used: {
      urgency_months: urgencyMonths,
      include_no_window: includeNoWindow,
      age_threshold: ageThreshold,
      rating_minimum: ratingMinimum
    },
    summary: {
      total: candidates.length,
      critical: candidates.filter(c => c.urgency === 'critical').length,
      high: candidates.filter(c => c.urgency === 'high').length,
      medium: candidates.filter(c => c.urgency === 'medium').length,
      peak: candidates.filter(c => c.urgency === 'peak').length,
      unknown: candidates.filter(c => c.urgency === 'unknown').length,
      low: candidates.filter(c => c.urgency === 'low').length
    }
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
