/**
 * @fileoverview User settings endpoints.
 * @module routes/settings
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get all settings.
 * @route GET /api/settings
 */
router.get('/', (_req, res) => {
  const settings = db.prepare('SELECT key, value FROM user_settings').all();
  const result = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  res.json(result);
});

/**
 * Update a setting.
 * @route PUT /api/settings/:key
 */
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  db.prepare(`
    INSERT INTO user_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, value);

  res.json({ message: 'Setting updated' });
});

export default router;
