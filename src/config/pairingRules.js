/**
 * @fileoverview Food-to-wine pairing rules for deterministic scoring.
 * Maps food signals to wine style preferences.
 * @module config/pairingRules
 */

/**
 * Food signal categories with their wine style affinities.
 * Each signal maps to wine characteristics that pair well.
 *
 * Match levels:
 * - primary (3 pts): Classic pairing, highly recommended
 * - good (2 pts): Works well, solid choice
 * - fallback (1 pt): Acceptable but not ideal
 */
export const FOOD_SIGNALS = {
  // Proteins
  chicken: {
    description: 'Poultry - versatile, mild flavour',
    wineAffinities: {
      primary: ['white_medium', 'rose_dry', 'red_light'],
      good: ['white_crisp', 'sparkling_dry', 'white_aromatic'],
      fallback: ['red_medium']
    }
  },
  pork: {
    description: 'Pork - fatty, savoury',
    wineAffinities: {
      primary: ['white_medium', 'rose_dry', 'red_light'],
      good: ['white_aromatic', 'red_medium', 'sparkling_dry'],
      fallback: ['white_crisp']
    }
  },
  beef: {
    description: 'Beef - rich, umami',
    wineAffinities: {
      primary: ['red_full', 'red_medium'],
      good: ['red_light'],
      fallback: ['rose_dry']
    }
  },
  lamb: {
    description: 'Lamb - gamey, rich',
    wineAffinities: {
      primary: ['red_full', 'red_medium'],
      good: ['red_light', 'rose_dry'],
      fallback: []
    }
  },
  fish: {
    description: 'Fish - delicate, light',
    wineAffinities: {
      primary: ['white_crisp', 'sparkling_dry'],
      good: ['white_medium', 'rose_dry'],
      fallback: ['white_aromatic']
    }
  },
  shellfish: {
    description: 'Shellfish - briny, rich',
    wineAffinities: {
      primary: ['white_crisp', 'sparkling_dry', 'sparkling_rose'],
      good: ['white_medium', 'rose_dry'],
      fallback: []
    }
  },

  // Preparations
  roasted: {
    description: 'Roasted - caramelised, rich',
    wineAffinities: {
      primary: ['red_medium', 'white_oaked'],
      good: ['red_full', 'white_medium'],
      fallback: ['red_light']
    }
  },
  grilled: {
    description: 'Grilled - charred, smoky',
    wineAffinities: {
      primary: ['red_medium', 'red_full'],
      good: ['rose_dry', 'white_oaked'],
      fallback: ['red_light']
    }
  },
  fried: {
    description: 'Fried - crispy, fatty',
    wineAffinities: {
      primary: ['sparkling_dry', 'white_crisp'],
      good: ['rose_dry', 'white_medium'],
      fallback: ['red_light']
    }
  },
  braised: {
    description: 'Braised - slow-cooked, tender',
    wineAffinities: {
      primary: ['red_medium', 'red_full'],
      good: ['white_oaked'],
      fallback: ['red_light']
    }
  },
  raw: {
    description: 'Raw - fresh, delicate (sushi, tartare)',
    wineAffinities: {
      primary: ['sparkling_dry', 'white_crisp'],
      good: ['rose_dry'],
      fallback: ['white_aromatic']
    }
  },

  // Flavour profiles
  creamy: {
    description: 'Creamy - rich, fatty sauces',
    wineAffinities: {
      primary: ['white_oaked', 'sparkling_dry'],
      good: ['white_medium', 'red_light'],
      fallback: ['rose_dry']
    }
  },
  spicy: {
    description: 'Spicy - chili heat',
    wineAffinities: {
      primary: ['white_aromatic', 'rose_dry'],
      good: ['sparkling_dry', 'white_crisp'],
      fallback: ['red_light']
    }
  },
  sweet: {
    description: 'Sweet - caramelised, glazed',
    wineAffinities: {
      primary: ['white_aromatic', 'sparkling_rose'],
      good: ['rose_dry', 'red_light'],
      fallback: ['dessert']
    }
  },
  acid: {
    description: 'Acidic - citrus, vinegar',
    wineAffinities: {
      primary: ['white_crisp', 'sparkling_dry'],
      good: ['rose_dry', 'white_medium'],
      fallback: []
    }
  },
  umami: {
    description: 'Umami - savoury depth',
    wineAffinities: {
      primary: ['red_medium', 'red_full'],
      good: ['white_oaked', 'red_light'],
      fallback: ['rose_dry']
    }
  },
  herbal: {
    description: 'Herbal - fresh herbs',
    wineAffinities: {
      primary: ['white_crisp', 'white_aromatic'],
      good: ['rose_dry', 'red_light'],
      fallback: ['white_medium']
    }
  },
  earthy: {
    description: 'Earthy - mushrooms, truffles',
    wineAffinities: {
      primary: ['red_medium', 'red_light'],
      good: ['white_oaked', 'red_full'],
      fallback: []
    }
  },
  smoky: {
    description: 'Smoky - BBQ, smoked ingredients',
    wineAffinities: {
      primary: ['red_medium', 'red_full'],
      good: ['rose_dry', 'white_oaked'],
      fallback: ['red_light']
    }
  },

  // Specific ingredients
  tomato: {
    description: 'Tomato-based - needs high acid',
    wineAffinities: {
      primary: ['red_medium', 'white_crisp'],
      good: ['rose_dry', 'red_light'],
      fallback: []
    }
  },
  cheese: {
    description: 'Cheese - fatty, salty',
    wineAffinities: {
      primary: ['red_medium', 'sparkling_dry', 'white_oaked'],
      good: ['red_light', 'white_crisp', 'dessert'],
      fallback: ['rose_dry']
    }
  },
  mushroom: {
    description: 'Mushrooms - earthy, meaty',
    wineAffinities: {
      primary: ['red_light', 'red_medium'],
      good: ['white_oaked'],
      fallback: ['rose_dry']
    }
  },
  garlic_onion: {
    description: 'Alliums - pungent, savoury',
    wineAffinities: {
      primary: ['white_crisp', 'white_medium'],
      good: ['red_light', 'rose_dry'],
      fallback: ['red_medium']
    }
  },
  cured_meat: {
    description: 'Charcuterie - salty, fatty',
    wineAffinities: {
      primary: ['red_light', 'sparkling_dry', 'rose_dry'],
      good: ['white_crisp', 'red_medium'],
      fallback: []
    }
  },
  pepper: {
    description: 'Black pepper - warm spice',
    wineAffinities: {
      primary: ['red_medium', 'red_full'],
      good: ['red_light'],
      fallback: ['rose_dry']
    }
  },
  salty: {
    description: 'Salty foods',
    wineAffinities: {
      primary: ['sparkling_dry', 'white_crisp'],
      good: ['rose_dry', 'red_light'],
      fallback: ['white_aromatic']
    }
  }
};

