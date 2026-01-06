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

const router = Router();

/**
 * Get cellar health report.
 * @route GET /api/health
 */
router.get('/', async (_req, res) => {
  try {
    const health = await getCellarHealth();
    res.json(health);
  } catch (error) {
    logger.error('CellarHealth', `Health report error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Execute fill fridge action.
 * @route POST /api/health/fill-fridge
 * @body {number} [maxMoves=5] - Maximum wines to move
 */
router.post('/fill-fridge', async (req, res) => {
  const { maxMoves = 5 } = req.body;

  try {
    const result = await executeFillFridge(maxMoves);
    res.json(result);
  } catch (error) {
    logger.error('CellarHealth', `Fill fridge error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get at-risk wines.
 * @route GET /api/health/at-risk
 * @query {number} [limit=20] - Max wines to return
 */
router.get('/at-risk', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;

  try {
    const wines = await getAtRiskWines(limit);
    res.json({ wines, count: wines.length });
  } catch (error) {
    logger.error('CellarHealth', `At-risk wines error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate shopping list.
 * @route GET /api/health/shopping-list
 */
router.get('/shopping-list', async (_req, res) => {
  try {
    const list = await generateShoppingList();
    res.json(list);
  } catch (error) {
    logger.error('CellarHealth', `Shopping list error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get health score only.
 * @route GET /api/health/score
 */
router.get('/score', async (_req, res) => {
  try {
    const health = await getCellarHealth();
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
  } catch (error) {
    logger.error('CellarHealth', `Health score error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get alerts only.
 * @route GET /api/health/alerts
 */
router.get('/alerts', async (_req, res) => {
  try {
    const health = await getCellarHealth();
    res.json({ alerts: health.alerts });
  } catch (error) {
    logger.error('CellarHealth', `Alerts error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
