/**
 * @fileoverview Unified Claude Wine Search — Phase 1 (Search) + Orchestrator.
 *
 * Phase 1 (Search): Simple research prompt + web_search tool → prose narrative.
 * Phase 2 (Extract): Delegated to wineDataExtractor.js (Haiku → structured JSON).
 *
 * This "Search First, Process Later" pattern matches the SERT reference adapter
 * (docs/sert/) and avoids the code_execution loops caused by embedding a JSON
 * schema in the search prompt.
 *
 * Uses SSE streaming for Phase 1 to avoid SDK timeout issues — web search tool
 * execution can take 2-4 minutes server-side.
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
import { extractWineData, normalizeExtraction } from './wineDataExtractor.js';

/** Maximum pause_turn continuations before giving up */
const MAX_PAUSE_CONTINUATIONS = 2;

/** Safety abort timeout (ms) — 3 minutes. SERT reference completes searches in ~2 min;
 *  3 min provides headroom while catching genuine stalls much faster than the old 5 min. */
const STREAM_ABORT_TIMEOUT_MS = 180_000;

/**
 * Phase 1 system prompt — simple research guidance, NO JSON schema.
 * Matches SERT's simplicity with explicit detail-retention instruction
 * to prevent loss of exact scores, reviewer names, and technical details.
 */
const SEARCH_SYSTEM_PROMPT = `You are a comprehensive wine research assistant. Search the web to build a complete profile for the requested wine.

Cover these areas:
1. Producer background and regional reputation
2. Grape varieties and blend composition
3. Tasting notes (nose, palate, structure, finish)
4. Critical reception — exact scores from critics, competitions, and community sites
5. Drinking window and aging potential
6. Food pairings
7. Awards and competition medals

IMPORTANT: Report ALL exact numeric scores, reviewer names, competition years, and technical details verbatim. Do NOT summarize or approximate scores. For example write "Tim Atkin: 94/100" not "scored well with Tim Atkin".

Provide a well-structured answer with clear sections.
Always cite your sources inline with URLs where available.`;

/* Architecture note:
 *
 * Previous iterations used a single prompt with both research instructions AND a JSON
 * schema. When paired with web_search_20260209 (dynamic filtering) and the beta header
 * `code-execution-web-tools-2026-02-09`, the JSON schema triggered Claude's
 * `code_execution` server tool in a loop — 22+ iterations consuming all time → 300s abort.
 *
 * The SERT reference (docs/sert/) proves the correct pattern: simple research prompt
 * (no JSON schema) → narrative → extract data in a second call. This two-phase pipeline
 * avoids code_execution entirely and is more robust.
 *
 * Phase 1: Sonnet + web_search_20250305 (basic, no beta header) → narrative
 * Phase 2: Haiku + messages.create (no tools) → structured JSON from narrative
 *
 * Future: Phase 1 can upgrade to web_search_20260209 once the simple prompt is proven
 * stable — the lack of JSON schema means code_execution won't be triggered.
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
      'Critics: Wine Advocate / Robert Parker (points/100), Jancis Robinson (points/20), Wine Spectator (points/100), Wine Enthusiast (points/100), Decanter Magazine (points/100)',
      'Aggregators (check for critic scores): Wine-Searcher',
      'Community: Vivino (stars/5), CellarTracker (points/100)'
    ].join('\n');
  }

  const sources = getSourcesForCountry(country);

  // Log when no local sources found — may indicate an unmapped country
  const hasLocalSources = sources.some(s => s.home_regions?.length > 0 && s.home_regions.includes(country));
  if (!hasLocalSources) {
    logger.info('UnifiedWineSearch', `No local sources mapped for country "${country}" — using global sources only`);
  }

  // Local = sources with explicit home_regions that include this country
  const localCompetitions = sources
    .filter(s => s.home_regions?.length > 0 && s.home_regions.includes(country) && s.lens === 'competition')
    .slice(0, 5)
    .map(formatSourceLabel);

  const localCritics = sources
    .filter(s => s.home_regions?.length > 0 && s.home_regions.includes(country) && (s.lens === 'critic' || s.lens === 'panel_guide'))
    .slice(0, 5)
    .map(formatSourceLabel);

  // Global = sources with empty home_regions (available everywhere)
  const globalCompetitions = sources
    .filter(s => (s.home_regions?.length ?? 1) === 0 && s.lens === 'competition' && s.credibility >= 0.9)
    .slice(0, 4)
    .map(s => formatSourceLabel(s));

  // Increased from 3 → 5 so Wine Spectator / Wine Enthusiast aren't dropped
  const globalCritics = sources
    .filter(s => (s.home_regions?.length ?? 1) === 0 && (s.lens === 'critic' || s.lens === 'panel_guide') && s.credibility >= 0.7)
    .slice(0, 5)
    .map(s => formatSourceLabel(s));

  // Aggregators (Wine-Searcher surfaces scores from 30+ paywalled critics)
  const globalAggregators = sources
    .filter(s => (s.home_regions?.length ?? 1) === 0 && s.lens === 'aggregator' && s.credibility >= 0.8)
    .slice(0, 2)
    .map(s => s.name);

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
    : 'Wine Spectator (points/100), Wine Enthusiast (points/100), Wine Advocate (points/100), Jancis Robinson (points/20), Decanter Magazine (points/100)';
  lines.push(`International critics: ${intlCritics}`);

  // Wine-Searcher aggregates 30+ critics; always include it — it surfaces paywalled scores
  const aggregatorNote = globalAggregators.length > 0
    ? globalAggregators.join(', ')
    : 'Wine-Searcher';
  lines.push(`Aggregators (check for critic scores): ${aggregatorNote}`);

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

  return stripMetaCommentary(textBlocks.join('\n\n'));
}

/**
 * Strip Claude's meta-commentary from narrative text.
 * Removes lines like "I now have a comprehensive picture", "Let me compile",
 * "Here is the complete profile", etc. that are process narration, not wine content.
 * @param {string} text - Raw narrative
 * @returns {string} Cleaned narrative
 */
