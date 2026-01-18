/**
 * @fileoverview Locale-aware query builder for search optimization (Phase 3).
 * @module services/queryBuilder
 */

import { detectLocaleHints } from '../config/rangeQualifiers.js';
import { getSourcesForCountry, REGION_SOURCE_PRIORITY } from '../config/unifiedSources.js';

/**
 * Country to Google locale mappings (gl parameter).
 */
const COUNTRY_TO_GL = {
  'south africa': 'za',
  'australia': 'au',
  'new zealand': 'nz',
  'united states': 'us',
  'france': 'fr',
  'italy': 'it',
  'spain': 'es',
  'germany': 'de',
  'portugal': 'pt',
  'argentina': 'ar',
  'chile': 'cl',
  'austria': 'at'
};

/**
 * Country to language hint mappings (hl parameter).
 */
const COUNTRY_TO_HL = {
  'france': 'fr',
  'italy': 'it',
  'spain': 'es',
  'germany': 'de',
  'portugal': 'pt',
  'argentina': 'es',
  'chile': 'es',
  'austria': 'de',
  // Default to English for others
  'default': 'en'
};

/**
 * Get locale parameters for SERP call based on wine origin.
 * @param {Object} wine - Wine record with country field
 * @returns {{ hl: string, gl: string }} Language and country hints
 */
export function getLocaleParams(wine) {
  const country = (wine.country || '').toLowerCase().trim();
  
  return {
    hl: COUNTRY_TO_HL[country] || COUNTRY_TO_HL.default,
    gl: COUNTRY_TO_GL[country] || 'us'
  };
}

/**
 * Build query variants for different search intents.
 * @param {Object} wine - Wine record
 * @param {string} queryType - 'reviews' | 'awards' | 'community' | 'producer'
 * @returns {string[]} Array of query strings to try
 */
export function buildQueryVariants(wine, queryType = 'reviews') {
  const { wine_name, vintage, producer, country } = wine;
  const tokens = [wine_name, vintage].filter(Boolean);
  const baseQuery = tokens.join(' ');

  const variants = [];

  switch (queryType) {
    case 'reviews':
      // Primary: full query with rating keywords
      variants.push(`${baseQuery} review rating points`);
      
      // Include region-specific critics if applicable
      if (country) {
        const regionSources = getRegionSpecificSources(country);
        if (regionSources.length > 0) {
          const sourceNames = regionSources.slice(0, 2).join(' OR ');
          variants.push(`${baseQuery} (${sourceNames})`);
        }
      }
      
      // Fallback: simpler query without operators
      variants.push(`${baseQuery} wine rating`);
      break;

    case 'awards':
      // Primary: awards/medals query
      variants.push(`${baseQuery} award medal gold silver`);
      
      // Competition-specific if country known
      if (country) {
        const competitions = getRegionCompetitions(country);
        if (competitions.length > 0) {
          variants.push(`${baseQuery} ${competitions[0]}`);
        }
      }
      
      // Fallback: simpler awards query
      variants.push(`${baseQuery} wine competition`);
      break;

    case 'community':
      // Vivino-specific
      variants.push(`site:vivino.com ${baseQuery}`);
      
      // CellarTracker if available
      variants.push(`site:cellartracker.com ${baseQuery}`);
      break;

    case 'producer':
      // Producer website awards page
      if (producer) {
        variants.push(`site:${extractProducerDomain(producer)} awards medals ${vintage || ''}`);
        variants.push(`site:${extractProducerDomain(producer)} press accolades ${vintage || ''}`);
      }
      break;

    default:
      variants.push(baseQuery);
  }

  return variants.filter(Boolean);
}

/**
 * Get region-specific source names for query boosting.
 * @param {string} country - Wine country
 * @returns {string[]} Source names to include in query
 */
function getRegionSpecificSources(country) {
  const normalized = country.toLowerCase().trim();
  
  const sourceMap = {
    'south africa': ['Platter Guide', 'Tim Atkin'],
    'australia': ['James Halliday', 'Campbell Mattinson'],
    'france': ['Revue du Vin de France', 'Bettane Desseauve'],
    'italy': ['Gambero Rosso', 'Slow Wine'],
    'spain': ['Guia Penin', 'Decanter'],
    'germany': ['Gault Millau', 'Eichelmann'],
    'new zealand': ['Bob Campbell', 'Sam Kim'],
    'argentina': ['Descorchados', 'Wines of Argentina']
  };

  return sourceMap[normalized] || [];
}

/**
 * Get major competitions for a region.
 * @param {string} country - Wine country
 * @returns {string[]} Competition names
 */
function getRegionCompetitions(country) {
  const normalized = country.toLowerCase().trim();
  
  const competitionMap = {
    'south africa': ['Michelangelo', 'Platters Trophy', 'SAGWA'],
    'australia': ['James Halliday', 'Australian Wine Companion'],
    'france': ['Concours Mondial', 'Concours de Paris'],
    'united states': ['San Francisco Chronicle', 'Finger Lakes'],
    'italy': ['Vinitaly', 'Gambero Rosso Tre Bicchieri'],
    'spain': ['Bacchus', 'Premios Zarcillo']
  };

  return competitionMap[normalized] || ['IWSC', 'Decanter World Wine Awards'];
}

/**
 * Extract likely producer domain from producer name.
 * @param {string} producer - Producer name
 * @returns {string} Likely domain (e.g., "kanonkop.co.za")
 */
function extractProducerDomain(producer) {
  if (!producer) return '';
  
  // Normalize: lowercase, remove articles, special chars
  const normalized = producer
    .toLowerCase()
    .replace(/^(the|le|la|il|das|der|de)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '');
  
  // Common TLDs by region - would need producer country for accuracy
  return `${normalized}.com`;
}

/**
 * Build complete query with locale params and site restrictions.
 * @param {Object} wine - Wine record
 * @param {string} queryType - Query intent
 * @param {Object} options - Additional options
 * @param {string[]} options.siteDomains - Specific domains to restrict
 * @param {boolean} options.strictOperators - Use strict site: operators (may yield zero results)
 * @returns {{ queries: string[], localeParams: Object, retryQueries: string[] }}
 */
export function buildSearchQuery(wine, queryType, options = {}) {
  const localeParams = getLocaleParams(wine);
  const queryVariants = buildQueryVariants(wine, queryType);
  
  // If strict site operators specified, add them
  let queries = [...queryVariants];
  if (options.siteDomains && options.siteDomains.length > 0 && options.strictOperators) {
    const siteRestriction = options.siteDomains.map(d => `site:${d}`).join(' OR ');
    queries = queries.map(q => `${q} (${siteRestriction})`);
  }
  
  // Retry queries: same but without operators (in case strict yields zero results)
  const retryQueries = options.strictOperators ? [...queryVariants] : [];
  
  return {
    queries,
    localeParams,
    retryQueries
  };
}

/**
 * Detect if search results are empty due to overly restrictive operators.
 * @param {Object[]} results - SERP results
 * @param {string} query - Original query
 * @returns {boolean} True if query should be retried without operators
 */
export function shouldRetryWithoutOperators(results, query) {
  // If zero results and query has site: operators
  if (results.length === 0 && query.includes('site:')) {
    return true;
  }
  
  // If very few results (< 3) and query has OR operators
  if (results.length < 3 && query.includes(' OR ')) {
    return true;
  }
  
  return false;
}
