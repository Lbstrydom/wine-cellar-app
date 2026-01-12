/**
 * @fileoverview Profile routes for user account management.
 * @module routes/profile
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * GET /api/profile - Get current user's profile.
 * Requires: Authentication (Bearer token)
 */
router.get('/', async (req, res) => {
  try {
    const profile = await db.prepare(`
      SELECT
        id,
        email,
        display_name,
        avatar_url,
        active_cellar_id,
        tier,
        cellar_quota,
        bottle_quota,
        created_at,
        last_login_at,
        settings
      FROM profiles
      WHERE id = $1
    `).get(req.user.id);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ data: profile });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * PATCH /api/profile - Update user's profile.
 * Requires: Authentication (Bearer token)
 *
 * Body:
 * - display_name (optional)
 * - avatar_url (optional)
 * - settings (optional, merged with existing)
 */
router.patch('/', async (req, res) => {
  try {
    const { display_name, avatar_url, settings } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (display_name !== undefined) {
      updates.push(`display_name = $${paramCount++}`);
      values.push(display_name);
    }

    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramCount++}`);
      values.push(avatar_url);
    }

    if (settings !== undefined && typeof settings === 'object') {
      // Merge with existing settings
      const existing = await db.prepare(`
        SELECT COALESCE(settings, '{}'::jsonb) as current_settings
        FROM profiles
        WHERE id = $1
      `).get(req.user.id);

      const merged = { ...existing.current_settings, ...settings };
      updates.push(`settings = $${paramCount++}`);
      values.push(JSON.stringify(merged));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.user.id);

    const query = `
      UPDATE profiles
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, email, display_name, avatar_url, active_cellar_id, settings
    `;

    const profile = await db.prepare(query).get(...values);

    res.json({ message: 'Profile updated', data: profile });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
