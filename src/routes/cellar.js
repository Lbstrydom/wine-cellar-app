/**
 * @fileoverview API endpoints for cellar zone management.
 * @module routes/cellar
 */

import express from 'express';
import db from '../db/index.js';
import { CELLAR_ZONES } from '../config/cellarZones.js';
import { analyseCellar, shouldTriggerAIReview, getFridgeCandidates } from '../services/cellarAnalysis.js';
import { findBestZone, findAvailableSlot } from '../services/cellarPlacement.js';
import { getCellarOrganisationAdvice } from '../services/cellarAI.js';
import {
  getActiveZoneMap,
  getZoneStatuses,
  getAllZoneAllocations,
  updateZoneWineCount
} from '../services/cellarAllocation.js';
import {
  getZoneMetadata,
  getAllZoneMetadata,
  getAllZonesWithIntent,
  updateZoneMetadata,
  confirmZoneMetadata,
  getZonesNeedingReview
} from '../services/zoneMetadata.js';
import { analyseFridge } from '../services/fridgeStocking.js';

const router = express.Router();

/**
 * Get all wines with their slot assignments and drinking windows.
 * @returns {Array} Wines with location data and drink_by_year
 */
function getAllWinesWithSlots() {
  return db.prepare(`
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
    LEFT JOIN slots s ON s.wine_id = w.id
    LEFT JOIN drinking_windows dw ON dw.wine_id = w.id
  `).all();
}

/**
 * Get currently occupied slots.
 * @returns {Set<string>} Set of occupied slot IDs
 */
