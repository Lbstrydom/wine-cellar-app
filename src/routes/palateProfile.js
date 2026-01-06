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
router.post('/feedback', async (req, res) => {
  const { wineId, wouldBuyAgain, personalRating, pairedWith, occasion, notes, consumptionId } = req.body;

  if (!wineId) {
    return res.status(400).json({ error: 'wineId is required' });
  }

  try {
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
  } catch (error) {
    logger.error('PalateProfile', `Feedback error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get feedback for a wine.
 * @route GET /api/palate/feedback/:wineId
 */
router.get('/feedback/:wineId', async (req, res) => {
  const { wineId } = req.params;

  try {
    const feedbacks = await getWineFeedback(parseInt(wineId));
    res.json({ feedbacks });
  } catch (error) {
    logger.error('PalateProfile', `Get feedback error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get full palate profile.
 * @route GET /api/palate/profile
 */
router.get('/profile', async (_req, res) => {
  try {
    const profile = await getPalateProfile();
    res.json(profile);
  } catch (error) {
    logger.error('PalateProfile', `Get profile error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get personalized score for a wine.
 * @route GET /api/palate/score/:wineId
 */
router.get('/score/:wineId', async (req, res) => {
  const { wineId } = req.params;

  try {
    // Get wine from database
    const db = (await import('../db/index.js')).default;
    const wine = await db.prepare('SELECT * FROM wines WHERE id = ?').get(parseInt(wineId));

    if (!wine) {
      return res.status(404).json({ error: 'Wine not found' });
    }

    const score = await getPersonalizedScore(wine);
    res.json(score);
  } catch (error) {
    logger.error('PalateProfile', `Score error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get personalized wine recommendations.
 * @route GET /api/palate/recommendations
 * @query {number} [limit=10] - Max recommendations
 */
router.get('/recommendations', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  try {
    const recommendations = await getPersonalizedRecommendations(limit);
    res.json({ recommendations });
  } catch (error) {
    logger.error('PalateProfile', `Recommendations error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

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
