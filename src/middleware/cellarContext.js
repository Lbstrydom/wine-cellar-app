/**
 * @fileoverview Cellar context middleware for multi-tenancy.
 * Validates cellar membership and sets req.cellarId and req.cellarRole.
 * CRITICAL: Uses req.cellarId for all data operations - never trust X-Cellar-ID without validation.
 * @module middleware/cellarContext
 */

import db from '../db/index.js';

/**
 * Middleware: Require cellar context.
 * Validates X-Cellar-ID header (if provided) or uses user's active_cellar_id.
 * CRITICAL: Always validates membership server-side - never trust client-provided scope.
 *
 * Sets:
 * - req.cellarId: The scoped cellar ID (validated by membership)
 * - req.cellarRole: User's role in this cellar ('owner', 'editor', 'viewer')
 *
 * @param {Object} req - Express request (requires req.user from auth middleware)
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 * @returns {void}
 */
export async function requireCellarContext(req, res, next) {
  const requestedCellarId = req.headers['x-cellar-id'];
  const userId = req.user.id;

  try {
    if (requestedCellarId) {
      // CRITICAL: Verify user is a member of this cellar before using it
      const membership = await db.prepare(`
        SELECT role FROM cellar_memberships
        WHERE cellar_id = $1 AND user_id = $2
      `).get(requestedCellarId, userId);

      if (!membership) {
        return res.status(403).json({ error: 'Not a member of this cellar' });
      }

      req.cellarId = requestedCellarId;
      req.cellarRole = membership.role;
    } else {
      // No header: use user's active cellar (already validated as member during auth)
      if (!req.user.active_cellar_id) {
        return res.status(400).json({ error: 'No active cellar set. Use X-Cellar-ID header or set active cellar.' });
      }

      // Double-check membership (defensive)
      const membership = await db.prepare(`
        SELECT role FROM cellar_memberships
        WHERE cellar_id = $1 AND user_id = $2
      `).get(req.user.active_cellar_id, userId);

      if (!membership) {
        return res.status(403).json({ error: 'No longer a member of active cellar' });
      }

      req.cellarId = req.user.active_cellar_id;
      req.cellarRole = membership.role;
    }

    next();
  } catch (err) {
    console.error('Cellar context middleware error:', err);
    res.status(500).json({ error: 'Cellar context error' });
  }
}

/**
 * Middleware: Require editor or owner role in cellar.
 * Use after requireCellarContext.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 * @returns {void}
 */
export function requireCellarEdit(req, res, next) {
  if (req.cellarRole !== 'editor' && req.cellarRole !== 'owner') {
    return res.status(403).json({ error: 'Insufficient permissions. Editor or owner role required.' });
  }
  next();
}

/**
 * Middleware: Require owner role in cellar.
 * Use after requireCellarContext.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 * @returns {void}
 */
export function requireCellarOwner(req, res, next) {
  if (req.cellarRole !== 'owner') {
    return res.status(403).json({ error: 'Insufficient permissions. Owner role required.' });
  }
  next();
}

/**
 * Get user's cellars with role information.
 * Public: All authenticated users can call this.
 *
 * @param {Object} req - Express request (requires req.user)
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
export async function getUserCellars(req, res) {
  try {
    const cellars = await db.prepare(`
      SELECT
        c.id,
        c.name,
        c.description,
        c.created_by,
        cm.role,
        c.created_at,
        c.updated_at,
        (
          SELECT COUNT(*)
          FROM wines
          WHERE cellar_id = c.id
        ) as bottle_count
      FROM cellars c
      INNER JOIN cellar_memberships cm ON cm.cellar_id = c.id
      WHERE cm.user_id = $1
      ORDER BY c.updated_at DESC
    `).all(req.user.id);

    res.json({ data: cellars });
  } catch (err) {
    console.error('Get user cellars error:', err);
    res.status(500).json({ error: 'Failed to fetch cellars' });
  }
}

/**
 * Set user's active cellar.
 * Public: All authenticated users can call this.
 * CRITICAL: Validates membership before allowing set.
 *
 * @param {Object} req - Express request (requires req.user, body.cellar_id)
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
export async function setActiveCellar(req, res) {
  const { cellar_id } = req.body;
  const userId = req.user.id;

  if (!cellar_id) {
    return res.status(400).json({ error: 'cellar_id is required' });
  }

  try {
    // CRITICAL: Verify user is a member before allowing set
    const membership = await db.prepare(`
      SELECT role FROM cellar_memberships
      WHERE cellar_id = $1 AND user_id = $2
    `).get(cellar_id, userId);

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this cellar' });
    }

    await db.prepare(`
      UPDATE profiles SET active_cellar_id = $1 WHERE id = $2
    `).run(cellar_id, userId);

    res.json({ message: 'Active cellar updated', cellar_id });
  } catch (err) {
    console.error('Set active cellar error:', err);
    res.status(500).json({ error: 'Failed to set active cellar' });
  }
}

/**
 * Get current active cellar details.
 * Public: All authenticated users can call this.
 *
 * @param {Object} req - Express request (requires req.user)
 * @param {Object} res - Express response
 * @returns {Promise<void>}
 */
export async function getActiveCellar(req, res) {
  try {
    const cellar = await db.prepare(`
      SELECT
        c.id,
        c.name,
        c.description,
        c.created_by,
        c.created_at,
        c.updated_at,
        (
          SELECT COUNT(*)
          FROM wines
          WHERE cellar_id = c.id
        ) as bottle_count
      FROM cellars c
      WHERE c.id = $1
    `).get(req.user.active_cellar_id);

    if (!cellar) {
      return res.status(404).json({ error: 'Active cellar not found' });
    }

    res.json({ data: cellar });
  } catch (err) {
    console.error('Get active cellar error:', err);
    res.status(500).json({ error: 'Failed to fetch active cellar' });
  }
}
