/**
 * @fileoverview Wraps wineIdentity.js for benchmark scoring with metrics.
 * Ranks SERP results by identity match and calculates benchmark metrics.
 */

import {
  generateIdentityTokens,
  calculateIdentityScore,
  calculateDiscoveryTokenOverlap
} from '../../src/services/wineIdentity.js';

/**
 * Extract range name from gold canonical name by removing producer prefix.
 * @param {string} goldName - Full canonical wine name
 * @param {string} producer - Producer name
 * @returns {string} Range/cuvee name or empty string
 */
export function extractRangeName(goldName, producer) {
  if (!goldName || !producer) return '';

  // Remove producer prefix (case-insensitive)
  const producerPattern = new RegExp(`^${escapeRegex(producer)}\\s*`, 'i');
  let remaining = goldName.replace(producerPattern, '').trim();

  // Remove vintage suffix if present
  remaining = remaining.replace(/\s+\d{4}$/, '').trim();

  return remaining;
}

/**
 * Escape regex special characters.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize wine name for fuzzy matching.
 * @param {string} name - Wine name to normalize
 * @returns {string} Normalized name
 */
export function normalizeWineName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/(\w)['’`]s\b/g, '$1s')
    .replace(/['’`]/g, ' ')          // Normalize apostrophes
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Remove punctuation
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .trim();
}

/**
 * Calculate token-based fuzzy match between two wine names.
 * @param {string} a - First wine name (normalized)
 * @param {string} b - Second wine name (normalized)
 * @param {number} [threshold=0.7] - Minimum overlap for match
 * @returns {boolean} True if names match above threshold
 */
export function fuzzyMatch(a, b, threshold = 0.7) {
  const tokensA = getMatchTokens(a);
  const tokensB = getMatchTokens(b);

  if (tokensA.size === 0 || tokensB.size === 0) return false;

  const intersection = [...tokensB].filter(t => tokensA.has(t));
  const recall = intersection.length / tokensB.size;
  const sizeThreshold = tokensB.size <= 3 ? 1 : tokensB.size <= 5 ? 0.8 : threshold;

  return recall >= sizeThreshold;
}

/**
 * Tokenize a normalized wine name for matching.
 * @param {string} name - Normalized name
 * @returns {Set<string>} Token set for matching
 */
function getMatchTokens(name) {
  const stopTokens = new Set([
    'the', 'el', 'la', 'le', 'les', 'los', 'las',
    'de', 'del', 'di', 'da', 'du', 'von', 'van', 'der', 'den', 'st',
    'igt'
  ]);

  return new Set(
    name
      .split(' ')
      .filter(t => (t.length > 2 || /^\d{4}$/.test(t)) && !stopTokens.has(t))
  );
}

/**
 * Build wine object for identity token generation from benchmark case.
 * @param {BenchmarkCase} testCase - Benchmark case
 * @returns {Object} Wine object for generateIdentityTokens
 */
export function buildWineFromCase(testCase) {
  const rangeName = extractRangeName(testCase.gold_canonical_name, testCase.producer);

  return {
    winery: testCase.producer,
    vintage: testCase.vintage?.toString(),
    range_name: rangeName,
    country: testCase.country,
    // Extract grape from gold name if present (common varieties)
    grape_variety: extractGrapeFromName(testCase.gold_canonical_name)
  };
}

/**
 * Extract grape variety from wine name if present.
 * @param {string} wineName - Wine name
 * @returns {string|null} Grape variety or null
 */
function extractGrapeFromName(wineName) {
  if (!wineName) return null;

  const commonGrapes = [
    'cabernet sauvignon', 'pinot noir', 'merlot', 'syrah', 'shiraz',
    'chardonnay', 'sauvignon blanc', 'riesling', 'gewurztraminer',
    'tempranillo', 'sangiovese', 'nebbiolo', 'malbec', 'carmenere',
    'pinotage', 'chenin blanc', 'viognier', 'grenache', 'mourvedre',
    'zinfandel', 'pinot grigio', 'pinot gris', 'semillon', 'muscadet',
    'gruner veltliner', 'torrontes', 'albarino', 'verdejo', 'garnacha'
  ];

  const normalized = wineName.toLowerCase();

  for (const grape of commonGrapes) {
    if (normalized.includes(grape)) {
      return grape;
    }
  }

  return null;
}

/**
 * Rank SERP results by identity match to target wine.
 * @param {SerpResult[]} results - Organic search results
 * @param {BenchmarkCase} testCase - Benchmark case with wine details
 * @returns {RankedResult[]} Results sorted by identity score
 */
export function rankResults(results, testCase) {
  if (!results || results.length === 0) {
    return [];
  }

  const wine = buildWineFromCase(testCase);
  const tokens = generateIdentityTokens(wine);

  return results
    .map((result, originalIndex) => {
      // Combine title and snippet for scoring
      const text = `${result.title || ''} ${result.snippet || result.description || ''}`;
      const identityScore = calculateIdentityScore(text, tokens);
      const discoveryScore = calculateDiscoveryTokenOverlap(result.title || '', tokens.discovery);

      return {
        ...result,
        originalIndex,
        identityScore: identityScore.score,
        identityValid: identityScore.valid,
        identityReason: identityScore.reason,
        discoveryScore,
        matches: identityScore.matches
      };
    })
    .sort((a, b) => {
      // Primary: identity validity (valid results first)
      if (a.identityValid !== b.identityValid) return b.identityValid ? 1 : -1;

      // Secondary: identity score (higher is better)
      if (a.identityScore !== b.identityScore) return b.identityScore - a.identityScore;

      // Tertiary: discovery overlap (higher is better)
      return b.discoveryScore - a.discoveryScore;
    });
}

/**
 * Score how well ranking matches gold canonical name.
 * @param {RankedResult[]} ranking - Sorted results
 * @param {string} goldName - Expected canonical wine name
 * @returns {IdentityMatchScore}
 */
export function scoreIdentityMatch(ranking, goldName) {
  if (!ranking || ranking.length === 0) {
    return { position: 0, found: false, matchedTitle: null, identityScore: 0 };
  }

  const normalizedGold = normalizeWineName(goldName);

  for (let i = 0; i < ranking.length; i++) {
    const result = ranking[i];
    const normalizedResult = normalizeWineName(result.title || '');

    // Try fuzzy match on title
    if (fuzzyMatch(normalizedResult, normalizedGold)) {
      return {
        position: i + 1, // 1-indexed position
        found: true,
        matchedTitle: result.title,
        identityScore: result.identityScore,
        identityValid: result.identityValid
      };
    }

    // Also check snippet/description for wine name presence
    const snippetNormalized = normalizeWineName(result.snippet || result.description || '');
    if (fuzzyMatch(snippetNormalized, normalizedGold, 0.6)) {
      return {
        position: i + 1,
        found: true,
        matchedTitle: result.title,
        identityScore: result.identityScore,
        identityValid: result.identityValid,
        matchedIn: 'snippet'
      };
    }
  }

  return {
    position: 0,
    found: false,
    matchedTitle: null,
    identityScore: 0
  };
}

/**
 * Process a single benchmark case with SERP results.
 * @param {BenchmarkCase} testCase - Benchmark case
 * @param {SerpResponse} serpResponse - SERP response (from fixture or live)
 * @returns {CaseResult} Scored result
 */
export function processCase(testCase, serpResponse) {
  // Extract organic results from various SERP response formats
  const results = serpResponse.organic || serpResponse.results || serpResponse.items || [];

  // Rank results by identity match
  const ranking = rankResults(results, testCase);

  // Score against gold canonical name
  const score = scoreIdentityMatch(ranking, testCase.gold_canonical_name);

  return {
    caseId: testCase.id,
    query: testCase.query,
    country: testCase.country,
    producer: testCase.producer,
    challenges: testCase.challenges,
    goldName: testCase.gold_canonical_name,
    resultCount: results.length,
    ranking: ranking.slice(0, 10), // Top 10 for debugging
    score,
    hit_at_1: score.position === 1,
    hit_at_3: score.position >= 1 && score.position <= 3,
    hit_at_5: score.position >= 1 && score.position <= 5,
    reciprocal_rank: score.position > 0 ? 1 / score.position : 0
  };
}

/**
 * Calculate aggregate metrics across all results.
 * @param {CaseResult[]} results - Results from all benchmark cases
 * @returns {BenchmarkMetrics}
 */
export function calculateMetrics(results) {
  if (!results || results.length === 0) {
    return {
      total: 0,
      hit_at_1: 0,
      hit_at_3: 0,
      hit_at_5: 0,
      mrr: 0,
      by_country: {},
      by_challenge: {}
    };
  }

  const total = results.length;
  const hits_at_1 = results.filter(r => r.hit_at_1).length;
  const hits_at_3 = results.filter(r => r.hit_at_3).length;
  const hits_at_5 = results.filter(r => r.hit_at_5).length;
  const mrr = results.reduce((sum, r) => sum + r.reciprocal_rank, 0) / total;

  return {
    total,
    hit_at_1: hits_at_1 / total,
    hit_at_3: hits_at_3 / total,
    hit_at_5: hits_at_5 / total,
    mrr,
    by_country: groupMetricsByCountry(results),
    by_challenge: groupMetricsByChallenge(results)
  };
}

/**
 * Group metrics by country.
 * @param {CaseResult[]} results - All case results
 * @returns {Object} Metrics per country
 */
function groupMetricsByCountry(results) {
  const byCountry = {};

  for (const r of results) {
    if (!byCountry[r.country]) {
      byCountry[r.country] = {
        total: 0,
        hits_at_1: 0,
        hits_at_3: 0,
        rr_sum: 0
      };
    }

    byCountry[r.country].total++;
    if (r.hit_at_1) byCountry[r.country].hits_at_1++;
    if (r.hit_at_3) byCountry[r.country].hits_at_3++;
    byCountry[r.country].rr_sum += r.reciprocal_rank;
  }

  // Calculate final metrics per country
  for (const country of Object.keys(byCountry)) {
    const c = byCountry[country];
    byCountry[country] = {
      total: c.total,
      hit_at_1: c.hits_at_1 / c.total,
      hit_at_3: c.hits_at_3 / c.total,
      mrr: c.rr_sum / c.total
    };
  }

  return byCountry;
}

/**
 * Group metrics by challenge category.
 * @param {CaseResult[]} results - All case results
 * @returns {Object} Metrics per challenge
 */
function groupMetricsByChallenge(results) {
  const byChallenge = {};

  for (const r of results) {
    for (const challenge of r.challenges || []) {
      if (!byChallenge[challenge]) {
        byChallenge[challenge] = {
          total: 0,
          hits_at_1: 0,
          hits_at_3: 0,
          rr_sum: 0,
          caseIds: []
        };
      }

      byChallenge[challenge].total++;
      byChallenge[challenge].caseIds.push(r.caseId);
      if (r.hit_at_1) byChallenge[challenge].hits_at_1++;
      if (r.hit_at_3) byChallenge[challenge].hits_at_3++;
      byChallenge[challenge].rr_sum += r.reciprocal_rank;
    }
  }

  // Calculate final metrics per challenge
  for (const challenge of Object.keys(byChallenge)) {
    const c = byChallenge[challenge];
    byChallenge[challenge] = {
      total: c.total,
      hit_at_1: c.hits_at_1 / c.total,
      hit_at_3: c.hits_at_3 / c.total,
      mrr: c.rr_sum / c.total,
      caseIds: c.caseIds
    };
  }

  return byChallenge;
}

/**
 * Map challenge names to taxonomy categories.
 * @param {string} challenge - Challenge name
 * @returns {string} Category name
 */
export function getChallengeCategory(challenge) {
  const categoryMap = {
    // Name Complexity
    long_name: 'name_complexity',
    very_long_name: 'name_complexity',
    short_query: 'name_complexity',
    hyphenated_producer: 'name_complexity',
    apostrophe: 'name_complexity',
    definite_article: 'name_complexity',

    // Diacritics
    diacritics_optional: 'diacritics',
    umlaut_optional: 'diacritics',
    special_chars_optional: 'diacritics',
    accented_grape: 'diacritics',

    // Classification
    classification_reserva: 'classification',
    classification_gran_reserva: 'classification',
    premier_cru: 'classification',
    pradikat_term: 'classification',
    gg_term: 'classification',
    gg_abbrev: 'classification',
    igt_tokens: 'classification',

    // Vineyard
    single_vineyard: 'vineyard',
    vineyard_name: 'vineyard',
    vineyard_tokens: 'vineyard',
    finca_keyword: 'vineyard',
    estate_name: 'vineyard',
    estate_token: 'vineyard',

    // Brand/Producer
    brand_vs_producer: 'brand_producer',
    producer_as_brand: 'brand_producer',
    brand_only: 'brand_producer',
    brand_line: 'brand_producer',
    brand_family_range: 'brand_producer',
    producer_acronym: 'brand_producer',
    producer_small_footprint: 'brand_producer',

    // Numeric
    numeric_bin: 'numeric',
    numeric_cuvee: 'numeric',

    // Region
    subregion_token: 'region',
    appellation_token: 'region',
    region_tokens: 'region',
    village_token: 'region',

    // Special Types
    non_vintage: 'special_types',
    super_tuscan: 'special_types',
    appassimento_style: 'special_types',
    prestige_champagne: 'special_types',

    // Search Difficulty
    retail_noise: 'search_difficulty',
    many_retail_pages: 'search_difficulty',
    icon_wine: 'search_difficulty',
    icon_wine_short_query: 'search_difficulty',
    rare_high_value: 'search_difficulty',
    high_value: 'search_difficulty',
    low_critic_coverage: 'search_difficulty',

    // Disambiguation
    tier_name_hidden: 'disambiguation',
    tier_disambiguation: 'disambiguation',
    range_qualifier: 'disambiguation',
    translation_variant: 'disambiguation',
    generic_appellation: 'disambiguation',
    flagship: 'disambiguation',
    name_collision: 'disambiguation',
    cuvee_name: 'disambiguation',
    cuvee_spelling_variant: 'disambiguation',
    series_disambiguation: 'disambiguation',
    near_competitor_disambiguation: 'disambiguation',
    pinot_disambiguation: 'disambiguation'
  };

  return categoryMap[challenge] || 'other';
}

/**
 * Group metrics by challenge category (high-level).
 * @param {Object} byChallengeMetrics - Metrics per individual challenge
 * @returns {Object} Metrics per category
 */
export function groupByCategory(byChallengeMetrics) {
  const byCategory = {};

  for (const [challenge, metrics] of Object.entries(byChallengeMetrics)) {
    const category = getChallengeCategory(challenge);

    if (!byCategory[category]) {
      byCategory[category] = {
        total: 0,
        hits_at_1: 0,
        hits_at_3: 0,
        rr_sum: 0,
        challenges: []
      };
    }

    byCategory[category].total += metrics.total;
    byCategory[category].hits_at_1 += metrics.hit_at_1 * metrics.total;
    byCategory[category].hits_at_3 += metrics.hit_at_3 * metrics.total;
    byCategory[category].rr_sum += metrics.mrr * metrics.total;
    byCategory[category].challenges.push(challenge);
  }

  // Calculate final metrics per category
  for (const category of Object.keys(byCategory)) {
    const c = byCategory[category];
    byCategory[category] = {
      total: c.total,
      hit_at_1: c.hits_at_1 / c.total,
      hit_at_3: c.hits_at_3 / c.total,
      mrr: c.rr_sum / c.total,
      challenges: c.challenges
    };
  }

  return byCategory;
}

export default {
  extractRangeName,
  normalizeWineName,
  fuzzyMatch,
  buildWineFromCase,
  rankResults,
  scoreIdentityMatch,
  processCase,
  calculateMetrics,
  getChallengeCategory,
  groupByCategory
};
