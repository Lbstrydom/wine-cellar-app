/**
 * @fileoverview Zone auto-discovery engine.
 * Analyses a cellar's wine collection and proposes an optimal set of zones
 * based on actual bottle distribution and classification confidence.
 *
 * Pipeline:
 *   1. Classify all wines via findBestZone()
 *   2. Aggregate: bottles per zone + confidence distribution
 *   3. Filter zones below minBottlesPerZone threshold → merge candidates
 *   4. Merge small zones into parent buffer zones (colour-scoped)
 *   5. Call proposeZoneLayout() for row allocation
 *   6. Return full proposal with mergedZones + confidenceSummary
 *
 * @module services/zone/zoneAutoDiscovery
 */

import db from '../../db/index.js';
import { CELLAR_ZONES, getZoneById } from '../../config/cellarZones.js';
import { findBestZone } from '../cellar/cellarPlacement.js';
import { proposeZoneLayout } from './zoneLayoutProposal.js';
import { isWhiteFamily } from '../shared/cellarLayoutSettings.js';

/** Minimum bottles in a zone before it earns a dedicated row. */
const DEFAULT_MIN_BOTTLES = 5;

/**
 * Determine the colour family of a zone: 'white', 'red', or 'any'.
 * @param {Object} zone
 * @returns {'white'|'red'|'any'}
 */
function zoneColourFamily(zone) {
  if (!zone.colour) return 'any'; // curiosities, unclassified
  const primary = Array.isArray(zone.colour) ? zone.colour[0] : zone.colour;
  return isWhiteFamily(primary) ? 'white' : 'red';
}

/**
 * Find the buffer zone ID for a given colour family.
 * @param {'white'|'red'|'any'} family
 * @returns {string}
 */
function bufferZoneForFamily(family) {
  if (family === 'white') return 'white_buffer';
  if (family === 'red') return 'red_buffer';
  return 'unclassified';
}

/**
 * Analyse a cellar's collection and propose an optimal set of active zones.
 *
 * @param {string} cellarId - Cellar to analyse
 * @param {Object} [options]
 * @param {number} [options.minBottlesPerZone=5] - Threshold for zone creation
 * @returns {Promise<ZoneDiscoveryResult>}
 *
 * @typedef {Object} ZoneDiscoveryResult
 * @property {Object[]} proposals           - Zones with row assignments (from proposeZoneLayout)
 * @property {Object[]} underThresholdZones - Zones below threshold, kept in buffer
 * @property {Object[]} mergedZones         - Merge log: which zones folded into which buffer
 * @property {Object[]} unassignedRows      - Spare rows after allocation
 * @property {Object}   confidenceSummary   - { high, medium, low, total } wine counts
 * @property {number}   totalBottles        - Total classified bottles
 * @property {string}   timestamp
 */
