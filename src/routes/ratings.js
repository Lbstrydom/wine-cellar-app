/**
 * @fileoverview Wine rating endpoints.
 * @module routes/ratings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { RATING_SOURCES } from '../config/ratingSources.js';
import { normalizeScore, calculateWineRatings } from '../services/ratings.js';
import { fetchWineRatings } from '../services/claude.js';

const router = Router();

/**
 * Get all ratings for a wine.
 * @route GET /api/wines/:wineId/ratings
 */
router.get('/:wineId/ratings', (req, res) => {
  const { wineId } = req.params;
  const vintage = req.query.vintage;

  let query = `SELECT * FROM wine_ratings WHERE wine_id = ?`;
  const params = [wineId];

  if (vintage) {
    query += ` AND (vintage = ? OR vintage IS NULL)`;
    params.push(vintage);
  }

  query += ` ORDER BY source_lens, normalized_mid DESC`;

  const ratings = db.prepare(query).all(...params);
  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Get user preference
  const prefSetting = db.prepare("SELECT value FROM user_settings WHERE key = 'rating_preference'").get();
  const preference = parseInt(prefSetting?.value || '40');

  // Calculate aggregates
  const aggregates = calculateWineRatings(ratings, wine, preference);

  res.json({
    wine_id: wineId,
    wine_name: wine.wine_name,
    vintage: wine.vintage,
    ...aggregates,
    ratings: ratings.map(r => ({
      ...r,
      source_name: RATING_SOURCES[r.source]?.name || r.source,
      source_short: RATING_SOURCES[r.source]?.short_name || r.source
    }))
  });
});

/**
 * Fetch ratings from web using Claude.
 * @route POST /api/wines/:wineId/ratings/fetch
 */
router.post('/:wineId/ratings/fetch', async (req, res) => {
  const { wineId } = req.params;

  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  try {
    const result = await fetchWineRatings(wine);

    // Store ratings
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO wine_ratings (
        wine_id, vintage, source, source_lens, score_type, raw_score, raw_score_numeric,
        normalized_min, normalized_max, normalized_mid,
        award_name, competition_year, rating_count,
        source_url, evidence_excerpt, matched_wine_label,
        vintage_match, match_confidence, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    for (const rating of result.ratings || []) {
      const sourceConfig = RATING_SOURCES[rating.source];
      if (!sourceConfig) continue;

      const normalized = normalizeScore(rating.source, rating.score_type, rating.raw_score);
      const numericScore = parseFloat(rating.raw_score) || null;

      insertStmt.run(
        wineId,
        wine.vintage,
        rating.source,
        rating.lens || sourceConfig.lens,
        rating.score_type,
        rating.raw_score,
        numericScore,
        normalized.min,
        normalized.max,
        normalized.mid,
        rating.award_name || null,
        rating.competition_year || null,
        rating.rating_count || null,
        rating.source_url || null,
        rating.evidence_excerpt || null,
        rating.matched_wine_label || null,
        rating.vintage_match || 'inferred',
        rating.match_confidence || 'medium'
      );
    }

    // Update wine's cached aggregates and tasting notes
    const ratings = db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ?').all(wineId);
    const prefSetting = db.prepare("SELECT value FROM user_settings WHERE key = 'rating_preference'").get();
    const preference = parseInt(prefSetting?.value || '40');
    const aggregates = calculateWineRatings(ratings, wine, preference);

    // Save tasting notes if we got them
    const tastingNotes = result.tasting_notes || null;

    db.prepare(`
      UPDATE wines SET
        competition_index = ?, critics_index = ?, community_index = ?,
        purchase_score = ?, purchase_stars = ?, confidence_level = ?,
        tasting_notes = COALESCE(?, tasting_notes),
        ratings_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      aggregates.competition_index,
      aggregates.critics_index,
      aggregates.community_index,
      aggregates.purchase_score,
      aggregates.purchase_stars,
      aggregates.confidence_level,
      tastingNotes,
      wineId
    );

    res.json({
      message: `Found ${result.ratings?.length || 0} ratings`,
      search_notes: result.search_notes,
      tasting_notes: tastingNotes,
      ...aggregates
    });

  } catch (error) {
    console.error('Rating fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add manual rating.
 * @route POST /api/wines/:wineId/ratings
 */
router.post('/:wineId/ratings', (req, res) => {
  const { wineId } = req.params;
  const { source, score_type, raw_score, competition_year, award_name, source_url, notes } = req.body;

  const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const sourceConfig = RATING_SOURCES[source];
  if (!sourceConfig) {
    return res.status(400).json({ error: 'Unknown rating source' });
  }

  const normalized = normalizeScore(source, score_type, raw_score);

  const result = db.prepare(`
    INSERT INTO wine_ratings (
      wine_id, vintage, source, source_lens, score_type, raw_score,
      normalized_min, normalized_max, normalized_mid,
      award_name, competition_year, source_url,
      is_user_override, override_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    wineId, wine.vintage, source, sourceConfig.lens, score_type, raw_score,
    normalized.min, normalized.max, normalized.mid,
    award_name || null, competition_year || null, source_url || null,
    notes || null
  );

  res.json({ id: result.lastInsertRowid, message: 'Rating added' });
});

/**
 * Update/override a rating.
 * @route PUT /api/wines/:wineId/ratings/:ratingId
 */
router.put('/:wineId/ratings/:ratingId', (req, res) => {
  const { wineId, ratingId } = req.params;
  const { override_normalized_mid, override_note } = req.body;

  db.prepare(`
    UPDATE wine_ratings
    SET is_user_override = 1, override_normalized_mid = ?, override_note = ?
    WHERE id = ? AND wine_id = ?
  `).run(override_normalized_mid, override_note || null, ratingId, wineId);

  res.json({ message: 'Rating updated' });
});

/**
 * Delete a rating.
 * @route DELETE /api/wines/:wineId/ratings/:ratingId
 */
router.delete('/:wineId/ratings/:ratingId', (req, res) => {
  const { wineId, ratingId } = req.params;

  db.prepare('DELETE FROM wine_ratings WHERE id = ? AND wine_id = ?').run(ratingId, wineId);

  res.json({ message: 'Rating deleted' });
});

/**
 * Get available rating sources.
 * @route GET /api/ratings/sources
 */
router.get('/sources', (_req, res) => {
  const sources = Object.entries(RATING_SOURCES).map(([id, config]) => ({
    id,
    name: config.name,
    short_name: config.short_name,
    lens: config.lens,
    scope: config.scope,
    score_type: config.score_type
  }));
  res.json(sources);
});

export default router;
