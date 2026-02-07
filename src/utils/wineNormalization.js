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
