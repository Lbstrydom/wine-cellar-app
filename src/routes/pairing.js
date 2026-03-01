/**
 * @fileoverview Pairing endpoints (manual and Claude-powered).
 * @module routes/pairing
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/index.js';
import { stringAgg } from '../db/helpers.js';
import { getSommelierRecommendation, continueSommelierChat } from '../services/ai/index.js';
import { scorePairing } from '../services/pairing/pairing.js';
import { getHybridPairing, generateShortlist, extractSignals } from '../services/pairing/pairingEngine.js';
import { getAvailableSignals, FOOD_SIGNALS, DEFAULT_HOUSE_STYLE } from '../config/pairingRules.js';
import { strictRateLimiter } from '../middleware/rateLimiter.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { asyncHandler } from '../utils/errorResponse.js';
import {
  suggestPairingSchema,
  naturalPairingSchema,
  chatMessageSchema,
  extractSignalsSchema,
  shortlistSchema,
  hybridPairingSchema,
  manualPairingSchema,
  sessionChooseSchema,
  sessionFeedbackSchema,
  sessionIdSchema
} from '../schemas/pairing.js';

const router = Router();

// In-memory storage for chat contexts (simple approach - could use Redis/sessions for production)
const chatContexts = new Map();
const CONTEXT_TTL = 30 * 60 * 1000; // 30 minutes

// Clean up old contexts periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, ctx] of chatContexts.entries()) {
    if (now - ctx.createdAt > CONTEXT_TTL) {
      chatContexts.delete(id);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

/**
 * Get pairing rules matrix.
 * @route GET /api/pairing/rules
 */
router.get('/rules', asyncHandler(async (req, res) => {
  const rules = await db.prepare('SELECT * FROM pairing_rules ORDER BY food_signal, match_level').all();
  res.json(rules);
}));

/**
 * Get pairing suggestions based on food signals.
 * @route POST /api/pairing/suggest
 */
router.post('/suggest', validateBody(suggestPairingSchema), asyncHandler(async (req, res) => {
  const { signals, prefer_reduce_now, limit } = req.body;

  const result = await scorePairing(db, signals, prefer_reduce_now, limit, req.cellarId);
  res.json(result);
}));

/**
 * Natural language pairing via Claude.
 * Rate limited to prevent abuse of AI API.
 * @route POST /api/pairing/natural
 */
router.post('/natural', validateBody(naturalPairingSchema), strictRateLimiter(), asyncHandler(async (req, res) => {
  const { dish, source, colour } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Sommelier feature requires API key configuration'
    });
  }

  const result = await getSommelierRecommendation(db, dish, source, colour, req.cellarId);

  // Store chat context for follow-up conversations
  const chatId = randomUUID();
  if (result._chatContext) {
    chatContexts.set(chatId, {
      ...result._chatContext,
      chatHistory: [],
      createdAt: Date.now()
    });
    delete result._chatContext; // Don't send internal context to client
  }

  res.json({
    ...result,
    chatId
  });
}));

/**
 * Continue sommelier conversation with follow-up question.
 * Rate limited to prevent abuse of AI API.
 * @route POST /api/pairing/chat
 */
router.post('/chat', validateBody(chatMessageSchema), strictRateLimiter(), asyncHandler(async (req, res) => {
  const { chatId, message } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Sommelier feature requires API key configuration'
    });
  }

  const context = chatContexts.get(chatId);
  if (!context) {
    return res.status(404).json({
      error: 'Chat session expired or not found. Please start a new conversation.'
    });
  }

  const result = await continueSommelierChat(db, message.trim(), context);

  // Update chat history
  context.chatHistory.push(
    { role: 'user', content: message.trim() },
    { role: 'assistant', content: result.type === 'explanation' ? result.message : JSON.stringify(result) }
  );
  context.createdAt = Date.now(); // Refresh TTL

  res.json(result);
}));

/**
 * Clear chat session.
 * @route DELETE /api/pairing/chat/:chatId
 */
router.delete('/chat/:chatId', (req, res) => {
  const { chatId } = req.params;
  chatContexts.delete(chatId);
  res.json({ message: 'Chat session cleared' });
});

