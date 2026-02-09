/**
 * @fileoverview Wine ratings and external ID endpoints.
 * Handles external ID management, source ratings, personal ratings,
 * and rating refresh with backoff.
 * @module routes/wineRatings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { wineIdSchema, personalRatingSchema } from '../schemas/wine.js';
import { searchVivinoWines } from '../services/vivinoSearch.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { calculateNextRetry, extractVivinoId } from './wines.js';

const router = Router();

/**
 * Get external ID candidates for a wine.
 * @route GET /api/wines/:id/external-ids
 */
router.get('/:id/external-ids', validateParams(wineIdSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const externalIds = await db.prepare(`
    SELECT id, source, external_id, external_url, match_confidence, status, selected_by_user, evidence, created_at, updated_at
    FROM wine_external_ids
    WHERE wine_id = $1
    ORDER BY created_at DESC
  `).all(id);

  res.json({ data: externalIds });
}));

/**
 * Get raw source ratings for a wine.
 * @route GET /api/wines/:id/source-ratings
 */
router.get('/:id/source-ratings', validateParams(wineIdSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const ratings = await db.prepare(`
    SELECT id, source, rating_value, rating_scale, review_count, previous_rating_value,
           captured_at, source_url, extraction_method
    FROM wine_source_ratings
    WHERE wine_id = $1
    ORDER BY source
  `).all(id);

  res.json({ data: ratings });
}));

/**
 * Confirm an external ID candidate for a wine.
 * @route POST /api/wines/:id/confirm-external-id
 */
router.post('/:id/confirm-external-id', validateParams(wineIdSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { source, external_id, selected_by_user = true } = req.body || {};

  if (!source || !external_id) {
    return res.status(400).json({ error: 'source and external_id required' });
  }

  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  await db.prepare(`
    UPDATE wine_external_ids
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
    WHERE wine_id = $1 AND source = $2 AND external_id != $3
  `).run(id, source, external_id);

  const updated = await db.prepare(`
    UPDATE wine_external_ids
    SET status = 'confirmed',
        selected_by_user = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE wine_id = $2 AND source = $3 AND external_id = $4
    RETURNING external_url
  `).get(selected_by_user ? 1 : 0, id, source, external_id);

  if (source === 'vivino') {
    await db.prepare(`
      UPDATE wines
      SET vivino_id = $1, vivino_url = $2, vivino_confirmed = 1, vivino_confirmed_at = CURRENT_TIMESTAMP
      WHERE cellar_id = $3 AND id = $4
    `).run(external_id, updated?.external_url || null, req.cellarId, id);
  }

  res.json({ message: 'External ID confirmed' });
}));

/**
 * Manually set a Vivino URL for a wine.
 * @route POST /api/wines/:id/set-vivino-url
 */
router.post('/:id/set-vivino-url', validateParams(wineIdSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { vivino_url } = req.body || {};

  if (!vivino_url) {
    return res.status(400).json({ error: 'vivino_url required' });
  }

  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const vivinoId = extractVivinoId(vivino_url);

  await db.prepare(`
    UPDATE wines
    SET vivino_url = $1, vivino_id = $2, vivino_confirmed = 1, vivino_confirmed_at = CURRENT_TIMESTAMP
    WHERE cellar_id = $3 AND id = $4
  `).run(vivino_url, vivinoId, req.cellarId, id);

  res.json({ message: 'Vivino URL saved', vivino_id: vivinoId });
}));

/**
 * Refresh ratings with backoff.
 * @route POST /api/wines/:id/refresh-ratings
 */
router.post('/:id/refresh-ratings', validateParams(wineIdSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const wine = await db.prepare(`
    SELECT id, wine_name, producer, vintage, country, region, ratings_attempt_count, ratings_next_retry_at
    FROM wines
    WHERE cellar_id = $1 AND id = $2
  `).get(req.cellarId, id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  if (wine.ratings_next_retry_at && new Date(wine.ratings_next_retry_at) > new Date()) {
    return res.status(409).json({
      error: 'Retry backoff active',
      next_retry_at: wine.ratings_next_retry_at
    });
  }

  const RETRY_MAX_ATTEMPTS = 5;
  const attemptCount = (wine.ratings_attempt_count || 0) + 1;
  if (attemptCount > RETRY_MAX_ATTEMPTS) {
    return res.status(409).json({ error: 'Max retry attempts reached' });
  }

  const searchResults = await searchVivinoWines({
    query: wine.wine_name,
    producer: wine.producer,
    vintage: wine.vintage,
    country: wine.country
  });

  const topMatch = searchResults.matches?.[0] || null;
  let ratingsStatus = 'attempted_failed';
  let nextRetryAt = calculateNextRetry(attemptCount).toISOString();

  if (topMatch?.rating) {
    await db.prepare(`
      INSERT INTO wine_source_ratings
        (wine_id, source, rating_value, rating_scale, review_count, source_url, extraction_method)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (wine_id, source) DO UPDATE SET
        previous_rating_value = wine_source_ratings.rating_value,
        rating_value = EXCLUDED.rating_value,
        rating_scale = EXCLUDED.rating_scale,
        review_count = EXCLUDED.review_count,
        source_url = EXCLUDED.source_url,
        extraction_method = EXCLUDED.extraction_method,
        captured_at = CURRENT_TIMESTAMP
    `).run(
      id,
      'vivino',
      topMatch.rating,
      '5',
      topMatch.ratingCount || null,
      topMatch.vivinoUrl || null,
      'structured'
    );

    ratingsStatus = 'complete';
    nextRetryAt = null;
  }

  await db.prepare(`
    UPDATE wines
    SET ratings_status = $1,
        ratings_last_attempt_at = CURRENT_TIMESTAMP,
        ratings_attempt_count = $2,
        ratings_next_retry_at = $3
    WHERE cellar_id = $4 AND id = $5
  `).run(
    ratingsStatus,
    attemptCount,
    nextRetryAt,
    req.cellarId,
    id
  );

  res.json({
    message: ratingsStatus === 'complete' ? 'Ratings refreshed' : 'Ratings refresh failed',
    ratings_status: ratingsStatus,
    next_retry_at: nextRetryAt
  });
}));

/**
 * Update personal rating for a wine.
 * @route PUT /api/wines/:id/personal-rating
 */
router.put('/:id/personal-rating', validateParams(wineIdSchema), validateBody(personalRatingSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rating, notes } = req.body;

  await db.prepare(`
    UPDATE wines
    SET personal_rating = $1, personal_notes = $2, personal_rated_at = CURRENT_TIMESTAMP
    WHERE cellar_id = $3 AND id = $4
  `).run(rating || null, notes || null, req.cellarId, id);

  res.json({ message: 'Personal rating saved' });
}));

/**
 * Get personal rating for a wine.
 * @route GET /api/wines/:id/personal-rating
 */
router.get('/:id/personal-rating', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const wine = await db.prepare(`
    SELECT personal_rating, personal_notes, personal_rated_at
    FROM wines WHERE cellar_id = $1 AND id = $2
  `).get(req.cellarId, id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  res.json(wine);
}));

export default router;
