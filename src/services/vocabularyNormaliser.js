/**
 * @fileoverview Vocabulary normaliser for tasting note extraction.
 * Maps synonyms to canonical terms, groups by category, and filters noise.
 * Implements Wine Detail Panel Spec v2 requirements.
 * @module services/vocabularyNormaliser
 */

import { isNoiseTerm } from '../config/noiseTerms.js';

/**
 * Version of this normaliser - stored with extracted profiles for reprocessing.
 */
export const NORMALISER_VERSION = '1.0.0';

/**
 * Synonym mappings to canonical terms.
 * Maps common variations to our controlled vocabulary.
 */
export const SYNONYM_MAP = {
  // Citrus
  'lemon zest': 'lemon',
  'lime zest': 'lime',
  'orange peel': 'orange',
  'citrus peel': 'citrus',
  'citrus rind': 'citrus',
  'grapefruit pith': 'grapefruit',
  
  // Tropical
  'passionfruit': 'passion_fruit',
  'exotic fruit': 'tropical',
  'exotic fruits': 'tropical',
  
  // Stone fruit
  'white peach': 'peach',
  'yellow peach': 'peach',
  'ripe peach': 'peach',
  
  // Berry
  'red fruits': 'red_fruit',
  'black fruits': 'dark_fruit',
  'dark fruits': 'dark_fruit',
  'berry fruits': 'berry',
  'mixed berries': 'berry',
  'forest fruits': 'dark_fruit',
  'summer fruits': 'red_fruit',
  
  // Orchard
  'green apple': 'apple',
  'red apple': 'apple',
  'baked apple': 'apple',
  'apple skin': 'apple',
  'ripe pear': 'pear',
  'pear drop': 'pear',
  'asian pear': 'pear',
  
  // Herbal
  'cut grass': 'grass',
  'fresh herbs': 'herbs',
  'dried herbs': 'herbs',
  'green herbs': 'herbs',
  'herbal notes': 'herbs',
  'herbaceous': 'herbs',
  
  // Vegetal
  'green pepper': 'bell_pepper',
  'capsicum': 'bell_pepper',
  'pyrazine': 'bell_pepper',
  
  // Floral
  'flowers': 'floral',
  'perfumed': 'floral',
  'floral notes': 'floral',
  'blossom': 'floral',
  
  // Earthy
  'sous-bois': 'forest_floor',
  'damp earth': 'earth',
  'earthy': 'earth',
  'earthiness': 'earth',
  
  // Mineral
  'minerality': 'mineral',
  'flinty': 'flint',
  'chalky': 'chalk',
  'stony': 'wet_stone',
  'salinity': 'saline',
  'salty': 'saline',
  
  // Oak
  'toasted': 'toast',
  'toasty': 'toast',
  'smoky': 'smoke',
  'charred': 'char',
  'woody': 'oak',
  'wood': 'oak',
  'oaky': 'oak',
  
  // Spice
  'spicy': 'spice',
  'spices': 'spice',
  'peppery': 'pepper',
  'licorice': 'liquorice',
  'aniseed': 'anise',
  
  // Autolytic
  'bready': 'bread',
  'yeasty': 'yeast',
  'nutty': 'almond',
  
  // Texture synonyms
  'buttery': 'creamy',
  'rich': 'full',
  'light': 'delicate'
};

/**
 * Category mappings for descriptors.
 * Canonical terms to their parent category.
 */
