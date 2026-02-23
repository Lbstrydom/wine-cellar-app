/**
 * @fileoverview Layout proposer — computes the ideal target layout for the entire cellar.
 * Operates on slot instances (not wine IDs) because one wine_id can occupy multiple slots.
 * Respects zone rules, colour constraints, same-wine adjacency, fill direction, and
 * on-demand row allocation.
 *
 * Algorithm:
 *  1. Classify wines via scanBottles (reuses bottleScanner.js)
 *  2. Build zone demand + on-demand allocation
 *  3. Build ordered slot inventory per zone (respects fillDirection)
 *  4. Pack zones: assign slot instances contiguously, same wine_id adjacent
 *  5. Stability pass: reduce unnecessary moves by keeping bottles already correct
 *
 * @module services/cellar/layoutProposer
 */

import { scanBottles } from './bottleScanner.js';
import { getActiveZoneMap, allocateRowToZone, getZoneRows } from './cellarAllocation.js';
import { ZONE_PRIORITY_ORDER, getZoneById } from '../../config/cellarZones.js';
import { getCellarLayoutSettings, getDynamicColourRowRanges, isWhiteFamily } from '../shared/cellarLayoutSettings.js';
import { parseSlot, buildSlotId, getRowCapacity, isCellarSlot, sortRowIds } from './slotUtils.js';

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

/**
 * Build a map of currently occupied cellar slots → wine info.
 * Excludes fridge slots.
 * @param {Array<Object>} wines - Wine rows with slot_id/location_code
 * @returns {Map<string, {wineId: number, wineName: string, colour: string, zoneId: string}>}
 */
function buildCurrentLayout(wines) {
  const layout = new Map();
  for (const w of wines) {
    const slotId = w.slot_id || w.location_code;
    if (!slotId || !isCellarSlot(slotId)) continue;
    layout.set(slotId, {
      wineId: w.id,
      wineName: w.wine_name,
      colour: w.colour || 'red',
      zoneId: w.zone_id || null
    });
  }
  return layout;
}

/**
 * Build ordered slot list for a set of rows, respecting fill direction.
 * @param {string[]} rows - Row IDs (e.g. ['R3', 'R4'])
 * @param {string} fillDirection - 'left' or 'right'
 * @param {Array<{row_num: number, col_count: number}>} [storageAreaRows] - Dynamic row defs
 * @returns {string[]} Ordered slot IDs
 */
export function buildSlotOrder(rows, fillDirection, storageAreaRows) {
  const sortedRows = [...rows].sort(sortRowIds);
  const slots = [];

  for (const rowId of sortedRows) {
    const capacity = getRowCapacity(rowId, storageAreaRows);
    if (fillDirection === 'right') {
      for (let col = capacity; col >= 1; col--) {
        slots.push(buildSlotId(parseInt(rowId.replace('R', ''), 10), col));
      }
    } else {
      // Default: left-to-right fill
      for (let col = 1; col <= capacity; col++) {
        slots.push(buildSlotId(parseInt(rowId.replace('R', ''), 10), col));
      }
    }
  }

  return slots;
}

/**
 * Group wine instances by wine_id for adjacency packing.
 * Each slot is a distinct instance — returns groups sorted by bottle count descending
 * for tightest packing.
 * @param {Array<{wineId: number, wineName: string, slot: string, confidence: string}>} wineInstances
 * @returns {Array<{wineId: number, wineName: string, confidence: string, instances: Array}>}
 */
function groupByWineId(wineInstances) {
  const groups = new Map();
  for (const inst of wineInstances) {
    if (!groups.has(inst.wineId)) {
      groups.set(inst.wineId, {
        wineId: inst.wineId,
        wineName: inst.wineName,
        confidence: inst.confidence,
        instances: []
      });
    }
    groups.get(inst.wineId).instances.push(inst);
  }

  // Sort: most bottles first for contiguous packing
  return [...groups.values()].sort((a, b) => b.instances.length - a.instances.length);
}

