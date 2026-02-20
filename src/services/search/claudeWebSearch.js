/**
 * @fileoverview Tier 2 Claude Web Search with Dynamic Filtering.
 * Uses Anthropic's web_search and web_fetch tools (2026-02-09 beta)
 * to search, fetch, and extract wine ratings in a single API call.
 *
 * Replaces Gemini Hybrid (Tier 2) — eliminates GEMINI_API_KEY dependency.
 *
 * @module services/search/claudeWebSearch
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask } from '../../config/aiModels.js';
import logger from '../../utils/logger.js';
import { getSourcesForCountry } from '../../config/unifiedSources.js';

/** Beta header required for web search tools */
const WEB_TOOLS_BETA = 'code-execution-web-tools-2026-02-09';

/**
 * Check if Claude Web Search is available.
 * Requires ANTHROPIC_API_KEY (no additional keys needed).
 * @returns {boolean}
 */
export function isClaudeWebSearchAvailable() {
  return !!anthropic;
}

/**
 * Get priority critics for a wine's country of origin.
 * @param {string} country - Wine's country of origin
 * @returns {string} Comma-separated critic names
 */
function getCriticList(country) {
  if (!country) return 'Wine Spectator, Wine Enthusiast, Decanter, James Suckling, Tim Atkin';

  const sources = getSourcesForCountry(country);
  const critics = sources
    .filter(s => s.relevance >= 0.3 && s.lens === 'critics')
    .slice(0, 5)
    .map(s => s.name);

  return critics.length > 0
    ? critics.join(', ')
    : 'Wine Spectator, Wine Enthusiast, Decanter, James Suckling, Tim Atkin';
}

/**
 * Get priority competitions for a wine's country of origin.
 * @param {string} country - Wine's country of origin
 * @returns {string} Comma-separated competition names
 */
function getCompetitionList(country) {
  if (!country) return 'IWC, IWSC, Decanter World Wine Awards';

  const sources = getSourcesForCountry(country);
  const competitions = sources
    .filter(s => s.relevance >= 0.3 && s.lens === 'competition')
    .slice(0, 5)
    .map(s => s.name);

  return competitions.length > 0
    ? competitions.join(', ')
    : 'IWC, IWSC, Decanter World Wine Awards';
}

/**
 * Search for wine ratings using Claude's native web search with dynamic filtering.
 * Single API call replaces Gemini search + Claude extraction pipeline.
 *
 * @param {Object} wine - Wine object with name, vintage, producer, country, colour
 * @returns {Promise<Object|null>} Structured wine data with ratings, or null on failure
 */
