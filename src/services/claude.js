/**
 * @fileoverview Claude API integration for sommelier feature and rating extraction.
 * @module services/claude
 */

import Anthropic from '@anthropic-ai/sdk';
import { searchWineRatings, fetchPageContent } from './searchProviders.js';
import { LENS_CREDIBILITY, getSourceConfig } from '../config/sourceRegistry.js';
import logger from '../utils/logger.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Get sommelier wine recommendation for a dish.
 * @param {Database} db - Database connection
 * @param {string} dish - Dish description
 * @param {string} source - 'all' or 'reduce_now'
 * @param {string} colour - 'any', 'red', 'white', or 'rose'
 * @returns {Promise<Object>} Sommelier recommendations
 */
export async function getSommelierRecommendation(db, dish, source, colour) {
  // Build wine query based on filters
  let wineQuery;
  const params = [];

  if (source === 'reduce_now') {
    wineQuery = `
      SELECT
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations,
        rn.priority, rn.reduce_reason
      FROM reduce_now rn
      JOIN wines w ON w.id = rn.wine_id
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE 1=1
    `;
    if (colour !== 'any') {
      wineQuery += ` AND w.colour = ?`;
      params.push(colour);
    }
    wineQuery += ` GROUP BY w.id HAVING bottle_count > 0 ORDER BY rn.priority, w.wine_name`;
  } else {
    wineQuery = `
      SELECT
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE 1=1
    `;
    if (colour !== 'any') {
      wineQuery += ` AND w.colour = ?`;
      params.push(colour);
    }
    wineQuery += ` GROUP BY w.id HAVING bottle_count > 0 ORDER BY w.colour, w.style`;
  }

  const wines = db.prepare(wineQuery).all(...params);

  if (wines.length === 0) {
    return {
      dish_analysis: "No wines match your filters.",
      recommendations: [],
      no_match_reason: `No ${colour !== 'any' ? colour + ' ' : ''}wines found${source === 'reduce_now' ? ' in reduce-now list' : ''}.`
    };
  }

  // Format wines for prompt
  const winesList = wines.map(w =>
    `- ${w.wine_name} ${w.vintage || 'NV'} (${w.style}, ${w.colour}) - ${w.bottle_count} bottle(s) at ${w.locations}`
  ).join('\n');

  // Get priority wines if source is 'all'
  let prioritySection = '';
  if (source === 'all') {
    const priorityWines = db.prepare(`
      SELECT w.wine_name, w.vintage, rn.reduce_reason
      FROM reduce_now rn
      JOIN wines w ON w.id = rn.wine_id
      JOIN slots s ON s.wine_id = w.id
      ${colour !== 'any' ? 'WHERE w.colour = ?' : ''}
      GROUP BY w.id
      ORDER BY rn.priority
    `).all(colour !== 'any' ? [colour] : []);

    if (priorityWines.length > 0) {
      prioritySection = `\nPRIORITY WINES (these should be drunk soon - prefer if suitable):\n` +
        priorityWines.map(w => `- ${w.wine_name} ${w.vintage || 'NV'}: ${w.reduce_reason}`).join('\n');
    }
  }

  const sourceDesc = source === 'reduce_now'
    ? 'Choosing only from priority wines that should be drunk soon'
    : 'Choosing from full cellar inventory';

  const colourDesc = {
    'any': 'No colour preference - suggest what works best',
    'red': 'Red wines only',
    'white': 'White wines only',
    'rose': 'Rosé wines only'
  }[colour];

  const prompt = buildSommelierPrompt(dish, sourceDesc, colourDesc, winesList, prioritySection);

  // Call Claude API
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  // Parse response
  const responseText = message.content[0].text;
  let parsed;

  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    parsed = JSON.parse(jsonStr.trim());
  } catch (_parseError) {
    console.error('Failed to parse Claude response:', responseText);
    throw new Error('Could not parse sommelier response');
  }

  // Enrich recommendations with locations
  if (parsed.recommendations) {
    parsed.recommendations = parsed.recommendations.map(rec => {
      const wine = wines.find(w =>
        w.wine_name === rec.wine_name &&
        (w.vintage === rec.vintage || (!w.vintage && !rec.vintage))
      );
      return {
        ...rec,
        location: wine?.locations || 'Unknown',
        bottle_count: wine?.bottle_count || 0
      };
    });
  }

  return parsed;
}

