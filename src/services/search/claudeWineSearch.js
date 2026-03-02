/**
 * @fileoverview Unified Claude Wine Search.
 * Single API call returns both structured JSON (ratings, entities, drinking windows)
 * and rich prose narrative via Anthropic's web_search + web_fetch tools.
 *
 * Replaces the 4-tier waterfall (SERP AI → Claude Web Search → Gemini → Legacy Scraping).
 * Eliminates BrightData, Gemini, and all scraping dependencies.
 *
 * @module services/search/claudeWineSearch
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask } from '../../config/aiModels.js';
import logger from '../../utils/logger.js';
import { getSourcesForCountry } from '../../config/unifiedSources.js';
import { extractJsonWithRepair } from '../shared/jsonUtils.js';

/** Maximum pause_turn continuations before giving up */
const MAX_PAUSE_CONTINUATIONS = 2;

/** Per-request timeout for wine search API calls (ms) */
const SEARCH_TIMEOUT_MS = 90_000;

/** System prompt requesting both narrative and structured output */
const SYSTEM_PROMPT = `You are a comprehensive wine research assistant. For the requested wine, search the web to build a complete profile covering:

1. **Producer**: Background, estate history, winemaking philosophy, regional reputation
2. **Terroir**: Climate, soil, appellation characteristics
3. **Grape varieties**: Blend composition, varietal characteristics
4. **Winemaking**: Viticulture, fermentation, maturation methods
5. **Tasting Notes**: Appearance, nose, palate, structure, finish
6. **Food Pairings**: Recommended dishes and cuisines
7. **Critical Reception**: Ratings and reviews with exact scores from critics, competitions, and community
8. **Drinking Window**: Current drinkability, peak window, aging potential
9. **Awards**: Competition medals with year and category

Include inline citations for all factual claims. After your narrative, call the save_wine_profile tool with all structured data extracted. Never include markdown code fences in your output.`;

/** Tool definition for structured JSON output via tool_use */
const SAVE_WINE_PROFILE_TOOL = {
  name: 'save_wine_profile',
  description: 'Save the complete wine profile as structured JSON, including all ratings, tasting notes, drinking window, and wine metadata found during research.',
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
            source_url: { type: 'string' },
            competition_year: { type: ['integer', 'null'] },
            rating_count: { type: ['integer', 'null'] }
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
      grape_varieties: { type: 'array', items: { type: 'string' } },
      producer_info: {
        type: ['object', 'null'],
        properties: {
          name: { type: 'string' },
          region: { type: 'string' },
          country: { type: 'string' },
          description: { type: 'string' }
        }
      },
      awards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            competition: { type: 'string' },
            year: { type: ['integer', 'null'] },
            award: { type: 'string' },
            category: { type: 'string' }
          }
        }
      }
    },
    required: ['ratings']
  }
};

/**
 * Check if unified wine search is available.
 * Requires ANTHROPIC_API_KEY (no additional keys needed).
 * @returns {boolean}
 */
export function isUnifiedWineSearchAvailable() {
  return !!anthropic;
}

/**
 * Build a structured error payload for callers that opt in to detailed errors.
 * @param {string} code - Stable error code for programmatic handling.
 * @param {string} userMessage - Safe user-facing message.
 * @param {Object} [details] - Internal diagnostics.
 * @returns {{_error: {code: string, userMessage: string, details: Object}}}
 */
function buildSearchError(code, userMessage, details = {}) {
  return {
    _error: {
      code,
      userMessage,
      details
    }
  };
}

/**
 * Format a source with its score type for prompt injection.
 * @param {Object} source - Source config from unifiedSources.js
 * @returns {string} e.g. "Tim Atkin (points/100)" or "Veritas Awards (medal)"
 */
function formatSourceLabel(source) {
  if (!source.score_type || source.score_type === 'medal') {
    return `${source.name} (medal)`;
  }
  if (source.score_type === 'stars' && source.score_scale) {
    return `${source.name} (stars/${source.score_scale})`;
  }
  if (source.score_type === 'points' && source.score_scale) {
    return `${source.name} (points/${source.score_scale})`;
  }
  return source.name;
}

