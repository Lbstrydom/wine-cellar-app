/**
 * @fileoverview Zone-level metrics: analysis, fragmentation, and placement checks.
 * Extracted from cellarAnalysis.js to keep each module under 300 lines.
 * @module services/cellar/cellarMetrics
 */

import { getZoneById } from '../../config/cellarZones.js';
import { findBestZone } from './cellarPlacement.js';

// ───────────────────────────────────────────────────────────
// Slot parsing
// ───────────────────────────────────────────────────────────

/**
 * Parse slot ID into row and column numbers.
 * @param {string} slotId - e.g. "R3C7"
 * @returns {{row: number, col: number}|null}
 */
export function parseSlot(slotId) {
  if (!slotId) return null;
  const match = slotId.match(/R(\d+)C(\d+)/);
  return match ? { row: parseInt(match[1], 10), col: parseInt(match[2], 10) } : null;
}

// ───────────────────────────────────────────────────────────
// Fragmentation
// ───────────────────────────────────────────────────────────

/**
 * Calculate fragmentation score for a zone.
 * @param {string[]} rows - Row IDs (e.g. ["R3"])
 * @param {Array} wines - Wines in zone
 * @returns {number} Fragmentation score 0-100
 */
export function calculateFragmentation(rows, wines) {
  if (wines.length <= 1) return 0;

  const slots = wines
    .map(w => parseSlot(w.slot_id || w.location_code))
    .filter(s => s !== null)
    .sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);

  if (slots.length <= 1) return 0;

  let gaps = 0;
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1];
    const curr = slots[i];

    if (prev.row === curr.row) {
      gaps += (curr.col - prev.col - 1);
    } else {
      gaps += (9 - prev.col) + (curr.col - 1);
    }
  }

  const maxPossibleGaps = (rows.length * 9) - wines.length;
  return maxPossibleGaps > 0 ? Math.round((gaps / maxPossibleGaps) * 100) : 0;
}

// ───────────────────────────────────────────────────────────
// Wine scattering detection
// ───────────────────────────────────────────────────────────

/**
 * Detect wines scattered across non-contiguous rows.
 * Identifies bottles of the same wine placed in distant rows that should be consolidated.
 * @param {Array} wines - All wines with slot assignments
 * @returns {Array} Scattered wine groups sorted by bottle count (descending)
 */
export function detectScatteredWines(wines) {
  const wineMap = new Map();

  for (const wine of wines) {
    const slotId = wine.slot_id || wine.location_code;
    if (!slotId || !slotId.startsWith('R')) continue;

    const parsed = parseSlot(slotId);
    if (!parsed) continue;

    const wineId = wine.id;
    if (!wineMap.has(wineId)) {
      wineMap.set(wineId, {
        wineId,
        wineName: wine.wine_name,
        slots: [],
        rows: new Set()
      });
    }

    const entry = wineMap.get(wineId);
    entry.slots.push(slotId);
    entry.rows.add(`R${parsed.row}`);
  }

  const scattered = [];
  for (const [, entry] of wineMap) {
    if (entry.rows.size <= 1) continue;

    const rowNums = [...entry.rows]
      .map(r => parseInt(r.slice(1), 10))
      .sort((a, b) => a - b);

    // Check if rows are contiguous (adjacent)
    const isContiguous = rowNums.every((r, i) =>
      i === 0 || r === rowNums[i - 1] + 1
    );

    if (!isContiguous) {
      scattered.push({
        wineId: entry.wineId,
        wineName: entry.wineName,
        bottleCount: entry.slots.length,
        rows: [...entry.rows].sort(),
        slots: entry.slots.sort()
      });
    }
  }

  return scattered.sort((a, b) => b.bottleCount - a.bottleCount);
}

// ───────────────────────────────────────────────────────────
// Color adjacency detection
// ───────────────────────────────────────────────────────────

/**
 * Get the effective color category for a zone (red or white-family).
 * @param {Object} zone - Zone configuration
 * @returns {'red'|'white'|'any'} Effective color
 */