/**
 * Parse wine details from text using Claude.
 * @param {string} text - Raw text containing wine information
 * @returns {Promise<Object>} Parsed wine details
 */
export async function parseWineFromText(text) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const prompt = `You are a wine data extraction assistant. Extract wine details from the following text.

TEXT:
${text}

Extract the following fields (use null if not found):
- wine_name: Full name of the wine (producer + wine name, exclude vintage)
- vintage: Year as integer (null if NV or not specified)
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style if not explicit)
- style: Grape variety or wine style (e.g., "Sauvignon Blanc", "Chianti", "Champagne")
- price_eur: Price as decimal number (convert to EUR if another currency, use approximate rate)
- vivino_rating: Rating as decimal if mentioned (null if not)
- country: Country of origin
- region: Specific region if mentioned
- alcohol_pct: Alcohol percentage as decimal if mentioned
- notes: Any tasting notes or descriptions

If multiple wines are present, return an array. If single wine, still return an array with one element.

Respond ONLY with valid JSON, no other text:
{
  "wines": [
    {
      "wine_name": "Producer Wine Name",
      "vintage": 2022,
      "colour": "white",
      "style": "Sauvignon Blanc",
      "price_eur": 12.99,
      "vivino_rating": null,
      "country": "France",
      "region": "Loire Valley",
      "alcohol_pct": 13.0,
      "notes": "Crisp and citrusy"
    }
  ],
  "confidence": "high",
  "parse_notes": "Any notes about assumptions made"
}

RULES:
- Infer colour from grape variety if not stated (e.g., Merlot → red, Chardonnay → white)
- For blends, use the dominant grape as style
- If price is in another currency, convert to EUR (USD: ×0.92, GBP: ×1.17, ZAR: ×0.05)
- Set confidence to "high", "medium", or "low" based on how much you had to infer
- Be conservative - only include what you can reasonably determine`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseText = message.content[0].text;

  try {
    // Handle potential markdown code blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    return JSON.parse(jsonStr.trim());
  } catch (_parseError) {
    console.error('Failed to parse Claude response:', responseText);
    throw new Error('Could not parse wine details from response');
  }
}

/**
 * Parse wine details from an image using Claude Vision.
 * @param {string} base64Image - Base64 encoded image data
 * @param {string} mediaType - Image MIME type (image/jpeg, image/png, image/webp, image/gif)
 * @returns {Promise<Object>} Parsed wine details
 */
export async function parseWineFromImage(base64Image, mediaType) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  // Validate media type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!validTypes.includes(mediaType)) {
    throw new Error(`Invalid image type: ${mediaType}. Supported: ${validTypes.join(', ')}`);
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image
            }
          },
          {
            type: 'text',
            text: `You are a wine data extraction assistant. Examine this image and extract wine details.

The image may be:
- A wine bottle label
- A wine menu or list
- A receipt or order confirmation
- A screenshot from a wine website or app
- A shelf tag or price label

Extract the following fields (use null if not found or not visible):
- wine_name: Full name of the wine (producer + wine name, exclude vintage)
- vintage: Year as integer (null if NV or not visible)
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style/bottle colour if not explicit)
- style: Grape variety or wine style (e.g., "Sauvignon Blanc", "Chianti", "Champagne")
- price_eur: Price as decimal number (convert to EUR if another currency, use approximate rate)
- vivino_rating: Rating as decimal if visible (null if not)
- country: Country of origin
- region: Specific region if mentioned
- alcohol_pct: Alcohol percentage as decimal if visible
- notes: Any tasting notes, descriptions, or other relevant text visible

If multiple wines are visible, return an array. If single wine, still return an array with one element.

Respond ONLY with valid JSON, no other text:
{
  "wines": [
    {
      "wine_name": "Producer Wine Name",
      "vintage": 2022,
      "colour": "white",
      "style": "Sauvignon Blanc",
      "price_eur": 12.99,
      "vivino_rating": null,
      "country": "France",
      "region": "Loire Valley",
      "alcohol_pct": 13.0,
      "notes": "Any visible tasting notes"
    }
  ],
  "confidence": "high",
  "parse_notes": "Description of what was visible and any assumptions made"
}

RULES:
- Read all visible text carefully, including small print
- For bottle labels, look for producer name, wine name, vintage, region, alcohol %
- Infer colour from grape variety or bottle appearance if not stated
- If price is in another currency, convert to EUR (USD: ×0.92, GBP: ×1.17, ZAR: ×0.05)
- Set confidence to "high" if clearly legible, "medium" if partially visible, "low" if guessing
- If image is blurry or wine details aren't visible, set confidence to "low" and explain in parse_notes`
          }
        ]
      }
    ]
  });

  const responseText = message.content[0].text;

  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    return JSON.parse(jsonStr.trim());
  } catch (_parseError) {
    console.error('Failed to parse Claude Vision response:', responseText);
    throw new Error('Could not parse wine details from image');
  }
}

