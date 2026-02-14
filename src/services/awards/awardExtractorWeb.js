/**
 * @fileoverview Web page and text award extraction logic.
 * Handles extraction from URLs, raw text, and chunked text processing.
 * @module services/awards/awardExtractorWeb
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask, getThinkingConfig } from '../../config/aiModels.js';
import { extractStreamText } from '../ai/claudeResponseUtils.js';
import logger from '../../utils/logger.js';
import { fetchPageContent } from '../search/searchProviders.js';
import { buildExtractionPrompt, parseAwardsResponse } from './awardParser.js';

const MAX_TOKENS_TEXT = 32000;
const MAX_TOKENS_CHUNK = 32000;

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
  return parsed;
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
  const MAX_TEXT_CHARS = 50000;

  if (text.length > MAX_TEXT_CHARS) {
    logger.info('Awards', `Text too large (${text.length} chars), processing in chunks`);
    return await extractFromTextChunked(text, competitionId, year, MAX_TEXT_CHARS);
  }

  const prompt = buildExtractionPrompt(text, competitionId, year);
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
export async function extractFromTextChunked(text, competitionId, year, chunkSize) {
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
        const chunkModelId = getModelForTask('awardExtraction');

        const stream = await anthropic.messages.create({
          model: chunkModelId,
          max_tokens: currentMaxTokens,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          ...(getThinkingConfig('awardExtraction') || {})
        });

        const responseText = await extractStreamText(stream);
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
