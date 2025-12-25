/**
 * @fileoverview Claude API integration for sommelier feature and rating extraction.
 * @module services/claude
 */

import Anthropic from '@anthropic-ai/sdk';
import { searchWineRatings, fetchPageContent, fetchAuthenticatedRatings } from './searchProviders.js';
import { LENS_CREDIBILITY, getSourceConfig } from '../config/sourceRegistry.js';
import logger from '../utils/logger.js';
import db from '../db/index.js';

/**
 * Add vintage year parameter to Vivino URLs for correct vintage-specific data.
 * @param {string} url - Original URL
 * @param {string|number} vintage - Vintage year
 * @returns {string} Modified URL with year parameter
 */
function addVintageToUrl(url, vintage) {
  if (!vintage || !url.includes('vivino.com')) {
    return url;
  }
  // Remove any existing year param and add the correct one
  const urlObj = new URL(url);
  urlObj.searchParams.delete('year');
  urlObj.searchParams.set('year', String(vintage));
  return urlObj.toString();
}

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

  // Enrich recommendations with wine data including ID for clickable links
  if (parsed.recommendations) {
    parsed.recommendations = parsed.recommendations.map(rec => {
      const wine = wines.find(w =>
        w.wine_name === rec.wine_name &&
        (w.vintage === rec.vintage || (!w.vintage && !rec.vintage))
      );
      return {
        ...rec,
        wine_id: wine?.id || null,
        location: wine?.locations || 'Unknown',
        bottle_count: wine?.bottle_count || 0,
        style: wine?.style || null,
        colour: wine?.colour || null
      };
    });
  }

  // Include context for follow-up chat
  parsed._chatContext = {
    dish,
    source,
    colour,
    winesList,
    prioritySection,
    wines,
    initialResponse: parsed
  };

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
 * Tries authenticated sources first (Vivino, CellarTracker) if credentials are configured,
 * then falls back to web search + Claude extraction.
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
  const style = wine.style || '';

  logger.separator();
  logger.info('Ratings', `Starting search for: ${wineName} ${vintage}`);
  logger.info('Ratings', `Wine style: ${style || 'Unknown'}`);
  logger.info('Ratings', `API Keys: Google=${process.env.GOOGLE_SEARCH_API_KEY ? 'Set' : 'MISSING'}, Engine=${process.env.GOOGLE_SEARCH_ENGINE_ID ? 'Set' : 'MISSING'}, BrightData=${process.env.BRIGHTDATA_API_KEY ? 'Set' : 'MISSING'}, WebZone=${process.env.BRIGHTDATA_WEB_ZONE ? 'Set' : 'MISSING'}`);

  // Step 0: Try authenticated sources first (faster and more reliable if configured)
  const authenticatedRatings = await fetchAuthenticatedRatings(wineName, vintage);
  if (authenticatedRatings.length > 0) {
    logger.info('Ratings', `Got ${authenticatedRatings.length} ratings from authenticated sources`);
  }

  // Step 1: Search for relevant pages (pass style for country inference)
  const searchResults = await searchWineRatings(wineName, vintage, country, style);

  if (searchResults.results.length === 0) {
    logger.warn('Ratings', 'No search results found');
    // Still return authenticated ratings if we got any
    if (authenticatedRatings.length > 0) {
      return {
        ratings: authenticatedRatings,
        search_notes: `No search results, but found ${authenticatedRatings.length} from authenticated sources`
      };
    }
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
    // Add vintage year to Vivino URLs to get correct vintage-specific rating
    const fetchUrl = addVintageToUrl(result.url, vintage);
    const fetched = await fetchPageContent(fetchUrl, 8000);
    return {
      ...result,
      url: fetchUrl, // Update URL to include vintage
      content: fetched.content,
      fetchSuccess: fetched.success,
      fetchError: fetched.error
    };
  });

  const pages = await Promise.all(fetchPromises);
  const validPages = pages.filter(p => p.fetchSuccess && p.content.length > 200);

  logger.info('Ratings', `Successfully fetched ${validPages.length}/${pagesToFetch.length} pages`);

  // Collect failed pages OR pages with insufficient content for snippet extraction
  // This handles Vivino and other sites that may return blocked/empty pages
  const failedPages = pages.filter(p =>
    (!p.fetchSuccess || p.content.length <= 200) && p.snippet && p.snippet.length > 20
  );

  // Also include results beyond the top 8 that have snippets (for broader coverage)
  const additionalSnippets = searchResults.results.slice(8)
    .filter(r => r.snippet && r.snippet.length > 20)
    .slice(0, 5); // Limit to 5 more

  // If no pages could be fetched at all, use pure snippet extraction
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

        // Merge with authenticated ratings
        const allRatings = [...authenticatedRatings];
        const authenticatedSources = new Set(authenticatedRatings.map(r => r.source));
        for (const rating of snippetParsed.ratings) {
          if (!authenticatedSources.has(rating.source)) {
            allRatings.push(rating);
          }
        }
        snippetParsed.ratings = allRatings;

        return snippetParsed;
      }
    }

    // Final fallback - return authenticated ratings + search results for manual review
    return {
      ratings: authenticatedRatings,
      search_notes: `Found ${searchResults.results.length} results but could not fetch page contents${authenticatedRatings.length > 0 ? `, got ${authenticatedRatings.length} from authenticated sources` : ''}`,
      search_results: searchResults.results.map(r => ({
        source: r.sourceId,
        url: r.url,
        title: r.title
      }))
    };
  }

  // Also extract from snippets of failed fetches (like Vivino) in parallel with page extraction
  const snippetsForExtraction = [...failedPages, ...additionalSnippets];
  if (snippetsForExtraction.length > 0) {
    logger.info('Ratings', `Will also extract from ${snippetsForExtraction.length} snippets (failed fetches + extras)`);
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

  // Step 4: Also extract from snippets of failed fetches (Vivino, blocked sites, extras)
  if (snippetsForExtraction.length > 0) {
    logger.info('Ratings', `Extracting from ${snippetsForExtraction.length} snippets...`);
    const snippetPrompt = buildSnippetExtractionPrompt(wineName, vintage, snippetsForExtraction);

    try {
      const snippetResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        messages: [{ role: 'user', content: snippetPrompt }]
      });

      const snippetParsed = parseRatingResponse(snippetResponse.content[0].text, 'Snippet');

      if (snippetParsed.ratings && snippetParsed.ratings.length > 0) {
        logger.info('Ratings', `Got ${snippetParsed.ratings.length} additional ratings from snippets`);

        // Enrich and add snippet ratings
        const existingSources = new Set((parsed.ratings || []).map(r => r.source));
        for (const rating of snippetParsed.ratings) {
          if (!existingSources.has(rating.source)) {
            const config = getSourceConfig(rating.source);
            parsed.ratings = parsed.ratings || [];
            parsed.ratings.push({
              ...rating,
              lens: config?.lens || rating.lens,
              credibility: LENS_CREDIBILITY[config?.lens] || 1.0
            });
            existingSources.add(rating.source);
          }
        }
      }

      // Merge tasting notes from snippets if not already present
      if (snippetParsed.tasting_notes && !parsed.tasting_notes) {
        parsed.tasting_notes = snippetParsed.tasting_notes;
      }
    } catch (snippetErr) {
      logger.warn('Ratings', `Snippet extraction failed: ${snippetErr.message}`);
    }
  }

  // Merge authenticated ratings with scraped ratings
  // Authenticated ratings take precedence (they're more reliable)
  const allRatings = [...authenticatedRatings];
  const authenticatedSources = new Set(authenticatedRatings.map(r => r.source));

  // Add scraped ratings that aren't already covered by authenticated sources
  for (const rating of (parsed.ratings || [])) {
    if (!authenticatedSources.has(rating.source)) {
      allRatings.push(rating);
    }
  }

  parsed.ratings = allRatings;

  logger.info('Ratings', `Total ratings: ${parsed.ratings?.length || 0} (${authenticatedRatings.length} authenticated)`);
  if (parsed.tasting_notes) {
    logger.info('Ratings', `Tasting notes extracted: ${parsed.tasting_notes.substring(0, 100)}...`);
  } else {
    logger.info('Ratings', 'No tasting notes extracted from pages');
  }
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
  Global Competitions: decanter, iwc, iwsc, concours_mondial, mundus_vini
  Grape Competitions: chardonnay_du_monde, syrah_du_monde, grenaches_du_monde
  Regional Competitions: veritas, old_mutual
  Australia/NZ: halliday, huon_hooke, gourmet_traveller_wine, bob_campbell, wine_orbit
  Spain: guia_penin, guia_proensa
  Italy: gambero_rosso, doctor_wine, bibenda, vinous
  France: guide_hachette, rvf, bettane_desseauve
  South Africa: platters
  South America: descorchados, vinomanos
  Germany: falstaff
  Critics: tim_atkin, jancis_robinson, wine_advocate, wine_spectator, james_suckling, decanter_magazine, wine_enthusiast, natalie_maclean
  Community: vivino, cellar_tracker, wine_align
  Aggregators: wine_searcher (use original source if visible, e.g., "wine_advocate" not "wine_searcher")