/**
 * Wine style buckets with their characteristics.
 * Used for matching wines from cellar to style preferences.
 */
export const WINE_STYLES = {
  // Whites
  white_crisp: {
    description: 'High-acid, unoaked whites',
    colours: ['white'],
    grapes: ['sauvignon blanc', 'pinot grigio', 'muscadet', 'albariño', 'assyrtiko', 'vermentino', 'gruner veltliner', 'picpoul'],
    keywords: ['crisp', 'fresh', 'mineral', 'zesty', 'unoaked'],
    excludeKeywords: ['oaked', 'barrel', 'buttery', 'rich']
  },
  white_medium: {
    description: 'Medium-bodied whites, light oak ok',
    colours: ['white'],
    grapes: ['chardonnay', 'chenin blanc', 'viognier', 'marsanne', 'roussanne', 'white rioja'],
    keywords: ['medium', 'balanced'],
    excludeKeywords: ['heavily oaked', 'buttery']
  },
  white_oaked: {
    description: 'Full-bodied, oaked whites',
    colours: ['white'],
    grapes: ['chardonnay', 'white burgundy', 'fumé blanc'],
    keywords: ['oaked', 'barrel', 'buttery', 'rich', 'toasty', 'creamy', 'burgundy', 'meursault'],
    excludeKeywords: ['unoaked', 'stainless']
  },
  white_aromatic: {
    description: 'Aromatic, sometimes off-dry',
    colours: ['white'],
    grapes: ['riesling', 'gewürztraminer', 'gewurztraminer', 'torrontés', 'muscat', 'moscato'],
    keywords: ['aromatic', 'off-dry', 'floral', 'perfumed'],
    excludeKeywords: []
  },

  // Rosé
  rose_dry: {
    description: 'Dry rosé wines',
    colours: ['rose'],
    grapes: [],
    keywords: ['dry', 'provence'],
    excludeKeywords: ['sweet', 'blush']
  },

  // Reds
  red_light: {
    description: 'Light-bodied reds, serve slightly chilled',
    colours: ['red'],
    grapes: ['pinot noir', 'gamay', 'frappato', 'mencía', 'zweigelt', 'beaujolais', 'valpolicella'],
    keywords: ['light', 'delicate', 'fresh', 'elegant'],
    excludeKeywords: ['full', 'bold', 'powerful', 'reserve']
  },
  red_medium: {
    description: 'Medium-bodied reds',
    colours: ['red'],
    grapes: ['merlot', 'sangiovese', 'tempranillo', 'grenache', 'côtes du rhône', 'zinfandel', 'barbera', 'nebbiolo'],
    keywords: ['medium', 'smooth', 'balanced'],
    excludeKeywords: ['light', 'full', 'bold']
  },
  red_full: {
    description: 'Full-bodied, tannic reds',
    colours: ['red'],
    grapes: ['cabernet sauvignon', 'syrah', 'shiraz', 'malbec', 'petit verdot', 'mourvèdre', 'bordeaux', 'barolo', 'amarone'],
    keywords: ['full', 'bold', 'powerful', 'reserve', 'grand cru', 'tannic'],
    excludeKeywords: ['light', 'delicate']
  },

  // Sparkling
  sparkling_dry: {
    description: 'Dry sparkling wines',
    colours: ['sparkling'],
    grapes: ['champagne', 'prosecco', 'cava', 'crémant'],
    keywords: ['brut', 'extra brut', 'zero dosage'],
    excludeKeywords: ['demi-sec', 'sweet', 'moscato']
  },
  sparkling_rose: {
    description: 'Rosé sparkling',
    colours: ['sparkling'],
    grapes: [],
    keywords: ['rosé', 'rose', 'pink'],
    excludeKeywords: []
  },

  // Dessert
  dessert: {
    description: 'Sweet/dessert wines',
    colours: ['dessert', 'white', 'red'],
    grapes: ['sauternes', 'tokaji', 'ice wine', 'late harvest', 'port', 'pedro ximénez', 'vin santo'],
    keywords: ['sweet', 'dessert', 'late harvest', 'botrytis', 'noble rot', 'fortified'],
    excludeKeywords: ['dry']
  }
};

/**
 * House style preferences - user-tunable weights.
 * Each value is a multiplier: 1.0 = neutral, >1 = prefer, <1 = avoid
 */
export const DEFAULT_HOUSE_STYLE = {
  acidPreference: 1.0,        // Prefer high-acid wines (1.2 = like, 0.8 = dislike)
  oakPreference: 1.0,         // Prefer oaky wines
  tanninPreference: 1.0,      // Prefer tannic wines
  adventureLevel: 1.0,        // Prefer unusual pairings vs classics
  reduceNowBonus: 1.5,        // Bonus multiplier for reduce-now wines
  fridgeBonus: 1.2,           // Bonus for wines already in fridge
  diversityPenalty: 0.5       // Penalty for multiple wines of same style (per duplicate)
};

/**
 * Get all available food signals.
 * @returns {string[]} Signal names
 */
export function getAvailableSignals() {
  return Object.keys(FOOD_SIGNALS);
}