export function stripMetaCommentary(text) {
  if (!text) return '';

  // Patterns that match Claude's process narration (case-insensitive, line-level)
  const META_PATTERNS = [
    /^I now have\b/i,
    /^I have (now |a )?(comprehensive|complete|thorough|detailed|very comprehensive|all the)\b/i,
    /^Let me (now )?(compile|summarize|summarise|present|put together|create|build|assemble)\b/i,
    /^Here(?:'s| is) (the |my )?(complete|comprehensive|full|detailed|final)\b/i,
    /^Now (let me|I('ll| will)|that I have)\b/i,
    /^Based on my research,? (let me|I('ll| will))\b/i,
    /^I('ll| will) (now )?(compile|summarize|summarise|present|put together)\b/i,
    /^After (searching|researching|reviewing|gathering)\b/i,
    /^Having (searched|researched|reviewed|gathered)\b/i
  ];

  const lines = text.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines
    return !META_PATTERNS.some(p => p.test(trimmed));
  });

  return filtered.join('\n').replace(/^\n+/, '').replaceAll(/\n{3,}/g, '\n\n');
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
  let skippedEvents = 0;

  for await (const event of stream) {
    eventCount++;

    // Guard against malformed SSE events (missing type or delta)
    if (!event?.type) {
      skippedEvents++;
      continue;
    }

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (!block?.type) {
          skippedEvents++;
          break;
        }

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
        if (!delta?.type || !currentBlock) break;

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

  if (skippedEvents > 0) {
    logger.warn('UnifiedWineSearch', `Skipped ${skippedEvents} malformed SSE events out of ${eventCount}`);
  }
  logger.info('UnifiedWineSearch', `Stream collected ${content.length} blocks (${eventCount} events) in ${Date.now() - t0}ms, stop=${stopReason}`);

  return { content, stopReason };
}

/**
 * Phase 1: Search the web for wine data using Claude's native web search.
 * Returns prose narrative, source URLs, and citations.
 *
 * @param {Object} wine - Wine object
 * @param {Object} params - Prepared prompt params (userPrompt, modelId)
 * @returns {Promise<{narrative: string, sourceUrls: Array, citations: string[], allContent: Array, duration: number, modelId: string}>}
 * @throws {Error} On API or streaming failure
 */
async function searchPhase(wine, params) {
  const { userPrompt, modelId } = params;
  const startTime = Date.now();

  const apiParams = {
    model: modelId,
    max_tokens: 16000,
    system: SEARCH_SYSTEM_PROMPT,
    tools: [
      // Basic web_search — no beta header required.
      // web_search_20260209 (dynamic) requires the code-execution-web-tools beta header,
      // which enables `code_execution` server tool. The two-phase architecture avoids
      // this entirely — Phase 1 has no JSON schema, so code_execution won't trigger.
      { type: 'web_search_20250305', name: 'web_search' }
    ],
    messages: [{ role: 'user', content: userPrompt }],
    stream: true
  };

  // Safety AbortController — only fires if stream truly stalls
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    logger.warn('UnifiedWineSearch', `Abort fired after ${STREAM_ABORT_TIMEOUT_MS}ms — stream did not complete in time`);
    abortController.abort();
  }, STREAM_ABORT_TIMEOUT_MS);

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
        { role: 'user', content: 'Continue your research.' }
      ];
      const contStream = anthropic.messages.stream(apiParams, streamOpts);
      const contResult = await collectStreamContent(contStream);
      allContent.push(...contResult.content);
      lastStopReason = contResult.stopReason;
    }

    // After pause_turn exhaustion: if we have search results but zero text blocks,
    // log explicitly — the search worked but Claude never produced a summary
    if (lastStopReason === 'pause_turn') {
      const hasSearchResults = allContent.some(b => b.type === 'web_search_tool_result');
      const hasText = allContent.some(b => b.type === 'text' && b.text?.trim().length > 0);
      if (hasSearchResults && !hasText) {
        logger.warn('UnifiedWineSearch', `pause_turn exhausted after ${continuations} continuations with search results but no text narrative`);
      }
    }
  } catch (err) {
    clearTimeout(abortTimer);
    // Re-throw with clear context — AbortError means our safety timer fired
    const isAbort = err?.name === 'AbortError' || String(err?.message || '').includes('abort');
    if (isAbort) {
      throw new Error(`Search stream aborted after ${STREAM_ABORT_TIMEOUT_MS}ms safety timeout`);
    }
    throw err;
  } finally {
    clearTimeout(abortTimer);
  }

  const duration = Date.now() - startTime;

  // Extract prose narrative (preamble-filtered: text blocks after last search result)
  const narrative = extractNarrative(allContent);
  const sourceUrls = extractSourceUrls(allContent);
  const citations = extractCitations(allContent);

  return { narrative, sourceUrls, citations, allContent, duration, modelId, lastStopReason };
}

