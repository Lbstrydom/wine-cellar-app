/**
 * @fileoverview Wine name processing, tokenization, and variation generation.
 * Handles fuzzy matching, phonetic variations, and producer extraction.
 * @module services/nameProcessing
 */

import { RANGE_QUALIFIERS } from './searchConstants.js';

/**
 * Extract significant search tokens from wine name.
 * Removes articles, normalizes spacing, keeps meaningful words.
 * @param {string} wineName - Original wine name
 * @returns {string[]} Array of search tokens
 */
export function extractSearchTokens(wineName) {
  if (!wineName) return [];

  // Common articles and filler words to remove
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'of', 'de', 'du', 'la', 'le', 'les', 'das', 'der', 'die',
    'del', 'della', 'di', 'da', 'wines', 'wine', 'estate', 'winery', 'vineyards', 'vineyard'
  ]);

  return wineName
    .toLowerCase()
    .replace(/[''`]/g, '')           // Remove apostrophes
    .replace(/\([^)]+\)/g, ' ')      // Remove parenthetical content
    .replace(/[^\w\s-]/g, ' ')       // Remove punctuation except hyphens
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w))
    .slice(0, 6);  // Limit to first 6 significant tokens
}

/**
 * Build a source-specific search query.
 * Uses flexible token matching instead of exact phrase for better coverage.
 * @param {Object} source - Source config
 * @param {string} wineName - Wine name
 * @param {string|number} vintage - Vintage year
 * @returns {string} Search query
 */
export function buildSourceQuery(source, wineName, vintage) {
  // Token-based search for better fuzzy matching
  const tokens = extractSearchTokens(wineName);
  const tokenQuery = tokens.join(' ');

  // Force Vivino to show ratings in the search snippet
  if (source.id === 'vivino') {
    return `site:vivino.com ${tokenQuery} ${vintage} "stars" OR "rating"`;
  }

  if (source.query_template) {
    // Use token-based query for better fuzzy matching
    return source.query_template
      .replace('{wine}', tokenQuery)
      .replace('{vintage}', vintage || '');
  }

  // Default: use tokens without strict quoting for flexibility
  return `${tokenQuery} ${vintage} wine`;
}

/**
 * Discovery strip patterns for simplified name generation.
 * Strip range qualifiers for DISCOVERY only - results re-ranked by original name.
 */
const DISCOVERY_STRIP_PATTERNS = [
  /\s+Vineyard\s+Selection/gi,
  /\s+Cellar\s+Selection/gi,
  /\s+Selected\s+Vineyards?/gi,
  /\s+Single\s+Vineyards?/gi,
  /\s+Estate\s+Selection/gi,
  /\s+Limited\s+Edition/gi,
  /\s+Special\s+Selection/gi,
  /\s+Private\s+Collection/gi,
  /\s+Family\s+Reserve/gi,
  /\s+Barrel\s+Select(ion|ed)?/gi,
  /\s+Reserve(?!\s+\w)/gi,
  // Spanish
  /\s+Reserva(?!\s+\w)/gi,
  /\s+Gran\s+Reserva/gi,
  /\s+Crianza/gi,
  /\s+Selección/gi,
  // Italian
  /\s+Riserva/gi,
  /\s+Selezione/gi,
  // French
  /\s+Cuvée\s+\w+/gi,
  /\s+Grande?\s+Cuvée/gi,
  /\s+Prestige/gi,
  /\s+Vieilles\s+Vignes/gi,
  // German
  /\s+Spätlese/gi,
  /\s+Auslese/gi
];

/**
 * Grape varieties for producer+grape extraction.
 */
const GRAPE_VARIETIES_FOR_NAMES = [
  'chenin blanc', 'sauvignon blanc', 'chardonnay', 'riesling', 'pinot grigio', 'pinot gris',
  'viognier', 'gewürztraminer', 'semillon', 'verdelho', 'albariño', 'grüner veltliner',
  'cabernet sauvignon', 'merlot', 'pinot noir', 'shiraz', 'syrah', 'malbec', 'tempranillo',
  'sangiovese', 'nebbiolo', 'pinotage', 'zinfandel', 'grenache', 'mourvèdre', 'petit verdot',
  'carmenere', 'barbera', 'primitivo', 'touriga nacional', 'tinta roriz'
];

/**
 * Generate wine name variations for DISCOVERY (Layer 1).
 * These simplified names help find the producer's pages and general results.
 * The original name is always first and used for PRECISION matching (Layer 2).
 *
 * TWO-LAYER STRATEGY:
 * - Layer 1 (Discovery): Simplified names to cast a wider net
 * - Layer 2 (Precision): Results are re-ranked by match to ORIGINAL name
 *
 * @param {string} wineName - Original wine name
 * @returns {string[]} Array of name variations (deduplicated)
 */
export function generateWineNameVariations(wineName) {
  const variations = [wineName]; // Original ALWAYS first for precision matching
  let detectedRangeQualifier = null;

  // Detect if this wine has a range/tier qualifier
  const wineNameLower = wineName.toLowerCase();
  for (const qualifier of RANGE_QUALIFIERS) {
    if (wineNameLower.includes(qualifier)) {
      detectedRangeQualifier = qualifier;
      break;
    }
  }

  // Strip parentheses content and try as variation
  const withoutParens = wineName
    .replace(/\(([^)]+)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutParens !== wineName) {
    variations.push(withoutParens);
  }

  // Also try completely removing parenthetical content
  const noParenContent = wineName
    .replace(/\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (noParenContent !== wineName && noParenContent.length > 5) {
    variations.push(noParenContent);
  }

  // For wines starting with numbers (like "1865 Selected Vineyards")
  if (/^\d+\s/.test(wineName)) {
    if (wineName.startsWith('1865')) {
      variations.push(`Viña San Pedro ${wineName}`);
      variations.push(`San Pedro ${wineName}`);
    }
  }

  // Generate simplified variation for DISCOVERY
  let simplified = wineName;
  for (const pattern of DISCOVERY_STRIP_PATTERNS) {
    simplified = simplified.replace(pattern, ' ');
  }
  simplified = simplified.replace(/\s+/g, ' ').trim();

  if (simplified !== wineName && simplified.length > 5) {
    variations.push(simplified);
  }

  // Try: Producer + Grape only
  for (const grape of GRAPE_VARIETIES_FOR_NAMES) {
    if (wineNameLower.includes(grape)) {
      const grapeIndex = wineNameLower.indexOf(grape);
      let producerPart = wineName.substring(0, grapeIndex).trim();
      for (const pattern of DISCOVERY_STRIP_PATTERNS) {
        producerPart = producerPart.replace(pattern, ' ');
      }
      producerPart = producerPart.replace(/\s+/g, ' ').trim();
      const grapePart = wineName.substring(grapeIndex, grapeIndex + grape.length);
      if (producerPart.length >= 3) {
        const producerGrapeOnly = `${producerPart} ${grapePart}`.trim();
        if (producerGrapeOnly !== wineName && producerGrapeOnly.length > 5) {
          variations.push(producerGrapeOnly);
        }
      }
      break; // Only process first grape found
    }
  }

  // Try without leading articles
  const noArticle = wineName.replace(/^(The|La|Le|El|Il|Das|Der|Die)\s+/i, '').trim();
  if (noArticle !== wineName && noArticle.length > 3) {
    variations.push(noArticle);
  }

  // Generate phonetic variations
  const phoneticVariations = generatePhoneticVariations(wineName);
  variations.push(...phoneticVariations);

  // Try producer name only (first 1-2 words before grape variety indicators)
  const producerMatch = wineName.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (producerMatch && producerMatch[1].length >= 5) {
    const producerOnly = producerMatch[1];
    const grapeNames = ['sauvignon', 'chardonnay', 'cabernet', 'merlot', 'pinot', 'shiraz', 'syrah'];
    if (!grapeNames.some(g => producerOnly.toLowerCase().includes(g))) {
      variations.push(producerOnly);
    }
  }

  return [...new Set(variations)]; // Remove duplicates
}

/**
 * Generate phonetic/spelling variations for wine names.
 * Handles common transcription differences in non-English names.
 * @param {string} wineName - Original wine name
 * @returns {string[]} Array of phonetic variations
 */
export function generatePhoneticVariations(wineName) {
  const variations = [];

  const substitutions = [
    [/ntu\b/gi, 'nt'],
    [/nt\b/gi, 'ntu'],
    [/ll/gi, 'l'],
    [/([^l])l([^l])/gi, '$1ll$2'],
    [/ñ/gi, 'n'],
    [/ü/gi, 'u'],
    [/ö/gi, 'o'],
    [/ä/gi, 'a'],
    [/é/gi, 'e'],
    [/è/gi, 'e'],
    [/ê/gi, 'e'],
    [/à/gi, 'a'],
    [/ç/gi, 'c'],
    [/œ/gi, 'oe'],
    [/æ/gi, 'ae'],
  ];

  for (const [pattern, replacement] of substitutions) {
    if (pattern.test(wineName)) {
      const variant = wineName.replace(pattern, replacement);
      if (variant !== wineName && variant.length > 3) {
        variations.push(variant);
      }
    }
  }

  return variations;
}

/**
 * Extract producer/winery name from wine name.
 * Heuristic: producer name is typically the first 1-3 words before grape variety or wine type.
 * @param {string} wineName - Full wine name
 * @returns {string|null} Producer name or null if not extractable
 */
export function extractProducerName(wineName) {
  if (!wineName) return null;

  const grapeVarieties = new Set([
    'cabernet', 'sauvignon', 'blanc', 'merlot', 'shiraz', 'syrah', 'pinot',
    'chardonnay', 'riesling', 'chenin', 'pinotage', 'malbec', 'tempranillo',
    'sangiovese', 'nebbiolo', 'verdejo', 'viognier', 'gewurztraminer',
    'primitivo', 'zinfandel', 'grenache', 'mourvedre', 'cinsault', 'noir',
    'grigio', 'gris', 'semillon', 'muscat', 'moscato', 'gewurz', 'gruner',
    'albarino', 'torrontes', 'carmenere', 'petit', 'verdot', 'tannat'
  ]);

  const wineTypeWords = new Set([
    'red', 'white', 'rose', 'rosé', 'blend', 'reserve', 'reserva', 'gran',
    'selection', 'single', 'barrel', 'limited', 'special', 'cuvee', 'cuvée',
    'brut', 'extra', 'demi', 'sec', 'vintage'
  ]);

  const words = wineName.split(/\s+/);
  const producerWords = [];

  for (const word of words) {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
    if (/^\d+$/.test(word)) continue;
    if (grapeVarieties.has(cleaned)) break;
    if (wineTypeWords.has(cleaned)) break;
    producerWords.push(word);
    if (producerWords.length >= 5) break;
  }

  if (producerWords.length === 0) return null;

  return producerWords.join(' ').replace(/\([^)]*\)/g, '').trim();
}