export async function proposeZones(cellarId, options = {}) {
  const minBottlesPerZone = options.minBottlesPerZone ?? DEFAULT_MIN_BOTTLES;

  // ── 1. Fetch all cellar wines with slot assignments ─────────
  const wines = await db.prepare(`
    SELECT
      w.id, w.wine_name, w.vintage, w.colour, w.country, w.grapes,
      w.style, w.region, w.appellation, w.winemaking, w.sweetness,
      w.zone_id,
      s.location_code
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id AND s.cellar_id = ?
    WHERE w.cellar_id = ?
      AND s.location_code IS NOT NULL
      AND s.location_code LIKE 'R%'
  `).all(cellarId, cellarId);

  // ── 2. Classify each wine + aggregate per zone ──────────────
  /**
   * @type {Map<string, { count: number, wines: Object[], confidenceCounts: {high:number,medium:number,low:number} }>}
   */
  const zoneAgg = new Map();

  // Initialise all known zones
  CELLAR_ZONES.zones.forEach(z => {
    zoneAgg.set(z.id, { count: 0, wines: [], confidenceCounts: { high: 0, medium: 0, low: 0 } });
  });

  const confidenceSummary = { high: 0, medium: 0, low: 0, total: wines.length };

  for (const wine of wines) {
    const result = findBestZone(wine);
    const zoneId = result.zoneId;
    const conf = result.confidence || 'low'; // 'high' | 'medium' | 'low'

    confidenceSummary[conf] = (confidenceSummary[conf] || 0) + 1;

    if (!zoneAgg.has(zoneId)) {
      // Shouldn't happen (zones initialised above) but guard anyway
      zoneAgg.set(zoneId, { count: 0, wines: [], confidenceCounts: { high: 0, medium: 0, low: 0 } });
    }
    const entry = zoneAgg.get(zoneId);
    entry.count++;
    entry.wines.push(wine);
    entry.confidenceCounts[conf] = (entry.confidenceCounts[conf] || 0) + 1;
  }

  // ── 3. Separate active zones from merge candidates ──────────
  const mergedZones = []; // Log of merges performed

  // Buffer and fallback zones are never candidates; they receive merged wines
  const skipZoneIds = new Set(
    CELLAR_ZONES.zones
      .filter(z => z.isBufferZone || z.isFallbackZone)
      .map(z => z.id)
  );

  for (const [zoneId, entry] of zoneAgg) {
    if (skipZoneIds.has(zoneId)) continue;
    if (entry.count === 0) continue;
    if (entry.count >= minBottlesPerZone) continue;

    // ── 4. Merge into colour-appropriate buffer zone ─────────
    const zone = getZoneById(zoneId);
    const family = zone ? zoneColourFamily(zone) : 'any';
    const targetBufferId = bufferZoneForFamily(family);

    const bufferEntry = zoneAgg.get(targetBufferId);
    if (bufferEntry) {
      bufferEntry.count += entry.count;
      bufferEntry.wines.push(...entry.wines);
      bufferEntry.confidenceCounts.high += entry.confidenceCounts.high;
      bufferEntry.confidenceCounts.medium += entry.confidenceCounts.medium;
      bufferEntry.confidenceCounts.low += entry.confidenceCounts.low;
    }

    mergedZones.push({
      zoneId,
      displayName: zone?.displayName || zoneId,
      bottleCount: entry.count,
      mergedInto: targetBufferId,
      mergedIntoDisplayName: getZoneById(targetBufferId)?.displayName || targetBufferId,
      reason: `Only ${entry.count} bottle(s) — needs ${minBottlesPerZone} to justify a dedicated section`
    });

    // Remove from aggregation so proposeZoneLayout skips it
    entry.count = 0;
    entry.wines = [];
  }

  // ── 5. Delegate row allocation to existing engine ───────────
  // proposeZoneLayout classifies wines independently using its own query;
  // we call it here for row allocation and augment its result with our metadata.
  const layoutProposal = await proposeZoneLayout(cellarId);

  // ── 6. Annotate proposals with confidence data ───────────────
  const annotatedProposals = layoutProposal.proposals.map(p => {
    const agg = zoneAgg.get(p.zoneId);
    return {
      ...p,
      confidenceCounts: agg?.confidenceCounts || { high: 0, medium: 0, low: 0 }
    };
  });

  // ── 7. Annotate underThresholdZones with merge info ──────────
  const mergedZoneIds = new Set(mergedZones.map(m => m.zoneId));
  const underThreshold = layoutProposal.underThresholdZones.map(utz => {
    const mergeLog = mergedZones.find(m => m.zoneId === utz.zoneId);
    return {
      ...utz,
      mergedInto: mergeLog?.mergedInto,
      mergedIntoDisplayName: mergeLog?.mergedIntoDisplayName
    };
  });
  // Add any zones we merged that proposeZoneLayout didn't mention
  for (const m of mergedZones) {
    if (!underThreshold.find(u => u.zoneId === m.zoneId)) {
      underThreshold.push({
        zoneId: m.zoneId,
        displayName: m.displayName,
        bottleCount: m.bottleCount,
        reason: m.reason,
        mergedInto: m.mergedInto,
        mergedIntoDisplayName: m.mergedIntoDisplayName
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalBottles: layoutProposal.totalBottles,
    proposals: annotatedProposals,
    underThresholdZones: underThreshold,
    mergedZones,
    unassignedRows: layoutProposal.unassignedRows,
    confidenceSummary,
    minBottlesPerZone
  };
}
