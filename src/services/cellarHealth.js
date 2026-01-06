/**
 * @fileoverview Cellar health dashboard metrics and actions.
 * @module services/cellarHealth
 */

import db from '../db/index.js';
import { calculateParLevelGaps, selectFridgeFillCandidates, analyseFridge } from './fridgeStocking.js';
import logger from '../utils/logger.js';

/**
 * Get comprehensive cellar health report.
 * @returns {Promise<Object>} Health report with metrics and recommendations
 */
export async function getCellarHealth() {
  const report = {
    timestamp: new Date().toISOString(),
    metrics: {},
    alerts: [],
    actions: []
  };

  // Get all wines with bottles
  const wines = await db.prepare(`
    SELECT w.*,
           COUNT(s.id) as bottle_count,
           STRING_AGG(s.location_code, ',') as locations,
           MAX(CASE WHEN s.location_code LIKE 'F%' THEN 1 ELSE 0 END) as in_fridge
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    GROUP BY w.id
    HAVING COUNT(s.id) > 0
  `).all();

  // Get drinking windows
  const drinkingWindows = await db.prepare(`
    SELECT wine_id, drink_from_year, drink_by_year, peak_year
    FROM drinking_windows
    WHERE drink_by_year IS NOT NULL
  `).all();

  const windowMap = new Map();
  for (const dw of drinkingWindows) {
    if (!windowMap.has(dw.wine_id) || (dw.drink_by_year && dw.drink_by_year < windowMap.get(dw.wine_id).drink_by_year)) {
      windowMap.set(dw.wine_id, dw);
    }
  }

  // 1. Drinking Window Risk
  report.metrics.drinkingWindowRisk = calculateDrinkingWindowRisk(wines, windowMap);

  // 2. Style Coverage
  report.metrics.styleCoverage = calculateStyleCoverage(wines);

  // 3. Duplication Risk
  report.metrics.duplicationRisk = calculateDuplicationRisk(wines);

  // 4. Event Readiness
  report.metrics.eventReadiness = calculateEventReadiness(wines);

  // 5. Fridge Gaps
  const fridgeWines = wines.filter(w => w.in_fridge);
  const cellarWines = wines.filter(w => !w.in_fridge);
  report.metrics.fridgeGaps = calculateFridgeGaps(fridgeWines, cellarWines);

  // Generate alerts from metrics
  report.alerts = generateAlerts(report.metrics);

  // Generate suggested actions
  report.actions = generateActions(report.metrics, wines);

  // Overall health score (0-100)
  report.healthScore = calculateOverallHealth(report.metrics);

  return report;
}

/**
 * Calculate drinking window risk metric.
 * @param {Array} wines - Wines with bottles
 * @param {Map} windowMap - Wine ID to drinking window
 * @returns {Object} Risk assessment
 */
function calculateDrinkingWindowRisk(wines, windowMap) {
  const currentYear = new Date().getFullYear();
  const result = {
    atRisk: [],
    pastPeak: [],
    pastDrinkBy: [],
    healthyCount: 0,
    unknownCount: 0
  };

  for (const wine of wines) {
    const window = windowMap.get(wine.id);

    if (!window) {
      result.unknownCount += wine.bottle_count;
      continue;
    }

    const drinkBy = window.drink_by_year;
    const peak = window.peak_year;

    if (drinkBy && currentYear > drinkBy) {
      result.pastDrinkBy.push({
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        drinkBy,
        yearsOver: currentYear - drinkBy,
        bottleCount: wine.bottle_count
      });
    } else if (drinkBy && currentYear >= drinkBy - 1) {
      result.atRisk.push({
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        drinkBy,
        monthsRemaining: (drinkBy - currentYear) * 12,
        bottleCount: wine.bottle_count
      });
    } else if (peak && currentYear > peak) {
      result.pastPeak.push({
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        peak,
        yearsPastPeak: currentYear - peak,
        bottleCount: wine.bottle_count
      });
    } else {
      result.healthyCount += wine.bottle_count;
    }
  }

  // Risk score (0-100, lower is better)
  const totalBottles = wines.reduce((sum, w) => sum + w.bottle_count, 0);
  const atRiskBottles = result.pastDrinkBy.reduce((sum, w) => sum + w.bottleCount, 0) +
                        result.atRisk.reduce((sum, w) => sum + w.bottleCount, 0);
  result.riskScore = totalBottles > 0 ? Math.round((atRiskBottles / totalBottles) * 100) : 0;

  return result;
}

