/**
 * @fileoverview Multi-provider search service for wine ratings (orchestrator).
 *
 * This module coordinates the search pipeline and re-exports all public APIs
 * from the sub-modules it delegates to. Consumer files import from this barrel
 * module so existing import paths remain stable.
 *
 * Sub-modules:
 *   searchConstants    - Shared constants (BLOCKED_DOMAINS, BRIGHTDATA_API_URL, RANGE_QUALIFIERS)
 *   searchBudget       - Budget tracking (SERP calls, bytes, wall-clock)
 *   fetchUtils         - Timeout/abort, conditional headers, hashing, discovery confidence
 *   countryInference   - Country/locale detection from style & region
 *   grapeDetection     - Grape variety detection from wine name
 *   scoreNormalization - Medal/symbol → 0-100 normalisation
 *   drinkingWindowParser - Drinking window extraction
 *   sourceSelection    - Source ranking and selection
 *   searchGoogle       - SERP API calls (Bright Data + Google fallback)
 *   pageFetcher        - Web page / document content fetching
 *   nameProcessing     - Wine name tokenisation, variations, producer extraction
 *   producerSearch     - Producer website & document search
 *   relevanceScoring   - URL/result relevance scoring
 *   decanterScraper    - Decanter.com scraping logic
 *   authenticatedScraping - Credential management & Decanter authenticated fetch
 *
 * @module services/search/searchProviders
 */

// ── Re-exports (symbols NOT used by the orchestrator below) ─────────────

export { normaliseScore } from '../ratings/scoreNormalization.js';
export { parseDrinkingWindow, parseVivinoWindow } from '../wine/drinkingWindowParser.js';
export { fetchPageContent } from '../scraping/pageFetcher.js';
export {
  getCredentials,
  updateCredentialStatus,
  fetchDecanterAuthenticated,
  fetchAuthenticatedRatings
} from '../scraping/authenticatedScraping.js';

// ── Imports used by the orchestrator (also re-exported below) ───────────

import logger from '../../utils/logger.js';
import { detectQualifiers, detectLocaleHints } from '../../config/rangeQualifiers.js';
import { getLocaleParams, buildQueryVariants } from './queryBuilder.js';
import { generateIdentityTokens } from '../wine/wineIdentity.js';
import { scoreAndRankUrls, applyMarketCaps } from './urlScoring.js';
import { LIMITS } from '../../config/scraperConfig.js';

import { createSearchBudgetTracker, hasWallClockBudget } from './searchBudget.js';
import { calculateDiscoveryConfidence } from '../shared/fetchUtils.js';
import { inferCountryFromStyle } from '../wine/countryInference.js';
import { detectGrape } from '../wine/grapeDetection.js';
import { getSourcesForWine } from '../ratings/sourceSelection.js';
import { searchGoogle } from './searchGoogle.js';
import {
  extractSearchTokens, buildSourceQuery, generateWineNameVariations
} from '../wine/nameProcessing.js';
import { searchProducerWebsite } from './producerSearch.js';
import { calculateResultRelevance } from './relevanceScoring.js';

// Re-export symbols that are also used internally
export { inferCountryFromStyle, detectGrape, getSourcesForWine, searchGoogle };

// ── Main orchestrator ───────────────────────────────────────────────────

/**
 * Multi-tier search for wine ratings.
 * Runs Google and Brave searches in parallel for better coverage.
 * Uses grape detection for grape-specific competition sources.
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @param {string} country - Country of origin
 * @param {string} style - Wine style (e.g., "Languedoc Red Blend")
 * @returns {Promise<Object>} Search results
 */
