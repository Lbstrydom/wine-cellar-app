/**
 * @fileoverview Wine rating extraction using search providers and Claude API.
 * Fetches ratings from web sources, extracts structured data, and persists drinking windows.
 * @module services/ratings/ratingExtraction
 */

import anthropic from '../ai/claudeClient.js';
import { searchWineRatings, fetchPageContent, fetchAuthenticatedRatings } from '../search/searchProviders.js';
import { LENS_CREDIBILITY, getSource as getSourceConfig } from '../../config/unifiedSources.js';
import { getModelForTask } from '../../config/aiModels.js';
import { extractDomain } from '../../utils/url.js';
import { extractJsonWithRepair } from '../shared/jsonUtils.js';
import { tryStructuredExtraction } from './structuredParsers.js';
import logger from '../../utils/logger.js';
import db from '../../db/index.js';

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

/**
 * Normalize a structured parser result to the standard rating shape.
 * @param {Object} structured - Result from tryStructuredExtraction
 * @param {Object} page - Page object with url, title, source info
 * @returns {Object} Normalized rating object
 * @private
 */
function normalizeStructuredResult(structured, page) {
  const isStarScale = structured.bestRating && structured.bestRating <= 5;
  const scoreType = isStarScale ? 'stars' : 'points';

  return {
    source: structured.source === 'structured' || structured.source === 'microdata'
      ? extractDomain(page.url).replace(/^www\./, '').split('.')[0]
      : structured.source,
    lens: 'community',
    score_type: scoreType,
    raw_score: String(structured.rating),
    normalised_score: isStarScale ? Math.round(structured.rating * 20) : structured.rating,
    rating_count: structured.ratingCount || null,
    source_url: page.url,
    evidence_excerpt: `${structured.extractionMethod}: ${structured.rating}`,
    vintage_match: structured.vintage ? 'exact' : 'inferred',
    match_confidence: structured.confidence || 'high'
  };
}

/**
 * Fetch wine ratings using multi-provider search + Claude parse.
 * Tries authenticated sources first (Vivino, CellarTracker) if credentials are configured,
 * then falls back to web search + Claude extraction.
 * @param {Object} wine - Wine object
 * @param {Object} [options={}] - Optional settings
 * @param {Object} [options.existingSerpResults] - Pre-fetched SERP results from Tier 1 to avoid duplicate API calls
 * @returns {Promise<Object>} Fetched ratings
 */
