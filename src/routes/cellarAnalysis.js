/**
 * @fileoverview API endpoints for cellar analysis, fridge status, and AI advice.
 * @module routes/cellarAnalysis
 */

import express from 'express';
import { analyseCellar, shouldTriggerAIReview, getFridgeCandidates } from '../services/cellar/cellarAnalysis.js';
import { getCellarOrganisationAdvice } from '../services/cellar/cellarAI.js';
import { analyseFridge, suggestFridgeOrganization, generateCrossAreaSuggestions } from '../services/cellar/fridgeStocking.js';
import {
  countInventoryByCategory,
  computeParLevels,
  getWinesByArea,
  getAvailableCandidates,
  sortFridgeAreasByPriority,
  detectFridgeTransfers
} from '../services/cellar/fridgeAllocator.js';
import {
  getCachedAnalysis,
  cacheAnalysis,
  invalidateAnalysisCache,
  getAnalysisCacheInfo
} from '../services/shared/cacheService.js';
import { proposeZoneLayout, getSavedZoneLayout } from '../services/zone/zoneLayoutProposal.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { getAllWinesWithSlots, getEmptyFridgeSlots, getFridgeAreas } from './cellar.js';

const router = express.Router();

/**
 * Strip internal-only fields from an analysis report before sending to the UI.
 * The full report (including stripped fields) is always preserved in the cache
 * so that /analyse/ai and the reconfig planner continue to receive complete data.
 * @param {Object} report - Full internal analysis report
 * @returns {Object} UI-safe report (new object, original unmodified)
 */
function serializeAnalysisForUI(report) {
  // eslint-disable-next-line no-unused-vars
  const { timestamp, overflowAnalysis, moveAudit, ...uiReport } = report;
  return uiReport;
}

/**
 * Run multi-area fridge analysis for all configured fridge areas.
 * Implements sequential planning with slot-level reservations and global stock caps.
 *
 * @param {Array} wines - All wines with slot and storage_area_id data
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Object>} { fridgeAnalysis, fridgeStatus, fridgeTransfers? }
 */
async function buildFridgeAnalysis(wines, cellarId) {
  const allFridgeAreas = await getFridgeAreas(cellarId);

  if (allFridgeAreas.length === 0) {
    return { fridgeAnalysis: [], fridgeStatus: null };
  }

  const allFridgeAreaIds = new Set(allFridgeAreas.map(a => a.id));
  const reservedSlotIds = new Set(); // slot location_codes reserved by prior area's candidates
  const priorAllocations = {}; // { cat: totalSlotsAlreadyTargeted } for global stock cap
  const fridgeAnalysis = [];

  const totalInventoryCounts = countInventoryByCategory(wines);

  for (const area of sortFridgeAreasByPriority(allFridgeAreas)) {
    const parLevels = computeParLevels(
      totalInventoryCounts,
      area.storage_type,
      Number(area.capacity),
      priorAllocations
    );
    const areaWines = getWinesByArea(wines, area.id);
    const candidateWines = getAvailableCandidates(wines, allFridgeAreaIds, reservedSlotIds);
    const emptyFridgeSlots = await getEmptyFridgeSlots(cellarId, area.id);

    const result = await analyseFridge(areaWines, candidateWines, parLevels, cellarId, {
      fridgeType: area.storage_type,
      emptyFridgeSlots,
      areaId: area.id,
      areaName: area.name
    });

    // Reserve the source slots of selected candidates so other fridge areas
    // don't target the same bottles (slot-level, not wine-level)
    for (const candidate of result.candidates) {
      if (candidate.fromSlot) reservedSlotIds.add(candidate.fromSlot);
    }

    // Accumulate prior allocations for global stock cap in subsequent areas
    for (const [cat, level] of Object.entries(parLevels)) {
      if (cat !== 'flex' && level.min > 0) {
        priorAllocations[cat] = (priorAllocations[cat] ?? 0) + level.min;
      }
    }

    fridgeAnalysis.push(result);
  }

  const fridgeTransfers = detectFridgeTransfers(fridgeAnalysis, allFridgeAreas);
  return {
    fridgeAnalysis,
    fridgeStatus: fridgeAnalysis[0] ?? null, // backward-compat alias (first area)
    ...(fridgeTransfers.length > 0 && { fridgeTransfers })
  };
}

