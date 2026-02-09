/**
 * @fileoverview URL scoring and ranking for unified candidate pool.
 * Implements two-tier scoring: identity score (validity) and fetch priority (order).
 * @module services/search/urlScoring
 */

import { calculateIdentityScore, calculateDiscoveryTokenOverlap } from '../wine/wineIdentity.js';
import { LENS } from '../../config/unifiedSources.js';

/**
 * Market-aware per-lens caps for URL selection.
 * Different markets have different source landscapes.
 * @type {Object}
 */
const MARKET_CAPS = {
  'south africa': {
    [LENS.COMPETITION]: 3,
    [LENS.PANEL_GUIDE]: 2,
    [LENS.CRITIC]: 1,
    [LENS.COMMUNITY]: 1,
    [LENS.AGGREGATOR]: 1,
    [LENS.PRODUCER]: 2
  },
  'australia': {
    [LENS.COMPETITION]: 2,
    [LENS.PANEL_GUIDE]: 3,
    [LENS.CRITIC]: 1,
    [LENS.COMMUNITY]: 1,
    [LENS.AGGREGATOR]: 1,
    [LENS.PRODUCER]: 2
  },
  'france': {
    [LENS.COMPETITION]: 2,
    [LENS.PANEL_GUIDE]: 3,
    [LENS.CRITIC]: 1,
    [LENS.COMMUNITY]: 1,
    [LENS.AGGREGATOR]: 1,
    [LENS.PRODUCER]: 1
  },
  'usa': {
    [LENS.COMPETITION]: 2,
    [LENS.PANEL_GUIDE]: 2,
    [LENS.CRITIC]: 2,
    [LENS.COMMUNITY]: 2,
    [LENS.AGGREGATOR]: 1,
    [LENS.PRODUCER]: 1
  },
  'default': {
    [LENS.COMPETITION]: 2,
    [LENS.PANEL_GUIDE]: 2,
    [LENS.CRITIC]: 1,
    [LENS.COMMUNITY]: 1,
    [LENS.AGGREGATOR]: 1,
    [LENS.PRODUCER]: 2
  }
};

/**
 * Get market caps for a specific market.
 * Falls back to default if market not found.
 *
 * @param {string} market - Market/country name
 * @returns {Object} Lens caps for this market
 */
export function getMarketCaps(market) {
  if (!market) return MARKET_CAPS.default;

  const normalized = market.toLowerCase();
  return MARKET_CAPS[normalized] || MARKET_CAPS.default;
}

/**
 * Score and rank URLs from candidate pool.
 * Implements two-tier scoring system.
 *
 * @param {Array<Object>} urls - URL candidates with title, snippet, domain, source info
 * @param {Object} identityTokens - Wine identity tokens
 * @param {string} market - Market/country for caps
 * @returns {Array<Object>} Scored and ranked URLs
 */
export function scoreAndRankUrls(urls, identityTokens, _market = 'default') {
  if (!urls || urls.length === 0) return [];

  // Score each URL with identity and priority metrics
  const scoredUrls = urls.map(url => {
    // Tier A: Identity score (determines validity)
    const identityScore = calculateIdentityScore(
      `${url.title || ''} ${url.snippet || ''} ${(url.domain || url.url || '')}`,
      identityTokens
    );

    // Tier B: Fetch priority score (determines order within validity tier)
    const fetchPriority = calculateFetchPriority(url, identityTokens);

    // Discovery overlap (used as tiebreaker within same identity score)
    const discoveryScore = calculateDiscoveryTokenOverlap(
      url.title || '',
      identityTokens.discovery
    );

    return {
      ...url,
      identityScore: identityScore.score,
      identityValid: identityScore.valid,
      identityMatches: identityScore.matches || {},
      fetchPriority,
      discoveryScore,
      // Composite score for sorting
      compositeScore: {
        identity: identityScore.score,
        priority: fetchPriority,
        discovery: discoveryScore
      }
    };
  });

  // Filter invalid URLs (identity score < 4)
  const validUrls = scoredUrls.filter(url => url.identityValid);

  // Sort by: identity score desc, then fetch priority desc, then discovery score desc
  validUrls.sort((a, b) => {
    // Primary: Identity score (highest first)
    if (a.compositeScore.identity !== b.compositeScore.identity) {
      return b.compositeScore.identity - a.compositeScore.identity;
    }

    // Secondary: Fetch priority (highest first)
    if (a.compositeScore.priority !== b.compositeScore.priority) {
      return b.compositeScore.priority - a.compositeScore.priority;
    }

    // Tertiary: Discovery score (highest first)
    return b.compositeScore.discovery - a.compositeScore.discovery;
  });

  return validUrls;
}

/**
 * Calculate fetch priority for a URL.
 * Prioritizes easy fetches over protected domains.
 *
 * @param {Object} url - URL object with domain, source info
 * @param {Object} identityTokens - Wine identity tokens (for source matching)
 * @returns {number} Priority score 0-10
 */
