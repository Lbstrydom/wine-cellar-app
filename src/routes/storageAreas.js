/**
 * @fileoverview Storage Areas API routes
 * Handles CRUD operations for user-defined storage areas (wine fridge, cellar, rack, etc.)
 * Each area has custom layout (variable rows/columns), storage type, and temperature zone.
 * @module routes/storageAreas
 */

import { Router } from 'express';
import db from '../db/index.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { createStorageAreaSchema, updateStorageAreaSchema, updateLayoutSchema, fromTemplateSchema, storageAreaIdSchema } from '../schemas/storageArea.js';

const router = Router();

/**
 * GET /api/storage-areas
 * List all storage areas for the current cellar with slot counts
 * @returns {Object} Array of storage areas with metadata
 */
router.get('/', asyncHandler(async (req, res) => {
  const { cellarId } = req;

  const areas = await db.prepare(`
    SELECT
      sa.id,
      sa.name,
      sa.storage_type,
      sa.temp_zone,
      sa.display_order,
      sa.icon,
      sa.notes,
      sa.created_at,
      sa.updated_at,
      COUNT(s.id) as slot_count,
      COUNT(s.id) FILTER (WHERE s.wine_id IS NOT NULL) as occupied_count
    FROM storage_areas sa
    LEFT JOIN storage_area_rows sar ON sar.storage_area_id = sa.id
    LEFT JOIN slots s ON s.location_code LIKE (sa.id || '%')
      AND s.cellar_id = $1
    WHERE sa.cellar_id = $1
    GROUP BY sa.id, sa.name, sa.storage_type, sa.temp_zone,
             sa.display_order, sa.icon, sa.notes, sa.created_at, sa.updated_at
    ORDER BY sa.display_order, sa.created_at
  `).all(cellarId);

  res.json({ data: areas });
}));

/**
 * GET /api/storage-areas/:id
 * Get a single storage area with its layout (rows/columns)
 * @param {string} id - Storage area UUID
 * @returns {Object} Storage area with row layout
 */
router.get('/:id', validateParams(storageAreaIdSchema), asyncHandler(async (req, res) => {
  const { cellarId } = req;
  const { id } = req.params;

  const area = await db.prepare(`
    SELECT
      sa.id,
      sa.name,
      sa.storage_type,
      sa.temp_zone,
      sa.display_order,
      sa.icon,
      sa.notes,
      sa.created_at,
      sa.updated_at
    FROM storage_areas sa
    WHERE sa.id = $1 AND sa.cellar_id = $2
  `).get(id, cellarId);

  if (!area) {
    return res.status(404).json({ error: 'Storage area not found' });
  }

  // Get rows for this area
  const rows = await db.prepare(`
    SELECT
      row_num,
      col_count,
      label
    FROM storage_area_rows
    WHERE storage_area_id = $1
    ORDER BY row_num
  `).all(id);

  res.json({ data: { ...area, rows } });
}));

/**
 * POST /api/storage-areas
 * Create a new storage area
 * Validates: Max 5 areas per cellar
 * @body {Object} name, storage_type, temp_zone, rows (array of {row_num, col_count})
 * @returns {Object} Created storage area with ID
 */
router.post('/', validateBody(createStorageAreaSchema), asyncHandler(async (req, res) => {
  const { cellarId } = req;
  const { name, storage_type, temp_zone, rows } = req.body;

  // Check max 5 areas per cellar
  const areaCount = await db.prepare(`
    SELECT COUNT(*) as count FROM storage_areas WHERE cellar_id = $1
  `).get(cellarId);

  if (areaCount.count >= 5) {
    return res.status(409).json({
      error: 'Maximum 5 storage areas allowed per cellar'
    });
  }

  // Check unique name
  const existing = await db.prepare(`
    SELECT id FROM storage_areas
    WHERE cellar_id = $1 AND name = $2
  `).get(cellarId, name);

  if (existing) {
    return res.status(409).json({
      error: `Storage area named "${name}" already exists`
    });
  }

  // Get max display_order for ordering
  const maxOrder = await db.prepare(`
    SELECT COALESCE(MAX(display_order), -1) as max_order
    FROM storage_areas WHERE cellar_id = $1
  `).get(cellarId);

  // Create storage area
  const result = await db.prepare(`
    INSERT INTO storage_areas (cellar_id, name, storage_type, temp_zone, display_order)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, storage_type, temp_zone, display_order, created_at
  `).get(cellarId, name, storage_type, temp_zone, maxOrder.max_order + 1);

  // Insert rows
  for (const row of rows) {
    await db.prepare(`
      INSERT INTO storage_area_rows (storage_area_id, row_num, col_count)
      VALUES ($1, $2, $3)
    `).run(result.id, row.row_num, row.col_count);
  }

  res.status(201).json({
    message: `Storage area "${name}" created`,
    data: { ...result, rows }
  });
}));

