/**
 * @fileoverview Restaurant pairing endpoints (menu parsing, recommendations, chat).
 * Mounted in server.js BEFORE global body parser with its own 5mb limit.
 * @module routes/restaurantPairing
 */

import { Router } from 'express';
import { parseMenuFromText, parseMenuFromImage } from '../services/pairing/menuParsing.js';
import { getRecommendations, continueChat, CHAT_ERRORS } from '../services/pairing/restaurantPairing.js';
import { createRateLimiter, strictRateLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../utils/errorResponse.js';
import {
  parseMenuSchema,
  recommendSchema,
  restaurantChatSchema,
  MAX_IMAGE_BASE64_CHARS
} from '../schemas/restaurantPairing.js';

const router = Router();

/**
 * Per-user parse rate limiter: 10 calls per 15 minutes, keyed by user+cellar.
 * Prevents a single user from hammering the OCR endpoint.
 */
const parseRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
  message: 'Too many menu parse requests. Please wait a few minutes.',
  keyGenerator: (req) => `rest-parse:${req.user?.id || 'anon'}:${req.cellarId || 0}`
});

/**
 * Pre-validation middleware: reject oversized images with 413 before Zod
 * returns a generic 400.  Must run BEFORE validateBody(parseMenuSchema).
 */
function rejectOversizedImage(req, res, next) {
  if (req.body?.image && req.body.image.length > MAX_IMAGE_BASE64_CHARS) {
    return res.status(413).json({
      error: 'Image too large (max 2MB decoded). Please resize or crop the photo.'
    });
  }
  next();
}

/**
 * Parse a menu image or text into structured items.
 * Accepts one image OR text per call (not both).
 * @route POST /api/restaurant-pairing/parse-menu
 */
router.post('/parse-menu', strictRateLimiter(), parseRateLimiter, rejectOversizedImage, validateBody(parseMenuSchema), asyncHandler(async (req, res) => {
  const { type, text, image, mediaType } = req.body;

  let result;
  if (text) {
    result = await parseMenuFromText(type, text);
  } else {
    result = await parseMenuFromImage(type, image, mediaType);
  }

  res.json(result);
}));

/**
 * Get wine pairing recommendations for restaurant menu items.
 * Falls back to deterministic colour matching if AI is unavailable.
 * @route POST /api/restaurant-pairing/recommend
 */
router.post('/recommend', strictRateLimiter(), validateBody(recommendSchema), asyncHandler(async (req, res) => {
  const result = await getRecommendations(req.body, req.user.id, req.cellarId);
  res.json(result);
}));

/**
 * Continue a restaurant pairing conversation with a follow-up question.
 * Validates chat ownership via userId + cellarId.
 * @route POST /api/restaurant-pairing/chat
 */
router.post('/chat', strictRateLimiter(), validateBody(restaurantChatSchema), asyncHandler(async (req, res) => {
  const { chatId, message } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Sommelier feature requires API key configuration'
    });
  }

  try {
    const result = await continueChat(chatId, message, req.user.id, req.cellarId);
    res.json(result);
  } catch (err) {
    if (err.code === CHAT_ERRORS.NOT_FOUND) {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === CHAT_ERRORS.FORBIDDEN) {
      return res.status(403).json({ error: err.message });
    }
    throw err; // Re-throw for asyncHandler → errorHandler
  }
}));

export default router;