export async function fetchWineRatings(wine, options = {}) {
  const { existingSerpResults = null } = options;

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
  logger.info('Ratings', `API Keys: BrightData=${process.env.BRIGHTDATA_API_KEY ? 'Set' : 'MISSING'}, SerpZone=${process.env.BRIGHTDATA_SERP_ZONE ? 'Set' : 'MISSING'}, WebZone=${process.env.BRIGHTDATA_WEB_ZONE ? 'Set' : 'MISSING'}`);

  // Step 0: Try authenticated sources first (faster and more reliable if configured)
  const authenticatedRatings = await fetchAuthenticatedRatings(wineName, vintage);
  if (authenticatedRatings.length > 0) {
    logger.info('Ratings', `Got ${authenticatedRatings.length} ratings from authenticated sources`);
  }

  // Step 1: Search for relevant pages (reuse SERP results from Tier 1 if available)
  let searchResults;
  if (existingSerpResults?.organic?.length > 0) {
    // Reuse SERP results from Tier 1 to avoid duplicate API calls
    logger.info('Ratings', `Reusing ${existingSerpResults.organic.length} SERP results from Tier 1`);
    searchResults = {
      results: existingSerpResults.organic.map(item => ({
        title: item.title || '',
        url: item.link || item.url || '',
        snippet: (item.description || item.snippet || '').replace(/Read more$/, '').trim(),
        source: item.source || extractDomain(item.link || item.url || '')
      })),
      reused: true
    };
  } else {
    // Fresh SERP search
    searchResults = await searchWineRatings(wineName, vintage, country, style);
  }

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
  const failedPages = pages.filter(p =>
    (!p.fetchSuccess || p.content.length <= 200) && p.snippet && p.snippet.length > 20
  );

  // Also include results beyond the top 8 that have snippets (for broader coverage)
  const additionalSnippets = searchResults.results.slice(8)
    .filter(r => r.snippet && r.snippet.length > 20)
    .slice(0, 5); // Limit to 5 more

  // If no pages could be fetched at all, use pure snippet extraction
  if (validPages.length === 0) {
    return await handleSnippetOnlyExtraction(
      wineName, vintage, pagesToFetch, authenticatedRatings, searchResults
    );
  }

  // Also extract from snippets of failed fetches (like Vivino) in parallel with page extraction
  const snippetsForExtraction = [...failedPages, ...additionalSnippets];
  if (snippetsForExtraction.length > 0) {
    logger.info('Ratings', `Will also extract from ${snippetsForExtraction.length} snippets (failed fetches + extras)`);
  }

  // Step 2.5 (Tier 0): Try deterministic structured extraction before Claude
  const structuredRatings = [];
  const pagesForClaude = [];

  for (const page of validPages) {
    const domain = extractDomain(page.url);
    const structured = tryStructuredExtraction(page.content, domain);

    if (structured?.rating) {
      logger.info('Ratings', `Tier 0: Structured extraction from ${domain} → ${structured.rating} (${structured.extractionMethod})`);
      structuredRatings.push(normalizeStructuredResult(structured, page));
    } else {
      pagesForClaude.push(page);
    }
  }

  if (structuredRatings.length > 0) {
    logger.info('Ratings', `Tier 0: ${structuredRatings.length} ratings extracted deterministically, ${pagesForClaude.length} pages need Claude`);
  }

  // Step 3: Ask Claude to extract from remaining pages (skip if all parsed structurally)
  let parsed;
  if (pagesForClaude.length > 0) {
    const parsePrompt = buildExtractionPrompt(wineName, vintage, pagesForClaude);
    const ratingsModel = getModelForTask('ratings');

    logger.info('Ratings', `Sending ${pagesForClaude.length} pages to Claude for extraction...`);

    const parseResponse = await anthropic.messages.create({
      model: ratingsModel,
      max_tokens: 2000,
      messages: [{ role: 'user', content: parsePrompt }]
    });

    const responseText = parseResponse.content[0].text;
    parsed = parseRatingResponse(responseText, 'Extraction');
  } else {
    logger.info('Ratings', 'Tier 0: All pages parsed structurally, skipping Claude extraction');
    parsed = { ratings: [], search_notes: 'All ratings extracted via structured parsers' };
  }

  // Merge structured ratings into parsed results
  if (structuredRatings.length > 0) {
    parsed.ratings = [...structuredRatings, ...(parsed.ratings || [])];
  }

  // Enrich ratings with source metadata
  if (parsed.ratings) {
    parsed.ratings = enrichRatingsWithMetadata(parsed.ratings);
  }

  // Step 4: Also extract from snippets of failed fetches (Vivino, blocked sites, extras)
  if (snippetsForExtraction.length > 0) {
    await mergeSnippetRatings(parsed, wineName, vintage, snippetsForExtraction);
  }

  // Merge authenticated ratings with scraped ratings
  mergeAuthenticatedRatings(parsed, authenticatedRatings);

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
 * Handle the case where no pages could be fetched - use pure snippet extraction.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {Object[]} pagesToFetch - Pages that were attempted
 * @param {Object[]} authenticatedRatings - Ratings from authenticated sources
 * @param {Object} searchResults - Original search results
 * @returns {Promise<Object>} Extracted ratings
 * @private
 */
async function handleSnippetOnlyExtraction(wineName, vintage, pagesToFetch, authenticatedRatings, searchResults) {
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
    const ratingsModel = getModelForTask('ratings');

    const snippetResponse = await anthropic.messages.create({
      model: ratingsModel,
      max_tokens: 2000,
      messages: [{ role: 'user', content: snippetPrompt }]
    });

    const snippetParsed = parseRatingResponse(snippetResponse.content[0].text, 'Snippet');

    if (snippetParsed.ratings && snippetParsed.ratings.length > 0) {
      logger.info('Ratings', `Extracted ${snippetParsed.ratings.length} ratings from snippets`);

      // Enrich with source metadata
      snippetParsed.ratings = enrichRatingsWithMetadata(snippetParsed.ratings);

      // Merge with authenticated ratings
      mergeAuthenticatedRatings(snippetParsed, authenticatedRatings);

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

/**
 * Enrich ratings array with source metadata (lens, credibility).
 * @param {Object[]} ratings - Raw ratings
 * @returns {Object[]} Enriched ratings
 * @private
 */
function enrichRatingsWithMetadata(ratings) {
  return ratings.map(r => {
    const config = getSourceConfig(r.source);
    return {
      ...r,
      lens: config?.lens || r.lens,
      credibility: LENS_CREDIBILITY[config?.lens] || 1.0
    };
  });
}

/**
 * Extract ratings from snippets and merge into parsed results.
 * @param {Object} parsed - Existing parsed results (mutated)
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {Object[]} snippetsForExtraction - Snippets to extract from
 * @returns {Promise<void>}
 * @private
 */
async function mergeSnippetRatings(parsed, wineName, vintage, snippetsForExtraction) {
  logger.info('Ratings', `Extracting from ${snippetsForExtraction.length} snippets...`);
  const snippetPrompt = buildSnippetExtractionPrompt(wineName, vintage, snippetsForExtraction);
  const snippetModel = getModelForTask('ratings');

  try {
    const snippetResponse = await anthropic.messages.create({
      model: snippetModel,
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

/**
 * Merge authenticated ratings into parsed results (authenticated take precedence).
 * @param {Object} parsed - Existing parsed results (mutated)
 * @param {Object[]} authenticatedRatings - Ratings from authenticated sources
 * @private
 */
function mergeAuthenticatedRatings(parsed, authenticatedRatings) {
  const allRatings = [...authenticatedRatings];
  const authenticatedSources = new Set(authenticatedRatings.map(r => r.source));

  // Add scraped ratings that aren't already covered by authenticated sources
  for (const rating of (parsed.ratings || [])) {
    if (!authenticatedSources.has(rating.source)) {
      allRatings.push(rating);
    }
  }

  parsed.ratings = allRatings;
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
  Producer Website: producer_website (for awards displayed on the winery's own site)

IMPORTANT - Aggregator sites (Wine-Searcher, Dan Murphy's, BBR):
- These sites CITE ratings from original critics. Look for patterns like:
  "Wine Advocate: 92" \u2192 source: "wine_advocate", raw_score: "92"
  "Wine Spectator: 95 points" \u2192 source: "wine_spectator", raw_score: "95"
  "James Suckling 93" \u2192 source: "james_suckling", raw_score: "93"
  "Critic Score: 92" or "Critics Score" \u2192 extract the score with lens: "critic"
- If source is clearly stated, use the ORIGINAL source, not "wine_searcher"
- If just "WS Score: 92" without clear attribution, use source: "wine_searcher" lens: "aggregator"
- Wine-Searcher often shows aggregated scores - extract any critic scores with attribution

IMPORTANT - Producer/Winery websites (sourceId contains "producer_website"):
- Wineries often display awards, medals, and accolades prominently on their sites
- Look for "Awards", "Accolades", "Recognition", "Achievements" sections
- Common patterns:
  "Gold Medal - International Wine Challenge 2023" \u2192 source: "iwc", raw_score: "Gold", lens: "competition"
  "92 points Wine Spectator" \u2192 source: "wine_spectator", raw_score: "92", lens: "critic"
  "Decanter Gold 2024" \u2192 source: "decanter", raw_score: "Gold", lens: "competition"
  "5 Stars Platter's Guide" \u2192 source: "platters", raw_score: "5", lens: "panel_guide"
- If the competition/critic is identifiable, use the ORIGINAL source (iwc, decanter, etc.)
- If the award source is unclear but clearly displayed, use source: "producer_website" lens: "producer"
- Extract ANY medals, points, or awards displayed regardless of vintage - but mark vintage_match correctly

- lens: "competition", "panel_guide", "critic", "community", "aggregator", or "producer"
- score_type: "medal", "points", "stars", or "symbol"
- raw_score: The EXACT score as shown (e.g., "Gold", "92", "4.2", "Tre Bicchieri", "\u2605\u2605\u2605", "17/20")
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
- French: "\u00c0 boire jusqu'en 2028" (drink until 2028)

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
  "grape_varieties": ["Grape1", "Grape2"],
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
- Extract grape_varieties: list grape/variety names found for this wine (e.g., ["Cabernet Sauvignon", "Merlot"]). Empty array if not visible.
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
- French symbols: "\u2605\u2605\u2605", "Coup de Coeur"

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
  Producer Website: producer_website (for awards from winery's own site)

IMPORTANT - Aggregator snippets (Wine-Searcher, Dan Murphy's):
- Look for patterns citing original critics:
  "Wine Advocate 92" \u2192 source: "wine_advocate", raw_score: "92"
  "Critics Score: 90" \u2192 extract the score with lens: "critic"
- Use original source name when clearly attributed

IMPORTANT - Producer/Winery website snippets:
- Look for awards, medals, accolades displayed by the producer
- "Gold Medal IWC 2023" \u2192 source: "iwc", raw_score: "Gold"
- "92 pts Wine Spectator" \u2192 source: "wine_spectator", raw_score: "92"
- If competition unclear, use source: "producer_website" lens: "producer"

- lens: "community", "critic", "panel_guide", "competition", "aggregator", or "producer"
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
  "grape_varieties": ["Grape1", "Grape2"],
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
- Extract grape_varieties: list grape/variety names if visible (e.g., ["Shiraz", "Grenache"]). Empty array if not visible.
- If no ratings visible: {"ratings": [], "tasting_notes": null, "search_notes": "No ratings visible in snippets"}`;
}

/**
 * Parse rating response using shared JSON extraction with repair.
 * @param {string} text - Response text
 * @param {string} source - Source label for logging
 * @returns {Object} Parsed ratings
 */
function parseRatingResponse(text, source = 'Unknown') {
  try {
    const parsed = extractJsonWithRepair(text);
    if (parsed.ratings && Array.isArray(parsed.ratings)) {
      return parsed;
    }
    // Valid JSON but missing ratings array
    return { ...parsed, ratings: parsed.ratings || [] };
  } catch {
    logger.error('Claude', `[${source}] Failed to parse: ` + text.substring(0, 300));
    return {
      ratings: [],
      search_notes: `${source}: Could not parse results`
    };
  }
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
        await db.prepare(`
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
