/**
 * @fileoverview Pairing endpoints (manual and Claude-powered).
 * @module routes/pairing
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/index.js';
import { getSommelierRecommendation, continueSommelierChat } from '../services/claude.js';
import { scorePairing } from '../services/pairing.js';
import { getHybridPairing, generateShortlist, extractSignals } from '../services/pairingEngine.js';
import { getAvailableSignals, FOOD_SIGNALS, DEFAULT_HOUSE_STYLE } from '../config/pairingRules.js';
import { strictRateLimiter } from '../middleware/rateLimiter.js';

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
router.get('/rules', async (req, res) => {
  try {
    const rules = await db.prepare('SELECT * FROM pairing_rules ORDER BY food_signal, match_level').all();
    res.json(rules);
  } catch (error) {
    console.error('Pairing rules error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get pairing suggestions based on food signals.
 * @route POST /api/pairing/suggest
 */
router.post('/suggest', async (req, res) => {
  const { signals, prefer_reduce_now = true, limit = 5 } = req.body;

  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return res.status(400).json({ error: 'Provide food signals array' });
  }

  try {
    const result = await scorePairing(db, signals, prefer_reduce_now, limit);
    res.json(result);
  } catch (error) {
    console.error('Pairing suggestion error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Natural language pairing via Claude.
 * Rate limited to prevent abuse of AI API.
 * @route POST /api/pairing/natural
 */
router.post('/natural', strictRateLimiter(), async (req, res) => {
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
  } catch (error) {
    console.error('Sommelier API error:', error);
    res.status(500).json({
      error: 'Sommelier service error',
      message: error.message
    });
  }
});

/**
 * Continue sommelier conversation with follow-up question.
 * Rate limited to prevent abuse of AI API.
 * @route POST /api/pairing/chat
 */
router.post('/chat', strictRateLimiter(), async (req, res) => {
  const { chatId, message } = req.body;

  if (!chatId || !message || message.trim().length === 0) {
    return res.status(400).json({ error: 'chatId and message are required' });
  }

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

  try {
    const result = await continueSommelierChat(db, message.trim(), context);

    // Update chat history
    context.chatHistory.push(
      { role: 'user', content: message.trim() },
      { role: 'assistant', content: result.type === 'explanation' ? result.message : JSON.stringify(result) }
    );
    context.createdAt = Date.now(); // Refresh TTL

    res.json(result);
  } catch (error) {
    console.error('Sommelier chat error:', error);
    res.status(500).json({
      error: 'Sommelier service error',
      message: error.message
    });
  }
});

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
router.post('/extract-signals', (req, res) => {
  const { dish } = req.body;

  if (!dish || dish.trim().length === 0) {
    return res.status(400).json({ error: 'Please provide a dish description' });
  }

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
router.post('/shortlist', async (req, res) => {
  const { dish, source = 'all', colour = 'any', limit = 8, houseStyle } = req.body;

  if (!dish || dish.trim().length === 0) {
    return res.status(400).json({ error: 'Please describe a dish' });
  }

  try {
    const wines = await getAllWinesWithSlots();

    const result = generateShortlist(wines, dish, {
      colour,
      source,
      limit,
      houseStyle: houseStyle || DEFAULT_HOUSE_STYLE
    });

    res.json(result);
  } catch (error) {
    console.error('Shortlist error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Hybrid pairing: deterministic shortlist + AI explanation.
 * Rate limited as it uses AI.
 * @route POST /api/pairing/hybrid
 */
router.post('/hybrid', strictRateLimiter(), async (req, res) => {
  const { dish, source = 'all', colour = 'any', topN = 3, houseStyle } = req.body;

  if (!dish || dish.trim().length === 0) {
    return res.status(400).json({ error: 'Please describe a dish' });
  }

  try {
    const wines = await getAllWinesWithSlots();

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
  } catch (error) {
    console.error('Hybrid pairing error:', error);
    res.status(500).json({
      error: 'Pairing service error',
      message: error.message
    });
  }
});

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
 * @returns {Promise<Array>} Wines with location data
 */
async function getAllWinesWithSlots() {
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
      w.winemaking,
      COUNT(s.id) as bottle_count,
      STRING_AGG(DISTINCT s.location_code, ',') as locations,
      MAX(CASE WHEN s.location_code LIKE 'F%' THEN 1 ELSE 0 END) as in_fridge,
      COALESCE(rn.priority, 99) as reduce_priority,
      rn.reduce_reason,
      dw.drink_by_year,
      dw.drink_from_year
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON w.id = rn.wine_id
    LEFT JOIN drinking_windows dw ON dw.wine_id = w.id
    GROUP BY w.id
    HAVING COUNT(s.id) > 0
    ORDER BY w.colour, w.style
  `).all();
}

export default router;
