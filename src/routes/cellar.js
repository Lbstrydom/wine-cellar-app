/**
 * @fileoverview Core cellar zone endpoints: zone info, placement suggestions, zone actions, and wine attribute updates.
 * @module routes/cellar
 */

import express from 'express';
import db from '../db/index.js';
import { CELLAR_ZONES } from '../config/cellarZones.js';
import { findBestZone, findAvailableSlot } from '../services/cellarPlacement.js';
import {
  getActiveZoneMap,
  getZoneStatuses,
  getAllZoneAllocations,
  allocateRowToZone,
  updateZoneWineCount
} from '../services/cellarAllocation.js';
import { invalidateAnalysisCache } from '../services/cacheService.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { reassignWineZone } from '../services/zoneChat.js';

const router = express.Router();

/**
 * Get all wines with their slot assignments and drinking windows.
 * @param {string} cellarId - Cellar ID to filter by
 * @returns {Promise<Array>} Wines with location data and drink_by_year
 */
export async function getAllWinesWithSlots(cellarId) {
  return await db.prepare(`
    SELECT
      w.id,
      w.wine_name,
      w.vintage,
      w.style,
      w.colour,
      w.country,
      w.grapes,
      w.region,
      w.appellation,
      w.winemaking,
      w.sweetness,
      w.zone_id,
      w.zone_confidence,
      w.drink_from,
      w.drink_until,
      s.location_code as slot_id,
      dw.drink_by_year,
      dw.drink_from_year,
      dw.peak_year
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1
    LEFT JOIN drinking_windows dw ON dw.wine_id = w.id
    WHERE w.cellar_id = $1
  `).all(cellarId);
}

/**
 * Get currently occupied slots.
 * @param {string} cellarId - Cellar ID to filter by
 * @returns {Promise<Set<string>>} Set of occupied slot IDs
 */
async function getOccupiedSlots(cellarId) {
  const slots = await db.prepare(
    'SELECT location_code FROM slots WHERE cellar_id = $1 AND wine_id IS NOT NULL'
  ).all(cellarId);
  return new Set(slots.map(s => s.location_code));
}

// ============================================================
// Zone Information Endpoints
// ============================================================

/**
 * GET /api/cellar/zones
 * Get all zone definitions.
 */
router.get('/zones', (_req, res) => {
  res.json({
    fridge: CELLAR_ZONES.fridge,
    zones: CELLAR_ZONES.zones.map(z => ({
      id: z.id,
      displayName: z.displayName,
      color: z.color,
      isBufferZone: z.isBufferZone || false,
      isFallbackZone: z.isFallbackZone || false,
      isCuratedZone: z.isCuratedZone || false,
      preferredRowRange: z.preferredRowRange || []
    }))
  });
});

/**
 * GET /api/cellar/zone-map
 * Get current zone -> row mapping.
 */
router.get('/zone-map', asyncHandler(async (req, res) => {
  const zoneMap = await getActiveZoneMap(req.cellarId);
  res.json(zoneMap);
}));

/**
 * GET /api/cellar/zone-statuses
 * Get all zones with their allocation status.
 */
router.get('/zone-statuses', asyncHandler(async (req, res) => {
  const statuses = await getZoneStatuses(req.cellarId);
  res.json(statuses);
}));

/**
 * GET /api/cellar/allocations
 * Get all current zone allocations.
 */
router.get('/allocations', asyncHandler(async (req, res) => {
  const allocations = await getAllZoneAllocations(req.cellarId);
  res.json(allocations);
}));

// ============================================================
// Placement Endpoints
// ============================================================

/**
 * POST /api/cellar/suggest-placement
 * Get placement suggestion for a wine.
 */
router.post('/suggest-placement', asyncHandler(async (req, res) => {
  const { wine } = req.body;
  if (!wine) {
    return res.status(400).json({ error: 'Wine object required' });
  }

  const occupiedSlots = await getOccupiedSlots(req.cellarId);
  const zoneMatch = findBestZone(wine);
  const availableSlot = await findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine, { cellarId: req.cellarId });

  res.json({
    success: true,
    suggestion: {
      zone: zoneMatch,
      slot: availableSlot
    }
  });
}));

/**
 * GET /api/cellar/suggest-placement/:wineId
 * Get placement suggestion for an existing wine by ID.
 */
router.get('/suggest-placement/:wineId', asyncHandler(async (req, res) => {
  const wineId = parseInt(req.params.wineId, 10);
  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const occupiedSlots = await getOccupiedSlots(req.cellarId);
  const zoneMatch = findBestZone(wine);
  const availableSlot = await findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine, { cellarId: req.cellarId });

  res.json({
    success: true,
    wine: {
      id: wine.id,
      name: wine.wine_name,
      vintage: wine.vintage
    },
    suggestion: {
      zone: zoneMatch,
      slot: availableSlot
    }
  });
}));

// ============================================================
// Zone Action Endpoints
// ============================================================

/**
 * POST /api/cellar/zones/allocate-row
 * Assign an additional row to an existing zone.
 */
router.post('/zones/allocate-row', asyncHandler(async (req, res) => {
  const { zoneId } = req.body || {};
  if (!zoneId) {
    return res.status(400).json({ success: false, error: 'zoneId required' });
  }

  const row = await allocateRowToZone(zoneId, req.cellarId, { incrementWineCount: false });
  await invalidateAnalysisCache(null, req.cellarId);

  res.json({
    success: true,
    zoneId,
    row
  });
}));

/**
 * POST /api/cellar/zones/merge
 * Merge all wines and allocated rows from sourceZoneId into targetZoneId.
 */
