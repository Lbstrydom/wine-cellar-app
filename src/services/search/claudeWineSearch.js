/**
 * @fileoverview Unified Claude Wine Search.
 * Single API call returns both structured JSON (ratings, entities, drinking windows)
 * and rich prose narrative via Anthropic's web_search + web_fetch tools.
 *
 * Uses SSE streaming to avoid SDK timeout issues — web search tool execution
 * can take 2-4 minutes server-side, which exceeds non-streaming timeouts.
 * Streaming keeps the connection alive as events flow continuously.
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

/** Safety abort timeout (ms) — 3 minutes. SERT reference completes searches in ~2 min;
 *  3 min provides headroom while catching genuine stalls much faster than the old 5 min. */
const STREAM_ABORT_TIMEOUT_MS = 180_000;

/** System prompt requesting both narrative and structured JSON output.
 *  Intentionally simple to match SERT reference — no custom tools, just web_search.
 *  Claude returns prose + JSON block at the end which we parse with extractJsonWithRepair(). */
const SYSTEM_PROMPT = `You are a comprehensive wine research assistant. Search the web to build a complete profile for the requested wine.

Cover these areas in your narrative:
1. Producer background and regional reputation
2. Grape varieties and blend composition
3. Tasting notes (nose, palate, structure, finish)
4. Critical reception — exact scores from critics, competitions, and community sites
5. Drinking window and aging potential
6. Food pairings
7. Awards and competition medals

Include inline citations for all factual claims.

After your narrative, output a single JSON object (no markdown code fences) with this structure:
{"ratings":[{"source":"...","source_lens":"competition|critics|community","score_type":"points|stars|medal","raw_score":"...","raw_score_numeric":null,"reviewer_name":"...","tasting_notes":"...","vintage_match":"exact|inferred|non_vintage","confidence":"high|medium|low","source_url":"...","competition_year":null,"rating_count":null}],"tasting_notes":{"nose":[],"palate":[],"structure":{"body":"","tannins":"","acidity":""},"finish":""},"drinking_window":{"drink_from":null,"drink_by":null,"peak":null,"recommendation":""},"food_pairings":[],"style_summary":"","grape_varieties":[],"producer_info":{"name":"","region":"","country":"","description":""},"awards":[{"competition":"","year":null,"award":"","category":""}]}`;

/* Architecture note:
 *
 * Previous iterations used web_search_20260209 (dynamic filtering) with the beta header
 * `code-execution-web-tools-2026-02-09`. That header enables a `code_execution` server
 * tool that Claude uses autonomously. Our complex prompt (with JSON schema) triggered
 * code_execution in a loop — 22+ iterations consuming all time → 300s abort.
 *
 * Fix: switched to web_search_20250305 (basic) which needs no beta header.
 * No code_execution, no stalls. Structured JSON returned in text, parsed with
 * extractJsonWithRepair(). SERT reference completes in ~2 min with similar approach.
 */

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
 * Collect all content blocks from an SSE streaming response.
 * Reconstructs full content blocks (text, web_search_tool_result, server_tool_use)
 * from streaming events, matching the structure of a non-streaming response.content array.
 *
 * @param {AsyncIterable} stream - Anthropic SDK streaming response
 * @returns {Promise<{content: Array, stopReason: string}>} Reconstructed content blocks + stop reason
 */
async function collectStreamContent(stream) {
  const content = [];
  let stopReason = null;

  // Track current block being built from deltas
  let currentBlock = null;
  let inputJsonBuffer = '';

  const t0 = Date.now();
  let eventCount = 0;

  for await (const event of stream) {
    eventCount++;

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;

        if (block.type === 'text') {
          currentBlock = { type: 'text', text: '', citations: [] };
        } else if (block.type === 'tool_use') {
          currentBlock = { type: 'tool_use', id: block.id, name: block.name, input: {} };
          inputJsonBuffer = '';
        } else if (block.type === 'server_tool_use') {
          // server_tool_use blocks (web_search, code_execution) are server-managed
          currentBlock = { type: 'server_tool_use', id: block.id, name: block.name, input: {} };
          inputJsonBuffer = '';
        } else if (block.type === 'web_search_tool_result') {
          // web_search_tool_result arrives complete in content_block_start
          content.push(block);
          currentBlock = null;
        } else {
          // code_execution_tool_result and other server blocks — skip
          currentBlock = null;
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (!currentBlock) break;

        if (delta.type === 'text_delta' && currentBlock.type === 'text') {
          currentBlock.text += delta.text || '';
        } else if (delta.type === 'input_json_delta' && (currentBlock.type === 'tool_use' || currentBlock.type === 'server_tool_use')) {
          inputJsonBuffer += delta.partial_json || '';
        } else if (delta.type === 'citations_delta' && currentBlock.type === 'text') {
          if (delta.citation) {
            currentBlock.citations.push(delta.citation);
          }
        }
        break;
      }

      case 'content_block_stop': {
        if (!currentBlock) break;

        if ((currentBlock.type === 'tool_use' || currentBlock.type === 'server_tool_use') && inputJsonBuffer) {
          try {
            currentBlock.input = JSON.parse(inputJsonBuffer);
          } catch { /* partial JSON — best effort */ }
        }

        // Strip empty citations array to match non-streaming shape
        if (currentBlock.type === 'text' && currentBlock.citations.length === 0) {
          delete currentBlock.citations;
        }

        content.push(currentBlock);
        currentBlock = null;
        inputJsonBuffer = '';
        break;
      }

      case 'message_delta': {
        if (event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        break;
      }
    }
  }

  logger.info('UnifiedWineSearch', `Stream collected ${content.length} blocks (${eventCount} events) in ${Date.now() - t0}ms, stop=${stopReason}`);

  return { content, stopReason };
}

