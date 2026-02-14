/**
 * @fileoverview Fridge stocking service for par-level gap detection.
 * Calculates what's missing from the fridge and suggests candidates.
 * @module services/cellar/fridgeStocking
 */

import { FRIDGE_PAR_LEVELS, FRIDGE_CAPACITY } from '../../config/fridgeParLevels.js';
import { getEffectiveDrinkByYear } from './cellarAnalysis.js';
import db from '../../db/index.js';
import logger from '../../utils/logger.js';
import { grapeMatchesText } from '../../utils/wineNormalization.js';

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

  // Rose is reliably identified by colour metadata.
  if (colour === 'rose') {
    return 'rose';
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

    // Check grape match (word-boundary-aware to prevent overlap like "chenin" matching unrelated substrings)
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

    // Only allow colour-only fallback for categories without specific matchers.
    // Prevents broad buckets (like aromatic white) from catching all white wines.
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
 * Find wines suitable for a fridge category.
 * Prioritizes wines in the reduce-now list.
 * @param {Array} cellarWines - Available wines in cellar
 * @param {string} category - Target category
 * @param {number} count - Number needed
 * @param {Set<number>} [reduceNowIds] - Pre-fetched reduce-now wine IDs
 * @returns {Promise<Array>} Suitable wines
 */
export async function findSuitableWines(cellarWines, category, count, reduceNowIds = null) {
  const config = FRIDGE_PAR_LEVELS[category];
  if (!config) return [];

  // Fetch reduce-now IDs if not provided
  const reduceNowSet = reduceNowIds || await getReduceNowWineIds();
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
        score += 100; // Past due - highest priority
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

  // Sort by score descending and return top N
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
    categoryDescription: FRIDGE_PAR_LEVELS[category]?.description || category,
    drinkByYear,
    fromSlot: wine.slot_id || wine.location_code,
    reason,
    isReduceNow: reduceNowIds.has(wine.id)
  };
}

/**
 * Select wines to fill fridge gaps.
 * @param {Array} cellarWines - Available wines in cellar
 * @param {Object} gaps - Par level gaps from calculateParLevelGaps
 * @param {number} emptySlots - Available fridge slots
 * @param {string} [cellarId] - Cellar ID for tenant isolation
 * @returns {Promise<Array>} Wines to move to fridge with reasons
 */
