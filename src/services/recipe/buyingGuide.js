/**
 * @fileoverview Buying guide gap analysis engine.
 * Compares cooking profile wine style demand against cellar inventory
 * to identify gaps, surpluses, and diversity recommendations.
 * @module services/recipe/buyingGuide
 */

import db from '../../db/index.js';
import { matchWineToStyle } from '../pairing/pairingEngine.js';
import { computeCookingProfile } from './cookingProfile.js';
import { FOOD_SIGNALS } from '../../config/pairingRules.js';
import logger from '../../utils/logger.js';

/** Shopping suggestions by style bucket */
const SHOPPING_SUGGESTIONS = {
  white_crisp: ['Sauvignon Blanc', 'Pinot Grigio', 'Albari\u00f1o', 'Muscadet', 'Vermentino'],
  white_medium: ['Chardonnay (unoaked)', 'Chenin Blanc', 'Pinot Blanc', 'Gr\u00fcner Veltliner'],
  white_oaked: ['Oaked Chardonnay', 'White Burgundy', 'White Rioja', 'Fumé Blanc'],
  white_aromatic: ['Riesling', 'Gew\u00fcrztraminer', 'Viognier', 'Torront\u00e9s'],
  rose_dry: ['Provence Ros\u00e9', 'C\u00f4tes de Provence', 'Tavel', 'Grenache Ros\u00e9'],
  red_light: ['Pinot Noir', 'Gamay', 'Beaujolais', 'Valpolicella'],
  red_medium: ['Merlot', 'C\u00f4tes du Rh\u00f4ne', 'Chianti', 'Rioja', 'Pinotage'],
  red_full: ['Cabernet Sauvignon', 'Shiraz', 'Malbec', 'Barolo', 'Pinotage'],
  sparkling_dry: ['Champagne', 'Prosecco', 'Cava', 'Cr\u00e9mant', 'Cap Classique'],
  sparkling_rose: ['Ros\u00e9 Champagne', 'Ros\u00e9 Prosecco', 'Ros\u00e9 Cap Classique'],
  dessert: ['Sauternes', 'Port', 'Ice Wine', 'PX Sherry', 'Muscat de Beaumes-de-Venise']
};

/** Style labels for display */
const STYLE_LABELS = {
  white_crisp: 'Crisp White',
  white_medium: 'Medium White',
  white_oaked: 'Oaked White',
  white_aromatic: 'Aromatic White',
  rose_dry: 'Dry Ros\u00e9',
  red_light: 'Light Red',
  red_medium: 'Medium Red',
  red_full: 'Full Red',
  sparkling_dry: 'Sparkling',
  sparkling_rose: 'Sparkling Ros\u00e9',
  dessert: 'Dessert'
};

/**
 * Generate full buying guide report.
 * @param {string} cellarId - Cellar ID
 * @param {Object} [options] - Options
 * @param {boolean} [options.forceRefresh=false] - Force profile recompute
 * @returns {Promise<Object>} Buying guide report
 */
