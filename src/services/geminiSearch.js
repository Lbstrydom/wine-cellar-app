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
// Use gemini-2.5-flash for fastest stable response times (2026)
const GEMINI_MODEL = 'gemini-2.5-flash';

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

  try {
    const response = await fetch(
      `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Find comprehensive wine reviews, ratings, and tasting notes for: ${searchQuery}${countryHint}

Please search for and compile:
1. Professional critic scores and reviews - PRIORITIZE: ${criticList}
2. Competition medals and awards - PRIORITIZE: ${competitionList}
3. Community ratings (Vivino, CellarTracker, Wine-Searcher)
4. Detailed tasting notes describing aromas, flavors, structure
5. Drinking window recommendations for the ${vintage || 'current'} vintage specifically
6. Food pairing suggestions

IMPORTANT: When searching for ratings, ensure the vintage year matches ${vintage || 'the wine being searched'}. Do not report ratings for different vintages unless clearly noted.

For each rating/review found, include:
- Source name
- Score/rating (in original format)
- Reviewer name (if applicable)
- The specific vintage the rating applies to
- Key tasting descriptors
- Any drinking window mentioned`
            }]
          }],
          tools: [{
            google_search: {}
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error('GeminiSearch', `API error: ${response.status} - ${error}`);
      return null;
    }

    const data = await response.json();

    // Extract the response text and grounding metadata
    const candidate = data.candidates?.[0];
    if (!candidate) {
      logger.warn('GeminiSearch', 'No candidates in response');
      return null;
    }

    const content = candidate.content?.parts?.[0]?.text || '';
    const groundingMetadata = candidate.groundingMetadata || {};

    // Extract sources from grounding chunks
    const sources = (groundingMetadata.groundingChunks || []).map(chunk => ({
      title: chunk.web?.title || 'Unknown',
      url: chunk.web?.uri || '',
      snippet: ''  // Snippets are in groundingSupports
    }));

    // Extract search queries used
    const searchQueries = groundingMetadata.webSearchQueries || [];

    logger.info('GeminiSearch', `Found ${sources.length} sources via ${searchQueries.length} queries`);

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
  let cleanName = wineName;
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
export async function extractWineDataWithClaude(geminiResults, wine) {
  if (!geminiResults?.content) {
    return null;
  }

  const anthropic = new Anthropic();

  const prompt = `You are a wine data extraction specialist. Extract structured information from the following search results about a wine.

WINE CONTEXT:
- Name: ${wine.wine_name || wine.name}
- Vintage: ${wine.vintage || 'Unknown'}
- Colour: ${wine.colour || 'Unknown'}
- Grapes: ${wine.grapes || 'Unknown'}

SEARCH RESULTS:
${geminiResults.content}

SOURCES FOUND:
${geminiResults.sources.map((s, i) => `${i + 1}. ${s.title} - ${s.url}`).join('\n')}

Extract and return a JSON object with the following structure:
{
  "ratings": [
    {
      "source": "source name",
      "source_lens": "competition|critics|community",
      "score_type": "points|stars|medal",
      "raw_score": "original score as string",
      "raw_score_numeric": number or null,
      "reviewer_name": "reviewer name if mentioned",
      "tasting_notes": "brief notes from this source",
      "vintage_match": "exact|inferred|non_vintage",
      "confidence": "high|medium|low",
      "source_url": "url if available"
    }
  ],
  "tasting_notes": {
    "nose": ["list", "of", "aromas"],
    "palate": ["list", "of", "flavors"],
    "structure": {
      "body": "light|medium|full",
      "tannins": "soft|medium|firm",
      "acidity": "low|medium|high"
    },
    "finish": "description of finish"
  },
  "drinking_window": {
    "drink_from": year or null,
    "drink_by": year or null,
    "peak": year or null,
    "recommendation": "text recommendation"
  },
  "food_pairings": ["list", "of", "pairings"],
  "style_summary": "One sentence wine style description"
}

Important:
- Only include ratings you find actual evidence for
- Use the source_lens categories: "competition" for medals/awards, "critics" for professional reviews, "community" for user ratings
- Normalize scores: points (0-100), stars (0-5), medals (Gold/Silver/Bronze/Double Gold)
- Set confidence based on vintage match and source reliability
- If no data found for a section, use null or empty array`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);

      // Add source metadata
      extracted._metadata = {
        gemini_model: geminiResults.model,
        sources_count: geminiResults.sources.length,
        search_queries: geminiResults.searchQueries,
        extracted_at: new Date().toISOString()
      };

      logger.info('GeminiSearch', `Extracted ${extracted.ratings?.length || 0} ratings, ${extracted.tasting_notes?.nose?.length || 0} aromas`);

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
