/**
 * @fileoverview Wine CRUD endpoints.
 * @module routes/wines
 */

import { Router } from 'express';
import db from '../db/index.js';
import { stringAgg } from '../db/helpers.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  wineIdSchema,
  createWineSchema,
  updateWineSchema,
  personalRatingSchema,
  tastingProfileSchema,
  tastingExtractionSchema,
  parseTextSchema,
  parseImageSchema,
  duplicateCheckSchema
} from '../schemas/wine.js';
import { paginationSchema } from '../schemas/common.js';
import { WineFingerprint } from '../services/wineFingerprint.js';
import { evaluateWineAdd } from '../services/wineAddOrchestrator.js';
import { searchVivinoWines } from '../services/vivinoSearch.js';

const router = Router();

const RETRY_CONFIG = {
  maxAttempts: 5,
  baseDelayMinutes: 60,
  maxDelayMinutes: 10080,
  backoffMultiplier: 2
};

function calculateNextRetry(attemptCount) {
  const delayMinutes = Math.min(
    RETRY_CONFIG.baseDelayMinutes * Math.pow(RETRY_CONFIG.backoffMultiplier, attemptCount - 1),
    RETRY_CONFIG.maxDelayMinutes
  );
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

function extractVivinoId(url) {
  if (!url) return null;
  const match = String(url).match(/\/w\/(\d+)/);
  return match ? match[1] : null;
}

function resolveExtractionMethod(match) {
  if (!match) return 'manual';
  const method = match.extraction_method || match.extractionMethod;
  const allowed = new Set(['structured', 'regex', 'unlocker', 'claude', 'manual']);
  if (allowed.has(method)) return method;
  return 'structured';
}

/**
 * Get distinct wine styles for autocomplete.
 * @route GET /api/wines/styles
 */
router.get('/styles', async (req, res) => {
  try {
    const styles = await db.prepare('SELECT DISTINCT style FROM wines WHERE cellar_id = $1 ORDER BY style').all(req.cellarId);
    res.json(styles.map(s => s.style));
  } catch (error) {
    console.error('Styles error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search wines using ILIKE (PostgreSQL case-insensitive search).
 * @route GET /api/wines/search
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q || q.length < 2) {
      return res.json([]);
    }

    const searchLimit = Math.min(Number.parseInt(limit, 10) || 10, 50);
    const likePattern = `%${q}%`;

    const wines = await db.prepare(`
      SELECT id, wine_name, vintage, style, colour, vivino_rating, price_eur, country, purchase_stars
      FROM wines
      WHERE cellar_id = $1 AND (wine_name ILIKE $2 OR style ILIKE $2 OR country ILIKE $2)
      ORDER BY wine_name
      LIMIT $3
    `).all(req.cellarId, likePattern, searchLimit);

    res.json(wines);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check for duplicate wines and fetch external candidates.
 * @route POST /api/wines/check-duplicate
 */
router.post('/check-duplicate', validateBody(duplicateCheckSchema), async (req, res) => {
  try {
    const input = req.body;
    const forceRefresh = req.body.force_refresh === true;

    const result = await evaluateWineAdd({
      cellarId: req.cellarId,
      input,
      forceRefresh
    });

    res.json({
      data: result,
      search_available: !!process.env.BRIGHTDATA_API_KEY
    });
  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Global search across wines, producers, countries, and styles.
 * Used by command palette / global search bar.
 * @route GET /api/wines/global-search
 */
router.get('/global-search', async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q || q.length < 2) {
      return res.json({ wines: [], producers: [], countries: [], styles: [] });
    }

    const searchLimit = Math.min(Number.parseInt(limit, 10) || 5, 20);
    const likePattern = `%${q}%`;

    // Search wines with bottle counts
    const wines = await db.prepare(`
      SELECT w.id, w.wine_name, w.vintage, w.style, w.colour, w.country, w.purchase_stars,
             COUNT(s.id) as bottle_count
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1
      WHERE w.cellar_id = $1 AND w.wine_name ILIKE $2
      GROUP BY w.id
      ORDER BY w.wine_name
      LIMIT $3
    `).all(req.cellarId, likePattern, searchLimit);

    // Search distinct producers
    const producers = await db.prepare(`
      SELECT DISTINCT
        SPLIT_PART(wine_name, ' ', 1) as producer,
        COUNT(*) as wine_count
      FROM wines
      WHERE cellar_id = $1 AND wine_name ILIKE $2
      GROUP BY SPLIT_PART(wine_name, ' ', 1)
      HAVING SPLIT_PART(wine_name, ' ', 1) != ''
      ORDER BY wine_count DESC
      LIMIT $3
    `).all(req.cellarId, likePattern, searchLimit);

    // Search countries
    const countries = await db.prepare(`
      SELECT country, COUNT(*) as wine_count
      FROM wines
      WHERE cellar_id = $1 AND country ILIKE $2 AND country IS NOT NULL AND country != ''
      GROUP BY country
      ORDER BY wine_count DESC
      LIMIT $3
    `).all(req.cellarId, likePattern, searchLimit);

    // Search styles
    const styles = await db.prepare(`
      SELECT style, COUNT(*) as wine_count
      FROM wines
      WHERE cellar_id = $1 AND style ILIKE $2
      GROUP BY style
      ORDER BY wine_count DESC
      LIMIT $3
    `).all(req.cellarId, likePattern, searchLimit);

    res.json({ wines, producers, countries, styles });
  } catch (error) {
    console.error('Global search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all wines with bottle counts (paginated).
 * @route GET /api/wines
 * @query {number} limit - Max results (default 50, max 500)
 * @query {number} offset - Skip N results (default 0)
 */
router.get('/', validateQuery(paginationSchema), async (req, res) => {
  try {
    // Use validated query params (coerced to numbers by Zod)
    const { limit = 50, offset = 0 } = req.validated?.query || req.query;

    // Get total count for pagination metadata
    const countResult = await db.prepare('SELECT COUNT(*) as total FROM wines WHERE cellar_id = $1').get(req.cellarId);
    const total = Number.parseInt(countResult?.total || 0, 10);

    // Get paginated wines
    const locationAgg = stringAgg('s.location_code');
    const winesSql = [
      'SELECT',
      '  w.id,',
      '  w.style,',
      '  w.colour,',
      '  w.wine_name,',
      '  w.vintage,',
      '  w.vivino_rating,',
      '  w.price_eur,',
      '  COUNT(s.id) as bottle_count,',
      '  ' + locationAgg + ' as locations',
      'FROM wines w',
      'LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1',
      'WHERE w.cellar_id = $1',
      'GROUP BY w.id, w.style, w.colour, w.wine_name, w.vintage, w.vivino_rating, w.price_eur',
      'ORDER BY w.colour, w.style, w.wine_name',
      'LIMIT $2 OFFSET $3'
    ].join('\n');
    const wines = await db.prepare(winesSql).all(req.cellarId, limit, offset);

    res.json({
      data: wines,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + wines.length < total
      }
    });
  } catch (error) {
    console.error('Get wines error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Parse wine details from text using Claude.
 * @route POST /api/wines/parse
 */
router.post('/parse', validateBody(parseTextSchema), async (req, res) => {
  const { text } = req.body;

  try {
    const { parseWineFromText } = await import('../services/claude.js');
    const result = await parseWineFromText(text);
    res.json(result);
  } catch (error) {
    console.error('Wine parsing error:', error);

    if (error.message.includes('API key')) {
      return res.status(503).json({ error: 'AI parsing not configured' });
    }

    res.status(500).json({
      error: 'Failed to parse wine details',
      message: error.message
    });
  }
});

/**
 * Parse wine details from image using Claude Vision.
 * @route POST /api/wines/parse-image
 */
router.post('/parse-image', validateBody(parseImageSchema), async (req, res) => {
  const { image, mediaType } = req.body;

  try {
    const { parseWineFromImage } = await import('../services/claude.js');
    const result = await parseWineFromImage(image, mediaType);
    res.json(result);
  } catch (error) {
    console.error('Image parsing error:', error);

    if (error.message.includes('API key')) {
      return res.status(503).json({ error: 'AI parsing not configured' });
    }

    if (error.message.includes('Invalid image type')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({
      error: 'Failed to parse wine from image',
      message: error.message
    });
  }
});

/**
 * Get single wine by ID.
 * Includes calculated drinking window and serving temperature if not already set.
 * @route GET /api/wines/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const locationAgg = stringAgg('s.location_code');
    const wineSql = [
      'SELECT',
      '  w.*,',
      '  COUNT(s.id) as bottle_count,',
      '  ' + locationAgg + ' as locations',
      'FROM wines w',
      'LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1',
      'WHERE w.cellar_id = $1 AND w.id = $2',
      'GROUP BY w.id'
    ].join('\n');
    const wine = await db.prepare(wineSql).get(req.cellarId, req.params.id);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    // Enrich with drinking window if not already set and vintage exists
    if (wine.vintage && !wine.drink_from && !wine.drink_until) {
      try {
        const { getDefaultDrinkingWindow } = await import('../services/windowDefaults.js');
        const defaultWindow = await getDefaultDrinkingWindow(wine, wine.vintage);
        if (defaultWindow) {
          wine.drink_from = wine.drink_from || defaultWindow.drink_from;
          wine.drink_peak = wine.drink_peak || defaultWindow.peak;
          wine.drink_until = wine.drink_until || defaultWindow.drink_by;
          wine.drinking_window_source = defaultWindow.source;
          wine.drinking_window_confidence = defaultWindow.confidence;
        }
      } catch (windowErr) {
        console.warn('Could not calculate default drinking window:', windowErr.message);
      }
    }

    // Enrich with serving temperature
    try {
      const { findServingTemperature, formatTemperature } = await import('../services/servingTemperature.js');
      const temp = await findServingTemperature(wine);
      if (temp) {
        wine.serving_temp_celsius = `${temp.temp_min_celsius}-${temp.temp_max_celsius}`;
        wine.serving_temp_fahrenheit = `${temp.temp_min_fahrenheit}-${temp.temp_max_fahrenheit}`;
        wine.serving_temp_display = formatTemperature(temp, 'celsius');
        wine.serving_temp_notes = temp.notes;
      }
    } catch (tempErr) {
      console.warn('Could not calculate serving temperature:', tempErr.message);
    }

    res.json(wine);
  } catch (error) {
    console.error('Get wine error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create new wine.
 * @route POST /api/wines
 */
router.post('/', validateBody(createWineSchema), async (req, res) => {
  try {
    const {
      style, colour, wine_name, vintage, vivino_rating, price_eur, country,
      producer, region, vivino_id, vivino_url, vivino_confirmed, external_match
    } = req.body;

    const fingerprintData = WineFingerprint.generateWithVersion({
      wine_name,
      producer,
      vintage,
      country,
      region,
      style,
      colour
    });

    const fingerprint = fingerprintData?.fingerprint || null;
    const fingerprintVersion = fingerprintData?.version || WineFingerprint.FINGERPRINT_VERSION;

    const matchRating = external_match?.rating ?? vivino_rating ?? null;
    const hasAttempt = !!external_match;
    const ratingsAttemptCount = hasAttempt ? 1 : 0;
    const ratingsLastAttemptAt = hasAttempt ? new Date().toISOString() : null;
    const ratingsStatus = hasAttempt
      ? (matchRating ? 'complete' : 'attempted_failed')
      : 'not_attempted';
    const ratingsNextRetryAt = hasAttempt && !matchRating
      ? calculateNextRetry(ratingsAttemptCount).toISOString()
      : null;

    const resolvedVivinoId = external_match?.source === 'vivino'
      ? external_match.external_id || vivino_id
      : vivino_id;
    const resolvedVivinoUrl = external_match?.source === 'vivino'
      ? external_match.external_url || vivino_url
      : vivino_url;
    const vivinoConfirmed = vivino_confirmed || external_match?.source === 'vivino';

    const result = await db.prepare(`
      INSERT INTO wines (
        cellar_id, style, colour, wine_name, vintage, vivino_rating, price_eur, country,
        producer, region,
        vivino_id, vivino_url, vivino_confirmed, vivino_confirmed_at,
        fingerprint, fingerprint_version,
        ratings_status, ratings_last_attempt_at, ratings_attempt_count, ratings_next_retry_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id
    `).get(
      req.cellarId, style, colour, wine_name, vintage || null, matchRating || null, price_eur || null, country || null,
      producer || null, region || null,
      resolvedVivinoId || null, resolvedVivinoUrl || null,
      vivinoConfirmed ? 1 : 0,
      vivinoConfirmed ? new Date().toISOString() : null,
      fingerprint, fingerprintVersion,
      ratingsStatus, ratingsLastAttemptAt, ratingsAttemptCount, ratingsNextRetryAt
    );

    if (external_match?.external_id) {
      await db.prepare(`
        INSERT INTO wine_external_ids
          (wine_id, source, external_id, external_url, match_confidence, status, selected_by_user, evidence)
        VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7)
      `).run(
        result?.id,
        external_match.source,
        external_match.external_id,
        external_match.external_url || null,
        external_match.match_confidence || null,
        1,
        external_match.evidence ? JSON.stringify(external_match.evidence) : null
      );

      if (matchRating) {
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
          result?.id,
          external_match.source,
          matchRating,
          external_match.rating_scale || '5',
          external_match.review_count || null,
          external_match.external_url || null,
          resolveExtractionMethod(external_match)
        );
      }
    }

    res.status(201).json({ id: result?.id || result?.lastInsertRowid, message: 'Wine added' });
  } catch (error) {
    console.error('Create wine error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get external ID candidates for a wine.
 * @route GET /api/wines/:id/external-ids
 */
router.get('/:id/external-ids', validateParams(wineIdSchema), async (req, res) => {
  try {
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
  } catch (error) {
    console.error('External IDs error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get ratings with provenance for a wine.
 * @route GET /api/wines/:id/ratings
 */
router.get('/:id/ratings', validateParams(wineIdSchema), async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Confirm an external ID candidate for a wine.
 * @route POST /api/wines/:id/confirm-external-id
 */
router.post('/:id/confirm-external-id', validateParams(wineIdSchema), async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Confirm external ID error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Manually set a Vivino URL for a wine.
 * @route POST /api/wines/:id/set-vivino-url
 */
router.post('/:id/set-vivino-url', validateParams(wineIdSchema), async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Set Vivino URL error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Refresh ratings with backoff.
 * @route POST /api/wines/:id/refresh-ratings
 */
router.post('/:id/refresh-ratings', validateParams(wineIdSchema), async (req, res) => {
  try {
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

    const attemptCount = (wine.ratings_attempt_count || 0) + 1;
    if (attemptCount > RETRY_CONFIG.maxAttempts) {
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
  } catch (error) {
    console.error('Refresh ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update wine including drink window and Vivino reference.
 * @route PUT /api/wines/:id
 */
router.put('/:id', validateParams(wineIdSchema), validateBody(updateWineSchema), async (req, res) => {
  try {
    const {
      style, colour, wine_name, vintage, vivino_rating, price_eur, country,
      producer, region,
      drink_from, drink_peak, drink_until,
      vivino_id, vivino_url, vivino_confirmed
    } = req.body;

    const existing = await db.prepare(`
      SELECT wine_name, producer, vintage, country, region, style, colour
      FROM wines
      WHERE cellar_id = $1 AND id = $2
    `).get(req.cellarId, req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    const updates = [];
    const values = [];
    let paramIdx = 1;
    const addUpdate = (field, value) => {
      updates.push(`${field} = $${paramIdx}`);
      values.push(value);
      paramIdx++;
    };

    addUpdate('style', style);
    addUpdate('colour', colour);
    addUpdate('wine_name', wine_name);
    addUpdate('vintage', vintage || null);
    addUpdate('vivino_rating', vivino_rating || null);
    addUpdate('price_eur', price_eur || null);
    addUpdate('country', country || null);
    addUpdate('producer', producer || null);
    addUpdate('region', region || null);
    addUpdate('drink_from', drink_from || null);
    addUpdate('drink_peak', drink_peak || null);
    addUpdate('drink_until', drink_until || null);

    const fingerprintData = WineFingerprint.generateWithVersion({
      wine_name: wine_name ?? existing.wine_name,
      producer: producer ?? existing.producer,
      vintage: vintage ?? existing.vintage,
      country: country ?? existing.country,
      region: region ?? existing.region,
      style: style ?? existing.style,
      colour: colour ?? existing.colour
    });

    if (fingerprintData?.fingerprint) {
      addUpdate('fingerprint', fingerprintData.fingerprint);
      addUpdate('fingerprint_version', fingerprintData.version);
    }

    // Only update Vivino fields if explicitly provided
    if (vivino_id !== undefined) {
      addUpdate('vivino_id', vivino_id || null);
    }
    if (vivino_url !== undefined) {
      addUpdate('vivino_url', vivino_url || null);
    }
    if (vivino_confirmed !== undefined) {
      addUpdate('vivino_confirmed', vivino_confirmed ? 1 : 0);
      addUpdate('vivino_confirmed_at', vivino_confirmed ? new Date().toISOString() : null);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const cellarIdParam = paramIdx;
    values.push(req.cellarId);
    paramIdx++;
    const idParam = paramIdx;
    values.push(req.params.id);
    paramIdx++;

    const setSql = updates.join(', ');
    const updateSql = 'UPDATE wines SET ' + setSql + ' WHERE cellar_id = $' + cellarIdParam + ' AND id = $' + idParam;
    await db.prepare(updateSql).run(...values);

    res.json({ message: 'Wine updated' });
  } catch (error) {
    console.error('Update wine error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a wine.
 * @route DELETE /api/wines/:id
 */
router.delete('/:id', validateParams(wineIdSchema), async (req, res) => {
  try {
    const { id } = req.params;

    const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    await db.prepare('DELETE FROM wines WHERE cellar_id = $1 AND id = $2').run(req.cellarId, id);

    res.json({ message: `Wine ${id} deleted` });
  } catch (error) {
    console.error('Delete wine error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update personal rating for a wine.
 * @route PUT /api/wines/:id/personal-rating
 */
router.put('/:id/personal-rating', validateParams(wineIdSchema), validateBody(personalRatingSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, notes } = req.body;

    await db.prepare(`
      UPDATE wines
      SET personal_rating = $1, personal_notes = $2, personal_rated_at = CURRENT_TIMESTAMP
      WHERE cellar_id = $3 AND id = $4
    `).run(rating || null, notes || null, req.cellarId, id);

    res.json({ message: 'Personal rating saved' });
  } catch (error) {
    console.error('Personal rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get personal rating for a wine.
 * @route GET /api/wines/:id/personal-rating
 */
router.get('/:id/personal-rating', async (req, res) => {
  try {
    const { id } = req.params;

    const wine = await db.prepare(`
      SELECT personal_rating, personal_notes, personal_rated_at
      FROM wines WHERE cellar_id = $1 AND id = $2
    `).get(req.cellarId, id);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    res.json(wine);
  } catch (error) {
    console.error('Get personal rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get tasting profile for a wine.
 * @route GET /api/wines/:id/tasting-profile
 */
router.get('/:id/tasting-profile', async (req, res) => {
  try {
    const { id } = req.params;

    const wine = await db.prepare(`
      SELECT id, wine_name, tasting_profile_json
      FROM wines WHERE cellar_id = $1 AND id = $2
    `).get(req.cellarId, id);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    let profile = null;
    if (wine.tasting_profile_json) {
      try {
        profile = JSON.parse(wine.tasting_profile_json);
      } catch {
        // Invalid JSON, return null
      }
    }

    res.json({
      wine_id: wine.id,
      wine_name: wine.wine_name,
      profile
    });
  } catch (error) {
    console.error('Get tasting profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Extract tasting profile from a note.
 * @route POST /api/wines/:id/tasting-profile/extract
 */
router.post('/:id/tasting-profile/extract', validateParams(wineIdSchema), validateBody(tastingExtractionSchema), async (req, res) => {
  const { id } = req.params;
  const { tasting_note, source_id = 'user' } = req.body;

  try {
    const wine = await db.prepare(`
      SELECT id, wine_name, colour, style
      FROM wines WHERE cellar_id = $1 AND id = $2
    `).get(req.cellarId, id);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    // Dynamic import to avoid issues if service not available
    const { extractTastingProfile } = await import('../services/tastingExtractor.js');

    const profile = await extractTastingProfile(tasting_note, {
      sourceId: source_id,
      wineInfo: {
        colour: wine.colour,
        style: wine.style
      }
    });

    // Store extraction in history
    try {
      await db.prepare(`
        INSERT INTO tasting_profile_extractions
        (wine_id, source_id, source_note, extraction_method, confidence, profile_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        source_id,
        tasting_note,
        profile.extraction?.method || 'unknown',
        profile.extraction?.confidence || 0.5,
        JSON.stringify(profile)
      );
    } catch (historyError) {
      // Table might not exist yet, log but continue
      console.warn('Could not save extraction history:', historyError.message);
    }

    res.json({
      wine_id: wine.id,
      wine_name: wine.wine_name,
      profile
    });
  } catch (error) {
    console.error('Tasting extraction error:', error);
    res.status(500).json({ error: 'Failed to extract tasting profile' });
  }
});

/**
 * Save tasting profile to wine.
 * @route PUT /api/wines/:id/tasting-profile
 */
router.put('/:id/tasting-profile', validateParams(wineIdSchema), validateBody(tastingProfileSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { profile } = req.body;

    const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    const profileJson = JSON.stringify(profile);

    await db.prepare(`
      UPDATE wines SET tasting_profile_json = $1 WHERE cellar_id = $2 AND id = $3
    `).run(profileJson, req.cellarId, id);

    res.json({ message: 'Tasting profile saved', wine_id: id });
  } catch (error) {
    console.error('Save tasting profile error:', error);
    res.status(500).json({ error: 'Failed to save tasting profile' });
  }
});

/**
 * Get extraction history for a wine.
 * @route GET /api/wines/:id/tasting-profile/history
 */
router.get('/:id/tasting-profile/history', async (req, res) => {
  const { id } = req.params;

  try {
    const history = await db.prepare(`
      SELECT id, source_id, extraction_method, confidence, extracted_at
      FROM tasting_profile_extractions
      WHERE wine_id = $1 AND cellar_id = $2
      ORDER BY extracted_at DESC
    `).all(id, req.cellarId);

    res.json(history);
  } catch {
    // Table tasting_profile_extractions might not exist in all environments
    // Return empty array rather than error to allow graceful degradation
    res.json([]);
  }
});

/**
 * Get serving temperature recommendation for a wine.
 * @route GET /api/wines/:id/serving-temperature
 */
router.get('/:id/serving-temperature', async (req, res) => {
  const { id } = req.params;
  const { unit = 'celsius' } = req.query;

  try {
    const wine = await db.prepare(`
      SELECT id, wine_name, style, colour, grapes, sweetness, winemaking
      FROM wines WHERE cellar_id = $1 AND id = $2
    `).get(req.cellarId, id);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    const { findServingTemperature, formatTemperature } = await import('../services/servingTemperature.js');
    const temp = await findServingTemperature(wine);

    if (!temp) {
      return res.json({
        wine_id: wine.id,
        wine_name: wine.wine_name,
        recommendation: null,
        message: 'No serving temperature data available'
      });
    }

    res.json({
      wine_id: wine.id,
      wine_name: wine.wine_name,
      recommendation: {
        wine_type: temp.wine_type,
        category: temp.category,
        body: temp.body,
        temp_min_celsius: temp.temp_min_celsius,
        temp_max_celsius: temp.temp_max_celsius,
        temp_min_fahrenheit: temp.temp_min_fahrenheit,
        temp_max_fahrenheit: temp.temp_max_fahrenheit,
        temp_celsius: `${temp.temp_min_celsius}-${temp.temp_max_celsius}`,
        temp_fahrenheit: `${temp.temp_min_fahrenheit}-${temp.temp_max_fahrenheit}`,
        temp_display: formatTemperature(temp, unit),
        notes: temp.notes,
        confidence: temp.match_confidence
      }
    });
  } catch (error) {
    console.error('Serving temperature lookup error:', error);
    res.status(500).json({ error: 'Failed to get serving temperature' });
  }
});

export default router;
