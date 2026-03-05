/**
 * @fileoverview API endpoints for zone metadata, zone layout proposals, and zone classification chat.
 * @module routes/cellarZoneLayout
 */

import express from 'express';
import {
  getZoneMetadata,
  getAllZoneMetadata,
  getAllZonesWithIntent,
  updateZoneMetadata,
  confirmZoneMetadata,
  getZonesNeedingReview
} from '../services/zone/zoneMetadata.js';
import {
  proposeZoneLayout,
  saveZoneLayout,
  getSavedZoneLayout,
  generateConsolidationMoves
} from '../services/zone/zoneLayoutProposal.js';
import { invalidateAnalysisCache } from '../services/shared/cacheService.js';
import { discussZoneClassification } from '../services/zone/zoneChat.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { getAllWinesWithSlots } from './cellar.js';
import { getStorageAreasByType, getCellarRowCount } from '../services/cellar/cellarLayout.js';
import { getRowCapacity } from '../services/cellar/slotUtils.js';

const router = express.Router();

// ============================================================
// Zone Metadata Endpoints
// ============================================================

/**
 * GET /api/cellar/zone-metadata
 * Get all zone metadata with intent descriptions.
 */
router.get('/zone-metadata', asyncHandler(async (_req, res) => {
  const metadata = await getAllZoneMetadata();
  res.json({ success: true, metadata });
}));

/**
 * GET /api/cellar/zone-metadata/:zoneId
 * Get metadata for a specific zone.
 */
router.get('/zone-metadata/:zoneId', asyncHandler(async (req, res) => {
  const { zoneId } = req.params;
  const metadata = await getZoneMetadata(zoneId);

  if (!metadata) {
    return res.status(404).json({ error: 'Zone not found' });
  }

  res.json({ success: true, metadata });
}));

/**
 * GET /api/cellar/zones-with-intent
 * Get all zones with merged code config and database metadata.
 */
router.get('/zones-with-intent', asyncHandler(async (_req, res) => {
  const zones = await getAllZonesWithIntent();
  res.json({ success: true, zones });
}));

/**
 * PUT /api/cellar/zone-metadata/:zoneId
 * Update zone metadata (user edit).
 */
router.put('/zone-metadata/:zoneId', asyncHandler(async (req, res) => {
  const { zoneId } = req.params;
  const updates = req.body;

  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  const metadata = await updateZoneMetadata(zoneId, updates, false);

  if (!metadata) {
    return res.status(404).json({ error: 'Zone not found' });
  }

  res.json({ success: true, metadata });
}));

/**
 * POST /api/cellar/zone-metadata/:zoneId/confirm
 * Confirm zone metadata (mark as user-reviewed).
 */
router.post('/zone-metadata/:zoneId/confirm', asyncHandler(async (req, res) => {
  const { zoneId } = req.params;
  const metadata = await confirmZoneMetadata(zoneId);

  if (!metadata) {
    return res.status(404).json({ error: 'Zone not found' });
  }

  res.json({ success: true, metadata });
}));

/**
 * GET /api/cellar/zones-needing-review
 * Get zones with AI suggestions that haven't been confirmed.
 */
router.get('/zones-needing-review', asyncHandler(async (_req, res) => {
  const zones = await getZonesNeedingReview();
  res.json({ success: true, zones });
}));

// ============================================================
// Zone Layout Setup Endpoints
// ============================================================

/**
 * GET /api/cellar/zone-layout/propose
 * Get AI-proposed zone layout based on current collection.
 */
router.get('/zone-layout/propose', asyncHandler(async (req, res) => {
  const proposal = await proposeZoneLayout(req.cellarId);
  res.json({ success: true, ...proposal });
}));

/**
 * GET /api/cellar/zone-layout
 * Get current saved zone layout.
 */
router.get('/zone-layout', asyncHandler(async (req, res) => {
  const layout = await getSavedZoneLayout(req.cellarId);
  res.json({
    success: true,
    configured: layout.length > 0,
    layout
  });
}));

/**
 * POST /api/cellar/zone-layout/confirm
 * Save confirmed zone layout.
 */
router.post('/zone-layout/confirm', asyncHandler(async (req, res) => {
  const { assignments } = req.body;

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: 'Assignments array required' });
  }

  await saveZoneLayout(assignments, req.cellarId);
  await invalidateAnalysisCache(null, req.cellarId);

  res.json({
    success: true,
    message: `Saved layout with ${assignments.length} zones`
  });
}));

/**
 * GET /api/cellar/zone-layout/moves
 * Generate moves needed to consolidate wines into assigned zones.
 */
router.get('/zone-layout/moves', asyncHandler(async (req, res) => {
  const result = await generateConsolidationMoves(req.cellarId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    success: true,
    ...result
  });
}));

// ============================================================
// Zone Classification Chat Endpoints
// ============================================================

/**
 * POST /api/cellar/zone-chat
 * Chat about wine zone classifications with AI sommelier.
 */
router.post('/zone-chat', asyncHandler(async (req, res) => {
  const { message, context } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'AI features require API key configuration'
    });
  }

  // Get current wine data for context
  // Note: getAllWinesWithSlots returns slot_id (from location_code alias)
  const allWines = await getAllWinesWithSlots(req.cellarId);
  const wines = allWines.filter(w => {
    const slot = w.slot_id || w.location_code;
    return slot?.startsWith('R');
  });

  const result = await discussZoneClassification(message, wines, context);

  res.json({
    success: true,
    ...result
  });
}));

/**
 * GET /api/cellar/layout
 * Returns dynamic storage area layout for this cellar.
 * Used by frontend components to replace hardcoded row/slot constants.
 */
router.get('/layout', asyncHandler(async (req, res) => {
  const [areasByType, totalCellarRows] = await Promise.all([
    getStorageAreasByType(req.cellarId),
    getCellarRowCount(req.cellarId)
  ]);

  const storageAreas = [];
  let totalCellarSlots = 0;
  let totalFridgeSlots = 0;

  for (const [storageType, areas] of Object.entries(areasByType)) {
    for (const area of areas) {
      const rows = area.rows.map(r => ({
        rowNum: r.row_num,
        colCount: r.col_count,
        label: r.label || null
      }));
      storageAreas.push({
        id: area.id,
        name: area.name,
        storageType,
        rows
      });
      const slotCount = rows.reduce((sum, r) => sum + r.colCount, 0);
      if (storageType === 'cellar') totalCellarSlots += slotCount;
      if (storageType === 'wine_fridge') totalFridgeSlots += slotCount;
    }
  }

  // Legacy fallback: compute totals from row count when no storage_area_rows exist
  if (totalCellarSlots === 0 && totalCellarRows > 0) {
    for (let r = 1; r <= totalCellarRows; r++) {
      totalCellarSlots += getRowCapacity(`R${r}`, []);
    }
  }
  if (totalFridgeSlots === 0) totalFridgeSlots = 9;

  res.json({ storageAreas, totalCellarSlots, totalFridgeSlots });
}));

export default router;