export async function generateBuyingGuide(cellarId, options = {}) {
  // 1. Get cooking profile (cached unless forced)
  const profile = await computeCookingProfile(cellarId, {
    forceRefresh: options.forceRefresh || false
  });

  if (profile.recipeCount === 0) {
    return buildEmptyGuide();
  }

  // 2. Get cellar wines and classify into style buckets
  const wines = await getCellarWines(cellarId);
  const { styleCounts, totalBottles, winesByStyle } = classifyWines(wines);

  if (totalBottles === 0) {
    return buildNoWinesGuide(profile);
  }

  // 3. Calculate demand-proportional targets
  const targets = computeTargets(profile.wineStyleDemand, totalBottles);

  // 3b. Guard: if demand extraction produced no meaningful targets,
  // report 0% coverage instead of a misleading 100%
  const totalTargetedStyles = Object.keys(targets).filter(s => targets[s] >= 1).length;
  if (totalTargetedStyles === 0) {
    return {
      coveragePct: 0,
      bottleCoveragePct: 0,
      totalBottles,
      gaps: [],
      surpluses: [],
      diversityRecs: [],
      targets,
      styleCounts,
      recipeCount: profile.recipeCount,
      seasonalBias: profile.seasonalBias,
      hemisphere: profile.hemisphere,
      noTargets: true
    };
  }

  // 4. Compute gaps and surpluses
  const gaps = computeGaps(targets, styleCounts, profile);
  const surpluses = computeSurpluses(targets, styleCounts, winesByStyle);

  // 5. Diversity recommendations
  const diversityRecs = computeDiversityRecs(profile.wineStyleDemand, styleCounts);

  // 6. Coverage percentage
  const coveredStyles = Object.keys(targets).filter(
    s => targets[s] >= 1 && (styleCounts[s] || 0) >= targets[s]
  ).length;
  const coveragePct = Math.round((coveredStyles / totalTargetedStyles) * 100);

  // 7. Coverage by bottle count
  let bottlesCovered = 0;
  let bottlesNeeded = 0;
  for (const [style, target] of Object.entries(targets)) {
    if (target < 1) continue;
    const have = styleCounts[style] || 0;
    bottlesCovered += Math.min(have, target);
    bottlesNeeded += target;
  }
  const bottleCoveragePct = bottlesNeeded > 0
    ? Math.round((bottlesCovered / bottlesNeeded) * 100)
    : 0;

  const guide = {
    coveragePct,
    bottleCoveragePct,
    totalBottles,
    gaps,
    surpluses,
    diversityRecs,
    targets,
    styleCounts,
    recipeCount: profile.recipeCount,
    seasonalBias: profile.seasonalBias,
    hemisphere: profile.hemisphere
  };

  logger.info('BuyingGuide', `Guide for cellar ${cellarId}: ${coveragePct}% coverage, ${gaps.length} gaps, ${surpluses.length} surpluses`);

  return guide;
}

/**
 * Get all wines with bottle counts for style classification.
 * @param {string} cellarId - Cellar ID
 * @returns {Promise<Array>} Wine rows
 */
async function getCellarWines(cellarId) {
  const sql = `
    SELECT
      w.id, w.wine_name, w.vintage, w.style, w.colour,
      w.country, w.grapes, w.region, w.winemaking,
      COUNT(DISTINCT s.id) as bottle_count,
      COALESCE(MIN(rn.priority), 99) as reduce_priority,
      MIN(dw.drink_by_year) as drink_by_year
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON w.id = rn.wine_id
    LEFT JOIN drinking_windows dw ON dw.wine_id = w.id
    WHERE w.cellar_id = $1
    GROUP BY w.id, w.wine_name, w.vintage, w.style, w.colour,
             w.country, w.grapes, w.region, w.winemaking
    HAVING COUNT(DISTINCT s.id) > 0
  `;
  return await db.prepare(sql).all(cellarId);
}

/**
 * Classify wines into style buckets.
 * @param {Array} wines - Wine rows
 * @returns {{styleCounts: Object, totalBottles: number, winesByStyle: Object}}
 */
function classifyWines(wines) {
  const styleCounts = {};
  const winesByStyle = {};
  let totalBottles = 0;

  for (const wine of wines) {
    const match = matchWineToStyle(wine);
    const styleId = match?.styleId || 'unknown';
    const count = Number(wine.bottle_count) || 0;

    styleCounts[styleId] = (styleCounts[styleId] || 0) + count;
    totalBottles += count;

    if (!winesByStyle[styleId]) winesByStyle[styleId] = [];
    winesByStyle[styleId].push({
      id: wine.id,
      name: wine.wine_name,
      vintage: wine.vintage,
      bottles: count,
      reducePriority: wine.reduce_priority,
      drinkByYear: wine.drink_by_year
    });
  }

  return { styleCounts, totalBottles, winesByStyle };
}

