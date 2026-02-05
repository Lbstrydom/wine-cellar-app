/**
 * @fileoverview Zone-level metrics: analysis, fragmentation, and placement checks.
 * Extracted from cellarAnalysis.js to keep each module under 300 lines.
 * @module services/cellarMetrics
 */

import { getZoneById } from '../config/cellarZones.js';
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
