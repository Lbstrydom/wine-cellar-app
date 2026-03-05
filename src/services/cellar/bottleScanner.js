/**
 * @fileoverview Bottles-first cellar analysis.
 * Iterates all wines, calls findBestZone() on each, groups by canonical zone,
 * and cross-references against physical row allocations.
 * @module services/cellar/bottleScanner
 */

import { findBestZone, inferColour } from './cellarPlacement.js';
import { parseSlot, getRowCapacity } from './slotUtils.js';
import { getZoneById } from '../../config/cellarZones.js';
import { isWhiteFamily } from '../shared/cellarLayoutSettings.js';

/**
 * Check whether a wine's physical row is a valid overflow destination for its
 * canonical zone AND that canonical zone has no allocated rows (under-threshold).
 *
 * Two paths qualify as valid overflow:
 * (a) Direct chain: canonicalZone.overflowZoneId === physicalRowZoneId
 *     (matches cellarMetrics.js:384 pattern)
 * (b) Colour-compatible buffer/fallback: the row's zone is a buffer or fallback
 *     zone whose colour accepts the wine. Covers curated zones (e.g. Curiosities,
 *     colour: null) whose wines are placed in colour-appropriate buffers by the
 *     layout proposer rather than their overflowZoneId chain.
 *
 * Both paths require the canonical zone to have zero allocated rows (under-
 * threshold), preserving tidy-up opportunities when the zone has capacity.
 *
 * @param {string} physicalRow - Row ID e.g. 'R3'
 * @param {string} canonicalZoneId - Wine's canonical zone from findBestZone
 * @param {Object} zoneMap - Active zone map (rowId → { zoneId, ... })
 * @param {Object} wine - Wine object (colour/grapes used for buffer compatibility)
 * @returns {boolean}
 */
function isInValidOverflow(physicalRow, canonicalZoneId, zoneMap, wine) {
  const rowZoneId = zoneMap[physicalRow]?.zoneId;
  if (!rowZoneId) return false;

  const canonicalZone = getZoneById(canonicalZoneId);
  if (!canonicalZone) return false;

  // Only valid if canonical zone has zero allocated rows (under-threshold)
  const hasAllocatedRows = Object.values(zoneMap).some(
    info => info.zoneId === canonicalZoneId
  );
  if (hasAllocatedRows) return false;

  // (a) Direct overflow chain match
  if (canonicalZone.overflowZoneId === rowZoneId) return true;

  // (b) Colour-compatible buffer/fallback zone
  const rowZone = getZoneById(rowZoneId);
  if (!rowZone?.isBufferZone && !rowZone?.isFallbackZone) return false;

  // Fallback zone (e.g. unclassified, colour: null) accepts any wine
  if (!rowZone.colour) return true;

  // Buffer zone: wine's colour family must match the buffer's accepted colours
  const wineColour = wineColourFamily(wine);
  if (!wineColour) return true; // Can't determine colour → don't penalise

  const bufferColours = Array.isArray(rowZone.colour) ? rowZone.colour : [rowZone.colour];
  if (wineColour === 'white' && bufferColours.some(c => isWhiteFamily(c))) return true;
  if (wineColour === 'red' && bufferColours.some(c => c.toLowerCase() === 'red')) return true;

  return false;
}

/**
 * Get slot capacity for a given row ID.
 * Delegates to the shared getRowCapacity utility (legacy 7/9 fallback).
 * @param {string} rowId - e.g. 'R1', 'R8'
 * @returns {number}
 */