/**
 * Fetch wine ratings using multi-provider search + Claude parse.
 * @param {Object} wine - Wine object
 * @returns {Promise<Object>} Fetched ratings
 */
export async function fetchWineRatings(wine) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const wineName = wine.wine_name || 'Unknown';
  const vintage = wine.vintage || '';
  const country = wine.country || '';

  logger.separator();
  logger.info('Ratings', `Starting search for: ${wineName} ${vintage}`);
  logger.info('Ratings', `API Keys: Google=${process.env.GOOGLE_SEARCH_API_KEY ? 'Set' : 'MISSING'}, Engine=${process.env.GOOGLE_SEARCH_ENGINE_ID ? 'Set' : 'MISSING'}, Brave=${process.env.BRAVE_SEARCH_API_KEY ? 'Set' : 'MISSING'}`);

  // Step 1: Search for relevant pages
  const searchResults = await searchWineRatings(wineName, vintage, country);

  if (searchResults.results.length === 0) {
    logger.warn('Ratings', 'No search results found');
    return {
      ratings: [],
      search_notes: 'No search results found'
    };
  }

  logger.info('Ratings', `Found ${searchResults.results.length} potential pages`);

  // Step 2: Fetch top pages (prioritize high credibility sources)
  // Increased from 5 to 8 to catch more diverse sources
  const pagesToFetch = searchResults.results.slice(0, 8);
  const fetchPromises = pagesToFetch.map(async (result) => {
    const fetched = await fetchPageContent(result.url, 8000);
    return {
      ...result,
      content: fetched.content,
      fetchSuccess: fetched.success,
      fetchError: fetched.error
    };
  });

  const pages = await Promise.all(fetchPromises);
  const validPages = pages.filter(p => p.fetchSuccess && p.content.length > 200);

  logger.info('Ratings', `Successfully fetched ${validPages.length}/${pagesToFetch.length} pages`);

  // If no pages could be fetched, try extracting from search snippets
  // This is especially useful for sites like Vivino that block direct fetches
  if (validPages.length === 0) {
    logger.info('Ratings', 'No pages fetched, attempting snippet extraction...');

    // Build snippet-based extraction for blocked pages
    const snippetPages = pagesToFetch
      .filter(p => p.snippet && p.snippet.length > 20)
      .map(p => ({
        ...p,
        content: `Title: ${p.title}\nSnippet: ${p.snippet}`,
        fetchSuccess: true
      }));

    if (snippetPages.length > 0) {
      logger.info('Ratings', `Trying extraction from ${snippetPages.length} search snippets`);
      const snippetPrompt = buildSnippetExtractionPrompt(wineName, vintage, snippetPages);

      const snippetResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        messages: [{ role: 'user', content: snippetPrompt }]
      });

      const snippetParsed = parseRatingResponse(snippetResponse.content[0].text, 'Snippet');

      if (snippetParsed.ratings && snippetParsed.ratings.length > 0) {
        logger.info('Ratings', `Extracted ${snippetParsed.ratings.length} ratings from snippets`);

        // Enrich with source metadata
        snippetParsed.ratings = snippetParsed.ratings.map(r => {
          const config = getSourceConfig(r.source);
          return {
            ...r,
            lens: config?.lens || r.lens,
            credibility: LENS_CREDIBILITY[config?.lens] || 1.0
          };
        });

        return snippetParsed;
      }
    }

    // Final fallback - return search results for manual review
    return {
      ratings: [],
      search_notes: `Found ${searchResults.results.length} results but could not fetch page contents`,
      search_results: searchResults.results.map(r => ({
        source: r.sourceId,
        url: r.url,
        title: r.title
      }))
    };
  }

  // Step 3: Ask Claude to extract ratings from page contents
  const parsePrompt = buildExtractionPrompt(wineName, vintage, validPages);

  logger.info('Ratings', 'Sending to Claude for extraction...');

  const parseResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2000,
    messages: [{ role: 'user', content: parsePrompt }]
  });

  const responseText = parseResponse.content[0].text;
  const parsed = parseRatingResponse(responseText, 'Extraction');

  // Enrich ratings with source metadata
  if (parsed.ratings) {
    parsed.ratings = parsed.ratings.map(r => {
      const config = getSourceConfig(r.source);
      return {
        ...r,
        lens: config?.lens || r.lens,
        credibility: LENS_CREDIBILITY[config?.lens] || 1.0
      };
    });
  }

  logger.info('Ratings', `Extracted ${parsed.ratings?.length || 0} ratings`);
  logger.separator();

  return parsed;
}

