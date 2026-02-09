/**
 * @fileoverview API routes for awards database management.
 * @module routes/awards
 */

import { Router } from 'express';
import multer from 'multer';
import * as awardsService from '../services/awards/index.js';
import * as ocrService from '../services/awards/ocrService.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { addCompetitionSchema, importWebpageSchema, importTextSchema, linkAwardSchema, searchAwardsQuerySchema, awardIdSchema, sourceIdSchema, awardWineIdSchema } from '../schemas/awards.js';

const router = Router();

// Configure multer for PDF uploads (50MB limit to allow large booklets)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

/**
 * GET /awards/sources
 * Get all award sources.
 */
router.get('/sources', asyncHandler(async (_req, res) => {
  const sources = await awardsService.getAwardSources();
  res.json({ data: sources });
}));

/**
 * GET /awards/sources/:sourceId
 * Get awards for a specific source.
 */
router.get('/sources/:sourceId', validateParams(sourceIdSchema), asyncHandler(async (req, res) => {
  const { sourceId } = req.params;
  const awards = await awardsService.getSourceAwards(sourceId);
  res.json({ data: awards });
}));

/**
 * DELETE /awards/sources/:sourceId
 * Delete an award source and its awards.
 */
router.delete('/sources/:sourceId', validateParams(sourceIdSchema), asyncHandler(async (req, res) => {
  const { sourceId } = req.params;
  const success = await awardsService.deleteSource(sourceId);
  if (success) {
    res.json({ message: 'Source deleted' });
  } else {
    res.status(404).json({ error: 'Source not found' });
  }
}));

/**
 * GET /awards/competitions
 * Get all known competitions.
 */
router.get('/competitions', asyncHandler(async (_req, res) => {
  const competitions = await awardsService.getKnownCompetitions();
  res.json({ data: competitions });
}));

/**
 * POST /awards/competitions
 * Add a custom competition.
 */
router.post('/competitions', validateBody(addCompetitionSchema), asyncHandler(async (req, res) => {
  const competition = req.body;

  const id = await awardsService.addCompetition(competition);
  res.status(201).json({ message: 'Competition added', id });
}));

/**
 * POST /awards/import/webpage
 * Import awards from a webpage URL.
 */
router.post('/import/webpage', validateBody(importWebpageSchema), asyncHandler(async (req, res) => {
  const { url, competitionId, year } = req.body;

  logger.info('Awards', `Starting webpage import: ${competitionId} ${year} from ${url}`);

  // Extract awards from webpage
  const extracted = await awardsService.extractFromWebpage(url, competitionId, year);

  if (!extracted.awards || extracted.awards.length === 0) {
    return res.json({
      message: 'No awards found in webpage. The page may load content dynamically with JavaScript. Try: Print the page to PDF (Ctrl+P → Save as PDF) and use PDF import instead.',
      extracted: 0,
      notes: extracted.extraction_notes,
      hint: 'dynamic_content'
    });
  }

  // Create source and import
  const sourceId = await awardsService.getOrCreateSource(competitionId, year, url, 'webpage');
  const result = await awardsService.importAwards(sourceId, extracted.awards);

  // Auto-match to cellar
  const matchResult = await awardsService.autoMatchAwards(sourceId);

  logger.info('Awards', `Imported ${result.imported} awards, matched ${matchResult.exactMatches} exactly`);

  res.json({
    message: 'Awards imported successfully',
    sourceId,
    extracted: extracted.awards.length,
    imported: result.imported,
    skipped: result.skipped,
    matches: matchResult,
    notes: extracted.extraction_notes
  });
}));

/**
 * POST /awards/import/pdf
 * Import awards from a PDF file upload.
 */
router.post('/import/pdf', upload.single('pdf'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'PDF file is required' });
  }

  const { competitionId, year } = req.body;

  if (!competitionId || !year) {
    return res.status(400).json({ error: 'competitionId and year are required' });
  }

  logger.info('Awards', `Starting PDF import: ${competitionId} ${year}`);

  // Convert buffer to base64
  const pdfBase64 = req.file.buffer.toString('base64');

  // Extract awards from PDF
  const extracted = await awardsService.extractFromPDF(pdfBase64, competitionId, year);

  if (!extracted.awards || extracted.awards.length === 0) {
    return res.json({
      message: 'No awards found in PDF',
      extracted: 0,
      notes: extracted.extraction_notes
    });
  }

  // Create source and import
  const sourceId = await awardsService.getOrCreateSource(competitionId, year, req.file.originalname, 'pdf');
  const result = await awardsService.importAwards(sourceId, extracted.awards);

  // Auto-match to cellar
  const matchResult = await awardsService.autoMatchAwards(sourceId);

  logger.info('Awards', `Imported ${result.imported} awards from PDF, matched ${matchResult.exactMatches} exactly`);

  res.json({
    message: 'Awards imported successfully',
    sourceId,
    extracted: extracted.awards.length,
    imported: result.imported,
    skipped: result.skipped,
    matches: matchResult,
    notes: extracted.extraction_notes
  });
}));