// ============================================================
// Hybrid Pairing Engine Endpoints (7.8)
// ============================================================

/**
 * Get available food signals.
 * @route GET /api/pairing/signals
 */
router.get('/signals', (_req, res) => {
  const signals = getAvailableSignals().map(signal => ({
    name: signal,
    description: FOOD_SIGNALS[signal].description
  }));
  res.json({ signals });
});

/**
 * Extract signals from dish description.
 * @route POST /api/pairing/extract-signals
 */
router.post('/extract-signals', validateBody(extractSignalsSchema), (req, res) => {
  const { dish } = req.body;

  const signals = extractSignals(dish);
  res.json({
    dish,
    signals,
    signalDetails: signals.map(s => ({
      name: s,
      description: FOOD_SIGNALS[s]?.description || 'Unknown'
    }))
  });
});

/**
 * Get deterministic shortlist only (no AI).
 * @route POST /api/pairing/shortlist
 */
router.post('/shortlist', validateBody(shortlistSchema), asyncHandler(async (req, res) => {
  const { dish, source, colour, limit, houseStyle } = req.body;

  const wines = await getAllWinesWithSlots(req.cellarId);

  const result = generateShortlist(wines, dish, {
    colour,
    source,
    limit,
    houseStyle: houseStyle || DEFAULT_HOUSE_STYLE
  });

  res.json(result);
}));

/**
 * Hybrid pairing: deterministic shortlist + AI explanation.
 * Rate limited as it uses AI.
 * @route POST /api/pairing/hybrid
 */
router.post('/hybrid', validateBody(hybridPairingSchema), strictRateLimiter(), asyncHandler(async (req, res) => {
  const { dish, source, colour, topN, houseStyle } = req.body;

  const wines = await getAllWinesWithSlots(req.cellarId);

  const result = await getHybridPairing(wines, dish, {
    colour,
    source,
    topN,
    houseStyle: houseStyle || DEFAULT_HOUSE_STYLE
  });

  // Store chat context for follow-up if AI succeeded
  const chatId = randomUUID();
  if (result.aiSuccess) {
    chatContexts.set(chatId, {
      dish,
      source,
      colour,
      wines,
      initialResponse: {
        dish_analysis: result.dish_analysis,
        signals: result.signals,
        recommendations: result.recommendations
      },
      chatHistory: [],
      createdAt: Date.now()
    });
  }

  res.json({
    ...result,
    chatId: result.aiSuccess ? chatId : null
  });
}));

/**
 * Get house style defaults.
 * @route GET /api/pairing/house-style
 */
router.get('/house-style', (_req, res) => {
  res.json({
    defaults: DEFAULT_HOUSE_STYLE,
    description: {
      acidPreference: 'Preference for high-acid wines (1.0=neutral, >1=prefer, <1=avoid)',
      oakPreference: 'Preference for oaky wines',
      tanninPreference: 'Preference for tannic wines',
      adventureLevel: 'Preference for unusual vs classic pairings',
      reduceNowBonus: 'Bonus multiplier for reduce-now wines',
      fridgeBonus: 'Bonus for wines already in fridge',
      diversityPenalty: 'Penalty per duplicate style in shortlist'
    }
  });
});

/**
 * Get all wines with slot assignments.
 * @param {number} cellarId - The cellar ID to filter by
 * @returns {Promise<Array>} Wines with location data
 */
async function getAllWinesWithSlots(cellarId) {
  // Safe: stringAgg() is a helper that returns SQL function call string
  const locationAgg = stringAgg('s.location_code', ',', true);

  const sql = [
    'SELECT',
    '  w.id,',
    '  w.wine_name,',
    '  w.vintage,',
    '  w.style,',
    '  w.colour,',
    '  w.country,',
    '  w.grapes,',
    '  w.region,',
    '  w.winemaking,',
    '  COUNT(s.id) as bottle_count,',
    '  ' + locationAgg + ' as locations,',
    "  MAX(CASE WHEN s.location_code LIKE 'F%' THEN 1 ELSE 0 END) as in_fridge,",
    '  COALESCE(MIN(rn.priority), 99) as reduce_priority,',
    '  MAX(rn.reduce_reason) as reduce_reason,',
    '  MIN(dw.drink_by_year) as drink_by_year,',
    '  MIN(dw.drink_from_year) as drink_from_year',
    'FROM wines w',
    'LEFT JOIN slots s ON s.wine_id = w.id',
    'LEFT JOIN reduce_now rn ON w.id = rn.wine_id',
    'LEFT JOIN drinking_windows dw ON dw.wine_id = w.id',
    'WHERE w.cellar_id = $1',
    'GROUP BY w.id, w.wine_name, w.vintage, w.style, w.colour, w.country, w.grapes, w.region, w.winemaking',
    'HAVING COUNT(s.id) > 0',
    'ORDER BY w.colour, w.style'
  ].join('\n');
  return await db.prepare(sql).all(cellarId);
}

