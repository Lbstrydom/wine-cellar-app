/**
 * @fileoverview Citation frequency scoring for unified wine search results.
 * Scores source URLs by how often they appear in Claude's inline citations,
 * with a credibility overlay from unifiedSources.js domain matching.
 *
 * Used by callers of unifiedWineSearch() to rank the most trusted and
 * frequently-cited sources in a search result.
 *
 * @module services/search/citationScoring
 */

import { SOURCES } from '../../config/unifiedSources.js';

/**
 * Score source URLs by citation frequency with domain trust overlay.
 *
 * Algorithm:
 * - Count how often each URL appears in the citations array
 * - Normalize: citationScore = count / maxCount (range 0.1–1.0; uncited = 0.1)
 * - Overlay domain credibility from SOURCES registry
 * - Composite: 70% citation frequency + 30% domain trust
 *
 * @param {string[]} citations - URLs cited inline by Claude (from _citations)
 * @param {Array<{url: string, title: string}>} sourceUrls - All URLs from search results (from _sources)
 * @param {string} [country] - Wine country (reserved for future regional weighting)
 * @returns {Array<{url: string, title: string, citationCount: number, citationScore: number, credibility: number, compositeScore: number}>}
 */
export function scoreByCitationFrequency(citations, sourceUrls, country) {
  if (!sourceUrls?.length) return [];

  // Count citations per URL
  const citationCount = new Map();
  for (const url of citations || []) {
    citationCount.set(url, (citationCount.get(url) || 0) + 1);
  }

  const maxCount = citationCount.size > 0 ? Math.max(...citationCount.values()) : 1;

  return sourceUrls.map(source => {
    const count = citationCount.get(source.url) || 0;
    const citationScore = count > 0 ? count / maxCount : 0.1;
    const credibility = getDomainCredibility(source.url);
    // Composite: citation frequency weighted higher than static domain trust
    const compositeScore = (citationScore * 0.7) + (credibility * 0.3);

    return {
      ...source,
      citationCount: count,
      citationScore,
      credibility,
      compositeScore
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);
}

/**
 * Look up credibility for a URL by matching against known source domains.
 * Returns 0.5 for unknown domains (neutral).
 *
 * @param {string} url - Source URL
 * @returns {number} Credibility score (0–1)
 */
function getDomainCredibility(url) {
  if (!url) return 0.5;

  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 0.5;
  }

  for (const source of Object.values(SOURCES)) {
    if (source.domain && hostname.includes(source.domain)) {
      return source.credibility;
    }
    if (source.alt_domains) {
      for (const altDomain of source.alt_domains) {
        if (hostname.includes(altDomain)) {
          return source.credibility;
        }
      }
    }
  }

  return 0.5;
}

export default { scoreByCitationFrequency };