/**
 * Search for wine data using Claude's native web search with SSE streaming.
 * Returns both structured ratings JSON and rich prose narrative in a single API call.
 *
 * Uses streaming to avoid SDK timeout issues — web search tool execution can take
 * 2-4 minutes server-side. With streaming, the connection stays alive as SSE events
 * flow continuously, eliminating the hard timeout that kills non-streaming requests.
 *
 * Response parsing strategy (SERT preamble-filtering pattern):
 * 1. Find last web_search_tool_result block index
 * 2. Collect text blocks AFTER that index → prose narrative
 * 3. Extract embedded JSON from narrative via extractJsonWithRepair() → structured data
 * 4. Extract source URLs from all web_search_tool_result blocks → citation list
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

  logger.info('UnifiedWineSearch', `Starting streaming search for: ${wineName} ${vintage}`);
  const startTime = Date.now();

  try {
    const modelId = getModelForTask('webSearch');

    const userPrompt = `Research this wine comprehensively: ${producer ? producer + ' ' : ''}${wineName} ${vintage}${countryHint}${profileLine}${profileInstruction}

Search for information from these priority sources:
${sourceInjection}

After your narrative, output the JSON object with all structured data found.

CRITICAL RULES:
- Only ${vintage} vintage ratings (not other vintages)
- Wine colour: ${colour}${style ? `\n- Style: ${style}` : ''}${grapes ? `\n- Grapes: ${grapes}` : ''}${region ? `\n- Region: ${region}` : ''}
- Empty array/null for missing data
- raw_score_numeric must be a number or null
- source_url must be a real URL from your search results
- grape_varieties: extract grape/variety names (e.g. ["Cabernet Sauvignon", "Merlot"])
- awards: list competition medals with year and category
- No markdown code fences around the JSON`;

    const apiParams = {
      model: modelId,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [
        // Basic web_search — no beta header required.
        // web_search_20260209 (dynamic) requires the code-execution-web-tools beta header,
        // which enables `code_execution` server tool. Our complex prompt with JSON schema
        // triggers Claude to use code_execution in a loop (22+ iterations, 5 min timeout).
        // Basic web_search_20250305 avoids this entirely — no code_execution, no stalls.
        { type: 'web_search_20250305' }
      ],
      messages: [{ role: 'user', content: userPrompt }],
      stream: true
    };

    // Safety AbortController — only fires if stream truly stalls (5 min)
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => {
      logger.warn('UnifiedWineSearch', `Abort fired after ${STREAM_ABORT_TIMEOUT_MS}ms — stream did not complete in time`);
      abortController.abort();
    }, STREAM_ABORT_TIMEOUT_MS);

    // No beta header needed for basic web_search_20250305.
    // The old code-execution-web-tools-2026-02-09 header enabled a `code_execution`
    // server tool that caused infinite loops (22+ iterations → 5 min timeout).
    const streamOpts = {
      signal: abortController.signal
    };

    let allContent;
    let lastStopReason;

    try {
      const stream = anthropic.messages.stream(apiParams, streamOpts);
      const result = await collectStreamContent(stream);
      allContent = [...result.content];
      lastStopReason = result.stopReason;

      // Handle pause_turn: server tool loop hit iteration limit — resume with continuation
      let continuations = 0;
      while (lastStopReason === 'pause_turn' && continuations < MAX_PAUSE_CONTINUATIONS) {
        continuations++;
        logger.info('UnifiedWineSearch', `pause_turn after ${Date.now() - startTime}ms (${continuations}/${MAX_PAUSE_CONTINUATIONS}), resuming stream…`);
        apiParams.messages = [
          ...apiParams.messages,
          { role: 'assistant', content: allContent },
          { role: 'user', content: 'Continue your research and include the JSON object with all structured data found.' }
        ];
        const contStream = anthropic.messages.stream(apiParams, streamOpts);
        const contResult = await collectStreamContent(contStream);
        allContent.push(...contResult.content);
        lastStopReason = contResult.stopReason;
      }
    } finally {
      clearTimeout(abortTimer);
    }

    const duration = Date.now() - startTime;
    const content = allContent;

    // Extract prose narrative (preamble-filtered: text blocks after last search result)
    const narrative = extractNarrative(content);
    if (!narrative) {
      const stopReason = lastStopReason || 'unknown';
      const blockTypes = content.map(b => b.type).join(', ') || 'empty';
      logger.warn('UnifiedWineSearch', `No text in response for "${wineName}" after ${duration}ms (stop_reason: ${stopReason}, blocks: [${blockTypes}])`);
      if (includeErrors) {
        return buildSearchError(
          'empty_response',
          'Wine search returned an empty response. Please try again.',
          { wineName, duration, stopReason, blockTypes }
        );
      }
      return null;
    }

    // Extract structured JSON from narrative text (Claude embeds it after prose)
    let extracted;
    try {
      extracted = extractJsonWithRepair(narrative);
      logger.info('UnifiedWineSearch', `Extracted JSON from text in ${duration}ms, ${narrative.length} chars`);
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
    const errMsg = String(error?.message || '').toLowerCase();
    const isAbort = error?.name === 'AbortError' || errMsg.includes('abort');
    const isTimeout = isAbort || errMsg.includes('timeout') || errMsg.includes('timed out') || errMsg.includes('etimedout');

    logger.error('UnifiedWineSearch', `Search failed for "${wineName}" after ${duration}ms: ${error.message}`);
    if (includeErrors) {
      return buildSearchError(
        isTimeout ? 'timeout' : 'api_error',
        isTimeout
          ? 'Wine search timed out. Please try again.\nTry adding more details (producer, vintage, region) to improve search accuracy.'
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
