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
 * Search wines by name.
 * @route GET /api/wines/search
 */
router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }

  const wines = db.prepare(`
    SELECT id, wine_name, vintage, style, colour, vivino_rating, price_eur
    FROM wines
    WHERE wine_name LIKE ?
    ORDER BY wine_name
    LIMIT 10
  `).all(`%${q}%`);

  res.json(wines);
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
 * Update wine.
 * @route PUT /api/wines/:id
 */
router.put('/:id', (req, res) => {
  const { style, colour, wine_name, vintage, vivino_rating, price_eur } = req.body;

  db.prepare(`
    UPDATE wines
    SET style = ?, colour = ?, wine_name = ?, vintage = ?, vivino_rating = ?, price_eur = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(style, colour, wine_name, vintage || null, vivino_rating || null, price_eur || null, req.params.id);

  res.json({ message: 'Wine updated' });
});

export default router;
