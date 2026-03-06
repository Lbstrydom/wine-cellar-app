/**
 * @fileoverview Dynamic fridge par-level allocation and multi-area planning utilities.
 * Computes slot counts from live inventory, manages cross-area slot reservations,
 * and detects misplaced wines for transfer suggestions.
 * @module services/cellar/fridgeAllocator
 */

import {
  CATEGORY_REGISTRY,
  FLEX_CATEGORY,
  FRIDGE_CATEGORY_ORDER,
  CATEGORY_DISPLAY_NAMES
} from '../../config/fridgeCategories.js';
import { categoriseWine } from './fridgeStocking.js';

/**
 * Count total inventory bottles by fridge category across all wines.
 * Counts ALL wines regardless of location (fridge or cellar) so that
 * par-levels reflect total ownership, not just cellar placement.
 * @param {Array} allWines - All wines (enriched with slot and storage_area_id data)
 * @returns {Object} Count per category e.g. { sparkling: 3, crispWhite: 7, ... }
 */
export function countInventoryByCategory(allWines) {
  const counts = {};
  for (const cat of Object.keys(CATEGORY_REGISTRY)) {
    counts[cat] = 0;
  }

  for (const wine of allWines) {
    const category = categoriseWine(wine);
    if (category && category !== 'flex' && counts[category] !== undefined) {
      counts[category]++;
    }
  }

  return counts;
}

/**
 * Get categories eligible for a given storage type, in priority order.
 * Filters CATEGORY_REGISTRY entries by their suitableFor field.
 * @param {string} storageType - 'wine_fridge' or 'kitchen_fridge'
 * @returns {string[]} Eligible category names in priority order (no 'flex')
 */
export function getEligibleCategories(storageType) {
  return FRIDGE_CATEGORY_ORDER.filter(cat => {
    if (cat === 'flex') return false; // flex is always handled separately
    const config = CATEGORY_REGISTRY[cat];
    return config && config.suitableFor.includes(storageType);
  });
}

/**
 * Compute dynamic par-level slot allocations based on live inventory.
 *
 * Algorithm:
 *   1. Filter eligible categories by storage type (via suitableFor)
 *   2. Reserve flex = max(1, floor(capacity × 0.1))
 *   3. Compute available stock per category = total − priorAllocations
 *   4. Distribute dataSlots proportionally to available stock
 *   5. Guarantee minimum 1 slot per category that has available stock
 *   6. Scale down over-allocated categories (lowest-priority first)
 *   7. Redistribute remaining slots to highest-priority under-served categories
 *
 * @param {Object} totalInventoryCounts - Total inventory count per category
 * @param {string} storageType - 'wine_fridge' or 'kitchen_fridge'
 * @param {number} capacity - Total slot capacity of this fridge area
 * @param {Object} [priorAllocations] - Slots already targeted by prior areas { cat: count }
 * @returns {Object} Par levels: { [cat]: { min, max, priority, description }, flex: {...} }
 */