/**
 * Search for wine data using a two-phase pipeline.
 *
 * Phase 1 (Search): Simple research prompt + web_search → prose narrative + citations.
 * Phase 2 (Extract): Narrative → Haiku → structured JSON (ratings, entities, etc.).
 *
 * Returns the same shape as the previous single-phase architecture — no consumer changes needed.
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

  logger.info('UnifiedWineSearch', `Starting two-phase search for: ${wineName} ${vintage}`);
  const totalStartTime = Date.now();

  try {
    const searchModelId = getModelForTask('webSearch');

    const userPrompt = `Research this wine comprehensively: ${producer ? producer + ' ' : ''}${wineName} ${vintage}${countryHint}${profileLine}${profileInstruction}

Search for information from these priority sources:
${sourceInjection}

CRITICAL RULES:
- Only ${vintage} vintage ratings (not other vintages)
- Wine colour: ${colour}${style ? `\n- Style: ${style}` : ''}${grapes ? `\n- Grapes: ${grapes}` : ''}${region ? `\n- Region: ${region}` : ''}`;

    // ── Phase 1: Search ─────────────────────────────────────────────
    const searchResult = await searchPhase(wine, { userPrompt, modelId: searchModelId });

    if (!searchResult.narrative) {
      const stopReason = searchResult.lastStopReason || 'unknown';
      const blockTypes = searchResult.allContent.map(b => b.type).join(', ') || 'empty';
      const hasSearchResults = searchResult.allContent.some(b => b.type === 'web_search_tool_result');
      const errorCode = hasSearchResults ? 'no_narrative' : 'empty_response';
      const userMsg = hasSearchResults
        ? 'Web search found results but failed to generate a summary. Please try again.'
        : 'Wine search returned an empty response. Please try again.';
      logger.warn('UnifiedWineSearch', `No text in response for "${wineName}" after ${searchResult.duration}ms (stop_reason: ${stopReason}, blocks: [${blockTypes}], hasSearchResults: ${hasSearchResults})`);
      if (includeErrors) {
        return buildSearchError(errorCode, userMsg, { wineName, duration: searchResult.duration, stopReason, blockTypes, hasSearchResults });
      }
      return null;
    }

    // ── Phase 2: Extract ────────────────────────────────────────────
    let extracted;
    let extractionDuration = 0;
    let extractionModelId = null;
    let extractionFailed = false;

    try {
      const extractResult = await extractWineData(searchResult.narrative, searchResult.sourceUrls, wine);
      extracted = normalizeExtraction(extractResult.extracted);
      extractionDuration = extractResult.duration;
      extractionModelId = extractResult.modelId;
      logger.info('UnifiedWineSearch', `Phase 2 extracted ${extracted.ratings.length} ratings in ${extractionDuration}ms`);
    } catch (extractErr) {
      // Graceful degradation: Phase 2 failed, but Phase 1 narrative is still valuable
      extractionFailed = true;
      extractionModelId = getModelForTask('wineExtraction');
      logger.warn('UnifiedWineSearch', `Phase 2 extraction failed for "${wineName}": ${extractErr.message}`, { error: extractErr });
      extracted = normalizeExtraction({});
    }

    const totalDuration = Date.now() - totalStartTime;

    // ── Merge and return ────────────────────────────────────────────
    extracted._metadata = {
      method: 'unified_claude_search',
      pipeline_version: 2,
      model: searchModelId,
      extraction_model: extractionModelId,
      sources_count: searchResult.sourceUrls.length,
      citation_count: searchResult.citations.length,
      search_duration_ms: searchResult.duration,
      extraction_duration_ms: extractionDuration,
      duration_ms: totalDuration,
      extraction_failed: extractionFailed,
      extracted_at: new Date().toISOString()
    };
    extracted._sources = searchResult.sourceUrls;
    extracted._citations = searchResult.citations;
    extracted._narrative = searchResult.narrative;

    logger.info('UnifiedWineSearch', `Extracted ${extracted.ratings.length} ratings from ${searchResult.sourceUrls.length} sources in ${totalDuration}ms (search: ${searchResult.duration}ms, extract: ${extractionDuration}ms)`);

    return extracted;
  } catch (error) {
    const duration = Date.now() - totalStartTime;
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