/**
 * Compute demand-proportional targets per style.
 * No per-style floor — 0% demand = target 0.
 * @param {Object} wineStyleDemand - Style -> percentage (sums to ~1.0)
 * @param {number} totalBottles - Total bottles in cellar
 * @returns {Object} Style -> target bottle count
 */
function computeTargets(wineStyleDemand, totalBottles) {
  const targets = {};
  for (const [style, pct] of Object.entries(wineStyleDemand)) {
    targets[style] = Math.round(pct * totalBottles);
  }
  return targets;
}

/**
 * Compute gaps: styles where have < target and target >= 1.
 * Priority sorted by demandPct * deficit.
 * @param {Object} targets - Style -> target count
 * @param {Object} styleCounts - Style -> current count
 * @param {Object} profile - Cooking profile
 * @returns {Array} Gap objects
 */
function computeGaps(targets, styleCounts, profile) {
  const gaps = [];

  for (const [style, target] of Object.entries(targets)) {
    if (target < 1) continue;
    const have = styleCounts[style] || 0;
    if (have >= target) continue;

    const deficit = target - have;
    const demandPct = profile.wineStyleDemand[style] || 0;

    // Find top signals driving this style's demand
    const drivingSignals = findDrivingSignals(style, profile);

    gaps.push({
      style,
      label: STYLE_LABELS[style] || style,
      have,
      target,
      deficit,
      demandPct: Math.round(demandPct * 100),
      priority: demandPct * deficit,
      drivingSignals,
      suggestions: SHOPPING_SUGGESTIONS[style] || []
    });
  }

  // Sort by priority (highest need * biggest gap first)
  gaps.sort((a, b) => b.priority - a.priority);

  return gaps;
}

/**
 * Compute surpluses: styles where have > target + 2.
 * @param {Object} targets - Style -> target count
 * @param {Object} styleCounts - Style -> current count
 * @param {Object} winesByStyle - Style -> wine details
 * @returns {Array} Surplus objects
 */
function computeSurpluses(targets, styleCounts, winesByStyle) {
  const surpluses = [];

  for (const [style, count] of Object.entries(styleCounts)) {
    const target = targets[style] || 0;
    if (count <= target + 2) continue;

    const excess = count - target;
    const wines = winesByStyle[style] || [];

    // Highlight reduce-now wines in this style
    const reduceNow = wines
      .filter(w => w.reducePriority < 99)
      .sort((a, b) => a.reducePriority - b.reducePriority);

    surpluses.push({
      style,
      label: STYLE_LABELS[style] || style,
      have: count,
      target,
      excess,
      reduceNowCount: reduceNow.length,
      reduceNowWines: reduceNow.slice(0, 3).map(w => ({
        id: w.id,
        name: w.name,
        vintage: w.vintage
      }))
    });
  }

  // Sort by excess descending
  surpluses.sort((a, b) => b.excess - a.excess);

  return surpluses;
}

/**
 * Compute diversity recommendations for styles with 0% demand but 0 bottles.
 * Advisory tone: "You don't cook much X, but keeping 1-2 for guests is a good idea."
 * @param {Object} wineStyleDemand - Style demand percentages
 * @param {Object} styleCounts - Current bottle counts per style
 * @returns {Array} Diversity recommendation objects
 */
function computeDiversityRecs(wineStyleDemand, styleCounts) {
  const recs = [];
  const allStyles = Object.keys(STYLE_LABELS);

  for (const style of allStyles) {
    const demand = wineStyleDemand[style] || 0;
    const have = styleCounts[style] || 0;

    // Only recommend for low-demand styles with zero bottles
    if (demand < 0.03 && have === 0) {
      recs.push({
        style,
        label: STYLE_LABELS[style],
        reason: getDiversityReason(style),
        suggestions: (SHOPPING_SUGGESTIONS[style] || []).slice(0, 2)
      });
    }
  }

  return recs;
}

