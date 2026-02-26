/**
 * @fileoverview Category -> signal boost map using fuzzy matching.
 * Used as a secondary boost (0.5x weight) on top of primary extractSignals().
 * @module services/recipe/categorySignalMap
 */

/**
 * Map of recipe category keywords to food signals.
 * Keys are lowercase. Values are arrays of signal names matching
 * the FOOD_SIGNALS keys in pairingEngine.js.
 */
const CATEGORY_SIGNAL_MAP = {
  // Protein categories
  'chicken': ['chicken'],
  'poultry': ['chicken'],
  'turkey': ['chicken'],
  'duck': ['duck'],
  'beef': ['beef'],
  'steak': ['beef', 'grilled'],
  'lamb': ['lamb'],
  'pork': ['pork'],
  'fish': ['fish'],
  'seafood': ['shellfish', 'fish'],
  'shellfish': ['shellfish'],
  'shrimp': ['shellfish'],
  'prawn': ['shellfish'],
  'salmon': ['fish', 'rich'],
  'tuna': ['fish'],
  'vegan': ['vegetable', 'raw'],
  'vegetarian': ['vegetable'],

  // Cooking method categories
  'bbq': ['grilled', 'smoky'],
  'braai': ['grilled', 'smoky'],
  'grill': ['grilled'],
  'grilled': ['grilled'],
  'roast': ['roasted'],
  'roasted': ['roasted'],
  'baked': ['roasted'],
  'slow cooker': ['braised'],
  'stew': ['braised', 'earthy'],
  'braise': ['braised'],
  'soup': ['braised'],
  'fried': ['fried', 'rich'],
  'stir fry': ['fried', 'spicy'],
  'raw': ['raw'],
  'salad': ['raw', 'citrus'],
  'sushi': ['raw', 'fish'],

  // Cuisine categories
  'asian': ['spicy', 'umami'],
  'chinese': ['umami', 'spicy'],
  'japanese': ['umami', 'fish'],
  'thai': ['spicy', 'citrus'],
  'indian': ['spicy', 'earthy'],
  'curry': ['spicy', 'earthy'],
  'mexican': ['spicy', 'grilled'],
  'italian': ['tomato', 'herb'],
  'french': ['herb', 'rich', 'creamy'],
  'mediterranean': ['herb', 'citrus'],
  'middle eastern': ['spicy', 'herb'],
  'korean': ['spicy', 'umami', 'fermented'],

  // Flavor/profile categories
  'spicy': ['spicy'],
  'creamy': ['creamy', 'rich'],
  'cheese': ['cheese'],
  'pasta': ['tomato', 'cheese'],
  'pizza': ['tomato', 'cheese'],
  'dessert': ['sweet'],
  'sweet': ['sweet'],
  'chocolate': ['sweet', 'rich'],
  'bread': ['earthy'],
  'mushroom': ['earthy', 'umami'],
  'smoky': ['smoky'],
  'smoked': ['smoky'],
  'fermented': ['fermented'],
  'pickled': ['fermented', 'citrus']
};

/**
 * Get signal boosts for a set of categories using fuzzy Jaccard matching.
 * @param {string[]} categories - Recipe category strings
 * @returns {Object.<string, number>} Map of signal -> boost weight
 */
export function getCategorySignalBoosts(categories) {
  if (!categories?.length) return {};

  const boosts = {};

  for (const cat of categories) {
    const lower = cat.toLowerCase().trim();
    if (!lower) continue;

    // Direct match first
    if (CATEGORY_SIGNAL_MAP[lower]) {
      for (const signal of CATEGORY_SIGNAL_MAP[lower]) {
        boosts[signal] = (boosts[signal] || 0) + 1;
      }
      continue;
    }

    // Fuzzy match: check if any map key is contained in the category or vice versa
    for (const [key, signals] of Object.entries(CATEGORY_SIGNAL_MAP)) {
      if (lower.includes(key) || key.includes(lower)) {
        for (const signal of signals) {
          boosts[signal] = (boosts[signal] || 0) + 0.5;
        }
      }
    }
  }

  return boosts;
}

/**
 * Get the raw category signal map (for testing).
 * @returns {Object}
 */
export function getRawMap() {
  return CATEGORY_SIGNAL_MAP;
}
