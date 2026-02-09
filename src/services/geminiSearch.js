/**
 * @fileoverview Gemini API with Google Search Grounding for wine data retrieval.
 * Uses Gemini's search grounding to find wine reviews, ratings, and tasting notes,
 * then passes results to Claude for wine-specific extraction and normalization.
 * @module services/geminiSearch
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { getSourcesForCountry } from '../config/unifiedSources.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Supported Gemini models for grounded search
// Use gemini-3.0-flash for fastest stable response times with improved accuracy (2026)
const GEMINI_MODEL = 'gemini-3.0-flash';

/**
 * Get priority critics/sources for a wine's country of origin.
 * Returns the top 5 most relevant sources for context-aware prompting.
 * @param {string} country - Wine's country of origin
 * @returns {string[]} Array of source names to prioritize
 */
function getPriorityCriticsForCountry(country) {
  if (!country) return [];

  const sources = getSourcesForCountry(country);
  // Get top 5 highest-scoring sources with relevance > 0.3
  return sources
    .filter(s => s.relevance >= 0.3 && s.lens === 'critics')
    .slice(0, 5)
    .map(s => s.name);
}

/**
 * Get priority competitions for a wine's country of origin.
 * @param {string} country - Wine's country of origin
 * @returns {string[]} Array of competition names
 */
function getPriorityCompetitionsForCountry(country) {
  if (!country) return [];

  const sources = getSourcesForCountry(country);
  return sources
    .filter(s => s.relevance >= 0.3 && s.lens === 'competition')
    .slice(0, 5)
    .map(s => s.name);
}

/**
 * Search for wine information using Gemini with Google Search grounding.
 * @param {Object} wine - Wine object with name, vintage, producer, etc.
 * @returns {Promise<Object>} Grounded search results with sources
 */
