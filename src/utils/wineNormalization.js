/**
 * @fileoverview Central normalization utilities for wine colour and grape data.
 * Single source of truth reused by grapeColourMap, consistencyChecker, and write paths.
 * @module utils/wineNormalization
 */

/**
 * Colour alias map — maps alternate spellings to canonical form.
 */
const COLOUR_ALIASES = new Map([
  ['rosé', 'rose'],
  ['rosado', 'rose'],
  ['rosato', 'rose'],
  ['blush', 'rose'],
  ['ros', 'rose'],
  ['blanc', 'white'],
  ['rouge', 'red'],
  ['tinto', 'red'],
  ['rosso', 'red'],
  ['bianco', 'white'],
]);

/** Valid canonical colours. */
const VALID_COLOURS = new Set([
  'red', 'white', 'rose', 'orange', 'sparkling', 'dessert', 'fortified'
]);

/**
 * Normalize a wine colour to its canonical form.
 * @param {string} colour - Raw colour value
 * @returns {string|null} Canonical colour or null if invalid
 */
export function normalizeColour(colour) {
  if (!colour || typeof colour !== 'string') return null;
  const lower = colour.trim().toLowerCase();
  const resolved = COLOUR_ALIASES.get(lower) || lower;
  return VALID_COLOURS.has(resolved) ? resolved : null;
}

/**
 * Strip diacritics from a string for matching.
 * gewürztraminer → gewurztraminer, mourvèdre → mourvedre
 * @param {string} str
 * @returns {string}
 */
export function stripDiacritics(str) {
  if (!str || typeof str !== 'string') return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Grape synonym map — aliases to canonical names.
 */
export const GRAPE_SYNONYMS = new Map([
  // Red grape synonyms
  ['shiraz', 'syrah'],
  ['pinot grigio', 'pinot gris'],
  ['garnacha', 'grenache'],
  ['tinta roriz', 'tempranillo'],
  ['tinto fino', 'tempranillo'],
  ['tinta del pais', 'tempranillo'],
  ['tinta del país', 'tempranillo'],
  ['cencibel', 'tempranillo'],
  ['primitivo', 'zinfandel'],
  ['monastrell', 'mourvèdre'],
  ['mourvedre', 'mourvèdre'],
  ['carmenère', 'carmenere'],
  ['carinena', 'carignan'],
  ['cariñena', 'carignan'],
  ['mazuelo', 'carignan'],
  ['spätburgunder', 'pinot noir'],
  ['spatburgunder', 'pinot noir'],
  ['blaufränkisch', 'blaufrankisch'],
  ['nero d\'avola', 'nero davola'],
  ['grüner veltliner', 'gruner veltliner'],
  ['albariño', 'albarino'],
  ['torrontés', 'torrontes'],
  ['gewürztraminer', 'gewurztraminer'],
  // White grape synonyms
  ['fumé blanc', 'sauvignon blanc'],
  ['fume blanc', 'sauvignon blanc'],
  ['steen', 'chenin blanc'],
  ['muscadet', 'melon de bourgogne'],
  ['muscat blanc', 'muscat'],
  ['moscato', 'muscat'],
  ['moscatel', 'muscat'],
  ['malvasia', 'malvasia'],
  ['fetească', 'feteasca'],
  // Portuguese grapes
  ['touriga franca', 'touriga franca'],
  ['castelão', 'castelao'],
  ['trincadeira', 'trincadeira'],
  // Italian grapes
  ['negroamaro', 'negroamaro'],
  ['montepulciano', 'montepulciano'],
  ['sangiovese', 'sangiovese'],
  ['nebbiolo', 'nebbiolo'],
  ['barbera', 'barbera'],
  ['dolcetto', 'dolcetto'],
  // Greek & Eastern European
  ['xinomavro', 'xinomavro'],
  ['agiorgitiko', 'agiorgitiko'],
  ['plavac mali', 'plavac mali'],
  ['kadarka', 'kadarka'],
  ['zweigelt', 'zweigelt'],
  ['saperavi', 'saperavi'],
  ['furmint', 'furmint'],
]);

/**
 * Normalize a grape name — strip diacritics, lowercase, resolve synonyms.
 * Preserves original for display; returns canonical for matching.
 * @param {string} grape - Raw grape name
 * @returns {string|null} Canonical grape name or null
 */
export function normalizeGrape(grape) {
  if (!grape || typeof grape !== 'string') return null;
  const trimmed = grape.trim();
  if (!trimmed) return null;

  const stripped = stripDiacritics(trimmed).toLowerCase();
  // Check synonym map (try both original lowercase and stripped form)
  return GRAPE_SYNONYMS.get(stripped)
    || GRAPE_SYNONYMS.get(trimmed.toLowerCase())
    || stripped;
}

/**
 * Parse a grapes field into an array of grape names.
 * Handles JSON arrays, comma/semicolon/slash/ampersand separation,
 * percentage stripping, and deduplication.
 * @param {string|string[]|null} grapes - Raw grapes value
 * @returns {string[]} Array of individual grape names
 */
export function parseGrapesField(grapes) {
  if (!grapes) return [];
  if (Array.isArray(grapes)) {
    return [...new Set(grapes.map(g => typeof g === 'string' ? g.trim() : '').filter(Boolean))];
  }
  if (typeof grapes !== 'string') return [];

  const trimmed = grapes.trim();
  if (!trimmed) return [];

  // Try JSON parse first (handles "[\"Cabernet\", \"Merlot\"]")
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return [...new Set(
          parsed
            .map(g => typeof g === 'string' ? g.trim() : typeof g === 'object' && g?.name ? g.name.trim() : '')
            .filter(Boolean)
        )];
      }
    } catch {
      // Fall through to string splitting
    }
  }

  // String splitting: split on , ; / & +
  const parts = trimmed.split(/[,;/&+]+/);

  const cleaned = parts
    .map(p => p.trim())
    // Strip percentage numbers (e.g. "60% Cabernet" → "Cabernet")
    .map(p => p.replace(/^\d+(\.\d+)?\s*%?\s*/, ''))
    .map(p => p.trim())
    .filter(Boolean);

  return [...new Set(cleaned)];
}

