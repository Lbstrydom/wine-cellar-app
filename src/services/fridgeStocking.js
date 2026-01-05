/**
 * @fileoverview Fridge stocking service for par-level gap detection.
 * Calculates what's missing from the fridge and suggests candidates.
 * @module services/fridgeStocking
 */

import { FRIDGE_PAR_LEVELS, FRIDGE_CAPACITY } from '../config/fridgeParLevels.js';
import { getEffectiveDrinkByYear } from './cellarAnalysis.js';

/**
 * Categorise a wine into a fridge par-level category.
 * @param {Object} wine - Wine object
 * @returns {string|null} Category name or null if no match
 */
export function categoriseWine(wine) {
  const colour = (wine.colour || '').toLowerCase();
  const grapes = (wine.grapes || '').toLowerCase();
  const wineName = (wine.wine_name || '').toLowerCase();
  const style = (wine.style || '').toLowerCase();
  const winemaking = (wine.winemaking || '').toLowerCase();

  // SPARKLING CHECK FIRST - keywords override colour
  // Many sparkling wines are stored with colour: white but should be sparkling
  const sparklingKeywords = [
    'champagne', 'prosecco', 'cava', 'crémant', 'cremant',
    'sparkling', 'brut', 'spumante', 'sekt', 'cap classique',
    'method cap classique', 'mcc', 'méthode traditionnelle',
    'methode cap classique', 'mousseux', 'franciacorta', 'asti'
  ];
  const isSparklingByKeyword = sparklingKeywords.some(k =>
    wineName.includes(k) || style.includes(k)
  );
  if (isSparklingByKeyword || colour === 'sparkling') {
    return 'sparkling';
  }

  // Check each category in priority order
  for (const [category, config] of Object.entries(FRIDGE_PAR_LEVELS)) {
    if (category === 'flex') continue; // Flex matches everything
    if (category === 'sparkling') continue; // Already handled above

    const rules = config.matchRules;
    if (!rules || Object.keys(rules).length === 0) continue;

    // Check colour match
    if (rules.colours && rules.colours.length > 0) {
      if (!rules.colours.includes(colour)) continue;
    }

    // Check grape match
    if (rules.grapes && rules.grapes.length > 0) {
      const hasGrape = rules.grapes.some(g =>
        grapes.includes(g) || wineName.includes(g) || style.includes(g)
      );
      if (!hasGrape && !rules.keywords) continue;
      if (hasGrape) return category;
    }

    // Check keyword match
    if (rules.keywords && rules.keywords.length > 0) {
      const hasKeyword = rules.keywords.some(k =>
        wineName.includes(k) || style.includes(k) || winemaking.includes(k)
      );
      if (hasKeyword) return category;
    }

    // Check winemaking match
    if (rules.winemaking && rules.winemaking.length > 0) {
      const hasWinemaking = rules.winemaking.some(w =>
        winemaking.includes(w) || style.includes(w)
      );
      if (hasWinemaking) return category;
    }

    // Check exclusions
    if (rules.excludeKeywords && rules.excludeKeywords.length > 0) {
      const hasExcluded = rules.excludeKeywords.some(k =>
        wineName.includes(k) || style.includes(k) || winemaking.includes(k)
      );
      if (hasExcluded) continue;
    }

    if (rules.excludeWinemaking && rules.excludeWinemaking.length > 0) {
      const hasExcluded = rules.excludeWinemaking.some(w =>
        winemaking.includes(w)
      );
      if (hasExcluded) continue;
    }

    // If we got here with colour match but no other specifics, it's a match
    if (rules.colours && rules.colours.includes(colour)) {
      return category;
    }
  }

  return null;
}

/**
 * Categorise all wines currently in fridge.
 * @param {Array} fridgeWines - Wines currently in fridge
 * @returns {Object} Count by category
 */
export function categorizeFridgeWines(fridgeWines) {
  const counts = {};

  // Initialise all categories to 0
  for (const category of Object.keys(FRIDGE_PAR_LEVELS)) {
    counts[category] = 0;
  }

  for (const wine of fridgeWines) {
    const category = categoriseWine(wine);
    if (category) {
      counts[category]++;
    } else {
      // Uncategorised wines go to flex
      counts.flex = (counts.flex || 0) + 1;
    }
  }

  return counts;
}

/**
 * Calculate fridge par-level gaps.
 * @param {Array} fridgeWines - Current fridge contents
 * @returns {Object} Gaps by category with need count and descriptions
 */
export function calculateParLevelGaps(fridgeWines) {
  const current = categorizeFridgeWines(fridgeWines);
  const gaps = {};

  for (const [category, config] of Object.entries(FRIDGE_PAR_LEVELS)) {
    if (config.optional) continue; // Skip optional categories like flex

    const have = current[category] || 0;
    if (have < config.min) {
      gaps[category] = {
        need: config.min - have,
        have,
        min: config.min,
        priority: config.priority,
        description: config.description
      };
    }
  }

  return gaps;
}

/**
 * Get fridge status summary.
 * @param {Array} fridgeWines - Current fridge contents
 * @returns {Object} Fridge status
 */
