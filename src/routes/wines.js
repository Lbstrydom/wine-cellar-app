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
  parseImageSchema
} from '../schemas/wine.js';
import { paginationSchema } from '../schemas/common.js';

const router = Router();

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
    const wines = await db.prepare(`
      SELECT
        w.id,
        w.style,
        w.colour,
        w.wine_name,
        w.vintage,
        w.vivino_rating,
        w.price_eur,
        COUNT(s.id) as bottle_count,
        ${stringAgg('s.location_code')} as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1
      WHERE w.cellar_id = $1
      GROUP BY w.id, w.style, w.colour, w.wine_name, w.vintage, w.vivino_rating, w.price_eur
      ORDER BY w.colour, w.style, w.wine_name
      LIMIT $2 OFFSET $3
    `).all(req.cellarId, limit, offset);

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
 * @route GET /api/wines/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const wine = await db.prepare(`
      SELECT
        w.*,
        COUNT(s.id) as bottle_count,
        ${stringAgg('s.location_code')} as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1
      WHERE w.cellar_id = $1 AND w.id = $2
      GROUP BY w.id
    `).get(req.cellarId, req.params.id);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
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
      vivino_id, vivino_url, vivino_confirmed
    } = req.body;

    const result = await db.prepare(`
      INSERT INTO wines (
        cellar_id, style, colour, wine_name, vintage, vivino_rating, price_eur, country,
        vivino_id, vivino_url, vivino_confirmed, vivino_confirmed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `).get(
      req.cellarId, style, colour, wine_name, vintage || null, vivino_rating || null, price_eur || null, country || null,
      vivino_id || null, vivino_url || null,
      vivino_confirmed ? 1 : 0,
      vivino_confirmed ? new Date().toISOString() : null
    );

    res.status(201).json({ id: result?.id || result?.lastInsertRowid, message: 'Wine added' });
  } catch (error) {
    console.error('Create wine error:', error);
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
      drink_from, drink_peak, drink_until,
      vivino_id, vivino_url, vivino_confirmed
    } = req.body;

    // Build dynamic update based on what's provided
    const updates = [
      'style = $1',
      'colour = $2',
      'wine_name = $3',
      'vintage = $4',
      'vivino_rating = $5',
      'price_eur = $6',
      'country = $7',
      'drink_from = $8',
      'drink_peak = $9',
      'drink_until = $10'
    ];
    const values = [];
    let paramIdx = 10;

    // Always update these basic fields
    values.push(
      style, colour, wine_name, vintage || null,
      vivino_rating || null, price_eur || null, country || null,
      drink_from || null, drink_peak || null, drink_until || null
    );

    // Only update Vivino fields if explicitly provided
    if (vivino_id !== undefined) {
      paramIdx++;
      updates.push(`vivino_id = $${paramIdx}`);
      values.push(vivino_id || null);
    }
    if (vivino_url !== undefined) {
      paramIdx++;
      updates.push(`vivino_url = $${paramIdx}`);
      values.push(vivino_url || null);
    }
    if (vivino_confirmed !== undefined) {
      paramIdx++;
      updates.push(`vivino_confirmed = $${paramIdx}`);
      values.push(vivino_confirmed ? 1 : 0);
      paramIdx++;
      updates.push(`vivino_confirmed_at = $${paramIdx}`);
      values.push(vivino_confirmed ? new Date().toISOString() : null);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    paramIdx++;
    values.push(req.cellarId);
    const cellarIdParam = paramIdx;
    paramIdx++;
    values.push(req.params.id);
    const idParam = paramIdx;

    await db.prepare(`
      UPDATE wines SET ${updates.join(', ')} WHERE cellar_id = $${cellarIdParam} AND id = $${idParam}
    `).run(...values);

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