/**
 * Run analysis and generate report (shared logic).
 * @param {Array} wines - Wine data (must include storage_area_id from getAllWinesWithSlots)
 * @param {string} [cellarId] - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Analysis report
 */
export async function runAnalysis(wines, cellarId) {
  const report = await analyseCellar(wines, { cellarId });

  // Add fridge candidates (legacy)
  report.fridgeCandidates = getFridgeCandidates(wines);

  // Multi-area fridge analysis
  const { fridgeAnalysis, fridgeStatus, fridgeTransfers } = await buildFridgeAnalysis(wines, cellarId);
  report.fridgeAnalysis = fridgeAnalysis;
  report.fridgeStatus = fridgeStatus;
  if (fridgeTransfers) report.fridgeTransfers = fridgeTransfers;

  // Cross-area suggestions (cellar↔fridge based on drinking windows)
  const crossAreaSuggestions = generateCrossAreaSuggestions(wines, fridgeStatus);
  if (crossAreaSuggestions.length > 0) {
    report.crossAreaSuggestions = crossAreaSuggestions;
  }

  return report;
}

/**
 * Build a compact baseline snapshot for clean AI comparison:
 * ideal zone layout (from current bottles) vs current saved layout.
 * @param {string} cellarId
 * @returns {Promise<Object|null>}
 */
async function buildLayoutBaseline(cellarId) {
  try {
    const [ideal, current] = await Promise.all([
      proposeZoneLayout(cellarId),
      getSavedZoneLayout(cellarId)
    ]);

    return {
      ideal: {
        totalRows: ideal?.totalRows || 0,
        totalBottles: ideal?.totalBottles || 0,
        zones: (ideal?.proposals || []).map(z => ({
          zoneId: z.zoneId,
          bottleCount: z.bottleCount,
          assignedRows: z.assignedRows
        })),
        unassignedRows: ideal?.unassignedRows || []
      },
      current: {
        zones: (current || []).map(z => ({
          zoneId: z.zoneId,
          bottleCount: z.wineCount || 0,
          assignedRows: z.assignedRows || []
        }))
      }
    };
  } catch {
    return null;
  }
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
    const cached = await getCachedAnalysis(cacheKey, req.cellarId);
    if (cached) {
      return res.json({
        success: true,
        report: serializeAnalysisForUI(cached.data),
        shouldTriggerAIReview: shouldTriggerAIReview(cached.data),
        fromCache: true,
        cachedAt: cached.createdAt
      });
    }
  }

  // No valid cache — run analysis
  const wines = await getAllWinesWithSlots(req.cellarId);
  const report = await analyseCellar(wines, { allowFallback, cellarId: req.cellarId });

  // Add fridge candidates (legacy)
  report.fridgeCandidates = getFridgeCandidates(wines);

  // Multi-area fridge analysis
  const { fridgeAnalysis, fridgeStatus, fridgeTransfers } = await buildFridgeAnalysis(wines, req.cellarId);
  report.fridgeAnalysis = fridgeAnalysis;
  report.fridgeStatus = fridgeStatus;
  if (fridgeTransfers) report.fridgeTransfers = fridgeTransfers;

  // Cross-area suggestions (cellar↔fridge based on drinking windows)
  const crossAreaSuggestions = generateCrossAreaSuggestions(wines, fridgeStatus);
  if (crossAreaSuggestions.length > 0) {
    report.crossAreaSuggestions = crossAreaSuggestions;
  }

  // Cache the FULL report (AI route and reconfig planner need all fields)
  const wineCount = wines.filter(w => w.slot_id || w.location_code).length;
  await cacheAnalysis(cacheKey, report, wineCount, req.cellarId);

  // Send UI-safe report (strips internal-only fields)
  res.json({
    success: true,
    report: serializeAnalysisForUI(report),
    shouldTriggerAIReview: shouldTriggerAIReview(report),
    fromCache: false
  });
}));

