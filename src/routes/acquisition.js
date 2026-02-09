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
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody } from '../middleware/validate.js';
import { parseImageSchema, suggestPlacementSchema, enrichSchema, workflowSchema, saveAcquiredSchema } from '../schemas/acquisition.js';

const router = Router();

/**
 * Parse wine from image with per-field confidence.
 * @route POST /api/acquisition/parse-image
 * @body {string} image - Base64 encoded image
 * @body {string} mediaType - MIME type (image/jpeg, image/png, etc.)
 * @returns {Object} Parsed wines with confidence data
 */
router.post('/parse-image', validateBody(parseImageSchema), asyncHandler(async (req, res) => {
  const { image, mediaType } = req.body;

  const result = await parseWineWithConfidence(image, mediaType);

  res.json({
    wines: result.wines,
    confidence: result.confidence,
    parse_notes: result.parse_notes,
    confidence_levels: CONFIDENCE_LEVELS
  });
}));

/**
 * Get placement suggestion for a wine (zone + fridge eligibility).
 * @route POST /api/acquisition/suggest-placement
 * @body {Object} wine - Wine data
 * @returns {Object} Placement suggestions
 */
router.post('/suggest-placement', validateBody(suggestPlacementSchema), asyncHandler(async (req, res) => {
  const { wine } = req.body;

  const placement = await suggestPlacement(wine, req.cellarId);
  res.json(placement);
}));

/**
 * Enrich wine with ratings and drinking windows.
 * Can be called after wine is saved for background enrichment.
 * @route POST /api/acquisition/enrich
 * @body {Object} wine - Wine data (with optional id for DB wine)
 * @returns {Object} Enrichment data
 */
router.post('/enrich', validateBody(enrichSchema), asyncHandler(async (req, res) => {
  const { wine } = req.body;

  const enrichment = await enrichWineData(wine);
  res.json(enrichment);
}));

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
router.post('/workflow', validateBody(workflowSchema), asyncHandler(async (req, res) => {
  const {
    image,
    mediaType,
    text,
    confirmedData,
    skipEnrichment
  } = req.body;

  const result = await runAcquisitionWorkflow({
    base64Image: image,
    mediaType,
    text,
    confirmedData,
    skipEnrichment,
    cellarId: req.cellarId
  });

  res.json(result);
}));

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
router.post('/save', validateBody(saveAcquiredSchema), asyncHandler(async (req, res) => {
  const { wine, slot, quantity, addToFridge } = req.body;

  const result = await saveAcquiredWine(wine, {
    slot,
    quantity,
    addToFridge,
    cellarId: req.cellarId
  });

  res.status(201).json(result);
}));

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