export function getEffectiveZoneColor(zone) {
  if (!zone) return 'any';
  if (zone.isFallbackZone || zone.isCuratedZone) return 'any';
  const color = zone.color;
  if (Array.isArray(color)) {
    return color.includes('red') ? 'red' : 'white';
  }
  return color === 'red' ? 'red' : 'white';
}

/**
 * Detect color boundary violations where red and white zones are adjacent.
 * @param {Object} rowToZoneId - Row-to-zone mapping { R1: 'sauvignon_blanc', R8: 'cabernet', ... }
 * @returns {Array} Adjacency violation objects
 */
export function detectColorAdjacencyIssues(rowToZoneId) {
  const issues = [];

  for (let row = 1; row <= 18; row++) {
    const currentZoneId = rowToZoneId[`R${row}`];
    const nextZoneId = rowToZoneId[`R${row + 1}`];

    if (!currentZoneId || !nextZoneId || currentZoneId === nextZoneId) continue;

    const currentZone = getZoneById(currentZoneId);
    const nextZone = getZoneById(nextZoneId);
    if (!currentZone || !nextZone) continue;

    const c1 = getEffectiveZoneColor(currentZone);
    const c2 = getEffectiveZoneColor(nextZone);

    // Skip buffer/fallback/curated zones (they can be anywhere)
    if (c1 === 'any' || c2 === 'any') continue;

    if (c1 !== c2) {
      issues.push({
        row1: `R${row}`,
        zone1: currentZoneId,
        zone1Name: currentZone.displayName,
        color1: c1,
        row2: `R${row + 1}`,
        zone2: nextZoneId,
        zone2Name: nextZone.displayName,
        color2: c2
      });
    }
  }

  return issues;
}

// ───────────────────────────────────────────────────────────
// Placement helpers
// ───────────────────────────────────────────────────────────

/**
 * Check if wine is legitimately in a buffer zone.
 * @param {Object} wine
 * @returns {boolean}
 */
export function isLegitimateBufferPlacement(wine) {
  if (!wine.zone_id) return false;
  const bufferZones = ['white_buffer', 'red_buffer', 'unclassified', 'curiosities'];
  return bufferZones.includes(wine.zone_id);
}

/**
 * Check if wine is correctly placed in its current zone.
 * @param {Object} wine
 * @param {Object} physicalZone - Zone where wine physically is
 * @param {Object} bestZone - Best zone match result
 * @returns {boolean}
 */
export function isCorrectlyPlaced(wine, physicalZone, bestZone) {
  if (bestZone.zoneId === physicalZone.id) return true;
  if (wine.zone_id === physicalZone.id) return true;

  const bestZoneConfig = getZoneById(bestZone.zoneId);
  if (bestZoneConfig?.overflowZoneId === physicalZone.id) return true;

  return false;
}

// ───────────────────────────────────────────────────────────
// Row helpers
// ───────────────────────────────────────────────────────────

/**
 * Get wines in specified rows.
 * @param {string[]} rows - Row IDs (e.g. ["R3"])
 * @param {Map} slotToWine - Slot to wine mapping
 * @returns {Array} Wines in those rows
 */
export function getWinesInRows(rows, slotToWine) {
  const wines = [];
  for (const row of rows) {
    for (let col = 1; col <= 9; col++) {
      const slotId = `${row}C${col}`;
      const wine = slotToWine.get(slotId);
      if (wine) wines.push(wine);
    }
  }
  return wines;
}

// ───────────────────────────────────────────────────────────
// Zone analysis
// ───────────────────────────────────────────────────────────

/**
 * Analyse a single zone.
 * @param {Object} zone - Zone configuration
 * @param {Array} zoneWines - Wines in the zone
 * @param {string} rowId - Row ID
 * @returns {Object} Zone analysis
 */
