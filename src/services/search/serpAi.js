/**
 * @fileoverview Tier 1 Quick SERP AI extraction service.
 * Extracts wine ratings from SERP AI Overview, Knowledge Graph, and Featured Snippets
 * before falling back to expensive API calls (Gemini, Legacy scraping).
 *
 * Latency target: 3-8 seconds
 *
 * @module services/search/serpAi
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask } from '../../config/aiModels.js';
import logger from '../../utils/logger.js';
// circuitBreaker reserved for future resilience patterns
import { TIMEOUTS } from '../../config/scraperConfig.js';
import { calculateIdentityScore } from '../wine/wineIdentity.js';

const BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY;
const BRIGHTDATA_SERP_ZONE = process.env.BRIGHTDATA_SERP_ZONE;
const BRIGHTDATA_API_URL = 'https://api.brightdata.com/serp/req';

/**
 * Create timeout AbortController.
 * @param {number} ms - Timeout in milliseconds
 * @returns {{ controller: AbortController, cleanup: Function }}
 */
function createTimeoutAbort(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    controller,
    cleanup: () => clearTimeout(timeoutId)
  };
}

/**
 * Extract AI fields from SERP response body.
 * These are the "gold" sources for quick extraction - no scraping needed.
 *
 * @param {Object} serpBody - Parsed SERP response body
 * @returns {Object} Extracted AI fields
 */
function extractSerpAiFields(serpBody) {
  return {
    // Path 1: Google AI Overview / SGE field (most structured)
    aiOverview: serpBody.ai_overview?.text || serpBody.ai_overview?.answer || serpBody.ai_overview || null,
    // Path 2: Knowledge Graph (entity info panel)
    knowledgeGraph: serpBody.knowledge_graph?.description || serpBody.knowledge_graph || null,
    // Path 3: Featured Snippet (position 0 answer box)
    featuredSnippet: serpBody.featured_snippet?.text || serpBody.featured_snippet?.answer || null,
    // Path 4: People Also Ask (may have rating mentions)
    peopleAlsoAsk: serpBody.people_also_ask?.map(q => q.answer || q.snippet).filter(Boolean) || [],
    // Path 5: Top organic result title + snippet (fallback)
    topOrganic: serpBody.organic?.[0] ? {
      title: serpBody.organic[0].title || '',
      snippet: serpBody.organic[0].description || serpBody.organic[0].snippet || ''
    } : null,
    // Full organic array for Tier 3 reuse
    organicResults: serpBody.organic || [],
    // Full body for debugging
    _fullBody: serpBody
  };
}

/**
 * Combine AI fields into searchable text content.
 * @param {Object} aiFields - Extracted AI fields
 * @returns {string} Combined content for parsing
 */
function combineAiContent(aiFields) {
  const parts = [];

  if (aiFields.aiOverview && typeof aiFields.aiOverview === 'string') {
    parts.push(`AI Overview: ${aiFields.aiOverview}`);
  } else if (aiFields.aiOverview && typeof aiFields.aiOverview === 'object') {
    parts.push(`AI Overview: ${JSON.stringify(aiFields.aiOverview)}`);
  }

  if (aiFields.knowledgeGraph && typeof aiFields.knowledgeGraph === 'string') {
    parts.push(`Knowledge Graph: ${aiFields.knowledgeGraph}`);
  } else if (aiFields.knowledgeGraph && typeof aiFields.knowledgeGraph === 'object') {
    parts.push(`Knowledge Graph: ${JSON.stringify(aiFields.knowledgeGraph)}`);
  }

  if (aiFields.featuredSnippet) {
    parts.push(`Featured: ${aiFields.featuredSnippet}`);
  }

  if (aiFields.peopleAlsoAsk?.length > 0) {
    parts.push(`Q&A: ${aiFields.peopleAlsoAsk.join(' | ')}`);
  }

  if (aiFields.topOrganic) {
    parts.push(`Top Result: ${aiFields.topOrganic.title} - ${aiFields.topOrganic.snippet}`);
  }

  return parts.join('\n\n');
}

/**
 * Fetch SERP with full response (including AI fields).
 * Unlike searchBrightDataSerp which only extracts organic[], this preserves all fields.
 *
 * @param {string} query - Search query
 * @returns {Promise<Object|null>} Full SERP response with AI fields
 */
export async function searchGoogleWithFullResponse(query) {
  if (!BRIGHTDATA_API_KEY || !BRIGHTDATA_SERP_ZONE) {
    logger.warn('SerpAI', 'BRIGHTDATA_API_KEY or BRIGHTDATA_SERP_ZONE not configured');
    return null;
  }

  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en&gl=us`;

  logger.info('SerpAI', `Fetching full SERP for: "${query.substring(0, 50)}..."`);

  const { controller, cleanup } = createTimeoutAbort(TIMEOUTS.SERP_API_TIMEOUT || 15000);

  try {
    const response = await fetch(BRIGHTDATA_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`
      },
      body: JSON.stringify({
        zone: BRIGHTDATA_SERP_ZONE,
        url: googleUrl,
        format: 'json',
        method: 'GET'
      })
    });

    cleanup();

    if (!response.ok) {
      logger.error('SerpAI', `SERP API returned ${response.status}`);
      return null;
    }

    const data = await response.json();

    // SERP API returns {status_code, headers, body} where body is a JSON string
    if (!data.body) {
      logger.error('SerpAI', 'No body in SERP response');
      return null;
    }

    const body = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;

    // Extract AI fields
    const aiFields = extractSerpAiFields(body);

    logger.info('SerpAI', `SERP fields: AI Overview=${!!aiFields.aiOverview}, KG=${!!aiFields.knowledgeGraph}, Featured=${!!aiFields.featuredSnippet}, Organic=${aiFields.organicResults.length}`);

    return aiFields;

  } catch (error) {
    cleanup();
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    logger.error('SerpAI', `SERP fetch failed: ${errorMsg}`);
    return null;
  }
}

