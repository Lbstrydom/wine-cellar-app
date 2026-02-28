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
import { extractJsonWithRepair } from '../shared/jsonUtils.js';

/** Beta header required for web search tools */
const WEB_TOOLS_BETA = 'code-execution-web-tools-2026-02-09';

/** System prompt for focused wine data extraction */
const SYSTEM_PROMPT = 'You are a wine data extraction assistant. Search the web for wine ratings and reviews, then save the structured results using the save_wine_ratings tool. Never include markdown formatting in your output.';

/** Tool definition for structured JSON output via tool_use */
const SAVE_WINE_RATINGS_TOOL = {
  name: 'save_wine_ratings',
  description: 'Save the extracted wine ratings and review data as structured JSON.',
  input_schema: {
    type: 'object',
    properties: {
      ratings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            source_lens: { type: 'string', enum: ['competition', 'critics', 'community'] },
            score_type: { type: 'string', enum: ['points', 'stars', 'medal'] },
            raw_score: { type: 'string' },
            raw_score_numeric: { type: ['number', 'null'] },
            reviewer_name: { type: 'string' },
            tasting_notes: { type: 'string' },
            vintage_match: { type: 'string', enum: ['exact', 'inferred', 'non_vintage'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            source_url: { type: 'string' }
          },
          required: ['source', 'raw_score']
        }
      },
      tasting_notes: {
        type: ['object', 'null'],
        properties: {
          nose: { type: 'array', items: { type: 'string' } },
          palate: { type: 'array', items: { type: 'string' } },
          structure: {
            type: 'object',
            properties: {
              body: { type: 'string' },
              tannins: { type: 'string' },
              acidity: { type: 'string' }
            }
          },
          finish: { type: 'string' }
        }
      },
      drinking_window: {
        type: ['object', 'null'],
        properties: {
          drink_from: { type: ['integer', 'null'] },
          drink_by: { type: ['integer', 'null'] },
          peak: { type: ['integer', 'null'] },
          recommendation: { type: 'string' }
        }
      },
      food_pairings: { type: 'array', items: { type: 'string' } },
      style_summary: { type: 'string' },
      grape_varieties: { type: 'array', items: { type: 'string' } }
    },
    required: ['ratings']
  }
};

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

  // Sanitize profile fields — truncate and strip control chars for prompt safety
  const sanitize = (s, max = 100) => (s || '').replace(/[\n\r\t]/g, ' ').substring(0, max).trim();
  const style = sanitize(wine.style);
  const grapes = sanitize(wine.grapes);
  const region = sanitize(wine.region);

  const criticList = getCriticList(country);
  const competitionList = getCompetitionList(country);
  const countryHint = country ? ` This is a ${country} wine.` : '';
  const profileLine = (style || grapes || region)
    ? `\nWine profile: ${[style, grapes, region, country].filter(Boolean).join(' · ')}`
    : '';
  const profileInstruction = (style || grapes || region)
    ? '\nUse this profile to verify results match the correct wine. Do NOT add these terms to your web search queries.'
    : '';

  logger.info('ClaudeWebSearch', `Starting web search for: ${wineName} ${vintage}`);
  const startTime = Date.now();

  try {
    const modelId = getModelForTask('webSearch');

    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [
        { type: 'web_search_20260209', name: 'web_search' },
        { type: 'web_fetch_20260209', name: 'web_fetch' },
        SAVE_WINE_RATINGS_TOOL
      ],
      messages: [{
        role: 'user',
        content: `Find wine ratings and reviews for: ${producer ? producer + ' ' : ''}${wineName} ${vintage}${countryHint}${profileLine}${profileInstruction}

Search for ratings from these priority sources:
- Critics: ${criticList}
- Competitions: ${competitionList}
- Community: Vivino, CellarTracker

After searching, call the save_wine_ratings tool with the structured results.

CRITICAL RULES:
- Only ${vintage} vintage ratings (not other vintages)
- Wine colour: ${colour}${style ? `\n- Style: ${style}` : ''}${grapes ? `\n- Grapes: ${grapes}` : ''}${region ? `\n- Region: ${region}` : ''}
- Empty array/null for missing data
- raw_score_numeric must be a number or null
- source_url must be a real URL from the search results
- grape_varieties: extract the grape/variety names for this wine (e.g. ["Cabernet Sauvignon", "Merlot"]). Check Vivino, CellarTracker, critic pages. Empty array if not found.`
      }]
    }, {
      headers: { 'anthropic-beta': WEB_TOOLS_BETA }
    });

    const duration = Date.now() - startTime;

    // Strategy 1: Extract from save_wine_ratings tool_use block (deterministic JSON)
    const toolUseBlock = message.content?.find(
      b => b.type === 'tool_use' && b.name === 'save_wine_ratings'
    );

    let extracted;
    if (toolUseBlock?.input) {
      extracted = toolUseBlock.input;
      logger.info('ClaudeWebSearch', `Got structured tool_use response in ${duration}ms`);
    } else {
      // Strategy 2: Fall back to text extraction with repair
      const textBlock = message.content?.find(b => b.type === 'text');
      const responseText = textBlock?.text || '';

      if (!responseText) {
        const stopReason = message.stop_reason || 'unknown';
        logger.warn('ClaudeWebSearch', `No text or tool_use in response after ${duration}ms (${message.content?.length || 0} content blocks, stop_reason: ${stopReason})`);
        return null;
      }

      logger.info('ClaudeWebSearch', `Falling back to text extraction in ${duration}ms, ${responseText.length} chars`);

      try {
        extracted = extractJsonWithRepair(responseText);
      } catch (parseErr) {
        logger.error('ClaudeWebSearch', `JSON extraction failed: ${parseErr.message}`);
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

export default {
  claudeWebSearch,
  isClaudeWebSearchAvailable
};