/**
 * PUT /api/storage-areas/:id
 * Update storage area metadata (name, type, temp zone)
 * Does not modify layout - use PUT /:id/layout for that
 * @param {string} id - Storage area UUID
 * @body {Object} name, storage_type, temp_zone, icon, notes
 * @returns {Object} Updated storage area
 */
router.put('/:id', validateParams(storageAreaIdSchema), validateBody(updateStorageAreaSchema), asyncHandler(async (req, res) => {
  const { cellarId } = req;
  const { id } = req.params;
  const { name, storage_type, temp_zone, icon, notes } = req.body;

  // Verify area exists and belongs to cellar
  const area = await db.prepare(`
    SELECT id FROM storage_areas WHERE id = $1 AND cellar_id = $2
  `).get(id, cellarId);

  if (!area) {
    return res.status(404).json({ error: 'Storage area not found' });
  }

  // If name changed, check uniqueness
  if (name) {
    const existing = await db.prepare(`
      SELECT id FROM storage_areas
      WHERE cellar_id = $1 AND name = $2 AND id != $3
    `).get(cellarId, name, id);

    if (existing) {
      return res.status(409).json({
        error: `Storage area named "${name}" already exists`
      });
    }
  }

  // Build update query
  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(name);
  }
  if (storage_type !== undefined) {
    updates.push(`storage_type = $${paramIndex++}`);
    params.push(storage_type);
  }
  if (temp_zone !== undefined) {
    updates.push(`temp_zone = $${paramIndex++}`);
    params.push(temp_zone);
  }
  if (icon !== undefined) {
    updates.push(`icon = $${paramIndex++}`);
    params.push(icon);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    params.push(notes);
  }

  params.push(id);
  params.push(cellarId);

    // Safe: updates array built from hardcoded field names, only data values parameterized
    const setSql = updates.join(', ');
    const sql = [
      'UPDATE storage_areas',
      'SET ' + setSql,
      'WHERE id = $' + (paramIndex + 1) + ' AND cellar_id = $' + (paramIndex + 2),
      'RETURNING id, name, storage_type, temp_zone, display_order, icon, notes, updated_at'
    ].join('\n');
    const result = await db.prepare(sql).get(...params);

  res.json({
    message: 'Storage area updated',
    data: result
  });
}));

/**
 * PUT /api/storage-areas/:id/layout
 * Update rows and columns for storage area layout
 * Validates: Cannot remove occupied slots
 * @param {string} id - Storage area UUID
 * @body {Object} rows - Array of {row_num, col_count}
 * @returns {Object} Updated layout with validation details
 */
router.put('/:id/layout', validateParams(storageAreaIdSchema), validateBody(updateLayoutSchema), asyncHandler(async (req, res) => {
  const { cellarId } = req;
  const { id } = req.params;
  const { rows } = req.body;

  // Verify area exists
  const area = await db.prepare(`
    SELECT id FROM storage_areas WHERE id = $1 AND cellar_id = $2
  `).get(id, cellarId);

  if (!area) {
    return res.status(404).json({ error: 'Storage area not found' });
  }

  // Get current rows
  const currentRows = await db.prepare(`
    SELECT row_num, col_count FROM storage_area_rows
    WHERE storage_area_id = $1
    ORDER BY row_num
  `).all(id);

  // Build map of new layout
  const newLayout = new Map(rows.map(r => [r.row_num, r.col_count]));

  // Check for occupied slots that would be removed
  const blockedSlots = [];
  for (const currentRow of currentRows) {
    const newColCount = newLayout.get(currentRow.row_num);

    // If row is deleted or shrunk, check for occupied slots
    if (newColCount === undefined || newColCount < currentRow.col_count) {
      const occupied = await db.prepare(`
        SELECT s.id, s.location_code, w.wine_name
        FROM slots s
        LEFT JOIN wines w ON w.id = s.wine_id
        WHERE s.storage_area_id = $1
          AND s.row_num = $2
          AND s.col_num > $3
          AND s.wine_id IS NOT NULL
      `).all(id, currentRow.row_num, newColCount || 0);

      blockedSlots.push(...occupied);
    }
  }

  if (blockedSlots.length > 0) {
    return res.status(409).json({
      error: 'Cannot shrink layout - occupied slots would be removed',
      blocked_by: blockedSlots.map(s => ({
        location: s.location_code,
        wine_name: s.wine_name
      })),
      suggestion: 'Move these wines to other slots first, or use evacuation mode'
    });
  }

  // Update rows (delete old, insert new)
  await db.prepare(`
    DELETE FROM storage_area_rows WHERE storage_area_id = $1
  `).run(id);

  for (const row of rows) {
    await db.prepare(`
      INSERT INTO storage_area_rows (storage_area_id, row_num, col_count)
      VALUES ($1, $2, $3)
    `).run(id, row.row_num, row.col_count);
  }

  res.json({
    message: 'Layout updated successfully',
    data: { storage_area_id: id, rows }
  });
}));

/**
 * DELETE /api/storage-areas/:id
 * Delete a storage area
 * Validates: Area must be empty
 * @param {string} id - Storage area UUID
 * @returns {Object} Deletion confirmation
 */