export async function searchWineRatings(wineName, vintage, country, style = null) {
  // Build wine object from parameters for identity validation and locale selection
  const wine = { wine_name: wineName, vintage, country, style };

  // Detect grape variety from wine name
  const detectedGrape = detectGrape(wineName);

  // Detect range qualifiers and locale hints for improved scoring
  const qualifiers = detectQualifiers(wineName);
  const localeHints = detectLocaleHints(wineName);

  if (qualifiers.length > 0) {
    logger.info('Search', `Detected qualifiers: ${qualifiers.map(q => q.term).join(', ')}`);
  }
  if (Object.keys(localeHints).length > 0) {
    logger.info('Search', `Detected locale hints: ${Object.entries(localeHints).map(([loc, conf]) => `${loc}:${(conf * 100).toFixed(0)}%`).join(', ')}`);
  }

  const budget = createSearchBudgetTracker();
  logger.info(
    'Budget',
    `Search budget - SERP:${budget.limits.MAX_SERP_CALLS}, Docs:${budget.limits.MAX_DOCUMENT_FETCHES}, Bytes:${Math.round(budget.limits.MAX_TOTAL_BYTES / 1024 / 1024)}MB, Wall:${budget.limits.MAX_WALL_CLOCK_MS}ms`
  );

  // Infer country from style if not provided or unknown
  let effectiveCountry = country;
  if (!country || country === 'Unknown' || country === '') {
    const inferredCountry = inferCountryFromStyle(style);
    if (inferredCountry) {
      logger.info('Search', `Inferred country "${inferredCountry}" from style "${style}"`);
      effectiveCountry = inferredCountry;
    }
  }

  // Get sources using enhanced selection (includes grape-specific competitions)
  const sources = getSourcesForWine(effectiveCountry, detectedGrape);
  const topSources = sources.slice(0, 10); // Top 10 by priority (increased from 8)
  const wineNameVariations = generateWineNameVariations(wineName);

  logger.separator();
  logger.info('Search', `Wine: "${wineName}" ${vintage}`);
  logger.info('Search', `Country: ${effectiveCountry || 'Unknown'}${effectiveCountry !== country ? ` (inferred from "${style}")` : ''}`);
  if (detectedGrape) {
    logger.info('Search', `Detected grape: ${detectedGrape}`);
  }
  logger.info('Search', `Name variations: ${wineNameVariations.join(', ')}`);
  logger.info('Search', `Top sources: ${topSources.map(s => s.id).join(', ')}`);

  // Strategy 1: Targeted searches + Producer search (run in PARALLEL)
  const targetedResults = [];

  // Get grape-specific competitions first (if grape detected)
  const grapeCompetitions = detectedGrape
    ? topSources.filter(s => s.lens === 'competition' && s.grape_affinity).slice(0, 2)
    : [];
  const topCompetitions = topSources.filter(s => s.lens === 'competition' && !s.grape_affinity).slice(0, 3);
  const topCritics = topSources.filter(s => s.lens === 'critic' || s.lens === 'panel_guide').slice(0, 2);
  const communitySource = topSources.find(s => s.lens === 'community');

  const prioritySources = [...grapeCompetitions, ...topCompetitions, ...topCritics, ...(communitySource ? [communitySource] : [])].slice(0, 7);
  logger.info('Search', `Targeted sources: ${prioritySources.map(s => s.id).join(', ')}`);

  // Run targeted searches in parallel
  const targetedSearchPromises = prioritySources.map(source => {
    const query = buildSourceQuery(source, wineName, vintage);
    logger.info('Search', `Targeted search for ${source.id}: "${query}"`);

    return searchGoogle(query, [source.domain], 'serp_targeted', budget).then(results =>
      results.map(r => ({
        ...r,
        sourceId: source.id,
        lens: source.lens,
        credibility: source.credibility,
        relevance: source.relevance
      }))
    );
  });

  // Run producer search IN PARALLEL with targeted searches
  const producerController = new AbortController();

  const producerSearchPromise = (async () => {
    const hasLowAmbiguityQualifier = qualifiers.some(q => q.ambiguity === 'low');
    const hasHighTokenCount = wineName.split(/\s+/).length >= 7;
    const isMissingVintage = !vintage || vintage === 'NV';
    const hasProducerToken = /\b(domaine|weingut|château|bodega|tenuta)\b/i.test(wineName);

    const startImmediately = hasLowAmbiguityQualifier || hasHighTokenCount || isMissingVintage || hasProducerToken;
    const delayMs = startImmediately ? 0 : LIMITS.PRODUCER_SEARCH_DELAY_MS;

    if (delayMs > 0) {
      logger.info('Producer', `Delayed start: ${delayMs}ms (waiting for targeted results)`);
    } else {
      logger.info('Producer', 'Starting immediately (hard wine detected)');
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));

    if (producerController.signal.aborted) {
      logger.info('Producer', 'Skipped (discovery results were sufficient)');
      return [];
    }

    try {
      return await searchProducerWebsite(wineName, vintage, effectiveCountry, budget, producerController.signal);
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.info('Producer', 'Search aborted');
        return [];
      }
      throw err;
    }
  })();

  // Wait for both targeted and producer searches together
  const [targetedResultsArrays, producerResults] = await Promise.all([
    Promise.all(targetedSearchPromises),
    producerSearchPromise
  ]);

  targetedResultsArrays.forEach(results => targetedResults.push(...results));

  // Check if discovery results are high-confidence; if so, abort producer search
  const discoveryConfidence = calculateDiscoveryConfidence(targetedResults);
  if (discoveryConfidence >= LIMITS.MIN_DISCOVERY_CONFIDENCE && !producerController.signal.aborted) {
    logger.info('Search', `Discovery confidence ${(discoveryConfidence * 100).toFixed(0)}% >= ${(LIMITS.MIN_DISCOVERY_CONFIDENCE * 100).toFixed(0)}%, aborting producer search`);
    producerController.abort();
  }

  logger.info('Search', `Targeted searches found: ${targetedResults.length} results`);
  if (producerResults.length > 0) {
    logger.info('Search', `Producer search found: ${producerResults.length} result(s) (including documents: ${producerResults.filter(r => r.isDocument).length})`);
  }

  // Strategy 2: Broad Google search for remaining domains
  const remainingDomains = topSources.slice(3).map(s => s.domain);

  const { hl, gl } = getLocaleParams({ country: wine.country || wine.winery?.country || null });
  const queryVariants = buildQueryVariants(
    { wine_name: wineName, vintage, country: wine.country || null },
    'reviews'
  );

  const broadQuery = queryVariants.primary || `${extractSearchTokens(wineName).join(' ')} ${vintage} rating`;

  const broadResults = remainingDomains.length > 0
    ? await searchGoogle(broadQuery, remainingDomains, 'serp_broad', budget, { hl, gl })
    : [];

  logger.info('Search', `Broad search found: ${broadResults.length} results (${hl}/${gl})`);

  // Strategy 3: Try name variations with Google if we still have few results
  const variationResults = [];
  const shouldTryVariations = targetedResults.length + broadResults.length + producerResults.length < 5 && wineNameVariations.length > 1;
  if (shouldTryVariations && hasWallClockBudget(budget)) {
    logger.info('Search', 'Trying wine name variations...');
    for (const variation of wineNameVariations.slice(1)) {
      const varTokens = extractSearchTokens(variation);
      const varResults = await searchGoogle(`${varTokens.join(' ')} ${vintage} wine rating`, [], 'serp_variation', budget);
      variationResults.push(...varResults);
      if (variationResults.length >= 5) break;
    }
    logger.info('Search', `Variation searches found: ${variationResults.length} results`);
  } else if (shouldTryVariations && !hasWallClockBudget(budget)) {
    logger.warn('Budget', 'Wall-clock budget exceeded; skipping variation searches');
  }

  // Combine and deduplicate by URL
  const allResults = [...targetedResults, ...producerResults, ...broadResults, ...variationResults];
  const seen = new Set();
  const uniqueResults = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // URL Scoring & Ranking (Phase 4 Integration)
  // ═══════════════════════════════════════════════════════════════════════════

  const identityTokens = generateIdentityTokens({
    producer_name: wine.winery || wine.producer || '',
    winery: wine.winery || wine.producer || '',
    range_name: wine.wine_name || '',
    grape_variety: wine.grapes || '',
    country: wine.country || country || '',
    region: wine.region || '',
    wine_type: wine.colour || wine.style || 'unknown',
    vintage: wine.vintage || vintage
  });

  const rankedUrls = scoreAndRankUrls(
    uniqueResults.map(r => ({
      url: r.url,
      title: r.title || '',
      snippet: r.snippet || '',
      domain: r.source || '',
      source: r.sourceId,
      position: r.position,
      lens: r.lens
    })),
    identityTokens,
    wine.country || country || 'default'
  );

  const cappedUrls = applyMarketCaps(rankedUrls, wine.country || country || 'default');

  logger.info('Search', `URL scoring: ${uniqueResults.length} raw → ${rankedUrls.length} valid → ${cappedUrls.length} capped`);

  // Merge scored URLs back with original result data
  const urlScoreMap = new Map(cappedUrls.map(u => [u.url, u]));
  const scoredResults = uniqueResults
    .filter(r => urlScoreMap.has(r.url))
    .map(r => {
      const scored = urlScoreMap.get(r.url);
      return {
        ...r,
        identityScore: scored.identityScore,
        identityValid: scored.identityValid,
        fetchPriority: scored.fetchPriority,
        discoveryScore: scored.discoveryScore,
        compositeScore: scored.compositeScore
      };
    })
    .sort((a, b) => {
      if (a.compositeScore.identity !== b.compositeScore.identity) {
        return b.compositeScore.identity - a.compositeScore.identity;
      }
      if (a.compositeScore.priority !== b.compositeScore.priority) {
        return b.compositeScore.priority - a.compositeScore.priority;
      }
      return b.compositeScore.discovery - a.compositeScore.discovery;
    });

  // Fallback: If URL scoring filtered out too many results, use legacy relevance scoring
  if (scoredResults.length === 0 && uniqueResults.length > 0) {
    logger.warn('Search', 'URL scoring rejected all results, falling back to legacy relevance scoring');
    const fallbackScored = uniqueResults
      .map(r => {
        const { relevant, score, isProducerSite } = calculateResultRelevance(r, wineName, vintage);
        return { ...r, relevant, relevanceScore: score, isProducerSite };
      })
      .filter(r => r.relevant);

    scoredResults.push(...fallbackScored.slice(0, 8));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy enrichment (kept for compatibility)
  // ═══════════════════════════════════════════════════════════════════════════

  const legacyFiltered = scoredResults.filter(r => !r.identityScore);
  if (legacyFiltered.length > 0) {
    legacyFiltered.forEach(r => {
      const { relevant, score, isProducerSite } = calculateResultRelevance(r, wineName, vintage);
      r.relevant = relevant;
      r.relevanceScore = score;
      r.isProducerSite = isProducerSite;
    });
  }

  // Log producer sites found
  const producerSites = scoredResults.filter(r => r.isProducerSite);
  if (producerSites.length > 0) {
    logger.info('Search', `Found ${producerSites.length} producer website(s): ${producerSites.map(r => r.source).join(', ')}`);
  }

  logger.info('Search', `Filtered to ${scoredResults.length} relevant results (from ${uniqueResults.length})`);

  // Enrich results without source metadata
  const enrichedResults = scoredResults.map(r => {
    if (r.sourceId) return r;

    const matchedSource = sources.find(s =>
      r.source?.includes(s.domain) ||
      s.alt_domains?.some(d => r.source?.includes(d))
    );

    return {
      ...r,
      sourceId: matchedSource?.id || 'unknown',
      lens: matchedSource?.lens || 'unknown',
      credibility: matchedSource?.credibility || 0.5,
      relevance: matchedSource?.relevance || 0.5
    };
  });

  // Corroboration gate
  const tasteAtlasResults = enrichedResults.filter(r => r.sourceId === 'tasteatlasranked' || r.lens === 'community');
  if (tasteAtlasResults.length > 0) {
    const authoritativeSources = enrichedResults.filter(r =>
      ['producer', 'competition', 'critic', 'panel_guide'].includes(r.lens)
    );

    tasteAtlasResults.forEach(tasteAtlasResult => {
      tasteAtlasResult.requires_corroboration = true;

      if (authoritativeSources.length > 0) {
        tasteAtlasResult.has_corroboration = true;
        tasteAtlasResult.corroboration_count = authoritativeSources.length;
      } else {
        tasteAtlasResult.has_corroboration = false;
        logger.warn('Search', `TasteAtlas claim "${tasteAtlasResult.title}" has no authoritative corroboration`);
      }
    });
  }

  // Sort by relevance score first, then by source credibility
  enrichedResults.sort((a, b) => {
    const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (Math.abs(scoreDiff) > 2) return scoreDiff;

    return (b.credibility * b.relevance) - (a.credibility * a.relevance);
  });

  // Log top results for debugging
  if (enrichedResults.length > 0) {
    logger.info('Search', `Top result: "${enrichedResults[0].title}" (score: ${enrichedResults[0].relevanceScore}, source: ${enrichedResults[0].sourceId})`);
  }

  return {
    query: broadQuery,
    country: country || 'Unknown',
    detected_grape: detectedGrape,
    results: enrichedResults.slice(0, 10),
    sources_searched: topSources.length,
    targeted_hits: targetedResults.length,
    broad_hits: broadResults.length,
    variation_hits: variationResults.length,
    producer_hits: producerResults.length
  };
}
