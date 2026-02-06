/**
 * @fileoverview API endpoints for cellar analysis, fridge status, and AI advice.
 * @module routes/cellarAnalysis
 */

import express from 'express';
import db from '../db/index.js';
import { analyseCellar, shouldTriggerAIReview, getFridgeCandidates } from '../services/cellarAnalysis.js';
import { findBestZone, findAvailableSlot } from '../services/cellarPlacement.js';
import { getCellarOrganisationAdvice } from '../services/cellarAI.js';
import { getZoneCapacityAdvice } from '../services/zoneCapacityAdvisor.js';
import { analyseFridge, suggestFridgeOrganization } from '../services/fridgeStocking.js';
import {
  getCachedAnalysis,
  cacheAnalysis,
  invalidateAnalysisCache,
  getAnalysisCacheInfo
} from '../services/cacheService.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { getAllWinesWithSlots } from './cellar.js';

const router = express.Router();

/**
 * Run analysis and generate report (shared logic).
 * @param {Array} wines - Wine data
 * @param {string} [cellarId] - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Analysis report
 */
export async function runAnalysis(wines, cellarId) {
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
  report.fridgeStatus = await analyseFridge(fridgeWines, cellarWines, cellarId);

  return report;
}

/**
 * GET /api/cellar/analyse
 * Get full cellar analysis with fridge status.
 * Uses cache if available and valid.
 */
router.get('/analyse', asyncHandler(async (req, res) => {
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
  report.fridgeStatus = await analyseFridge(fridgeWines, cellarWines, req.cellarId);

  // Cache the result
  const wineCount = wines.filter(w => w.slot_id || w.location_code).length;
  await cacheAnalysis(cacheKey, report, wineCount);

  res.json({
    success: true,
    report,
    shouldTriggerAIReview: shouldTriggerAIReview(report),
    fromCache: false
  });
}));

/**
 * GET /api/cellar/analyse/cache-info
 * Get cache status without running analysis.
 */
router.get('/analyse/cache-info', asyncHandler(async (_req, res) => {
  const info = await getAnalysisCacheInfo('full');
  res.json({
    success: true,
    cached: info !== null,
    ...(info || {})
  });
}));

/**
 * DELETE /api/cellar/analyse/cache
 * Invalidate the analysis cache.
 */
router.delete('/analyse/cache', asyncHandler(async (_req, res) => {
  await invalidateAnalysisCache();
  res.json({
    success: true,
    message: 'Analysis cache invalidated'
  });
}));

/**
 * GET /api/cellar/fridge-status
 * Get lightweight fridge status only (without full cellar analysis).
 */
router.get('/fridge-status', asyncHandler(async (req, res) => {
  const wines = await getAllWinesWithSlots(req.cellarId);

  const fridgeWines = wines.filter(w => {
    const slot = w.slot_id || w.location_code;
    return slot && slot.startsWith('F');
  });
  const cellarWines = wines.filter(w => {
    const slot = w.slot_id || w.location_code;
    return slot && slot.startsWith('R');
  });

  const status = await analyseFridge(fridgeWines, cellarWines, req.cellarId);

  res.json({
    success: true,
    ...status
  });
}));

/**
 * GET /api/cellar/fridge-organize
 * Get suggestions for organizing fridge wines by category.
 */
router.get('/fridge-organize', asyncHandler(async (req, res) => {
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
}));

/**
 * GET /api/cellar/analyse/ai
 * Get AI-enhanced analysis.
 * Uses cached report if available.
 */
router.get('/analyse/ai', asyncHandler(async (req, res) => {
  let report;
  let fromCache = false;

  // Check cache first
  const cached = await getCachedAnalysis('full');
  if (cached) {
    report = cached.data;
    fromCache = true;
  } else {
    const wines = await getAllWinesWithSlots(req.cellarId);
    report = await runAnalysis(wines, req.cellarId);

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
}));

// ============================================================
// Zone Capacity Advice (AI)
// ============================================================

/**
 * POST /api/cellar/zone-capacity-advice
 * Get AI recommendations when a zone is at capacity.
 */
router.post('/zone-capacity-advice', asyncHandler(async (req, res) => {
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
}));

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

export default router;