/**
 * POST /awards/import/text
 * Import awards from pasted text or CSV.
 */
router.post('/import/text', validateBody(importTextSchema), asyncHandler(async (req, res) => {
  const { text, competitionId, year, sourceType } = req.body;

  logger.info('Awards', `Starting text import: ${competitionId} ${year}`);

  // Extract awards from text
  const extracted = await awardsService.extractFromText(text, competitionId, year);

  if (!extracted.awards || extracted.awards.length === 0) {
    return res.json({
      message: 'No awards found in text',
      extracted: 0,
      notes: extracted.extraction_notes
    });
  }

  // Create source and import
  const sourceId = await awardsService.getOrCreateSource(competitionId, year, null, sourceType || 'manual');
  const result = await awardsService.importAwards(sourceId, extracted.awards);

  // Auto-match to cellar
  const matchResult = await awardsService.autoMatchAwards(sourceId);

  logger.info('Awards', `Imported ${result.imported} awards from text, matched ${matchResult.exactMatches} exactly`);

  res.json({
    message: 'Awards imported successfully',
    sourceId,
    extracted: extracted.awards.length,
    imported: result.imported,
    skipped: result.skipped,
    matches: matchResult,
    notes: extracted.extraction_notes
  });
}));

/**
 * POST /awards/sources/:sourceId/match
 * Re-run auto-matching for a source.
 */
router.post('/sources/:sourceId/match', validateParams(sourceIdSchema), asyncHandler(async (req, res) => {
  const { sourceId } = req.params;
  const result = await awardsService.autoMatchAwards(sourceId);

  res.json({
    message: 'Matching completed',
    ...result
  });
}));

/**
 * GET /awards/search
 * Search for awards matching a wine name.
 */
router.get('/search', validateQuery(searchAwardsQuerySchema), asyncHandler(async (req, res) => {
  const { q, vintage } = req.validated?.query ?? req.query;

  const awards = await awardsService.searchAwards(q, vintage ?? null);
  res.json({ data: awards });
}));

/**
 * GET /awards/wine/:wineId
 * Get awards for a specific wine.
 */
router.get('/wine/:wineId', validateParams(awardWineIdSchema), asyncHandler(async (req, res) => {
  const wineId = req.validated?.params?.wineId ?? parseInt(req.params.wineId, 10);
  const awards = await awardsService.getWineAwards(wineId);
  res.json({ data: awards });
}));

/**
 * POST /awards/:awardId/link
 * Manually link an award to a wine.
 */
router.post('/:awardId/link', validateParams(awardIdSchema), validateBody(linkAwardSchema), asyncHandler(async (req, res) => {
  const awardId = req.validated?.params?.awardId ?? parseInt(req.params.awardId, 10);
  const { wineId } = req.body;

  const success = await awardsService.linkAwardToWine(awardId, wineId);

  if (success) {
    res.json({ message: 'Award linked to wine' });
  } else {
    res.status(404).json({ error: 'Award not found' });
  }
}));

/**
 * DELETE /awards/:awardId/link
 * Unlink an award from a wine.
 */
router.delete('/:awardId/link', validateParams(awardIdSchema), asyncHandler(async (req, res) => {
  const awardId = req.validated?.params?.awardId ?? parseInt(req.params.awardId, 10);
  const success = await awardsService.unlinkAward(awardId);

  if (success) {
    res.json({ message: 'Award unlinked' });
  } else {
    res.status(404).json({ error: 'Award not found' });
  }
}));

/**
 * GET /awards/:awardId/matches
 * Get potential wine matches for an award.
 */
router.get('/:awardId/matches', validateParams(awardIdSchema), asyncHandler(async (req, res) => {
  const awardId = req.validated?.params?.awardId ?? parseInt(req.params.awardId, 10);

  // Get the award
  const awards = await awardsService.getSourceAwards('');
  const award = awards.find(a => a.id === awardId);

  if (!award) {
    return res.status(404).json({ error: 'Award not found' });
  }

  const matches = await awardsService.findMatches(award);
  res.json({ data: matches });
}));

/**
 * GET /awards/ocr/status
 * Get local OCR service status.
 */
router.get('/ocr/status', asyncHandler(async (_req, res) => {
  const status = await ocrService.getOCRStatus();
  res.json({
    data: {
      ...status,
      currentMethod: process.env.PDF_OCR_METHOD || 'local'
    }
  });
}));

export default router;
