/**
 * @fileoverview Cellar health dashboard routes.
 * @module routes/cellarHealth
 */

import { Router } from 'express';
import {
  getCellarHealth,
  executeFillFridge,
  getAtRiskWines,
  generateShoppingList
} from '../services/cellarHealth.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/errorResponse.js';

const router = Router();

/**
 * Get cellar health report.
 * @route GET /api/health
 */
router.get('/', asyncHandler(async (req, res) => {
  const health = await getCellarHealth(req.cellarId);
  res.json(health);
}));

/**
 * Execute fill fridge action.
 * @route POST /api/health/fill-fridge
 * @body {number} [maxMoves=5] - Maximum wines to move
 */
router.post('/fill-fridge', asyncHandler(async (req, res) => {
  const { maxMoves = 5 } = req.body;

  const result = await executeFillFridge(maxMoves, req.cellarId);
  res.json(result);
}));

/**
 * Get at-risk wines.
 * @route GET /api/health/at-risk
 * @query {number} [limit=20] - Max wines to return
 */
router.get('/at-risk', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;

  const wines = await getAtRiskWines(limit, req.cellarId);
  res.json({ wines, count: wines.length });
}));

/**
 * Generate shopping list.
 * @route GET /api/health/shopping-list
 */
router.get('/shopping-list', asyncHandler(async (req, res) => {
  const list = await generateShoppingList(req.cellarId);
  res.json(list);
}));

/**
 * Get health score only.
 * @route GET /api/health/score
 */
router.get('/score', asyncHandler(async (req, res) => {
  const health = await getCellarHealth(req.cellarId);
  res.json({
    score: health.healthScore,
    breakdown: {
      drinkingWindowRisk: 100 - health.metrics.drinkingWindowRisk.riskScore,
      styleCoverage: health.metrics.styleCoverage.coverageScore,
      diversity: health.metrics.duplicationRisk.diversityScore,
      eventReadiness: health.metrics.eventReadiness.readinessScore,
      fridgeStatus: health.metrics.fridgeGaps.gapScore
    }
  });
}));

/**
 * Get alerts only.
 * @route GET /api/health/alerts
 */
router.get('/alerts', asyncHandler(async (req, res) => {
  const health = await getCellarHealth(req.cellarId);
  res.json({ alerts: health.alerts });
}));

export default router;
