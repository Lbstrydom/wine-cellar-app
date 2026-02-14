/**
 * @fileoverview PDF-specific award extraction logic.
 * Handles extraction via Claude direct PDF processing and local OCR fallback.
 * @module services/awards/awardExtractorPDF
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask, getThinkingConfig } from '../../config/aiModels.js';
import { extractStreamText } from '../ai/claudeResponseUtils.js';
import logger from '../../utils/logger.js';
import * as ocrService from './ocrService.js';
import { buildExtractionPrompt, buildPDFExtractionPrompt, parseAwardsResponse } from './awardParser.js';
import { extractFromTextChunked } from './awardExtractorWeb.js';

// Configuration for PDF extraction method
const PDF_EXTRACTION_METHOD = process.env.PDF_OCR_METHOD || 'auto';

const MAX_TOKENS_PDF = 32000;
const MAX_TOKENS_TEXT = 32000;

/**
 * Extract awards from PDF content using Claude (direct PDF).
 * @param {string} pdfBase64 - Base64 encoded PDF
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @returns {Promise<Object>} Extracted awards
 */
async function extractFromPDFWithClaude(pdfBase64, competitionId, year) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  logger.info('Awards', `Extracting awards from PDF using Claude API for ${competitionId} ${year}`);

  const prompt = buildPDFExtractionPrompt(competitionId, year);
  const modelId = getModelForTask('awardExtraction');

  // Use streaming to avoid timeout errors for long-running requests
  const stream = await anthropic.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS_PDF,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ],
    stream: true,
    ...(getThinkingConfig('awardExtraction') || {})
  });

  const responseText = await extractStreamText(stream);
  const parsed = parseAwardsResponse(responseText);
  return parsed;
}

/**
 * Extract awards from PDF using local RolmOCR + Claude for parsing.
 * @param {string} pdfBase64 - Base64 encoded PDF
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @returns {Promise<Object>} Extracted awards
 */
async function extractFromPDFWithLocalOCR(pdfBase64, competitionId, year) {
  logger.info('Awards', `Extracting text from PDF using RolmOCR for ${competitionId} ${year}`);

  // Step 1: Extract text using local OCR
  const ocrResult = await ocrService.extractTextFromPDF(pdfBase64);

  if (!ocrResult.success || !ocrResult.text || ocrResult.text.trim().length < 50) {
    logger.warn('Awards', 'OCR returned insufficient text');
    return { awards: [], extraction_notes: 'OCR returned insufficient text' };
  }

  logger.info('Awards', `OCR extracted ${ocrResult.text.length} chars from ${ocrResult.totalPages} pages`);

  // Step 2: Use Claude to parse the extracted text into structured awards
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured (needed for parsing OCR text)');
  }

  // Use chunked extraction for large texts (> 15000 chars typically means many awards)
  const CHUNK_THRESHOLD = 15000;
  const CHUNK_SIZE = 8000;

  if (ocrResult.text.length > CHUNK_THRESHOLD) {
    logger.info('Awards', `Large OCR text (${ocrResult.text.length} chars), using chunked extraction`);
    const parsed = await extractFromTextChunked(ocrResult.text, competitionId, year, CHUNK_SIZE);
    parsed.extraction_method = 'local_ocr_chunked';
    parsed.ocr_pages = ocrResult.totalPages;
    return parsed;
  }

  const prompt = buildExtractionPrompt(ocrResult.text, competitionId, year);
  const modelId = getModelForTask('awardExtraction');

  // Use streaming to avoid timeout errors for long-running requests
  const stream = await anthropic.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS_TEXT,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    ...(getThinkingConfig('awardExtraction') || {})
  });

  const responseText = await extractStreamText(stream);
  const parsed = parseAwardsResponse(responseText);
  parsed.extraction_method = 'local_ocr';
  parsed.ocr_pages = ocrResult.totalPages;

  return parsed;
}

/**
 * Extract awards from PDF content.
 * Uses local OCR or Claude API based on configuration.
 * @param {string} pdfBase64 - Base64 encoded PDF
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @returns {Promise<Object>} Extracted awards
 */
export async function extractFromPDF(pdfBase64, competitionId, year) {
  const method = PDF_EXTRACTION_METHOD;

  logger.info('Awards', `PDF extraction method: ${method}`);

  // Method: local - use RolmOCR
  if (method === 'local') {
    try {
      return await extractFromPDFWithLocalOCR(pdfBase64, competitionId, year);
    } catch (err) {
      logger.error('Awards', `Local OCR failed: ${err.message}`);
      throw err;
    }
  }

  // Method: claude - use Claude's direct PDF processing
  if (method === 'claude') {
    return await extractFromPDFWithClaude(pdfBase64, competitionId, year);
  }

  // Method: auto - try local first, fall back to Claude PDF only if OCR not available
  if (method === 'auto') {
    const ocrStatus = await ocrService.checkOCRAvailability();

    if (ocrStatus.available) {
      logger.info('Awards', 'Using local OCR (PyMuPDF/RolmOCR)');
      return await extractFromPDFWithLocalOCR(pdfBase64, competitionId, year);
    } else {
      logger.info('Awards', `Local OCR not available: ${ocrStatus.error}, using Claude PDF API`);
      return await extractFromPDFWithClaude(pdfBase64, competitionId, year);
    }
  }

  // Default to local OCR if available, otherwise Claude PDF
  const ocrStatus = await ocrService.checkOCRAvailability();
  if (ocrStatus.available) {
    return await extractFromPDFWithLocalOCR(pdfBase64, competitionId, year);
  }
  return await extractFromPDFWithClaude(pdfBase64, competitionId, year);
}
