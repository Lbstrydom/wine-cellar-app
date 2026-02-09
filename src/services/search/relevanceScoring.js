/**
 * @fileoverview URL/result relevance scoring for wine search results.
 * Two-layer precision scoring with range qualifier matching.
 * @module services/search/relevanceScoring
 */

import { RERANK_WEIGHTS } from '../../config/scraperConfig.js';
import { RANGE_QUALIFIERS } from './searchConstants.js';

/**
 * Check if a URL appears to be the producer/winery's own website.
 * @param {string} url - URL to check
 * @param {string} wineNameLower - Lowercase wine name
 * @param {string[]} keyWords - Key words from wine name
 * @returns {boolean} True if likely a producer site
 */
export function checkIfProducerSite(url, wineNameLower, keyWords) {
  // Known retailer/aggregator domains to exclude
  const knownRetailers = [
    'vivino.com', 'wine-searcher.com', 'cellartracker.com', 'totalwine.com',
    'wine.com', 'winespectator.com', 'decanter.com', 'jancisrobinson.com',
    'jamessuckling.com', 'robertparker.com', 'winemag.com', 'nataliemaclean.com',
    'winealign.com', 'internationalwinechallenge.com', 'iwsc.net', 'amazon.com',
    'wikipedia.org', 'facebook.com', 'instagram.com', 'twitter.com'
  ];

  if (knownRetailers.some(r => url.includes(r))) {
    return false;
  }

  let domain = '';
  try {
    domain = new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch {
    return false;
  }

  // Check if domain contains any key words from wine name (producer name)
  const domainWithoutTld = domain.replace(/\.(com|org|net|co\.za|co\.nz|co\.uk|co\.ar|com\.au|com\.ar|com\.br|com\.mx|wine|wines|vin|vino|fr|it|es|de|cl|ar|au|nz|pt|za|at|ch|gr|hu|ro|bg|hr|si|rs|ge|am|lb|il|us|ca|mx|br|uy|pe)$/, '');

  for (const word of keyWords) {
    if (word.length >= 4 && domainWithoutTld.includes(word.replace(/[^a-z0-9]/g, ''))) {
      return true;
    }
  }

  // Check for common winery URL patterns
  const wineryPatterns = ['/product/', '/wines/', '/our-wines/', '/wine/', '/shop/'];
  if (wineryPatterns.some(p => url.includes(p))) {
    if (domainWithoutTld.length > 5 && !domainWithoutTld.includes('wine-shop')) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate result relevance with TWO-LAYER precision scoring.
 *
 * Layer 1 (Discovery): Simplified names help find producer pages
 * Layer 2 (Precision): Results are re-ranked by match to ORIGINAL name,
 *                      especially range qualifiers like "Vineyard Selection"
 *
 * @param {Object} result - Search result
 * @param {string} wineName - ORIGINAL wine name (not simplified)
 * @param {string|number} vintage - Vintage year
 * @returns {Object} { relevant, score, isProducerSite, rangeMatch, rankingExplanation }
 */
export function calculateResultRelevance(result, wineName, vintage) {
  const title = (result.title || '').toLowerCase();
  const snippet = (result.snippet || '').toLowerCase();
  const titleAndSnippet = `${title} ${snippet}`;
  const wineNameLower = wineName.toLowerCase();

  // Feature contribution logging
  const rankingExplanation = {
    base: 0,
    features: []
  };

  // Extract key words from wine name
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'of', 'de', 'du', 'la', 'le', 'les', 'das', 'der', 'die',
    'del', 'della', 'di', 'da', 'wines', 'wine', 'estate', 'winery', 'vineyards', 'vineyard'
  ]);

  const keyWords = wineNameLower
    .replace(/[''`]/g, '')
    .replace(/\([^)]+\)/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  // Count exact matches in title vs snippet
  const titleMatchCount = keyWords.filter(w => title.includes(w)).length;
  const snippetMatchCount = keyWords.filter(w => snippet.includes(w)).length;

  // Also check for partial/fuzzy matches
  let fuzzyTitleMatches = 0;
  let fuzzySnippetMatches = 0;
  for (const word of keyWords) {
    if (word.length >= 5) {
      const prefix = word.substring(0, Math.min(4, word.length - 1));
      if (title.includes(prefix) && !title.includes(word)) {
        fuzzyTitleMatches++;
      }
      if (snippet.includes(prefix) && !snippet.includes(word)) {
        fuzzySnippetMatches++;
      }
    }
  }

  const hasVintageInTitle = vintage && title.includes(String(vintage));
  const hasVintageInSnippet = vintage && snippet.includes(String(vintage));

  // Calculate relevance score with feature logging
  let score = 0;

  const titleScore = titleMatchCount * 3;
  const snippetScore = snippetMatchCount * 1;
  const fuzzyTitleScore = fuzzyTitleMatches * 1.5;
  const fuzzySnippetScore = fuzzySnippetMatches * 0.5;

  score += titleScore;
  score += snippetScore;
  score += fuzzyTitleScore;
  score += fuzzySnippetScore;

  rankingExplanation.base = score;
  if (titleMatchCount > 0) {
    rankingExplanation.features.push(`+${titleScore} (${titleMatchCount} title matches)`);
  }
  if (snippetMatchCount > 0) {
    rankingExplanation.features.push(`+${snippetScore} (${snippetMatchCount} snippet matches)`);
  }
  if (fuzzyTitleMatches > 0) {
    rankingExplanation.features.push(`+${fuzzyTitleScore.toFixed(1)} (${fuzzyTitleMatches} fuzzy title)`);
  }
  if (fuzzySnippetMatches > 0) {
    rankingExplanation.features.push(`+${fuzzySnippetScore.toFixed(1)} (${fuzzySnippetMatches} fuzzy snippet)`);
  }

  const hasFullTitleMatch = keyWords.length > 0 && keyWords.every(w => title.includes(w));
  if (hasFullTitleMatch) {
    score += RERANK_WEIGHTS.FULL_NAME_MATCH;
    rankingExplanation.features.push(`+${RERANK_WEIGHTS.FULL_NAME_MATCH} (full name in title)`);
  }

  // Vintage matching
  if (hasVintageInTitle) {
    score += RERANK_WEIGHTS.EXACT_VINTAGE_MATCH;
    rankingExplanation.features.push(`+${RERANK_WEIGHTS.EXACT_VINTAGE_MATCH} (vintage in title: ${vintage})`);
  } else if (hasVintageInSnippet) {
    score += 2;
    rankingExplanation.features.push(`+2 (vintage in snippet: ${vintage})`);
  } else if (vintage) {
    score += RERANK_WEIGHTS.VINTAGE_MISSING;
    rankingExplanation.features.push(`${RERANK_WEIGHTS.VINTAGE_MISSING} (vintage missing: ${vintage})`);
  }

  // LAYER 2: PRECISION SCORING - Range/Tier Qualifier Matching
  let rangeMatch = null;
  let rangeBonus = 0;

  for (const qualifier of RANGE_QUALIFIERS) {
    if (wineNameLower.includes(qualifier)) {
      const qualifierInResult = titleAndSnippet.includes(qualifier);
      if (qualifierInResult) {
        rangeMatch = qualifier;
        rangeBonus = RERANK_WEIGHTS.RANGE_QUALIFIER_MATCH;
        rankingExplanation.features.push(`+${RERANK_WEIGHTS.RANGE_QUALIFIER_MATCH} (range match: "${qualifier}")`);
        break;
      } else {
        rangeBonus = RERANK_WEIGHTS.RANGE_QUALIFIER_MISS;
        rankingExplanation.features.push(`${RERANK_WEIGHTS.RANGE_QUALIFIER_MISS} (range missing: "${qualifier}")`);
      }
    }
  }

  score += rangeBonus;

  // Bonus for rating/review sites
  const isRatingPage = titleAndSnippet.includes('rating') ||
    titleAndSnippet.includes('review') ||
    titleAndSnippet.includes('points') ||
    titleAndSnippet.includes('score') ||
    titleAndSnippet.includes('gold') ||
    titleAndSnippet.includes('silver') ||
    titleAndSnippet.includes('bronze') ||
    titleAndSnippet.includes('medal') ||
    titleAndSnippet.includes('award');
  if (isRatingPage && (titleMatchCount >= 1 || fuzzyTitleMatches >= 1)) {
    score += 3;
    rankingExplanation.features.push('+3 (rating/review page)');
  }

  // Bonus for producer/winery websites
  const url = (result.url || '').toLowerCase();
  const isProducerSite = checkIfProducerSite(url, wineNameLower, keyWords);
  if (isProducerSite) {
    score += RERANK_WEIGHTS.PRODUCER_ONLY_MATCH;
    rankingExplanation.features.push(`+${RERANK_WEIGHTS.PRODUCER_ONLY_MATCH} (producer site)`);

    if (rangeMatch) {
      score += 3;
      rankingExplanation.features.push('+3 (producer + range match)');
    }
  }

  // Penalty for generic competition/award list pages
  const isGenericAwardPage =
    (title.includes('results') || title.includes('winners') || title.includes('champion')) &&
    titleMatchCount < 1;
  if (isGenericAwardPage) {
    score -= 3;
    rankingExplanation.features.push('-3 (generic award list)');
  }

  // Determine relevance
  const totalExactMatches = titleMatchCount + snippetMatchCount;
  const totalFuzzyMatches = fuzzyTitleMatches + fuzzySnippetMatches;
  const hasVintage = hasVintageInTitle || hasVintageInSnippet;

  const relevant =
    totalExactMatches >= 2 ||
    (totalExactMatches >= 1 && totalFuzzyMatches >= 1) ||
    (totalExactMatches >= 1 && hasVintage) ||
    (totalFuzzyMatches >= 2 && hasVintage);

  return {
    relevant,
    score,
    isProducerSite,
    rangeMatch,
    rankingExplanation: {
      totalScore: score,
      ...rankingExplanation
    }
  };
}