/**
 * Build extraction prompt for Claude.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {Object[]} pages - Fetched page data
 * @returns {string} Extraction prompt
 */
function buildExtractionPrompt(wineName, vintage, pages) {
  const pageTexts = pages.map((p, i) =>
    `--- PAGE ${i + 1}: ${p.sourceId} (${p.url}) ---
Title: ${p.title}
Content:
${p.content.substring(0, 4000)}
`
  ).join('\n\n');

  return `Extract wine ratings for "${wineName}" ${vintage} from these pages.

${pageTexts}

---

TASK: Extract any ratings found for this specific wine.

For each rating, provide:
- source: Use these identifiers ONLY:
  Competitions: decanter, iwc, iwsc, concours_mondial, mundus_vini, veritas, old_mutual
  Panel Guides: platters, halliday, guia_penin, gambero_rosso
  Critics: tim_atkin, jancis_robinson, wine_advocate, wine_spectator, james_suckling, descorchados, decanter_magazine
  Community: vivino

- lens: "competition", "panel_guide", "critic", or "community"
- score_type: "medal", "points", or "stars"
- raw_score: The actual score (e.g., "Gold", "92", "4.2", "91/100")
- competition_year: Year of the rating if mentioned
- rating_count: Number of ratings (Vivino only)
- source_url: The page URL where you found this
- evidence_excerpt: A SHORT quote (max 50 chars) proving the rating
- vintage_match: "exact" if vintage matches, "inferred" if close vintage, "non_vintage" if NV rating
- match_confidence: "high" if clearly this wine, "medium" if probably, "low" if uncertain

Return ONLY valid JSON:
{
  "ratings": [
    {
      "source": "tim_atkin",
      "lens": "critic",
      "score_type": "points",
      "raw_score": "91",
      "competition_year": 2024,
      "rating_count": null,
      "source_url": "https://timatkin.com/...",
      "evidence_excerpt": "Springfield Special Cuvee 91/100",
      "vintage_match": "exact",
      "match_confidence": "high"
    }
  ],
  "tasting_notes": "Any tasting notes found (combine from multiple sources)",
  "search_notes": "Summary: found X ratings from Y sources"
}

RULES:
- ONLY include ratings that clearly match "${wineName}"
- Check vintage carefully - only "exact" if vintage matches exactly
- Do NOT fabricate ratings - only extract what's in the text
- Include evidence_excerpt to prove the rating exists
- For Platter's, convert stars to "stars" score_type (e.g., "4.5")
- For Jancis Robinson, scores are out of 20 (e.g., "17" means 17/20)
- If no ratings found for this wine: {"ratings": [], "search_notes": "No ratings found"}`;
}

/**
 * Build extraction prompt for search snippets (fallback when pages can't be fetched).
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {Object[]} snippets - Search result snippets
 * @returns {string} Extraction prompt
 */