/**
 * Quick Claude parsing of AI content for ratings.
 * Uses fast, minimal prompt for low-latency extraction.
 *
 * @param {string} content - Combined AI content
 * @param {Object} wine - Wine object for context
 * @returns {Promise<Object|null>} Extracted ratings or null
 */
async function quickClaudeExtraction(content, wine) {
  if (!content || content.length < 30) {
    return null;
  }


  const vintage = wine.vintage || 'NV';

  // FAST prompt - minimal tokens, JSON-only output
  const prompt = `Extract wine ratings from this text. Return ONLY JSON.

WINE: ${wine.wine_name || wine.name} ${vintage}

TEXT:
${content.substring(0, 2000)}

Return:
{"ratings":[{"source":"source_name","score":"90","score_type":"points|stars","confidence":"high|medium|low"}],"has_ratings":true|false,"grape_varieties":["Grape1","Grape2"]}

Rules: Only ${vintage} vintage. Empty array if no ratings found. grape_varieties: list grape/variety names if visible (empty array if none). No explanation.`;

  try {
    const message = await anthropic.messages.create({
      model: getModelForTask('ratings'),
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0]?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      return extracted;
    }

    return null;
  } catch (error) {
    logger.warn('SerpAI', `Quick Claude extraction failed: ${error.message}`);
    return null;
  }
}

/**
 * Build wine search query for SERP.
 * @param {Object} wine - Wine object
 * @returns {string} Search query
 */
function buildWineSearchQuery(wine) {
  const parts = [];

  if (wine.producer) {
    parts.push(wine.producer);
  }

  parts.push(wine.wine_name || wine.name);

  if (wine.vintage) {
    parts.push(wine.vintage);
  }

  parts.push('wine rating review');

  return parts.join(' ');
}

/**
 * Quick SERP AI extraction - Tier 1 of the waterfall.
 * Fetches SERP, extracts AI fields, and attempts quick rating extraction.
 *
 * Returns:
 * - success: true if ratings found via AI fields
 * - ratings: extracted ratings array (if success)
 * - rawSerp: full SERP results for Tier 3 reuse
 *
 * @param {Object} wine - Wine object
 * @returns {Promise<{success: boolean, ratings?: Array, rawSerp: Object|null}>}
 */
export async function quickSerpAiExtraction(wine, identityTokens = null) {
  const startTime = Date.now();
  const query = buildWineSearchQuery(wine);

  logger.info('SerpAI', `Tier 1: Starting quick SERP AI extraction for ${wine.wine_name || wine.name}`);

  // Fetch SERP with full response
  const serpResult = await searchGoogleWithFullResponse(query);

  if (!serpResult) {
    logger.info('SerpAI', 'Tier 1: SERP fetch failed, no rawSerp to reuse');
    return { success: false, rawSerp: null };
  }

  // Combine AI content
  const aiContent = combineAiContent(serpResult);

  if (aiContent.length < 50) {
    logger.info('SerpAI', `Tier 1: Insufficient AI content (${aiContent.length} chars), passing rawSerp to Tier 3`);
    return {
      success: false,
      rawSerp: {
        organic: serpResult.organicResults,
        aiFields: serpResult
      }
    };
  }

  // Quick Claude extraction
  const extracted = await quickClaudeExtraction(aiContent, wine);

  const latencyMs = Date.now() - startTime;

  if (extracted?.has_ratings && extracted.ratings?.length > 0) {
    logger.info('SerpAI', `Tier 1 SUCCESS: Found ${extracted.ratings.length} ratings in ${latencyMs}ms`);

    const identityScore = identityTokens
      ? calculateIdentityScore(aiContent, identityTokens)
      : { valid: true, score: 0, matches: {} };

    if (identityScore.valid === false) {
      logger.info('SerpAI', `Tier 1: Identity gate rejected AI content (${identityScore.reason}), skipping ratings`);
    }

    // Transform to standard rating format
    const ratings = identityScore.valid
      ? extracted.ratings.map(r => ({
          source: (r.source || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_'),
          source_lens: r.source_lens || 'critics',
          score_type: r.score_type || 'points',
          raw_score: r.score,
          raw_score_numeric: parseFloat(r.score) || null,
          vintage_match: identityScore.matches?.vintageMatch ? 'exact' : (wine.vintage ? 'inferred' : 'non_vintage'),
          match_confidence: r.confidence || 'medium',
          tasting_notes: r.notes || null,
          identity_score: identityScore.score,
          identity_reason: identityScore.reason,
          identity_matches: identityScore.matches
        }))
      : [];

    if (ratings.length > 0) {
      return {
        success: true,
        ratings,
        tasting_notes: null,
        grape_varieties: extracted.grape_varieties || [],
        search_notes: `Found via SERP AI Overview in ${latencyMs}ms`,
        rawSerp: {
          organic: serpResult.organicResults,
          aiFields: serpResult
        }
      };
    }
  }

  logger.info('SerpAI', `Tier 1: No ratings extracted from AI content in ${latencyMs}ms, passing to Tier 2/3`);

  return {
    success: false,
    rawSerp: {
      organic: serpResult.organicResults,
      aiFields: serpResult
    }
  };
}

/**
 * Check if SERP AI service is available.
 * @returns {boolean} True if Bright Data API is configured
 */
export function isSerpAiAvailable() {
  return !!(BRIGHTDATA_API_KEY && BRIGHTDATA_SERP_ZONE);
}

export default {
  quickSerpAiExtraction,
  searchGoogleWithFullResponse,
  isSerpAiAvailable
};
