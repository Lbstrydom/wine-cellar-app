/**
 * @fileoverview Wine tasting profile and serving temperature endpoints.
 * Handles tasting profile CRUD, AI-powered extraction from tasting notes,
 * extraction history, and serving temperature recommendations.
 * @module routes/winesTasting
 */

import { Router } from 'express';
import db from '../db/index.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  wineIdSchema,
  tastingProfileSchema,
  tastingExtractionSchema
} from '../schemas/wine.js';
import { asyncHandler } from '../utils/errorResponse.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Get tasting profile for a wine.
 * @route GET /api/wines/:id/tasting-profile
 */
router.get('/:id/tasting-profile', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const wine = await db.prepare(`
    SELECT id, wine_name, tasting_profile_json
    FROM wines WHERE cellar_id = $1 AND id = $2
  `).get(req.cellarId, id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  let profile = null;
  if (wine.tasting_profile_json) {
    try {
      profile = JSON.parse(wine.tasting_profile_json);
    } catch {
      // Invalid JSON, return null
    }
  }

  res.json({
    wine_id: wine.id,
    wine_name: wine.wine_name,
    profile
  });
}));

/**
 * Extract tasting profile from a note.
 * @route POST /api/wines/:id/tasting-profile/extract
 */
router.post('/:id/tasting-profile/extract', validateParams(wineIdSchema), validateBody(tastingExtractionSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tasting_note, source_id = 'user' } = req.body;

  const wine = await db.prepare(`
    SELECT id, wine_name, colour, style
    FROM wines WHERE cellar_id = $1 AND id = $2
  `).get(req.cellarId, id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // Dynamic import to avoid issues if service not available
  const { extractTastingProfile } = await import('../services/tastingExtractor.js');

  const profile = await extractTastingProfile(tasting_note, {
    sourceId: source_id,
    wineInfo: {
      colour: wine.colour,
      style: wine.style
    }
  });

  // Store extraction in history
  try {
    await db.prepare(`
      INSERT INTO tasting_profile_extractions
      (wine_id, source_id, source_note, extraction_method, confidence, profile_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      source_id,
      tasting_note,
      profile.extraction?.method || 'unknown',
      profile.extraction?.confidence || 0.5,
      JSON.stringify(profile)
    );
  } catch (historyError) {
    // Table might not exist yet, log but continue
    logger.warn('Tasting', 'Could not save extraction history: ' + historyError.message);
  }

  res.json({
    wine_id: wine.id,
    wine_name: wine.wine_name,
    profile
  });
}));

/**
 * Save tasting profile to wine.
 * @route PUT /api/wines/:id/tasting-profile
 */
router.put('/:id/tasting-profile', validateParams(wineIdSchema), validateBody(tastingProfileSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { profile } = req.body;

  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const profileJson = JSON.stringify(profile);

  await db.prepare(`
    UPDATE wines SET tasting_profile_json = $1 WHERE cellar_id = $2 AND id = $3
  `).run(profileJson, req.cellarId, id);

  res.json({ message: 'Tasting profile saved', wine_id: id });
}));

/**
 * Get extraction history for a wine.
 * @route GET /api/wines/:id/tasting-profile/history
 */
router.get('/:id/tasting-profile/history', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const history = await db.prepare(`
      SELECT id, source_id, extraction_method, confidence, extracted_at
      FROM tasting_profile_extractions
      WHERE wine_id = $1 AND cellar_id = $2
      ORDER BY extracted_at DESC
    `).all(id, req.cellarId);

    res.json(history);
  } catch {
    // Table tasting_profile_extractions might not exist in all environments
    // Return empty array rather than error to allow graceful degradation
    res.json([]);
  }
}));

/**
 * Get serving temperature recommendation for a wine.
 * @route GET /api/wines/:id/serving-temperature
 */
router.get('/:id/serving-temperature', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { unit = 'celsius' } = req.query;

  const wine = await db.prepare(`
    SELECT id, wine_name, style, colour, grapes, sweetness, winemaking
    FROM wines WHERE cellar_id = $1 AND id = $2
  `).get(req.cellarId, id);

  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  const { findServingTemperature, formatTemperature } = await import('../services/servingTemperature.js');
  const temp = await findServingTemperature(wine);

  if (!temp) {
    return res.json({
      wine_id: wine.id,
      wine_name: wine.wine_name,
      recommendation: null,
      message: 'No serving temperature data available'
    });
  }

  res.json({
    wine_id: wine.id,
    wine_name: wine.wine_name,
    recommendation: {
      wine_type: temp.wine_type,
      category: temp.category,
      body: temp.body,
      temp_min_celsius: temp.temp_min_celsius,
      temp_max_celsius: temp.temp_max_celsius,
      temp_min_fahrenheit: temp.temp_min_fahrenheit,
      temp_max_fahrenheit: temp.temp_max_fahrenheit,
      temp_celsius: `${temp.temp_min_celsius}-${temp.temp_max_celsius}`,
      temp_fahrenheit: `${temp.temp_min_fahrenheit}-${temp.temp_max_fahrenheit}`,
      temp_display: formatTemperature(temp, unit),
      notes: temp.notes,
      confidence: temp.match_confidence
    }
  });
}));

export default router;