IMPORTANT - Aggregator sites (Wine-Searcher, Dan Murphy's, BBR):
- These sites CITE ratings from original critics. Look for patterns like:
  "Wine Advocate: 92" → source: "wine_advocate", raw_score: "92"
  "Wine Spectator: 95 points" → source: "wine_spectator", raw_score: "95"
  "James Suckling 93" → source: "james_suckling", raw_score: "93"
  "Critic Score: 92" or "Critics Score" → extract the score with lens: "critic"
- If source is clearly stated, use the ORIGINAL source, not "wine_searcher"
- If just "WS Score: 92" without clear attribution, use source: "wine_searcher" lens: "aggregator"
- Wine-Searcher often shows aggregated scores - extract any critic scores with attribution

- lens: "competition", "panel_guide", "critic", "community", or "aggregator"
- score_type: "medal", "points", "stars", or "symbol"
- raw_score: The EXACT score as shown (e.g., "Gold", "92", "4.2", "Tre Bicchieri", "★★★", "17/20")
- normalised_score: Convert to 100-point scale if possible:
  - Medals: Grand Gold/Trophy=98, Gold=94, Silver=88, Bronze=82, Commended=78
  - Tre Bicchieri=95, Due Bicchieri Rossi=90, Due Bicchieri=87
  - 5 grappoli=95, 4 grappoli=90, 3 grappoli=85
  - Stars (out of 5): multiply by 20
  - French /20 scores: multiply by 5
  - For 100-point scores: use as-is
  - If unable to convert: null
- drinking_window: object or null, containing:
  - drink_from_year: year (integer) when wine becomes ready, or null
  - drink_by_year: year (integer) when wine should be consumed by, or null
  - peak_year: year (integer) when wine is at optimum, or null
  - raw_text: original text describing the window (e.g., "Drink 2024-2030")
- competition_year: Year of the rating if mentioned
- rating_count: Number of ratings (community sources only)
- source_url: The page URL where you found this
- evidence_excerpt: A SHORT quote (max 50 chars) proving the rating
- vintage_match: "exact" if vintage matches, "inferred" if close vintage, "non_vintage" if NV rating
- match_confidence: "high" if clearly this wine, "medium" if probably, "low" if uncertain

Common drinking window formats to look for:
- "Drink 2024-2030" or "Drink 2024 to 2030"
- "Best now through 2028"
- "Drink after 2026" or "Hold until 2025"
- "Ready now" or "Drink now"
- "Peak 2027"
- "Past its peak" or "Drink up"
- Italian: "Bere entro il 2030" (drink by 2030)
- French: "À boire jusqu'en 2028" (drink until 2028)

Return ONLY valid JSON:
{
  "ratings": [
    {
      "source": "gambero_rosso",
      "lens": "panel_guide",
      "score_type": "symbol",
      "raw_score": "Tre Bicchieri",
      "normalised_score": 95,
      "drinking_window": {
        "drink_from_year": 2024,
        "drink_by_year": 2030,
        "peak_year": 2027,
        "raw_text": "Drink 2024-2030, peak 2027"
      },
      "competition_year": 2024,
      "rating_count": null,
      "source_url": "https://gamberorosso.it/...",
      "evidence_excerpt": "Tre Bicchieri 2024",
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
- For symbol scores (Tre Bicchieri, grappoli, stars, Coup de Coeur), use score_type: "symbol"
- For French /20 scores: normalise by multiplying by 5
- For Jancis Robinson, scores are out of 20 (e.g., "17" means 17/20, normalised_score=85)
- For Platter's, use stars (e.g., "4.5") and normalise by multiplying by 20
- IMPORTANT: For Vivino ratings (e.g., "4.2", "3.8"), ALWAYS use score_type: "stars" (NOT "points"). Vivino ratings are on a 1-5 star scale.
- Extract drinking_window whenever window/maturity text is present
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
- Vivino/Community: "3.8" or "4.2 stars" or "Rated 3.9"
- Critics/Guides: "92 points" or "91/100" or "17/20"
- Medals: "Gold Medal", "Silver", "Grand Gold", "Trophy"
- Italian symbols: "Tre Bicchieri", "Due Bicchieri", "5 grappoli"
- French symbols: "★★★", "Coup de Coeur"

For each rating found, provide:
- source: Use these identifiers:
  Global Competitions: decanter, iwc, iwsc, concours_mondial, mundus_vini
  Grape Competitions: chardonnay_du_monde, syrah_du_monde, grenaches_du_monde
  Australia/NZ: halliday, bob_campbell, wine_orbit
  Italy: gambero_rosso, bibenda, vinous
  France: guide_hachette, rvf
  Spain: guia_penin
  South Africa: platters
  South America: descorchados
  Critics: tim_atkin, jancis_robinson, wine_advocate, wine_spectator, james_suckling, wine_enthusiast
  Community: vivino, cellar_tracker
  Aggregators: wine_searcher (use original source if visible)

IMPORTANT - Aggregator snippets (Wine-Searcher, Dan Murphy's):
- Look for patterns citing original critics:
  "Wine Advocate 92" → source: "wine_advocate", raw_score: "92"
  "Critics Score: 90" → extract the score with lens: "critic"
- Use original source name when clearly attributed

- lens: "community", "critic", "panel_guide", "competition", or "aggregator"
- score_type: "stars", "points", "medal", or "symbol"
- raw_score: The exact score (e.g., "3.8", "92", "Gold", "Tre Bicchieri")
- normalised_score: Convert to 100-point scale:
  - Medals: Grand Gold/Trophy=98, Gold=94, Silver=88, Bronze=82
  - Tre Bicchieri=95, 5 grappoli=95
  - Stars (out of 5): multiply by 20
  - French /20 scores: multiply by 5
  - 100-point scores: use as-is
  - If unable to convert: null
- drinking_window: object or null if visible, containing:
  - drink_from_year: year (integer) or null
  - drink_by_year: year (integer) or null
  - peak_year: year (integer) or null
  - raw_text: original text (e.g., "Drink 2024-2030")
- source_url: The URL from the search result
- evidence_excerpt: Quote from the snippet showing the rating
- match_confidence: "medium" (snippets have less context than full pages)

Drinking window patterns to look for:
- "Drink 2024-2030", "Best now through 2028", "Drink after 2026"
- "Ready now", "Peak 2027", "Past its peak"

Return ONLY valid JSON:
{
  "ratings": [...],
  "tasting_notes": "Any tasting/flavour notes visible in snippets (or null if none)",
  "search_notes": "Extracted from search snippets (pages blocked)"
}

RULES:
- ONLY extract ratings clearly visible in the snippets
- For symbol scores (Tre Bicchieri, grappoli, stars, Coup de Coeur), use score_type: "symbol"
- IMPORTANT: For Vivino ratings (e.g., "4.2", "3.8"), ALWAYS use score_type: "stars" (NOT "points"). Vivino is 1-5 star scale.
- Do NOT fabricate - only extract what you can see
- If rating_count is visible (e.g., "1234 ratings"), include it
- Extract drinking_window if maturity/window text is visible
- Extract tasting_notes if flavour/aroma descriptions visible
- If no ratings visible: {"ratings": [], "tasting_notes": null, "search_notes": "No ratings visible in snippets"}`;
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
 * Continue sommelier conversation with follow-up question.
 * @param {Database} db - Database connection
 * @param {string} followUp - User's follow-up question
 * @param {Object} context - Previous conversation context
 * @returns {Promise<Object>} Sommelier response
 */
export async function continueSommelierChat(db, followUp, context) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  // Build conversation history for Claude
  const messages = buildChatMessages(followUp, context);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    system: buildSommelierSystemPrompt(),
    messages
  });

  const responseText = response.content[0].text;

  // Parse response - could be JSON for new recommendations or plain text for explanations
  let parsed;
  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1];
      parsed = JSON.parse(jsonStr.trim());
      // Enrich recommendations with wine data
      if (parsed.recommendations && context.wines) {
        parsed.recommendations = parsed.recommendations.map(rec => {
          const wine = context.wines.find(w =>
            w.wine_name === rec.wine_name &&
            (w.vintage === rec.vintage || (!w.vintage && !rec.vintage))
          );
          return {
            ...rec,
            wine_id: wine?.id || null,
            location: wine?.locations || 'Unknown',
            bottle_count: wine?.bottle_count || 0,
            style: wine?.style || null,
            colour: wine?.colour || null
          };
        });
      }
      parsed.type = 'recommendations';
    } else {
      // Plain text response (explanation, clarification, etc.)
      parsed = {
        type: 'explanation',
        message: responseText.trim()
      };
    }
  } catch (_parseError) {
    // Treat as plain text response
    parsed = {
      type: 'explanation',
      message: responseText.trim()
    };
  }

  return parsed;
}

/**
 * Build system prompt for sommelier chat.
 * @private
 */
function buildSommelierSystemPrompt() {
  return `You are a sommelier with 20 years in fine dining, now helping a home cook get the most from their personal wine cellar. Your style is warm and educational - you love sharing the "why" behind pairings, not just the "what".

Your approach:
- Match wine weight to dish weight (light with light, rich with rich)
- Balance acid: high-acid foods need high-acid wines
- Use tannins strategically: they cut through fat and protein
- Respect regional wisdom: "what grows together, goes together"
- Consider the full plate: sauces, sides, and seasonings matter
- Work with what's available, prioritising wines that need drinking soon

When asked follow-up questions:
- If they want different recommendations, provide new ones in JSON format
- If they ask about a specific wine or pairing reason, explain in conversational text
- If they mention a different dish, analyze it and provide new recommendations
- If they want "something lighter/heavier/fruitier/etc.", adjust recommendations accordingly

For new recommendations, respond with JSON in a code block:
\`\`\`json
{
  "message": "Brief intro to new recommendations",
  "recommendations": [
    {
      "rank": 1,
      "wine_name": "Exact wine name",
      "vintage": 2020,
      "why": "Why this pairing works",
      "food_tip": "Optional tip or null",
      "is_priority": true
    }
  ]
}
\`\`\`

For explanations or discussions, just respond with natural conversational text (no JSON).`;
}

/**
 * Build chat messages array for Claude API.
 * @private
 */
function buildChatMessages(followUp, context) {
  const messages = [];

  // Add initial context as first user message
  const initialContext = `I'm looking for wine pairings.

DISH: ${context.dish}
WINE FILTERS: Source: ${context.source}, Colour preference: ${context.colour}

AVAILABLE WINES:
${context.winesList}
${context.prioritySection || ''}`;

  messages.push({ role: 'user', content: initialContext });

  // Add initial response as assistant message
  if (context.initialResponse) {
    let assistantContent = '';
    if (context.initialResponse.dish_analysis) {
      assistantContent += context.initialResponse.dish_analysis + '\n\n';
    }
    if (context.initialResponse.recommendations?.length > 0) {
      assistantContent += 'My recommendations:\n';
      context.initialResponse.recommendations.forEach(rec => {
        assistantContent += `${rec.rank}. ${rec.wine_name} ${rec.vintage || 'NV'} - ${rec.why}\n`;
      });
    }
    messages.push({ role: 'assistant', content: assistantContent.trim() });
  }

  // Add conversation history
  if (context.chatHistory && context.chatHistory.length > 0) {
    for (const msg of context.chatHistory) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }
  }

  // Add the new follow-up question
  messages.push({ role: 'user', content: followUp });

  return messages;
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

/**
 * Save extracted drinking windows to the database.
 * @param {number} wineId - Wine ID
 * @param {Object[]} ratings - Array of ratings with potential drinking_window data
 * @returns {Promise<number>} Number of windows saved
 */
export async function saveExtractedWindows(wineId, ratings) {
  if (!ratings || !Array.isArray(ratings)) return 0;

  let saved = 0;

  for (const rating of ratings) {
    if (rating.drinking_window && (rating.drinking_window.drink_from_year || rating.drinking_window.drink_by_year || rating.drinking_window.peak_year)) {
      try {
        db.prepare(`
          INSERT INTO drinking_windows (wine_id, source, drink_from_year, drink_by_year, peak_year, confidence, raw_text, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(wine_id, source) DO UPDATE SET
            drink_from_year = excluded.drink_from_year,
            drink_by_year = excluded.drink_by_year,
            peak_year = excluded.peak_year,
            raw_text = excluded.raw_text,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          wineId,
          rating.source,
          rating.drinking_window.drink_from_year || null,
          rating.drinking_window.drink_by_year || null,
          rating.drinking_window.peak_year || null,
          rating.match_confidence || 'medium',
          rating.drinking_window.raw_text || null
        );
        saved++;
        logger.info('DrinkingWindows', `Saved window for wine ${wineId} from ${rating.source}`);
      } catch (err) {
        logger.error('DrinkingWindows', `Failed to save window from ${rating.source}: ${err.message}`);
      }
    }
  }

  return saved;
}