function calculateFetchPriority(url, identityTokens) {
  let score = 0;

  const domain = (url.domain || url.url || '').toLowerCase();

  // Known authoritative sources (+2)
  if (isKnownAuthoritySource(domain)) {
    score += 2;
  }

  // Producer website detected (+1.5)
  if (isProducerDomain(domain, identityTokens)) {
    score += 1.5;
  }

  // Competition/award source (+1.5)
  if (isCompetitionSource(domain)) {
    score += 1.5;
  }

  // Protected domain penalty (-1)
  // These require special handling (Web Unlocker, Puppeteer)
  if (isProtectedDomain(domain)) {
    score -= 1;
  }

  // Result position boost (if available)
  if (url.position && url.position < 3) {
    score += 0.5;
  }

  return Math.max(0, score);
}

/**
 * Check if domain is a known authoritative source.
 * @param {string} domain - Domain to check
 * @returns {boolean} True if known authority
 */
function isKnownAuthoritySource(domain) {
  const authorities = [
    'decanter.com',
    'winespectator.com',
    'jancisrobinson.com',
    'robertparker.com',
    'vivino.com',
    'wine-searcher.com',
    'halliday.com.au',
    'platters.co.za',
    'rvf.com'
  ];

  return authorities.some(auth => domain.includes(auth));
}

/**
 * Check if domain is likely a producer website.
 * @param {string} domain - Domain to check
 * @param {Object} identityTokens - Wine identity tokens
 * @returns {boolean} True if likely producer domain
 */
function isProducerDomain(domain, identityTokens) {
  if (!identityTokens || !identityTokens._raw) return false;

  const producerName = identityTokens._raw.producer || '';
  const normalizedProducer = producerName.toLowerCase().replace(/\s+/g, '');

  // Check if producer name appears in domain
  return normalizedProducer.length > 3 && domain.includes(normalizedProducer);
}

/**
 * Check if domain is a known competition/award source.
 * @param {string} domain - Domain to check
 * @returns {boolean} True if known competition
 */
function isCompetitionSource(domain) {
  const competitions = [
    'icc.org',
    'dwwa.co.uk',
    'decanter-awards',
    'michelangelo.co.za',
    'sagwa.co.za',
    'platters.co.za',
    'halliday.com.au',
    'wina.com.ar'
  ];

  return competitions.some(comp => domain.includes(comp));
}

/**
 * Check if domain requires special fetch handling.
 * @param {string} domain - Domain to check
 * @returns {boolean} True if protected domain
 */
function isProtectedDomain(domain) {
  const protected_domains = [
    'vivino.com',
    'decanter.com',
    'wine-searcher.com',
    'jancisrobinson.com',
    'robertparker.com'
  ];

  return protected_domains.some(prot => domain.includes(prot));
}

/**
 * Apply market-aware per-lens caps to ranked URLs.
 * Ensures we don't overweight any single source lens.
 *
 * @param {Array<Object>} rankedUrls - Ranked URL list
 * @param {string} market - Market/country for caps
 * @returns {Array<Object>} Capped URL list
 */
export function applyMarketCaps(rankedUrls, market = 'default') {
  const caps = getMarketCaps(market);
  const capTracking = {};

  // Initialize cap tracking
  Object.values(LENS).forEach(lens => {
    capTracking[lens] = 0;
  });

  // Select URLs respecting caps
  const selected = [];

  for (const url of rankedUrls) {
    const lens = detectLens(url);

    if (!lens) {
      // Unknown lens - include if we have room
      selected.push(url);
      continue;
    }

    const cap = caps[lens] || 1;

    if (capTracking[lens] < cap) {
      selected.push(url);
      capTracking[lens]++;
    }

    // Stop if we hit total cap (8 URLs max per design)
    if (selected.length >= 8) {
      break;
    }
  }

  return selected;
}

/**
 * Detect lens type from URL metadata.
 * @param {Object} url - URL object with domain/source info
 * @returns {string|null} Lens type or null
 */
function detectLens(url) {
  const domain = (url.domain || url.url || '').toLowerCase();
  const title = (url.title || '').toLowerCase();

  // Competition detection
  if (domain.includes('icc.org') || domain.includes('dwwa') ||
      domain.includes('michelangelo') || domain.includes('sagwa') ||
      domain.includes('platters') || title.includes('medal') || title.includes('award')) {
    return LENS.COMPETITION;
  }

  // Panel/Guide detection
  if (domain.includes('halliday') || domain.includes('platters') ||
      domain.includes('decanter') || domain.includes('wine-searcher') ||
      domain.includes('jancisrobinson')) {
    return LENS.PANEL_GUIDE;
  }

  // Critic detection
  if (domain.includes('winespectator') || domain.includes('robertparker') ||
      domain.includes('rvf') || title.includes('tasting notes')) {
    return LENS.CRITIC;
  }

  // Community detection
  if (domain.includes('vivino') || domain.includes('cellartracker')) {
    return LENS.COMMUNITY;
  }

  // Aggregator detection
  if (domain.includes('wine-searcher') || domain.includes('vivino')) {
    return LENS.AGGREGATOR;
  }

  // Producer detection
  if (domain.endsWith('.com') && !domain.includes('www.') &&
      !domain.includes('amazon') && !domain.includes('search')) {
    return LENS.PRODUCER;
  }

  return null;
}
