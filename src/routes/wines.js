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