/**
 * Build country-specific source injection block for the search prompt.
 * Separates local (country-specific) sources from global ones using home_regions.
 * Falls back to sane defaults for unknown countries.
 *
 * @param {string} country - Wine's country of origin
 * @returns {string} Formatted multi-line source injection block
 */
function buildSourceInjection(country) {
  if (!country) {
    return [
      'Competitions: Decanter World Wine Awards (medal), IWC (medal), IWSC (medal), Concours Mondial (medal)',
      'Critics: Wine Spectator (points/100), Wine Enthusiast (points/100), James Suckling (points/100), Tim Atkin (points/100)',
      'Community: Vivino (stars/5), CellarTracker (points/100)'
    ].join('\n');
  }

  const sources = getSourcesForCountry(country);

  // Local = sources with explicit home_regions that include this country
  const localCompetitions = sources
    .filter(s => s.home_regions?.length > 0 && s.home_regions.includes(country) && s.lens === 'competition')
    .slice(0, 4)
    .map(formatSourceLabel);

  const localCritics = sources
    .filter(s => s.home_regions?.length > 0 && s.home_regions.includes(country) && (s.lens === 'critic' || s.lens === 'panel_guide'))
    .slice(0, 4)
    .map(formatSourceLabel);

  // Global = sources with empty home_regions (available everywhere)
  const globalCompetitions = sources
    .filter(s => (s.home_regions?.length ?? 1) === 0 && s.lens === 'competition' && s.credibility >= 0.9)
    .slice(0, 4)
    .map(s => formatSourceLabel(s));

  const globalCritics = sources
    .filter(s => (s.home_regions?.length ?? 1) === 0 && (s.lens === 'critic' || s.lens === 'panel_guide') && s.credibility >= 0.7)
    .slice(0, 3)
    .map(s => formatSourceLabel(s));

  const lines = [];

  if (localCompetitions.length > 0) {
    lines.push(`Local competitions: ${localCompetitions.join(', ')}`);
  }
  if (localCritics.length > 0) {
    lines.push(`Local critics: ${localCritics.join(', ')}`);
  }

  const intlCompetitions = globalCompetitions.length > 0
    ? globalCompetitions.join(', ')
    : 'Decanter World Wine Awards (medal), IWC (medal), IWSC (medal)';
  lines.push(`International competitions: ${intlCompetitions}`);

  const intlCritics = globalCritics.length > 0
    ? globalCritics.join(', ')
    : 'Wine Spectator (points/100), Wine Enthusiast (points/100), James Suckling (points/100)';
  lines.push(`International critics: ${intlCritics}`);

  lines.push('Community: Vivino (stars/5), CellarTracker (points/100)');

  return lines.join('\n');
}

/**
 * Extract prose narrative from response content.
 * Uses SERT preamble-filtering pattern: only includes text blocks
 * that appear AFTER the last web_search_tool_result block,
 * excluding any preamble Claude emits before/between searches.
 *
 * @param {Array} content - Response content blocks
 * @returns {string} Filtered prose narrative
 */
export function extractNarrative(content) {
  if (!content?.length) return '';

  // Find index of last web_search_tool_result block
  let lastSearchResultIdx = -1;
  for (let i = 0; i < content.length; i++) {
    if (content[i].type === 'web_search_tool_result') {
      lastSearchResultIdx = i;
    }
  }

  // Collect text blocks after the last search result (startIdx = 0 if no search results)
  const startIdx = lastSearchResultIdx + 1;
  const textBlocks = content
    .slice(startIdx)
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .filter(t => t.trim().length > 0);

  return textBlocks.join('\n\n');
}

/**
 * Extract source URLs from all web_search_tool_result blocks.
 * @param {Array} content - Response content blocks
 * @returns {Array<{url: string, title: string}>}
 */