/**
 * Calculate style coverage metric.
 * @param {Array} wines - Wines with bottles
 * @returns {Object} Coverage assessment
 */
function calculateStyleCoverage(wines) {
  const categories = {
    sparkling: { count: 0, target: 2, label: 'Sparkling' },
    white_crisp: { count: 0, target: 4, label: 'Crisp White' },
    white_aromatic: { count: 0, target: 2, label: 'Aromatic White' },
    white_oaked: { count: 0, target: 2, label: 'Oaked White' },
    rose: { count: 0, target: 2, label: 'Rosé' },
    red_light: { count: 0, target: 3, label: 'Light Red' },
    red_medium: { count: 0, target: 4, label: 'Medium Red' },
    red_full: { count: 0, target: 4, label: 'Full Red' },
    dessert: { count: 0, target: 1, label: 'Dessert/Fortified' }
  };

  for (const wine of wines) {
    const category = categoriseWineForCoverage(wine);
    if (category && categories[category]) {
      categories[category].count += wine.bottle_count;
    }
  }

  // Calculate gaps
  const gaps = [];
  const wellStocked = [];
  let coverageScore = 0;
  let maxScore = 0;

  for (const [key, cat] of Object.entries(categories)) {
    maxScore += cat.target;
    const coverage = Math.min(cat.count, cat.target);
    coverageScore += coverage;

    if (cat.count < cat.target) {
      gaps.push({
        category: key,
        label: cat.label,
        have: cat.count,
        need: cat.target - cat.count
      });
    } else {
      wellStocked.push({
        category: key,
        label: cat.label,
        count: cat.count
      });
    }
  }

  return {
    categories,
    gaps,
    wellStocked,
    coverageScore: Math.round((coverageScore / maxScore) * 100)
  };
}

/**
 * Categorise wine for coverage calculation.
 * @param {Object} wine - Wine object
 * @returns {string|null} Category key
 */
function categoriseWineForCoverage(wine) {
  const colour = (wine.colour || '').toLowerCase();
  const style = (wine.style || '').toLowerCase();

  if (colour === 'sparkling') return 'sparkling';
  if (colour === 'rose') return 'rose';
  if (colour === 'dessert' || style.includes('port') || style.includes('dessert') ||
      style.includes('late harvest') || style.includes('ice wine')) {
    return 'dessert';
  }

  if (colour === 'white') {
    if (style.includes('oaked') || style.includes('chardonnay') && style.includes('barrel')) {
      return 'white_oaked';
    }
    if (style.includes('riesling') || style.includes('gewurz') || style.includes('viognier')) {
      return 'white_aromatic';
    }
    return 'white_crisp';
  }

  if (colour === 'red') {
    if (style.includes('pinot noir') || style.includes('gamay') || style.includes('light')) {
      return 'red_light';
    }
    if (style.includes('cabernet') || style.includes('shiraz') || style.includes('malbec') ||
        style.includes('full') || style.includes('bold')) {
      return 'red_full';
    }
    return 'red_medium';
  }

  return null;
}

/**
 * Calculate duplication risk metric.
 * @param {Array} wines - Wines with bottles
 * @returns {Object} Duplication assessment
 */
