/**
 * @fileoverview Orchestrator for cellar analysis.
 * Delegates to cellarMetrics, cellarNarratives, cellarSuggestions, and
 * drinkingStrategy, then re-exports their public API so that existing
 * consumers can continue to import from this single module.
 * @module services/cellar/cellarAnalysis
 */

import { getZoneById } from '../../config/cellarZones.js';
import { REORG_THRESHOLDS } from '../../config/cellarThresholds.js';
import { findBestZone, inferColor } from './cellarPlacement.js';
import { getActiveZoneMap } from './cellarAllocation.js';

// Sub-modules ───────────────────────────────────────────────
import {
  parseSlot, analyseZone, getWinesInRows,
  detectScatteredWines, detectColorAdjacencyIssues,
  detectDuplicatePlacements
} from './cellarMetrics.js';
import { generateZoneNarratives } from './cellarNarratives.js';
import {
  generateMoveSuggestions,
  buildZoneCapacityAlerts,
  getCurrentZoneAllocation,
  generateCompactionMoves
} from './cellarSuggestions.js';
import { getCellarLayoutSettings, getDynamicColourRowRanges, LAYOUT_DEFAULTS, isWhiteFamily } from '../shared/cellarLayoutSettings.js';
// Re-exported below via barrel re-exports

// ───────────────────────────────────────────────────────────
// Main orchestrator
// ───────────────────────────────────────────────────────────

/**
 * Analyse current cellar state and identify issues.
 * @param {Array} wines - All wines with slot assignments
 * @param {Object} [options]
 * @param {boolean} [options.allowFallback=false] - Allow fallback zone placement
 * @returns {Promise<Object>} Analysis report
 */
