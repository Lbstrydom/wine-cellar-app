/**
 * @fileoverview Bottles-first cellar analysis.
 * Iterates all wines, calls findBestZone() on each, groups by canonical zone,
 * and cross-references against physical row allocations.
 * @module services/cellar/bottleScanner
 */

import { findBestZone } from './cellarPlacement.js';
import { parseSlot } from './cellarMetrics.js';

/** Slots per row: R1 has 7, all others have 9. */
const SLOTS_PER_ROW_DEFAULT = 9;
const SLOTS_ROW_1 = 7;

/**
 * Get slot capacity for a given row ID.
 * @param {string} rowId - e.g. 'R1', 'R8'
 * @returns {number}
 */
function rowCapacity(rowId) {
  return rowId === 'R1' ? SLOTS_ROW_1 : SLOTS_PER_ROW_DEFAULT;
}

/**
 * Sort row IDs numerically (R1, R2, … R10, R19).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function rowSort(a, b) {
  return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10);
}

/**
 * Scan all wines bottles-first: classify each wine via findBestZone(), then
 * group by canonical zone and cross-reference against physical row allocations.
 *
 * @param {Array<Object>} wines - All wines with slot assignments (from DB join).
 *   Each wine should have at minimum: id, wine_name, slot_id|location_code,
 *   zone_id, colour, grapes, country, region, style.
 * @param {Object} zoneMap - Active zone map from getActiveZoneMap().
 *   Keys are row IDs (e.g. 'R3'), values have { zoneId, displayName, ... }.
 * @returns {{ groups: Array, consolidationOpportunities: Array, totalBottles: number, totalGroups: number }}
 */
export function scanBottles(wines, zoneMap) {
  // ── 1. Filter to cellar-only wines (exclude fridge) ──────────
  const cellarWines = wines.filter(w => {
    const slot = w.slot_id || w.location_code;
    return slot && slot.startsWith('R');
  });

  // ── 2. Classify every wine via findBestZone ──────────────────
  /** @type {Map<string, { zoneId: string, displayName: string, wines: Array }>} */
  const groupMap = new Map();

  for (const wine of cellarWines) {
    const bestZone = findBestZone(wine);
    const zoneId = bestZone.zoneId;

    if (!groupMap.has(zoneId)) {
      groupMap.set(zoneId, {
        zoneId,
        displayName: bestZone.displayName,
        wines: []
      });
    }

    const slotId = wine.slot_id || wine.location_code;
    const parsed = parseSlot(slotId);
    const physicalRow = parsed ? `R${parsed.row}` : null;

    // Determine whether this wine is in a row allocated to its canonical zone
    const isCorrectlyPlaced = physicalRow
      ? zoneMap[physicalRow]?.zoneId === zoneId
      : false;

    groupMap.get(zoneId).wines.push({
      wineId: wine.id,
      wineName: wine.wine_name,
      slot: slotId,
      physicalRow,
      currentZoneId: wine.zone_id || null,
      canonicalZoneId: zoneId,
      confidence: bestZone.confidence,
      score: bestZone.score,
      correctlyPlaced: isCorrectlyPlaced
    });
  }

  // ── 3. Build allocated-rows index: zone → Set<rowId> ─────────
  const zoneAllocatedRows = new Map();
  for (const [rowId, info] of Object.entries(zoneMap)) {
    if (!zoneAllocatedRows.has(info.zoneId)) {
      zoneAllocatedRows.set(info.zoneId, new Set());
    }
    zoneAllocatedRows.get(info.zoneId).add(rowId);
  }

  // ── 4. Assemble groups with cross-referenced metrics ─────────
  const groups = [];

  for (const [zoneId, data] of groupMap) {
    const bottleCount = data.wines.length;
    const correctlyPlacedCount = data.wines.filter(w => w.correctlyPlaced).length;
    const misplacedCount = bottleCount - correctlyPlacedCount;

    // Physical rows where this zone's wines actually sit
    const physicalRowSet = new Set();
    for (const w of data.wines) {
      if (w.physicalRow) physicalRowSet.add(w.physicalRow);
    }

    // Rows officially allocated to this zone
    const allocatedRowSet = zoneAllocatedRows.get(zoneId) || new Set();

    // Demand: how many standard (9-slot) rows this zone needs
    const demandRows = Math.ceil(bottleCount / SLOTS_PER_ROW_DEFAULT);

    // Deficit: compare bottle count against actual allocated capacity (R1=7, rest=9)
    const allocatedCapacity = [...allocatedRowSet].reduce(
      (sum, rowId) => sum + rowCapacity(rowId), 0
    );
    const overflow = bottleCount - allocatedCapacity;
    const rowDeficit = overflow > 0
      ? Math.ceil(overflow / SLOTS_PER_ROW_DEFAULT) // additional standard rows needed
      : demandRows - allocatedRowSet.size;           // zero or negative (surplus)

    groups.push({
      zoneId,
      displayName: data.displayName,
      wines: data.wines,
      bottleCount,
      physicalRows: [...physicalRowSet].sort(rowSort),
      allocatedRows: [...allocatedRowSet].sort(rowSort),
      correctlyPlacedCount,
      misplacedCount,
      demandRows,
      rowDeficit
    });
  }

  // Sort groups by bottle count descending for priority display
  groups.sort((a, b) => b.bottleCount - a.bottleCount);

  // ── 5. Identify consolidation opportunities ──────────────────
  // A wine group is "scattered" if its wines sit in rows NOT allocated to it
  const consolidationOpportunities = [];

  for (const group of groups) {
    const allocatedSet = new Set(group.allocatedRows);
    const scattered = group.wines.filter(
      w => w.physicalRow && !allocatedSet.has(w.physicalRow)
    );

    if (scattered.length > 0) {
      consolidationOpportunities.push({
        zoneId: group.zoneId,
        displayName: group.displayName,
        totalBottles: group.bottleCount,
        scattered: scattered.map(w => ({
          wineId: w.wineId,
          wineName: w.wineName,
          currentSlot: w.slot,
          physicalRow: w.physicalRow,
          physicalRowZone: zoneMap[w.physicalRow]?.displayName || 'unallocated'
        }))
      });
    }
  }

  // Sort by scattered count descending — worst offenders first
  consolidationOpportunities.sort((a, b) => b.scattered.length - a.scattered.length);

  return {
    groups,
    consolidationOpportunities,
    totalBottles: cellarWines.length,
    totalGroups: groups.length
  };
}