// ───────────────────────────────────────────────────────────
// Core: pack wine instances into zone slots
// ───────────────────────────────────────────────────────────

/**
 * Pack wine instances into zone slots contiguously, keeping same-wine bottles adjacent.
 * @param {Array} wineInstances - Wine bottle instances for this zone
 * @param {string[]} slotOrder - Ordered available slots for this zone
 * @returns {{ assignments: Map<string, {wineId: number, wineName: string, zoneId: string, confidence: string}>, overflow: Array }}
 */
export function packZoneSlots(wineInstances, slotOrder, zoneId) {
  const assignments = new Map();
  const overflow = [];
  const groups = groupByWineId(wineInstances);

  let slotIdx = 0;

  for (const group of groups) {
    for (const inst of group.instances) {
      if (slotIdx < slotOrder.length) {
        assignments.set(slotOrder[slotIdx], {
          wineId: group.wineId,
          wineName: group.wineName,
          zoneId,
          confidence: group.confidence
        });
        slotIdx++;
      } else {
        overflow.push(inst);
      }
    }
  }

  return { assignments, overflow };
}

// ───────────────────────────────────────────────────────────
// Core: stability optimization
// ───────────────────────────────────────────────────────────

/**
 * Reduce unnecessary moves by keeping bottles that are already in a correct zone slot.
 * For each bottle already in the target zone, if its current slot is in the zone's
 * slot set, swap it into its current position in the proposal.
 * @param {Map<string, Object>} targetLayout - Proposed assignments (mutated in place)
 * @param {Map<string, Object>} currentLayout - Current slot → wine map
 * @param {Map<string, Set<string>>} zoneSlotsMap - Zone ID → set of slots belonging to that zone
 */
export function optimizeForStability(targetLayout, currentLayout, zoneSlotsMap) {
  // Build reverse map: in the proposal, where is each (wineId, currentSlot) placed?
  // We want to find bottles whose current slot is within the correct zone but whose
  // proposed slot differs from current — and swap them to stay in place.

  // Step 1: Build set of wines in each proposed slot
  const proposedWineSlots = new Map(); // wineId → [proposedSlot, ...]
  for (const [slotId, info] of targetLayout) {
    if (!proposedWineSlots.has(info.wineId)) {
      proposedWineSlots.set(info.wineId, []);
    }
    proposedWineSlots.get(info.wineId).push(slotId);
  }

  // Step 2: For each currently occupied slot, check if the wine in it is proposed
  // for the same zone AND could stay in place
  for (const [currentSlot, currentInfo] of currentLayout) {
    const proposedAtCurrent = targetLayout.get(currentSlot);

    // If this slot is proposed for the same wine, already stable
    if (proposedAtCurrent?.wineId === currentInfo.wineId) continue;

    // Find which zone this wine is proposed for
    const proposedSlots = proposedWineSlots.get(currentInfo.wineId);
    if (!proposedSlots || proposedSlots.length === 0) continue;

    // Check if current slot belongs to any of the zones this wine is proposed for
    const proposedInfo = targetLayout.get(proposedSlots[0]);
    if (!proposedInfo) continue;

    const zoneSlots = zoneSlotsMap.get(proposedInfo.zoneId);
    if (!zoneSlots || !zoneSlots.has(currentSlot)) continue;

    // Current slot is in the correct zone — try to swap this wine to stay in place
    // Find one of its proposed slots to swap with
    for (const proposedSlot of proposedSlots) {
      if (proposedSlot === currentSlot) continue; // Already handled above

      const otherWine = targetLayout.get(currentSlot);
      const thisWineInfo = targetLayout.get(proposedSlot);

      // Can only swap if both slots are in the same zone
      if (otherWine && thisWineInfo && otherWine.zoneId === thisWineInfo.zoneId) {
        // Swap the two assignments
        targetLayout.set(currentSlot, thisWineInfo);
        targetLayout.set(proposedSlot, otherWine);

        // Update the proposedWineSlots tracking
        const idx = proposedSlots.indexOf(proposedSlot);
        if (idx >= 0) proposedSlots[idx] = currentSlot;

        const otherProposed = proposedWineSlots.get(otherWine.wineId);
        if (otherProposed) {
          const otherIdx = otherProposed.indexOf(currentSlot);
          if (otherIdx >= 0) otherProposed[otherIdx] = proposedSlot;
        }

        break; // One swap per current bottle is enough
      }
    }
  }
}