function getOccupiedSlots() {
  const slots = db.prepare(
    'SELECT location_code FROM slots WHERE wine_id IS NOT NULL'
  ).all();
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
 * Get current zone → row mapping.
 */
router.get('/zone-map', (_req, res) => {
  try {
    const zoneMap = getActiveZoneMap();
    res.json(zoneMap);
  } catch (err) {
    console.error('[CellarAPI] Zone map error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/zone-statuses
 * Get all zones with their allocation status.
 */
router.get('/zone-statuses', (_req, res) => {
  try {
    const statuses = getZoneStatuses();
    res.json(statuses);
  } catch (err) {
    console.error('[CellarAPI] Zone statuses error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/allocations
 * Get all current zone allocations.
 */
router.get('/allocations', (_req, res) => {
  try {
    const allocations = getAllZoneAllocations();
    res.json(allocations);
  } catch (err) {
    console.error('[CellarAPI] Allocations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Placement Endpoints
// ============================================================

/**
 * POST /api/cellar/suggest-placement
 * Get placement suggestion for a wine.
 */
router.post('/suggest-placement', (req, res) => {
  try {
    const { wine } = req.body;
    if (!wine) {
      return res.status(400).json({ error: 'Wine object required' });
    }

    const occupiedSlots = getOccupiedSlots();
    const zoneMatch = findBestZone(wine);
    const availableSlot = findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine);

    res.json({
      success: true,
      suggestion: {
        zone: zoneMatch,
        slot: availableSlot
      }
    });
  } catch (err) {
    console.error('[CellarAPI] Suggest placement error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/suggest-placement/:wineId
 * Get placement suggestion for an existing wine by ID.
 */
router.get('/suggest-placement/:wineId', (req, res) => {
  try {
    const wineId = parseInt(req.params.wineId, 10);
    const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    const occupiedSlots = getOccupiedSlots();
    const zoneMatch = findBestZone(wine);
    const availableSlot = findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine);

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
  } catch (err) {
    console.error('[CellarAPI] Suggest placement error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Analysis Endpoints
// ============================================================

/**
 * GET /api/cellar/analyse
 * Get full cellar analysis with fridge status.
 */
router.get('/analyse', (_req, res) => {
  try {
    const wines = getAllWinesWithSlots();
    const report = analyseCellar(wines);

    // Add fridge candidates (legacy)
    report.fridgeCandidates = getFridgeCandidates(wines);

    // Add fridge status with par-levels
    const fridgeWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('F');
    });
    const cellarWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('R');
    });
    report.fridgeStatus = analyseFridge(fridgeWines, cellarWines);

    res.json({
      success: true,
      report,
      shouldTriggerAIReview: shouldTriggerAIReview(report)
    });
  } catch (err) {
    console.error('[CellarAPI] Analyse error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/analyse/ai
 * Get AI-enhanced analysis.
 */
router.get('/analyse/ai', async (req, res) => {
  try {
    const wines = getAllWinesWithSlots();
    const report = analyseCellar(wines);

    // Add fridge candidates (legacy)
    report.fridgeCandidates = getFridgeCandidates(wines);

    // Add fridge status with par-levels
    const fridgeWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('F');
    });
    const cellarWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('R');
    });
    report.fridgeStatus = analyseFridge(fridgeWines, cellarWines);

    const aiResult = await getCellarOrganisationAdvice(report);

    res.json({
      success: true,
      report,
      aiAdvice: aiResult.success ? aiResult.advice : aiResult.fallback,
      aiSuccess: aiResult.success,
      aiError: aiResult.error || null
    });
  } catch (err) {
    console.error('[CellarAPI] AI analyse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Action Endpoints
// ============================================================

/**
 * POST /api/cellar/execute-moves
 * Execute wine moves.
 */
router.post('/execute-moves', (req, res) => {
  try {
    const { moves } = req.body;
    if (!Array.isArray(moves) || moves.length === 0) {
      return res.status(400).json({ error: 'Moves array required' });
    }

    const results = [];
    const updateSlot = db.prepare(
      'UPDATE slots SET wine_id = ? WHERE location_code = ?'
    );
    const updateWineZone = db.prepare(
      'UPDATE wines SET zone_id = ?, zone_confidence = ? WHERE id = ?'
    );

    const transaction = db.transaction((movesToExecute) => {
      for (const move of movesToExecute) {
        // Clear source slot
        updateSlot.run(null, move.from);

        // Set target slot
        updateSlot.run(move.wineId, move.to);

        // Update wine zone assignment
        if (move.zoneId) {
          updateWineZone.run(move.zoneId, move.confidence || 'medium', move.wineId);
        }

        results.push({
          wineId: move.wineId,
          from: move.from,
          to: move.to,
          success: true
        });
      }
    });

    transaction(moves);

    res.json({
      success: true,
      moved: results.length,
      results
    });
  } catch (err) {
    console.error('[CellarAPI] Execute moves error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/assign-zone
 * Manually assign a wine to a zone.
 */
router.post('/assign-zone', (req, res) => {
  try {
    const { wineId, zoneId, confidence } = req.body;

    if (!wineId || !zoneId) {
      return res.status(400).json({ error: 'wineId and zoneId required' });
    }

    // Get current zone for count update
    const wine = db.prepare('SELECT zone_id FROM wines WHERE id = ?').get(wineId);
    const oldZoneId = wine?.zone_id;

    // Update wine
    db.prepare(
      'UPDATE wines SET zone_id = ?, zone_confidence = ? WHERE id = ?'
    ).run(zoneId, confidence || 'manual', wineId);

    // Update zone counts
    if (oldZoneId && oldZoneId !== zoneId) {
      updateZoneWineCount(oldZoneId, -1);
    }
    if (zoneId !== oldZoneId) {
      updateZoneWineCount(zoneId, 1);
    }

    res.json({
      success: true,
      wineId,
      zoneId,
      previousZone: oldZoneId
    });
  } catch (err) {
    console.error('[CellarAPI] Assign zone error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/update-wine-attributes
 * Update canonical wine attributes (grapes, region, etc.).
 */
router.post('/update-wine-attributes', (req, res) => {
  try {
    const { wineId, attributes } = req.body;

    if (!wineId) {
      return res.status(400).json({ error: 'wineId required' });
    }

    const allowedFields = ['grapes', 'region', 'appellation', 'winemaking', 'sweetness', 'country'];
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(attributes || {})) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = ?`);
        // Stringify arrays for JSON storage
        values.push(Array.isArray(value) ? JSON.stringify(value) : value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid attributes to update' });
    }

    values.push(wineId);
    db.prepare(
      `UPDATE wines SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    // Re-evaluate zone placement
    const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wineId);
    const newZoneMatch = findBestZone(wine);

    res.json({
      success: true,
      wineId,
      updatedFields: updates.map(u => u.split(' = ')[0]),
      suggestedZone: newZoneMatch
    });
  } catch (err) {
    console.error('[CellarAPI] Update attributes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Zone Metadata Endpoints
// ============================================================

/**
 * GET /api/cellar/zone-metadata
 * Get all zone metadata with intent descriptions.
 */
router.get('/zone-metadata', (_req, res) => {
  try {
    const metadata = getAllZoneMetadata();
    res.json({ success: true, metadata });
  } catch (err) {
    console.error('[CellarAPI] Zone metadata error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/zone-metadata/:zoneId
 * Get metadata for a specific zone.
 */
router.get('/zone-metadata/:zoneId', (req, res) => {
  try {
    const { zoneId } = req.params;
    const metadata = getZoneMetadata(zoneId);

    if (!metadata) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    res.json({ success: true, metadata });
  } catch (err) {
    console.error('[CellarAPI] Zone metadata error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/zones-with-intent
 * Get all zones with merged code config and database metadata.
 */
router.get('/zones-with-intent', (_req, res) => {
  try {
    const zones = getAllZonesWithIntent();
    res.json({ success: true, zones });
  } catch (err) {
    console.error('[CellarAPI] Zones with intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/cellar/zone-metadata/:zoneId
 * Update zone metadata (user edit).
 */
router.put('/zone-metadata/:zoneId', (req, res) => {
  try {
    const { zoneId } = req.params;
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const metadata = updateZoneMetadata(zoneId, updates, false);

    if (!metadata) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    res.json({ success: true, metadata });
  } catch (err) {
    console.error('[CellarAPI] Update zone metadata error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/zone-metadata/:zoneId/confirm
 * Confirm zone metadata (mark as user-reviewed).
 */
router.post('/zone-metadata/:zoneId/confirm', (req, res) => {
  try {
    const { zoneId } = req.params;
    const metadata = confirmZoneMetadata(zoneId);

    if (!metadata) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    res.json({ success: true, metadata });
  } catch (err) {
    console.error('[CellarAPI] Confirm zone metadata error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/zones-needing-review
 * Get zones with AI suggestions that haven't been confirmed.
 */
router.get('/zones-needing-review', (_req, res) => {
  try {
    const zones = getZonesNeedingReview();
    res.json({ success: true, zones });
  } catch (err) {
    console.error('[CellarAPI] Zones needing review error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Zone Layout Setup Endpoints
// ============================================================

import {
  proposeZoneLayout,
  saveZoneLayout,
  getSavedZoneLayout,
  generateConsolidationMoves
} from '../services/zoneLayoutProposal.js';

/**
 * GET /api/cellar/zone-layout/propose
 * Get AI-proposed zone layout based on current collection.
 */
router.get('/zone-layout/propose', (_req, res) => {
  try {
    const proposal = proposeZoneLayout();
    res.json({ success: true, ...proposal });
  } catch (err) {
    console.error('[CellarAPI] Zone layout propose error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/zone-layout
 * Get current saved zone layout.
 */
router.get('/zone-layout', (_req, res) => {
  try {
    const layout = getSavedZoneLayout();
    res.json({
      success: true,
      configured: layout.length > 0,
      layout
    });
  } catch (err) {
    console.error('[CellarAPI] Get zone layout error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/zone-layout/confirm
 * Save confirmed zone layout.
 */
router.post('/zone-layout/confirm', (req, res) => {
  try {
    const { assignments } = req.body;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'Assignments array required' });
    }

    saveZoneLayout(assignments);

    res.json({
      success: true,
      message: `Saved layout with ${assignments.length} zones`
    });
  } catch (err) {
    console.error('[CellarAPI] Confirm zone layout error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/zone-layout/moves
 * Generate moves needed to consolidate wines into assigned zones.
 */
router.get('/zone-layout/moves', (_req, res) => {
  try {
    const result = generateConsolidationMoves();

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[CellarAPI] Generate moves error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Zone Classification Chat Endpoints
// ============================================================

import { discussZoneClassification, reassignWineZone } from '../services/zoneChat.js';

/**
 * POST /api/cellar/zone-chat
 * Chat about wine zone classifications with AI sommelier.
 */
router.post('/zone-chat', async (req, res) => {
  try {
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
    const wines = getAllWinesWithSlots().filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot?.startsWith('R');
    });

    const result = await discussZoneClassification(message, wines, context);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[CellarAPI] Zone chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/zone-reassign
 * Reassign a wine to a different zone (user override).
 */
router.post('/zone-reassign', (req, res) => {
  try {
    const { wineId, newZoneId, reason } = req.body;

    if (!wineId || !newZoneId) {
      return res.status(400).json({ error: 'wineId and newZoneId required' });
    }

    const result = reassignWineZone(wineId, newZoneId, reason);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[CellarAPI] Zone reassign error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
