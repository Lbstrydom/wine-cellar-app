/**
 * @fileoverview Wine CRUD endpoints.
 * @module routes/wines
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get distinct wine styles for autocomplete.
 * @route GET /api/wines/styles
 */
router.get('/styles', (req, res) => {
  const styles = db.prepare('SELECT DISTINCT style FROM wines ORDER BY style').all();
  res.json(styles.map(s => s.style));
});

/**
 * Check if FTS5 table exists.
 * @returns {boolean} True if wines_fts table exists
 */
function hasFTS5() {
  try {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='wines_fts'"
    ).get();
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Search wines using FTS5 full-text search (with LIKE fallback).
 * FTS5 provides sub-millisecond search with relevance ranking.
 * @route GET /api/wines/search
 */
router.get('/search', (req, res) => {
  const { q, limit = 10 } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }

  const searchLimit = Math.min(parseInt(limit) || 10, 50);

  // Try FTS5 first (much faster for large datasets)
  if (hasFTS5()) {
    try {
      // Escape special FTS5 characters and add prefix matching
      const ftsQuery = q
        .replace(/['"]/g, '')  // Remove quotes
        .split(/\s+/)
        .filter(term => term.length > 0)
        .map(term => `${term}*`)  // Add prefix matching
        .join(' ');

      if (ftsQuery) {
        const wines = db.prepare(`
          SELECT
            w.id, w.wine_name, w.vintage, w.style, w.colour,
            w.vivino_rating, w.price_eur, w.country,
            w.purchase_stars,
            bm25(wines_fts, 10.0, 5.0, 1.0, 0.5) as relevance
          FROM wines_fts
          JOIN wines w ON wines_fts.rowid = w.id
          WHERE wines_fts MATCH ?
          ORDER BY relevance
          LIMIT ?
        `).all(ftsQuery, searchLimit);

        return res.json(wines);
      }
    } catch (ftsError) {
      // FTS5 query failed (malformed query), fall back to LIKE
      console.warn('FTS5 search failed, falling back to LIKE:', ftsError.message);
    }
  }

  // Fallback to LIKE search (slower but always works)
  const wines = db.prepare(`
    SELECT id, wine_name, vintage, style, colour, vivino_rating, price_eur, country, purchase_stars
    FROM wines
    WHERE wine_name LIKE ? OR style LIKE ? OR country LIKE ?
    ORDER BY wine_name
    LIMIT ?
  `).all(`%${q}%`, `%${q}%`, `%${q}%`, searchLimit);

  res.json(wines);
});

/**
 * Global search across wines, producers, countries, and styles.
 * Used by command palette / global search bar.
 * @route GET /api/wines/global-search
 */
router.get('/global-search', (req, res) => {
  const { q, limit = 5 } = req.query;
  if (!q || q.length < 2) {
    return res.json({ wines: [], producers: [], countries: [], styles: [] });
  }

  const searchLimit = Math.min(parseInt(limit) || 5, 20);
  const likePattern = `%${q}%`;

  // Search wines (with FTS5 if available)
  let wines = [];
  if (hasFTS5()) {
    try {
      const ftsQuery = q.split(/\s+/).filter(t => t).map(t => `${t}*`).join(' ');
      if (ftsQuery) {
        wines = db.prepare(`
          SELECT w.id, w.wine_name, w.vintage, w.style, w.colour, w.country, w.purchase_stars,
                 COUNT(s.id) as bottle_count
          FROM wines_fts
          JOIN wines w ON wines_fts.rowid = w.id
          LEFT JOIN slots s ON s.wine_id = w.id
          WHERE wines_fts MATCH ?
          GROUP BY w.id
          ORDER BY bm25(wines_fts)
          LIMIT ?
        `).all(ftsQuery, searchLimit);
      }
    } catch {
      // Fall through to LIKE
    }
  }
  if (wines.length === 0) {
    wines = db.prepare(`
      SELECT w.id, w.wine_name, w.vintage, w.style, w.colour, w.country, w.purchase_stars,
             COUNT(s.id) as bottle_count
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE w.wine_name LIKE ?
      GROUP BY w.id
      ORDER BY w.wine_name
      LIMIT ?
    `).all(likePattern, searchLimit);
  }

  // Search distinct producers (extracted from wine names - first part before vintage/year)
  const producers = db.prepare(`
    SELECT DISTINCT
      CASE
        WHEN wine_name LIKE '% 20%' THEN TRIM(SUBSTR(wine_name, 1, INSTR(wine_name || ' 20', ' 20') - 1))
        WHEN wine_name LIKE '% 19%' THEN TRIM(SUBSTR(wine_name, 1, INSTR(wine_name || ' 19', ' 19') - 1))
        ELSE wine_name
      END as producer,
      COUNT(*) as wine_count
    FROM wines
    WHERE wine_name LIKE ?
    GROUP BY producer
    HAVING producer != ''
    ORDER BY wine_count DESC
    LIMIT ?
  `).all(likePattern, searchLimit);

  // Search countries
  const countries = db.prepare(`
    SELECT country, COUNT(*) as wine_count
    FROM wines
    WHERE country LIKE ? AND country IS NOT NULL AND country != ''
    GROUP BY country
    ORDER BY wine_count DESC
    LIMIT ?
  `).all(likePattern, searchLimit);

  // Search styles
  const styles = db.prepare(`
    SELECT style, COUNT(*) as wine_count
    FROM wines
    WHERE style LIKE ?
    GROUP BY style
    ORDER BY wine_count DESC
    LIMIT ?
  `).all(likePattern, searchLimit);

  res.json({ wines, producers, countries, styles });
});

/**
 * Get all wines with bottle counts.
 * @route GET /api/wines
 */
router.get('/', (req, res) => {
  const wines = db.prepare(`
    SELECT
      w.id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      w.price_eur,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(s.location_code) as locations
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    GROUP BY w.id
    ORDER BY w.colour, w.style, w.wine_name
  `).all();
  res.json(wines);
});

/**
 * Parse wine details from text using Claude.
 * @route POST /api/wines/parse
 */
router.post('/parse', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided' });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
  }

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
router.post('/parse-image', async (req, res) => {
  const { image, mediaType } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'No image provided' });
  }

  if (!mediaType) {
    return res.status(400).json({ error: 'No media type provided' });
  }

  // Check image size (base64 adds ~33% overhead, so 10MB image ≈ 13MB base64)
  // Limit to ~5MB original image
  if (image.length > 7000000) {
    return res.status(400).json({ error: 'Image too large (max 5MB)' });
  }

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
router.get('/:id', (req, res) => {
  const wine = db.prepare(`
    SELECT
      w.*,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(s.location_code) as locations
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    WHERE w.id = ?
    GROUP BY w.id
  `).get(req.params.id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  res.json(wine);
});

/**
 * Create new wine.
 * @route POST /api/wines
 */
router.post('/', (req, res) => {
  const { style, colour, wine_name, vintage, vivino_rating, price_eur } = req.body;

  const result = db.prepare(`
    INSERT INTO wines (style, colour, wine_name, vintage, vivino_rating, price_eur)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(style, colour, wine_name, vintage || null, vivino_rating || null, price_eur || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Wine added' });
});

/**
 * Update wine including drink window.
 * @route PUT /api/wines/:id
 */
router.put('/:id', (req, res) => {
  const {
    style, colour, wine_name, vintage, vivino_rating, price_eur, country,
    drink_from, drink_peak, drink_until
  } = req.body;

  db.prepare(`
    UPDATE wines
    SET style = ?, colour = ?, wine_name = ?, vintage = ?,
        vivino_rating = ?, price_eur = ?, country = ?,
        drink_from = ?, drink_peak = ?, drink_until = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    style, colour, wine_name, vintage || null,
    vivino_rating || null, price_eur || null, country || null,
    drink_from || null, drink_peak || null, drink_until || null,
    req.params.id
  );

  res.json({ message: 'Wine updated' });
});

/**
 * Update personal rating for a wine.
 * @route PUT /api/wines/:id/personal-rating
 */
router.put('/:id/personal-rating', (req, res) => {
  const { id } = req.params;
  const { rating, notes } = req.body;

  db.prepare(`
    UPDATE wines
    SET personal_rating = ?, personal_notes = ?, personal_rated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(rating || null, notes || null, id);

  res.json({ message: 'Personal rating saved' });
});

/**
 * Get personal rating for a wine.
 * @route GET /api/wines/:id/personal-rating
 */
router.get('/:id/personal-rating', (req, res) => {
  const { id } = req.params;

  const wine = db.prepare(`
    SELECT personal_rating, personal_notes, personal_rated_at
    FROM wines WHERE id = ?
  `).get(id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  res.json(wine);
});

export default router;