// ───────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────

/**
 * Propose an ideal bottle-level layout for the entire cellar.
 * @param {Array<Object>} wines - All wines with slot assignments (from DB)
 * @param {Object} options
 * @param {string} options.cellarId - Cellar ID for tenant isolation
 * @param {Array<{row_num: number, col_count: number}>} [options.storageAreaRows] - Dynamic row defs
 * @returns {Promise<{targetLayout: Map, currentLayout: Map, stats: Object, issues: Array}>}
 */
export async function proposeIdealLayout(wines, options = {}) {
  const { cellarId, storageAreaRows } = options;
  const issues = [];

  // ── 1. Get current zone map and layout settings ────────────
  const zoneMap = await getActiveZoneMap(cellarId);
  const hasZoneAllocations = Object.keys(zoneMap).length > 0;

  if (!hasZoneAllocations) {
    return {
      targetLayout: new Map(),
      currentLayout: buildCurrentLayout(wines),
      stats: { noZones: true, totalBottles: 0, stayInPlace: 0, moves: 0 },
      issues: [{ type: 'no_zones', message: 'No zone allocations configured' }]
    };
  }

  const layoutSettings = await getCellarLayoutSettings(cellarId);
  const fillDirection = layoutSettings?.fillDirection || 'left';

  // ── 2. Classify wines via bottle scanner ───────────────────
  const scan = scanBottles(wines, zoneMap);
  const currentLayout = buildCurrentLayout(wines);

  // ── 3. Build zone rows (allocated + on-demand) ─────────────
  // Track allocated rows to prevent double-allocation
  const allocatedRows = new Set(Object.keys(zoneMap));
  const zoneRowsMap = new Map(); // zoneId → string[]

  // Populate from current zone map
  for (const [rowId, info] of Object.entries(zoneMap)) {
    if (!zoneRowsMap.has(info.zoneId)) {
      zoneRowsMap.set(info.zoneId, []);
    }
    zoneRowsMap.get(info.zoneId).push(rowId);
  }

  // For each zone with demand > allocated capacity, try on-demand allocation
  for (const group of scan.groups) {
    const { zoneId, bottleCount } = group;
    const zone = getZoneById(zoneId);
    if (!zone || zone.isBufferZone || zone.isFallbackZone) continue;

    const existingRows = zoneRowsMap.get(zoneId) || [];
    const existingCapacity = existingRows.reduce(
      (sum, r) => sum + getRowCapacity(r, storageAreaRows), 0
    );

    if (bottleCount > existingCapacity) {
      // Need more rows — try to allocate on demand
      let deficit = bottleCount - existingCapacity;
      while (deficit > 0) {
        try {
          const newRow = await allocateRowToZone(zoneId, cellarId, { incrementWineCount: false });
          if (!zoneRowsMap.has(zoneId)) zoneRowsMap.set(zoneId, []);
          zoneRowsMap.get(zoneId).push(newRow);
          allocatedRows.add(newRow);
          deficit -= getRowCapacity(newRow, storageAreaRows);
        } catch {
          // No more rows available — will overflow to buffer
          issues.push({
            type: 'allocation_exhausted',
            zoneId,
            message: `Cannot allocate enough rows for ${zone.displayName} (${deficit} slots short)`
          });
          break;
        }
      }
    }
  }

  // ── 4. Pack zones in priority order ────────────────────────
  const targetLayout = new Map();
  const zoneSlotsMap = new Map(); // zoneId → Set<slotId> (for stability optimization)

  // Overflow collection: wines that couldn't fit in their canonical zone
  const overflowByColour = { white: [], red: [] };

  for (const zoneId of ZONE_PRIORITY_ORDER) {
    const zone = getZoneById(zoneId);
    if (!zone || zone.isBufferZone || zone.isFallbackZone) continue;

    const group = scan.groups.find(g => g.zoneId === zoneId);
    if (!group || group.wines.length === 0) continue;

    const rows = zoneRowsMap.get(zoneId) || [];
    const slotOrder = buildSlotOrder(rows, fillDirection, storageAreaRows);

    // Track zone slots
    zoneSlotsMap.set(zoneId, new Set(slotOrder));

    const { assignments, overflow } = packZoneSlots(group.wines, slotOrder, zoneId);

    // Merge assignments into target layout
    for (const [slot, info] of assignments) {
      targetLayout.set(slot, info);
    }

    // Route overflow through the zone's overflow chain
    if (overflow.length > 0) {
      const colour = Array.isArray(zone.color) ? zone.color[0] : zone.color;
      const bucket = isWhiteFamily(colour) ? overflowByColour.white : overflowByColour.red;
      for (const inst of overflow) {
        bucket.push({ ...inst, sourceZoneId: zoneId, colour });
      }
    }
  }

  // ── 5. Pack buffer zones with overflow ─────────────────────
  const bufferZones = [
    { bufferId: 'white_buffer', wines: overflowByColour.white },
    { bufferId: 'red_buffer', wines: overflowByColour.red }
  ];

  const unclassifiedOverflow = [];

  for (const { bufferId, wines: bufferWines } of bufferZones) {
    if (bufferWines.length === 0) continue;

    const rows = zoneRowsMap.get(bufferId) || [];
    const slotOrder = buildSlotOrder(rows, fillDirection, storageAreaRows);
    zoneSlotsMap.set(bufferId, new Set(slotOrder));

    const { assignments, overflow } = packZoneSlots(bufferWines, slotOrder, bufferId);

    for (const [slot, info] of assignments) {
      targetLayout.set(slot, info);
    }

    if (overflow.length > 0) {
      unclassifiedOverflow.push(...overflow);
    }
  }

  // ── 6. Handle unclassified/curated zone groups ─────────────
  for (const zoneId of ['curiosities', 'unclassified']) {
    const group = scan.groups.find(g => g.zoneId === zoneId);
    if (!group || group.wines.length === 0) continue;

    const rows = zoneRowsMap.get(zoneId) || [];
    const slotOrder = buildSlotOrder(rows, fillDirection, storageAreaRows);
    zoneSlotsMap.set(zoneId, new Set(slotOrder));

    const allWines = [...group.wines, ...(zoneId === 'unclassified' ? unclassifiedOverflow : [])];
    const { assignments, overflow } = packZoneSlots(allWines, slotOrder, zoneId);

    for (const [slot, info] of assignments) {
      targetLayout.set(slot, info);
    }

    if (overflow.length > 0) {
      issues.push({
        type: 'unplaceable',
        count: overflow.length,
        wines: overflow.map(o => ({ wineId: o.wineId, wineName: o.wineName }))
      });
    }
  }

  // ── 7. Stability optimization ──────────────────────────────
  optimizeForStability(targetLayout, currentLayout, zoneSlotsMap);

  // ── 8. Compute stats ──────────────────────────────────────
  let stayInPlace = 0;
  let moves = 0;

  for (const [slotId, proposed] of targetLayout) {
    const current = currentLayout.get(slotId);
    if (current && current.wineId === proposed.wineId) {
      stayInPlace++;
    } else {
      moves++;
    }
  }

  // Count bottles in current layout that aren't in target at all
  const unplaceableCount = issues
    .filter(i => i.type === 'unplaceable')
    .reduce((sum, i) => sum + i.count, 0);

  return {
    targetLayout,
    currentLayout,
    stats: {
      totalBottles: currentLayout.size,
      totalProposed: targetLayout.size,
      stayInPlace,
      moves,
      unplaceable: unplaceableCount,
      noZones: false
    },
    issues
  };
}
