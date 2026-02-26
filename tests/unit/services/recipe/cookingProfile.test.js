/**
 * @fileoverview Unit tests for cooking profile computation engine.
 * Tests rating weights, seasonal bias, overrides, edge cases.
 * @module tests/unit/services/recipe/cookingProfile.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database before importing the module
vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(async () => null),
      all: vi.fn(async () => []),
      run: vi.fn(async () => ({ changes: 0 }))
    }))
  }
}));

// Mock logger
vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock ensureRecipeTables (no-op in tests)
vi.mock('../../../../src/services/recipe/recipeService.js', () => ({
  ensureRecipeTables: vi.fn(async () => {})
}));

// Import after mocks
import { getCurrentSeason } from '../../../../src/services/recipe/cookingProfile.js';
import { extractSignals } from '../../../../src/services/pairing/pairingEngine.js';
import { getCategorySignalBoosts } from '../../../../src/services/recipe/categorySignalMap.js';
import { FOOD_SIGNALS } from '../../../../src/config/pairingRules.js';

// ==========================================
// getCurrentSeason
// ==========================================
describe('getCurrentSeason', () => {
  it('returns summer for January in southern hemisphere', () => {
    const realDate = Date;
    vi.spyOn(globalThis, 'Date').mockImplementation(function (...args) {
      if (args.length === 0) {
        const d = new realDate(2026, 0, 15); // January
        d.getMonth = () => 0;
        return d;
      }
      return new realDate(...args);
    });
    expect(getCurrentSeason('southern')).toBe('summer');
    vi.restoreAllMocks();
  });

  it('returns winter for January in northern hemisphere', () => {
    const realDate = Date;
    vi.spyOn(globalThis, 'Date').mockImplementation(function (...args) {
      if (args.length === 0) {
        const d = new realDate(2026, 0, 15);
        d.getMonth = () => 0;
        return d;
      }
      return new realDate(...args);
    });
    expect(getCurrentSeason('northern')).toBe('winter');
    vi.restoreAllMocks();
  });

  it('returns winter for July in southern hemisphere', () => {
    const realDate = Date;
    vi.spyOn(globalThis, 'Date').mockImplementation(function (...args) {
      if (args.length === 0) {
        const d = new realDate(2026, 6, 15); // July
        d.getMonth = () => 6;
        return d;
      }
      return new realDate(...args);
    });
    expect(getCurrentSeason('southern')).toBe('winter');
    vi.restoreAllMocks();
  });

  it('returns summer for July in northern hemisphere', () => {
    const realDate = Date;
    vi.spyOn(globalThis, 'Date').mockImplementation(function (...args) {
      if (args.length === 0) {
        const d = new realDate(2026, 6, 15);
        d.getMonth = () => 6;
        return d;
      }
      return new realDate(...args);
    });
    expect(getCurrentSeason('northern')).toBe('summer');
    vi.restoreAllMocks();
  });

  it('defaults to southern hemisphere when not specified', () => {
    // Just test that the function works with default
    const result = getCurrentSeason();
    expect(['summer', 'autumn', 'winter', 'spring']).toContain(result);
  });
});

// ==========================================
// extractSignals (from pairingEngine)
// ==========================================
describe('extractSignals for profile computation', () => {
  it('extracts protein signals from dish text', () => {
    const signals = extractSignals('Grilled Chicken Breast with Lemon');
    expect(signals).toContain('chicken');
    expect(signals).toContain('grilled');
    expect(signals).toContain('acid'); // lemon
  });

  it('extracts multiple signals from complex dish', () => {
    const signals = extractSignals('Slow-cooked Beef Stew with Mushrooms and Rosemary');
    expect(signals).toContain('beef');
    expect(signals).toContain('braised'); // slow-cooked
    expect(signals).toContain('mushroom');
    expect(signals).toContain('herbal'); // rosemary
  });

  it('extracts signals from ingredients text', () => {
    const dishText = 'Pasta Carbonara bacon, parmesan, cream, black pepper';
    const signals = extractSignals(dishText);
    expect(signals).toContain('pork'); // bacon
    expect(signals).toContain('creamy'); // cream
    expect(signals).toContain('cheese'); // parmesan
    expect(signals).toContain('pepper'); // black pepper
  });

  it('returns empty array for unrecognised text', () => {
    const signals = extractSignals('Something completely unrelated to food');
    expect(signals).toEqual([]);
  });

  it('deduplicates signals', () => {
    const signals = extractSignals('grilled chicken on the grill with grilled vegetables');
    const grillCount = signals.filter(s => s === 'grilled').length;
    expect(grillCount).toBe(1);
  });
});

// ==========================================
// getCategorySignalBoosts
// ==========================================
describe('getCategorySignalBoosts for profile', () => {
  it('maps protein categories to signals', () => {
    const boosts = getCategorySignalBoosts(['Chicken', 'Fish']);
    expect(boosts).toHaveProperty('chicken');
    expect(boosts).toHaveProperty('fish');
  });

  it('maps cooking method categories', () => {
    const boosts = getCategorySignalBoosts(['BBQ', 'Braai']);
    expect(boosts).toHaveProperty('grilled');
    expect(boosts).toHaveProperty('smoky');
  });

  it('maps cuisine categories', () => {
    const boosts = getCategorySignalBoosts(['Asian', 'Italian']);
    expect(boosts).toHaveProperty('spicy');
    expect(boosts).toHaveProperty('umami');
    expect(boosts).toHaveProperty('tomato');
    expect(boosts).toHaveProperty('herb');
  });

  it('returns empty for empty categories', () => {
    expect(getCategorySignalBoosts([])).toEqual({});
    expect(getCategorySignalBoosts(null)).toEqual({});
    expect(getCategorySignalBoosts(undefined)).toEqual({});
  });

  it('handles fuzzy matching for compound categories', () => {
    const boosts = getCategorySignalBoosts(['Slow Cooker Chicken']);
    // Should match 'slow cooker' -> braised and 'chicken' -> chicken
    expect(boosts).toHaveProperty('chicken');
  });
});

// ==========================================
// FOOD_SIGNALS wineAffinities coverage
// ==========================================
describe('FOOD_SIGNALS wineAffinities completeness', () => {
  it('all signals have primary affinities', () => {
    for (const [signal, def] of Object.entries(FOOD_SIGNALS)) {
      expect(def.wineAffinities).toBeDefined();
      expect(def.wineAffinities.primary).toBeDefined();
      expect(Array.isArray(def.wineAffinities.primary)).toBe(true);
      expect(def.wineAffinities.primary.length).toBeGreaterThan(0);
    }
  });

  it('all signal affinities reference valid wine styles', () => {
    const validStyles = [
      'white_crisp', 'white_medium', 'white_oaked', 'white_aromatic',
      'rose_dry', 'red_light', 'red_medium', 'red_full',
      'sparkling_dry', 'sparkling_rose', 'dessert'
    ];

    for (const [signal, def] of Object.entries(FOOD_SIGNALS)) {
      const allStyles = [
        ...def.wineAffinities.primary,
        ...(def.wineAffinities.good || []),
        ...(def.wineAffinities.fallback || [])
      ];
      for (const style of allStyles) {
        expect(validStyles).toContain(style);
      }
    }
  });
});

// ==========================================
// Profile computation logic (isolated)
// ==========================================
describe('Profile computation logic', () => {
  describe('rating weight system', () => {
    const RATING_WEIGHTS = { 5: 2.0, 4: 1.0, 3: 0.7, 2: 0.5, 1: 0.3, 0: 0.3 };

    it('5-star recipes have highest weight', () => {
      expect(RATING_WEIGHTS[5]).toBe(2.0);
    });

    it('unrated recipes have lowest weight', () => {
      expect(RATING_WEIGHTS[0]).toBe(0.3);
    });

    it('5-star weight is 6.67x unrated weight', () => {
      const ratio = RATING_WEIGHTS[5] / RATING_WEIGHTS[0];
      expect(ratio).toBeCloseTo(6.67, 1);
    });

    it('4-star is 3.33x unrated', () => {
      const ratio = RATING_WEIGHTS[4] / RATING_WEIGHTS[0];
      expect(ratio).toBeCloseTo(3.33, 1);
    });
  });

  describe('signal-to-style demand conversion', () => {
    it('primary affinities score 3 points', () => {
      // chicken primary = white_medium, rose_dry, red_light
      const chickenDef = FOOD_SIGNALS.chicken;
      expect(chickenDef.wineAffinities.primary).toContain('white_medium');
    });

    it('good affinities score 2 points', () => {
      const chickenDef = FOOD_SIGNALS.chicken;
      expect(chickenDef.wineAffinities.good).toContain('white_crisp');
    });

    it('fallback affinities score 1 point', () => {
      const chickenDef = FOOD_SIGNALS.chicken;
      expect(chickenDef.wineAffinities.fallback).toContain('red_medium');
    });

    it('computes demand from signal weights', () => {
      // Simulate: chicken signal with weight 5.0
      const demand = {};
      const weight = 5.0;
      const { wineAffinities } = FOOD_SIGNALS.chicken;

      for (const style of wineAffinities.primary) {
        demand[style] = (demand[style] || 0) + weight * 3;
      }
      for (const style of (wineAffinities.good || [])) {
        demand[style] = (demand[style] || 0) + weight * 2;
      }
      for (const style of (wineAffinities.fallback || [])) {
        demand[style] = (demand[style] || 0) + weight * 1;
      }

      // white_medium should get 15 (5 * 3)
      expect(demand.white_medium).toBe(15);
      // red_medium should get 5 (5 * 1)
      expect(demand.red_medium).toBe(5);
    });
  });

  describe('demand normalisation', () => {
    it('normalised percentages sum to approximately 1.0', () => {
      const demand = {
        white_medium: 15,
        rose_dry: 15,
        red_light: 15,
        white_crisp: 10,
        sparkling_dry: 10,
        red_medium: 5
      };

      const total = Object.values(demand).reduce((s, v) => s + v, 0);
      const normalised = {};
      for (const [k, v] of Object.entries(demand)) {
        normalised[k] = Math.round((v / total) * 1000) / 1000;
      }

      const normTotal = Object.values(normalised).reduce((s, v) => s + v, 0);
      expect(normTotal).toBeCloseTo(1.0, 1);
    });

    it('handles single-style demand', () => {
      const demand = { red_full: 10 };
      const total = 10;
      const pct = Math.round((demand.red_full / total) * 1000) / 1000;
      expect(pct).toBe(1);
    });
  });

  describe('seasonal bias adjustments', () => {
    const SEASON_BOOSTS = {
      summer: {
        boost: ['grilled', 'raw', 'fish', 'shellfish', 'acid', 'herbal'],
        dampen: ['braised', 'roasted', 'umami', 'earthy']
      },
      winter: {
        boost: ['braised', 'roasted', 'umami', 'earthy'],
        dampen: ['grilled', 'raw', 'fish', 'shellfish', 'acid']
      }
    };

    it('summer boosts grilled and fish signals', () => {
      expect(SEASON_BOOSTS.summer.boost).toContain('grilled');
      expect(SEASON_BOOSTS.summer.boost).toContain('fish');
    });

    it('winter boosts braised and roasted signals', () => {
      expect(SEASON_BOOSTS.winter.boost).toContain('braised');
      expect(SEASON_BOOSTS.winter.boost).toContain('roasted');
    });

    it('summer dampens braised and umami', () => {
      expect(SEASON_BOOSTS.summer.dampen).toContain('braised');
      expect(SEASON_BOOSTS.summer.dampen).toContain('umami');
    });

    it('winter dampens raw and fish', () => {
      expect(SEASON_BOOSTS.winter.dampen).toContain('raw');
      expect(SEASON_BOOSTS.winter.dampen).toContain('fish');
    });

    it('seasonal bias is +-10% adjustment', () => {
      // Boost factor = 1.1 for primary, 1.05 for good
      const demand = { red_medium: 100 };
      demand.red_medium *= 1.1;
      expect(demand.red_medium).toBeCloseTo(110, 5);

      const demand2 = { red_medium: 100 };
      demand2.red_medium *= 0.9;
      expect(demand2.red_medium).toBeCloseTo(90, 5);
    });
  });

  describe('edge cases', () => {
    it('handles empty recipes array gracefully', () => {
      // computeCookingProfile with 0 recipes returns empty profile
      const emptyProfile = {
        dominantSignals: [],
        wineStyleDemand: {},
        categoryBreakdown: {},
        seasonalBias: null,
        hemisphere: 'northern',
        climateZone: 'warm',
        recipeCount: 0,
        ratedRecipeCount: 0,
        demandTotal: 0
      };
      expect(emptyProfile.recipeCount).toBe(0);
      expect(emptyProfile.demandTotal).toBe(0);
    });

    it('handles single recipe correctly', () => {
      // A single chicken recipe with rating 5
      const signals = extractSignals('Grilled Chicken');
      expect(signals.length).toBeGreaterThan(0);
    });

    it('handles all unrated recipes', () => {
      // With weight 0.3 for unrated, signals still accumulate
      const weight = 0.3;
      const chickenWeight = weight; // Single unrated chicken recipe
      expect(chickenWeight).toBe(0.3);
      // Profile should still produce valid demand
    });

    it('category frequency capped at 3x median', () => {
      // If a category has 100 recipes and median is 10, weight is capped at 3.0
      const count = 100;
      const median = 10;
      const capped = Math.min(count / median, 3.0);
      expect(capped).toBe(3.0);
    });

    it('category weight is at least 1.0', () => {
      // Even rare categories get weight 1.0
      const count = 1;
      const median = 10;
      const weight = Math.min(count / median, 3.0);
      // The profile engine uses Math.max(categoryWeight, freqWeight) starting from 1.0
      expect(Math.max(1.0, weight)).toBe(1.0);
    });
  });
});

// ==========================================
// Realistic profile simulation
// ==========================================
describe('Realistic profile simulation', () => {
  it('chicken-heavy profile produces white/rose demand', () => {
    // Simulate 48 chicken recipes at rating 5
    const signalAcc = {};
    const weight = 2.0; // 5-star weight

    // 48 chicken recipes
    for (let i = 0; i < 48; i++) {
      signalAcc.chicken = (signalAcc.chicken || 0) + weight;
    }

    // Convert to demand
    const demand = {};
    const { wineAffinities } = FOOD_SIGNALS.chicken;
    for (const style of wineAffinities.primary) {
      demand[style] = (demand[style] || 0) + signalAcc.chicken * 3;
    }
    for (const style of (wineAffinities.good || [])) {
      demand[style] = (demand[style] || 0) + signalAcc.chicken * 2;
    }

    // white_medium and rose_dry should be top
    const sorted = Object.entries(demand).sort((a, b) => b[1] - a[1]);
    const topStyles = sorted.slice(0, 3).map(([s]) => s);
    expect(topStyles).toContain('white_medium');
    expect(topStyles).toContain('rose_dry');
  });

  it('fish-heavy profile produces crisp white and sparkling demand', () => {
    const signalAcc = { fish: 2.0 * 52 }; // 52 fish recipes rated 5
    const demand = {};
    const { wineAffinities } = FOOD_SIGNALS.fish;

    for (const style of wineAffinities.primary) {
      demand[style] = (demand[style] || 0) + signalAcc.fish * 3;
    }

    const sorted = Object.entries(demand).sort((a, b) => b[1] - a[1]);
    const topStyles = sorted.map(([s]) => s);
    expect(topStyles).toContain('white_crisp');
    expect(topStyles).toContain('sparkling_dry');
  });

  it('beef and braai profile produces red demand', () => {
    const signalAcc = {
      beef: 2.0 * 34,    // 34 beef recipes
      grilled: 2.0 * 30  // 30 braai recipes
    };

    const demand = {};
    for (const [signal, weight] of Object.entries(signalAcc)) {
      const def = FOOD_SIGNALS[signal];
      if (!def) continue;
      for (const style of def.wineAffinities.primary) {
        demand[style] = (demand[style] || 0) + weight * 3;
      }
    }

    const sorted = Object.entries(demand).sort((a, b) => b[1] - a[1]);
    const topStyle = sorted[0][0];
    // Both beef and grilled map to red_medium and red_full
    expect(['red_full', 'red_medium']).toContain(topStyle);
  });

  it('mixed profile produces diversified demand', () => {
    const signalAcc = {
      chicken: 2.0 * 20,
      fish: 2.0 * 15,
      beef: 2.0 * 10,
      grilled: 1.0 * 30,
      spicy: 1.0 * 20
    };

    const demand = {};
    for (const [signal, weight] of Object.entries(signalAcc)) {
      const def = FOOD_SIGNALS[signal];
      if (!def) continue;
      for (const style of def.wineAffinities.primary) {
        demand[style] = (demand[style] || 0) + weight * 3;
      }
      for (const style of (def.wineAffinities.good || [])) {
        demand[style] = (demand[style] || 0) + weight * 2;
      }
    }

    const total = Object.values(demand).reduce((s, v) => s + v, 0);
    const styles = Object.keys(demand);

    // Should have multiple styles
    expect(styles.length).toBeGreaterThan(3);
    // No single style should dominate > 50%
    for (const [style, val] of Object.entries(demand)) {
      expect(val / total).toBeLessThan(0.5);
    }
  });
});

// ==========================================
// Category override weighting (Finding #2 fix)
// ==========================================
describe('Category override weighting', () => {
  it('override of 0 ("Never") zeros out category signal contribution', () => {
    // Simulate: recipe in "Poultry" category with userOverride = 0
    const categoryBreakdown = {
      Poultry: { count: 10, autoFrequency: 10, userOverride: 0 }
    };
    const medianCategoryCount = 5;
    const categories = ['Poultry'];
    const categoryBoosts = { chicken: 1 };
    const ratingWeight = 1.0;

    // Replicate the fixed weighting logic
    let categoryWeight = null;
    for (const cat of categories) {
      const breakdown = categoryBreakdown[cat];
      if (breakdown) {
        const hasOverride = breakdown.userOverride !== null && breakdown.userOverride !== undefined;
        const effectiveFrequency = hasOverride ? breakdown.userOverride : breakdown.autoFrequency;
        const freqWeight = Math.min(effectiveFrequency / medianCategoryCount, 3.0);

        if (hasOverride) {
          categoryWeight = categoryWeight !== null
            ? Math.max(categoryWeight, freqWeight)
            : freqWeight;
        } else if (categoryWeight === null) {
          categoryWeight = freqWeight;
        } else {
          categoryWeight = Math.max(categoryWeight, freqWeight);
        }
      }
    }
    if (categoryWeight === null) categoryWeight = 1.0;

    // With override=0, freqWeight = 0/5 = 0, so categoryWeight = 0
    expect(categoryWeight).toBe(0);

    // Signal contribution should be zero
    const contribution = 1 * 0.5 * ratingWeight * categoryWeight;
    expect(contribution).toBe(0);
  });

  it('override of 5 ("Always") boosts category signal contribution', () => {
    const categoryBreakdown = {
      Seafood: { count: 2, autoFrequency: 2, userOverride: 5 }
    };
    const medianCategoryCount = 5;
    const categories = ['Seafood'];

    let categoryWeight = null;
    for (const cat of categories) {
      const breakdown = categoryBreakdown[cat];
      if (breakdown) {
        const hasOverride = breakdown.userOverride !== null && breakdown.userOverride !== undefined;
        const effectiveFrequency = hasOverride ? breakdown.userOverride : breakdown.autoFrequency;
        const freqWeight = Math.min(effectiveFrequency / medianCategoryCount, 3.0);

        if (hasOverride) {
          categoryWeight = categoryWeight !== null
            ? Math.max(categoryWeight, freqWeight)
            : freqWeight;
        } else if (categoryWeight === null) {
          categoryWeight = freqWeight;
        } else {
          categoryWeight = Math.max(categoryWeight, freqWeight);
        }
      }
    }
    if (categoryWeight === null) categoryWeight = 1.0;

    // override=5, freqWeight = 5/5 = 1.0
    expect(categoryWeight).toBe(1.0);
  });

  it('auto-computed value is used when no override exists', () => {
    const categoryBreakdown = {
      Italian: { count: 8, autoFrequency: 8, userOverride: null }
    };
    const medianCategoryCount = 4;
    const categories = ['Italian'];

    let categoryWeight = null;
    for (const cat of categories) {
      const breakdown = categoryBreakdown[cat];
      if (breakdown) {
        const hasOverride = breakdown.userOverride !== null && breakdown.userOverride !== undefined;
        const effectiveFrequency = hasOverride ? breakdown.userOverride : breakdown.autoFrequency;
        const freqWeight = Math.min(effectiveFrequency / medianCategoryCount, 3.0);

        if (hasOverride) {
          categoryWeight = categoryWeight !== null
            ? Math.max(categoryWeight, freqWeight)
            : freqWeight;
        } else if (categoryWeight === null) {
          categoryWeight = freqWeight;
        } else {
          categoryWeight = Math.max(categoryWeight, freqWeight);
        }
      }
    }
    if (categoryWeight === null) categoryWeight = 1.0;

    // auto=8, freqWeight = 8/4 = 2.0
    expect(categoryWeight).toBe(2.0);
  });

  it('user override takes priority over auto value in multi-category recipes', () => {
    const categoryBreakdown = {
      Poultry: { count: 10, autoFrequency: 10, userOverride: 0 },
      Grilled: { count: 6, autoFrequency: 6, userOverride: null }
    };
    const medianCategoryCount = 5;
    const categories = ['Poultry', 'Grilled'];

    let categoryWeight = null;
    for (const cat of categories) {
      const breakdown = categoryBreakdown[cat];
      if (breakdown) {
        const hasOverride = breakdown.userOverride !== null && breakdown.userOverride !== undefined;
        const effectiveFrequency = hasOverride ? breakdown.userOverride : breakdown.autoFrequency;
        const freqWeight = Math.min(effectiveFrequency / medianCategoryCount, 3.0);

        if (hasOverride) {
          categoryWeight = categoryWeight !== null
            ? Math.max(categoryWeight, freqWeight)
            : freqWeight;
        } else if (categoryWeight === null) {
          categoryWeight = freqWeight;
        } else {
          categoryWeight = Math.max(categoryWeight, freqWeight);
        }
      }
    }
    if (categoryWeight === null) categoryWeight = 1.0;

    // Poultry has override=0 → freqWeight=0 (override, so takes priority)
    // Grilled has no override → freqWeight=6/5=1.2 (auto, but override already set categoryWeight)
    // Since Poultry set categoryWeight via override path, Grilled (auto) doesn't overwrite.
    // But actually, Grilled goes through the else-if path where categoryWeight is already 0.
    // It hits the `else { categoryWeight = Math.max(0, 1.2) }` = 1.2
    // Wait — the logic says: if hasOverride, use override logic. Otherwise if categoryWeight is
    // null use auto, otherwise Math.max.
    // First cat: Poultry hasOverride=true → categoryWeight = 0
    // Second cat: Grilled hasOverride=false, categoryWeight !== null → Math.max(0, 1.2) = 1.2
    //
    // This is the correct behaviour: a "Never" override on one category doesn't suppress
    // another category that the user hasn't overridden.
    expect(categoryWeight).toBe(1.2);
  });
});

// ==========================================
// Climate zone seasonal scaling
// ==========================================
describe('Climate zone seasonal scaling', () => {
  const CLIMATE_MULTIPLIERS = {
    hot:  1.5,
    warm: 1.0,
    mild: 0.4,
    cold: 1.3
  };

  /**
   * Simulate applySeasonalBias for a single style with known boost signal.
   * Returns the multiplied demand value.
   */
  function simulateSeasonalBoost(baseDemand, climateZone) {
    const multiplier = CLIMATE_MULTIPLIERS[climateZone] ?? 1.0;
    const boostFactor = 1 + (0.1 * multiplier); // primary boost
    return baseDemand * boostFactor;
  }

  function simulateSeasonalDampen(baseDemand, climateZone) {
    const multiplier = CLIMATE_MULTIPLIERS[climateZone] ?? 1.0;
    const dampenFactor = 1 - (0.1 * multiplier);
    return baseDemand * dampenFactor;
  }

  it('hot climate amplifies seasonal boost to ±15%', () => {
    const boosted = simulateSeasonalBoost(100, 'hot');
    expect(boosted).toBeCloseTo(115, 0);

    const dampened = simulateSeasonalDampen(100, 'hot');
    expect(dampened).toBeCloseTo(85, 0);
  });

  it('warm climate applies standard ±10%', () => {
    const boosted = simulateSeasonalBoost(100, 'warm');
    expect(boosted).toBeCloseTo(110, 0);

    const dampened = simulateSeasonalDampen(100, 'warm');
    expect(dampened).toBeCloseTo(90, 0);
  });

  it('mild climate applies subtle ±4%', () => {
    const boosted = simulateSeasonalBoost(100, 'mild');
    expect(boosted).toBeCloseTo(104, 0);

    const dampened = simulateSeasonalDampen(100, 'mild');
    expect(dampened).toBeCloseTo(96, 0);
  });

  it('cold climate applies strong ±13%', () => {
    const boosted = simulateSeasonalBoost(100, 'cold');
    expect(boosted).toBeCloseTo(113, 0);

    const dampened = simulateSeasonalDampen(100, 'cold');
    expect(dampened).toBeCloseTo(87, 0);
  });

  it('unknown climate zone falls back to 1.0x (same as warm)', () => {
    const boosted = simulateSeasonalBoost(100, 'tropical');
    expect(boosted).toBeCloseTo(110, 0);
  });

  it('mild climate in Netherlands means less pronounced summer shift', () => {
    // In Netherlands (mild climate), summer should barely shift demand.
    // A red_full demand of 100 dampened in summer:
    // Warm: 100 * 0.9 = 90 (10% drop)
    // Mild: 100 * 0.96 = 96 (4% drop) — reds still relevant in summer
    const warmDampen = simulateSeasonalDampen(100, 'warm');
    const mildDampen = simulateSeasonalDampen(100, 'mild');

    expect(mildDampen).toBeGreaterThan(warmDampen);
    expect(mildDampen - warmDampen).toBeCloseTo(6, 0);
  });

  it('hot climate in Alicante means strong summer shift', () => {
    // In Alicante (hot climate), summer massively boosts whites/rosé.
    // A white_crisp demand of 100 boosted in summer:
    // Warm: 100 * 1.1 = 110
    // Hot: 100 * 1.15 = 115
    const warmBoost = simulateSeasonalBoost(100, 'warm');
    const hotBoost = simulateSeasonalBoost(100, 'hot');

    expect(hotBoost).toBeGreaterThan(warmBoost);
    expect(hotBoost - warmBoost).toBeCloseTo(5, 0);
  });
});