export async function searchWineWithGemini(wine) {
  if (!GEMINI_API_KEY) {
    logger.warn('GeminiSearch', 'GEMINI_API_KEY not configured, skipping Gemini search');
    return null;
  }

  const wineName = wine.wine_name || wine.name;
  const vintage = wine.vintage || '';
  const producer = wine.producer || '';
  const country = wine.country || '';

  // Construct search query
  const searchQuery = buildWineSearchQuery(wineName, vintage, producer);

  // Get country-specific priority sources for context-aware prompting
  const priorityCritics = getPriorityCriticsForCountry(country);
  const priorityCompetitions = getPriorityCompetitionsForCountry(country);

  // Build context-aware critic list
  const criticList = priorityCritics.length > 0
    ? priorityCritics.join(', ')
    : 'Wine Spectator, Wine Enthusiast, Decanter, James Suckling, Tim Atkin';

  // Build context-aware competition list
  const competitionList = priorityCompetitions.length > 0
    ? priorityCompetitions.join(', ')
    : 'IWC, IWSC, Decanter World Wine Awards';

  const countryHint = country ? ` This is a ${country} wine.` : '';

  logger.info('GeminiSearch', `Searching for: ${searchQuery} (prioritizing: ${criticList.substring(0, 50)}...)`);
  logger.info('GeminiSearch', `Using model: ${GEMINI_MODEL}, API key configured: ${!!GEMINI_API_KEY}`);

  const startTime = Date.now();
  try {
    // OPTIMIZED PROMPT: Concise format to prevent MAX_TOKENS truncation
    // Goal: Get structured data quickly like Google AI Overview
    const prompt = `Wine Analyst Report for: ${searchQuery}${countryHint}

Return ONLY a structured summary (max 800 words):

## Ratings (${vintage || 'NV'} vintage only)
List each as: Source | Score | Reviewer | Vintage | Key note
Priority sources: ${criticList}
Community: Vivino, CellarTracker (include rating count)

## Awards
Format: Competition | Award | Year
Priority: ${competitionList}

## Tasting Profile
- Aromas: (comma-separated list)
- Palate: (comma-separated list)
- Structure: body/tannins/acidity
- Finish: (brief)

## Drinking Window
drink_from: YYYY, drink_by: YYYY, peak: YYYY (if available)

## Pairings
(comma-separated list)

CRITICAL: Only ${vintage || 'matching'} vintage ratings. Omit sections with no data.`;

    const response = await fetch(
      `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          tools: [{
            google_search: {}
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192  // Increased from 4096 to handle complex wines
          }
        })
      }
    );

    const fetchDuration = Date.now() - startTime;
    logger.info('GeminiSearch', `Gemini API responded in ${fetchDuration}ms with status ${response.status}`);

    if (!response.ok) {
      const error = await response.text();
      logger.error('GeminiSearch', `API error: ${response.status} - ${error.substring(0, 500)}`);
      return null;
    }

    const data = await response.json();
    logger.info('GeminiSearch', `Response has ${data.candidates?.length || 0} candidates`);

    // Extract the response text and grounding metadata
    const candidate = data.candidates?.[0];
    if (!candidate) {
      logger.warn('GeminiSearch', `No candidates in response. Full response keys: ${Object.keys(data).join(', ')}`);
      if (data.error) {
        logger.error('GeminiSearch', `API returned error: ${JSON.stringify(data.error).substring(0, 500)}`);
      }
      return null;
    }

    // Log candidate details
    const finishReason = candidate.finishReason || 'unknown';
    logger.info('GeminiSearch', `Candidate finish reason: ${finishReason}`);

    const content = candidate.content?.parts?.[0]?.text || '';
    const groundingMetadata = candidate.groundingMetadata || {};

    // Log content length for debugging
    logger.info('GeminiSearch', `Content length: ${content.length} chars, first 200: ${content.substring(0, 200).replaceAll(/\n/g, ' ')}`);

    // Extract sources from grounding chunks
    const sources = (groundingMetadata.groundingChunks || []).map(chunk => ({
      title: chunk.web?.title || 'Unknown',
      url: chunk.web?.uri || '',
      snippet: ''  // Snippets are in groundingSupports
    }));

    // Extract search queries used
    const searchQueries = groundingMetadata.webSearchQueries || [];

    logger.info('GeminiSearch', `Found ${sources.length} sources via ${searchQueries.length} queries`);
    if (sources.length > 0) {
      logger.info('GeminiSearch', `First source: ${sources[0].title} - ${sources[0].url}`);
    }
    if (searchQueries.length > 0) {
      logger.info('GeminiSearch', `Search queries used: ${searchQueries.join('; ')}`);
    }

    return {
      content,
      sources,
      searchQueries,
      groundingSupports: groundingMetadata.groundingSupports || [],
      model: GEMINI_MODEL
    };
  } catch (error) {
    logger.error('GeminiSearch', `Search failed: ${error.message}`);
    return null;
  }
}

/**
 * Build optimized search query for wine.
 * @param {string} wineName - Wine name
 * @param {string} vintage - Vintage year
 * @param {string} producer - Producer name
 * @returns {string} Search query
 */
function buildWineSearchQuery(wineName, vintage, producer) {
  const parts = [];

  // Clean wine name (remove redundant producer if in name)
  const cleanName = wineName;
  if (producer && cleanName.toLowerCase().includes(producer.toLowerCase())) {
    // Producer already in name
  } else if (producer) {
    parts.push(producer);
  }

  parts.push(cleanName);

  if (vintage) {
    parts.push(vintage);
  }

  return parts.join(' ');
}

/**
 * Extract structured wine data from Gemini search results using Claude.
 * @param {Object} geminiResults - Results from searchWineWithGemini
 * @param {Object} wine - Original wine object for context
 * @returns {Promise<Object>} Structured wine data
 */
/**
 * Attempt to repair truncated or malformed JSON.
 * Handles common issues from MAX_TOKENS truncation.
 * @param {string} jsonStr - Potentially malformed JSON string
 * @returns {string} Repaired JSON string
 */
function repairJson(jsonStr) {
  let repaired = jsonStr.trim();

  // Count open/close brackets
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  // If truncated mid-string, try to close it
  // Remove trailing incomplete string/number values
  repaired = repaired.replace(/,\s*"[^"]*$/, '');  // Truncated string key
  repaired = repaired.replace(/:\s*"[^"]*$/, ': null');  // Truncated string value
  repaired = repaired.replace(/:\s*[\d.]+$/, ': null');  // Truncated number
  repaired = repaired.replace(/,\s*$/, '');  // Trailing comma

  // Close unclosed brackets
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  return repaired;
}

export async function extractWineDataWithClaude(geminiResults, wine) {
  if (!geminiResults?.content) {
    logger.warn('GeminiSearch', 'extractWineDataWithClaude called with no content');
    return null;
  }

  logger.info('GeminiSearch', `Starting Claude extraction for ${wine.wine_name || wine.name}, content length: ${geminiResults.content.length}`);
  const startTime = Date.now();

  const anthropic = new Anthropic();

  // OPTIMIZED: Shorter prompt, explicit JSON-only output
  const prompt = `Extract wine data from these search results. Return ONLY valid JSON.

WINE: ${wine.wine_name || wine.name} ${wine.vintage || ''}
COLOUR: ${wine.colour || 'Unknown'}

SEARCH RESULTS:
${geminiResults.content.substring(0, 6000)}

Return JSON:
{
  "ratings": [{"source":"", "source_lens":"competition|critics|community", "score_type":"points|stars|medal", "raw_score":"", "raw_score_numeric":null, "reviewer_name":"", "tasting_notes":"", "vintage_match":"exact|inferred|non_vintage", "confidence":"high|medium|low", "source_url":""}],
  "tasting_notes": {"nose":[], "palate":[], "structure":{"body":"", "tannins":"", "acidity":""}, "finish":""},
  "drinking_window": {"drink_from":null, "drink_by":null, "peak":null, "recommendation":""},
  "food_pairings": [],
  "style_summary": ""
}

Rules: Only verified data. Empty array/null for missing. No markdown, no explanation.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0];
      let extracted;

      // First attempt: direct parse
      try {
        extracted = JSON.parse(jsonStr);
      } catch (parseErr) {
        // Second attempt: repair truncated JSON
        logger.warn('GeminiSearch', `JSON parse failed at position, attempting repair: ${parseErr.message}`);
        try {
          const repairedJson = repairJson(jsonStr);
          extracted = JSON.parse(repairedJson);
          logger.info('GeminiSearch', 'JSON repair successful');
        } catch (repairErr) {
          logger.error('GeminiSearch', `JSON repair failed: ${repairErr.message}`);
          // Return partial data if we can extract ratings
          const ratingsMatch = jsonStr.match(/"ratings"\s*:\s*\[([\s\S]*?)\]/);
          if (ratingsMatch) {
            try {
              extracted = { ratings: JSON.parse(`[${ratingsMatch[1]}]`) };
              logger.info('GeminiSearch', 'Partial extraction: recovered ratings array');
            } catch {
              return null;
            }
          } else {
            return null;
          }
        }
      }

      // Add source metadata
      extracted._metadata = {
        gemini_model: geminiResults.model,
        sources_count: geminiResults.sources.length,
        search_queries: geminiResults.searchQueries,
        extracted_at: new Date().toISOString()
      };

      const extractDuration = Date.now() - startTime;
      logger.info('GeminiSearch', `Claude extraction completed in ${extractDuration}ms: ${extracted.ratings?.length || 0} ratings, ${extracted.tasting_notes?.nose?.length || 0} aromas`);

      return extracted;
    }

    logger.warn('GeminiSearch', 'Could not parse Claude extraction response');
    return null;
  } catch (error) {
    logger.error('GeminiSearch', `Claude extraction failed: ${error.message}`);
    return null;
  }
}

