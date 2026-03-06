/**
 * @fileoverview Fridge stocking service for par-level gap detection.
 * Calculates what's missing from a fridge area and suggests candidates.
 * @module services/cellar/fridgeStocking
 */

import {
  CATEGORY_REGISTRY,
  FLEX_CATEGORY,
  FRIDGE_CATEGORY_ORDER,
  CATEGORY_DISPLAY_NAMES
} from '../../config/fridgeCategories.js';
import { getEffectiveDrinkByYear } from './cellarAnalysis.js';
import db from '../../db/index.js';
import logger from '../../utils/logger.js';
import { grapeMatchesText, keywordMatchesText } from '../../utils/wineNormalization.js';

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

  // SPARKLING CHECK FIRST — keywords override colour field.
  // Many sparkling wines are stored with colour: white but should be sparkling.
  const sparklingKeywords = CATEGORY_REGISTRY.sparkling.matchRules.keywords;
  const isSparklingByKeyword = sparklingKeywords.some(k =>
    keywordMatchesText(wineName, k) || keywordMatchesText(style, k)
  );
  if (isSparklingByKeyword || colour === 'sparkling') {
    return 'sparkling';
  }

  // Rose is reliably identified by colour metadata
  if (colour === 'rose') {
    return 'rose';
  }

  // Dessert & Fortified — check by colour before general white rules
  const dessertRules = CATEGORY_REGISTRY.dessertFortified.matchRules;
  if (dessertRules.colours && dessertRules.colours.includes(colour)) {
    return 'dessertFortified';
  }
  if (dessertRules.keywords) {
    const hasDessertKeyword = dessertRules.keywords.some(k =>
      wineName.includes(k) || style.includes(k) || winemaking.includes(k)
    );
    if (hasDessertKeyword) return 'dessertFortified';
  }

  // Check remaining categories in priority order using CATEGORY_REGISTRY
  const priorityOrder = FRIDGE_CATEGORY_ORDER.filter(cat =>
    cat !== 'flex' && cat !== 'sparkling' && cat !== 'rose' && cat !== 'dessertFortified'
  );

  for (const category of priorityOrder) {
    const config = CATEGORY_REGISTRY[category];
    if (!config) continue;

    const rules = config.matchRules;
    if (!rules || Object.keys(rules).length === 0) continue;

    // Colour must match if specified
    if (rules.colours && rules.colours.length > 0) {
      if (!rules.colours.includes(colour)) continue;
    }

    // Check winemaking exclusions first
    if (rules.excludeWinemaking && rules.excludeWinemaking.length > 0) {
      const hasExcluded = rules.excludeWinemaking.some(w => winemaking.includes(w));
      if (hasExcluded) continue;
    }

    // Check keyword exclusions
    if (rules.excludeKeywords && rules.excludeKeywords.length > 0) {
      const hasExcluded = rules.excludeKeywords.some(k =>
        wineName.includes(k) || style.includes(k) || winemaking.includes(k)
      );
      if (hasExcluded) continue;
    }

    // Check grape match (word-boundary-aware)
    if (rules.grapes && rules.grapes.length > 0) {
      const hasGrape = rules.grapes.some(g =>
        grapeMatchesText(grapes, g) || grapeMatchesText(wineName, g) || grapeMatchesText(style, g)
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

    // Colour-only fallback: only for categories without specific matchers
    const hasSpecificMatchers = Boolean(
      (rules.grapes && rules.grapes.length > 0) ||
      (rules.keywords && rules.keywords.length > 0) ||
      (rules.winemaking && rules.winemaking.length > 0)
    );
    if (!hasSpecificMatchers && rules.colours && rules.colours.includes(colour)) {
      return category;
    }
  }

  return null;
}

/**
 * Categorise all wines currently in a fridge area.
 * @param {Array} areaWines - Wines in the fridge area
 * @returns {Object} Count by category
 */
export function categorizeFridgeWines(areaWines) {
  const counts = {};
  for (const category of Object.keys(CATEGORY_REGISTRY)) {
    counts[category] = 0;
  }
  counts.flex = 0;

  for (const wine of areaWines) {
    const category = categoriseWine(wine);
    if (category) {
      counts[category] = (counts[category] || 0) + 1;
    } else {
      counts.flex = (counts.flex || 0) + 1;
    }
  }

  return counts;
}

/**
 * Calculate fridge par-level gaps for an area.
 * @param {Array} areaWines - Current fridge area contents
 * @param {Object} computedParLevels - Output of computeParLevels()
 * @returns {Object} Gaps by category with need count and descriptions
 */
export function calculateParLevelGaps(areaWines, computedParLevels) {
  const current = categorizeFridgeWines(areaWines);
  const gaps = {};

  for (const [category, config] of Object.entries(computedParLevels)) {
    if (config.optional) continue; // Skip flex
    if (config.min === 0) continue; // No target for this category (insufficient stock)

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
 * Get fridge area status summary.
 * @param {Array} areaWines - Wines in the fridge area
 * @param {Object} computedParLevels - Output of computeParLevels()
 * @param {number} capacity - Actual slot capacity for this area
 * @returns {Object} Fridge status
 */
export function getFridgeStatus(areaWines, computedParLevels, capacity) {
  const currentMix = categorizeFridgeWines(areaWines);
  const gaps = calculateParLevelGaps(areaWines, computedParLevels);
  const emptySlots = capacity - areaWines.length;

  return {
    capacity,
    occupied: areaWines.length,
    emptySlots,
    currentMix,
    parLevelGaps: gaps,
    hasGaps: Object.keys(gaps).length > 0,
    totalNeeded: Object.values(gaps).reduce((sum, g) => sum + g.need, 0)
  };
}

/**
 * Get wine IDs that are in the reduce-now list.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Set<number>>} Set of wine IDs
 */
async function getReduceNowWineIds(cellarId) {
  try {
    const rows = await db.prepare(
      'SELECT wine_id FROM reduce_now WHERE cellar_id = ?'
    ).all(cellarId);
    return new Set(rows.map(r => r.wine_id));
  } catch {
    return new Set();
  }
}

/**
 * Find wines suitable for a fridge category from pre-filtered candidates.
 * Prioritizes wines in the reduce-now list, then wines near their drink-by year.
 * @param {Array} candidateWines - Pre-filtered candidate wines (not in any fridge)
 * @param {string} category - Target category
 * @param {number} count - Number needed
 * @param {Set<number>} [reduceNowIds] - Pre-fetched reduce-now wine IDs
 * @returns {Promise<Array>} Suitable wines sorted by priority
 */
export async function findSuitableWines(candidateWines, category, count, reduceNowIds = null) {
  const config = CATEGORY_REGISTRY[category] || FLEX_CATEGORY;

  const reduceNowSet = reduceNowIds instanceof Set ? reduceNowIds : new Set();
  const currentYear = new Date().getFullYear();

  // Filter candidates that match this category
  const matching = candidateWines.filter(wine => categoriseWine(wine) === category);

  // Rank by suitability
  const ranked = matching.map(wine => {
    let score = 0;
    let reason = '';

    // HIGHEST PRIORITY: Wines in reduce-now list
    if (reduceNowSet.has(wine.id)) {
      score += 150;
      reason = 'Flagged for drinking soon';
    }

    // Prefer wines near drink-by year
    const drinkByYear = getEffectiveDrinkByYear(wine);
    if (drinkByYear) {
      const yearsLeft = drinkByYear - currentYear;
      if (yearsLeft <= 0) {
        score += 100;
        if (!reason) reason = 'Past optimal window';
      } else if (yearsLeft <= 1) {
        score += 80;
        if (!reason) reason = 'Final year of drinking window';
      } else if (yearsLeft <= 2) {
        score += 50;
        if (!reason) reason = `Drink by ${drinkByYear}`;
      } else if (yearsLeft <= 3) {
        score += 20;
      }
    }

    // Prefer wines from preferred zones
    if (config.preferredZones && config.preferredZones.includes(wine.zone_id)) {
      score += 30;
    }

    // Slight preference for newer entries (higher ID = more recently added)
    score += Math.min(wine.id / 1000, 10);

    return { wine, score, reason };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(r => ({ ...r.wine, _suggestReason: r.reason }));
}

/**
 * Build a candidate object from a wine.
 * @param {Object} wine - Wine object from findSuitableWines
 * @param {string} category - Fridge category
 * @param {Set<number>} reduceNowIds - Wine IDs in reduce-now list
 * @returns {Object} Candidate object
 */
function buildCandidateObject(wine, category, reduceNowIds) {
  const drinkByYear = getEffectiveDrinkByYear(wine);
  const reason = wine._suggestReason
    ? `${wine._suggestReason} • ${buildFillReason(wine, category, drinkByYear)}`
    : buildFillReason(wine, category, drinkByYear);

  return {
    wineId: wine.id,
    wineName: wine.wine_name,
    vintage: wine.vintage,
    category,
    categoryDescription: CATEGORY_REGISTRY[category]?.description || FLEX_CATEGORY.description,
    drinkByYear,
    fromSlot: wine.slot_id || wine.location_code,
    reason,
    isReduceNow: reduceNowIds.has(wine.id)
  };
}

/**
 * Select wines to fill fridge gaps.
 * @param {Array} candidateWines - Pre-filtered candidate wines (not in any fridge)
 * @param {Object} gaps - Par level gaps from calculateParLevelGaps
 * @param {number} emptySlots - Available fridge slots
 * @param {string} [cellarId] - Cellar ID for tenant isolation
 * @returns {Promise<Array>} Wines to move to fridge with reasons
 */
export async function selectFridgeFillCandidates(candidateWines, gaps, emptySlots, cellarId) {
  const candidates = [];
  let slotsRemaining = emptySlots;

  // Pre-fetch reduce-now IDs once for all categories
  const reduceNowIds = await getReduceNowWineIds(cellarId);

  // Sort gaps by priority
  const sortedGaps = Object.entries(gaps)
    .sort((a, b) => (a[1].priority ?? 99) - (b[1].priority ?? 99));

  for (const [category, gap] of sortedGaps) {
    if (slotsRemaining <= 0) break;

    const toFill = Math.min(gap.need, slotsRemaining);
    const suitable = await findSuitableWines(candidateWines, category, toFill, reduceNowIds);

    for (const wine of suitable) {
      if (slotsRemaining <= 0) break;
      candidates.push(buildCandidateObject(wine, category, reduceNowIds));
      slotsRemaining--;
    }
  }

  return candidates;
}

/**
 * Select alternative wines for each gap category (up to 2 per category).
 * Excludes wines already selected as primary candidates.
 * @param {Array} candidateWines - Pre-filtered candidate wines
 * @param {Object} gaps - Par level gaps
 * @param {Array} primaryCandidates - Already-selected primary candidates
 * @param {Set<number>} reduceNowIds - Reduce-now wine IDs
 * @returns {Promise<Object>} Alternatives keyed by category
 */
async function selectFridgeAlternatives(candidateWines, gaps, primaryCandidates, reduceNowIds) {
  const alternatives = {};
  const primaryIds = new Set(primaryCandidates.map(c => c.wineId));

  for (const [category] of Object.entries(gaps)) {
    const suitable = await findSuitableWines(candidateWines, category, 5, reduceNowIds);
    const alts = suitable
      .filter(w => !primaryIds.has(w.id))
      .slice(0, 2)
      .map(w => buildCandidateObject(w, category, reduceNowIds));

    if (alts.length > 0) {
      alternatives[category] = alts;
    }
  }

  return alternatives;
}

/**
 * Select flex candidates for remaining empty slots after gap fills.
 * Picks drink-soon wines of any eligible category.
 * @param {Array} candidateWines - Pre-filtered candidate wines
 * @param {number} slotsNeeded - Number of additional slots to fill
 * @param {Set<number>} excludeIds - Wine IDs to exclude (already selected)
 * @param {Set<number>} reduceNowIds - Reduce-now wine IDs
 * @param {string[]} eligibleCategories - Categories eligible for this fridge type
 * @returns {Promise<Array>} Flex candidate objects
 */
async function selectFlexCandidates(candidateWines, slotsNeeded, excludeIds, reduceNowIds, eligibleCategories) {
  if (slotsNeeded <= 0) return [];

  const allSuitable = [];

  for (const category of eligibleCategories) {
    const suitable = await findSuitableWines(candidateWines, category, 3, reduceNowIds);
    for (const wine of suitable) {
      if (!excludeIds.has(wine.id)) {
        allSuitable.push({ wine, category });
      }
    }
  }

  // Deduplicate by wine ID (a wine may match multiple categories)
  const seen = new Set();
  const unique = allSuitable.filter(({ wine }) => {
    if (seen.has(wine.id)) return false;
    seen.add(wine.id);
    return true;
  });

  // Sort by urgency (presence of _suggestReason as proxy)
  unique.sort((a, b) => {
    const aUrgent = a.wine._suggestReason ? 1 : 0;
    const bUrgent = b.wine._suggestReason ? 1 : 0;
    return bUrgent - aUrgent;
  });

  return unique
    .slice(0, slotsNeeded)
    .map(({ wine, category }) => {
      const candidate = buildCandidateObject(wine, category, reduceNowIds);
      const drinkByYear = getEffectiveDrinkByYear(wine);
      const currentYear = new Date().getFullYear();
      const urgencyParts = [];
      if (wine._suggestReason) urgencyParts.push(wine._suggestReason);
      if (drinkByYear && drinkByYear <= currentYear) urgencyParts.push('Past optimal window');
      else if (drinkByYear && drinkByYear <= currentYear + 2) urgencyParts.push(`Drink by ${drinkByYear}`);
      urgencyParts.push('Fill remaining fridge slot');
      candidate.reason = urgencyParts.join(' • ');
      candidate.isFlex = true;
      return candidate;
    });
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
  const config = CATEGORY_REGISTRY[category] || FLEX_CATEGORY;

  const parts = [];

  if (drinkByYear) {
    if (drinkByYear <= currentYear) {
      parts.push('Past optimal window - drink now');
    } else if (drinkByYear === currentYear + 1) {
      parts.push('Final year of drinking window');
    } else if (drinkByYear <= currentYear + 2) {
      parts.push(`Drink by ${drinkByYear}`);
    }
  }

  parts.push(`Fills ${category.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} gap`);

  if (config.signals && config.signals.length > 0) {
    const hints = config.signals.slice(0, 2).join(', ');
    parts.push(`Great for ${hints}`);
  }

  return parts.join(' • ');
}

/**
 * Get complete fridge area analysis with candidates.
 *
 * @param {Array} areaWines - Wines currently in this fridge area
 * @param {Array} candidateWines - Pre-filtered candidate wines (not in any fridge)
 * @param {Object} parLevels - Pre-computed par levels from computeParLevels()
 * @param {string} [cellarId] - Cellar ID for tenant isolation
 * @param {Object} [options]
 * @param {string} [options.fridgeType] - 'wine_fridge' (default) or 'kitchen_fridge'
 * @param {string[]} [options.emptyFridgeSlots] - Empty slot codes for this area
 * @param {number|string} [options.areaId] - Storage area ID (for multi-area support)
 * @param {string} [options.areaName] - Storage area name
 * @returns {Promise<Object>} Complete fridge area analysis
 */
export async function analyseFridge(areaWines, candidateWines, parLevels, cellarId, options = {}) {
  const {
    fridgeType = 'wine_fridge',
    emptyFridgeSlots = [],
    areaId = null,
    areaName = null
  } = options;

  const isHouseholdFridge = fridgeType === 'kitchen_fridge';

  // Compute capacity from actual area wines + empty slots
  const occupiedSlotCodes = areaWines.map(w => w.slot_id || w.location_code).filter(Boolean);
  const emptySlotCodes = emptyFridgeSlots;
  const capacity = occupiedSlotCodes.length + emptySlotCodes.length;

  const status = getFridgeStatus(areaWines, parLevels, capacity);
  const reduceNowIds = await getReduceNowWineIds(cellarId);

  // Stable sort for allSlots
  const allSlots = [...new Set([...occupiedSlotCodes, ...emptySlotCodes])].sort(
    (a, b) => {
      // Try numeric sort after stripping leading non-digits (F1, F2, ...)
      const aNum = parseInt(a.replace(/^[^0-9]+/, ''), 10);
      const bNum = parseInt(b.replace(/^[^0-9]+/, ''), 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    }
  );

  // Eligible categories for this fridge type (from parLevels keys, excluding flex)
  const eligibleCategories = Object.keys(parLevels).filter(cat => cat !== 'flex');

  // Build eligibleCategories metadata for frontend rendering (avoids duplicate hardcoding)
  const eligibleCategoriesMetadata = Object.fromEntries(
    FRIDGE_CATEGORY_ORDER
      .filter(cat => cat !== 'flex' && CATEGORY_REGISTRY[cat]?.suitableFor.includes(fridgeType))
      .map(cat => [cat, {
        label: CATEGORY_DISPLAY_NAMES[cat] || cat,
        priority: CATEGORY_REGISTRY[cat].priority,
        description: CATEGORY_REGISTRY[cat].description || ''
      }])
  );

  let candidates = [];
  let alternatives = {};
  let unfilledGaps = {};
  const shouldGenerateCandidates = status.hasGaps || status.emptySlots > 0;

  if (shouldGenerateCandidates) {
    // Primary gap-fill candidates
    const maxCandidates = status.emptySlots > 0 ? status.emptySlots : 3;
    candidates = status.hasGaps
      ? await selectFridgeFillCandidates(candidateWines, status.parLevelGaps, maxCandidates, cellarId)
      : [];

    // Detect which gaps weren't fully filled
    if (status.hasGaps) {
      const filledCounts = candidates.reduce((acc, candidate) => {
        acc[candidate.category] = (acc[candidate.category] || 0) + 1;
        return acc;
      }, {});

      for (const [category, gap] of Object.entries(status.parLevelGaps)) {
        const filled = filledCounts[category] || 0;
        if (filled < gap.need) {
          const categoryName = formatCategoryName(category);
          const remaining = gap.need - filled;
          const message = filled === 0
            ? `No ${categoryName.toLowerCase()} wines available in your cellar`
            : `Only ${filled} ${categoryName.toLowerCase()} ${filled === 1 ? 'wine' : 'wines'} available - still need ${remaining}`;

          unfilledGaps[category] = { ...gap, remaining, message };
        }
      }
    }

    // Alternatives (up to 2 per gap category)
    if (status.hasGaps) {
      alternatives = await selectFridgeAlternatives(
        candidateWines, status.parLevelGaps, candidates, reduceNowIds
      );
    }

    // Flex candidates for remaining empty slots (only when all required gaps are filled)
    const slotsAfterGapFill = status.emptySlots - candidates.length;
    if (slotsAfterGapFill > 0 && Object.keys(unfilledGaps).length === 0) {
      const excludeIds = new Set(candidates.map(c => c.wineId));
      for (const alts of Object.values(alternatives)) {
        for (const a of alts) excludeIds.add(a.wineId);
      }
      const flexCandidates = await selectFlexCandidates(
        candidateWines, slotsAfterGapFill, excludeIds, reduceNowIds, eligibleCategories
      );
      candidates.push(...flexCandidates);
    }

    // Assign deterministic targetSlot values using the empty slot list
    candidates.forEach((c, i) => {
      c.targetSlot = emptySlotCodes[i] || null;
    });
  } else if (status.hasGaps) {
    // Fridge is full but has gaps — swap suggestions
    candidates = await selectFridgeFillCandidates(candidateWines, status.parLevelGaps, 3, cellarId);
    if (Object.keys(status.parLevelGaps).length > 0) {
      alternatives = await selectFridgeAlternatives(
        candidateWines, status.parLevelGaps, candidates, reduceNowIds
      );
    }
  }

  return {
    ...status,
    fridgeType,
    areaId,
    areaName,
    eligibleCategories: eligibleCategoriesMetadata,
    allSlots,
    ...(isHouseholdFridge && {
      householdFridgeWarning: 'Household fridge selected — red wines excluded (too cold for red wine storage).'
    }),
    candidates,
    alternatives,
    unfilledGaps,
    wines: areaWines.map(w => ({
      wineId: w.id,
      wineName: w.wine_name,
      name: w.wine_name,
      vintage: w.vintage,
      slot: w.slot_id || w.location_code,
      category: categoriseWine(w) || 'uncategorised',
      drinkByYear: getEffectiveDrinkByYear(w)
    }))
  };
}

/**
 * Generate cross-storage-area move suggestions.
 *
 * Two signal types:
 *   (a) Cellar wines within or past their drinking window → suggest chilling in fridge
 *   (b) Fridge has par-level gaps AND long-term wines occupying slots → suggest returning
 *       those long-term wines to cellar to free space for higher-priority bottles
 *
 * @param {Array} wines - All wines (cellar + fridge)
 * @param {Object} fridgeStatus - Result of getFridgeStatus() for the primary fridge area
 * @returns {Array<Object>} Cross-area suggestions, sorted by priority
 */
export function generateCrossAreaSuggestions(wines, fridgeStatus) {
  if (!fridgeStatus) return [];

  const suggestions = [];
  const currentYear = new Date().getFullYear();

  // (a) Cellar wines at or past their drinking window → move to fridge
  const cellarWines = wines.filter(w => {
    const slot = w.slot_id || w.location_code;
    return slot && slot.startsWith('R');
  });

  for (const wine of cellarWines) {
    const drinkByYear = getEffectiveDrinkByYear(wine);
    if (!drinkByYear) continue;
    const yearsLeft = drinkByYear - currentYear;
    if (yearsLeft > 0 || yearsLeft < -2) continue;
    if (fridgeStatus.emptySlots <= 0) continue;
    const reason = yearsLeft <= 0
      ? `Past optimal window — chill before serving`
      : `Approaching drinking window — move to fridge`;
    suggestions.push({
      type: 'cross_area',
      direction: 'cellar_to_fridge',
      wineId: wine.id,
      wineName: wine.wine_name,
      vintage: wine.vintage,
      from: wine.slot_id || wine.location_code,
      reason,
      priority: 4
    });
  }

  // (b) Fridge has par-level gaps AND long-term wines taking up space
  if (fridgeStatus.hasGaps && fridgeStatus.emptySlots <= 0) {
    const fridgeWines = wines.filter(w => {
      const slot = w.slot_id || w.location_code;
      return slot && slot.startsWith('F');
    });
    for (const wine of fridgeWines) {
      const drinkByYear = getEffectiveDrinkByYear(wine);
      if (!drinkByYear) continue;
      const yearsLeft = drinkByYear - currentYear;
      if (yearsLeft <= 3) continue;
      suggestions.push({
        type: 'cross_area',
        direction: 'fridge_to_cellar',
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        from: wine.slot_id || wine.location_code,
        reason: `${yearsLeft} years until drinking window — return to cellar to free fridge space`,
        priority: 5
      });
    }
  }

  return suggestions.sort((a, b) => a.priority - b.priority);
}

/**
 * Generate suggested moves to organize fridge by category.
 * Groups wines by category in optimal temperature order.
 *
 * IMPORTANT: These moves must be executed as a batch (all at once) to avoid
 * data loss. The validation will catch conflicts if executed individually
 * because after one move, the source/target state changes.
 *
 * @param {Array} fridgeWines - Current fridge contents with slot info
 * @returns {Object} {moves, slotAssignments, categoryOrder, summary, mustExecuteAsBatch}
 */
export function suggestFridgeOrganization(fridgeWines) {
  if (fridgeWines.length === 0) {
    return {
      moves: [],
      slotAssignments: {},
      categoryOrder: FRIDGE_CATEGORY_ORDER,
      summary: [],
      mustExecuteAsBatch: false
    };
  }

  // Map wines to their categories
  const categorizedWines = fridgeWines.map(w => ({
    ...w,
    category: categoriseWine(w) || 'flex'
  }));

  // Sort wines by category order
  const sortedWines = [...categorizedWines].sort((a, b) => {
    const aIdx = FRIDGE_CATEGORY_ORDER.indexOf(a.category);
    const bIdx = FRIDGE_CATEGORY_ORDER.indexOf(b.category);
    const aOrder = aIdx === -1 ? 999 : aIdx;
    const bOrder = bIdx === -1 ? 999 : bIdx;
    return aOrder - bOrder;
  });

  // Get current slots in order
  const currentSlots = categorizedWines.map(w => w.slot_id || w.location_code);
  const sortedSlots = [...currentSlots].sort((a, b) => {
    const aNum = parseInt(a.replace('F', ''));
    const bNum = parseInt(b.replace('F', ''));
    return aNum - bNum;
  });

  const moves = [];
  const slotAssignments = {};
  const allocatedTargets = new Set();
  const movedWines = new Set();

  sortedWines.forEach((wine, idx) => {
    const targetSlot = sortedSlots[idx];
    const currentSlot = wine.slot_id || wine.location_code;

    if (allocatedTargets.has(targetSlot)) {
      logger.warn('FridgeOrganize', `Target ${targetSlot} already allocated, skipping wine ${wine.id}`);
      return;
    }
    if (movedWines.has(wine.id)) {
      logger.warn('FridgeOrganize', `Wine ${wine.id} already has a move, skipping`);
      return;
    }

    if (currentSlot !== targetSlot) {
      moves.push({
        wineId: wine.id,
        wineName: wine.wine_name,
        vintage: wine.vintage,
        category: wine.category,
        from: currentSlot,
        to: targetSlot,
        reason: `Group ${formatCategoryName(wine.category)} wines together`
      });
      movedWines.add(wine.id);
    }
    allocatedTargets.add(targetSlot);
    slotAssignments[targetSlot] = wine.category;
  });

  const sources = new Set(moves.map(m => m.from));
  const targets = new Set(moves.map(m => m.to));
  const hasSwaps = [...sources].some(s => targets.has(s));

  return {
    moves,
    slotAssignments,
    categoryOrder: FRIDGE_CATEGORY_ORDER,
    summary: generateOrganizationSummary(sortedWines),
    mustExecuteAsBatch: hasSwaps,
    hasSwaps
  };
}

/**
 * Format category name for display.
 * @param {string} category - Category ID
 * @returns {string} Human-readable name
 */
function formatCategoryName(category) {
  return CATEGORY_DISPLAY_NAMES[category] || category;
}

/**
 * Generate summary of fridge organization.
 * @param {Array} sortedWines - Wines sorted by category
 * @returns {Array} Category groups with slot ranges
 */
function generateOrganizationSummary(sortedWines) {
  const groups = [];
  let currentCategory = null;
  let startSlot = null;
  let count = 0;

  sortedWines.forEach((wine, idx) => {
    if (wine.category !== currentCategory) {
      if (currentCategory !== null) {
        groups.push({
          category: currentCategory,
          name: formatCategoryName(currentCategory),
          count,
          startSlot,
          endSlot: `F${idx}`
        });
      }
      currentCategory = wine.category;
      startSlot = `F${idx + 1}`;
      count = 1;
    } else {
      count++;
    }
  });

  if (currentCategory !== null) {
    groups.push({
      category: currentCategory,
      name: formatCategoryName(currentCategory),
      count,
      startSlot,
      endSlot: `F${sortedWines.length}`
    });
  }

  return groups;
}
