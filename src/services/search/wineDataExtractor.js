/**
 * @fileoverview Wine Data Extractor — Phase 2 of the two-phase search pipeline.
 *
 * Takes a prose research narrative (from Phase 1 web search) and extracts
 * structured JSON data using a fast, cheap Haiku model call.
 *
 * Responsibilities:
 * - Extract structured wine data (ratings, tasting notes, awards, etc.) from narrative text
 * - Resolve citation numbers to real source URLs via the SOURCE REFERENCE block
 * - Normalize output types to guarantee consumer contracts (arrays, objects, strings)
 * - Truncate oversized narratives to fit within model context limits
 *
 * This module is intentionally decoupled from Phase 1 (web search) to maintain
 * single responsibility: Phase 1 handles web search + streaming, this module
 * handles text → structured JSON extraction.
 *
 * @module services/search/wineDataExtractor
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask } from '../../config/aiModels.js';
import { extractText } from '../ai/claudeResponseUtils.js';
import { extractJsonWithRepair } from '../shared/jsonUtils.js';
import logger from '../../utils/logger.js';

/** Maximum narrative characters to send to extraction.
 *  ~45K tokens — well within Haiku's 200K context window. */
export const MAX_NARRATIVE_CHARS = 180_000;

/**
 * Extraction system prompt — JSON schema lives here, sent to Haiku.
 * The SOURCE REFERENCE section in the user message maps citation numbers to real URLs.
 * @internal — exported for unit tests only
 */
export const EXTRACTION_SYSTEM_PROMPT = `Extract structured wine data from the research text below into a single JSON object.
Be precise — only include data explicitly stated in the text. Do not invent data.

Use the SOURCE REFERENCE section to resolve source URLs for ratings.
Each citation number [1], [2], etc. maps to a real URL listed there.

Output ONLY valid JSON (no markdown fences, no commentary):
{"ratings":[{"source":"...","source_lens":"competition|critics|community","score_type":"points|stars|medal","raw_score":"...","raw_score_numeric":null,"reviewer_name":"...","tasting_notes":"...","vintage_match":"exact|inferred|non_vintage","confidence":"high|medium|low","source_url":"...","competition_year":null,"rating_count":null}],"tasting_notes":{"nose":[],"palate":[],"structure":{"body":"","tannins":"","acidity":""},"finish":""},"drinking_window":{"drink_from":null,"drink_by":null,"peak":null,"recommendation":""},"food_pairings":[],"style_summary":"","grape_varieties":[],"producer_info":{"name":"","region":"","country":"","description":""},"awards":[{"competition":"","year":null,"award":"","category":""}]}

Rules:
- raw_score_numeric: number or null (e.g. "94/100" -> 94)
- source_url: resolve from the SOURCE REFERENCE section, or null
- Empty array [] for missing list data, null for missing scalar data
- No markdown code fences around the JSON`;

/**
 * Normalize extraction output to guarantee type safety for all consumers.
 * Ensures arrays are arrays, objects are objects or null, strings are strings.
 * Runs after extractJsonWithRepair() and before merging into the return object.
 *
 * @param {Object} parsed - Raw parsed JSON from extraction
 * @returns {Object} Normalized object with guaranteed types
 */
export function normalizeExtraction(parsed) {
  return {
    ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
    grape_varieties: Array.isArray(parsed.grape_varieties) ? parsed.grape_varieties : [],
    food_pairings: Array.isArray(parsed.food_pairings) ? parsed.food_pairings : [],
    awards: Array.isArray(parsed.awards) ? parsed.awards : [],
    tasting_notes: parsed.tasting_notes && typeof parsed.tasting_notes === 'object' && !Array.isArray(parsed.tasting_notes)
      ? parsed.tasting_notes : null,
    drinking_window: parsed.drinking_window && typeof parsed.drinking_window === 'object' && !Array.isArray(parsed.drinking_window)
      ? parsed.drinking_window : null,
    producer_info: parsed.producer_info && typeof parsed.producer_info === 'object' && !Array.isArray(parsed.producer_info)
      ? parsed.producer_info : null,
    style_summary: typeof parsed.style_summary === 'string' ? parsed.style_summary : ''
  };
}

/**
 * Extract structured wine data from a research narrative using Haiku.
 * Fast, non-streaming call with assistant prefill to force JSON output.
 *
 * This is Phase 2 of the two-phase pipeline:
 * - Phase 1 (claudeWineSearch.js) produces a prose narrative + source URLs
 * - This function converts that narrative into structured JSON
 *
 * @param {string} narrative - Prose narrative from Phase 1 web search
 * @param {Array<{url: string, title: string}>} sourceUrls - Source URLs for citation resolution
 * @param {Object} wine - Wine object for context (producer, name, vintage)
 * @returns {Promise<{extracted: Object, duration: number, modelId: string}>}
 * @throws {Error} On API or parsing failure
 */
export async function extractWineData(narrative, sourceUrls, wine) {
  const startTime = Date.now();

  // Build citation reference block so Haiku can map inline citations to real URLs
  const sourceRef = sourceUrls.length > 0
    ? '\n\nSOURCE REFERENCE:\n' + sourceUrls.map((s, i) => `[${i + 1}] ${s.url}`).join('\n')
    : '';

  // Truncate if narrative exceeds safe input size for Haiku
  let inputText = narrative;
  if (inputText.length > MAX_NARRATIVE_CHARS) {
    inputText = inputText.slice(0, MAX_NARRATIVE_CHARS) + '\n\n[TRUNCATED — remaining text omitted]';
    logger.warn('WineDataExtractor', `Narrative truncated from ${narrative.length} to ${MAX_NARRATIVE_CHARS} chars`);
  }

  const wineName = wine.wine_name || wine.name;
  const vintage = wine.vintage || 'NV';
  const producer = wine.producer || '';
  const userContent = `Wine: ${producer} ${wineName} ${vintage}\n\n${inputText}${sourceRef}`;

  const modelId = getModelForTask('wineExtraction');
  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 8192,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userContent },
      { role: 'assistant', content: '{' }  // Prefill to force immediate JSON
    ]
  });

  // extractText() returns the model's completion; prepend the prefill "{"
  const rawText = '{' + extractText(response);
  const extracted = extractJsonWithRepair(rawText);
  const duration = Date.now() - startTime;

  return { extracted, duration, modelId };
}