function calculateDuplicationRisk(wines) {
  const styleGroups = {};

  for (const wine of wines) {
    const key = `${wine.colour || 'unknown'}_${wine.style || 'unknown'}`.toLowerCase();
    if (!styleGroups[key]) {
      styleGroups[key] = {
        colour: wine.colour,
        style: wine.style,
        wines: [],
        totalBottles: 0
      };
    }
    styleGroups[key].wines.push(wine);
    styleGroups[key].totalBottles += wine.bottle_count;
  }

  // Find over-concentrated styles (more than 20% of cellar in one style)
  const totalBottles = wines.reduce((sum, w) => sum + w.bottle_count, 0);
  const overConcentrated = [];

  for (const [key, group] of Object.entries(styleGroups)) {
    const percentage = (group.totalBottles / totalBottles) * 100;
    if (percentage > 20 && group.wines.length > 2) {
      overConcentrated.push({
        key,
        style: group.style || 'Unknown',
        colour: group.colour || 'Unknown',
        bottleCount: group.totalBottles,
        percentage: Math.round(percentage),
        wineCount: group.wines.length
      });
    }
  }

  // Diversity score (higher is better)
  const uniqueStyles = Object.keys(styleGroups).length;
  const diversityScore = Math.min(100, Math.round((uniqueStyles / Math.max(wines.length / 3, 5)) * 100));

  return {
    overConcentrated,
    uniqueStyles,
    diversityScore,
    totalWines: wines.length,
    hasIssue: overConcentrated.length > 0
  };
}

/**
 * Calculate event readiness metric.
 * @param {Array} wines - Wines with bottles
 * @returns {Object} Event readiness assessment
 */
function calculateEventReadiness(wines) {
  // Can you host 6 people with variety?
  const guests = 6;
  const bottlesPerGuest = 0.5; // Half bottle per person
  const minBottlesNeeded = Math.ceil(guests * bottlesPerGuest);

  // Need variety: at least 2 whites, 2 reds, 1 sparkling/rosé
  const byColour = {
    sparkling: wines.filter(w => w.colour === 'sparkling').reduce((sum, w) => sum + w.bottle_count, 0),
    white: wines.filter(w => w.colour === 'white').reduce((sum, w) => sum + w.bottle_count, 0),
    rose: wines.filter(w => w.colour === 'rose').reduce((sum, w) => sum + w.bottle_count, 0),
    red: wines.filter(w => w.colour === 'red').reduce((sum, w) => sum + w.bottle_count, 0)
  };

  const requirements = {
    sparkling: { need: 1, have: byColour.sparkling, met: byColour.sparkling >= 1 },
    white: { need: 2, have: byColour.white, met: byColour.white >= 2 },
    red: { need: 2, have: byColour.red, met: byColour.red >= 2 },
    variety: { need: 1, have: byColour.rose + byColour.sparkling, met: byColour.rose >= 1 || byColour.sparkling >= 1 }
  };

  const totalBottles = wines.reduce((sum, w) => sum + w.bottle_count, 0);
  const requirementsMet = Object.values(requirements).filter(r => r.met).length;

  return {
    canHost: totalBottles >= minBottlesNeeded && requirementsMet >= 3,
    totalBottles,
    neededBottles: minBottlesNeeded,
    byColour,
    requirements,
    readinessScore: Math.round((requirementsMet / 4) * 100)
  };
}

/**
 * Calculate fridge gaps metric.
 * @param {Array} fridgeWines - Wines in fridge
 * @param {Array} cellarWines - Wines in cellar
 * @returns {Object} Fridge gap assessment
 */
function calculateFridgeGaps(fridgeWines, cellarWines) {
  const fridgeAnalysis = analyseFridge(fridgeWines, cellarWines);

  return {
    hasGaps: fridgeAnalysis.hasGaps,
    gaps: fridgeAnalysis.parLevelGaps,
    candidates: fridgeAnalysis.candidates.slice(0, 5),
    currentMix: fridgeAnalysis.currentMix,
    occupied: fridgeAnalysis.occupied,
    capacity: fridgeAnalysis.capacity,
    gapScore: fridgeAnalysis.hasGaps ? 50 : 100
  };
}

/**
 * Generate alerts from metrics.
 * @param {Object} metrics - Health metrics
 * @returns {Array} Alerts
 */
