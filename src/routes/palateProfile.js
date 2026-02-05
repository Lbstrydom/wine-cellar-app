/**
 * @fileoverview Palate profile routes.
 * @module routes/palateProfile
 */

import { Router } from 'express';
import {
  recordFeedback,
  getWineFeedback,
  getPalateProfile,
  getPersonalizedScore,
  getPersonalizedRecommendations,
  getFoodTags,
  getOccasionTypes
} from '../services/palateProfile.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { feedbackSchema, palateWineIdSchema, recommendationsQuerySchema } from '../schemas/palateProfile.js';

const router = Router();

/**
 * Record consumption feedback.
 * @route POST /api/palate/feedback
 * @body {number} wineId - Wine ID
 * @body {boolean} [wouldBuyAgain] - Would buy again?
 * @body {number} [personalRating] - 1-5 star rating
 * @body {string[]} [pairedWith] - Food tags
 * @body {string} [occasion] - Occasion type
 * @body {string} [notes] - Free-text notes
 */
router.post('/feedback', validateBody(feedbackSchema), asyncHandler(async (req, res) => {
  const { wineId, wouldBuyAgain, personalRating, pairedWith, occasion, notes, consumptionId } = req.body;

  const result = await recordFeedback({
    wineId,
    consumptionId,
    wouldBuyAgain,
    personalRating,
    pairedWith,
    occasion,
    notes
  });

  res.status(201).json(result);
}));

/**
 * Get feedback for a wine.
 * @route GET /api/palate/feedback/:wineId
 */
router.get('/feedback/:wineId', validateParams(palateWineIdSchema), asyncHandler(async (req, res) => {
  const { wineId } = req.params;

  const feedbacks = await getWineFeedback(req.validated?.params?.wineId ?? parseInt(wineId, 10));
  res.json({ feedbacks });
}));

/**
 * Get full palate profile for this cellar.
 * @route GET /api/palate/profile
 */
router.get('/profile', asyncHandler(async (req, res) => {
  const profile = await getPalateProfile(req.cellarId);
  res.json(profile);
}));

/**
 * Get personalized score for a wine.
 * @route GET /api/palate/score/:wineId
 */
router.get('/score/:wineId', validateParams(palateWineIdSchema), asyncHandler(async (req, res) => {
  const { wineId } = req.params;

  // Get wine from database (scoped to cellar)
  const db = (await import('../db/index.js')).default;
  const wine = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, req.validated?.params?.wineId ?? parseInt(wineId, 10));

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const score = await getPersonalizedScore(wine);
  res.json(score);
}));

/**
 * Get personalized wine recommendations.
 * @route GET /api/palate/recommendations
 * @query {number} [limit=10] - Max recommendations
 */
router.get('/recommendations', validateQuery(recommendationsQuerySchema), asyncHandler(async (req, res) => {
  const limit = req.validated?.query?.limit ?? parseInt(req.query.limit) || 10;

  const recommendations = await getPersonalizedRecommendations(limit, req.cellarId);
  res.json({ recommendations });
}));

/**
 * Get available food tags for pairing feedback.
 * @route GET /api/palate/food-tags
 */
router.get('/food-tags', (_req, res) => {
  res.json({ tags: getFoodTags() });
});

/**
 * Get available occasion types.
 * @route GET /api/palate/occasions
 */
router.get('/occasions', (_req, res) => {
  res.json({ occasions: getOccasionTypes() });
});

export default router;
