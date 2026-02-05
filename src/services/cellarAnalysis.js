/**
 * @fileoverview Orchestrator for cellar analysis.
 * Delegates to cellarMetrics, cellarNarratives, cellarSuggestions, and
 * drinkingStrategy, then re-exports their public API so that existing
 * consumers can continue to import from this single module.
 * @module services/cellarAnalysis
 */

import { getZoneById } from '../config/cellarZones.js';
import { REORG_THRESHOLDS } from '../config/cellarThresholds.js';
import { findBestZone } from './cellarPlacement.js';
import { getActiveZoneMap } from './cellarAllocation.js';

// Sub-modules ───────────────────────────────────────────────
import { parseSlot, analyseZone, getWinesInRows } from './cellarMetrics.js';
import { generateZoneNarratives, shouldTriggerAIReview } from './cellarNarratives.js';
import {
  generateMoveSuggestions,
  buildZoneCapacityAlerts
} from './cellarSuggestions.js';
import { getEffectiveDrinkByYear, getFridgeCandidates } from './drinkingStrategy.js';

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
  const { allowFallback = false } = options;

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

  const zoneMap = await getActiveZoneMap();
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
  const suggestedMoves = await generateMoveSuggestions(report.misplacedWines, wines, slotToWine, { allowFallback });
  report.suggestedMoves = suggestedMoves;
  report.movesHaveSwaps = suggestedMoves._hasSwaps || false;

  // Attach zone capacity issues (if any)
  const zoneCapacityIssues = suggestedMoves._zoneCapacityIssues || [];
  report.zoneCapacityIssues = zoneCapacityIssues;

  const capacityAlerts = await buildZoneCapacityAlerts(zoneCapacityIssues, report.needsZoneSetup, allowFallback);
  report.alerts.unshift(...capacityAlerts);

  // Check if reorganisation is recommended
  const shouldReorg =
    report.summary.misplacedBottles >= REORG_THRESHOLDS.minMisplacedForReorg ||
    (report.summary.totalBottles > 0 &&
      (report.summary.misplacedBottles / report.summary.totalBottles * 100) >= REORG_THRESHOLDS.minMisplacedPercent);

  if (shouldReorg && hasZoneAllocations) {
    report.alerts.push({
      type: 'reorganisation_recommended',
      severity: 'info',
      message: `${report.summary.misplacedBottles} bottles could be better organised. Review suggested moves.`
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
    message: `Cellar zones not configured. Click "Get AI Advice" to have AI propose a zone structure for your ${cellarBottleCount} bottles.`
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
export { getEffectiveDrinkByYear, getFridgeCandidates } from './drinkingStrategy.js';
