/**
 * @fileoverview Analysis engine for cellar organisation.
 * Identifies misplaced bottles and generates move suggestions.
 * @module services/cellarAnalysis
 */

import { getZoneById } from '../config/cellarZones.js';
import { REORG_THRESHOLDS } from '../config/cellarThresholds.js';
import { findBestZone, findAvailableSlot } from './cellarPlacement.js';
import { getActiveZoneMap } from './cellarAllocation.js';
import { getZoneWithIntent } from './zoneMetadata.js';

/**
 * Analyse current cellar state and identify issues.
 * @param {Array} wines - All wines with slot assignments
 * @returns {Promise<Object>} Analysis report
 */
export async function analyseCellar(wines) {
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
    // No zones configured but we have bottles - show setup prompt
    report.needsZoneSetup = true;
    report.alerts.push({
      type: 'zones_not_configured',
      severity: 'warning',
      message: `Cellar zones not configured. Click "Get AI Advice" to have AI propose a zone structure for your ${cellarBottleCount} bottles.`
    });

    // Still generate zone narratives based on what wines WOULD go where
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
  } else if (hasZoneAllocations) {
    // Zones are configured - analyse as normal
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
  const moveSuggestions = await generateMoveSuggestions(report.misplacedWines, wines, slotToWine);
  report.suggestedMoves = moveSuggestions;

  // DEBUG: Include debug info in report (temporary)
  if (moveSuggestions._debug) {
    report._debug = moveSuggestions._debug;
  }

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
 * @returns {Promise<Array>} Move suggestions
 */
async function generateMoveSuggestions(misplacedWines, allWines, _slotToWine) {
  const occupiedSlots = new Set();
  allWines.forEach(w => {
    const slotId = w.slot_id || w.location_code;
    if (slotId) occupiedSlots.add(slotId);
  });

  // DEBUG: Track R15 slots for debugging
  const debugR15Initial = Array.from(occupiedSlots).filter(s => s.startsWith('R15')).sort();
  const debugInfo = { r15Initial: debugR15Initial, moves: [], allMoves: [] };

  const suggestions = [];
  const pendingMoves = new Map();
  
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

  for (const wine of sortedMisplaced) {
    // Calculate currently available slots (accounting for pending moves AND allocated targets)
    const currentlyOccupied = new Set(occupiedSlots);
    pendingMoves.forEach((toSlot, fromSlot) => {
      currentlyOccupied.delete(fromSlot);
      currentlyOccupied.add(toSlot);
    });
    
    // Add already-allocated targets to the occupied set
    allocatedTargets.forEach(target => currentlyOccupied.add(target));

    const slot = await findAvailableSlot(wine.suggestedZoneId, currentlyOccupied, wine);

    // DEBUG: Track ALL moves processing order
    const r15InCurrent = Array.from(currentlyOccupied).filter(s => s.startsWith('R15')).sort();
    debugInfo.allMoves.push({
      wine: wine.name,
      conf: wine.confidence,
      from: wine.currentSlot,
      to: slot?.slotId || 'NONE',
      r15: r15InCurrent
    });

    // Also track just R15-targeting moves
    if (wine.suggestedZoneId === 'appassimento' && slot?.slotId?.startsWith('R15')) {
      debugInfo.moves.push({
        wine: wine.name,
        from: wine.currentSlot,
        to: slot?.slotId,
        r15OccupiedAtTime: r15InCurrent
      });
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

  const sortedSuggestions = suggestions.sort((a, b) => a.priority - b.priority);

  // Attach debug info to return value (temporary for debugging)
  sortedSuggestions._debug = debugInfo;

  return sortedSuggestions;
}

/**
 * Generate zone narratives with composition and health info.
 * @param {Map} zoneWineMap - Map of zone ID to { zone, rows, wines }
 * @returns {Array} Zone narratives
 */
function generateZoneNarratives(zoneWineMap) {
  const narratives = [];

  for (const [zoneId, data] of zoneWineMap) {
    const { zone, rows, wines } = data;

    // Skip empty zones and buffer/fallback zones
    if (wines.length === 0 || zone.isBufferZone || zone.isFallbackZone) continue;

    // Get intent from database
    let intent = null;
    try {
      const zoneWithIntent = getZoneWithIntent(zoneId);
      intent = zoneWithIntent?.intent || null;
    } catch {
      // Zone metadata table may not exist yet
    }

    // Calculate composition
    const composition = getZoneComposition(wines);

    // Calculate capacity (9 slots per row)
    const capacity = rows.length * 9;
    const utilizationPercent = Math.round((wines.length / capacity) * 100);

    // Calculate fragmentation
    const fragmentationScore = calculateFragmentation(rows, wines);

    // Determine health status
    const status = getZoneHealthStatus(wines.length, capacity, fragmentationScore);

    narratives.push({
      zoneId,
      displayName: zone.displayName,
      intent,
      rows,
      currentComposition: composition,
      health: {
        utilizationPercent,
        fragmentationScore,
        bottleCount: wines.length,
        capacity,
        status
      },
      drift: detectZoneDrift(zone, wines, intent)
    });
  }

  return narratives;
}

/**
 * Get composition stats for wines in a zone.
 * @param {Array} wines - Wines in zone
 * @returns {Object} Composition stats
 */
function getZoneComposition(wines) {
  const grapeCounts = {};
  const countryCounts = {};
  const vintages = [];

  for (const wine of wines) {
    // Count grapes
    const grapes = (wine.grapes || '').toLowerCase().split(/[,;]/);
    for (const grape of grapes) {
      const g = grape.trim();
      if (g) grapeCounts[g] = (grapeCounts[g] || 0) + 1;
    }

    // Count countries
    const country = wine.country || 'Unknown';
    countryCounts[country] = (countryCounts[country] || 0) + 1;

    // Track vintages
    if (wine.vintage) vintages.push(wine.vintage);
  }

  // Sort and get top items
  const topGrapes = Object.entries(grapeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const vintageRange = vintages.length > 0
    ? [Math.min(...vintages), Math.max(...vintages)]
    : null;

  return {
    topGrapes,
    topCountries,
    vintageRange,
    bottleCount: wines.length
  };
}

/**
 * Determine zone health status.
 * @param {number} count - Current bottle count
 * @param {number} capacity - Zone capacity
 * @param {number} fragmentationScore - Fragmentation score
 * @returns {string} Status: 'healthy', 'crowded', 'sparse', 'fragmented'
 */
function getZoneHealthStatus(count, capacity, fragmentationScore) {
  const utilizationPercent = (count / capacity) * 100;

  if (utilizationPercent > 95) return 'crowded';
  if (utilizationPercent < 20 && count > 0) return 'sparse';
  if (fragmentationScore > REORG_THRESHOLDS.minFragmentationScore) return 'fragmented';
  return 'healthy';
}

/**
 * Detect if zone contents have drifted from intent.
 * @param {Object} zone - Zone config
 * @param {Array} wines - Wines in zone
 * @param {Object|null} intent - Zone intent from database
 * @returns {Object|null} Drift analysis or null if no drift
 */
function detectZoneDrift(zone, wines, _intent) {
  if (!zone.rules || !wines.length) return null;

  const drift = {
    hasDrift: false,
    issues: [],
    unexpectedItems: []
  };

  // Check for wines with wrong colour
  if (zone.color) {
    const expectedColours = Array.isArray(zone.color) ? zone.color : [zone.color];
    const wrongColour = wines.filter(w =>
      w.colour && !expectedColours.includes(w.colour.toLowerCase())
    );
    if (wrongColour.length > 0) {
      drift.hasDrift = true;
      drift.issues.push(`${wrongColour.length} wine(s) with unexpected colour`);
      drift.unexpectedItems.push(...wrongColour.map(w => ({
        wineId: w.id,
        name: w.wine_name,
        issue: `colour ${w.colour} not in ${expectedColours.join(', ')}`
      })));
    }
  }

  // Check for wines from unexpected countries (if zone has country rules)
  if (zone.rules.countries && zone.rules.countries.length > 0) {
    const expectedCountries = zone.rules.countries.map(c => c.toLowerCase());
    const wrongCountry = wines.filter(w =>
      w.country && !expectedCountries.includes(w.country.toLowerCase())
    );
    if (wrongCountry.length > wines.length / 2) { // More than half from other countries
      drift.hasDrift = true;
      drift.issues.push(`Majority of wines from outside expected countries`);
    }
  }

  return drift.hasDrift ? drift : null;
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
 * Get effective drink-by year from either drinking_windows or wines table.
 * @param {Object} wine - Wine object with drink_by_year and/or drink_until
 * @returns {number|null} The effective drink-by year
 */
export function getEffectiveDrinkByYear(wine) {
  // Prefer drink_by_year from drinking_windows table (more accurate)
  if (wine.drink_by_year) return wine.drink_by_year;
  // Fall back to drink_until from wines table
  if (wine.drink_until) return wine.drink_until;
  return null;
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

    // Check drink_by_year (from drinking_windows) or drink_until (from wines)
    const drinkByYear = getEffectiveDrinkByYear(wine);
    if (drinkByYear && drinkByYear <= currentYear) {
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
  }).map(wine => {
    const drinkByYear = getEffectiveDrinkByYear(wine);
    return {
      wineId: wine.id,
      name: wine.wine_name,
      vintage: wine.vintage,
      currentSlot: wine.slot_id || wine.location_code,
      drinkByYear,
      reason: drinkByYear
        ? `Drink by ${drinkByYear} - past optimal window`
        : `${wine.colour} wine from ${wine.vintage} - drink soon`
    };
  });
}
