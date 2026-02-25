/**
 * @fileoverview Zone narrative generation, health reporting, and drift detection.
 * Extracted from cellarAnalysis.js to keep each module under 300 lines.
 * @module services/cellar/cellarNarratives
 */

import { REORG_THRESHOLDS } from '../../config/cellarThresholds.js';
import { getZoneWithIntent } from '../zone/zoneMetadata.js';
import { calculateFragmentation } from './cellarMetrics.js';
import { getRowCapacity } from './slotUtils.js';

// ───────────────────────────────────────────────────────────
// Zone composition
// ───────────────────────────────────────────────────────────

/**
 * Get composition stats for wines in a zone.
 * @param {Array} wines - Wines in zone
 * @returns {Object} Composition stats
 */
export function getZoneComposition(wines) {
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

// ───────────────────────────────────────────────────────────
// Zone health
// ───────────────────────────────────────────────────────────

/**
 * Determine zone health status.
 * @param {number} count - Current bottle count
 * @param {number} capacity - Zone capacity
 * @param {number} fragmentationScore - Fragmentation score
 * @returns {string} Status: 'healthy', 'crowded', 'sparse', 'fragmented'
 */
export function getZoneHealthStatus(count, capacity, fragmentationScore) {
  const utilizationPercent = (count / capacity) * 100;

  if (utilizationPercent > 95) return 'crowded';
  if (utilizationPercent < 20 && count > 0) return 'sparse';
  if (fragmentationScore > REORG_THRESHOLDS.minFragmentationScore) return 'fragmented';
  return 'healthy';
}

// ───────────────────────────────────────────────────────────
// Drift detection
// ───────────────────────────────────────────────────────────

/**
 * Detect if zone contents have drifted from intent.
 * @param {Object} zone - Zone config
 * @param {Array} wines - Wines in zone
 * @param {Object|null} _intent - Zone intent from database (reserved for future use)
 * @returns {Object|null} Drift analysis or null if no drift
 */
export function detectZoneDrift(zone, wines, _intent) {
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

// ───────────────────────────────────────────────────────────
// Zone narrative generation
// ───────────────────────────────────────────────────────────

/**
 * Generate zone narratives with composition and health info.
 * @param {Map} zoneWineMap - Map of zone ID to { zone, rows, wines }
 * @returns {Array} Zone narratives
 */
export function generateZoneNarratives(zoneWineMap) {
  const narratives = [];

  for (const [zoneId, data] of zoneWineMap) {
    const { zone, rows, wines } = data;

    // Skip empty zones and fallback zones; include buffer zones if they have wines
    if (wines.length === 0 || zone.isFallbackZone) continue;

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

    // Calculate capacity (R1 has 7 slots, others have 9)
    const capacity = rows.reduce((sum, r) => sum + (getRowCapacity(r) || 9), 0);
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

// ───────────────────────────────────────────────────────────
// AI review trigger
// ───────────────────────────────────────────────────────────

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