/**
 * GET /api/cellar/analyse/cache-info
 * Get cache status without running analysis.
 */
router.get('/analyse/cache-info', asyncHandler(async (req, res) => {
  const info = await getAnalysisCacheInfo('full', req.cellarId);
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
router.delete('/analyse/cache', asyncHandler(async (req, res) => {
  await invalidateAnalysisCache(null, req.cellarId);
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
  const { fridgeAnalysis, fridgeStatus, fridgeTransfers } = await buildFridgeAnalysis(wines, req.cellarId);

  res.json({
    success: true,
    ...(fridgeStatus || {}),
    fridgeAnalysis,
    ...(fridgeTransfers && { fridgeTransfers })
  });
}));

/**
 * GET /api/cellar/fridge-organize
 * Get suggestions for organizing fridge wines by category.
 */
router.get('/fridge-organize', asyncHandler(async (req, res) => {
  const wines = await getAllWinesWithSlots(req.cellarId);
  const fridgeAreas = await getFridgeAreas(req.cellarId);

  // If areaId is provided, scope to that specific fridge area only.
  // Otherwise fall back to all fridge areas (backward compat / single-fridge).
  const { areaId } = req.query;
  let scopedAreas = fridgeAreas;
  if (areaId) {
    scopedAreas = fridgeAreas.filter(a => String(a.id) === String(areaId));
    if (scopedAreas.length === 0) {
      return res.status(404).json({ error: 'Fridge area not found' });
    }
  }
  const fridgeAreaIds = new Set(scopedAreas.map(a => a.id));

  const fridgeWines = wines.filter(w =>
    w.storage_area_id != null && fridgeAreaIds.has(w.storage_area_id)
  );

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
  const forceRefresh = req.query.refresh === 'true';
  const cleanMode = req.query.clean === 'true';
  let report;
  let fromCache = false;

  // Check cache first unless caller explicitly requests a fresh run.
  if (!forceRefresh) {
    const cached = await getCachedAnalysis('full', req.cellarId);
    if (cached) {
      report = cached.data;
      fromCache = true;
    }
  }

  if (!report) {
    const wines = await getAllWinesWithSlots(req.cellarId);
    report = await runAnalysis(wines, req.cellarId);

    // Cache the result
    const wineCount = wines.filter(w => w.slot_id || w.location_code).length;
    await cacheAnalysis('full', report, wineCount, req.cellarId);
  }

  // Optional clean baseline context: compare ideal layout vs current layout.
  if (cleanMode) {
    report.layoutBaseline = await buildLayoutBaseline(req.cellarId);
  }

  // Check for cached AI advice (keyed to current fingerprint), unless force-refresh.
  if (!forceRefresh) {
    const cachedAI = await getCachedAnalysis('ai_advice', req.cellarId);
    if (cachedAI) {
      return res.json({
        success: true,
        report,
        aiAdvice: cachedAI.data.advice,
        aiSuccess: cachedAI.data.aiSuccess,
        aiError: cachedAI.data.aiError || null,
        reportFromCache: fromCache,
        aiFromCache: true
      });
    }
  }

  const aiResult = await getCellarOrganisationAdvice(report);

  // Cache AI advice alongside report (same TTL)
  const advice = aiResult.success ? aiResult.advice : aiResult.fallback;
  const aiCacheData = { advice, aiSuccess: aiResult.success, aiError: aiResult.error || null };
  const bottleCount = report.summary?.totalBottles || 0;
  await cacheAnalysis('ai_advice', aiCacheData, bottleCount, req.cellarId);

  res.json({
    success: true,
    report,
    aiAdvice: advice,
    aiSuccess: aiResult.success,
    aiError: aiResult.error || null,
    reportFromCache: fromCache,
    aiFromCache: false
  });
}));

export default router;