export function getFridgeStatus(fridgeWines) {
  const currentMix = categorizeFridgeWines(fridgeWines);
  const gaps = calculateParLevelGaps(fridgeWines);
  const emptySlots = FRIDGE_CAPACITY - fridgeWines.length;

  return {
    capacity: FRIDGE_CAPACITY,
    occupied: fridgeWines.length,
    emptySlots,
    currentMix,
    parLevelGaps: gaps,
    hasGaps: Object.keys(gaps).length > 0,
    totalNeeded: Object.values(gaps).reduce((sum, g) => sum + g.need, 0)
  };
}

/**
 * Find wines suitable for a fridge category.
 * @param {Array} cellarWines - Available wines in cellar
 * @param {string} category - Target category
 * @param {number} count - Number needed
 * @returns {Array} Suitable wines
 */
export function findSuitableWines(cellarWines, category, count) {
  const config = FRIDGE_PAR_LEVELS[category];
  if (!config) return [];

  const currentYear = new Date().getFullYear();

  // Filter to wines that match this category
  const matching = cellarWines.filter(wine => {
    // Skip wines already in fridge
    const slotId = wine.slot_id || wine.location_code;
    if (slotId && slotId.startsWith('F')) return false;

    // Must match category
    return categoriseWine(wine) === category;
  });

  // Rank by suitability
  const ranked = matching.map(wine => {
    let score = 0;

    // Prefer wines near drink-by year (reduce-now candidates)
    const drinkByYear = getEffectiveDrinkByYear(wine);
    if (drinkByYear) {
      const yearsLeft = drinkByYear - currentYear;
      if (yearsLeft <= 0) score += 100; // Past due - highest priority
      else if (yearsLeft <= 1) score += 80;
      else if (yearsLeft <= 2) score += 50;
      else if (yearsLeft <= 3) score += 20;
    }

    // Prefer wines from preferred zones
    if (config.preferredZones && config.preferredZones.includes(wine.zone_id)) {
      score += 30;
    }

    // Slight preference for newer entries (higher ID = more recently added)
    score += Math.min(wine.id / 1000, 10);

    return { wine, score };
  });

  // Sort by score descending and return top N
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(r => r.wine);
}

/**
 * Select wines to fill fridge gaps.
 * @param {Array} cellarWines - Available wines in cellar
 * @param {Object} gaps - Par level gaps from calculateParLevelGaps
 * @param {number} emptySlots - Available fridge slots
 * @returns {Array} Wines to move to fridge with reasons
 */
export function selectFridgeFillCandidates(cellarWines, gaps, emptySlots) {
  const candidates = [];
  let slotsRemaining = emptySlots;

  // Sort gaps by priority
  const sortedGaps = Object.entries(gaps)
    .sort((a, b) => a[1].priority - b[1].priority);

  for (const [category, gap] of sortedGaps) {
    if (slotsRemaining <= 0) break;

    const toFill = Math.min(gap.need, slotsRemaining);
    const suitable = findSuitableWines(cellarWines, category, toFill);

    for (const wine of suitable) {
      if (slotsRemaining <= 0) break;

      const drinkByYear = getEffectiveDrinkByYear(wine);
      const reason = buildFillReason(wine, category, drinkByYear);

      candidates.push({
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        category,
        categoryDescription: FRIDGE_PAR_LEVELS[category].description,
        drinkByYear,
        fromSlot: wine.slot_id || wine.location_code,
        reason
      });

      slotsRemaining--;
    }
  }

  return candidates;
}

/**
 * Build human-readable reason for fridge fill.
 * @param {Object} wine - Wine object
 * @param {string} category - Target category
 * @param {number|null} drinkByYear - Drink-by year if known
 * @returns {string} Reason text
 */
function buildFillReason(wine, category, drinkByYear) {
  const currentYear = new Date().getFullYear();
  const config = FRIDGE_PAR_LEVELS[category];

  const parts = [];

  // Add urgency if near drink-by
  if (drinkByYear) {
    if (drinkByYear <= currentYear) {
      parts.push('Past optimal window - drink now');
    } else if (drinkByYear === currentYear + 1) {
      parts.push('Final year of drinking window');
    } else if (drinkByYear <= currentYear + 2) {
      parts.push(`Drink by ${drinkByYear}`);
    }
  }

  // Add category reason
  parts.push(`Fills ${category.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} gap`);

  // Add pairing hint
  if (config.signals && config.signals.length > 0) {
    const hints = config.signals.slice(0, 2).join(', ');
    parts.push(`Great for ${hints}`);
  }

  return parts.join(' • ');
}

/**
 * Get complete fridge analysis with candidates.
 * @param {Array} fridgeWines - Current fridge contents
 * @param {Array} cellarWines - All cellar wines
 * @returns {Object} Complete fridge analysis
 */
export function analyseFridge(fridgeWines, cellarWines) {
  const status = getFridgeStatus(fridgeWines);
  const candidates = status.hasGaps && status.emptySlots > 0
    ? selectFridgeFillCandidates(cellarWines, status.parLevelGaps, status.emptySlots)
    : [];

  return {
    ...status,
    candidates,
    wines: fridgeWines.map(w => ({
      wineId: w.id,
      name: w.wine_name,
      vintage: w.vintage,
      slot: w.slot_id || w.location_code,
      category: categoriseWine(w) || 'uncategorised',
      drinkByYear: getEffectiveDrinkByYear(w)
    }))
  };
}
