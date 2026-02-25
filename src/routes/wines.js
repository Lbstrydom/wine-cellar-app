/**
 * @fileoverview Wine CRUD, search, and parse endpoints.
 * @module routes/wines
 */

import { Router } from 'express';
import db from '../db/index.js';
import { stringAgg } from '../db/helpers.js';
import logger from '../utils/logger.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  wineIdSchema,
  createWineSchema,
  updateWineSchema,
  parseTextSchema,
  parseImageSchema,
  duplicateCheckSchema
} from '../schemas/wine.js';
import { paginationSchema } from '../schemas/common.js';
import { WineFingerprint } from '../services/wine/wineFingerprint.js';
import { evaluateWineAdd } from '../services/wine/wineAddOrchestrator.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { checkWineConsistency } from '../services/shared/consistencyChecker.js';
import { invalidateAnalysisCache } from '../services/shared/cacheService.js';
import { normalizeColour } from '../utils/wineNormalization.js';
import { findBestZone } from '../services/cellar/cellarPlacement.js';
import { updateZoneWineCount } from '../services/cellar/cellarAllocation.js';
import { detectGrapesFromWine } from '../services/wine/grapeEnrichment.js';
import { incrementBottleChangeCount } from '../services/zone/reconfigChangeTracker.js';

const router = Router();

const RETRY_CONFIG = {
  maxAttempts: 5,
  baseDelayMinutes: 60,
  maxDelayMinutes: 10080,
  backoffMultiplier: 2
};

/**
 * Calculate next retry time using exponential backoff.
 * @param {number} attemptCount - Current attempt number
 * @returns {Date} Next retry timestamp
 */
