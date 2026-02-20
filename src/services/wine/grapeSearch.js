/**
 * @fileoverview Web search for grape varieties using Claude Web Search.
 * Lightweight search focused purely on discovering grape/variety info for wines.
 * Used by the "Identify" grape flow when pattern matching fails.
 * @module services/wine/grapeSearch
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask } from '../../config/aiModels.js';
import logger from '../../utils/logger.js';

/** Beta header required for web search tools */
const WEB_TOOLS_BETA = 'code-execution-web-tools-2026-02-09';

/**
 * Search for grape varieties of a single wine using Claude Web Search.
 * @param {Object} wine - Wine object from DB
 * @param {string} wine.wine_name - Wine name
 * @param {number|string} [wine.vintage] - Vintage year
 * @param {string} [wine.producer] - Producer name
 * @param {string} [wine.region] - Wine region
 * @param {string} [wine.country] - Country of origin
 * @returns {Promise<string[]>} Array of grape variety names, empty if not found
 */
export async function searchGrapeVarieties(wine) {
  if (!anthropic) {
    logger.warn('GrapeSearch', 'ANTHROPIC_API_KEY not configured');
    return [];
  }

  const wineName = wine.wine_name || '';
  const vintage = wine.vintage || '';
  const producer = wine.producer || '';
  const region = wine.region || '';
  const country = wine.country || '';

  const wineDesc = [producer, wineName, vintage].filter(Boolean).join(' ');
  const locationHint = [region, country].filter(Boolean).join(', ');

  logger.info('GrapeSearch', `Searching grapes for: ${wineDesc}`);
  const startTime = Date.now();

  try {
    const modelId = getModelForTask('webSearch');

    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: 8192,
      tools: [
        { type: 'web_search_20260209', name: 'web_search' }
      ],
      messages: [{
        role: 'user',
        content: `What grape varieties are used to make: ${wineDesc}${locationHint ? ` (${locationHint})` : ''}

Search Vivino, CellarTracker, Wine-Searcher, or the winery's own website.

Return ONLY valid JSON (no markdown, no explanation):
{"grape_varieties": ["Grape1", "Grape2"]}

Rules:
- Return the full grape variety names (e.g. "Cabernet Sauvignon" not "Cab Sauv")
- Empty array if grape varieties cannot be determined
- Do NOT guess — only return grapes confirmed by a source`
      }]
    }, {
      headers: { 'anthropic-beta': WEB_TOOLS_BETA }
    });

    const duration = Date.now() - startTime;

    // Extract text from response — skip tool_use and web_search_tool_result blocks
    // (matches the pattern used in claudeWebSearch.js which works reliably)
    const textBlock = message.content?.find(b => b.type === 'text');
    const responseText = textBlock?.text || '';

    if (!responseText) {
      const blockTypes = (message.content || []).map(b => b.type).join(', ');
      logger.warn('GrapeSearch', `No text in response after ${duration}ms (blocks: ${blockTypes}, stop: ${message.stop_reason})`);
      return [];
    }

    const jsonMatch = responseText.match(/\{[\s\S]*"grape_varieties"[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('GrapeSearch', `No JSON found in response for ${wineDesc}`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const grapes = Array.isArray(parsed.grape_varieties) ? parsed.grape_varieties : [];

    // Filter out non-string entries and trim
    const cleaned = grapes
      .filter(g => typeof g === 'string' && g.trim().length > 0)
      .map(g => g.trim());

    logger.info('GrapeSearch', `Found ${cleaned.length} grapes for ${wineDesc} in ${duration}ms: ${cleaned.join(', ') || 'none'}`);
    return cleaned;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('GrapeSearch', `Search failed for ${wineDesc} after ${duration}ms: ${error.message}`);
    return [];
  }
}

/**
 * Batch search for grape varieties of multiple wines with controlled concurrency.
 * @param {Object[]} wines - Array of wine objects from DB
 * @param {Object} [options]
 * @param {number} [options.concurrency=3] - Max concurrent web searches
 * @param {function} [options.onProgress] - Progress callback (completed, total)
 * @returns {Promise<Object[]>} Array of { wineId, wine_name, grapes, source }
 */
export async function batchSearchGrapeVarieties(wines, { concurrency = 3, onProgress } = {}) {
  const results = [];

  for (let i = 0; i < wines.length; i += concurrency) {
    const batch = wines.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (wine) => {
        const grapes = await searchGrapeVarieties(wine);
        return {
          wineId: wine.id,
          wine_name: wine.wine_name,
          grapes: grapes.length > 0 ? grapes.join(', ') : null,
          grape_list: grapes,
          source: 'web_search'
        };
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      }
    }

    const completed = Math.min(i + concurrency, wines.length);
    if (onProgress) onProgress(completed, wines.length);
  }

  return results;
}