export function computeParLevels(totalInventoryCounts, storageType, capacity, priorAllocations = {}) {
  const eligibleCats = getEligibleCategories(storageType);

  // Reserve flex slots (10% of capacity, minimum 1)
  const flexSlots = Math.max(1, Math.floor(capacity * 0.1));
  const dataSlots = capacity - flexSlots;

  // Available stock = total inventory - already allocated to prior fridge areas
  const availableStock = {};
  for (const cat of eligibleCats) {
    availableStock[cat] = Math.max(0, (totalInventoryCounts[cat] ?? 0) - (priorAllocations[cat] ?? 0));
  }
  const totalAvailableStock = Object.values(availableStock).reduce((sum, s) => sum + s, 0);

  // Step 1: Proportional allocation
  const slots = {};
  for (const cat of eligibleCats) {
    const stock = availableStock[cat];
    if (stock === 0 || totalAvailableStock === 0) {
      slots[cat] = 0;
    } else {
      const proportional = Math.floor(dataSlots * stock / totalAvailableStock);
      // Guarantee at least 1 slot for any category that has available stock
      slots[cat] = Math.max(1, proportional);
    }
  }

  // Step 1b: Cap at available stock — never plan more slots than we have bottles.
  // This prevents over-targeting a category when prior areas have already claimed most of its stock.
  for (const cat of eligibleCats) {
    slots[cat] = Math.min(slots[cat], availableStock[cat]);
  }

  // Step 2: Scale down if over-allocated (remove from lowest-priority first)
  let totalAllocated = Object.values(slots).reduce((sum, s) => sum + s, 0);
  if (totalAllocated > dataSlots) {
    const toScale = eligibleCats
      .filter(cat => slots[cat] > 0)
      .sort((a, b) => CATEGORY_REGISTRY[b].priority - CATEGORY_REGISTRY[a].priority); // desc = low-priority first

    let excess = totalAllocated - dataSlots;
    for (const cat of toScale) {
      if (excess <= 0) break;
      const reduceBy = Math.min(excess, slots[cat]);
      slots[cat] -= reduceBy;
      excess -= reduceBy;
    }
    totalAllocated = Object.values(slots).reduce((sum, s) => sum + s, 0);
  }

  // Step 3: Redistribute remaining dataSlots to highest-priority under-served categories
  let remainingSlots = dataSlots - totalAllocated;
  if (remainingSlots > 0) {
    const underServed = eligibleCats
      .filter(cat => availableStock[cat] > slots[cat])
      .sort((a, b) => CATEGORY_REGISTRY[a].priority - CATEGORY_REGISTRY[b].priority); // asc = high-priority first

    for (const cat of underServed) {
      if (remainingSlots <= 0) break;
      const canAdd = availableStock[cat] - slots[cat];
      const toAdd = Math.min(canAdd, remainingSlots);
      slots[cat] += toAdd;
      remainingSlots -= toAdd;
    }
  }

  // Build result in FRIDGE_PAR_LEVELS-compatible shape for analyseFridge consumers
  const result = {};
  for (const cat of eligibleCats) {
    const config = CATEGORY_REGISTRY[cat];
    result[cat] = {
      min: slots[cat],
      max: slots[cat],
      priority: config.priority,
      description: config.description,
      signals: config.signals,
      preferredZones: config.preferredZones || []
    };
  }

  // Flex slot (always included)
  result.flex = {
    min: flexSlots,
    max: flexSlots,
    priority: FLEX_CATEGORY.priority,
    description: FLEX_CATEGORY.description,
    optional: true
  };

  return result;
}

/**
 * Get wines currently in a specific storage area.
 * Pure in-memory filter — no DB queries.
 * @param {Array} allWines - All wines enriched with storage_area_id
 * @param {number|string} storageAreaId - Storage area ID to filter by
 * @returns {Array} Wines in this area
 */
export function getWinesByArea(allWines, storageAreaId) {
  return allWines.filter(wine => wine.storage_area_id === storageAreaId);
}

/**
 * Get wines available as candidates for fridge filling.
 * Excludes wines already in any fridge area and wines whose slot is reserved
 * for another fridge area in this planning pass.
 * Pure in-memory filter — no DB queries.
 *
 * @param {Array} allWines - All wines enriched with storage_area_id and slot_id
 * @param {Set} allFridgeAreaIds - IDs of all configured fridge storage areas
 * @param {Set<string>} reservedSlotIds - Location codes already targeted for other fridge areas
 * @returns {Array} Available candidate wines
 */
export function getAvailableCandidates(allWines, allFridgeAreaIds, reservedSlotIds) {
  return allWines.filter(wine => {
    // Must be placed in a slot
    const slotId = wine.slot_id;
    if (!slotId) return false;
    // Not already in any fridge area
    if (wine.storage_area_id != null && allFridgeAreaIds.has(wine.storage_area_id)) return false;
    // Not reserved for another fridge area in this planning pass (slot-level, not wine-level)
    if (reservedSlotIds.has(slotId)) return false;
    return true;
  });
}

/**
 * Sort fridge areas by priority for sequential planning.
 * Wine fridges process before kitchen fridges (they handle more categories).
 * Within the same type, larger capacity first (more wines to plan → more slots to reserve),
 * then by area ID for determinism when capacity is equal.
 * @param {Array} fridgeAreas - Fridge area objects from getFridgeAreas()
 * @returns {Array} Sorted copy of fridge areas
 */
export function sortFridgeAreasByPriority(fridgeAreas) {
  const typeOrder = { wine_fridge: 0, kitchen_fridge: 1 };
  return [...fridgeAreas].sort((a, b) => {
    const typeDiff = (typeOrder[a.storage_type] ?? 99) - (typeOrder[b.storage_type] ?? 99);
    if (typeDiff !== 0) return typeDiff;
    // Larger capacity first within same type; fall back to ID for determinism
    const capDiff = (b.capacity ?? 0) - (a.capacity ?? 0);
    if (capDiff !== 0) return capDiff;
    return a.id - b.id;
  });
}