export const CATEGORY_MAP = {
  // Citrus
  lemon: 'citrus',
  lime: 'citrus',
  grapefruit: 'citrus',
  orange: 'citrus',
  tangerine: 'citrus',
  citrus: 'citrus',
  citrus_zest: 'citrus',
  citrus_pith: 'citrus',
  yuzu: 'citrus',
  
  // Tropical
  pineapple: 'tropical',
  mango: 'tropical',
  passion_fruit: 'tropical',
  guava: 'tropical',
  papaya: 'tropical',
  lychee: 'tropical',
  banana: 'tropical',
  tropical: 'tropical',
  
  // Orchard
  apple: 'orchard',
  pear: 'orchard',
  quince: 'orchard',
  
  // Stone fruit
  peach: 'stone_fruit',
  apricot: 'stone_fruit',
  nectarine: 'stone_fruit',
  plum: 'stone_fruit',
  cherry: 'stone_fruit',
  
  // Berry
  strawberry: 'berry',
  raspberry: 'berry',
  blackberry: 'berry',
  blueberry: 'berry',
  cranberry: 'berry',
  redcurrant: 'berry',
  red_currant: 'berry',
  blackcurrant: 'berry',
  mulberry: 'berry',
  berry: 'berry',
  red_fruit: 'berry',
  dark_fruit: 'berry',
  
  // Herbal
  grass: 'herbal',
  hay: 'herbal',
  herbs: 'herbal',
  mint: 'herbal',
  eucalyptus: 'herbal',
  dill: 'herbal',
  fennel: 'herbal',
  basil: 'herbal',
  thyme: 'herbal',
  rosemary: 'herbal',
  sage: 'herbal',
  lavender: 'herbal',
  boxwood: 'herbal',
  
  // Vegetal
  bell_pepper: 'vegetal',
  asparagus: 'vegetal',
  green_bean: 'vegetal',
  artichoke: 'vegetal',
  olive: 'vegetal',
  tomato_leaf: 'vegetal',
  
  // Floral
  rose: 'floral',
  violet: 'floral',
  jasmine: 'floral',
  honeysuckle: 'floral',
  elderflower: 'floral',
  floral: 'floral',
  orange_blossom: 'floral',
  acacia: 'floral',
  
  // Earthy
  earth: 'earthy',
  mushroom: 'earthy',
  truffle: 'earthy',
  forest_floor: 'earthy',
  wet_leaves: 'earthy',
  undergrowth: 'earthy',
  beetroot: 'earthy',
  
  // Mineral
  mineral: 'mineral',
  flint: 'mineral',
  chalk: 'mineral',
  slate: 'mineral',
  wet_stone: 'mineral',
  graphite: 'mineral',
  gravel: 'mineral',
  saline: 'mineral',
  
  // Oak
  oak: 'oak',
  vanilla: 'oak',
  toast: 'oak',
  cedar: 'oak',
  coconut: 'oak',
  smoke: 'oak',
  char: 'oak',
  coffee: 'oak',
  chocolate: 'oak',
  mocha: 'oak',
  
  // Spice
  pepper: 'spice',
  black_pepper: 'spice',
  white_pepper: 'spice',
  cinnamon: 'spice',
  clove: 'spice',
  nutmeg: 'spice',
  anise: 'spice',
  liquorice: 'spice',
  ginger: 'spice',
  spice: 'spice',
  
  // Autolytic (sparkling/aged)
  brioche: 'autolytic',
  bread: 'autolytic',
  biscuit: 'autolytic',
  yeast: 'autolytic',
  dough: 'autolytic',
  almond: 'autolytic',
  
  // Oxidative
  walnut: 'oxidative',
  hazelnut: 'oxidative',
  caramel: 'oxidative',
  toffee: 'oxidative',
  butterscotch: 'oxidative',
  dried_fruit: 'oxidative',
  raisin: 'oxidative',
  fig: 'oxidative',
  date: 'oxidative',
  
  // Fortified
  molasses: 'fortified',
  prune: 'fortified'
};

/**
 * Structure scales with more granular options per v2 spec.
 */
export const STRUCTURE_SCALES = {
  sweetness: ['bone-dry', 'dry', 'off-dry', 'medium-sweet', 'sweet', 'luscious'],
  acidity: ['low', 'medium-minus', 'medium', 'medium-plus', 'high', 'bracing'],
  body: ['light', 'light-medium', 'medium', 'medium-full', 'full'],
  tannin: ['none', 'low', 'medium-minus', 'medium', 'medium-plus', 'high', 'grippy'],
  alcohol: ['low', 'medium', 'high', 'hot'],
  finish: ['short', 'medium-minus', 'medium', 'medium-plus', 'long', 'very-long'],
  intensity: ['light', 'medium-minus', 'medium', 'medium-plus', 'pronounced'],
  mousse: ['delicate', 'fine', 'creamy', 'persistent'],
  dosage: ['brut-nature', 'extra-brut', 'brut', 'extra-dry', 'dry', 'demi-sec', 'doux']
};

/**
 * Map simplified terms to our granular scale.
 */