/**
 * Known compound (multi-word) grape names. Used to prevent partial
 * substring matching — e.g. "sauvignon" should NOT match text that
 * contains "cabernet sauvignon" but not standalone "sauvignon".
 * @type {Set<string>}
 */
const COMPOUND_GRAPES = new Set([
  'cabernet sauvignon', 'cabernet franc',
  'sauvignon blanc',
  'pinot noir', 'pinot gris', 'pinot grigio', 'pinot blanc', 'pinot meunier',
  'chenin blanc',
  'petit verdot', 'petite sirah',
  'grenache blanc', 'grenache noir',
  'gamay noir',
  'muscat blanc', 'muscat ottonel', 'muscat d\'alexandrie',
  'melon de bourgogne',
  'ugni blanc',
  'cinsault noir',
  'touriga nacional', 'tinta roriz', 'tinta barroca',
  'nero d\'avola', 'nero d avola',
  'gruner veltliner', 'grüner veltliner',
  'blanc de blancs', 'blanc de noirs',
]);

/**
 * Cache of compiled regex patterns for grape matching.
 * Maps keyword → RegExp for word-boundary-aware matching.
 * @type {Map<string, RegExp>}
 */
const _grapeRegexCache = new Map();

/**
 * Get or create a word-boundary-aware regex for a grape/keyword.
 * @param {string} keyword - Grape name or keyword (e.g. 'sauvignon blanc', 'chenin')
 * @returns {RegExp} Compiled regex with word boundaries
 */
function getGrapeRegex(keyword) {
  let re = _grapeRegexCache.get(keyword);
  if (!re) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|\\b|[\\s,;/&+])${escaped}(?:$|\\b|[\\s,;/&+])`, 'i');
    _grapeRegexCache.set(keyword, re);
  }
  return re;
}

/**
 * Check whether a text contains a grape keyword, preventing compound-grape
 * overlap errors. Uses a two-pass strategy:
 *
 * 1. **Segment match** — split text on delimiters (`,;/&+`) and check for
 *    exact segment equality (handles grape lists like "cabernet sauvignon, merlot").
 * 2. **Compound-grape guard** — if keyword is a substring of a known compound
 *    grape that appears in the text, reject (e.g. "sauvignon" inside "cabernet sauvignon").
 * 3. **Word-boundary fallback** — regex match for wine names / style text
 *    (e.g. "pinotage" inside "Kanonkop Pinotage 2019").
 *
 * @param {string} text - Text to search in (grape field, wine name, style, etc.)
 * @param {string} keyword - Grape name to look for (e.g. 'sauvignon blanc', 'chenin')
 * @returns {boolean} True if keyword appears as a distinct grape match
 */
export function grapeMatchesText(text, keyword) {
  if (!text || !keyword) return false;
  const lowerKey = keyword.toLowerCase().trim();
  const lowerText = text.toLowerCase();

  // Quick bail-out: keyword not in text at all
  if (!lowerText.includes(lowerKey)) return false;

  // Pass 1: segment-split + exact match (handles comma-separated grape lists)
  const segments = lowerText.split(/[,;/&+\n]/).map(s => s.trim()).filter(Boolean);
  if (segments.some(seg => seg === lowerKey)) return true;

  // Pass 2: compound-grape guard — reject if keyword is a partial substring of a
  // known compound grape name that appears in the text
  for (const compound of COMPOUND_GRAPES) {
    if (compound !== lowerKey && compound.includes(lowerKey) && lowerText.includes(compound)) {
      return false;
    }
  }

  // Pass 3: word-boundary regex (handles wine names, style descriptions)
  return getGrapeRegex(lowerKey).test(lowerText);
}

/**
 * Check whether any of the given grape keywords match the text.
 * Compound-grape-aware — prevents partial overlap issues.
 *
 * @param {string} text - Text to search in
 * @param {string[]} keywords - Array of grape names to look for
 * @returns {string|undefined} The first matching keyword, or undefined
 */
export function findGrapeMatch(text, keywords) {
  if (!text || !keywords) return undefined;
  return keywords.find(k => grapeMatchesText(text, k));
}