function generateAlerts(metrics) {
  const alerts = [];

  // Drinking window alerts
  if (metrics.drinkingWindowRisk.pastDrinkBy.length > 0) {
    alerts.push({
      severity: 'critical',
      category: 'drinking_window',
      message: `${metrics.drinkingWindowRisk.pastDrinkBy.length} wine(s) past their drink-by date`,
      count: metrics.drinkingWindowRisk.pastDrinkBy.reduce((sum, w) => sum + w.bottleCount, 0)
    });
  }

  if (metrics.drinkingWindowRisk.atRisk.length > 0) {
    alerts.push({
      severity: 'warning',
      category: 'drinking_window',
      message: `${metrics.drinkingWindowRisk.atRisk.length} wine(s) approaching drink-by date`,
      count: metrics.drinkingWindowRisk.atRisk.reduce((sum, w) => sum + w.bottleCount, 0)
    });
  }

  // Style coverage alerts
  if (metrics.styleCoverage.gaps.length > 2) {
    alerts.push({
      severity: 'info',
      category: 'coverage',
      message: `Missing ${metrics.styleCoverage.gaps.length} wine categories`,
      gaps: metrics.styleCoverage.gaps.map(g => g.label)
    });
  }

  // Duplication alerts
  for (const dup of metrics.duplicationRisk.overConcentrated) {
    alerts.push({
      severity: 'info',
      category: 'duplication',
      message: `${dup.percentage}% of cellar is ${dup.colour} ${dup.style}`,
      bottleCount: dup.bottleCount
    });
  }

  // Fridge alerts
  if (metrics.fridgeGaps.hasGaps) {
    const gapCount = Object.keys(metrics.fridgeGaps.gaps).length;
    alerts.push({
      severity: 'info',
      category: 'fridge',
      message: `Fridge has ${gapCount} par-level gap(s)`,
      gaps: metrics.fridgeGaps.gaps
    });
  }

  return alerts;
}

/**
 * Generate suggested actions.
 * @param {Object} metrics - Health metrics
 * @param {Array} wines - All wines
 * @returns {Array} Actions
 */
function generateActions(metrics, wines) {
  const actions = [];

  // Fill Fridge action
  if (metrics.fridgeGaps.hasGaps && metrics.fridgeGaps.candidates.length > 0) {
    actions.push({
      id: 'fill_fridge',
      label: 'Fill Fridge',
      description: `Move ${metrics.fridgeGaps.candidates.length} wine(s) to fill par-level gaps`,
      priority: 2,
      candidates: metrics.fridgeGaps.candidates
    });
  }

  // Review At-Risk Wines action
  if (metrics.drinkingWindowRisk.atRisk.length > 0 || metrics.drinkingWindowRisk.pastDrinkBy.length > 0) {
    const urgentWines = [
      ...metrics.drinkingWindowRisk.pastDrinkBy,
      ...metrics.drinkingWindowRisk.atRisk
    ];
    actions.push({
      id: 'review_at_risk',
      label: 'Review At-Risk Wines',
      description: `${urgentWines.length} wine(s) need attention`,
      priority: 1,
      wines: urgentWines.slice(0, 10)
    });
  }

  // Build Weeknight Shortlist action
  const weeknightCandidates = wines.filter(w => {
    const price = w.price_eur || 0;
    return price > 0 && price < 20 && !w.in_fridge;
  }).slice(0, 5);

  if (weeknightCandidates.length > 0) {
    actions.push({
      id: 'weeknight_shortlist',
      label: 'Build Weeknight Shortlist',
      description: `${weeknightCandidates.length} affordable wines for quick-drink`,
      priority: 3,
      wines: weeknightCandidates.map(w => ({
        wineId: w.id,
        wineName: w.wine_name,
        vintage: w.vintage,
        price: w.price_eur
      }))
    });
  }

  // Generate Shopping List action
  if (metrics.styleCoverage.gaps.length > 0) {
    actions.push({
      id: 'shopping_list',
      label: 'Generate Shopping List',
      description: `${metrics.styleCoverage.gaps.length} category gap(s) to fill`,
      priority: 4,
      gaps: metrics.styleCoverage.gaps
    });
  }

  // Sort by priority
  actions.sort((a, b) => a.priority - b.priority);

  return actions;
}

/**
 * Calculate overall health score.
 * @param {Object} metrics - Health metrics
 * @returns {number} Score 0-100
 */