const SCALE_SYNONYMS = {
  // Sweetness
  'bone dry': 'bone-dry',
  'very dry': 'bone-dry',
  'quite dry': 'dry',
  'semi-dry': 'off-dry',
  'semi-sweet': 'medium-sweet',
  'very sweet': 'luscious',
  
  // Acidity
  'crisp': 'high',
  'fresh': 'medium-plus',
  'racy': 'high',
  'zesty': 'high',
  'bright': 'high',
  'soft': 'low',
  'mellow': 'low',
  
  // Body
  'light bodied': 'light',
  'light-bodied': 'light',
  'medium bodied': 'medium',
  'medium-bodied': 'medium',
  'full bodied': 'full',
  'full-bodied': 'full',
  'big': 'full',
  'powerful': 'full',
  'elegant': 'medium',
  'delicate': 'light',
  
  // Tannin
  'silky': 'low',
  'fine': 'medium-minus',
  'firm': 'medium-plus',
  'grippy': 'grippy',
  'structured': 'medium-plus',
  'chewy': 'high',
  
  // Finish
  'short finish': 'short',
  'medium finish': 'medium',
  'long finish': 'long',
  'lingering': 'long',
  'persistent': 'long',
  'very long': 'very-long',
  'endless': 'very-long'
};

/**
 * Normalise a descriptor term to canonical form.
 * @param {string} descriptor - Raw descriptor from tasting note
 * @param {Object} context - Context for noise filtering
 * @returns {Object|null} Normalised term with category, or null if filtered
 */
export function normaliseDescriptor(descriptor, context = {}) {
  if (!descriptor || typeof descriptor !== 'string') {
    return null;
  }
  
  const term = descriptor.toLowerCase().trim();
  
  // Check noise suppression
  if (isNoiseTerm(term, context)) {
    return null;
  }
  
  // Check direct synonym mapping
  if (SYNONYM_MAP[term]) {
    const canonical = SYNONYM_MAP[term];
    const category = CATEGORY_MAP[canonical] || 'other';
    return {
      canonical,
      category,
      original: term
    };
  }
  
  // Check if already canonical (with underscore normalisation)
  const underscored = term.replace(/ /g, '_');
  if (CATEGORY_MAP[underscored]) {
    return {
      canonical: underscored,
      category: CATEGORY_MAP[underscored],
      original: term
    };
  }
  
  if (CATEGORY_MAP[term]) {
    return {
      canonical: term,
      category: CATEGORY_MAP[term],
      original: term
    };
  }
  
  // Unknown term - flag for review
  return {
    canonical: underscored,
    category: 'other',
    original: term,
    flagged: true
  };
}

/**
 * Normalise a structural value (sweetness, acidity, etc.).
 * @param {string} field - Field name (sweetness, acidity, body, etc.)
 * @param {string} value - Raw value from extraction
 * @returns {string|null} Normalised value from scale, or null if invalid
 */
export function normaliseStructureValue(field, value) {
  if (!value || !STRUCTURE_SCALES[field]) {
    return null;
  }
  
  const lower = value.toLowerCase().trim();
  
  // Check direct match
  if (STRUCTURE_SCALES[field].includes(lower)) {
    return lower;
  }
  
  // Check synonyms
  if (SCALE_SYNONYMS[lower]) {
    const mapped = SCALE_SYNONYMS[lower];
    if (STRUCTURE_SCALES[field].includes(mapped)) {
      return mapped;
    }
  }
  
  // Try partial matching for common patterns
  for (const validValue of STRUCTURE_SCALES[field]) {
    if (lower.includes(validValue) || validValue.includes(lower)) {
      return validValue;
    }
  }
  
  return null;
}

/**
 * Group descriptors by category.
 * @param {Array<string>} descriptors - List of canonical descriptors
 * @returns {Object} Descriptors grouped by category
 */
export function groupByCategory(descriptors) {
  const grouped = {};
  
  for (const descriptor of descriptors) {
    const category = CATEGORY_MAP[descriptor] || 'other';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    if (!grouped[category].includes(descriptor)) {
      grouped[category].push(descriptor);
    }
  }
  
  return grouped;
}

/**
 * Convert snake_case to display format.
 * @param {string} term - Term in snake_case
 * @returns {string} Human-readable format
 */
export function toDisplayFormat(term) {
  return term
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Convert display format to snake_case.
 * @param {string} term - Human-readable term
 * @returns {string} snake_case format
 */
export function toCanonicalFormat(term) {
  return term
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
}

export default {
  NORMALISER_VERSION,
  SYNONYM_MAP,
  CATEGORY_MAP,
  STRUCTURE_SCALES,
  normaliseDescriptor,
  normaliseStructureValue,
  groupByCategory,
  toDisplayFormat,
  toCanonicalFormat
};
