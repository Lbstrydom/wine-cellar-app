/**
 * @fileoverview Move suggestion generation and zone allocation helpers.
 * Extracted from cellarAnalysis.js to keep each module under 300 lines.
 * @module services/cellar/cellarSuggestions
 */

import { getZoneById } from '../../config/cellarZones.js';
import { findAvailableSlot } from './cellarPlacement.js';
import { getActiveZoneMap, getAllocatedRowMap } from './cellarAllocation.js';
import { detectRowGaps } from './cellarMetrics.js';

// ───────────────────────────────────────────────────────────
// Zone allocation queries
// ───────────────────────────────────────────────────────────

/**
 * Get the rows allocated to a specific zone.
 * @param {string} zoneId - Zone ID
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<string[]>} Sorted row IDs (e.g. ["R3", "R4"])
 */
export async function getActiveZoneRowsForZone(zoneId, cellarId) {
  const zoneMap = await getActiveZoneMap(cellarId);
  const rows = [];
  for (const [rowId, info] of Object.entries(zoneMap)) {
    if (info.zoneId === zoneId) rows.push(rowId);
  }
  return rows.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

/**
 * Get the full zone-to-rows and row-to-zone allocation.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<{zoneToRows: Object, rowToZoneId: Object}>}
 */
export async function getCurrentZoneAllocation(cellarId) {
  const zoneMap = await getActiveZoneMap(cellarId);
  const zoneToRows = {};
  const rowToZoneId = {};

  for (const [rowId, info] of Object.entries(zoneMap)) {
    rowToZoneId[rowId] = info.zoneId;
    if (!zoneToRows[info.zoneId]) zoneToRows[info.zoneId] = [];
    zoneToRows[info.zoneId].push(rowId);
  }

  for (const rows of Object.values(zoneToRows)) {
    rows.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  }

  return { zoneToRows, rowToZoneId };
}

/**
 * Get cellar rows not currently allocated to any zone.
 * Checks ALL allocations (not just active ones with wine_count > 0)
 * to match the same logic used by allocateRowToZone().
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<string[]>} Available row IDs
 */
export async function getAvailableCellarRows(cellarId) {
  const allRows = await getAllocatedRowMap(cellarId);
  const used = new Set(Object.keys(allRows));
  const available = [];
  for (let rowNum = 1; rowNum <= 19; rowNum++) {
    const rowId = `R${rowNum}`;
    if (!used.has(rowId)) available.push(rowId);
  }
  return available;
}

/**
 * Get zones adjacent to the given rows in the current allocation.
 * @param {string[]} zoneRows - Row IDs belonging to the zone
 * @param {Object} rowToZoneId - Row-to-zone mapping
 * @returns {string[]} Adjacent zone IDs
 */
export function getAdjacentZonesFromAllocation(zoneRows, rowToZoneId) {
  const adjacent = new Set();

  for (const rowId of zoneRows) {
    const rowNum = parseInt(rowId.slice(1), 10);
    const prev = `R${rowNum - 1}`;
    const next = `R${rowNum + 1}`;

    if (rowToZoneId[prev]) adjacent.add(rowToZoneId[prev]);
    if (rowToZoneId[next]) adjacent.add(rowToZoneId[next]);
  }

  return [...adjacent];
}

// ───────────────────────────────────────────────────────────
// Zone capacity issue helpers
// ───────────────────────────────────────────────────────────

/**
 * Build zone capacity alerts from issues found during suggestion generation.
 * @param {Array} zoneCapacityIssues - Issues from generateMoveSuggestions
 * @param {boolean} needsZoneSetup - Whether zones are not configured
 * @param {boolean} allowFallback - Whether fallback placement is allowed
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Array>} Alert objects for the report
 */
export async function buildZoneCapacityAlerts(zoneCapacityIssues, needsZoneSetup, allowFallback, cellarId) {
  const alerts = [];

  if (zoneCapacityIssues.length === 0 || needsZoneSetup || allowFallback) {
    return alerts;
  }

  const issuesByZone = new Map();
  for (const issue of zoneCapacityIssues) {
    if (!issuesByZone.has(issue.overflowingZoneId)) {
      issuesByZone.set(issue.overflowingZoneId, []);
    }
    issuesByZone.get(issue.overflowingZoneId).push(issue.wine);
  }

  for (const [overflowingZoneId, winesNeedingPlacement] of issuesByZone) {
    const zone = getZoneById(overflowingZoneId);
    const zoneRows = await getActiveZoneRowsForZone(overflowingZoneId, cellarId);
    const currentZoneAllocation = await getCurrentZoneAllocation(cellarId);
    const availableRows = await getAvailableCellarRows(cellarId);
    const adjacentZones = getAdjacentZonesFromAllocation(zoneRows, currentZoneAllocation.rowToZoneId)
      .filter(z => z !== overflowingZoneId);

    const affectedCount = winesNeedingPlacement.length;

    alerts.push({
      type: 'zone_capacity_issue',
      severity: 'warning',
      message: `The "${zone?.displayName || overflowingZoneId}" zone is full. ${affectedCount} wine(s) need placement but would fall back to unrelated areas.`,
      data: {
        overflowingZoneId,
        overflowingZoneName: zone?.displayName || overflowingZoneId,
        winesNeedingPlacement,
        currentZoneAllocation: currentZoneAllocation.zoneToRows,
        availableRows,
        adjacentZones
      }
    });
  }

  return alerts;
}

// ───────────────────────────────────────────────────────────
// Swap pair detection
// ───────────────────────────────────────────────────────────

/**
 * Detect natural swap pairs among misplaced wines.
 * Two misplaced wines form a natural swap when each currently sits
 * in the other's target zone — swapping them places both correctly.
 * @param {Array} misplacedWines - Sorted misplaced wine entries (must have currentZoneId & suggestedZoneId)
 * @returns {Array<[number, number]>} Array of [indexA, indexB] swap pairs
 */
export function detectNaturalSwapPairs(misplacedWines) {
  const pairs = [];
  const used = new Set();

  for (let i = 0; i < misplacedWines.length; i++) {
    if (used.has(i)) continue;
    const wineA = misplacedWines[i];
    if (!wineA.currentZoneId || !wineA.suggestedZoneId) continue;

    for (let j = i + 1; j < misplacedWines.length; j++) {
      if (used.has(j)) continue;
      const wineB = misplacedWines[j];
      if (!wineB.currentZoneId || !wineB.suggestedZoneId) continue;

      // Natural swap: each wine is sitting in the other's target zone
      if (wineA.currentZoneId === wineB.suggestedZoneId &&
          wineB.currentZoneId === wineA.suggestedZoneId) {
        pairs.push([i, j]);
        used.add(i);
        used.add(j);
        break; // Wine A is paired, move to next
      }
    }
  }

  return pairs;
}

// ───────────────────────────────────────────────────────────
// Move suggestion generation
// ───────────────────────────────────────────────────────────

/**
 * Generate move suggestions for misplaced wines.
 * @param {Array} misplacedWines
 * @param {Array} allWines
 * @param {Map} _slotToWine - Slot to wine mapping (reserved)
 * @param {Object} [options]
 * @param {boolean} [options.allowFallback=false]
 * @returns {Promise<Array>} Move suggestions (with _hasSwaps and _zoneCapacityIssues attached)
 */
export async function generateMoveSuggestions(misplacedWines, allWines, _slotToWine, options = {}) {
  const { allowFallback = false, cellarId } = options;
  const occupiedSlots = new Set();
  allWines.forEach(w => {
    const slotId = w.slot_id || w.location_code;
    if (slotId) occupiedSlots.add(slotId);
  });

  const suggestions = [];
  const pendingMoves = new Map();
  const zoneCapacityIssues = [];

  // Track allocated target slots to prevent collisions
  const allocatedTargets = new Set();

  // Sort by confidence - high confidence moves first
  // Note: Use ?? instead of || because confOrder['high'] = 0 and 0 || 2 = 2 (falsy!)
  const sortedMisplaced = [...misplacedWines].sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    const aConf = confOrder[a.confidence] ?? 2;
    const bConf = confOrder[b.confidence] ?? 2;
    return aConf - bConf;
  });

  // ── Pre-detect natural swap pairs ─────────────────────────
  // Two misplaced wines form a natural swap when each currently sits
  // in the other's target zone (A→B, B→A).  Detecting them upfront
  // avoids the sequential loop routing them into chain dependencies.
  const swapPairsDetected = detectNaturalSwapPairs(sortedMisplaced);
  const usedInSwaps = new Set();

  for (const [i, j] of swapPairsDetected) {
    usedInSwaps.add(i);
    usedInSwaps.add(j);

    const wineA = sortedMisplaced[i];
    const wineB = sortedMisplaced[j];

    const higherPriority = Math.min(
      wineA.confidence === 'high' ? 1 : wineA.confidence === 'medium' ? 2 : 3,
      wineB.confidence === 'high' ? 1 : wineB.confidence === 'medium' ? 2 : 3
    );

    suggestions.push({
      type: 'move',
      wineId: wineA.wineId,
      wineName: wineA.name,
      from: wineA.currentSlot,
      to: wineB.currentSlot,
      toZone: wineA.suggestedZone,
      reason: wineA.reason,
      confidence: wineA.confidence,
      isOverflow: false,
      priority: higherPriority
    });

    suggestions.push({
      type: 'move',
      wineId: wineB.wineId,
      wineName: wineB.name,
      from: wineB.currentSlot,
      to: wineA.currentSlot,
      toZone: wineB.suggestedZone,
      reason: wineB.reason,
      confidence: wineB.confidence,
      isOverflow: false,
      priority: higherPriority
    });

    // Both slots stay occupied (swapped contents), mark as allocated
    allocatedTargets.add(wineA.currentSlot);
    allocatedTargets.add(wineB.currentSlot);
  }

  // ── Sequential processing for remaining wines ─────────────
  for (let idx = 0; idx < sortedMisplaced.length; idx++) {
    if (usedInSwaps.has(idx)) continue;
    const wine = sortedMisplaced[idx];
    // Calculate currently available slots (accounting for pending moves AND allocated targets)
    const currentlyOccupied = new Set(occupiedSlots);
    pendingMoves.forEach((toSlot, fromSlot) => {
      currentlyOccupied.delete(fromSlot);
      currentlyOccupied.add(toSlot);
    });

    // Add already-allocated targets to the occupied set
    allocatedTargets.forEach(target => currentlyOccupied.add(target));

    let slot;
    try {
      slot = await findAvailableSlot(wine.suggestedZoneId, currentlyOccupied, wine, {
        allowFallback,
        enforceAffinity: true,
        cellarId
      });
    } catch (err) {
      console.error(`[MoveSuggestions] findAvailableSlot failed for wine ${wine.wineId}:`, err.message);
      slot = null;
    }

    if (slot) {
      suggestions.push({
        type: 'move',
        wineId: wine.wineId,
        wineName: wine.name,
        from: wine.currentSlot,
        to: slot.slotId,
        toZone: wine.suggestedZone,
        reason: wine.reason,
        confidence: wine.confidence,
        isOverflow: slot.isOverflow,
        priority: wine.confidence === 'high' ? 1 : wine.confidence === 'medium' ? 2 : 3
      });
      pendingMoves.set(wine.currentSlot, slot.slotId);
      allocatedTargets.add(slot.slotId); // Mark this target as allocated
    } else {
      if (!allowFallback) {
        zoneCapacityIssues.push({
          overflowingZoneId: wine.suggestedZoneId,
          wine: {
            wineId: wine.wineId,
            wineName: wine.name,
            currentSlot: wine.currentSlot
          }
        });
      }
      suggestions.push({
        type: 'manual',
        wineId: wine.wineId,
        wineName: wine.name,
        currentSlot: wine.currentSlot,
        suggestedZone: wine.suggestedZone,
        suggestedZoneId: wine.suggestedZoneId,
        reason: wine.reason,
        zoneFullReason: `The ${wine.suggestedZone} zone has no empty slots. Run AI Zone Structuring to rebalance rows across zones, or use Find Slot to search overflow areas.`,
        confidence: wine.confidence,
        priority: 3
      });
    }
  }

  const sortedSuggestions = suggestions.sort((a, b) => a.priority - b.priority);

  // Check if any moves involve swaps or dependencies (source of one move is target of another)
  const moveSuggestions = sortedSuggestions.filter(s => s.type === 'move');
  const sources = new Set(moveSuggestions.map(m => m.from));
  const targets = new Set(moveSuggestions.map(m => m.to));
  const hasSwaps = [...sources].some(s => targets.has(s));

  // Attach swap flag to the result (frontend calculates individual swap pairs)
  sortedSuggestions._hasSwaps = hasSwaps;

  // Attach zone capacity issues for alert rendering
  sortedSuggestions._zoneCapacityIssues = zoneCapacityIssues;

  return sortedSuggestions;
}

// ───────────────────────────────────────────────────────────
// Compaction move generation
// ───────────────────────────────────────────────────────────

/**
 * Generate compaction moves to fill gaps in rows.
 * Each move shifts a bottle into an empty slot to keep rows tightly packed.
 * @param {Map} slotToWine - Slot to wine mapping
 * @param {string} fillDirection - 'left' or 'right'
 * @returns {Array<Object>} Compaction move suggestions
 */
export function generateCompactionMoves(slotToWine, fillDirection = 'left') {
  const gaps = detectRowGaps(slotToWine, fillDirection);

  return gaps.map(gap => ({
    type: 'compaction',
    wineId: gap.wineId,
    wineName: gap.wineName,
    from: gap.shiftFrom,
    to: gap.gapSlot,
    reason: `Fill gap — keep row ${gap.row} packed from the ${fillDirection}`,
    confidence: 'high',
    priority: 4 // Lower priority than zone moves (1-3)
  }));
}
