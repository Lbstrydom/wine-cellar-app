/**
 * @fileoverview Cooking profile computation engine.
 * Analyses recipe collection to produce wine style demand percentages.
 * @module services/recipe/cookingProfile
 */

import db from '../../db/index.js';
import { ensureRecipeTables } from './recipeService.js';
import { extractSignals } from '../pairing/pairingEngine.js';
import { getCategorySignalBoosts } from './categorySignalMap.js';
import { FOOD_SIGNALS } from '../../config/pairingRules.js';
import logger from '../../utils/logger.js';

/** Rating weights: rated recipes dominate over unrated */
const RATING_WEIGHTS = {
  5: 2.0,
  4: 1.0,
  3: 0.7,
  2: 0.5,
  1: 0.3,
  0: 0.3 // unrated
};

/** Seasonal signal boosts (+-10%) */
const SEASON_BOOSTS = {
  summer: {
    boost: ['grilled', 'raw', 'fish', 'shellfish', 'acid', 'herbal'],
    dampen: ['braised', 'roasted', 'umami', 'earthy']
  },
  winter: {
    boost: ['braised', 'roasted', 'umami', 'earthy'],
    dampen: ['grilled', 'raw', 'fish', 'shellfish', 'acid']
  },
  spring: {
    boost: ['herbal', 'raw', 'fish', 'acid'],
    dampen: ['braised', 'earthy']
  },
  autumn: {
    boost: ['roasted', 'earthy', 'mushroom', 'umami'],
    dampen: ['raw', 'acid']
  }
};

/**
 * Get current season based on hemisphere.
 * @param {string} [hemisphere='southern'] - 'southern' or 'northern'
 * @returns {string} Current season
 */
export function getCurrentSeason(hemisphere = 'southern') {
  const month = new Date().getMonth(); // 0-indexed
  const seasons = hemisphere === 'southern'
    ? ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer']
    : ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  return seasons[month];
}

/**
 * Compute cooking profile from a cellar's recipes.
 * @param {string} cellarId - Cellar ID
 * @param {Object} [options] - Options
 * @param {boolean} [options.forceRefresh=false] - Skip cache
 * @returns {Promise<Object>} Cooking profile
 */
