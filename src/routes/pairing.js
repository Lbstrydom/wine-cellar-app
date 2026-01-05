/**
 * @fileoverview Pairing endpoints (manual and Claude-powered).
 * @module routes/pairing
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import db from '../db/index.js';
import { getSommelierRecommendation, continueSommelierChat } from '../services/claude.js';
import { scorePairing } from '../services/pairing.js';
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

export default router;