function calculateNextRetry(attemptCount) {
  const delayMinutes = Math.min(
    RETRY_CONFIG.baseDelayMinutes * Math.pow(RETRY_CONFIG.backoffMultiplier, attemptCount - 1),
    RETRY_CONFIG.maxDelayMinutes
  );
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

/**
 * Extract Vivino wine ID from a Vivino URL.
 * @param {string} url - Vivino URL
 * @returns {string|null} Vivino wine ID or null
 */
function extractVivinoId(url) {
  if (!url) return null;
  const match = String(url).match(/\/w\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Resolve extraction method from a match object.
 * @param {object} match - External match object
 * @returns {string} Extraction method name
 */
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
router.get('/styles', asyncHandler(async (req, res) => {
  const styles = await db.prepare('SELECT DISTINCT style FROM wines WHERE cellar_id = $1 ORDER BY style').all(req.cellarId);
  res.json(styles.map(s => s.style));
}));

/**
 * Search wines using ILIKE (PostgreSQL case-insensitive search).
 * @route GET /api/wines/search
 */
router.get('/search', asyncHandler(async (req, res) => {
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
}));

/**
 * Check for duplicate wines and fetch external candidates.
 * @route POST /api/wines/check-duplicate
 */
router.post('/check-duplicate', validateBody(duplicateCheckSchema), asyncHandler(async (req, res) => {
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
}));

/**
 * Global search across wines, producers, countries, and styles.
 * Used by command palette / global search bar.
 * @route GET /api/wines/global-search
 */
router.get('/global-search', asyncHandler(async (req, res) => {
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
}));

/**
 * Get all wines with bottle counts (paginated).
 * @route GET /api/wines
 * @query {number} limit - Max results (default 50, max 500)
 * @query {number} offset - Skip N results (default 0)
 */
router.get('/', validateQuery(paginationSchema), asyncHandler(async (req, res) => {
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
}));

/**
 * Parse wine details from text using Claude.
 * @route POST /api/wines/parse
 */
router.post('/parse', validateBody(parseTextSchema), asyncHandler(async (req, res) => {
  const { text } = req.body;

  try {
    const { parseWineFromText } = await import('../services/ai/index.js');
    const result = await parseWineFromText(text);
    res.json(result);
  } catch (error) {
    if (error.message.includes('API key')) {
      return res.status(503).json({ error: 'AI parsing not configured' });
    }
    throw error;
  }
}));

/**
 * Parse wine details from image using Claude Vision.
 * @route POST /api/wines/parse-image
 */
router.post('/parse-image', validateBody(parseImageSchema), asyncHandler(async (req, res) => {
  const { image, mediaType } = req.body;

  try {
    const { parseWineFromImage } = await import('../services/ai/index.js');
    const result = await parseWineFromImage(image, mediaType);
    res.json(result);
  } catch (error) {
    if (error.message.includes('API key')) {
      return res.status(503).json({ error: 'AI parsing not configured' });
    }
    if (error.message.includes('Invalid image type')) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
}));

/**
 * Get single wine by ID.
 * Includes calculated drinking window and serving temperature if not already set.
 * @route GET /api/wines/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
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
      const { getDefaultDrinkingWindow } = await import('../services/wine/windowDefaults.js');
      const defaultWindow = await getDefaultDrinkingWindow(wine, wine.vintage);
      if (defaultWindow) {
        wine.drink_from = wine.drink_from || defaultWindow.drink_from;
        wine.drink_peak = wine.drink_peak || defaultWindow.peak;
        wine.drink_until = wine.drink_until || defaultWindow.drink_by;
        wine.drinking_window_source = defaultWindow.source;
        wine.drinking_window_confidence = defaultWindow.confidence;
      }
    } catch (windowErr) {
      logger.warn('Wines', 'Could not calculate default drinking window: ' + windowErr.message);
    }
  }

  // Enrich with serving temperature
  try {
    const { findServingTemperature, formatTemperature } = await import('../services/wine/servingTemperature.js');
    const temp = await findServingTemperature(wine);
    if (temp) {
      wine.serving_temp_celsius = `${temp.temp_min_celsius}-${temp.temp_max_celsius}`;
      wine.serving_temp_fahrenheit = `${temp.temp_min_fahrenheit}-${temp.temp_max_fahrenheit}`;
      wine.serving_temp_display = formatTemperature(temp, 'celsius');
      wine.serving_temp_notes = temp.notes;
    }
  } catch (tempErr) {
    logger.warn('Wines', 'Could not calculate serving temperature: ' + tempErr.message);
  }

  res.json(wine);
}));

/**
 * Create new wine.
 * @route POST /api/wines
 */
router.post('/', validateBody(createWineSchema), asyncHandler(async (req, res) => {
  const {
    style, colour: rawColour, wine_name, vintage, vivino_rating, price_eur, country,
    producer, region, grapes, vivino_id, vivino_url, vivino_confirmed, external_match
  } = req.body;
  const colour = normalizeColour(rawColour) || rawColour;
  const normalizedGrapes = typeof grapes === 'string' ? grapes.trim() : grapes;

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
      producer, region, grapes,
      vivino_id, vivino_url, vivino_confirmed, vivino_confirmed_at,
      fingerprint, fingerprint_version,
      ratings_status, ratings_last_attempt_at, ratings_attempt_count, ratings_next_retry_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING id
  `).get(
    req.cellarId, style, colour, wine_name, vintage || null, matchRating || null, price_eur || null, country || null,
    producer || null, region || null, normalizedGrapes || null,
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

  const wineId = result?.id || result?.lastInsertRowid;

  // Auto-detect grapes when not provided by Vivino/external match
  let resolvedGrapes = normalizedGrapes;
  if (!normalizedGrapes && wineId) {
    try {
      const detection = detectGrapesFromWine({ wine_name, style, region, country });
      if (detection.grapes && detection.confidence !== 'low') {
        await db.prepare('UPDATE wines SET grapes = $1 WHERE id = $2 AND cellar_id = $3')
          .run(detection.grapes, wineId, req.cellarId);
        resolvedGrapes = detection.grapes;
      }
    } catch { /* fail-open: grape detection is advisory */ }
  }

  let warnings = [];
  try {
    const finding = checkWineConsistency({ id: wineId, wine_name, colour, grapes: resolvedGrapes, style });
    if (finding) warnings = [finding];
  } catch { /* fail-open: never crash after successful write */ }
  res.status(201).json({ id: wineId, message: 'Wine added', warnings });
}));

/**
 * Update wine including drink window and Vivino reference.
 * @route PUT /api/wines/:id
 */
router.put('/:id', validateParams(wineIdSchema), validateBody(updateWineSchema), asyncHandler(async (req, res) => {
  const {
    style, colour: rawColour, wine_name, vintage, vivino_rating, price_eur, country,
    producer, region, grapes,
    drink_from, drink_peak, drink_until,
    vivino_id, vivino_url, vivino_confirmed
  } = req.body;
  const colour = normalizeColour(rawColour) || rawColour;
  const normalizedGrapes = typeof grapes === 'string' ? grapes.trim() : grapes;

  const existing = await db.prepare(`
    SELECT wine_name, producer, vintage, country, region, style, colour, grapes
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

  // Only update fields that are present in the request body
  const body = req.body;
  if ('style' in body) addUpdate('style', style);
  if ('colour' in body) addUpdate('colour', colour);
  if ('wine_name' in body) addUpdate('wine_name', wine_name);
  if ('vintage' in body) addUpdate('vintage', vintage || null);
  if ('vivino_rating' in body) addUpdate('vivino_rating', vivino_rating || null);
  if ('price_eur' in body) addUpdate('price_eur', price_eur || null);
  if ('country' in body) addUpdate('country', country || null);
  if ('producer' in body) addUpdate('producer', producer || null);
  if ('region' in body) addUpdate('region', region || null);
  if ('grapes' in body) addUpdate('grapes', normalizedGrapes === undefined ? (existing.grapes ?? null) : (normalizedGrapes || null));
  if ('drink_from' in body) addUpdate('drink_from', drink_from || null);
  if ('drink_peak' in body) addUpdate('drink_peak', drink_peak || null);
  if ('drink_until' in body) addUpdate('drink_until', drink_until || null);

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

  if (updates.length === 0) {
    return res.json({ message: 'Wine updated (no changes)', warnings: [] });
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

  // Invalidate analysis cache — wine metadata changes (colour, style, country)
  // affect zone placement even when slot assignments haven't changed.
  await invalidateAnalysisCache(null, req.cellarId);

  let warnings = [];
  try {
    const resolvedGrapes = normalizedGrapes === undefined ? existing.grapes : (normalizedGrapes || null);
    const finding = checkWineConsistency({ id: req.params.id, wine_name, colour, grapes: resolvedGrapes, style });
    if (finding) warnings = [finding];
  } catch { /* fail-open */ }

  // Re-evaluate zone placement with updated metadata
  let zoneSuggestion = null;
  try {
    const updatedWine = await db.prepare(
      'SELECT * FROM wines WHERE cellar_id = $1 AND id = $2'
    ).get(req.cellarId, req.params.id);
    if (updatedWine) {
      const zoneMatch = findBestZone(updatedWine);
      const currentZoneId = updatedWine.zone_id || null;
      zoneSuggestion = {
        zoneId: zoneMatch.zoneId,
        displayName: zoneMatch.displayName,
        confidence: zoneMatch.confidence,
        alternativeZones: zoneMatch.alternativeZones || [],
        changed: currentZoneId !== null && currentZoneId !== zoneMatch.zoneId
      };
    }
  } catch { /* fail-open — zone suggestion is non-critical */ }

  res.json({ message: 'Wine updated', warnings, zoneSuggestion });
}));

/**
 * Delete a wine.
 * @route DELETE /api/wines/:id
 */
router.delete('/:id', validateParams(wineIdSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const wine = await db.prepare('SELECT id, zone_id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Count bottles BEFORE delete — needed for both zone update and reconfig counter
  const bottleResult = await db.prepare(
    'SELECT COUNT(*) as count FROM slots WHERE cellar_id = $1 AND wine_id = $2'
  ).get(req.cellarId, id);
  const deletedBottleCount = parseInt(bottleResult?.count ?? 0, 10);

  // Decrement zone wine_count if it has a zone and bottles in cellar
  if (wine.zone_id && deletedBottleCount > 0) {
    await updateZoneWineCount(wine.zone_id, req.cellarId, -1);
  }

  await db.prepare('DELETE FROM wines WHERE cellar_id = $1 AND id = $2').run(req.cellarId, id);

  // Invalidate analysis cache — wine removal changes zone composition
  await invalidateAnalysisCache(null, req.cellarId);
  if (deletedBottleCount > 0) {
    await incrementBottleChangeCount(req.cellarId, deletedBottleCount);
  }

  res.json({ message: `Wine ${id} deleted` });
}));

export { calculateNextRetry, extractVivinoId, resolveExtractionMethod };
export default router;
