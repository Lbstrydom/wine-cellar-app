/**
 * @fileoverview Awards database import and matching service.
 * Handles bulk import from PDFs, webpages, and magazines.
 * @module services/awards
 */

import Anthropic from '@anthropic-ai/sdk';
import db, { awardsDb } from '../db/index.js';
import { isPostgres } from '../db/helpers.js';
import logger from '../utils/logger.js';
import { fetchPageContent } from './searchProviders.js';
import * as ocrService from './ocrService.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Configuration for PDF extraction method
const PDF_EXTRACTION_METHOD = process.env.PDF_OCR_METHOD || 'auto'; // 'local', 'claude', or 'auto'

// Token limits for Claude API responses
// Claude Opus 4 for award extraction - higher token limits, better accuracy for complex documents
const AWARDS_MODEL = 'claude-opus-4-20250514';
const MAX_TOKENS_PDF = 16000;   // For PDF extraction (Opus supports up to 32K output)
const MAX_TOKENS_TEXT = 16000;  // For text extraction
const MAX_TOKENS_CHUNK = 16000; // For chunked extraction of large texts

/**
 * Normalize wine name for matching.
 * @param {string} name - Wine name
 * @returns {string} Normalized name
 */
export function normalizeWineName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replaceAll(/['\u2018\u2019]/g, "'")  // Normalize quotes (', ', ')
    .replaceAll(/["\u201C\u201D]/g, '"')  // Normalize quotes (", ", ")
    .replaceAll(/[\u2013\u2014]/g, '-')  // Normalize dashes
    .replaceAll(/\s+/g, ' ')  // Normalize whitespace
    .replaceAll(/[^\w\s'-]/g, '')  // Remove special chars except apostrophes and hyphens
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1).
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (1 = identical)
 */
export function calculateSimilarity(a, b) {
  const normA = normalizeWineName(a);
  const normB = normalizeWineName(b);

  if (normA === normB) return 1;
  if (!normA || !normB) return 0;

  const distance = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);

  return 1 - (distance / maxLen);
}

/**
 * Check if producer names match.
 * @param {string} awardProducer - Producer from award
 * @param {string} cellarWineName - Wine name from cellar
 * @returns {boolean} True if producer seems to match
 */
function producerMatches(awardProducer, cellarWineName) {
  if (!awardProducer) return true; // No producer to match

  const normProducer = normalizeWineName(awardProducer);
  const normWine = normalizeWineName(cellarWineName);

  // Check if producer name appears in wine name
  const producerWords = normProducer.split(' ');
  const wineWords = normWine.split(' ');

  // At least half the producer words should appear in wine name
  const matchCount = producerWords.filter(pw =>
    wineWords.some(ww => ww === pw || calculateSimilarity(pw, ww) > 0.8)
  ).length;

  return matchCount >= Math.ceil(producerWords.length / 2);
}

/**
 * Find matching wines in cellar for an award.
 * @param {Object} award - Award entry
 * @returns {Object[]} Array of potential matches with scores
 */
export function findMatches(award) {
  const wines = db.prepare(`
    SELECT id, wine_name, vintage, country, region
    FROM wines
  `).all();

  const matches = [];
  const awardNorm = normalizeWineName(award.wine_name);

  for (const wine of wines) {
    // Check vintage if specified
    if (award.vintage && wine.vintage && award.vintage !== wine.vintage) {
      continue;
    }

    // Check producer match
    if (award.producer && !producerMatches(award.producer, wine.wine_name)) {
      continue;
    }

    // Calculate name similarity
    const wineNorm = normalizeWineName(wine.wine_name);
    const similarity = calculateSimilarity(awardNorm, wineNorm);

    // Also try matching just the wine portion (without producer)
    const awardWords = awardNorm.split(' ');
    const wineWords = wineNorm.split(' ');

    // Token overlap score
    const commonTokens = awardWords.filter(aw =>
      wineWords.some(ww => ww === aw || (aw.length > 3 && ww.includes(aw)))
    ).length;
    const tokenScore = commonTokens / Math.max(awardWords.length, wineWords.length);

    // Combined score
    const score = Math.max(similarity, tokenScore);

    if (score >= 0.4) {  // Threshold for potential match
      matches.push({
        wine,
        score,
        matchType: score >= 0.9 ? 'exact' : 'fuzzy'
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches.slice(0, 5);  // Top 5 matches
}

/**
 * Normalize award type to standard codes.
 * @param {string} award - Raw award text
 * @returns {string} Normalized award code
 */
function normalizeAward(award) {
  if (!award) return 'unknown';

  const lower = award.toLowerCase().trim();

  // Trophy/Best in show
  if (lower.includes('trophy') || lower.includes('best in show') || lower.includes('best in class')) {
    return 'trophy';
  }
  // Double gold / Grand gold
  if (lower.includes('double gold') || lower.includes('grand gold')) {
    return 'double_gold';
  }
  // Gold
  if (lower.includes('gold') && !lower.includes('silver')) {
    return 'gold';
  }
  // Silver
  if (lower.includes('silver')) {
    return 'silver';
  }
  // Bronze
  if (lower.includes('bronze')) {
    return 'bronze';
  }
  // Platinum
  if (lower.includes('platinum')) {
    return 'platinum';
  }
  // Top 10
  if (lower.includes('top 10') || lower.includes('top ten')) {
    return 'top_10';
  }
  // Stars (Platter's style)
  const starMatch = lower.match(/(\d(?:\.\d)?)\s*star/);
  if (starMatch) {
    return `${starMatch[1]}_star`;
  }
  // Points
  const pointMatch = lower.match(/(\d{2,3})\s*(?:points?|pts?)/);
  if (pointMatch) {
    return `${pointMatch[1]}_points`;
  }

  return lower.replaceAll(/\s+/g, '_').substring(0, 30);
}

/**
 * Get or create an award source.
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @param {string} sourceUrl - Source URL or file path
 * @param {string} sourceType - 'pdf', 'webpage', 'magazine', 'csv', 'manual'
 * @returns {string} Source ID
 */
export function getOrCreateSource(competitionId, year, sourceUrl, sourceType) {
  const sourceId = `${competitionId}_${year}`;

  // Check if source exists
  const existing = awardsDb.prepare('SELECT id FROM award_sources WHERE id = ?').get(sourceId);

  if (existing) {
    return sourceId;
  }

  // Get competition name
  const competition = awardsDb.prepare('SELECT name FROM known_competitions WHERE id = ?').get(competitionId);
  const competitionName = competition?.name || competitionId;

  awardsDb.prepare(`
    INSERT INTO award_sources (id, competition_id, competition_name, year, source_url, source_type, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(sourceId, competitionId, competitionName, year, sourceUrl, sourceType);

  return sourceId;
}

/**
 * Import awards from extracted text.
 * @param {string} sourceId - Award source ID
 * @param {Object[]} awards - Array of award objects
 * @returns {Object} Import result
 */
export function importAwards(sourceId, awards) {
  if (!awards || awards.length === 0) {
    return { imported: 0, skipped: 0, errors: [] };
  }

  const insertStmt = awardsDb.prepare(`
    INSERT OR IGNORE INTO competition_awards (
      source_id, producer, wine_name, wine_name_normalized, vintage,
      award, award_normalized, category, region, extra_info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const award of awards) {
    try {
      const result = insertStmt.run(
        sourceId,
        award.producer || null,
        award.wine_name,
        normalizeWineName(award.wine_name),
        award.vintage || null,
        award.award,
        normalizeAward(award.award),
        award.category || null,
        award.region || null,
        award.extra_info ? JSON.stringify(award.extra_info) : null
      );

      if (result.changes > 0) {
        imported++;
      } else {
        skipped++; // Duplicate
      }
    } catch (err) {
      errors.push({ award: award.wine_name, error: err.message });
    }
  }

  // Update source stats
  awardsDb.prepare(`
    UPDATE award_sources
    SET award_count = (SELECT COUNT(*) FROM competition_awards WHERE source_id = ?),
        status = 'completed'
    WHERE id = ?
  `).run(sourceId, sourceId);

  return { imported, skipped, errors };
}

/**
 * Extract awards from webpage content using Claude.
 * @param {string} url - Webpage URL
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @returns {Promise<Object>} Extracted awards
 */
export async function extractFromWebpage(url, competitionId, year) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  logger.info('Awards', `Fetching webpage: ${url}`);

  const fetched = await fetchPageContent(url, 15000);

  if (!fetched.success || fetched.content.length < 100) {
    throw new Error(`Failed to fetch page: ${fetched.error || 'Empty content'}`);
  }

  logger.info('Awards', `Fetched ${fetched.content.length} chars, extracting awards...`);

  const prompt = buildExtractionPrompt(fetched.content, competitionId, year);

  // Use streaming to avoid timeout errors for long-running requests
  let responseText = '';
  const stream = await anthropic.messages.create({
    model: AWARDS_MODEL,
    max_tokens: MAX_TOKENS_TEXT,
    messages: [{ role: 'user', content: prompt }],
    stream: true
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      responseText += event.delta.text;
    }
  }

  const parsed = parseAwardsResponse(responseText);
  return parsed;
}

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

  // Use streaming to avoid timeout errors for long-running requests
  let responseText = '';
  const stream = await anthropic.messages.create({
    model: AWARDS_MODEL,
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
    stream: true
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      responseText += event.delta.text;
    }
  }

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
  // This prevents token limit issues when generating JSON for hundreds of awards
  const CHUNK_THRESHOLD = 15000;
  const CHUNK_SIZE = 8000;  // Reduced from 12000 to generate smaller JSON responses

  if (ocrResult.text.length > CHUNK_THRESHOLD) {
    logger.info('Awards', `Large OCR text (${ocrResult.text.length} chars), using chunked extraction`);
    const parsed = await extractFromTextChunked(ocrResult.text, competitionId, year, CHUNK_SIZE);
    parsed.extraction_method = 'local_ocr_chunked';
    parsed.ocr_pages = ocrResult.totalPages;
    return parsed;
  }

  const prompt = buildExtractionPrompt(ocrResult.text, competitionId, year);

  // Use streaming to avoid timeout errors for long-running requests
  let responseText = '';
  const stream = await anthropic.messages.create({
    model: AWARDS_MODEL,
    max_tokens: MAX_TOKENS_TEXT,
    messages: [{ role: 'user', content: prompt }],
    stream: true
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      responseText += event.delta.text;
    }
  }

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
    // Check if local OCR is available
    const ocrStatus = await ocrService.checkOCRAvailability();

    if (ocrStatus.available) {
      logger.info('Awards', 'Using local OCR (PyMuPDF/RolmOCR)');
      // Don't catch errors here - if Claude text parsing fails, let it propagate
      // We only want to fall back to Claude PDF if OCR itself is not available
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

/**
 * Extract awards from raw text (manual paste or CSV).
 * @param {string} text - Raw text content
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @returns {Promise<Object>} Extracted awards
 */
export async function extractFromText(text, competitionId, year) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  logger.info('Awards', `Extracting awards from text (${text.length} chars) for ${competitionId} ${year}`);

  // For very large text, we may need to chunk it
  const MAX_TEXT_CHARS = 50000;  // ~12k tokens input

  if (text.length > MAX_TEXT_CHARS) {
    logger.info('Awards', `Text too large (${text.length} chars), processing in chunks`);
    return await extractFromTextChunked(text, competitionId, year, MAX_TEXT_CHARS);
  }

  const prompt = buildExtractionPrompt(text, competitionId, year);

  // Use streaming to avoid timeout errors for long-running requests
  let responseText = '';
  const stream = await anthropic.messages.create({
    model: AWARDS_MODEL,
    max_tokens: MAX_TOKENS_TEXT,
    messages: [{ role: 'user', content: prompt }],
    stream: true
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      responseText += event.delta.text;
    }
  }

  const parsed = parseAwardsResponse(responseText);
  return parsed;
}

/**
 * Extract awards from large text by processing in chunks.
 * @param {string} text - Raw text content
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @param {number} chunkSize - Max characters per chunk
 * @returns {Promise<Object>} Combined extracted awards
 */
async function extractFromTextChunked(text, competitionId, year, chunkSize) {
  // Split text into chunks, trying to break at line boundaries
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (newline near the chunk boundary)
    let breakPoint = remaining.lastIndexOf('\n', chunkSize);
    if (breakPoint < chunkSize * 0.7) {
      // No good newline found, just break at chunk size
      breakPoint = chunkSize;
    }

    chunks.push(remaining.substring(0, breakPoint));
    remaining = remaining.substring(breakPoint).trim();
  }

  logger.info('Awards', `Processing ${chunks.length} chunks`);

  // Process each chunk with retry logic
  const allAwards = [];
  const notes = [];
  const MAX_RETRIES = 1;

  for (let i = 0; i < chunks.length; i++) {
    logger.info('Awards', `Processing chunk ${i + 1}/${chunks.length}`);

    let parsed = null;
    let retryCount = 0;
    let currentMaxTokens = MAX_TOKENS_CHUNK;

    while (retryCount <= MAX_RETRIES && !parsed?.awards?.length) {
      try {
        const prompt = buildExtractionPrompt(chunks[i], competitionId, year);

        let responseText = '';
        const stream = await anthropic.messages.create({
          model: AWARDS_MODEL,
          max_tokens: currentMaxTokens,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            responseText += event.delta.text;
          }
        }
        parsed = parseAwardsResponse(responseText);

        if (!parsed?.awards?.length && retryCount < MAX_RETRIES) {
          // Retry with reduced tokens
          logger.info('Awards', `Chunk ${i + 1} parse failed, retrying with reduced tokens`);
          retryCount++;
          currentMaxTokens = Math.max(8000, currentMaxTokens - 4000);
          parsed = null;  // Reset to trigger retry
        }
      } catch (error) {
        if (retryCount < MAX_RETRIES) {
          logger.warn('Awards', `Chunk ${i + 1} error: ${error.message}, retrying...`);
          retryCount++;
          currentMaxTokens = Math.max(8000, currentMaxTokens - 4000);
          await new Promise(resolve => setTimeout(resolve, 500));  // Brief delay before retry
        } else {
          logger.error('Awards', `Chunk ${i + 1} failed after ${MAX_RETRIES} retries: ${error.message}`);
          parsed = { awards: [], extraction_notes: `Failed after ${MAX_RETRIES} retries: ${error.message}` };
        }
      }
    }

    if (parsed?.awards?.length > 0) {
      allAwards.push(...parsed.awards);
    }

    if (parsed?.extraction_notes) {
      notes.push(`Chunk ${i + 1}: ${parsed.extraction_notes}`);
    }
  }

  // Deduplicate awards by wine_name + vintage + award
  const seen = new Set();
  const uniqueAwards = allAwards.filter(award => {
    const key = `${award.wine_name}|${award.vintage}|${award.award}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    awards: uniqueAwards,
    extraction_notes: `Processed ${chunks.length} chunks. ${notes.join('; ')}`,
    chunks_processed: chunks.length
  };
}

/**
 * Build prompt for award extraction.
 * @param {string} content - Text content
 * @param {string} competitionId - Competition ID
 * @param {number} year - Year
 * @returns {string} Prompt
 */
function buildExtractionPrompt(content, competitionId, year) {
  return `Extract wine awards from this content for the ${competitionId} ${year} competition.

IMPORTANT: This content may be in German, English, or another language. The content may also include 
introductory text, forewords, or other preamble before the actual awards list. Focus ONLY on extracting 
the actual wine awards list, ignoring all introductory sections.

CONTENT:
${content.substring(0, 60000)}

---

TASK: Extract all wine awards found in this content, skipping any preamble/introduction.

For each award entry, extract:
- producer: Winery/producer name (if separate from wine name)
- wine_name: Full wine name (may include producer)
- vintage: Year as integer (null if not specified)
- award: Award level (Gold, Silver, Bronze, Trophy, Double Gold, etc.)
- category: Wine category if specified (e.g., "Pinotage", "Cabernet Sauvignon", "Sparkling")
- region: Region if specified

Return ONLY valid JSON:
{
  "awards": [
    {
      "producer": "Example Estate",
      "wine_name": "Example Estate Reserve Pinotage",
      "vintage": 2022,
      "award": "Gold",
      "category": "Pinotage",
      "region": "Stellenbosch"
    }
  ],
  "extraction_notes": "Summary of extraction"
}

ADDITIONAL NOTES:
- Content may be in German or other languages - extract regardless of language
- Common German awards: "Grosses Gold" (Grand Gold), "Gold", "Silber" (Silver), "Bronze"
- Skip introductory pages, forewords, explanatory text, competition rules, etc.
- Look for structured lists or tables of wine names with award levels
- When in doubt about whether text is awards vs. introduction, prefer skipping it

RULES:
- Extract ALL awards visible in the content
- Be thorough - don't miss entries
- If wine name includes producer, that's fine
- Set vintage to null if not specified
- Use exact award names as shown (Gold, Silver, Bronze, Trophy, etc.)
- If content is a table, preserve the structure
- If no awards found: {"awards": [], "extraction_notes": "No awards found"}`;
}

/**
 * Build prompt for PDF award extraction.
 * @param {string} competitionId - Competition ID
 * @param {number} year - Year
 * @returns {string} Prompt
 */
function buildPDFExtractionPrompt(competitionId, year) {
  return `This is a PDF from the ${competitionId} ${year} wine competition/guide.
IMPORTANT: This document may be in German, English, or another language. It may contain introductory 
text, forewords, competition rules, or other preamble before the actual awards list. Focus ONLY on 
extracting the actual wine awards, ignoring all introductory sections.


TASK: Extract all wine awards from this document.

For each award entry, extract:
- producer: Winery/producer name (if separate from wine name)
- wine_name: Full wine name (may include producer)
- vintage: Year as integer (null if not specified)
- award: Award level (Gold, Silver, Bronze, Trophy, Double Gold, 5 Stars, etc.)
ADDITIONAL NOTES:
- Content may be in German or other languages - extract regardless of language
- Common German awards: "Grosses Gold" (Grand Gold), "Gold", "Silber" (Silver), "Bronze"
- Skip introductory pages, forewords, explanatory text, competition rules, etc.
- Look for structured lists or tables of wine names with award levels
- When in doubt about whether section contains awards vs. introduction, prefer skipping it

- category: Wine category if specified
- region: Region if specified

Return ONLY valid JSON:
{
  "awards": [
    {
      "producer": "Example Estate",
      "wine_name": "Example Estate Reserve",
      "vintage": 2022,
      "award": "Gold",
      "category": "Red Blend",
      "region": "Western Cape"
    }
  ],
  "extraction_notes": "Summary of what was found"
}

RULES:
- Extract ALL awards visible in the document
- Read every page carefully
- Preserve the exact wine names as listed
- Set vintage to null if not specified
- Use exact award names as shown
- If document has multiple sections (Gold, Silver, Bronze), process all
- If no awards found: {"awards": [], "extraction_notes": "No awards found"}`;
}

/**
 * Salvage awards from truncated JSON response.
 * Extracts individual award objects even if the overall JSON is malformed.
 * @param {string} text - Truncated JSON text
 * @returns {Object[]} Salvaged awards
 */
function salvagePartialJSON(text) {
  const awards = [];
  // Match individual award objects containing wine_name and award fields
  const awardPattern = /\{\s*"[^"]*":\s*"[^"]*"[^}]*?"wine_name"\s*:\s*"[^"]*"[^}]*?"award"\s*:\s*"[^"]*"[^}]*?\}/g;
  
  const matches = text.match(awardPattern) || [];
  
  for (const match of matches) {
    try {
      const award = JSON.parse(match);
      if (award.wine_name && award.award) {
        awards.push(award);
      }
    } catch (_e) {
      // Skip malformed individual awards
      continue;
    }
  }
  
  return awards;
}

/**
 * Parse awards extraction response.
 * @param {string} text - Response text
 * @returns {Object} Parsed result
 */
function parseAwardsResponse(text) {
  // Try direct parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.awards && Array.isArray(parsed.awards)) {
      return parsed;
    }
  } catch (_e) {
    // Continue to fallbacks
  }

  // Try code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.awards && Array.isArray(parsed.awards)) {
        return parsed;
      }
    } catch (_e) {
      // Continue
    }
  }

  // Try finding JSON object
  const objectMatch = text.match(/\{[\s\S]*?"awards"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.awards && Array.isArray(parsed.awards)) {
        return parsed;
      }
    } catch (_e) {
      // Continue
    }
  }

  // Last resort: Salvage individual awards from truncated response
  const salvaged = salvagePartialJSON(text);
  if (salvaged.length > 0) {
    logger.info('Awards', `Salvaged ${salvaged.length} awards from truncated response`);
    return { awards: salvaged, extraction_notes: `Salvaged ${salvaged.length} awards from truncated response` };
  }

  logger.error('Awards', `Failed to parse response: ${text.substring(0, 300)}`);
  return { awards: [], extraction_notes: 'Failed to parse response' };
}

/**
 * Auto-match imported awards to cellar wines.
 * @param {string} sourceId - Award source ID
 * @returns {Object} Match results
 */
export function autoMatchAwards(sourceId) {
  const unmatched = awardsDb.prepare(`
    SELECT id, producer, wine_name, wine_name_normalized, vintage
    FROM competition_awards
    WHERE source_id = ? AND matched_wine_id IS NULL
  `).all(sourceId);

  let exactMatches = 0;
  let fuzzyMatches = 0;
  let noMatches = 0;

  const updateStmt = awardsDb.prepare(`
    UPDATE competition_awards
    SET matched_wine_id = ?, match_type = ?, match_confidence = ?
    WHERE id = ?
  `);

  for (const award of unmatched) {
    const matches = findMatches(award);

    if (matches.length === 0) {
      noMatches++;
      continue;
    }

    const best = matches[0];

    // Only auto-match high confidence exact matches
    if (best.matchType === 'exact' && best.score >= 0.9) {
      updateStmt.run(best.wine.id, 'exact', best.score, award.id);
      exactMatches++;
    } else if (best.score >= 0.7) {
      // Mark as fuzzy match but don't auto-link (needs review)
      updateStmt.run(null, 'fuzzy', best.score, award.id);
      fuzzyMatches++;
    } else {
      noMatches++;
    }
  }

  return { exactMatches, fuzzyMatches, noMatches, total: unmatched.length };
}

/**
 * Get awards for a wine from the local database.
 * @param {number} wineId - Wine ID
 * @returns {Object[]} Matching awards
 */
export function getWineAwards(wineId) {
  return awardsDb.prepare(`
    SELECT
      ca.*,
      aws.competition_name,
      aws.year as competition_year,
      kc.credibility
    FROM competition_awards ca
    JOIN award_sources aws ON aws.id = ca.source_id
    LEFT JOIN known_competitions kc ON kc.id = aws.competition_id
    WHERE ca.matched_wine_id = ?
    ORDER BY aws.year DESC, ca.award_normalized DESC
  `).all(wineId);
}

/**
 * Search for awards matching a wine name (for wines not yet matched).
 * @param {string} wineName - Wine name to search
 * @param {number|null} vintage - Optional vintage
 * @returns {Object[]} Potential matching awards
 */
export function searchAwards(wineName, vintage = null) {
  const normalized = normalizeWineName(wineName);

  // Get all unmatched awards
  const awards = awardsDb.prepare(`
    SELECT
      ca.*,
      aws.competition_name,
      aws.year as competition_year
    FROM competition_awards ca
    JOIN award_sources aws ON aws.id = ca.source_id
    WHERE ca.matched_wine_id IS NULL
    ${vintage ? 'AND (ca.vintage IS NULL OR ca.vintage = ?)' : ''}
  `).all(vintage ? [vintage] : []);

  // Score and filter
  const matches = [];

  for (const award of awards) {
    const similarity = calculateSimilarity(normalized, award.wine_name_normalized);

    if (similarity >= 0.5) {
      matches.push({
        ...award,
        similarity
      });
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);

  return matches.slice(0, 10);
}

/**
 * Manually link an award to a wine.
 * @param {number} awardId - Award ID
 * @param {number} wineId - Wine ID
 * @returns {boolean} Success
 */
export function linkAwardToWine(awardId, wineId) {
  const result = awardsDb.prepare(`
    UPDATE competition_awards
    SET matched_wine_id = ?, match_type = 'manual', match_confidence = 1.0
    WHERE id = ?
  `).run(wineId, awardId);

  return result.changes > 0;
}

/**
 * Unlink an award from a wine.
 * @param {number} awardId - Award ID
 * @returns {boolean} Success
 */
export function unlinkAward(awardId) {
  const result = awardsDb.prepare(`
    UPDATE competition_awards
    SET matched_wine_id = NULL, match_type = NULL, match_confidence = NULL
    WHERE id = ?
  `).run(awardId);

  return result.changes > 0;
}

/**
 * Get all award sources.
 * @returns {Object[]} Award sources
 */
export function getAwardSources() {
  return awardsDb.prepare(`
    SELECT
      aws.*,
      kc.name as competition_display_name,
      kc.scope,
      kc.credibility
    FROM award_sources aws
    LEFT JOIN known_competitions kc ON kc.id = aws.competition_id
    ORDER BY aws.year DESC, aws.competition_name
  `).all();
}

/**
 * Get awards for a source.
 * @param {string} sourceId - Source ID
 * @returns {Object[]} Awards
 */
export function getSourceAwards(sourceId) {
  // Get awards from awards database
  const awards = awardsDb.prepare(`
    SELECT ca.*
    FROM competition_awards ca
    WHERE ca.source_id = ?
    ORDER BY ca.award_normalized DESC, ca.wine_name
  `).all(sourceId);

  // Optimized: Batch load all matched wines in a single query instead of N+1
  const matchedWineIds = [...new Set(
    awards
      .filter(a => a.matched_wine_id)
      .map(a => a.matched_wine_id)
  )];

  // Build wine lookup map with single query
  const wineMap = new Map();
  if (matchedWineIds.length > 0) {
    const placeholders = matchedWineIds.map(() => '?').join(',');
    const wines = db.prepare(`
      SELECT id, wine_name, vintage FROM wines WHERE id IN (${placeholders})
    `).all(...matchedWineIds);
    wines.forEach(w => wineMap.set(w.id, w));
  }

  return awards.map(award => {
    if (award.matched_wine_id) {
      const wine = wineMap.get(award.matched_wine_id);
      return {
        ...award,
        matched_wine_name: wine?.wine_name || null,
        matched_vintage: wine?.vintage || null
      };
    }
    return { ...award, matched_wine_name: null, matched_vintage: null };
  });
}

/**
 * Delete an award source and its awards.
 * @param {string} sourceId - Source ID
 * @returns {boolean} Success
 */
export function deleteSource(sourceId) {
  awardsDb.prepare('DELETE FROM competition_awards WHERE source_id = ?').run(sourceId);
  const result = awardsDb.prepare('DELETE FROM award_sources WHERE id = ?').run(sourceId);
  return result.changes > 0;
}

/**
 * Get all known competitions.
 * @returns {Object[]} Competitions
 */
export function getKnownCompetitions() {
  return awardsDb.prepare(`
    SELECT * FROM known_competitions ORDER BY name
  `).all();
}

/**
 * Add a custom competition.
 * Note: This function uses synchronous DB calls. For PostgreSQL deployments,
 * the entire awards.js needs async conversion (see ROADMAP.md Sprint 2 extension).
 * @param {Object} competition - Competition data
 * @returns {Promise<string>} Competition ID
 */
export async function addCompetition(competition) {
  const id = competition.id || competition.name.toLowerCase().replaceAll(/\s+/g, '_');

  if (isPostgres()) {
    await awardsDb.prepare(`
      INSERT INTO known_competitions (id, name, short_name, country, scope, website, award_types, credibility, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        short_name = EXCLUDED.short_name,
        country = EXCLUDED.country,
        scope = EXCLUDED.scope,
        website = EXCLUDED.website,
        award_types = EXCLUDED.award_types,
        credibility = EXCLUDED.credibility,
        notes = EXCLUDED.notes
    `).run(
      id,
      competition.name,
      competition.short_name || null,
      competition.country || null,
      competition.scope || 'regional',
      competition.website || null,
      competition.award_types ? JSON.stringify(competition.award_types) : null,
      competition.credibility || 0.85,
      competition.notes || null
    );
  } else {
    awardsDb.prepare(`
      INSERT OR REPLACE INTO known_competitions (id, name, short_name, country, scope, website, award_types, credibility, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      competition.name,
      competition.short_name || null,
      competition.country || null,
      competition.scope || 'regional',
      competition.website || null,
      competition.award_types ? JSON.stringify(competition.award_types) : null,
      competition.credibility || 0.85,
      competition.notes || null
    );
  }

  return id;
}
