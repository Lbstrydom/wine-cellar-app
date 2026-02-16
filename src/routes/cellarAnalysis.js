/**
 * @fileoverview API endpoints for cellar analysis, fridge status, and AI advice.
 * @module routes/cellarAnalysis
 */

import express from 'express';
import { analyseCellar, shouldTriggerAIReview, getFridgeCandidates } from '../services/cellar/cellarAnalysis.js';
import { getCellarOrganisationAdvice } from '../services/cellar/cellarAI.js';
import { analyseFridge, suggestFridgeOrganization } from '../services/cellar/fridgeStocking.js';
import {
  getCachedAnalysis,
  cacheAnalysis,
  invalidateAnalysisCache,
  getAnalysisCacheInfo
} from '../services/shared/cacheService.js';
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
  const report = await analyseCellar(wines, { cellarId });

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
    const cached = await getCachedAnalysis(cacheKey, req.cellarId);
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
  const report = await analyseCellar(wines, { allowFallback, cellarId: req.cellarId });

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
  await cacheAnalysis(cacheKey, report, wineCount, req.cellarId);

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
  const cached = await getCachedAnalysis('full', req.cellarId);
  if (cached) {
    report = cached.data;
    fromCache = true;
  } else {
    const wines = await getAllWinesWithSlots(req.cellarId);
    report = await runAnalysis(wines, req.cellarId);

    // Cache the result
    const wineCount = wines.filter(w => w.slot_id || w.location_code).length;
    await cacheAnalysis('full', report, wineCount, req.cellarId);
  }

  // Check for cached AI advice (keyed to same slot hash as report)
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
