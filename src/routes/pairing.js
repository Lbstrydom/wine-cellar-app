/**
 * @fileoverview Pairing endpoints (manual and Claude-powered).
 * @module routes/pairing
 */

import { Router } from 'express';
import db from '../db/index.js';
import { getSommelierRecommendation } from '../services/claude.js';
import { scorePairing } from '../services/pairing.js';

const router = Router();

/**
 * Get pairing rules matrix.
 * @route GET /api/pairing/rules
 */
router.get('/rules', (req, res) => {
  const rules = db.prepare('SELECT * FROM pairing_rules ORDER BY food_signal, match_level').all();
  res.json(rules);
});

/**
 * Get pairing suggestions based on food signals.
 * @route POST /api/pairing/suggest
 */
router.post('/suggest', (req, res) => {
  const { signals, prefer_reduce_now = true, limit = 5 } = req.body;

  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return res.status(400).json({ error: 'Provide food signals array' });
  }

  const result = scorePairing(db, signals, prefer_reduce_now, limit);
  res.json(result);
});

/**
 * Natural language pairing via Claude.
 * @route POST /api/pairing/natural
 */
router.post('/natural', async (req, res) => {
  const { dish, source = 'all', colour = 'any' } = req.body;

  if (!dish || dish.trim().length === 0) {
    return res.status(400).json({ error: 'Please describe a dish' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Sommelier feature requires API key configuration'
    });
  }

  try {
    const result = await getSommelierRecommendation(db, dish, source, colour);
    res.json(result);
  } catch (error) {
    console.error('Sommelier API error:', error);
    res.status(500).json({
      error: 'Sommelier service error',
      message: error.message
    });
  }
});

export default router;