export function extractSourceUrls(content) {
  const urls = [];
  for (const block of content || []) {
    if (block.type === 'web_search_tool_result') {
      for (const result of block.content || []) {
        if (result.type === 'web_search_result' && result.url) {
          urls.push({ url: result.url, title: result.title || '' });
        }
      }
    }
  }
  return urls;
}

/**
 * Extract inline citation URLs from text blocks.
 * Claude's web search tools emit citation metadata on text blocks.
 * @param {Array} content - Response content blocks
 * @returns {string[]} Array of cited URLs
 */
export function extractCitations(content) {
  const citations = [];
  for (const block of content || []) {
    // Claude attaches citations array to text blocks
    if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const citation of block.citations) {
        if (citation.url) citations.push(citation.url);
      }
    }
    // Standalone citation location blocks
    if (block.type === 'web_search_result_location' && block.url) {
      citations.push(block.url);
    }
  }
  return citations;
}

/**
 * Search for wine data using Claude's native web search.
 * Returns both structured ratings JSON and rich prose narrative in a single API call.
 *
 * Response parsing strategy (SERT preamble-filtering pattern):
 * 1. Find last web_search_tool_result block index
 * 2. Collect text blocks AFTER that index → prose narrative
 * 3. Extract tool_use block (save_wine_profile) → structured JSON
 * 4. Extract source URLs from all web_search_tool_result blocks → citation list
 * 5. Fallback: extractJsonWithRepair() on prose if no tool_use block
 *
 * @param {Object} wine - Wine object with name, vintage, producer, country, colour, etc.
 * @param {Object} [options] - Optional behavior flags.
 * @param {boolean} [options.includeErrors=false] - Return structured _error object instead of null.
 * @returns {Promise<Object|null>} Structured wine data (or _error when includeErrors=true), or null on failure
 */