function rowCapacity(rowId) {
  return getRowCapacity(rowId, []);
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

    // Determine whether this wine is in a row allocated to its canonical zone,
    // or in a valid overflow zone when its canonical zone has no dedicated rows
    const isCorrectlyPlaced = physicalRow
      ? (zoneMap[physicalRow]?.zoneId === zoneId || isInValidOverflow(physicalRow, zoneId, zoneMap, wine))
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
    const demandRows = Math.ceil(bottleCount / 9);

    // Deficit: compare bottle count against actual allocated capacity (R1=7, rest=9)
    const allocatedCapacity = [...allocatedRowSet].reduce(
      (sum, rowId) => sum + rowCapacity(rowId), 0
    );
    const overflow = bottleCount - allocatedCapacity;
    const rowDeficit = overflow > 0
      ? Math.ceil(overflow / 9) // additional standard rows needed
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
  // A wine is "scattered" if it has a physical row but isn't correctly placed
  // (i.e. not in its canonical zone's rows and not in a valid overflow destination)
  const consolidationOpportunities = [];

  for (const group of groups) {
    const scattered = group.wines.filter(
      w => w.physicalRow && !w.correctlyPlaced
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

/** Score delta above which a same-colour misplacement is flagged as moderate. */
const MODERATE_SCORE_DELTA = 40;

/**
 * Severity sort order: critical before moderate.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function severitySort(a, b) {
  const order = { critical: 0, moderate: 1 };
  return (order[a] ?? 2) - (order[b] ?? 2);
}

/**
 * Determine the effective colour family of a zone.
 * @param {Object} zone - Zone config object from cellarZones
 * @returns {'red'|'white'|null}
 */
function zoneColourFamily(zone) {
  if (!zone) return null;
  const colour = zone.colour;
  if (Array.isArray(colour)) {
    const allWhite = colour.every(c => isWhiteFamily(c));
    const allRed = colour.every(c => c.toLowerCase() === 'red');
    if (allWhite) return 'white';
    if (allRed) return 'red';
    return null; // mixed-colour zone — no single family
  }
  if (isWhiteFamily(colour)) return 'white';
  if (colour === 'red') return 'red';
  return null;
}

/**
 * Determine the colour family of a wine.
 * @param {Object} wine - Wine object
 * @returns {'red'|'white'|null}
 */
function wineColourFamily(wine) {
  const colour = (wine.colour || inferColour(wine) || '').toLowerCase();
  if (!colour) return null;
  if (isWhiteFamily(colour)) return 'white';
  if (colour === 'red') return 'red';
  return null;
}

/**
 * Sweep every occupied slot in allocated rows, comparing each wine's best zone
 * against the row's assigned zone. Grades violations by severity.
 *
 * @param {Map<string, Object>} slotToWine - Slot ID → wine object mapping.
 * @param {Object} zoneMap - Active zone map from getActiveZoneMap().
 *   Keys are row IDs (e.g. 'R3'), values have { zoneId, displayName, ... }.
 * @returns {Array<Object>} Violations sorted by severity (critical first) then score delta descending.
 */
export function rowCleanlinessSweep(slotToWine, zoneMap) {
  const violations = [];

  for (const [rowId, rowZoneInfo] of Object.entries(zoneMap)) {
    const rowZone = getZoneById(rowZoneInfo.zoneId);
    const rowZoneColour = zoneColourFamily(rowZone);
    const rowNum = parseInt(rowId.slice(1), 10);
    const maxCol = rowCapacity(rowId);

    for (let col = 1; col <= maxCol; col++) {
      const slotId = `R${rowNum}C${col}`;
      const wine = slotToWine.get(slotId);
      if (!wine) continue; // empty slot

      const bestZone = findBestZone(wine);

      // Wine already belongs in this row's zone — no violation
      if (bestZone.zoneId === rowZoneInfo.zoneId) continue;

      // Wine in a valid overflow destination — not a violation
      if (isInValidOverflow(rowId, bestZone.zoneId, zoneMap, wine)) continue;

      // Determine severity
      const wineColour = wineColourFamily(wine);
      const rowZoneScore = bestZone.alternativeZones?.find(
        az => az.zoneId === rowZoneInfo.zoneId
      )?.score ?? 0;
      const scoreDelta = bestZone.score - rowZoneScore;
      let severity;

      if (rowZoneColour && wineColour && rowZoneColour !== wineColour) {
        // Colour family mismatch: red wine in white zone or vice versa
        severity = 'critical';
      } else {
        // Same colour family — check score delta
        if (scoreDelta >= MODERATE_SCORE_DELTA) {
          severity = 'moderate';
        } else {
          continue; // below threshold — not a meaningful violation
        }
      }

      violations.push({
        wineId: wine.id,
        wineName: wine.wine_name,
        slot: slotId,
        physicalRow: rowId,
        rowZoneId: rowZoneInfo.zoneId,
        rowZoneName: rowZoneInfo.displayName,
        bestZoneId: bestZone.zoneId,
        bestZoneName: bestZone.displayName,
        bestScore: bestZone.score,
        rowZoneScore,
        scoreDelta,
        confidence: bestZone.confidence,
        severity,
        reason: severity === 'critical'
          ? `Colour violation: ${wineColour} wine in ${rowZoneColour} zone (${rowZoneInfo.displayName})`
          : `Better fit: ${bestZone.displayName} (score ${bestZone.score}) vs ${rowZoneInfo.displayName} (score ${rowZoneScore}), delta ${scoreDelta}`
      });
    }
  }

  // Sort by severity (critical first), then by score delta descending.
  // Larger deltas indicate stronger "this bottle is in the wrong row" signals.
  violations.sort((a, b) => {
    const sev = severitySort(a.severity, b.severity);
    if (sev !== 0) return sev;
    const deltaDiff = (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0);
    if (deltaDiff !== 0) return deltaDiff;
    return b.bestScore - a.bestScore;
  });

  return violations;
}