export default router;

// ================= Pairing Feedback & User Profile Endpoints =================
import {
  createManualPairingSession,
  recordWineChoice,
  recordFeedback,
  getPendingFeedbackSessions,
  getPairingHistory,
  getPairingStats,
  FAILURE_REASONS
} from '../services/pairing/pairingSession.js';
import * as recipeService from '../services/recipe/recipeService.js';

/**
 * POST /api/pairing/sessions/manual
 * Create a manual (user-initiated, no AI) pairing session.
 */
router.post('/sessions/manual', validateBody(manualPairingSchema), asyncHandler(async (req, res) => {
  const { wineId, dish, recipeId } = req.body;

  // Validate wine belongs to this cellar
  const wine = await db.prepare(
    'SELECT id FROM wines WHERE id = $1 AND cellar_id = $2'
  ).get(wineId, req.cellarId);
  if (!wine) return res.status(404).json({ error: 'Wine not found' });

  // Validate recipe belongs to this cellar (if provided)
  if (recipeId) {
    const recipe = await recipeService.getRecipe(req.cellarId, recipeId);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  }

  const sessionId = await createManualPairingSession({
    cellarId: req.cellarId,
    wineId,
    dish,
    recipeId
  });

  res.status(201).json({ sessionId });
}));

/**
 * POST /api/pairing/sessions/:id/choose
 * Record which wine the user chose from recommendations.
 */
router.post('/sessions/:id/choose', validateParams(sessionIdSchema), validateBody(sessionChooseSchema), asyncHandler(async (req, res) => {
  const sessionId = req.validated?.params?.id ?? parseInt(req.params.id, 10);
  const { wineId, rank } = req.body;
  await recordWineChoice(sessionId, wineId, rank, req.cellarId);
  res.json({ success: true });
}));

/**
 * POST /api/pairing/sessions/:id/feedback
 * Record user feedback on a pairing.
 */
router.post('/sessions/:id/feedback', validateParams(sessionIdSchema), validateBody(sessionFeedbackSchema), asyncHandler(async (req, res) => {
  const sessionId = req.validated?.params?.id ?? parseInt(req.params.id, 10);
  const { pairingFitRating, wouldPairAgain, failureReasons, notes } = req.body;
  await recordFeedback(sessionId, {
    pairingFitRating,
    wouldPairAgain,
    failureReasons,
    notes
  }, req.cellarId);
  res.json({ success: true });
}));

/**
 * GET /api/pairing/sessions/pending-feedback
 * Get sessions that need feedback.
 */
router.get('/sessions/pending-feedback', asyncHandler(async (req, res) => {
  const sessions = await getPendingFeedbackSessions(req.cellarId);
  res.json({ sessions });
}));

/**
 * GET /api/pairing/history
 * Get pairing history with optional filters.
 */
router.get('/history', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = parseInt(req.query.offset, 10) || 0;
  const feedbackOnly = req.query.feedbackOnly === 'true';
  const history = await getPairingHistory(req.cellarId, { limit, offset, feedbackOnly });
  res.json({ history });
}));

/**
 * GET /api/pairing/stats
 * Get aggregate pairing statistics.
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await getPairingStats(req.cellarId);
  res.json(stats);
}));

/**
 * GET /api/pairing/failure-reasons
 * Get valid failure reason vocabulary.
 */
router.get('/failure-reasons', (req, res) => {
  res.json({ reasons: FAILURE_REASONS });
});
