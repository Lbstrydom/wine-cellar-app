/**
 * @fileoverview Standalone grape-colour rules for consistency checking.
 * Decoupled from cellar zones — seeded from CELLAR_ZONES at build time
 * but stored as explicit frozen rules that don't change if zone layout changes.
 *
 * The Map is module-private (Object.freeze on Map doesn't prevent .set/.delete).
 * Only getter functions are exported.
 * @module config/grapeColourMap
 */

import { CELLAR_ZONES } from './cellarZones.js';
import { normalizeGrape } from '../utils/wineNormalization.js';

/**
 * Module-private grape→colour map.
 * Keys are canonical grape names (lowercase, diacritics stripped).
 * Values are Set<string> of valid colours.
 * @type {Map<string, Set<string>>}
 */
const grapeColourMap = buildGrapeColourMap();

/** @internal — exported for unit tests only */
export { GRAPE_SYNONYMS } from '../utils/wineNormalization.js';

/**
 * Known exception patterns for wines that legitimately mismatch grape/colour rules.
 * Each entry: { pattern: RegExp, description: string }
 */
export const KNOWN_EXCEPTIONS = [
  { pattern: /\bblanc\s+de\s+noirs?\b/i, description: 'Blanc de Noirs — white wine from red grapes' },
  { pattern: /\borange\s+wine\b/i, description: 'Orange wine — white grapes with skin contact' },
  { pattern: /\bskin\s+contact\b/i, description: 'Skin contact wine — extended maceration' },
  { pattern: /\bvin\s+gris\b/i, description: 'Vin gris — very light rosé from red grapes' },
  { pattern: /\bramato\b/i, description: 'Ramato — copper-coloured Pinot Grigio' },
  { pattern: /\bpét[\s-]?nat\b/i, description: 'Pét-nat — natural sparkling, any grape' },
  { pattern: /\bnatural\s+wine\b/i, description: 'Natural wine — unconventional winemaking' },
];

/**
 * Build the grape→colour map from cellar zone definitions.
 * Iterates zones with explicit `color` + `rules.grapes`, skips buffer/fallback/curated zones.
 * Then merges curiosity supplements.
 * @returns {Map<string, Set<string>>}
 */
function buildGrapeColourMap() {
  const map = new Map();

  for (const zone of CELLAR_ZONES.zones) {
    // Skip buffer, fallback, and curated zones
    if (zone.isBufferZone || zone.isFallbackZone || zone.isCuratedZone) continue;

    const zoneColours = Array.isArray(zone.color) ? zone.color : (zone.color ? [zone.color] : []);
    const grapes = zone.rules?.grapes;
    if (!grapes || !Array.isArray(grapes) || grapes.length === 0) continue;

    // Only map grapes for single-colour zones (red, white)
    // Multi-colour zones (rose_sparkling, dessert_fortified) don't define grape→colour rules
    if (zoneColours.length !== 1) continue;

    const colour = zoneColours[0];

    for (const grape of grapes) {
      const canonical = normalizeGrape(grape);
      if (!canonical) continue;

      if (!map.has(canonical)) {
        map.set(canonical, new Set());
      }
      map.get(canonical).add(colour);
    }
  }

  // Curiosity supplements — grapes from unusual regions with known colours
  const curiositySupplements = [
    // Red grapes
    ['saperavi', 'red'],
    ['xinomavro', 'red'],
    ['agiorgitiko', 'red'],
    ['plavac mali', 'red'],
    ['blaufrankisch', 'red'],
    ['zweigelt', 'red'],
    ['kadarka', 'red'],
    ['tannat', 'red'],
    ['pinotage', 'red'],
    ['petit verdot', 'red'],
    ['cabernet franc', 'red'],
    ['merlot', 'red'],
    ['nero davola', 'red'],
    // White grapes
    ['furmint', 'white'],
    ['feteasca', 'white'],
    ['assyrtiko', 'white'],
    ['verdejo', 'white'],
    ['picpoul', 'white'],
    ['trebbiano', 'white'],
    ['garganega', 'white'],
    ['fiano', 'white'],
    ['greco', 'white'],
    ['verdicchio', 'white'],
    ['semillon', 'white'],
    ['marsanne', 'white'],
    ['roussanne', 'white'],
    ['pinot blanc', 'white'],
    ['pinot gris', 'white'],
    ['silvaner', 'white'],
  ];

  for (const [grape, colour] of curiositySupplements) {
    const canonical = normalizeGrape(grape);
    if (!canonical) continue;
    if (!map.has(canonical)) {
      map.set(canonical, new Set());
    }
    map.get(canonical).add(colour);
  }

  return map;
}

/**
 * Get expected colours for a grape (resolves synonyms first).
 * @param {string} grape - Grape name (any case, may include diacritics)
 * @returns {Set<string>|null} Set of valid colours, or null if unknown grape
 */
export function getExpectedColours(grape) {
  if (!grape || typeof grape !== 'string') return null;
  const canonical = normalizeGrape(grape);
  if (!canonical) return null;
  return grapeColourMap.get(canonical) || null;
}

/**
 * Get canonical grape name via synonym resolution.
 * @internal — exported for unit tests only
 * @param {string} grape - Raw grape name
 * @returns {string|null} Canonical grape name or null
 */
export function getCanonicalGrape(grape) {
  return normalizeGrape(grape);
}

/**
 * Get the number of grapes in the map.
 * @internal — exported for unit tests only
 * @returns {number}
 */
export function getGrapeCount() {
  return grapeColourMap.size;
}

/**
 * Check wine name/style against known exception patterns.
 * @param {string} wineName - Wine name to check
 * @param {string} [style] - Wine style to check
 * @returns {{ pattern: RegExp, description: string }|null} Matching exception or null
 */
export function findException(wineName, style) {
  const searchText = [wineName, style].filter(Boolean).join(' ');
  if (!searchText) return null;

  for (const exception of KNOWN_EXCEPTIONS) {
    if (exception.pattern.test(searchText)) {
      return exception;
    }
  }
  return null;
}
