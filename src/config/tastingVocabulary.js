/**
 * @fileoverview Controlled vocabulary for tasting note extraction.
 * Used by AI extraction to constrain outputs to consistent, searchable terms.
 * @module config/tastingVocabulary
 */

/**
 * Primary fruit descriptors organized by category.
 * These represent the core fruit aromas and flavors in wine.
 */
export const FRUIT_DESCRIPTORS = {
  red_fruit: ['cherry', 'strawberry', 'raspberry', 'cranberry', 'red_currant', 'pomegranate'],
  dark_fruit: ['blackberry', 'black_cherry', 'plum', 'blackcurrant', 'mulberry', 'boysenberry'],
  stone_fruit: ['peach', 'apricot', 'nectarine', 'white_peach'],
  tropical: ['pineapple', 'mango', 'passion_fruit', 'lychee', 'guava', 'papaya'],
  citrus: ['lemon', 'lime', 'grapefruit', 'orange_zest', 'tangerine', 'yuzu'],
  green_fruit: ['green_apple', 'pear', 'gooseberry', 'melon'],
  dried_fruit: ['fig', 'raisin', 'prune', 'date', 'dried_apricot']
};

/**
 * Secondary descriptors from winemaking or yeast influence.
 */
export const SECONDARY_DESCRIPTORS = {
  oak: ['vanilla', 'toast', 'coconut', 'cedar', 'smoke', 'char', 'mocha', 'coffee'],
  floral: ['rose', 'violet', 'lavender', 'elderflower', 'jasmine', 'honeysuckle', 'orange_blossom'],
  herbal: ['mint', 'eucalyptus', 'thyme', 'rosemary', 'sage', 'bay_leaf', 'green_bell_pepper'],
  spice: ['pepper', 'black_pepper', 'white_pepper', 'clove', 'cinnamon', 'nutmeg', 'licorice', 'anise'],
  yeast: ['bread', 'brioche', 'biscuit', 'yeast', 'lees']
};

/**
 * Tertiary descriptors from aging and bottle development.
 */
export const TERTIARY_DESCRIPTORS = {
  earthy: ['forest_floor', 'mushroom', 'truffle', 'wet_earth', 'mineral', 'slate', 'graphite', 'wet_stone'],
  savory: ['leather', 'tobacco', 'meat', 'game', 'bacon', 'olive'],
  oxidative: ['honey', 'caramel', 'toffee', 'butterscotch', 'almond', 'dried_flowers'],
  evolved: ['cedar_box', 'cigar_box', 'tar', 'dried_herbs', 'potpourri']
};

/**
 * Texture and mouthfeel descriptors.
 */
export const TEXTURE_DESCRIPTORS = [
  'silky', 'velvety', 'smooth', 'creamy', 'oily', 'viscous',
  'grippy', 'chewy', 'firm', 'structured', 'angular',
  'round', 'soft', 'supple', 'lush', 'plush',
  'crisp', 'refreshing', 'zesty', 'racy', 'lean',
  'chalky', 'dusty', 'powdery', 'grainy'
];

/**
 * Style tag vocabulary for categorizing wines.
 */
export const STYLE_TAGS = [
  // Body/weight
  'light_bodied', 'medium_bodied', 'full_bodied',
  // Oak
  'unoaked', 'lightly_oaked', 'heavily_oaked',
  // Sweetness styles
  'bone_dry', 'off_dry', 'semi_sweet', 'dessert_style',
  // Age potential
  'drink_now', 'age_worthy', 'mature', 'past_peak',
  // Origin character
  'old_world', 'new_world', 'classic', 'modern',
  // Winemaking style
  'natural', 'biodynamic', 'organic', 'orange_wine',
  'amphora_aged', 'barrel_fermented', 'sur_lie',
  // Sparkling
  'traditional_method', 'charmat', 'pet_nat',
  // Special categories
  'terroir_driven', 'fruit_forward', 'elegant', 'powerful',
  'austere', 'generous', 'complex', 'approachable'
];

/**
 * Intensity levels for various wine characteristics.
 */
export const INTENSITY_LEVELS = ['light', 'medium', 'pronounced'];

/**
 * Sweetness scale.
 */
export const SWEETNESS_LEVELS = ['dry', 'off-dry', 'medium', 'sweet'];

/**
 * Body scale.
 */
export const BODY_LEVELS = ['light', 'medium', 'full'];

/**
 * Acidity, tannin, alcohol scales.
 */
export const STRUCTURAL_LEVELS = ['low', 'medium', 'high'];

/**
 * Finish length scale.
 */
export const FINISH_LEVELS = ['short', 'medium', 'long'];

/**
 * Get all fruit terms as a flat array.
 * @returns {string[]} All fruit descriptor terms
 */
export function getAllFruitTerms() {
  return Object.values(FRUIT_DESCRIPTORS).flat();
}

/**
 * Get all secondary terms as a flat array.
 * @returns {string[]} All secondary descriptor terms
 */
export function getAllSecondaryTerms() {
  return Object.values(SECONDARY_DESCRIPTORS).flat();
}

/**
 * Get all tertiary terms as a flat array.
 * @returns {string[]} All tertiary descriptor terms
 */
export function getAllTertiaryTerms() {
  return Object.values(TERTIARY_DESCRIPTORS).flat();
}

/**
 * Check if a term exists in our vocabulary.
 * @param {string} term - Term to check
 * @returns {Object|null} Category info or null if not found
 */
export function findTermCategory(term) {
  const normalizedTerm = term.toLowerCase().replace(/ /g, '_');

  // Check fruits
  for (const [category, terms] of Object.entries(FRUIT_DESCRIPTORS)) {
    if (terms.includes(normalizedTerm)) {
      return { type: 'fruit', category, term: normalizedTerm };
    }
  }

  // Check secondary
  for (const [category, terms] of Object.entries(SECONDARY_DESCRIPTORS)) {
    if (terms.includes(normalizedTerm)) {
      return { type: 'secondary', category, term: normalizedTerm };
    }
  }

  // Check tertiary
  for (const [category, terms] of Object.entries(TERTIARY_DESCRIPTORS)) {
    if (terms.includes(normalizedTerm)) {
      return { type: 'tertiary', category, term: normalizedTerm };
    }
  }

  // Check texture
  if (TEXTURE_DESCRIPTORS.includes(normalizedTerm)) {
    return { type: 'texture', term: normalizedTerm };
  }

  // Check style tags
  if (STYLE_TAGS.includes(normalizedTerm)) {
    return { type: 'style_tag', term: normalizedTerm };
  }

  return null;
}

/**
 * Get human-readable display name for a vocabulary term.
 * @param {string} term - Term in snake_case
 * @returns {string} Human-readable name
 */
export function getDisplayName(term) {
  return term
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default {
  FRUIT_DESCRIPTORS,
  SECONDARY_DESCRIPTORS,
  TERTIARY_DESCRIPTORS,
  TEXTURE_DESCRIPTORS,
  STYLE_TAGS,
  INTENSITY_LEVELS,
  SWEETNESS_LEVELS,
  BODY_LEVELS,
  STRUCTURAL_LEVELS,
  FINISH_LEVELS,
  getAllFruitTerms,
  getAllSecondaryTerms,
  getAllTertiaryTerms,
  findTermCategory,
  getDisplayName
};