/**
 * Detect wines misplaced between fridge areas and surface them as transfer suggestions.
 * Only meaningful when the cellar has multiple fridge areas of different types.
 *
 * Transfers consume destination capacity: when a transfer fills a gap that already has
 * a candidate assigned, that candidate is demoted to alternatives. This prevents
 * conflicting advice (both "add wine X from cellar" and "transfer wine Y from kitchen
 * fridge" targeting the same slot).
 *
 * @param {Array} fridgeAnalysis - Per-area analysis results (mutated: candidates may be demoted)
 * @param {Array} allFridgeAreas - All fridge area definitions with id, name, storage_type
 * @returns {Array} Transfer suggestions
 */
export function detectFridgeTransfers(fridgeAnalysis, allFridgeAreas) {
  if (fridgeAnalysis.length < 2) return []; // transfers only meaningful with multiple areas

  const transfers = [];
  const areaMap = new Map(allFridgeAreas.map(a => [a.id, a]));

  // Track remaining gap capacity per (areaId, category) available for transfers.
  // Initialised from parLevelGaps.need (total gap, not reduced by existing candidates)
  // so transfers can replace candidates when a misplacement correction is a better fit.
  const destRemaining = new Map(); // areaId → { cat: slotsAvailableForTransfers }
  for (const areaResult of fridgeAnalysis) {
    const remaining = {};
    for (const [cat, gap] of Object.entries(areaResult.parLevelGaps || {})) {
      remaining[cat] = gap.need;
    }
    destRemaining.set(areaResult.areaId, remaining);
  }

  for (const areaResult of fridgeAnalysis) {
    const area = areaMap.get(areaResult.areaId);
    if (!area) continue;

    for (const wine of (areaResult.wines || [])) {
      if (!wine.category || wine.category === 'uncategorised') continue;

      const catConfig = CATEGORY_REGISTRY[wine.category];
      if (!catConfig) continue;

      // Skip if this category is suitable for this area's storage type (not misplaced)
      if (catConfig.suitableFor.includes(area.storage_type)) continue;

      // Find a target area where the category is eligible AND has remaining gap capacity
      const targetAreaResult = fridgeAnalysis.find(other => {
        if (other.areaId === areaResult.areaId) return false;
        const otherArea = areaMap.get(other.areaId);
        if (!otherArea || !catConfig.suitableFor.includes(otherArea.storage_type)) return false;
        const remaining = destRemaining.get(other.areaId);
        return remaining && (remaining[wine.category] ?? 0) > 0;
      });

      if (!targetAreaResult) continue;
      const targetArea = areaMap.get(targetAreaResult.areaId);

      // Consume one slot of destination gap capacity for this category
      const remaining = destRemaining.get(targetAreaResult.areaId);
      remaining[wine.category]--;

      // Demote the last candidate for this category in the target area to alternatives,
      // since the transfer fills the same gap (misplacement correction > new addition)
      const targetCandidates = targetAreaResult.candidates || [];
      const candIdx = targetCandidates.findLastIndex(c => c.category === wine.category);
      if (candIdx !== -1) {
        const [demoted] = targetCandidates.splice(candIdx, 1);
        if (!targetAreaResult.alternatives) targetAreaResult.alternatives = {};
        if (!targetAreaResult.alternatives[wine.category]) {
          targetAreaResult.alternatives[wine.category] = [];
        }
        targetAreaResult.alternatives[wine.category].unshift(demoted);
      }

      transfers.push({
        wineId: wine.wineId,
        wineName: wine.wineName || wine.wine_name,
        vintage: wine.vintage,
        category: wine.category,
        categoryLabel: CATEGORY_DISPLAY_NAMES[wine.category] || wine.category,
        fromAreaId: areaResult.areaId,
        fromAreaName: area.name,
        toAreaId: targetAreaResult.areaId,
        toAreaName: targetArea.name,
        fromSlot: wine.slot,
        reason: `${CATEGORY_DISPLAY_NAMES[wine.category] || wine.category} wines are better suited for a ${targetArea.storage_type === 'wine_fridge' ? 'wine fridge' : 'kitchen fridge'}`
      });
    }
  }

  return transfers;
}