export async function computeCookingProfile(cellarId, options = {}) {
  await ensureRecipeTables();

  const { forceRefresh = false } = options;

  // Check cache unless forced refresh
  if (!forceRefresh) {
    const cached = await db.prepare(`
      SELECT profile_data, generated_at FROM cooking_profiles
      WHERE cellar_id = $1
    `).get(cellarId);

    if (cached) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      const ONE_HOUR = 60 * 60 * 1000;
      if (age < ONE_HOUR) {
        return typeof cached.profile_data === 'string'
          ? JSON.parse(cached.profile_data)
          : cached.profile_data;
      }
    }
  }

  // Fetch all active recipes
  const recipes = await db.prepare(`
    SELECT id, name, ingredients, categories, rating
    FROM recipes
    WHERE cellar_id = $1 AND deleted_at IS NULL
  `).all(cellarId);

  if (recipes.length === 0) {
    return buildEmptyProfile();
  }

  // Fetch cellar settings for hemisphere + category overrides
  const cellar = await db.prepare(`
    SELECT settings FROM cellars WHERE id = $1
  `).get(cellarId);

  const settings = cellar?.settings
    ? (typeof cellar.settings === 'string' ? JSON.parse(cellar.settings) : cellar.settings)
    : {};

  const hemisphere = settings.hemisphere || 'southern';
  const categoryOverrides = settings.categoryOverrides || {};

  // Compute category frequencies
  const categoryBreakdown = computeCategoryBreakdown(recipes, categoryOverrides);

  // Compute median category count for normalisation
  const categoryCounts = Object.values(categoryBreakdown).map(c => c.count).filter(c => c > 0);
  const medianCategoryCount = categoryCounts.length > 0
    ? median(categoryCounts)
    : 1;

  // Accumulate weighted signals across all recipes
  const signalAccumulator = {};
  let ratedRecipeCount = 0;

  for (const recipe of recipes) {
    if (recipe.rating > 0) ratedRecipeCount++;

    const ratingWeight = RATING_WEIGHTS[recipe.rating ?? 0] ?? 0.3;

    // 1. Primary: text-based signals from name + ingredients
    const dishText = [recipe.name, recipe.ingredients || ''].join(' ');
    const textSignals = extractSignals(dishText);

    for (const signal of textSignals) {
      signalAccumulator[signal] = (signalAccumulator[signal] || 0) + ratingWeight;
    }

    // 2. Secondary: category-based signal boosts (0.5x weight)
    const categories = safeParseCategories(recipe.categories);
    const categoryBoosts = getCategorySignalBoosts(categories);

    // Apply category frequency weighting
    for (const [signal, boostWeight] of Object.entries(categoryBoosts)) {
      // Find the best matching category for this recipe to get its frequency weight.
      // When a user override exists, respect it (including 0 = "Never").
      // For auto-computed values, pick the highest across categories.
      let categoryWeight = null;
      for (const cat of categories) {
        const breakdown = categoryBreakdown[cat];
        if (breakdown) {
          const hasOverride = breakdown.userOverride !== null && breakdown.userOverride !== undefined;
          const effectiveFrequency = hasOverride ? breakdown.userOverride : breakdown.autoFrequency;
          const freqWeight = Math.min(effectiveFrequency / medianCategoryCount, 3.0);

          if (hasOverride) {
            // User overrides take priority — use the max override across categories
            categoryWeight = categoryWeight !== null
              ? Math.max(categoryWeight, freqWeight)
              : freqWeight;
          } else if (categoryWeight === null) {
            // No override seen yet — use auto value
            categoryWeight = freqWeight;
          } else {
            // Already have a value; take the higher auto value
            categoryWeight = Math.max(categoryWeight, freqWeight);
          }
        }
      }

      // Default to 1.0 only if no category matched at all
      if (categoryWeight === null) categoryWeight = 1.0;

      signalAccumulator[signal] = (signalAccumulator[signal] || 0) +
        (boostWeight * 0.5 * ratingWeight * categoryWeight);
    }
  }

  // Convert weighted signals to wine style demand
  const styleDemand = computeStyleDemand(signalAccumulator);

  // Apply seasonal bias
  const season = getCurrentSeason(hemisphere);
  applySeasonalBias(styleDemand, signalAccumulator, season);

  // Normalise to percentages (sum to 1.0)
  const demandTotal = Object.values(styleDemand).reduce((sum, v) => sum + v, 0);
  if (demandTotal > 0) {
    for (const style of Object.keys(styleDemand)) {
      styleDemand[style] = Math.round((styleDemand[style] / demandTotal) * 1000) / 1000;
    }
  }

  // Build sorted dominant signals
  const dominantSignals = Object.entries(signalAccumulator)
    .map(([signal, weight]) => ({ signal, weight: Math.round(weight * 10) / 10 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);

  const profile = {
    dominantSignals,
    wineStyleDemand: styleDemand,
    categoryBreakdown,
    seasonalBias: season,
    hemisphere,
    recipeCount: recipes.length,
    ratedRecipeCount,
    demandTotal: Math.round(Object.values(styleDemand).reduce((s, v) => s + v, 0) * 1000) / 1000
  };

  // Cache the profile
  await db.prepare(`
    INSERT INTO cooking_profiles (cellar_id, profile_data, generated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (cellar_id)
    DO UPDATE SET profile_data = $2::jsonb, generated_at = NOW()
  `).run(cellarId, JSON.stringify(profile));

  logger.info('CookingProfile', `Profile computed for cellar ${cellarId}: ${recipes.length} recipes, ${dominantSignals.length} signals`);

  return profile;
}

/**
 * Invalidate cached profile (e.g. after import/delete).
 * @param {string} cellarId - Cellar ID
 */
export async function invalidateProfile(cellarId) {
  await ensureRecipeTables();
  await db.prepare(`
    DELETE FROM cooking_profiles WHERE cellar_id = $1
  `).run(cellarId);
}

/**
 * Compute category breakdown from recipes.
 * @param {Object[]} recipes - Recipe rows
 * @param {Object} overrides - User category frequency overrides
 * @returns {Object} Category breakdown
 */
function computeCategoryBreakdown(recipes, overrides = {}) {
  const counts = {};

  for (const recipe of recipes) {
    const cats = safeParseCategories(recipe.categories);
    for (const cat of cats) {
      const key = cat.trim();
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
  }

  const breakdown = {};
  for (const [category, count] of Object.entries(counts)) {
    breakdown[category] = {
      count,
      autoFrequency: count,
      userOverride: overrides[category] !== undefined ? overrides[category] : null
    };
  }

  return breakdown;
}

/**
 * Convert weighted signal map to wine style demand.
 * Uses FOOD_SIGNALS[signal].wineAffinities: primary=3pts, good=2pts, fallback=1pt.
 * @param {Object} signalAccumulator - Signal -> accumulated weight
 * @returns {Object} Style -> demand score
 */
function computeStyleDemand(signalAccumulator) {
  const demand = {};

  for (const [signal, weight] of Object.entries(signalAccumulator)) {
    const signalDef = FOOD_SIGNALS[signal];
    if (!signalDef) continue;

    const { wineAffinities } = signalDef;

    for (const style of (wineAffinities.primary || [])) {
      demand[style] = (demand[style] || 0) + weight * 3;
    }
    for (const style of (wineAffinities.good || [])) {
      demand[style] = (demand[style] || 0) + weight * 2;
    }
    for (const style of (wineAffinities.fallback || [])) {
      demand[style] = (demand[style] || 0) + weight * 1;
    }
  }

  return demand;
}

/**
 * Apply seasonal bias to style demand (+-10%).
 * Modifies demand in place.
 * @param {Object} demand - Style demand map
 * @param {Object} signalAccumulator - Signal weights
 * @param {string} season - Current season
 */
function applySeasonalBias(demand, signalAccumulator, season) {
  const bias = SEASON_BOOSTS[season];
  if (!bias) return;

  // Identify styles affected by boosted/dampened signals
  for (const signal of bias.boost) {
    const signalDef = FOOD_SIGNALS[signal];
    if (!signalDef) continue;
    for (const style of (signalDef.wineAffinities.primary || [])) {
      if (demand[style]) demand[style] *= 1.1;
    }
    for (const style of (signalDef.wineAffinities.good || [])) {
      if (demand[style]) demand[style] *= 1.05;
    }
  }

  for (const signal of bias.dampen) {
    const signalDef = FOOD_SIGNALS[signal];
    if (!signalDef) continue;
    for (const style of (signalDef.wineAffinities.primary || [])) {
      if (demand[style]) demand[style] *= 0.9;
    }
    for (const style of (signalDef.wineAffinities.good || [])) {
      if (demand[style]) demand[style] *= 0.95;
    }
  }
}

/**
 * Build an empty profile for cellars with no recipes.
 * @returns {Object} Empty profile
 */
function buildEmptyProfile() {
  return {
    dominantSignals: [],
    wineStyleDemand: {},
    categoryBreakdown: {},
    seasonalBias: null,
    hemisphere: 'southern',
    recipeCount: 0,
    ratedRecipeCount: 0,
    demandTotal: 0
  };
}

/**
 * Safely parse categories from DB JSON string or array.
 * @param {string|string[]} cats
 * @returns {string[]}
 */
function safeParseCategories(cats) {
  if (Array.isArray(cats)) return cats;
  if (typeof cats === 'string') {
    try { return JSON.parse(cats); } catch { return []; }
  }
  return [];
}

/**
 * Compute median of a number array.
 * @param {number[]} arr
 * @returns {number}
 */
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
