/**
 * @fileoverview Analysis engine for cellar organisation.
 * Identifies misplaced bottles and generates move suggestions.
 * @module services/cellarAnalysis
 */

import { getZoneById } from '../config/cellarZones.js';
import { REORG_THRESHOLDS } from '../config/cellarThresholds.js';
import { findBestZone, findAvailableSlot } from './cellarPlacement.js';
import { getActiveZoneMap } from './cellarAllocation.js';

/**
 * Analyse current cellar state and identify issues.
 * @param {Array} wines - All wines with slot assignments
 * @returns {Object} Analysis report
 */
export function analyseCellar(wines) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalBottles: wines.filter(w => w.slot_id || w.location_code).length,
      zonesUsed: 0,
      correctlyPlaced: 0,
      misplacedBottles: 0,
      overflowingZones: [],
      fragmentedZones: [],
      emptyZones: [],
      unclassifiedCount: 0
    },
    zoneAnalysis: [],
    misplacedWines: [],
    suggestedMoves: [],
    alerts: []
  };

  const zoneMap = getActiveZoneMap();
  const slotToWine = new Map();

  // Build slot -> wine mapping
  wines.forEach(w => {
    const slotId = w.slot_id || w.location_code;
    if (slotId && slotId.startsWith('R')) { // Only cellar slots
      slotToWine.set(slotId, w);
    }
  });

  // Analyse each active zone
  for (const [rowId, zoneInfo] of Object.entries(zoneMap)) {
    const zone = getZoneById(zoneInfo.zoneId);
    if (!zone || zone.isBufferZone || zone.isFallbackZone) continue;

    const zoneWines = getWinesInRows([rowId], slotToWine);
    const analysis = analyseZone(zone, zoneWines, rowId);
    report.zoneAnalysis.push(analysis);

    if (analysis.misplaced.length > 0) {
      report.misplacedWines.push(...analysis.misplaced);
      report.summary.misplacedBottles += analysis.misplaced.length;
    }
    report.summary.correctlyPlaced += analysis.correctlyPlaced.length;

    if (analysis.isOverflowing) {
      report.summary.overflowingZones.push(zone.displayName);
    }
    if (analysis.fragmentationScore > REORG_THRESHOLDS.minFragmentationScore) {
      report.summary.fragmentedZones.push(zone.displayName);
    }
    report.summary.zonesUsed++;
  }

  // Check for unclassified wines
  const unclassified = wines.filter(w => w.zone_id === 'unclassified');
  report.summary.unclassifiedCount = unclassified.length;
  if (unclassified.length > 0) {
    report.alerts.push({
      type: 'unclassified_wines',
      severity: 'warning',
      message: `${unclassified.length} wine(s) are unclassified and need manual review`,
      wines: unclassified.map(w => ({ id: w.id, name: w.wine_name }))
    });
  }

  // Generate move suggestions
  report.suggestedMoves = generateMoveSuggestions(report.misplacedWines, wines, slotToWine);

  // Check if reorganisation is recommended
  const shouldReorg =
    report.summary.misplacedBottles >= REORG_THRESHOLDS.minMisplacedForReorg ||
    (report.summary.totalBottles > 0 &&
      (report.summary.misplacedBottles / report.summary.totalBottles * 100) >= REORG_THRESHOLDS.minMisplacedPercent);

  if (shouldReorg) {
    report.alerts.push({
      type: 'reorganisation_recommended',
      severity: 'info',
      message: `${report.summary.misplacedBottles} bottles could be better organised. Review suggested moves.`
    });
  }

  return report;
}

/**
 * Get wines in specified rows.
 * @param {string[]} rows - Row IDs
 * @param {Map} slotToWine - Slot to wine mapping
 * @returns {Array} Wines in those rows
 */
