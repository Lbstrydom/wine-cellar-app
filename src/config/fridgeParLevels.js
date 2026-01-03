/**
 * @fileoverview Fridge par-level definitions for balanced stocking.
 * Defines target quantities for each wine category in the fridge.
 * @module config/fridgeParLevels
 */

/**
 * Fridge par-level definitions.
 * Total: 1+2+1+1+1+1+1 = 8 slots, leaving 1 flex for total capacity of 9.
 */
export const FRIDGE_PAR_LEVELS = {
  sparkling: {
    min: 1,
    max: 1,
    priority: 1,
    description: 'Celebration-ready bubbles',
    signals: ['celebration', 'aperitif', 'champagne', 'prosecco'],
    preferredZones: ['rose_sparkling'],
    matchRules: {
      colours: ['sparkling'],
      keywords: ['champagne', 'prosecco', 'cava', 'crémant', 'sparkling', 'brut']
    }
  },

  crispWhite: {
    min: 2,
    max: 2,
    priority: 2,
    description: 'High-acid whites for seafood & salads',
    signals: ['fish', 'seafood', 'salad', 'light'],
    preferredZones: ['sauvignon_blanc', 'loire_light', 'aromatic_whites'],
    matchRules: {
      colours: ['white'],
      grapes: ['sauvignon blanc', 'picpoul', 'muscadet', 'albariño', 'assyrtiko', 'gruner veltliner'],
      excludeWinemaking: ['oaked', 'barrel aged']
    }
  },

  aromaticWhite: {
    min: 1,
    max: 1,
    priority: 3,
    description: 'Off-dry/aromatic for spicy food',
    signals: ['spicy', 'asian', 'thai', 'indian', 'sweet'],
    preferredZones: ['aromatic_whites'],
    matchRules: {
      colours: ['white'],
      grapes: ['riesling', 'gewürztraminer', 'gewurztraminer', 'viognier', 'torrontés', 'muscat'],
      keywords: ['aromatic', 'off-dry', 'semi-sweet']
    }
  },

  textureWhite: {
    min: 1,
    max: 1,
    priority: 4,
    description: 'Fuller whites for creamy dishes',
    signals: ['creamy', 'roasted', 'rich', 'butter'],
    preferredZones: ['chardonnay', 'chenin_blanc'],
    matchRules: {
      colours: ['white'],
      grapes: ['chardonnay', 'chenin blanc'],
      winemaking: ['oaked', 'barrel aged', 'malolactic'],
      keywords: ['burgundy', 'meursault', 'oaked']
    }
  },

  rose: {
    min: 1,
    max: 1,
    priority: 5,
    description: 'Versatile weeknight option',
    signals: ['chicken', 'pork', 'light', 'summer'],
    preferredZones: ['rose_sparkling'],
    matchRules: {
      colours: ['rose'],
      keywords: ['rosé', 'rose', 'rosado']
    }
  },

  chillableRed: {
    min: 1,
    max: 1,
    priority: 6,
    description: 'Light red for charcuterie',
    signals: ['pork', 'charcuterie', 'cheese', 'light red'],
    preferredZones: ['pinot_noir', 'iberian_fresh'],
    matchRules: {
      colours: ['red'],
      grapes: ['pinot noir', 'gamay', 'frappato', 'mencía', 'grenache'],
      excludeKeywords: ['full body', 'oaked', 'reserve']
    }
  },

  flex: {
    min: 0,
    max: 1,
    priority: 7,
    optional: true,
    description: 'Any wine you\'re excited to drink soon',
    signals: [],
    preferredZones: [],
    matchRules: {}
  }
};

/**
 * Total fridge capacity.
 */
export const FRIDGE_CAPACITY = 9;

/**
 * Get par-level config for a category.
 * @param {string} category - Category name
 * @returns {Object|null} Par-level config
 */
export function getParLevelConfig(category) {
  return FRIDGE_PAR_LEVELS[category] || null;
}

/**
 * Get all par-level categories in priority order.
 * @returns {Array} Category names sorted by priority
 */
export function getCategoriesInPriorityOrder() {
  return Object.entries(FRIDGE_PAR_LEVELS)
    .sort((a, b) => a[1].priority - b[1].priority)
    .map(([name]) => name);
}

/**
 * Get total minimum required bottles for par-levels.
 * @returns {number} Minimum bottles needed
 */
export function getMinimumParLevelTotal() {
  return Object.values(FRIDGE_PAR_LEVELS)
    .reduce((sum, config) => sum + config.min, 0);
}