function buildSnippetExtractionPrompt(wineName, vintage, snippets) {
  const snippetTexts = snippets.map((s, i) =>
    `--- RESULT ${i + 1}: ${s.source} ---
URL: ${s.url}
Title: ${s.title}
Snippet: ${s.snippet}
`
  ).join('\n');

  return `Extract wine ratings for "${wineName}" ${vintage} from these SEARCH SNIPPETS.

Note: These are search result snippets, not full pages. Extract any ratings visible in the snippets.

${snippetTexts}

---

TASK: Extract any ratings visible in the snippets above.

Common patterns to look for:
- Vivino: "3.8" or "4.2 stars" or "Rated 3.9"
- Critics: "92 points" or "91/100"
- Medals: "Gold Medal" or "Silver"

For each rating found, provide:
- source: Use these identifiers:
  Community: vivino
  Critics: tim_atkin, jancis_robinson, wine_advocate, wine_spectator, james_suckling
  Competitions: decanter, iwc, iwsc

- lens: "community" for Vivino, "critic" for critics, "competition" for medals
- score_type: "stars" for Vivino, "points" for critics, "medal" for competitions
- raw_score: The actual score (e.g., "3.8", "92", "Gold")
- source_url: The URL from the search result
- evidence_excerpt: Quote from the snippet showing the rating
- match_confidence: "medium" (snippets have less context than full pages)

Return ONLY valid JSON:
{
  "ratings": [...],
  "search_notes": "Extracted from search snippets (pages blocked)"
}

RULES:
- ONLY extract ratings clearly visible in the snippets
- For Vivino, look for star ratings like "3.8" or "4.1"
- Do NOT fabricate - only extract what you can see
- If rating_count is visible (e.g., "1234 ratings"), include it
- If no ratings visible: {"ratings": [], "search_notes": "No ratings visible in snippets"}`;
}

/**
 * Parse rating response with multiple fallback strategies.
 * @param {string} text - Response text
 * @param {string} source - Source label for logging
 * @returns {Object} Parsed ratings
 */
function parseRatingResponse(text, source = 'Unknown') {
  // Strategy 1: Direct parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.ratings && Array.isArray(parsed.ratings)) {
      return parsed;
    }
  } catch (_e) {
    // Continue to fallbacks
  }

  // Strategy 2: Extract from code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.ratings && Array.isArray(parsed.ratings)) {
        return parsed;
      }
    } catch (_e) {
      // Continue to fallbacks
    }
  }

  // Strategy 3: Find JSON object in text
  const objectMatch = text.match(/\{[\s\S]*?"ratings"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.ratings && Array.isArray(parsed.ratings)) {
        return parsed;
      }
    } catch (_e) {
      // Continue to fallback
    }
  }

  // Final fallback
  console.error(`[${source}] Failed to parse:`, text.substring(0, 300));
  return {
    ratings: [],
    search_notes: `${source}: Could not parse results`
  };
}

/**
 * Build the sommelier prompt.
 * @private
 */
function buildSommelierPrompt(dish, sourceDesc, colourDesc, winesList, prioritySection) {
  return `You are a sommelier with 20 years in fine dining, now helping a home cook get the most from their personal wine cellar. Your style is warm and educational - you love sharing the "why" behind pairings, not just the "what".

Your approach:
- Match wine weight to dish weight (light with light, rich with rich)
- Balance acid: high-acid foods need high-acid wines
- Use tannins strategically: they cut through fat and protein
- Respect regional wisdom: "what grows together, goes together"
- Consider the full plate: sauces, sides, and seasonings matter
- Work with what's available, prioritising wines that need drinking soon

TASK:
Analyse this dish and extract food signals for wine pairing, then provide your recommendations.

DISH: ${dish}

AVAILABLE SIGNALS (use only these): chicken, pork, beef, lamb, fish, cheese, garlic_onion, roasted, sweet, acid, herbal, umami, creamy

USER CONSTRAINTS:
- Wine source: ${sourceDesc}
- Colour preference: ${colourDesc}

AVAILABLE WINES:
${winesList}
${prioritySection}

Respond in this JSON format only, with no other text:
{
  "signals": ["array", "of", "matching", "signals"],
  "dish_analysis": "Brief description of the dish's character and what to consider for pairing",
  "colour_suggestion": "If user selected 'any', indicate whether red or white would generally suit this dish better and why. If they specified a colour, either null or a diplomatic note if the dish would pair better with another colour.",
  "recommendations": [
    {
      "rank": 1,
      "wine_name": "Exact wine name from available list",
      "vintage": 2020,
      "why": "Detailed explanation of why this pairing works - discuss specific flavour interactions",
      "food_tip": "Optional suggestion to elevate the pairing (or null if none needed)",
      "is_priority": true
    }
  ],
  "no_match_reason": null
}

RULES:
- Only recommend wines from the AVAILABLE WINES list
- If source is "reduce_now only", all wines shown are priority - mention this is a great time to open them
- If fewer than 3 wines are suitable, return fewer recommendations and explain in no_match_reason
- Keep wine_name exactly as shown in the available list`;
}