function calculateOverallHealth(metrics) {
  const weights = {
    drinkingWindow: 0.3,
    coverage: 0.2,
    diversity: 0.15,
    eventReadiness: 0.15,
    fridge: 0.2
  };

  // Invert drinking window risk (lower risk = better score)
  const drinkingScore = 100 - metrics.drinkingWindowRisk.riskScore;
  const coverageScore = metrics.styleCoverage.coverageScore;
  const diversityScore = metrics.duplicationRisk.diversityScore;
  const eventScore = metrics.eventReadiness.readinessScore;
  const fridgeScore = metrics.fridgeGaps.gapScore;

  const weightedScore =
    drinkingScore * weights.drinkingWindow +
    coverageScore * weights.coverage +
    diversityScore * weights.diversity +
    eventScore * weights.eventReadiness +
    fridgeScore * weights.fridge;

  return Math.round(weightedScore);
}

/**
 * Execute Fill Fridge action.
 * @param {number} maxMoves - Maximum wines to move
 * @returns {Promise<Object>} Execution result
 */
export async function executeFillFridge(maxMoves = 5) {
  const health = await getCellarHealth();
  const candidates = health.metrics.fridgeGaps.candidates.slice(0, maxMoves);

  if (candidates.length === 0) {
    return { moved: 0, message: 'No suitable candidates for fridge' };
  }

  // Find empty fridge slots
  const emptyFridge = await db.prepare(`
    SELECT location_code FROM slots
    WHERE location_code LIKE 'F%' AND wine_id IS NULL
    ORDER BY location_code
  `).all();

  const moved = [];
  for (let i = 0; i < Math.min(candidates.length, emptyFridge.length); i++) {
    const candidate = candidates[i];
    const targetSlot = emptyFridge[i].location_code;

    // Move wine
    await db.prepare(`
      UPDATE slots SET wine_id = NULL WHERE wine_id = ? AND location_code = ?
    `).run(candidate.wineId, candidate.fromSlot);

    await db.prepare(`
      UPDATE slots SET wine_id = ? WHERE location_code = ?
    `).run(candidate.wineId, targetSlot);

    moved.push({
      wineId: candidate.wineId,
      wineName: candidate.wineName,
      from: candidate.fromSlot,
      to: targetSlot
    });
  }

  return {
    moved: moved.length,
    wines: moved,
    message: `Moved ${moved.length} wine(s) to fridge`
  };
}

/**
 * Get at-risk wines for review.
 * @param {number} limit - Max wines to return
 * @returns {Promise<Array>} At-risk wines
 */
export async function getAtRiskWines(limit = 20) {
  const health = await getCellarHealth();
  const atRisk = [
    ...health.metrics.drinkingWindowRisk.pastDrinkBy,
    ...health.metrics.drinkingWindowRisk.atRisk
  ];

  return atRisk.slice(0, limit);
}

/**
 * Generate shopping list from style gaps.
 * @returns {Promise<Object>} Shopping list
 */
export async function generateShoppingList() {
  const health = await getCellarHealth();
  const gaps = health.metrics.styleCoverage.gaps;

  const suggestions = gaps.map(gap => ({
    category: gap.label,
    need: gap.need,
    suggestions: getShoppingSuggestions(gap.category)
  }));

  return {
    gaps: suggestions,
    totalNeeded: gaps.reduce((sum, g) => sum + g.need, 0)
  };
}

/**
 * Get shopping suggestions for a category.
 * @param {string} category - Wine category
 * @returns {string[]} Suggestions
 */
function getShoppingSuggestions(category) {
  const suggestions = {
    sparkling: ['Champagne', 'Prosecco', 'Cava', 'Crémant'],
    white_crisp: ['Sauvignon Blanc', 'Pinot Grigio', 'Albariño', 'Muscadet'],
    white_aromatic: ['Riesling', 'Gewürztraminer', 'Viognier', 'Torrontés'],
    white_oaked: ['Oaked Chardonnay', 'White Burgundy', 'White Rioja'],
    rose: ['Provence Rosé', 'Côtes de Provence', 'Tavel'],
    red_light: ['Pinot Noir', 'Gamay', 'Beaujolais', 'Valpolicella'],
    red_medium: ['Merlot', 'Côtes du Rhône', 'Chianti', 'Rioja'],
    red_full: ['Cabernet Sauvignon', 'Shiraz', 'Malbec', 'Barolo'],
    dessert: ['Sauternes', 'Port', 'Ice Wine', 'PX Sherry']
  };

  return suggestions[category] || [];
}