router.post('/zones/merge', asyncHandler(async (req, res) => {
  const { sourceZoneId, targetZoneId } = req.body || {};
  if (!sourceZoneId || !targetZoneId) {
    return res.status(400).json({ success: false, error: 'sourceZoneId and targetZoneId required' });
  }
  if (sourceZoneId === targetZoneId) {
    return res.status(400).json({ success: false, error: 'sourceZoneId and targetZoneId must differ' });
  }

  const sourceZone = await db
    .prepare('SELECT zone_id FROM cellar_zones WHERE cellar_id = $1 AND zone_id = $2')
    .get(req.cellarId, sourceZoneId);
  const targetZone = await db
    .prepare('SELECT zone_id FROM cellar_zones WHERE cellar_id = $1 AND zone_id = $2')
    .get(req.cellarId, targetZoneId);

  if (!sourceZone || !targetZone) {
    return res.status(404).json({ success: false, error: 'Zone not found in this cellar' });
  }

  const sourceAlloc = await db.prepare(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2'
  ).get(req.cellarId, sourceZoneId);
  const targetAlloc = await db.prepare(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2'
  ).get(req.cellarId, targetZoneId);

  const sourceRows = sourceAlloc ? JSON.parse(sourceAlloc.assigned_rows) : [];
  const targetRows = targetAlloc ? JSON.parse(targetAlloc.assigned_rows) : [];

  const mergedRows = [...targetRows, ...sourceRows].filter(Boolean);

  const mergedWineCount = (targetAlloc?.wine_count || 0) + (sourceAlloc?.wine_count || 0);
  await db.transaction(async (client) => {
    // Move wines
    await client.query(
      'UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND zone_id = $3',
      [targetZoneId, req.cellarId, sourceZoneId]
    );

    // Update target allocation
    if (targetAlloc) {
      await client.query(
        `UPDATE zone_allocations
         SET assigned_rows = $1, wine_count = $2, updated_at = CURRENT_TIMESTAMP
         WHERE cellar_id = $3 AND zone_id = $4`,
        [JSON.stringify(mergedRows), mergedWineCount, req.cellarId, targetZoneId]
      );
    } else {
      await client.query(
        `INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
        [req.cellarId, targetZoneId, JSON.stringify(mergedRows), mergedWineCount]
      );
    }

    // Remove source allocation
    await client.query(
      'DELETE FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
      [req.cellarId, sourceZoneId]
    );
  });

  await invalidateAnalysisCache(null, req.cellarId);

  res.json({
    success: true,
    sourceZoneId,
    targetZoneId,
    mergedRows
  });
}));

// ============================================================
// Wine Zone Assignment Endpoints
// ============================================================

/**
 * POST /api/cellar/assign-zone
 * Manually assign a wine to a zone.
 */
router.post('/assign-zone', asyncHandler(async (req, res) => {
  const { wineId, zoneId, confidence } = req.body;

  if (!wineId || !zoneId) {
    return res.status(400).json({ error: 'wineId and zoneId required' });
  }

  // Get current zone for count update
  const wine = await db.prepare('SELECT zone_id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  const oldZoneId = wine?.zone_id;

  // Update wine
  await db.prepare(
    'UPDATE wines SET zone_id = $1, zone_confidence = $2 WHERE cellar_id = $3 AND id = $4'
  ).run(zoneId, confidence || 'manual', req.cellarId, wineId);

  // Update zone counts
  if (oldZoneId && oldZoneId !== zoneId) {
    await updateZoneWineCount(oldZoneId, req.cellarId, -1);
  }
  if (zoneId !== oldZoneId) {
    await updateZoneWineCount(zoneId, req.cellarId, 1);
  }

  res.json({
    success: true,
    wineId,
    zoneId,
    previousZone: oldZoneId
  });
}));

/**
 * POST /api/cellar/update-wine-attributes
 * Update canonical wine attributes (grapes, region, etc.).
 */
router.post('/update-wine-attributes', asyncHandler(async (req, res) => {
  const { wineId, attributes } = req.body;

  if (!wineId) {
    return res.status(400).json({ error: 'wineId required' });
  }

  const allowedFields = ['grapes', 'region', 'appellation', 'winemaking', 'sweetness', 'country'];
  const updates = [];
  const values = [];

  for (const [key, value] of Object.entries(attributes || {})) {
    if (allowedFields.includes(key)) {
      const placeholderIndex = updates.length + 1;
      updates.push(`${key} = $${placeholderIndex}`);
      // Stringify arrays for JSON storage
      values.push(Array.isArray(value) ? JSON.stringify(value) : value);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid attributes to update' });
  }

  values.push(req.cellarId, wineId);
  const cellarParamIndex = updates.length + 1;
  const wineParamIndex = updates.length + 2;
  // Safe: Column names validated against allowedFields whitelist above
  const updateSql = updates.join(', ');
  await db.prepare(
    'UPDATE wines SET ' + updateSql + ' WHERE cellar_id = $' + cellarParamIndex + ' AND id = $' + wineParamIndex
  ).run(...values);

  // Re-evaluate zone placement
  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
  const newZoneMatch = findBestZone(wine);

  res.json({
    success: true,
    wineId,
    updatedFields: updates.map(u => u.split(' = ')[0]),
    suggestedZone: newZoneMatch
  });
}));

/**
 * POST /api/cellar/zone-reassign
 * Reassign a wine to a different zone (user override).
 */
router.post('/zone-reassign', asyncHandler(async (req, res) => {
  const { wineId, newZoneId, reason } = req.body;

  if (!wineId || !newZoneId) {
    return res.status(400).json({ error: 'wineId and newZoneId required' });
  }

  const result = await reassignWineZone(wineId, newZoneId, reason, req.cellarId);

  res.json({
    success: true,
    ...result
  });
}));

export default router;
