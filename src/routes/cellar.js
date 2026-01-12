/**
 * @fileoverview API endpoints for cellar zone management.
 * @module routes/cellar
 */

import express from 'express';
import db from '../db/index.js';
import { CELLAR_ZONES, getZoneById } from '../config/cellarZones.js';
import { analyseCellar, shouldTriggerAIReview, getFridgeCandidates } from '../services/cellarAnalysis.js';
import { findBestZone, findAvailableSlot } from '../services/cellarPlacement.js';
import { getCellarOrganisationAdvice } from '../services/cellarAI.js';
import { getZoneCapacityAdvice } from '../services/zoneCapacityAdvisor.js';
import {
  getActiveZoneMap,
  getZoneStatuses,
  getAllZoneAllocations,
  allocateRowToZone,
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
import { analyseFridge, suggestFridgeOrganization } from '../services/fridgeStocking.js';
import {
  getCachedAnalysis,
  cacheAnalysis,
  invalidateAnalysisCache,
  getAnalysisCacheInfo
} from '../services/cacheService.js';
import { validateMovePlan } from '../services/movePlanner.js';
import { ensureReconfigurationTables } from '../services/reconfigurationTables.js';
import { putPlan, getPlan, deletePlan } from '../services/reconfigurationPlanStore.js';
import { generateReconfigurationPlan } from '../services/zoneReconfigurationPlanner.js';

const router = express.Router();

/**
 * Get all wines with their slot assignments and drinking windows.
 * @param {string} cellarId - Cellar ID to filter by
 * @returns {Promise<Array>} Wines with location data and drink_by_year
 */
async function getAllWinesWithSlots(cellarId) {
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
 * Get current zone → row mapping.
 */
router.get('/zone-map', async (_req, res) => {
  try {
    const zoneMap = await getActiveZoneMap();
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
router.get('/zone-statuses', async (_req, res) => {
  try {
    const statuses = await getZoneStatuses();
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
router.get('/allocations', async (_req, res) => {
  try {
    const allocations = await getAllZoneAllocations();
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
router.post('/suggest-placement', async (req, res) => {
  try {
    const { wine } = req.body;
    if (!wine) {
      return res.status(400).json({ error: 'Wine object required' });
    }

    const occupiedSlots = await getOccupiedSlots(req.cellarId);
    const zoneMatch = findBestZone(wine);
    const availableSlot = await findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine);

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
router.get('/suggest-placement/:wineId', async (req, res) => {
  try {
    const wineId = parseInt(req.params.wineId, 10);
    const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    const occupiedSlots = await getOccupiedSlots(req.cellarId);
    const zoneMatch = findBestZone(wine);
    const availableSlot = await findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine);

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
 * Run analysis and generate report (shared logic).
 * @param {Array} wines - Wine data
 * @returns {Promise<Object>} Analysis report
 */
async function runAnalysis(wines) {
  const report = await analyseCellar(wines);

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
  report.fridgeStatus = await analyseFridge(fridgeWines, cellarWines);

  return report;
}

/**
 * GET /api/cellar/analyse
 * Get full cellar analysis with fridge status.
 * Uses cache if available and valid.
 */
router.get('/analyse', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const allowFallback = req.query.allowFallback === 'true';
    const cacheKey = allowFallback ? 'full_fallback' : 'full';

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await getCachedAnalysis(cacheKey);
      if (cached) {
        return res.json({
          success: true,
          report: cached.data,
          shouldTriggerAIReview: shouldTriggerAIReview(cached.data),
          fromCache: true,
          cachedAt: cached.createdAt
        });
      }
    }

    // No valid cache, run analysis
    const wines = await getAllWinesWithSlots(req.cellarId);
    const report = await analyseCellar(wines, { allowFallback });

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
    report.fridgeStatus = await analyseFridge(fridgeWines, cellarWines);

    // Cache the result
    const wineCount = wines.filter(w => w.slot_id || w.location_code).length;
    await cacheAnalysis(cacheKey, report, wineCount);

    res.json({
      success: true,
      report,
      shouldTriggerAIReview: shouldTriggerAIReview(report),
      fromCache: false
    });
  } catch (err) {
    console.error('[CellarAPI] Analyse error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/analyse/cache-info
 * Get cache status without running analysis.
 */
router.get('/analyse/cache-info', async (_req, res) => {
  try {
    const info = await getAnalysisCacheInfo('full');
    res.json({
      success: true,
      cached: info !== null,
      ...(info || {})
    });
  } catch (err) {
    console.error('[CellarAPI] Cache info error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/cellar/analyse/cache
 * Invalidate the analysis cache.
 */
router.delete('/analyse/cache', async (_req, res) => {
  try {
    await invalidateAnalysisCache();
    res.json({
      success: true,
      message: 'Analysis cache invalidated'
    });
  } catch (err) {
    console.error('[CellarAPI] Cache invalidation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/fridge-status
 * Get lightweight fridge status only (without full cellar analysis).
 */
router.get('/fridge-status', async (req, res) => {
  try {
    const wines = await getAllWinesWithSlots(req.cellarId);

    const fridgeWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('F');
    });
    const cellarWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('R');
    });

    const status = await analyseFridge(fridgeWines, cellarWines);

    res.json({
      success: true,
      ...status
    });
  } catch (err) {
    console.error('[CellarAPI] Fridge status error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/fridge-organize
 * Get suggestions for organizing fridge wines by category.
 */
router.get('/fridge-organize', async (req, res) => {
  try {
    const wines = await getAllWinesWithSlots(req.cellarId);

    const fridgeWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('F');
    });

    if (fridgeWines.length < 2) {
      return res.json({
        success: true,
        message: 'Not enough wines in fridge to organize',
        moves: [],
        summary: []
      });
    }

    const organization = suggestFridgeOrganization(fridgeWines);

    res.json({
      success: true,
      ...organization
    });
  } catch (err) {
    console.error('[CellarAPI] Fridge organize error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cellar/analyse/ai
 * Get AI-enhanced analysis.
 * Uses cached report if available.
 */
router.get('/analyse/ai', async (req, res) => {
  try {
    let report;
    let fromCache = false;

    // Check cache first
    const cached = await getCachedAnalysis('full');
    if (cached) {
      report = cached.data;
      fromCache = true;
    } else {
      const wines = await getAllWinesWithSlots(req.cellarId);
      report = await runAnalysis(wines);

      // Cache the result
      const wineCount = wines.filter(w => w.slot_id || w.location_code).length;
      await cacheAnalysis('full', report, wineCount);
    }

    const aiResult = await getCellarOrganisationAdvice(report);

    res.json({
      success: true,
      report,
      aiAdvice: aiResult.success ? aiResult.advice : aiResult.fallback,
      aiSuccess: aiResult.success,
      aiError: aiResult.error || null,
      reportFromCache: fromCache
    });
  } catch (err) {
    console.error('[CellarAPI] AI analyse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Zone Capacity Advice (AI)
// ============================================================

/**
 * POST /api/cellar/zone-capacity-advice
 * Get AI recommendations when a zone is at capacity.
 */
router.post('/zone-capacity-advice', async (req, res) => {
  try {
    const {
      overflowingZoneId,
      winesNeedingPlacement,
      currentZoneAllocation,
      availableRows,
      adjacentZones
    } = req.body || {};

    const result = await getZoneCapacityAdvice({
      overflowingZoneId,
      winesNeedingPlacement,
      currentZoneAllocation,
      availableRows,
      adjacentZones
    });

    if (!result.success) {
      const status = result.error?.includes('ANTHROPIC_API_KEY') ? 503 : 400;
      return res.status(status).json({
        success: false,
        error: result.error
      });
    }

    const advice = result.advice;

    // Enrich move_wine actions with concrete slot targets (best-effort)
    if (Array.isArray(advice?.actions) && advice.actions.some(a => a?.type === 'move_wine')) {
      const occupiedSlots = await getOccupiedSlots(req.cellarId);

      for (const action of advice.actions) {
        if (action?.type !== 'move_wine') continue;

        const wineId = action.wineId;
        const toZoneId = action.toZone;
        if (!wineId || !toZoneId) {
          action.error = 'Missing wineId or toZone';
          continue;
        }

        const wine = await db.prepare(`
          SELECT w.*, s.location_code as slot_id
          FROM wines w
          LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = $1
          WHERE w.cellar_id = $1 AND w.id = $2
        `).get(req.cellarId, wineId);

        const from = wine?.slot_id;
        if (!from) {
          action.error = 'Wine location unknown';
          continue;
        }

        const slotResult = await findAvailableSlot(toZoneId, occupiedSlots, wine, {
          allowFallback: false,
          enforceAffinity: false
        });

        if (!slotResult?.slotId) {
          action.error = `No available slot in ${toZoneId}`;
          continue;
        }

        action.from = from;
        action.to = slotResult.slotId;
        action.zoneId = toZoneId;

        // Update occupied set so subsequent moves don't collide
        occupiedSlots.delete(from);
        occupiedSlots.add(slotResult.slotId);
      }
    }

    res.json({ success: true, advice });
  } catch (err) {
    console.error('[CellarAPI] Zone capacity advice error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Zone Action Endpoints
// ============================================================

/**
 * POST /api/cellar/zones/allocate-row
 * Assign an additional row to an existing zone.
 */
router.post('/zones/allocate-row', async (req, res) => {
  try {
    const { zoneId } = req.body || {};
    if (!zoneId) {
      return res.status(400).json({ success: false, error: 'zoneId required' });
    }

    const row = await allocateRowToZone(zoneId, { incrementWineCount: false });
    await invalidateAnalysisCache();

    res.json({
      success: true,
      zoneId,
      row
    });
  } catch (err) {
    console.error('[CellarAPI] Allocate row error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/cellar/zones/merge
 * Merge all wines and allocated rows from sourceZoneId into targetZoneId.
 */
router.post('/zones/merge', async (req, res) => {
  try {
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

    try {
      await db.prepare('BEGIN TRANSACTION').run();

      // Move wines
      await db.prepare('UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND zone_id = $3').run(targetZoneId, req.cellarId, sourceZoneId);

      // Update target allocation
      const mergedWineCount = (targetAlloc?.wine_count || 0) + (sourceAlloc?.wine_count || 0);
      if (targetAlloc) {
        await db.prepare(
          `UPDATE zone_allocations
           SET assigned_rows = $1, wine_count = $2, updated_at = CURRENT_TIMESTAMP
           WHERE cellar_id = $3 AND zone_id = $4`
        ).run(JSON.stringify(mergedRows), mergedWineCount, req.cellarId, targetZoneId);
      } else {
        await db.prepare(
          `INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`
        ).run(req.cellarId, targetZoneId, JSON.stringify(mergedRows), mergedWineCount);
      }

      // Remove source allocation
      await db.prepare('DELETE FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2').run(req.cellarId, sourceZoneId);

      await db.prepare('COMMIT').run();
    } catch (execError) {
      try {
        await db.prepare('ROLLBACK').run();
      } catch (rollbackError) {
        console.error('[CellarAPI] Merge rollback failed:', rollbackError);
      }
      throw execError;
    }

    await invalidateAnalysisCache();

    res.json({
      success: true,
      sourceZoneId,
      targetZoneId,
      mergedRows
    });
  } catch (err) {
    console.error('[CellarAPI] Merge zones error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Holistic Reconfiguration Endpoints
// ============================================================

/**
 * POST /api/cellar/reconfiguration-plan
 * Generate a holistic zone reconfiguration plan.
 */
router.post('/reconfiguration-plan', async (req, res) => {
  try {
    const {
      includeRetirements = true,
      includeNewZones = true,
      stabilityBias = 'moderate'
    } = req.body || {};

    const wines = await getAllWinesWithSlots(req.cellarId);
    const report = await runAnalysis(wines);

    const plan = await generateReconfigurationPlan(report, {
      includeRetirements,
      includeNewZones,
      stabilityBias
    });

    const planId = putPlan({
      generatedAt: new Date().toISOString(),
      options: { includeRetirements, includeNewZones, stabilityBias },
      plan
    });

    res.json({
      success: true,
      planId,
      plan
    });
  } catch (err) {
    console.error('[CellarAPI] Reconfiguration plan error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function getAffectedZoneIdsFromPlan(plan) {
  const zoneIds = new Set();
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];

  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    if (action.type === 'reallocate_row') {
      if (action.fromZoneId) zoneIds.add(action.fromZoneId);
      if (action.toZoneId) zoneIds.add(action.toZoneId);
    } else if (action.type === 'expand_zone' && action.zoneId) {
      zoneIds.add(action.zoneId);
    } else if (action.type === 'merge_zones') {
      if (Array.isArray(action.sourceZones)) {
        action.sourceZones.forEach(z => zoneIds.add(z));
      }
      if (action.targetZoneId) zoneIds.add(action.targetZoneId);
    } else if (action.type === 'retire_zone') {
      if (action.zoneId) zoneIds.add(action.zoneId);
      if (action.mergeIntoZoneId) zoneIds.add(action.mergeIntoZoneId);
    }
  }

  return Array.from(zoneIds);
}

async function allocateRowTransactional(client, cellarId, zoneId, usedRows) {
  const zone = getZoneById(zoneId);
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);

  const preferredRange = zone.preferredRowRange || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  let assignedRow = null;

  for (const rowNum of preferredRange) {
    const rowId = `R${rowNum}`;
    if (!usedRows.has(rowId)) {
      assignedRow = rowId;
      break;
    }
  }

  if (!assignedRow) {
    for (let rowNum = 1; rowNum <= 19; rowNum++) {
      const rowId = `R${rowNum}`;
      if (!usedRows.has(rowId)) {
        assignedRow = rowId;
        break;
      }
    }
  }

  if (!assignedRow) throw new Error('No available rows - cellar at maximum zone capacity');

  const existing = await client.query(
    'SELECT assigned_rows, wine_count, first_wine_date FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, zoneId]
  );

  if (existing.rows.length > 0) {
    const rows = JSON.parse(existing.rows[0].assigned_rows || '[]');
    rows.push(assignedRow);
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify(rows), cellarId, zoneId]
    );
  } else {
    await client.query(
      'INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count) VALUES ($1, $2, $3, NOW(), $4)',
      [cellarId, zoneId, JSON.stringify([assignedRow]), 0]
    );
  }

  usedRows.add(assignedRow);
  return assignedRow;
}

async function mergeZonesTransactional(client, cellarId, sourceZoneId, targetZoneId) {
  if (sourceZoneId === targetZoneId) return;

  const sourceAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, sourceZoneId]
  );
  const targetAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, targetZoneId]
  );

  const sourceRows = sourceAlloc.rows[0]?.assigned_rows ? JSON.parse(sourceAlloc.rows[0].assigned_rows) : [];
  const targetRows = targetAlloc.rows[0]?.assigned_rows ? JSON.parse(targetAlloc.rows[0].assigned_rows) : [];
  const mergedRows = [...targetRows, ...sourceRows].filter(Boolean);

  await client.query('UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND zone_id = $3', [targetZoneId, cellarId, sourceZoneId]);

  const mergedWineCount = (targetAlloc.rows[0]?.wine_count || 0) + (sourceAlloc.rows[0]?.wine_count || 0);

  if (targetAlloc.rows.length > 0) {
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, wine_count = $2, updated_at = NOW() WHERE cellar_id = $3 AND zone_id = $4',
      [JSON.stringify(mergedRows), mergedWineCount, cellarId, targetZoneId]
    );
  } else {
    await client.query(
      'INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count) VALUES ($1, $2, $3, NOW(), $4)',
      [cellarId, targetZoneId, JSON.stringify(mergedRows), mergedWineCount]
    );
  }

  await client.query('DELETE FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2', [cellarId, sourceZoneId]);

  return mergedRows;
}

/**
 * Reallocate a specific row from one zone to another.
 * Works within the fixed physical constraints of the cellar.
 */
async function reallocateRowTransactional(client, cellarId, fromZoneId, toZoneId, rowNumber) {
  if (fromZoneId === toZoneId) return { success: true, skipped: true, reason: 'same zone' };

  const rowId = typeof rowNumber === 'number' ? `R${rowNumber}` : String(rowNumber);

  // Get current allocations
  const fromAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, fromZoneId]
  );
  const toAlloc = await client.query(
    'SELECT assigned_rows, wine_count FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [cellarId, toZoneId]
  );

  const fromRows = fromAlloc.rows[0]?.assigned_rows ? JSON.parse(fromAlloc.rows[0].assigned_rows) : [];
  const toRows = toAlloc.rows[0]?.assigned_rows ? JSON.parse(toAlloc.rows[0].assigned_rows) : [];

  // Verify the row belongs to fromZone - return skip status instead of throwing
  if (!fromRows.includes(rowId)) {
    console.warn(`[reallocateRowTransactional] Skipping: ${rowId} not in ${fromZoneId}'s rows ${JSON.stringify(fromRows)}`);
    return { success: false, skipped: true, reason: `Row ${rowId} is not assigned to zone ${fromZoneId}` };
  }

  // Remove from source zone
  const updatedFromRows = fromRows.filter(r => r !== rowId);
  // Add to target zone
  const updatedToRows = [...toRows, rowId].filter(Boolean);

  // Update source zone allocation
  if (updatedFromRows.length > 0) {
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify(updatedFromRows), cellarId, fromZoneId]
    );
  } else {
    // Zone has no rows left - keep the allocation record but empty
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify([]), cellarId, fromZoneId]
    );
  }

  // Update or create target zone allocation
  if (toAlloc.rows.length > 0) {
    await client.query(
      'UPDATE zone_allocations SET assigned_rows = $1, updated_at = NOW() WHERE cellar_id = $2 AND zone_id = $3',
      [JSON.stringify(updatedToRows), cellarId, toZoneId]
    );
  } else {
    await client.query(
      'INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, first_wine_date, wine_count) VALUES ($1, $2, $3, NOW(), $4)',
      [cellarId, toZoneId, JSON.stringify(updatedToRows), 0]
    );
  }

  return { success: true, skipped: false, fromRows: updatedFromRows, toRows: updatedToRows };
}

/**
 * POST /api/cellar/reconfiguration-plan/apply
 * Apply a previously generated holistic plan.
 */
router.post('/reconfiguration-plan/apply', async (req, res) => {
  try {
    const { planId, skipActions = [] } = req.body || {};
    if (!planId) {
      return res.status(400).json({ success: false, error: 'planId required' });
    }

    const stored = getPlan(planId);
    if (!stored?.plan) {
      return res.status(400).json({ success: false, error: 'Plan not found or expired. Generate a new plan.' });
    }

    await ensureReconfigurationTables();

    const plan = stored.plan;
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const skipSet = new Set(Array.isArray(skipActions) ? skipActions : []);
    const affectedZones = getAffectedZoneIdsFromPlan(plan);

    const result = await db.transaction(async (client) => {
      // Snapshot before-state for undo
      const beforeAlloc = affectedZones.length
        ? await client.query(
          'SELECT cellar_id, zone_id, assigned_rows, wine_count, first_wine_date, updated_at FROM zone_allocations WHERE cellar_id = $1 AND zone_id = ANY($2::text[])',
          [req.cellarId, affectedZones]
        )
        : { rows: [] };
      const beforeWines = affectedZones.length
        ? await client.query(
          'SELECT id, zone_id FROM wines WHERE cellar_id = $1 AND zone_id = ANY($2::text[])',
          [req.cellarId, affectedZones]
        )
        : { rows: [] };

      // Build used row set
      const allAlloc = await client.query('SELECT assigned_rows FROM zone_allocations WHERE cellar_id = $1', [req.cellarId]);
      const usedRows = new Set();
      for (const r of allAlloc.rows) {
        try {
          JSON.parse(r.assigned_rows || '[]').forEach(rowId => usedRows.add(rowId));
        } catch {
          // ignore
        }
      }

      // Build current zone allocation map for validation at apply time
      const zoneAllocMap = new Map();
      const allocWithZone = await client.query('SELECT zone_id, assigned_rows FROM zone_allocations WHERE cellar_id = $1', [req.cellarId]);
      for (const r of allocWithZone.rows) {
        try {
          zoneAllocMap.set(r.zone_id, JSON.parse(r.assigned_rows || '[]'));
        } catch {
          zoneAllocMap.set(r.zone_id, []);
        }
      }

      let zonesChanged = 0;
      let actionsAutoSkipped = 0;

      for (let i = 0; i < actions.length; i++) {
        if (skipSet.has(i)) continue;
        const action = actions[i];
        if (!action || typeof action !== 'object') continue;

        if (action.type === 'reallocate_row') {
          // Move a row from one zone to another (within fixed 19-row limit)
          const { fromZoneId, toZoneId, rowNumber } = action;
          if (!fromZoneId || !toZoneId || rowNumber == null) continue;

          // reallocateRowTransactional now handles validation internally and returns status
          const result = await reallocateRowTransactional(client, req.cellarId, fromZoneId, toZoneId, rowNumber);

          if (result.skipped) {
            console.warn(`[Apply] Skipped reallocate_row action: ${result.reason}`);
            actionsAutoSkipped++;
            continue;
          }

          // Update our local map so subsequent actions see the change
          const rowId = typeof rowNumber === 'number' ? `R${rowNumber}` : String(rowNumber);
          const fromRows = zoneAllocMap.get(fromZoneId) || [];
          zoneAllocMap.set(fromZoneId, fromRows.filter(r => r !== rowId));
          const toRows = zoneAllocMap.get(toZoneId) || [];
          zoneAllocMap.set(toZoneId, [...toRows, rowId]);
          zonesChanged++;
        } else if (action.type === 'expand_zone') {
          const zoneId = action.zoneId;
          if (!zoneId) continue;

          const currentRows = Array.isArray(action.currentRows) ? action.currentRows : [];
          const proposedRows = Array.isArray(action.proposedRows) ? action.proposedRows : [];
          const needed = Math.max(1, proposedRows.length - currentRows.length);

          for (let n = 0; n < needed; n++) {
            await allocateRowTransactional(client, req.cellarId, zoneId, usedRows);
          }
          zonesChanged++;
        } else if (action.type === 'merge_zones') {
          const targetZoneId = action.targetZoneId;
          const sources = Array.isArray(action.sourceZones) ? action.sourceZones : [];
          if (!targetZoneId || sources.length === 0) continue;
          for (const sourceZoneId of sources) {
            await mergeZonesTransactional(client, req.cellarId, sourceZoneId, targetZoneId);
          }
          zonesChanged++;
        } else if (action.type === 'retire_zone') {
          const zoneId = action.zoneId;
          const mergeIntoZoneId = action.mergeIntoZoneId;
          if (!zoneId || !mergeIntoZoneId) continue;
          await mergeZonesTransactional(client, req.cellarId, zoneId, mergeIntoZoneId);
          zonesChanged++;
        }
      }

      const planJson = {
        planId,
        plan,
        options: stored.options || null,
        applied: {
          skipped: Array.from(skipSet),
          appliedAt: new Date().toISOString()
        },
        before: {
          affectedZones,
          zone_allocations: beforeAlloc.rows,
          wines: beforeWines.rows
        }
      };

      const insert = await client.query(
        `INSERT INTO zone_reconfigurations
         (plan_json, changes_summary, bottles_affected, misplaced_before, misplaced_after)
         VALUES ($1::jsonb, $2, $3, $4, $5)
         RETURNING id`,
        [
          JSON.stringify(planJson),
          plan.reasoning || null,
          plan.summary?.bottlesAffected ?? null,
          plan.summary?.misplacedBefore ?? null,
          plan.summary?.misplacedAfter ?? null
        ]
      );

      return {
        reconfigurationId: insert.rows[0].id,
        zonesChanged,
        actionsAutoSkipped
      };
    });

    deletePlan(planId);
    await invalidateAnalysisCache();

    res.json({
      success: true,
      reconfigurationId: result.reconfigurationId,
      applied: {
        zonesChanged: result.zonesChanged,
        actionsAutoSkipped: result.actionsAutoSkipped,
        bottlesMoved: 0
      },
      canUndo: true
    });
  } catch (err) {
    console.error('[CellarAPI] Apply reconfiguration error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/cellar/reconfiguration/:id/undo
 * Undo an applied reconfiguration.
 */
router.post('/reconfiguration/:id/undo', async (req, res) => {
  try {
    const reconfigurationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(reconfigurationId)) {
      return res.status(400).json({ success: false, error: 'Invalid reconfiguration id' });
    }

    await ensureReconfigurationTables();

    await db.transaction(async (client) => {
      const row = await client.query(
        'SELECT id, plan_json, undone_at FROM zone_reconfigurations WHERE cellar_id = $1 AND id = $2',
        [req.cellarId, reconfigurationId]
      );

      const rec = row.rows[0];
      if (!rec) throw new Error('Reconfiguration not found');
      if (rec.undone_at) throw new Error('Reconfiguration already undone');

      const planJson = typeof rec.plan_json === 'string' ? JSON.parse(rec.plan_json) : rec.plan_json;
      const before = planJson?.before || {};
      const affectedZones = Array.isArray(before.affectedZones) ? before.affectedZones : [];
      const beforeAlloc = Array.isArray(before.zone_allocations) ? before.zone_allocations : [];
      const beforeWines = Array.isArray(before.wines) ? before.wines : [];

      if (affectedZones.length > 0) {
        await client.query('DELETE FROM zone_allocations WHERE cellar_id = $1 AND zone_id = ANY($2::text[])', [req.cellarId, affectedZones]);
      }

      for (const alloc of beforeAlloc) {
        await client.query(
          `INSERT INTO zone_allocations (cellar_id, zone_id, assigned_rows, wine_count, first_wine_date, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (cellar_id, zone_id) DO UPDATE SET
             assigned_rows = EXCLUDED.assigned_rows,
             wine_count = EXCLUDED.wine_count,
             first_wine_date = EXCLUDED.first_wine_date,
             updated_at = EXCLUDED.updated_at`,
          [
            alloc.cellar_id || req.cellarId,
            alloc.zone_id,
            alloc.assigned_rows,
            alloc.wine_count ?? 0,
            alloc.first_wine_date || null,
            alloc.updated_at || null
          ]
        );
      }

      for (const wine of beforeWines) {
        await client.query('UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND id = $3', [wine.zone_id, req.cellarId, wine.id]);
      }

      await client.query('UPDATE zone_reconfigurations SET undone_at = NOW() WHERE id = $1', [reconfigurationId]);
    });

    await invalidateAnalysisCache();

    res.json({ success: true, undone: true });
  } catch (err) {
    console.error('[CellarAPI] Undo reconfiguration error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Action Endpoints
// ============================================================

/**
 * POST /api/cellar/execute-moves
 * Execute wine moves with validation and atomicity.
 */
router.post('/execute-moves', async (req, res) => {
  try {
    const { moves } = req.body;
    if (!Array.isArray(moves) || moves.length === 0) {
      return res.status(400).json({ error: 'Moves array required' });
    }

    // Validate move plan before execution
    const validation = await validateMovePlan(moves);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Move plan validation failed',
        validation,
        message: `Cannot execute moves: ${validation.summary.errorCount} validation error(s) detected`
      });
    }

    // Execute all moves in a transaction
    const results = [];
    
    try {
      // Begin transaction
      await db.prepare('BEGIN TRANSACTION').run();

      for (const move of moves) {
        // Clear source slot
        await db.prepare('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3').run(null, req.cellarId, move.from);

        // Set target slot
        await db.prepare('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3').run(move.wineId, req.cellarId, move.to);

        // Update wine zone assignment
        if (move.zoneId) {
          await db.prepare('UPDATE wines SET zone_id = $1, zone_confidence = $2 WHERE cellar_id = $3 AND id = $4').run(
            move.zoneId, move.confidence || 'medium', req.cellarId, move.wineId
          );
        }

        results.push({
          wineId: move.wineId,
          from: move.from,
          to: move.to,
          success: true
        });
      }

      // Commit transaction
      await db.prepare('COMMIT').run();

      // Invalidate analysis cache after successful moves
      await invalidateAnalysisCache();

      res.json({
        success: true,
        moved: results.length,
        results,
        validation
      });
    } catch (execError) {
      // Rollback transaction on error
      try {
        await db.prepare('ROLLBACK').run();
      } catch (rollbackError) {
        console.error('[CellarAPI] Rollback failed:', rollbackError);
      }
      throw execError;
    }
  } catch (err) {
    console.error('[CellarAPI] Execute moves error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/assign-zone
 * Manually assign a wine to a zone.
 */
router.post('/assign-zone', async (req, res) => {
  try {
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
      await updateZoneWineCount(oldZoneId, -1);
    }
    if (zoneId !== oldZoneId) {
      await updateZoneWineCount(zoneId, 1);
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
router.post('/update-wine-attributes', async (req, res) => {
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
    await db.prepare(
      `UPDATE wines SET ${updates.join(', ')} WHERE cellar_id = $${cellarParamIndex} AND id = $${wineParamIndex}`
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
router.get('/zone-metadata', async (_req, res) => {
  try {
    const metadata = await getAllZoneMetadata();
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
router.get('/zone-metadata/:zoneId', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const metadata = await getZoneMetadata(zoneId);

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
router.get('/zones-with-intent', async (_req, res) => {
  try {
    const zones = await getAllZonesWithIntent();
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
router.put('/zone-metadata/:zoneId', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[CellarAPI] Update zone metadata error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/zone-metadata/:zoneId/confirm
 * Confirm zone metadata (mark as user-reviewed).
 */
router.post('/zone-metadata/:zoneId/confirm', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const metadata = await confirmZoneMetadata(zoneId);

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
router.get('/zones-needing-review', async (_req, res) => {
  try {
    const zones = await getZonesNeedingReview();
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
router.get('/zone-layout/propose', async (_req, res) => {
  try {
    const proposal = await proposeZoneLayout();
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
router.get('/zone-layout', async (_req, res) => {
  try {
    const layout = await getSavedZoneLayout();
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
router.post('/zone-layout/confirm', async (req, res) => {
  try {
    const { assignments } = req.body;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'Assignments array required' });
    }

    await saveZoneLayout(assignments);

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
router.get('/zone-layout/moves', async (_req, res) => {
  try {
    const result = await generateConsolidationMoves();

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
  } catch (err) {
    console.error('[CellarAPI] Zone chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cellar/zone-reassign
 * Reassign a wine to a different zone (user override).
 */
router.post('/zone-reassign', async (req, res) => {
  try {
    const { wineId, newZoneId, reason } = req.body;

    if (!wineId || !newZoneId) {
      return res.status(400).json({ error: 'wineId and newZoneId required' });
    }

    const result = await reassignWineZone(wineId, newZoneId, reason);

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