/**
 * Full hybrid search: Gemini grounded search + Claude extraction.
 * @param {Object} wine - Wine object
 * @returns {Promise<Object>} Complete wine data with ratings, notes, etc.
 */
export async function hybridWineSearch(wine) {
  logger.info('GeminiSearch', `Starting hybrid search for: ${wine.wine_name || wine.name}`);

  // Step 1: Gemini grounded search
  const searchResults = await searchWineWithGemini(wine);

  if (!searchResults) {
    logger.warn('GeminiSearch', 'Gemini search returned no results');
    return null;
  }

  // Step 2: Claude extraction
  const extracted = await extractWineDataWithClaude(searchResults, wine);

  if (!extracted) {
    logger.warn('GeminiSearch', 'Claude extraction returned no results');
    return null;
  }

  // Step 3: Attach raw sources for provenance
  extracted._sources = searchResults.sources;
  extracted._raw_content = searchResults.content;

  return extracted;
}

/**
 * Check if Gemini search is available.
 * @returns {boolean} True if GEMINI_API_KEY is configured
 */
export function isGeminiSearchAvailable() {
  return !!GEMINI_API_KEY;
}

export default {
  searchWineWithGemini,
  extractWineDataWithClaude,
  hybridWineSearch,
  isGeminiSearchAvailable
};