export async function selectFridgeFillCandidates(cellarWines, gaps, emptySlots, cellarId) {
  const candidates = [];
  let slotsRemaining = emptySlots;

  // Pre-fetch reduce-now IDs once for all categories
  const reduceNowIds = await getReduceNowWineIds(cellarId);

  // Sort gaps by priority
  const sortedGaps = Object.entries(gaps)
    .sort((a, b) => a[1].priority - b[1].priority);

  for (const [category, gap] of sortedGaps) {
    if (slotsRemaining <= 0) break;

    const toFill = Math.min(gap.need, slotsRemaining);
    const suitable = await findSuitableWines(cellarWines, category, toFill, reduceNowIds);

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
 * @param {Array} cellarWines - Available wines in cellar
 * @param {Object} gaps - Par level gaps
 * @param {Array} primaryCandidates - Already-selected primary candidates
 * @param {Set<number>} reduceNowIds - Reduce-now wine IDs
 * @returns {Promise<Object>} Alternatives keyed by category
 */
async function selectFridgeAlternatives(cellarWines, gaps, primaryCandidates, reduceNowIds) {
  const alternatives = {};
  const primaryIds = new Set(primaryCandidates.map(c => c.wineId));

  for (const [category] of Object.entries(gaps)) {
    // Get more candidates than needed, then exclude primaries
    const suitable = await findSuitableWines(cellarWines, category, 5, reduceNowIds);
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
 * Picks drink-soon wines of any fridge-suitable category.
 * @param {Array} cellarWines - Available wines in cellar
 * @param {number} slotsNeeded - Number of additional slots to fill
 * @param {Set<number>} excludeIds - Wine IDs to exclude (already selected)
 * @param {Set<number>} reduceNowIds - Reduce-now wine IDs
 * @returns {Promise<Array>} Flex candidate objects
 */
async function selectFlexCandidates(cellarWines, slotsNeeded, excludeIds, reduceNowIds) {
  if (slotsNeeded <= 0) return [];

  const categories = Object.keys(FRIDGE_PAR_LEVELS);
  const allSuitable = [];

  for (const category of categories) {
    const suitable = await findSuitableWines(cellarWines, category, 3, reduceNowIds);
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

  // Sort by score (highest first — findSuitableWines already scored them)
  // We use the _suggestReason presence as a proxy for high score
  unique.sort((a, b) => {
    const aUrgent = a.wine._suggestReason ? 1 : 0;
    const bUrgent = b.wine._suggestReason ? 1 : 0;
    return bUrgent - aUrgent;
  });

  return unique
    .slice(0, slotsNeeded)
    .map(({ wine, category }) => {
      const candidate = buildCandidateObject(wine, category, reduceNowIds);
      // Override reason for flex candidates — they don't fill a specific gap
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
 * @param {string} [cellarId] - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Complete fridge analysis
 */
export async function analyseFridge(fridgeWines, cellarWines, cellarId) {
  const status = getFridgeStatus(fridgeWines);
  const reduceNowIds = await getReduceNowWineIds(cellarId);

  let candidates = [];
  let alternatives = {};
  let unfilledGaps = {};
  const shouldGenerateCandidates = status.hasGaps || status.emptySlots > 0;

  if (shouldGenerateCandidates) {
    // Primary gap-fill candidates
    const maxCandidates = status.emptySlots > 0 ? status.emptySlots : 3;
    candidates = status.hasGaps
      ? await selectFridgeFillCandidates(cellarWines, status.parLevelGaps, maxCandidates, cellarId)
      : [];

    // Detect which gaps weren't fully filled (none or insufficient suitable wines)
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

          unfilledGaps[category] = {
            ...gap,
            remaining,
            message
          };
        }
      }
    }

    // Alternatives (up to 2 per gap category)
    if (status.hasGaps) {
      alternatives = await selectFridgeAlternatives(
        cellarWines, status.parLevelGaps, candidates, reduceNowIds
      );
    }

    // Flex candidates for remaining empty slots after gap fills.
    // Important: only use flex when all required gap categories were filled.
    const slotsAfterGapFill = status.emptySlots - candidates.length;
    if (slotsAfterGapFill > 0 && Object.keys(unfilledGaps).length === 0) {
      const excludeIds = new Set(candidates.map(c => c.wineId));
      // Also exclude alternatives
      for (const alts of Object.values(alternatives)) {
        for (const a of alts) excludeIds.add(a.wineId);
      }
      const flexCandidates = await selectFlexCandidates(
        cellarWines, slotsAfterGapFill, excludeIds, reduceNowIds
      );
      candidates.push(...flexCandidates);
    }

    // Assign deterministic targetSlot values to candidates
    const fridgeSlots = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];
    const occupiedSlots = new Set(fridgeWines.map(w => w.slot_id || w.location_code));
    const emptySlotsList = fridgeSlots.filter(s => !occupiedSlots.has(s));
    candidates.forEach((c, i) => {
      c.targetSlot = emptySlotsList[i] || null;
    });
  } else if (status.hasGaps) {
    // Fridge is full but has gaps — swap suggestions
    candidates = await selectFridgeFillCandidates(cellarWines, status.parLevelGaps, 3, cellarId);
    if (Object.keys(status.parLevelGaps).length > 0) {
      alternatives = await selectFridgeAlternatives(
        cellarWines, status.parLevelGaps, candidates, reduceNowIds
      );
    }
  }

  return {
    ...status,
    candidates,
    alternatives,
    unfilledGaps,
    wines: fridgeWines.map(w => ({
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
 * Fridge category slot assignments (recommended positioning).
 * Organizes by temperature preference: coldest at top, warmer at bottom.
 */
const FRIDGE_CATEGORY_ORDER = [
  'sparkling',      // Coldest (top shelf)
  'crispWhite',     // Cold
  'aromaticWhite',  // Cool
  'textureWhite',   // Slightly warmer
  'rose',           // Cool to room
  'chillableRed',   // Warmer (bottom shelf)
  'flex'            // Any remaining slots
];

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
    // If category not found, put at end
    const aOrder = aIdx === -1 ? 999 : aIdx;
    const bOrder = bIdx === -1 ? 999 : bIdx;
    return aOrder - bOrder;
  });

  // Get current slots in order (F1, F2, ... F9)
  const currentSlots = categorizedWines.map(w => w.slot_id || w.location_code);
  const sortedSlots = [...currentSlots].sort((a, b) => {
    const aNum = parseInt(a.replace('F', ''));
    const bNum = parseInt(b.replace('F', ''));
    return aNum - bNum;
  });

  // Generate moves needed
  const moves = [];
  const slotAssignments = {};
  const allocatedTargets = new Set();
  const movedWines = new Set();

  sortedWines.forEach((wine, idx) => {
    const targetSlot = sortedSlots[idx];
    const currentSlot = wine.slot_id || wine.location_code;

    // Safety checks to prevent duplicate allocations
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

  // Check if any moves involve swaps (wine A→B while B→A)
  // If so, they MUST be executed as a batch
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
  const names = {
    sparkling: 'Sparkling',
    crispWhite: 'Crisp White',
    aromaticWhite: 'Aromatic White',
    textureWhite: 'Oaked White',
    rose: 'Rosé',
    chillableRed: 'Light Red',
    flex: 'Other'
  };
  return names[category] || category;
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

  // Add last group
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