export async function unifiedWineSearch(wine, options = {}) {
  const { includeErrors = false } = options;

  if (!anthropic) {
    logger.warn('UnifiedWineSearch', 'ANTHROPIC_API_KEY not configured');
    if (includeErrors) {
      return buildSearchError(
        'missing_api_key',
        'Wine search is unavailable because the Anthropic API key is not configured.',
        { dependency: 'ANTHROPIC_API_KEY' }
      );
    }
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

  const sourceInjection = buildSourceInjection(country);
  const countryHint = country ? ` This is a ${country} wine.` : '';
  const profileLine = (style || grapes || region)
    ? `\nWine profile: ${[style, grapes, region, country].filter(Boolean).join(' · ')}`
    : '';
  const profileInstruction = (style || grapes || region)
    ? '\nUse this profile to verify results match the correct wine. Do NOT add these terms to your web search queries.'
    : '';

  logger.info('UnifiedWineSearch', `Starting search for: ${wineName} ${vintage}`);
  const startTime = Date.now();

  try {
    const modelId = getModelForTask('webSearch');

    const userPrompt = `Research this wine comprehensively: ${producer ? producer + ' ' : ''}${wineName} ${vintage}${countryHint}${profileLine}${profileInstruction}

Search for information from these priority sources:
${sourceInjection}

After your research narrative, call the save_wine_profile tool with all structured data.

CRITICAL RULES:
- Only ${vintage} vintage ratings (not other vintages)
- Wine colour: ${colour}${style ? `\n- Style: ${style}` : ''}${grapes ? `\n- Grapes: ${grapes}` : ''}${region ? `\n- Region: ${region}` : ''}
- Empty array/null for missing data
- raw_score_numeric must be a number or null
- source_url must be a real URL from your search results
- grape_varieties: extract grape/variety names (e.g. ["Cabernet Sauvignon", "Merlot"])
- awards: list competition medals with year and category`;

    const apiParams = {
      model: modelId,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
        SAVE_WINE_PROFILE_TOOL
      ],
      messages: [{ role: 'user', content: userPrompt }]
    };

    let message = await anthropic.messages.create(apiParams, { timeout: SEARCH_TIMEOUT_MS });
    let allContent = [...(message.content || [])];

    // Handle pause_turn: server tool loop hit iteration limit — resume conversation
    let continuations = 0;
    while (message.stop_reason === 'pause_turn' && continuations < MAX_PAUSE_CONTINUATIONS) {
      continuations++;
      logger.info('UnifiedWineSearch', `pause_turn after ${Date.now() - startTime}ms (${continuations}/${MAX_PAUSE_CONTINUATIONS}), resuming…`);
      apiParams.messages = [
        ...apiParams.messages,
        { role: 'assistant', content: message.content },
        { role: 'user', content: 'Continue and call the save_wine_profile tool with all data found.' }
      ];
      message = await anthropic.messages.create(apiParams, { timeout: SEARCH_TIMEOUT_MS });
      allContent.push(...(message.content || []));
    }

    const duration = Date.now() - startTime;
    const content = allContent;

    // Strategy 1: Extract from save_wine_profile tool_use block (deterministic JSON)
    const toolUseBlock = content.find(
      b => b.type === 'tool_use' && b.name === 'save_wine_profile'
    );

    let extracted;
    if (toolUseBlock?.input) {
      extracted = toolUseBlock.input;
      logger.info('UnifiedWineSearch', `Got structured tool_use response in ${duration}ms`);
    } else {
      // Strategy 2: Fall back to text extraction with repair (SERT preamble-filtered)
      const narrative = extractNarrative(content);
      if (!narrative) {
        const stopReason = message.stop_reason || 'unknown';
        const blockTypes = content.map(b => b.type).join(', ') || 'empty';
        logger.warn('UnifiedWineSearch', `No text or tool_use in response for "${wineName}" after ${duration}ms (stop_reason: ${stopReason}, blocks: [${blockTypes}])`);
        if (includeErrors) {
          return buildSearchError(
            'empty_response',
            'Wine search returned an empty response. Please try again.',
            { wineName, duration, stopReason, blockTypes }
          );
        }
        return null;
      }

      logger.info('UnifiedWineSearch', `Falling back to text extraction in ${duration}ms, ${narrative.length} chars`);
      try {
        extracted = extractJsonWithRepair(narrative);
      } catch (parseErr) {
        logger.error('UnifiedWineSearch', `JSON extraction failed: ${parseErr.message}`);
        if (includeErrors) {
          return buildSearchError(
            'parse_failure',
            'Wine search returned data, but it could not be parsed. Please try again.',
            { wineName, duration, message: parseErr.message }
          );
        }
        return null;
      }
    }

    // Extract prose narrative (always — even when tool_use is present, narrative is valuable)
    const narrative = extractNarrative(content);

    // Collect source URLs for provenance
    const sourceUrls = extractSourceUrls(content);

    // Collect inline citations for frequency scoring by callers
    const citations = extractCitations(content);

    extracted._metadata = {
      method: 'unified_claude_search',
      model: modelId,
      sources_count: sourceUrls.length,
      citation_count: citations.length,
      duration_ms: duration,
      extracted_at: new Date().toISOString()
    };
    extracted._sources = sourceUrls;
    extracted._citations = citations;
    extracted._narrative = narrative;

    logger.info('UnifiedWineSearch', `Extracted ${extracted.ratings?.length || 0} ratings from ${sourceUrls.length} sources in ${duration}ms`);

    return extracted;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('UnifiedWineSearch', `Search failed for "${wineName}" after ${duration}ms: ${error.message}`);
    if (includeErrors) {
      const message = String(error?.message || '').toLowerCase();
      const isTimeout = message.includes('timeout') || message.includes('timed out') || message.includes('etimedout');
      return buildSearchError(
        isTimeout ? 'timeout' : 'api_error',
        isTimeout
          ? 'Wine search timed out. Please try again.'
          : 'Wine search failed due to an upstream API error. Please try again.',
        {
          wineName,
          duration,
          status: error?.status,
          type: error?.type,
          message: error?.message
        }
      );
    }
    return null;
  }
}

export default {
  unifiedWineSearch,
  isUnifiedWineSearchAvailable
};