/**
 * Find top signals driving demand for a wine style.
 * @param {string} styleId - Wine style ID
 * @param {Object} profile - Cooking profile with dominantSignals
 * @returns {string[]} Top 3 signal names
 */
function findDrivingSignals(styleId, profile) {
  const matchingSignals = [];

  for (const { signal, weight } of (profile.dominantSignals || [])) {
    const def = FOOD_SIGNALS[signal];
    if (!def) continue;

    const { wineAffinities } = def;
    if (wineAffinities.primary?.includes(styleId)) {
      matchingSignals.push({ signal, relevance: weight * 3 });
    } else if (wineAffinities.good?.includes(styleId)) {
      matchingSignals.push({ signal, relevance: weight * 2 });
    } else if (wineAffinities.fallback?.includes(styleId)) {
      matchingSignals.push({ signal, relevance: weight });
    }
  }

  return matchingSignals
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3)
    .map(s => s.signal);
}

/**
 * Get a diversity reason string for a style.
 * @param {string} style - Style ID
 * @returns {string}
 */
function getDiversityReason(style) {
  const reasons = {
    white_crisp: 'Keep 1-2 crisp whites for seafood or appetisers with guests',
    white_medium: 'A versatile option for lighter meals or casual entertaining',
    white_oaked: 'Pairs well with richer poultry and cream-based dishes',
    white_aromatic: 'Great for spicy food, Asian cuisine, or aperitifs',
    rose_dry: 'A flexible warm-weather wine that pairs broadly',
    red_light: 'Complements lighter meats, charcuterie, and vegetarian dishes',
    red_medium: 'The most food-friendly red style — good for any occasion',
    red_full: 'Essential for hearty stews, grilled red meat, and winter meals',
    sparkling_dry: 'Perfect for celebrations and surprisingly food-friendly',
    sparkling_rose: 'An elegant option for special occasions',
    dessert: 'A small stock for cheese courses and after-dinner treats'
  };
  return reasons[style] || 'A useful addition for variety';
}

/**
 * Build empty guide when no recipes exist.
 * @returns {Object}
 */
function buildEmptyGuide() {
  return {
    coveragePct: 0,
    bottleCoveragePct: 0,
    totalBottles: 0,
    gaps: [],
    surpluses: [],
    diversityRecs: [],
    targets: {},
    styleCounts: {},
    recipeCount: 0,
    seasonalBias: null,
    hemisphere: 'southern',
    empty: true,
    emptyReason: 'no_recipes'
  };
}

/**
 * Build guide when recipes exist but cellar is empty.
 * @param {Object} profile - Cooking profile
 * @returns {Object}
 */
function buildNoWinesGuide(profile) {
  const targets = {};
  // Show hypothetical targets for a 50-bottle cellar
  for (const [style, pct] of Object.entries(profile.wineStyleDemand)) {
    targets[style] = Math.round(pct * 50);
  }

  const gaps = Object.entries(targets)
    .filter(([, target]) => target >= 1)
    .map(([style, target]) => ({
      style,
      label: STYLE_LABELS[style] || style,
      have: 0,
      target,
      deficit: target,
      demandPct: Math.round((profile.wineStyleDemand[style] || 0) * 100),
      priority: (profile.wineStyleDemand[style] || 0) * target,
      drivingSignals: findDrivingSignals(style, profile),
      suggestions: SHOPPING_SUGGESTIONS[style] || []
    }))
    .sort((a, b) => b.priority - a.priority);

  return {
    coveragePct: 0,
    bottleCoveragePct: 0,
    totalBottles: 0,
    gaps,
    surpluses: [],
    diversityRecs: [],
    targets,
    styleCounts: {},
    recipeCount: profile.recipeCount,
    seasonalBias: profile.seasonalBias,
    hemisphere: profile.hemisphere,
    empty: true,
    emptyReason: 'no_wines',
    hypotheticalCellarSize: 50
  };
}
