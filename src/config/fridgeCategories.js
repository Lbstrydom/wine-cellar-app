/**
 * @fileoverview Fridge category registry and display configuration.
 * Defines what categories exist, temperature suitability, and matching rules.
 * Replaces the static FRIDGE_PAR_LEVELS config — par-level slot counts are
 * computed dynamically by fridgeAllocator.js based on live inventory.
 * @module config/fridgeCategories
 */

/**
 * Fridge category registry.
 * Each category defines what kinds of wines belong to it and which storage
 * types it suits. No min/max slot counts here — those are computed dynamically.
 */
export const CATEGORY_REGISTRY = {
  sparkling: {
    priority: 1,
    description: 'Celebration-ready bubbles',
    signals: ['celebration', 'aperitif', 'champagne', 'prosecco'],
    /** Storage types where this category is appropriate */
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    preferredZones: ['rose_sparkling'],
    matchRules: {
      colours: ['sparkling'],
      keywords: [
        'champagne', 'prosecco', 'cava', 'crémant', 'cremant',
        'sparkling', 'brut', 'spumante', 'sekt', 'cap classique',
        'method cap classique', 'mcc', 'méthode traditionnelle',
        'methode cap classique', 'mousseux', 'franciacorta', 'asti'
      ]
    }
  },

  crispWhite: {
    priority: 2,
    description: 'High-acid whites for seafood & salads',
    signals: ['fish', 'seafood', 'salad', 'light'],
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    preferredZones: ['sauvignon_blanc', 'loire_light', 'aromatic_whites'],
    matchRules: {
      colours: ['white'],
      grapes: ['sauvignon blanc', 'picpoul', 'muscadet', 'albariño', 'assyrtiko', 'gruner veltliner'],
      excludeWinemaking: ['oaked', 'barrel aged']
    }
  },

  aromaticWhite: {
    priority: 3,
    description: 'Off-dry/aromatic for spicy food',
    signals: ['spicy', 'asian', 'thai', 'indian', 'sweet'],
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    preferredZones: ['aromatic_whites'],
    matchRules: {
      colours: ['white'],
      grapes: ['riesling', 'gewürztraminer', 'gewurztraminer', 'viognier', 'torrontés', 'muscat'],
      keywords: ['aromatic', 'off-dry', 'semi-sweet']
    }
  },

  textureWhite: {
    priority: 4,
    description: 'Fuller whites for creamy dishes',
    signals: ['creamy', 'roasted', 'rich', 'butter'],
    /** Wine fridge only — kitchen fridges run too cold for textured/oaked whites */
    suitableFor: ['wine_fridge'],
    preferredZones: ['chardonnay', 'chenin_blanc'],
    matchRules: {
      colours: ['white'],
      grapes: ['chardonnay', 'chenin blanc'],
      winemaking: ['oaked', 'barrel aged', 'malolactic'],
      keywords: ['burgundy', 'meursault', 'oaked']
    }
  },

  rose: {
    priority: 5,
    description: 'Versatile weeknight option',
    signals: ['chicken', 'pork', 'light', 'summer'],
    suitableFor: ['wine_fridge', 'kitchen_fridge'],
    preferredZones: ['rose_sparkling'],
    matchRules: {
      colours: ['rose'],
      keywords: ['rosé', 'rose', 'rosado']
    }
  },

  chillableRed: {
    priority: 6,
    description: 'Light red for charcuterie',
    signals: ['pork', 'charcuterie', 'cheese', 'light red'],
    /** Wine fridge only — kitchen fridges too cold for red wine storage */
    suitableFor: ['wine_fridge'],
    preferredZones: ['pinot_noir', 'iberian_fresh'],
    matchRules: {
      colours: ['red'],
      grapes: ['pinot noir', 'gamay', 'frappato', 'mencía', 'grenache'],
      excludeKeywords: ['full body', 'oaked', 'reserve']
    }
  },

  dessertFortified: {
    priority: 7,
    description: 'Dessert & fortified wines for special occasions',
    signals: ['dessert', 'cheese', 'after dinner'],
    /** Wine fridge only — better served cool but not kitchen-fridge cold */
    suitableFor: ['wine_fridge'],
    preferredZones: ['dessert_fortified'],
    matchRules: {
      colours: ['dessert', 'fortified'],
      keywords: [
        'port', 'porto', 'sherry', 'madeira', 'marsala', 'vin santo',
        'sauternes', 'tokaji', 'ice wine', 'eiswein', 'late harvest',
        'noble rot', 'botrytis'
      ]
    }
  }
};

/**
 * Flex slot definition — fills remaining capacity with any drink-soon wine.
 * Always allocated last, at 10% of fridge capacity (minimum 1 slot).
 */
export const FLEX_CATEGORY = {
  priority: 99,
  description: "Any wine you're excited to drink soon",
  signals: [],
  suitableFor: ['wine_fridge', 'kitchen_fridge'],
  optional: true,
  matchRules: {}
};

/**
 * Display order for fridge categories (coldest top → warmest bottom).
 */
export const FRIDGE_CATEGORY_ORDER = [
  'sparkling',
  'crispWhite',
  'aromaticWhite',
  'textureWhite',
  'rose',
  'chillableRed',
  'dessertFortified',
  'flex'
];

/**
 * Human-readable display names for each fridge category.
 */
export const CATEGORY_DISPLAY_NAMES = {
  sparkling: 'Sparkling',
  crispWhite: 'Crisp White',
  aromaticWhite: 'Aromatic White',
  textureWhite: 'Oaked White',
  rose: 'Rosé',
  chillableRed: 'Light Red',
  dessertFortified: 'Dessert & Fortified',
  flex: 'Other'
};