function getWinesInRows(rows, slotToWine) {
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

/**
 * Analyse a single zone.
 * @param {Object} zone - Zone configuration
 * @param {Array} zoneWines - Wines in the zone
 * @param {string} rowId - Row ID
 * @returns {Object} Zone analysis
 */
function analyseZone(zone, zoneWines, rowId) {
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

/**
 * Check if wine is legitimately in a buffer zone.
 * @param {Object} wine
 * @returns {boolean}
 */
function isLegitimateBufferPlacement(wine) {
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
function isCorrectlyPlaced(wine, physicalZone, bestZone) {
  if (bestZone.zoneId === physicalZone.id) return true;
  if (wine.zone_id === physicalZone.id) return true;

  const bestZoneConfig = getZoneById(bestZone.zoneId);
  if (bestZoneConfig?.overflowZoneId === physicalZone.id) return true;

  return false;
}

/**
 * Calculate fragmentation score for a zone.
 * @param {string[]} rows - Row IDs
 * @param {Array} wines - Wines in zone
 * @returns {number} Fragmentation score 0-100
 */
function calculateFragmentation(rows, wines) {
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

/**
 * Parse slot ID into row and column numbers.
 * @param {string} slotId
 * @returns {Object|null}
 */
function parseSlot(slotId) {
  if (!slotId) return null;
  const match = slotId.match(/R(\d+)C(\d+)/);
  return match ? { row: parseInt(match[1], 10), col: parseInt(match[2], 10) } : null;
}

/**
 * Generate move suggestions for misplaced wines.
 * @param {Array} misplacedWines
 * @param {Array} allWines
 * @param {Map} slotToWine
 * @returns {Array} Move suggestions
 */
function generateMoveSuggestions(misplacedWines, allWines, _slotToWine) {
  const occupiedSlots = new Set();
  allWines.forEach(w => {
    const slotId = w.slot_id || w.location_code;
    if (slotId) occupiedSlots.add(slotId);
  });

  const suggestions = [];
  const pendingMoves = new Map();

  // Sort by confidence - high confidence moves first
  const sortedMisplaced = [...misplacedWines].sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  });

  for (const wine of sortedMisplaced) {
    // Calculate currently available slots (accounting for pending moves)
    const currentlyOccupied = new Set(occupiedSlots);
    pendingMoves.forEach((toSlot, fromSlot) => {
      currentlyOccupied.delete(fromSlot);
      currentlyOccupied.add(toSlot);
    });

    const slot = findAvailableSlot(wine.suggestedZoneId, currentlyOccupied, wine);

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
    } else {
      suggestions.push({
        type: 'manual',
        wineId: wine.wineId,
        wineName: wine.name,
        currentSlot: wine.currentSlot,
        suggestedZone: wine.suggestedZone,
        reason: `${wine.reason} - zone full, manual intervention needed`,
        confidence: wine.confidence,
        priority: 3
      });
    }
  }

  return suggestions.sort((a, b) => a.priority - b.priority);
}

/**
 * Check if cellar needs AI review based on thresholds.
 * @param {Object} report - Analysis report
 * @returns {boolean}
 */
export function shouldTriggerAIReview(report) {
  const thresholds = REORG_THRESHOLDS.triggerAIReviewAfter;
  return (
    report.summary.misplacedBottles >= thresholds.misplacedCount ||
    report.summary.overflowingZones.length >= thresholds.overflowingZones ||
    report.summary.unclassifiedCount >= thresholds.unclassifiedCount
  );
}

/**
 * Get wines that should be moved to fridge (drink soon).
 * @param {Array} wines - All wines
 * @param {number} currentYear - Current year
 * @returns {Array} Fridge candidates
 */
export function getFridgeCandidates(wines, currentYear = new Date().getFullYear()) {
  return wines.filter(wine => {
    // Skip if already in fridge
    const slotId = wine.slot_id || wine.location_code;
    if (slotId && slotId.startsWith('F')) return false;

    // Check drink_until (from drinking windows)
    if (wine.drink_until && wine.drink_until <= currentYear) {
      return true;
    }

    // Check vintage age for wines that should be drunk young
    if (wine.vintage) {
      const age = currentYear - wine.vintage;

      // Light whites, rosé, simple sparkling - drink within 2-3 years
      if (wine.colour === 'white' || wine.colour === 'rose') {
        const youngStyles = ['sauvignon', 'pinot grigio', 'muscadet', 'vinho verde'];
        const isYoungStyle = youngStyles.some(s =>
          (wine.style || '').toLowerCase().includes(s) ||
          (wine.wine_name || '').toLowerCase().includes(s)
        );
        if (isYoungStyle && age >= 2) return true;
      }

      // Sparkling (non-vintage champagne)
      if (wine.colour === 'sparkling' && age >= 3) {
        return true;
      }
    }

    return false;
  }).map(wine => ({
    wineId: wine.id,
    name: wine.wine_name,
    vintage: wine.vintage,
    currentSlot: wine.slot_id || wine.location_code,
    reason: wine.drink_until
      ? `Drink by ${wine.drink_until} - past optimal window`
      : `${wine.colour} wine from ${wine.vintage} - drink soon`
  }));
}
