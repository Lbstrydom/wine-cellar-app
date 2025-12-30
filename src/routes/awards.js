/**
 * @fileoverview API routes for awards database management.
 * @module routes/awards
 */

import { Router } from 'express';
import multer from 'multer';
import * as awardsService from '../services/awards.js';
import * as ocrService from '../services/ocrService.js';
import logger from '../utils/logger.js';

const router = Router();

// Configure multer for PDF uploads (5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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
router.get('/sources', (_req, res) => {
  try {
    const sources = awardsService.getAwardSources();
    res.json({ data: sources });
  } catch (err) {
    logger.error('Awards', `Failed to get sources: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /awards/sources/:sourceId
 * Get awards for a specific source.
 */
router.get('/sources/:sourceId', (req, res) => {
  try {
    const { sourceId } = req.params;
    const awards = awardsService.getSourceAwards(sourceId);
    res.json({ data: awards });
  } catch (err) {
    logger.error('Awards', `Failed to get source awards: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /awards/sources/:sourceId
 * Delete an award source and its awards.
 */
router.delete('/sources/:sourceId', (req, res) => {
  try {
    const { sourceId } = req.params;
    const success = awardsService.deleteSource(sourceId);
    if (success) {
      res.json({ message: 'Source deleted' });
    } else {
      res.status(404).json({ error: 'Source not found' });
    }
  } catch (err) {
    logger.error('Awards', `Failed to delete source: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /awards/competitions
 * Get all known competitions.
 */
router.get('/competitions', (_req, res) => {
  try {
    const competitions = awardsService.getKnownCompetitions();
    res.json({ data: competitions });
  } catch (err) {
    logger.error('Awards', `Failed to get competitions: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /awards/competitions
 * Add a custom competition.
 */
router.post('/competitions', (req, res) => {
  try {
    const competition = req.body;

    if (!competition.name) {
      return res.status(400).json({ error: 'Competition name is required' });
    }

    const id = awardsService.addCompetition(competition);
    res.status(201).json({ message: 'Competition added', id });
  } catch (err) {
    logger.error('Awards', `Failed to add competition: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /awards/import/webpage
 * Import awards from a webpage URL.
 */
router.post('/import/webpage', async (req, res) => {
  try {
    const { url, competitionId, year } = req.body;

    if (!url || !competitionId || !year) {
      return res.status(400).json({ error: 'url, competitionId, and year are required' });
    }

    logger.info('Awards', `Starting webpage import: ${competitionId} ${year} from ${url}`);

    // Extract awards from webpage
    const extracted = await awardsService.extractFromWebpage(url, competitionId, year);

    if (!extracted.awards || extracted.awards.length === 0) {
      return res.json({
        message: 'No awards found in webpage',
        extracted: 0,
        notes: extracted.extraction_notes
      });
    }

    // Create source and import
    const sourceId = awardsService.getOrCreateSource(competitionId, year, url, 'webpage');
    const result = awardsService.importAwards(sourceId, extracted.awards);

    // Auto-match to cellar
    const matchResult = awardsService.autoMatchAwards(sourceId);

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
  } catch (err) {
    logger.error('Awards', `Webpage import failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /awards/import/pdf
 * Import awards from a PDF file upload.
 */
router.post('/import/pdf', upload.single('pdf'), async (req, res) => {
  try {
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
    const sourceId = awardsService.getOrCreateSource(competitionId, year, req.file.originalname, 'pdf');
    const result = awardsService.importAwards(sourceId, extracted.awards);

    // Auto-match to cellar
    const matchResult = awardsService.autoMatchAwards(sourceId);

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
  } catch (err) {
    logger.error('Awards', `PDF import failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /awards/import/text
 * Import awards from pasted text or CSV.
 */
router.post('/import/text', async (req, res) => {
  try {
    const { text, competitionId, year, sourceType } = req.body;

    if (!text || !competitionId || !year) {
      return res.status(400).json({ error: 'text, competitionId, and year are required' });
    }

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
    const sourceId = awardsService.getOrCreateSource(competitionId, year, null, sourceType || 'manual');
    const result = awardsService.importAwards(sourceId, extracted.awards);

    // Auto-match to cellar
    const matchResult = awardsService.autoMatchAwards(sourceId);

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
  } catch (err) {
    logger.error('Awards', `Text import failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /awards/sources/:sourceId/match
 * Re-run auto-matching for a source.
 */
router.post('/sources/:sourceId/match', (req, res) => {
  try {
    const { sourceId } = req.params;
    const result = awardsService.autoMatchAwards(sourceId);

    res.json({
      message: 'Matching completed',
      ...result
    });
  } catch (err) {
    logger.error('Awards', `Matching failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /awards/search
 * Search for awards matching a wine name.
 */
router.get('/search', (req, res) => {
  try {
    const { q, vintage } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'q (search query) is required' });
    }

    const awards = awardsService.searchAwards(q, vintage ? parseInt(vintage, 10) : null);
    res.json({ data: awards });
  } catch (err) {
    logger.error('Awards', `Search failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /awards/wine/:wineId
 * Get awards for a specific wine.
 */
router.get('/wine/:wineId', (req, res) => {
  try {
    const wineId = parseInt(req.params.wineId, 10);
    const awards = awardsService.getWineAwards(wineId);
    res.json({ data: awards });
  } catch (err) {
    logger.error('Awards', `Failed to get wine awards: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /awards/:awardId/link
 * Manually link an award to a wine.
 */
router.post('/:awardId/link', (req, res) => {
  try {
    const awardId = parseInt(req.params.awardId, 10);
    const { wineId } = req.body;

    if (!wineId) {
      return res.status(400).json({ error: 'wineId is required' });
    }

    const success = awardsService.linkAwardToWine(awardId, wineId);

    if (success) {
      res.json({ message: 'Award linked to wine' });
    } else {
      res.status(404).json({ error: 'Award not found' });
    }
  } catch (err) {
    logger.error('Awards', `Failed to link award: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /awards/:awardId/link
 * Unlink an award from a wine.
 */
router.delete('/:awardId/link', (req, res) => {
  try {
    const awardId = parseInt(req.params.awardId, 10);
    const success = awardsService.unlinkAward(awardId);

    if (success) {
      res.json({ message: 'Award unlinked' });
    } else {
      res.status(404).json({ error: 'Award not found' });
    }
  } catch (err) {
    logger.error('Awards', `Failed to unlink award: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /awards/:awardId/matches
 * Get potential wine matches for an award.
 */
router.get('/:awardId/matches', (req, res) => {
  try {
    const awardId = parseInt(req.params.awardId, 10);

    // Get the award
    const award = awardsService.getSourceAwards('').find(a => a.id === awardId);

    if (!award) {
      return res.status(404).json({ error: 'Award not found' });
    }

    const matches = awardsService.findMatches(award);
    res.json({ data: matches });
  } catch (err) {
    logger.error('Awards', `Failed to find matches: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /awards/ocr/status
 * Get local OCR service status.
 */
router.get('/ocr/status', async (_req, res) => {
  try {
    const status = await ocrService.getOCRStatus();
    res.json({
      data: {
        ...status,
        currentMethod: process.env.PDF_OCR_METHOD || 'local'
      }
    });
  } catch (err) {
    logger.error('Awards', `Failed to get OCR status: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