export async function analyseCellar(wines) {
  let options = arguments.length > 1 ? arguments[1] : undefined;
  if (!options) options = {};
  const { allowFallback = false, cellarId } = options;

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
    zoneNarratives: [],
    overflowAnalysis: [],
    misplacedWines: [],
    suggestedMoves: [],
    alerts: [],
    zoneCapacityIssues: [],
    needsZoneSetup: false
  };

  const zoneMap = await getActiveZoneMap(cellarId);
  const slotToWine = new Map();

  // Build slot -> wine mapping
  wines.forEach(w => {
    const slotId = w.slot_id || w.location_code;
    if (slotId && slotId.startsWith('R')) { // Only cellar slots
      slotToWine.set(slotId, w);
    }
  });

  // Track which zones have wines
  const zoneWineMap = new Map();

  // Check if we have zone allocations
  const hasZoneAllocations = Object.keys(zoneMap).length > 0;
  const cellarBottleCount = wines.filter(w => {
    const slotId = w.slot_id || w.location_code;
    return slotId && slotId.startsWith('R');
  }).length;

  if (!hasZoneAllocations && cellarBottleCount > 0) {
    buildNoZoneReport(report, wines, zoneWineMap, cellarBottleCount);
  } else if (hasZoneAllocations) {
    buildZoneAnalysis(report, zoneMap, slotToWine, zoneWineMap);
  }

  // Generate zone narratives
  report.zoneNarratives = generateZoneNarratives(zoneWineMap);

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
  const suggestedMoves = await generateMoveSuggestions(report.misplacedWines, wines, slotToWine, { allowFallback, cellarId });
  report.suggestedMoves = suggestedMoves;
  report.movesHaveSwaps = suggestedMoves._hasSwaps || false;

  // Attach zone capacity issues (if any)
  const zoneCapacityIssues = suggestedMoves._zoneCapacityIssues || [];
  report.zoneCapacityIssues = zoneCapacityIssues;

  const capacityAlerts = await buildZoneCapacityAlerts(zoneCapacityIssues, report.needsZoneSetup, allowFallback, cellarId);
  report.alerts.unshift(...capacityAlerts);

  // Generate compaction moves (fill gaps in rows)
  let layoutSettings;
  try {
    layoutSettings = await getCellarLayoutSettings(cellarId);
  } catch (err) {
    console.error('[CellarAnalysis] Failed to load layout settings, using defaults:', err.message);
    layoutSettings = { ...LAYOUT_DEFAULTS };
  }
  const compactionMoves = generateCompactionMoves(slotToWine, layoutSettings.fillDirection);
  report.compactionMoves = compactionMoves;
  report.summary.gapCount = compactionMoves.length;

  // Dynamic row allocation based on current inventory
  let dynamicRanges;
  try {
    dynamicRanges = await getDynamicColourRowRanges(cellarId, layoutSettings.colourOrder);
  } catch (err) {
    console.error('[CellarAnalysis] Failed to load dynamic row ranges, using defaults:', err.message);
    dynamicRanges = { whiteRowCount: 0, redRowCount: 0, whiteCount: 0, redCount: 0 };
  }
  report.layoutSettings = {
    colourOrder: layoutSettings.colourOrder,
    fillDirection: layoutSettings.fillDirection,
    whiteRows: dynamicRanges.whiteRowCount,
    redRows: dynamicRanges.redRowCount,
    whiteCount: dynamicRanges.whiteCount,
    redCount: dynamicRanges.redCount
  };

  if (compactionMoves.length > 0) {
    report.alerts.push({
      type: 'row_gaps',
      severity: 'info',
      message: `${compactionMoves.length} gap(s) detected in rows. Bottles can be shifted ${layoutSettings.fillDirection === 'left' ? 'left' : 'right'} to keep rows tidy.`
    });
  }

  // Detect scattered wines (same wine in non-contiguous rows)
  const scatteredWines = detectScatteredWines(wines);
  report.scatteredWines = scatteredWines;
  report.summary.scatteredWineCount = scatteredWines.length;

  if (scatteredWines.length > 0) {
    report.alerts.push({
      type: 'scattered_wines',
      severity: 'warning',
      message: `${scatteredWines.length} wine(s) have bottles scattered across non-adjacent rows and should be consolidated.`,
      data: { wines: scatteredWines.slice(0, 10) }
    });
  }

  // Detect color adjacency issues (red zones next to white zones)
  if (hasZoneAllocations) {
    const { rowToZoneId } = await getCurrentZoneAllocation(cellarId);
    const colorAdjacencyIssues = detectColorAdjacencyIssues(rowToZoneId);
    report.colorAdjacencyIssues = colorAdjacencyIssues;
    report.summary.colorAdjacencyViolations = colorAdjacencyIssues.length;

    if (colorAdjacencyIssues.length > 0) {
      const examples = colorAdjacencyIssues.slice(0, 3)
        .map(i => `${i.zone1Name} (${i.color1}) in ${i.row1} next to ${i.zone2Name} (${i.color2}) in ${i.row2}`);
      report.alerts.push({
        type: 'color_adjacency_violation',
        severity: 'warning',
        message: `${colorAdjacencyIssues.length} color boundary violation(s): ${examples.join('; ')}.`,
        data: { issues: colorAdjacencyIssues }
      });
    }
  }

  // Detect duplicate placements (same wine in more slots than bottle_count)
  const duplicatePlacements = detectDuplicatePlacements(wines);
  report.duplicatePlacements = duplicatePlacements;
  report.summary.duplicatePlacementCount = duplicatePlacements.length;

  if (duplicatePlacements.length > 0) {
    report.alerts.push({
      type: 'duplicate_placements',
      severity: 'warning',
      message: `${duplicatePlacements.length} wine(s) appear in more slots than their bottle count allows. This is a data integrity issue.`,
      data: { wines: duplicatePlacements }
    });
  }

  // Check if reorganisation is recommended
  const shouldReorg =
    report.summary.misplacedBottles >= REORG_THRESHOLDS.minMisplacedForReorg ||
    (report.summary.totalBottles > 0 &&
      (report.summary.misplacedBottles / report.summary.totalBottles * 100) >= REORG_THRESHOLDS.minMisplacedPercent) ||
    scatteredWines.length > 0 ||
    (report.colorAdjacencyIssues?.length ?? 0) > 0;

  if (shouldReorg && hasZoneAllocations) {
    const reasons = [];
    if (report.summary.misplacedBottles > 0) reasons.push(`${report.summary.misplacedBottles} misplaced`);
    if (scatteredWines.length > 0) reasons.push(`${scatteredWines.length} scattered`);
    if (report.colorAdjacencyIssues?.length > 0) reasons.push(`${report.colorAdjacencyIssues.length} color boundary issue(s)`);
    report.alerts.push({
      type: 'reorganisation_recommended',
      severity: 'info',
      message: `Reorganisation recommended: ${reasons.join(', ')}. Review suggested moves.`
    });
  }

  return report;
}

// ───────────────────────────────────────────────────────────
// Internal helpers (kept here because they only serve the
// orchestrator and are too small to warrant a separate file)
// ───────────────────────────────────────────────────────────

/**
 * Build report data when no zone allocations exist.
 * @param {Object} report - Report object (mutated)
 * @param {Array} wines - All wines
 * @param {Map} zoneWineMap - Zone wine map (mutated)
 * @param {number} cellarBottleCount - Bottles in cellar
 */