export async function claudeWebSearch(wine) {
  if (!anthropic) {
    logger.warn('ClaudeWebSearch', 'ANTHROPIC_API_KEY not configured');
    return null;
  }

  const wineName = wine.wine_name || wine.name;
  const vintage = wine.vintage || 'NV';
  const producer = wine.producer || '';
  const country = wine.country || '';
  const colour = wine.colour || 'Unknown';

  const criticList = getCriticList(country);
  const competitionList = getCompetitionList(country);
  const countryHint = country ? ` This is a ${country} wine.` : '';

  logger.info('ClaudeWebSearch', `Starting web search for: ${wineName} ${vintage}`);
  const startTime = Date.now();

  try {
    const modelId = getModelForTask('webSearch');

    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: 16000,
      tools: [
        { type: 'web_search_20260209', name: 'web_search' },
        { type: 'web_fetch_20260209', name: 'web_fetch' }
      ],
      messages: [{
        role: 'user',
        content: `Find wine ratings and reviews for: ${producer ? producer + ' ' : ''}${wineName} ${vintage}${countryHint}

Search for ratings from these priority sources:
- Critics: ${criticList}
- Competitions: ${competitionList}
- Community: Vivino, CellarTracker

Return ONLY valid JSON (no markdown, no explanation):
{
  "ratings": [{"source":"", "source_lens":"competition|critics|community", "score_type":"points|stars|medal", "raw_score":"", "raw_score_numeric":null, "reviewer_name":"", "tasting_notes":"", "vintage_match":"exact|inferred|non_vintage", "confidence":"high|medium|low", "source_url":""}],
  "tasting_notes": {"nose":[], "palate":[], "structure":{"body":"", "tannins":"", "acidity":""}, "finish":""},
  "drinking_window": {"drink_from":null, "drink_by":null, "peak":null, "recommendation":""},
  "food_pairings": [],
  "style_summary": "",
  "grape_varieties": ["Grape1", "Grape2"]
}

CRITICAL RULES:
- Only ${vintage} vintage ratings (not other vintages)
- Wine colour: ${colour}
- Empty array/null for missing data
- raw_score_numeric must be a number or null
- source_url must be a real URL from the search results
- grape_varieties: extract the grape/variety names for this wine (e.g. ["Cabernet Sauvignon", "Merlot"]). Check Vivino, CellarTracker, critic pages. Empty array if not found.`
      }]
    }, {
      headers: { 'anthropic-beta': WEB_TOOLS_BETA }
    });

    const duration = Date.now() - startTime;

    // Extract text from response (skip tool_use and web_search_tool_result blocks)
    const textBlock = message.content?.find(b => b.type === 'text');
    const responseText = textBlock?.text || '';

    if (!responseText) {
      const stopReason = message.stop_reason || 'unknown';
      logger.warn('ClaudeWebSearch', `No text in response after ${duration}ms (${message.content?.length || 0} content blocks, stop_reason: ${stopReason})`);
      return null;
    }

    logger.info('ClaudeWebSearch', `Got response in ${duration}ms, ${responseText.length} chars`);

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('ClaudeWebSearch', 'Could not extract JSON from response');
      return null;
    }

    let extracted;
    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      // Attempt repair for truncated JSON
      logger.warn('ClaudeWebSearch', `JSON parse failed, attempting repair: ${parseErr.message}`);
      try {
        extracted = JSON.parse(repairJson(jsonMatch[0]));
        logger.info('ClaudeWebSearch', 'JSON repair successful');
      } catch {
        logger.error('ClaudeWebSearch', 'JSON repair failed');
        return null;
      }
    }

    // Collect source URLs from web search result blocks for provenance
    const sourceUrls = [];
    for (const block of message.content || []) {
      if (block.type === 'web_search_tool_result') {
        for (const result of block.content || []) {
          if (result.type === 'web_search_result' && result.url) {
            sourceUrls.push({ url: result.url, title: result.title || '' });
          }
        }
      }
    }

    extracted._metadata = {
      method: 'claude_web_search',
      model: modelId,
      sources_count: sourceUrls.length,
      duration_ms: duration,
      extracted_at: new Date().toISOString()
    };
    extracted._sources = sourceUrls;

    logger.info('ClaudeWebSearch', `Extracted ${extracted.ratings?.length || 0} ratings from ${sourceUrls.length} sources in ${duration}ms`);

    return extracted;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('ClaudeWebSearch', `Search failed after ${duration}ms: ${error.message}`);
    return null;
  }
}

/**
 * Attempt to repair truncated JSON from max_tokens cutoff.
 * @param {string} jsonStr - Potentially malformed JSON
 * @returns {string} Repaired JSON
 */
function repairJson(jsonStr) {
  let repaired = jsonStr.trim();

  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  // Remove trailing incomplete values
  repaired = repaired.replace(/,\s*"[^"]*$/, '');
  repaired = repaired.replace(/:\s*"[^"]*$/, ': null');
  repaired = repaired.replace(/:\s*[\d.]+$/, ': null');
  repaired = repaired.replace(/,\s*$/, '');

  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  return repaired;
}

export default {
  claudeWebSearch,
  isClaudeWebSearchAvailable
};
