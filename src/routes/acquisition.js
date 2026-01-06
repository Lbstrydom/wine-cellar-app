/**
 * @fileoverview Acquisition workflow routes.
 * Handles Scan → Confirm → Place flow for new wines.
 * @module routes/acquisition
 */

import { Router } from 'express';
import {
  runAcquisitionWorkflow,
  parseWineWithConfidence,
  suggestPlacement,
  enrichWineData,
  saveAcquiredWine,
  CONFIDENCE_LEVELS_EXPORT as CONFIDENCE_LEVELS
} from '../services/acquisitionWorkflow.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Parse wine from image with per-field confidence.
 * @route POST /api/acquisition/parse-image
 * @body {string} image - Base64 encoded image
 * @body {string} mediaType - MIME type (image/jpeg, image/png, etc.)
 * @returns {Object} Parsed wines with confidence data
 */
router.post('/parse-image', async (req, res) => {
  const { image, mediaType } = req.body;

  if (!image || !mediaType) {
    return res.status(400).json({ error: 'image and mediaType are required' });
  }

  try {
    const result = await parseWineWithConfidence(image, mediaType);

    res.json({
      wines: result.wines,
      confidence: result.confidence,
      parse_notes: result.parse_notes,
      confidence_levels: CONFIDENCE_LEVELS
    });
  } catch (error) {
    logger.error('Acquisition', `Parse image error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get placement suggestion for a wine (zone + fridge eligibility).
 * @route POST /api/acquisition/suggest-placement
 * @body {Object} wine - Wine data
 * @returns {Object} Placement suggestions
 */
router.post('/suggest-placement', (req, res) => {
  const { wine } = req.body;

  if (!wine) {
    return res.status(400).json({ error: 'wine object is required' });
  }

  try {
    const placement = suggestPlacement(wine);
    res.json(placement);
  } catch (error) {
    logger.error('Acquisition', `Placement suggestion error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Enrich wine with ratings and drinking windows.
 * Can be called after wine is saved for background enrichment.
 * @route POST /api/acquisition/enrich
 * @body {Object} wine - Wine data (with optional id for DB wine)
 * @returns {Object} Enrichment data
 */
router.post('/enrich', async (req, res) => {
  const { wine } = req.body;

  if (!wine || !wine.wine_name) {
    return res.status(400).json({ error: 'wine object with wine_name is required' });
  }

  try {
    const enrichment = await enrichWineData(wine);
    res.json(enrichment);
  } catch (error) {
    logger.error('Acquisition', `Enrichment error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Run complete acquisition workflow.
 * Handles the entire Scan → Confirm → Place flow.
 * @route POST /api/acquisition/workflow
 * @body {string} [image] - Base64 image for parsing
 * @body {string} [mediaType] - Image MIME type
 * @body {string} [text] - Text for parsing (alternative to image)
 * @body {Object} [confirmedData] - User-confirmed wine data
 * @body {boolean} [skipEnrichment] - Skip ratings/windows fetch
 * @returns {Object} Workflow result with wines, placement, enrichment
 */
router.post('/workflow', async (req, res) => {
  const {
    image,
    mediaType,
    text,
    confirmedData,
    skipEnrichment
  } = req.body;

  if (!image && !text && !confirmedData) {
    return res.status(400).json({
      error: 'One of image, text, or confirmedData is required'
    });
  }

  try {
    const result = await runAcquisitionWorkflow({
      base64Image: image,
      mediaType,
      text,
      confirmedData,
      skipEnrichment
    });

    res.json(result);
  } catch (error) {
    logger.error('Acquisition', `Workflow error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Save wine from acquisition workflow.
 * Creates wine and adds bottles to slots.
 * @route POST /api/acquisition/save
 * @body {Object} wine - Wine data
 * @body {string} [slot] - Specific slot to place in
 * @body {number} [quantity] - Number of bottles (default 1)
 * @body {boolean} [addToFridge] - Add to fridge if eligible
 * @returns {Object} Save result with wineId and slots
 */
router.post('/save', async (req, res) => {
  const { wine, slot, quantity, addToFridge } = req.body;

  if (!wine || !wine.wine_name) {
    return res.status(400).json({ error: 'wine object with wine_name is required' });
  }

  try {
    const result = await saveAcquiredWine(wine, {
      slot,
      quantity,
      addToFridge
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Acquisition', `Save error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get confidence level definitions.
 * @route GET /api/acquisition/confidence-levels
 * @returns {Object} Confidence level definitions
 */
router.get('/confidence-levels', (_req, res) => {
  res.json({
    levels: CONFIDENCE_LEVELS,
    uncertainThreshold: 'medium',
    descriptions: {
      high: 'Clearly visible/readable - no editing needed',
      medium: 'Partially visible or inferred - may need review',
      low: 'Guessed or uncertain - needs review',
      missing: 'Not found in image - must be entered manually'
    }
  });
});

export default router;