function buildNoZoneReport(report, wines, zoneWineMap, cellarBottleCount) {
  report.needsZoneSetup = true;
  report.alerts.push({
    type: 'zones_not_configured',
    severity: 'warning',
    message: `Cellar zones not configured. Tap "Setup Zones" to have AI propose a zone layout for your ${cellarBottleCount} bottles.`
  });

  const cellarWines = wines.filter(w => {
    const slotId = w.slot_id || w.location_code;
    return slotId && slotId.startsWith('R');
  });

  for (const wine of cellarWines) {
    const bestZone = findBestZone(wine);
    const zoneId = bestZone.zoneId;
    const zone = getZoneById(zoneId);

    if (!zone) continue;

    if (!zoneWineMap.has(zoneId)) {
      zoneWineMap.set(zoneId, { zone, rows: [], wines: [] });
    }
    const zoneData = zoneWineMap.get(zoneId);
    zoneData.wines.push(wine);

    const slotId = wine.slot_id || wine.location_code;
    const parsed = parseSlot(slotId);
    if (parsed) {
      const rowId = `R${parsed.row}`;
      if (!zoneData.rows.includes(rowId)) {
        zoneData.rows.push(rowId);
      }
    }
  }

  report.summary.zonesUsed = zoneWineMap.size;
}

/**
 * Build zone analysis when allocations exist.
 * @param {Object} report - Report object (mutated)
 * @param {Object} zoneMap - Active zone map
 * @param {Map} slotToWine - Slot to wine mapping
 * @param {Map} zoneWineMap - Zone wine map (mutated)
 */
function buildZoneAnalysis(report, zoneMap, slotToWine, zoneWineMap) {
  for (const [rowId, zoneInfo] of Object.entries(zoneMap)) {
    const zone = getZoneById(zoneInfo.zoneId);
    if (!zone) continue;

    const zoneWines = getWinesInRows([rowId], slotToWine);

    if (!zoneWineMap.has(zone.id)) {
      zoneWineMap.set(zone.id, { zone, rows: [], wines: [] });
    }
    const zoneData = zoneWineMap.get(zone.id);
    zoneData.rows.push(rowId);
    zoneData.wines.push(...zoneWines);

    if (zone.isBufferZone || zone.isFallbackZone) {
      if (zoneWines.length > 0) {
        // Check for colour violations even in buffer zones
        // (wineViolatesZoneColour skips buffer zones by design, so check inline)
        for (const w of zoneWines) {
          const zoneColors = Array.isArray(zone.color) ? zone.color : (zone.color ? [zone.color] : []);
          if (zoneColors.length === 0) continue; // No colour constraint → skip
          const wineColor = (w.colour || w.color || inferColor(w) || '').toLowerCase();
          if (!wineColor) continue; // Can't determine → don't penalise
          // Direct match: wine colour is one of the accepted colours
          if (zoneColors.some(c => c.toLowerCase() === wineColor)) continue;
          // Family-level check
          const allWhiteFamily = zoneColors.every(c => isWhiteFamily(c));
          const isViolation = (allWhiteFamily && wineColor === 'red') ||
            (zoneColors.every(c => c.toLowerCase() === 'red') && isWhiteFamily(wineColor));
          if (isViolation) {
            const bestZone = findBestZone(w);
            report.misplacedWines.push({
              wineId: w.id,
              name: w.wine_name,
              currentSlot: w.slot_id || w.location_code,
              currentZone: zone.displayName,
              currentZoneId: zone.id,
              suggestedZone: bestZone.displayName,
              suggestedZoneId: bestZone.zoneId,
              confidence: bestZone.confidence,
              score: bestZone.score,
              reason: `Colour violation: ${w.colour || 'unknown'} wine in ${zone.displayName}`,
              alternatives: bestZone.alternativeZones
            });
            report.summary.misplacedBottles++;
          }
        }
        report.overflowAnalysis.push({
          zoneId: zone.id,
          displayName: zone.displayName,
          row: rowId,
          bottleCount: zoneWines.length,
          isBufferZone: zone.isBufferZone,
          isFallbackZone: zone.isFallbackZone,
          wines: zoneWines.map(w => ({
            wineId: w.id,
            name: w.wine_name,
            slot: w.slot_id || w.location_code,
            assignedZone: w.zone_id
          }))
        });
      }
      continue;
    }

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
}

// ───────────────────────────────────────────────────────────
// Barrel re-exports (backward compatibility)
// ───────────────────────────────────────────────────────────

export { shouldTriggerAIReview } from './cellarNarratives.js';
export { getEffectiveDrinkByYear, getFridgeCandidates } from '../wine/drinkingStrategy.js';
