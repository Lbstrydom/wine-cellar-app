/**
 * @fileoverview Cellar management routes.
 * @module routes/cellars
 */

import { Router } from 'express';
import db from '../db/index.js';
import { setActiveCellar, getUserCellars, getActiveCellar } from '../middleware/cellarContext.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody } from '../middleware/validate.js';
import { createCellarSchema, updateCellarSchema } from '../schemas/cellar.js';

const router = Router();

/**
 * GET /api/cellars - Get all user's cellars with role information.
 * Public endpoint - all authenticated users can call this.
 * Does NOT require X-Cellar-ID header.
 */
router.get('/', getUserCellars);

/**
 * GET /api/cellars/active - Get current active cellar details.
 * Public endpoint - all authenticated users can call this.
 */
router.get('/active', getActiveCellar);

/**
 * POST /api/cellars/active - Set active cellar.
 * Public endpoint - all authenticated users can call this.
 * CRITICAL: Validates membership before allowing set.
 *
 * Body:
 * - cellar_id: UUID of cellar to set as active
 */
router.post('/active', setActiveCellar);

/**
 * POST /api/cellars - Create new cellar.
 * Public endpoint - all authenticated users can create cellars.
 * Creates new cellar and adds creator as owner.
 *
 * Body:
 * - name: Cellar name (required)
 * - description: Optional cellar description
 */
router.post('/', validateBody(createCellarSchema), asyncHandler(async (req, res) => {
  const { name, description } = req.body;

  const cellar = await db.transaction(async (client) => {
    // Create cellar
    const { rows } = await client.query(`
      INSERT INTO cellars (name, description, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, name, description, created_by, created_at
    `, [name.trim(), description || null, req.user.id]);

    // Add creator as owner
    await client.query(`
      INSERT INTO cellar_memberships (cellar_id, user_id, role, invited_by)
      VALUES ($1, $2, 'owner', $3)
    `, [rows[0].id, req.user.id, req.user.id]);

    return rows[0];
  });

  res.status(201).json({
    message: 'Cellar created',
    data: cellar
  });
}));

/**
 * GET /api/cellars/:id - Get cellar details (if user is member).
 * CRITICAL: Only returns details if user is member.
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Check membership first
  const membership = await db.prepare(`
    SELECT role FROM cellar_memberships
    WHERE cellar_id = $1 AND user_id = $2
  `).get(id, userId);

  if (!membership) {
    return res.status(403).json({ error: 'Not a member of this cellar' });
  }

  // Fetch cellar details
  const cellar = await db.prepare(`
    SELECT
      id,
      name,
      description,
      created_by,
      created_at,
      updated_at,
      settings,
      (
        SELECT COUNT(*)
        FROM wines
        WHERE cellar_id = $1
      ) as bottle_count
    FROM cellars
    WHERE id = $1
  `).get(id);

  if (!cellar) {
    return res.status(404).json({ error: 'Cellar not found' });
  }

  res.json({ data: { ...cellar, role: membership.role } });
}));

/**
 * PATCH /api/cellars/:id - Update cellar (owner only).
 * CRITICAL: Only owner can update cellar details.
 */
router.patch('/:id', validateBody(updateCellarSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, settings } = req.body;
  const userId = req.user.id;

  // Check ownership
  const membership = await db.prepare(`
    SELECT role FROM cellar_memberships
    WHERE cellar_id = $1 AND user_id = $2
  `).get(id, userId);

  if (!membership || membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only owner can update cellar' });
  }

  const updates = [];
  const values = [];
  let paramCount = 1;

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Cellar name must be a non-empty string' });
    }
    updates.push(`name = $${paramCount++}`);
    values.push(name.trim());
  }

  if (description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(description);
  }

  if (settings !== undefined && typeof settings === 'object') {
    // Merge with existing settings
    const existing = await db.prepare(`
      SELECT COALESCE(settings, '{}'::jsonb) as current_settings
      FROM cellars
      WHERE id = $1
    `).get(id);

    const merged = { ...existing.current_settings, ...settings };
    updates.push(`settings = $${paramCount++}`);
    values.push(JSON.stringify(merged));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const query = `
    UPDATE cellars
    SET ${updates.join(', ')}
    WHERE id = $${paramCount}
    RETURNING id, name, description, created_by, created_at, updated_at
  `;

  const cellar = await db.prepare(query).get(...values);

  res.json({ message: 'Cellar updated', data: cellar });
}));

/**
 * DELETE /api/cellars/:id - Delete cellar (owner only).
 * CRITICAL: Owner can delete their own cellar.
 * Cascade deletes all data (wines, slots, etc.) via FK constraints.
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Check ownership
  const membership = await db.prepare(`
    SELECT role FROM cellar_memberships
    WHERE cellar_id = $1 AND user_id = $2
  `).get(id, userId);

  if (!membership || membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only owner can delete cellar' });
  }

  // Check if this is the user's only cellar
  const otherCellars = await db.prepare(`
    SELECT COUNT(*) as count
    FROM cellar_memberships
    WHERE user_id = $1 AND cellar_id != $2 AND role = 'owner'
  `).get(userId, id);

  if (otherCellars.count === 0) {
    return res.status(400).json({ error: 'Cannot delete your only cellar. Create another cellar first.' });
  }

  // Delete cellar (cascade deletes all related data)
  const result = await db.prepare(`
    DELETE FROM cellars WHERE id = $1
  `).run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Cellar not found' });
  }

  // If this was the active cellar, set another one
  const profile = await db.prepare(`
    SELECT active_cellar_id FROM profiles WHERE id = $1
  `).get(userId);

  if (profile.active_cellar_id === id) {
    const newActive = await db.prepare(`
      SELECT cellar_id
      FROM cellar_memberships
      WHERE user_id = $1
      LIMIT 1
    `).get(userId);

    if (newActive) {
      await db.prepare(`
        UPDATE profiles SET active_cellar_id = $1 WHERE id = $2
      `).run(newActive.cellar_id, userId);
    }
  }

  res.json({ message: 'Cellar deleted' });
}));

export default router;