export function analyseZone(zone, zoneWines, rowId) {
  const analysis = {
    zoneId: zone.id,
    displayName: zone.displayName,
    row: rowId,
    capacity: 9,
    currentCount: zoneWines.length,
    utilizationPercent: Math.round((zoneWines.length / 9) * 100),
    isOverflowing: zoneWines.length > 9,
    correctlyPlaced: [],
    misplaced: [],
    bufferOccupants: [],
    fragmentationScore: 0
  };

  for (const wine of zoneWines) {
    // Check if wine is legitimately placed via buffer system
    if (isLegitimateBufferPlacement(wine)) {
      analysis.bufferOccupants.push({
        wineId: wine.id,
        name: wine.wine_name,
        slot: wine.slot_id || wine.location_code,
        assignedZone: wine.zone_id
      });
      continue;
    }

    const bestZone = findBestZone(wine);

    if (isCorrectlyPlaced(wine, zone, bestZone)) {
      analysis.correctlyPlaced.push({
        wineId: wine.id,
        name: wine.wine_name,
        slot: wine.slot_id || wine.location_code,
        confidence: bestZone.confidence
      });
    } else {
      analysis.misplaced.push({
        wineId: wine.id,
        name: wine.wine_name,
        currentSlot: wine.slot_id || wine.location_code,
        currentZone: zone.displayName,
        currentZoneId: zone.id,
        suggestedZone: bestZone.displayName,
        suggestedZoneId: bestZone.zoneId,
        confidence: bestZone.confidence,
        score: bestZone.score,
        reason: bestZone.reason,
        alternatives: bestZone.alternativeZones
      });
    }
  }

  analysis.fragmentationScore = calculateFragmentation([analysis.row], zoneWines);
  return analysis;
}

// ───────────────────────────────────────────────────────────
// Row gap detection
// ───────────────────────────────────────────────────────────

/**
 * Detect gaps within rows (empty slots between or before occupied slots).
 * A "gap" is an empty slot to the left of an occupied slot (fill-from-left)
 * or to the right (fill-from-right).
 * @param {Map} slotToWine - Slot to wine mapping
 * @param {string} fillDirection - 'left' or 'right'
 * @returns {Array<{row: number, gapSlot: string, shiftFrom: string, wineId: number, wineName: string}>}
 */
export function detectRowGaps(slotToWine, fillDirection = 'left') {
  const gaps = [];

  for (let row = 1; row <= 19; row++) {
    const maxCol = row === 1 ? 7 : 9;
    const occupied = [];
    const empty = [];

    for (let col = 1; col <= maxCol; col++) {
      const slotId = `R${row}C${col}`;
      const wine = slotToWine.get(slotId);
      if (wine) {
        occupied.push({ col, slotId, wine });
      } else {
        empty.push({ col, slotId });
      }
    }

    // No gaps possible if row is empty or full
    if (occupied.length === 0 || empty.length === 0) continue;

    if (fillDirection === 'left') {
      // Bottles should be packed to the left
      // Expected: columns 1..N occupied, rest empty
      const expectedOccupied = occupied.length;
      for (const occ of occupied) {
        if (occ.col > expectedOccupied) {
          // This bottle is in a position that should be empty if packed left
          // Find the leftmost empty slot
          const targetEmpty = empty.find(e => e.col < occ.col);
          if (targetEmpty) {
            gaps.push({
              row,
              gapSlot: targetEmpty.slotId,
              shiftFrom: occ.slotId,
              wineId: occ.wine.id,
              wineName: occ.wine.wine_name
            });
            // Mark this empty slot as now "taken" and add the old slot as empty
            empty.splice(empty.indexOf(targetEmpty), 1);
            empty.push({ col: occ.col, slotId: occ.slotId });
            empty.sort((a, b) => a.col - b.col);
          }
        }
      }
    } else {
      // Bottles should be packed to the right
      // Expected: columns (maxCol-N+1)..maxCol occupied, rest empty
      const startCol = maxCol - occupied.length + 1;
      for (const occ of occupied) {
        if (occ.col < startCol) {
          // This bottle should be further right
          const targetEmpty = empty.findLast(e => e.col > occ.col);
          if (targetEmpty) {
            gaps.push({
              row,
              gapSlot: targetEmpty.slotId,
              shiftFrom: occ.slotId,
              wineId: occ.wine.id,
              wineName: occ.wine.wine_name
            });
            empty.splice(empty.indexOf(targetEmpty), 1);
            empty.push({ col: occ.col, slotId: occ.slotId });
            empty.sort((a, b) => a.col - b.col);
          }
        }
      }
    }
  }

  return gaps;
}