router.delete('/:id', validateParams(storageAreaIdSchema), asyncHandler(async (req, res) => {
  const { cellarId } = req;
  const { id } = req.params;

  // Verify area exists
  const area = await db.prepare(`
    SELECT name FROM storage_areas WHERE id = $1 AND cellar_id = $2
  `).get(id, cellarId);

  if (!area) {
    return res.status(404).json({ error: 'Storage area not found' });
  }

  // Check if area has any occupied slots
  const occupied = await db.prepare(`
    SELECT COUNT(*) as count FROM slots
    WHERE storage_area_id = $1 AND wine_id IS NOT NULL
  `).get(id);

  if (occupied.count > 0) {
    return res.status(409).json({
      error: `Cannot delete "${area.name}" - it contains ${occupied.count} wine(s)`,
      suggestion: 'Move all wines to other storage areas first'
    });
  }

  // Delete area (cascade will handle rows and empty slots)
  await db.prepare(`
    DELETE FROM storage_areas WHERE id = $1 AND cellar_id = $2
  `).run(id, cellarId);

  res.json({
    message: `Storage area "${area.name}" deleted`
  });
}));

/**
 * POST /api/storage-areas/from-template
 * Create storage area from preset template
 * Templates: wine_fridge_small, wine_fridge_medium, wine_fridge_large,
 *            kitchen_fridge, cellar_small, cellar_medium, cellar_large,
 *            rack_countertop, rack_floor
 * @body {Object} template - Template name, optional overrides (name, notes)
 * @returns {Object} Created storage area
 */
router.post('/from-template', validateBody(fromTemplateSchema), asyncHandler(async (req, res) => {
  const { cellarId } = req;
  const { template, name: overrideName, notes: overrideNotes } = req.body;

  // Template definitions (canonical format with explicit rows)
  const TEMPLATES = {
    wine_fridge_small: {
      name: 'Wine Fridge',
      storage_type: 'wine_fridge',
      temp_zone: 'cool',
      rows: [
        { row_num: 1, col_count: 6 },
        { row_num: 2, col_count: 6 }
      ]
    },
    wine_fridge_medium: {
      name: 'Wine Fridge',
      storage_type: 'wine_fridge',
      temp_zone: 'cool',
      rows: [
        { row_num: 1, col_count: 6 },
        { row_num: 2, col_count: 6 },
        { row_num: 3, col_count: 6 },
        { row_num: 4, col_count: 6 }
      ]
    },
    wine_fridge_large: {
      name: 'Wine Fridge',
      storage_type: 'wine_fridge',
      temp_zone: 'cool',
      rows: Array.from({ length: 6 }, (_, i) => ({
        row_num: i + 1,
        col_count: 8
      }))
    },
    kitchen_fridge: {
      name: 'Kitchen Fridge',
      storage_type: 'kitchen_fridge',
      temp_zone: 'cold',
      rows: [{ row_num: 1, col_count: 6 }],
      warning: 'Only for short-term chilling before serving'
    },
    cellar_small: {
      name: 'Wine Cellar',
      storage_type: 'cellar',
      temp_zone: 'cellar',
      rows: Array.from({ length: 5 }, (_, i) => ({
        row_num: i + 1,
        col_count: 9
      }))
    },
    cellar_medium: {
      name: 'Wine Cellar',
      storage_type: 'cellar',
      temp_zone: 'cellar',
      rows: Array.from({ length: 10 }, (_, i) => ({
        row_num: i + 1,
        col_count: 9
      }))
    },
    cellar_large: {
      name: 'Wine Cellar',
      storage_type: 'cellar',
      temp_zone: 'cellar',
      rows: [
        { row_num: 1, col_count: 7 },
        ...Array.from({ length: 18 }, (_, i) => ({
          row_num: i + 2,
          col_count: 9
        }))
      ]
    },
    rack_countertop: {
      name: 'Kitchen Rack',
      storage_type: 'rack',
      temp_zone: 'ambient',
      rows: [{ row_num: 1, col_count: 6 }]
    },
    rack_floor: {
      name: 'Wine Rack',
      storage_type: 'rack',
      temp_zone: 'ambient',
      rows: Array.from({ length: 4 }, (_, i) => ({
        row_num: i + 1,
        col_count: 6
      }))
    }
  };

  const templateDef = TEMPLATES[template];
  if (!templateDef) {
    const available = Object.keys(TEMPLATES);
    return res.status(400).json({
      error: `Unknown template "${template}"`,
      available_templates: available
    });
  }

  // Use override name if provided, otherwise template name
  const areaName = overrideName || templateDef.name;

  // Create via POST /:id endpoint (reuse validation)
  req.body = {
    name: areaName,
    storage_type: templateDef.storage_type,
    temp_zone: templateDef.temp_zone,
    rows: templateDef.rows,
    notes: overrideNotes || templateDef.notes
  };

  // Call main POST handler
  return router.stack.find(layer => layer.route?.methods.post)?.handle(req, res);
}));

export default router;
