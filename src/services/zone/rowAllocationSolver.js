/**
 * @fileoverview Deterministic row allocation solver for cellar reconfiguration.
 *
 * Replaces LLM-based plan generation with a greedy best-first search algorithm
 * that solves the row allocation problem in <100ms.
 *
 * The cellar has 19 physical rows, each assigned to a wine zone. This solver:
 * 1. Identifies overflowing zones (need more rows) and underutilized zones (can donate)
 * 2. Scores candidate row donations using a multi-criteria heuristic
 * 3. Greedily selects the best donation at each step
 * 4. Fixes color boundary violations (white zones must precede red zones)
 * 5. Detects merge opportunities for very small zones
 *
 * Algorithm: Greedy best-first search with priority-based scoring
 * Complexity: O(Z² × R) where Z = zones (~25), R = rows (19)
 * Runtime: <10ms for typical cellars
 *
 * @module services/zone/rowAllocationSolver
 */

import { getZoneById } from '../../config/cellarZones.js';
import { getEffectiveZoneColor } from '../cellar/cellarMetrics.js';

const TOTAL_ROWS = 19;
const SLOTS_PER_ROW = 9;

/**
 * Solve the row allocation problem deterministically.
 *
 * @param {Object} params
 * @param {Array} params.zones - Zone metadata [{id, name, color, actualAssignedRows}]
 * @param {Object} params.utilization - Zone utilization map {zoneId: {bottleCount, rowCount, capacity, ...}}
 * @param {Array} params.overflowingZones - Zones needing more space [{zoneId, affectedCount, ...}]
 * @param {Array} params.underutilizedZones - Zones that can donate rows
 * @param {Array} params.mergeCandidates - Pre-computed merge candidates [{sourceZone, targetZone, affinity, reason}]
 * @param {Set} params.neverMerge - Zone IDs that cannot be merged
 * @param {string} params.stabilityBias - 'low'|'moderate'|'high'
 * @param {Array} params.scatteredWines - Wines scattered across rows [{wineName, bottleCount, rows}]
 * @param {Array} params.colorAdjacencyIssues - Color boundary violations
 * @param {string} [params.colourOrder='whites-top'] - 'whites-top' or 'reds-top'
 * @returns {{ actions: Array, reasoning: string }}
 */
export function solveRowAllocation(params) {
  const {
    zones,
    utilization,
    overflowingZones = [],
    underutilizedZones = [],
    mergeCandidates = [],
    neverMerge = new Set(),
    stabilityBias = 'moderate',
    scatteredWines = [],
    colorAdjacencyIssues = [],
    colourOrder = 'whites-top'
  } = params;

  // ───────────────────────────────────────────
  // Phase 1: Build mutable state
  // ───────────────────────────────────────────
  const zoneRowMap = buildZoneRowMap(zones);
  const demand = computeDemand(zones, utilization);
  const actions = [];
  const reasoningParts = [];

  // ───────────────────────────────────────────
  // Phase 2: Fix color boundary violations
  // ───────────────────────────────────────────
  const colorFixActions = fixColorBoundaryViolations(zoneRowMap, zones, neverMerge, colourOrder);
  if (colorFixActions.length > 0) {
    actions.push(...colorFixActions);
    const topLabel = colourOrder === 'reds-top' ? 'red' : 'white/rosé/sparkling';
    const bottomLabel = colourOrder === 'reds-top' ? 'white/rosé/sparkling' : 'red';
    reasoningParts.push(
      `Fixed ${colorFixActions.length} color boundary violation(s) — ` +
      `${topLabel} zones must be in lower rows and ${bottomLabel} zones in higher rows.`
    );
  }

  // ───────────────────────────────────────────
  // Phase 3: Resolve capacity deficits (greedy best-first)
  // ───────────────────────────────────────────
  const capacityActions = resolveCapacityDeficits(
    zoneRowMap, demand, utilization, zones, neverMerge, stabilityBias
  );
  if (capacityActions.length > 0) {
    actions.push(...capacityActions);
    const deficitZoneNames = [...new Set(capacityActions.map(a => a.toZoneId))];
    reasoningParts.push(
      `Reallocated ${capacityActions.length} row(s) to resolve capacity issues in: ` +
      deficitZoneNames.map(z => getZoneDisplayName(z, zones)).join(', ') + '.'
    );
  }

  // ───────────────────────────────────────────
  // Phase 4: Merge opportunities (small zones)
  // ───────────────────────────────────────────
  const maxMerges = stabilityBias === 'high' ? 1 : stabilityBias === 'moderate' ? 2 : 3;
  const mergeActions = findMergeActions(
    zoneRowMap, demand, utilization, mergeCandidates, neverMerge, maxMerges
  );
  if (mergeActions.length > 0) {
    actions.push(...mergeActions);
    reasoningParts.push(
      `Suggested ${mergeActions.length} zone merge(s) to consolidate underutilized zones.`
    );
  }

  // ───────────────────────────────────────────
  // Phase 5: Scattered wine consolidation
  // ───────────────────────────────────────────
  const scatterActions = consolidateScatteredWines(
    zoneRowMap, scatteredWines, zones, neverMerge, stabilityBias
  );
  if (scatterActions.length > 0) {
    actions.push(...scatterActions);
    reasoningParts.push(
      `Reallocated ${scatterActions.length} row(s) to reduce wine scattering.`
    );
  }

  // ───────────────────────────────────────────
  // Phase 6: Apply stability limits
  // ───────────────────────────────────────────
  const maxActions = stabilityBias === 'high' ? 3 : stabilityBias === 'moderate' ? 6 : 10;
  const finalActions = prioritizeAndLimit(actions, maxActions);

  // ───────────────────────────────────────────
  // Build reasoning narrative
  // ───────────────────────────────────────────
  const reasoning = buildReasoning(finalActions, reasoningParts, utilization, zones, stabilityBias);

  return { actions: finalActions, reasoning };
}

// ═══════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════

/**
 * Build mutable zone→rows map from zone metadata.
 * @param {Array} zones
 * @returns {Map<string, string[]>} zoneId → [rowId, ...]
 */
function buildZoneRowMap(zones) {
  const map = new Map();
  for (const zone of zones) {
    map.set(zone.id, [...(zone.actualAssignedRows || [])]);
  }
  return map;
}

/**
 * Compute row demand for each zone.
 * @param {Array} zones
 * @param {Object} utilization
 * @returns {Map<string, number>} zoneId → required rows
 */
function computeDemand(zones, utilization) {
  const demand = new Map();
  for (const zone of zones) {
    const util = utilization[zone.id];
    const bottles = util?.bottleCount ?? 0;
    // Each zone with bottles needs at least 1 row
    const required = bottles > 0 ? Math.ceil(bottles / SLOTS_PER_ROW) : 0;
    demand.set(zone.id, required);
  }
  return demand;
}

/**
 * Get the display name for a zone.
 * @param {string} zoneId
 * @param {Array} zones
 * @returns {string}
 */
function getZoneDisplayName(zoneId, zones) {
  const z = zones.find(zone => zone.id === zoneId);
  return z?.name || zoneId;
}

/**
 * Get effective color for a zone ID.
 * @param {string} zoneId
 * @returns {'red'|'white'|'any'}
 */
function getZoneColor(zoneId) {
  const zone = getZoneById(zoneId);
  return getEffectiveZoneColor(zone);
}

/**
 * Parse row number from a row ID string.
 * @param {string} rowId - e.g. "R3"
 * @returns {number}
 */
function rowNum(rowId) {
  return parseInt(String(rowId).replace('R', ''), 10);
}

// ═══════════════════════════════════════════
// Phase 2: Color boundary fixes
// ═══════════════════════════════════════════

/**
 * Fix color boundary violations by swapping misplaced rows.
 * Respects colourOrder setting: 'whites-top' = white zones in lower row numbers,
 * 'reds-top' = red zones in lower row numbers.
 *
 * Strategy: Find row pairs where a white-zone row is in the red region
 * and a red-zone row is in the white region, then swap them.
 *
 * @param {Map} zoneRowMap - Mutable zone→rows map
 * @param {Array} zones - Zone metadata
 * @param {Set} neverMerge - Protected zones
 * @param {string} [colourOrder='whites-top'] - 'whites-top' or 'reds-top'
 * @returns {Array} Actions to fix color violations
 */
function fixColorBoundaryViolations(zoneRowMap, zones, neverMerge, colourOrder = 'whites-top') {
  const actions = [];
  const whitesOnTop = colourOrder !== 'reds-top';

  // Build row→zone map
  const rowToZone = new Map();
  for (const [zoneId, rows] of zoneRowMap) {
    for (const r of rows) {
      rowToZone.set(r, zoneId);
    }
  }

  // Find the natural color boundary: last row that should be white (or red if reds-top)
  // Based on actual bottle distribution
  const whiteRowCount = countColorRows('white', zoneRowMap);
  const boundary = Math.max(whiteRowCount, 1);

  // Identify misplaced rows based on colourOrder
  const whiteRowsInRedRegion = [];
  const redRowsInWhiteRegion = [];

  for (let r = 1; r <= TOTAL_ROWS; r++) {
    const rId = `R${r}`;
    const zoneId = rowToZone.get(rId);
    if (!zoneId) continue;
    const color = getZoneColor(zoneId);
    if (color === 'any') continue;

    if (whitesOnTop) {
      // whites-top: white zones should be in rows 1..boundary, red in boundary+1..19
      if (color === 'white' && r > boundary) {
        whiteRowsInRedRegion.push({ rowId: rId, rowNumber: r, zoneId });
      } else if (color === 'red' && r <= boundary) {
        redRowsInWhiteRegion.push({ rowId: rId, rowNumber: r, zoneId });
      }
    } else {
      // reds-top: red zones should be in rows 1..redBoundary, white in redBoundary+1..19
      const redBoundary = TOTAL_ROWS - boundary;
      if (color === 'red' && r > redBoundary) {
        // Red zone in white region (reds-top: reds should be low numbers)
        whiteRowsInRedRegion.push({ rowId: rId, rowNumber: r, zoneId });
      } else if (color === 'white' && r <= redBoundary) {
        // White zone in red region (reds-top: whites should be high numbers)
        redRowsInWhiteRegion.push({ rowId: rId, rowNumber: r, zoneId });
      }
    }
  }

  // Generate swap actions — pair misplaced white rows with misplaced red rows
  const swapCount = Math.min(whiteRowsInRedRegion.length, redRowsInWhiteRegion.length);
  for (let i = 0; i < swapCount; i++) {
    const whiteRow = whiteRowsInRedRegion[i];
    const redRow = redRowsInWhiteRegion[i];

    // Two reallocate_row actions simulate a swap
    actions.push({
      type: 'reallocate_row',
      priority: 1,
      fromZoneId: whiteRow.zoneId,
      toZoneId: redRow.zoneId,
      rowNumber: whiteRow.rowNumber,
      reason: `Fix color boundary: move row ${whiteRow.rowNumber} (${whiteRow.zoneId}, white) ` +
        `to make room for red zone, swap with row ${redRow.rowNumber}`,
      bottlesAffected: SLOTS_PER_ROW
    });
    actions.push({
      type: 'reallocate_row',
      priority: 1,
      fromZoneId: redRow.zoneId,
      toZoneId: whiteRow.zoneId,
      rowNumber: redRow.rowNumber,
      reason: `Fix color boundary: move row ${redRow.rowNumber} (${redRow.zoneId}, red) ` +
        `to white region, swap with row ${whiteRow.rowNumber}`,
      bottlesAffected: SLOTS_PER_ROW
    });

    // Update mutable state
    updateZoneRowMap(zoneRowMap, whiteRow.zoneId, whiteRow.rowId, redRow.zoneId);
    updateZoneRowMap(zoneRowMap, redRow.zoneId, redRow.rowId, whiteRow.zoneId);
  }

  // ── Pass 2: Fix local adjacency violations at the boundary edge ──
  // The bulk boundary approach above misses cases where a white zone row
  // sits exactly at the boundary (row N) next to a red zone row (row N+1).
  // Both are technically in their "correct" region, but the adjacency is
  // still a color violation. Scan for these and propose swaps.
  const localFixActions = fixLocalAdjacencyViolations(zoneRowMap, whitesOnTop, neverMerge);
  actions.push(...localFixActions);

  return actions;
}

/**
 * Fix local color adjacency violations — ANY adjacent rows with different colors.
 * Matches the detection criteria of detectColorAdjacencyIssues() in cellarMetrics.js:
 * any two consecutive rows with different zone colors is a violation, regardless of order.
 *
 * Strategy: find the "outlier" row (the one surrounded by the opposite color) and swap
 * it with a same-color row from the opposite region to create clean color blocks.
 *
 * @param {Map} zoneRowMap - Mutable zone→rows map
 * @param {boolean} whitesOnTop - Whether whites should be in lower row numbers
 * @param {Set} neverMerge - Zones that can't be changed
 * @returns {Array} Swap actions to fix adjacency violations
 */
function fixLocalAdjacencyViolations(zoneRowMap, whitesOnTop, neverMerge) {
  const actions = [];

  // Rebuild row→zone map from current state (after bulk swaps above)
  const rowToZone = new Map();
  for (const [zoneId, rows] of zoneRowMap) {
    for (const r of rows) rowToZone.set(r, zoneId);
  }

  // Build ordered color sequence for all assigned rows
  const rowColors = [];
  for (let r = 1; r <= TOTAL_ROWS; r++) {
    const rId = `R${r}`;
    const zoneId = rowToZone.get(rId);
    if (!zoneId) continue;
    const color = getZoneColor(zoneId);
    if (color === 'any') continue;
    rowColors.push({ rowId: rId, rowNumber: r, zoneId, color });
  }

  // Find ALL adjacent pairs with different colors (same criteria as
  // detectColorAdjacencyIssues — any color change between neighbors is a violation)
  const alreadySwapped = new Set();

  for (let i = 0; i < rowColors.length - 1; i++) {
    const upper = rowColors[i];      // lower row number
    const lower = rowColors[i + 1];  // higher row number

    // Skip if not truly adjacent (gap in row numbers)
    if (lower.rowNumber - upper.rowNumber !== 1) continue;

    // ANY color difference is a violation (matches detectColorAdjacencyIssues)
    if (upper.color === lower.color) continue;

    if (alreadySwapped.has(upper.rowId) || alreadySwapped.has(lower.rowId)) continue;
    if (neverMerge.has(upper.zoneId) || neverMerge.has(lower.zoneId)) continue;

    // Determine which row is the outlier by checking surrounding context.
    // In whites-top mode: the "expected" color for lower row numbers is white,
    // for higher row numbers is red. The row whose color doesn't match its
    // position expectation is the outlier.
    const outlier = identifyOutlier(upper, lower, rowColors, i, whitesOnTop);
    const neighbor = outlier === upper ? lower : upper;

    // Find a swap partner: a row of the neighbor's color (same as the region
    // color where the outlier sits) that's currently in the outlier's color region.
    // Swapping them would put both rows in their correct color regions.
    let bestSwapPartner = null;
    let bestSwapScore = -Infinity;

    for (const rc of rowColors) {
      if (rc.rowId === outlier.rowId || rc.rowId === neighbor.rowId) continue;
      if (alreadySwapped.has(rc.rowId)) continue;
      if (neverMerge.has(rc.zoneId)) continue;
      // Swap partner must be the SAME color as the neighbor (so it fits in the
      // outlier's position) and must currently be on the "wrong side" for its own
      // color (so the outlier would fit better in the partner's current position).
      // Example: outlier=white in red region, neighbor=red. We need a red row
      // that's currently in the white region — swap them so both land correctly.
      if (rc.color !== neighbor.color) continue;

      // Check if this swap partner is on the "wrong side" for its own color
      // (i.e., it would benefit from moving to the outlier's position)
      const partnerInWrongRegion = whitesOnTop
        ? (rc.color === 'red' && rc.rowNumber < outlier.rowNumber) ||
          (rc.color === 'white' && rc.rowNumber > outlier.rowNumber)
        : (rc.color === 'white' && rc.rowNumber < outlier.rowNumber) ||
          (rc.color === 'red' && rc.rowNumber > outlier.rowNumber);

      if (!partnerInWrongRegion) continue;

      // Score by distance (prefer closer swaps for minimal disruption)
      const dist = Math.abs(rc.rowNumber - outlier.rowNumber);
      const score = 100 - dist;
      if (score > bestSwapScore) {
        bestSwapScore = score;
        bestSwapPartner = rc;
      }
    }

    if (bestSwapPartner) {
      // Swap outlier with a row elsewhere that creates cleaner boundary
      actions.push({
        type: 'reallocate_row',
        priority: 1,
        fromZoneId: outlier.zoneId,
        toZoneId: bestSwapPartner.zoneId,
        rowNumber: outlier.rowNumber,
        reason: `Fix color adjacency: move R${outlier.rowNumber} (${outlier.zoneId}, ${outlier.color}) ` +
          `away from R${neighbor.rowNumber} (${neighbor.color}), swap with R${bestSwapPartner.rowNumber}`,
        bottlesAffected: SLOTS_PER_ROW
      });
      actions.push({
        type: 'reallocate_row',
        priority: 1,
        fromZoneId: bestSwapPartner.zoneId,
        toZoneId: outlier.zoneId,
        rowNumber: bestSwapPartner.rowNumber,
        reason: `Fix color adjacency: move R${bestSwapPartner.rowNumber} ` +
          `(${bestSwapPartner.zoneId}, ${bestSwapPartner.color}) to R${outlier.rowNumber} position`,
        bottlesAffected: SLOTS_PER_ROW
      });
      updateZoneRowMap(zoneRowMap, outlier.zoneId, outlier.rowId, bestSwapPartner.zoneId);
      updateZoneRowMap(zoneRowMap, bestSwapPartner.zoneId, bestSwapPartner.rowId, outlier.zoneId);
      alreadySwapped.add(outlier.rowId);
      alreadySwapped.add(bestSwapPartner.rowId);
    } else {
      // No swap partner found — do a direct adjacent swap as last resort.
      // This swaps zone assignments between the two adjacent violating rows.
      actions.push({
        type: 'reallocate_row',
        priority: 1,
        fromZoneId: outlier.zoneId,
        toZoneId: neighbor.zoneId,
        rowNumber: outlier.rowNumber,
        reason: `Fix color adjacency: ${outlier.zoneId} (${outlier.color}) in R${outlier.rowNumber} ` +
          `adjacent to ${neighbor.zoneId} (${neighbor.color}) in R${neighbor.rowNumber}`,
        bottlesAffected: SLOTS_PER_ROW
      });
      actions.push({
        type: 'reallocate_row',
        priority: 1,
        fromZoneId: neighbor.zoneId,
        toZoneId: outlier.zoneId,
        rowNumber: neighbor.rowNumber,
        reason: `Fix color adjacency: swap R${neighbor.rowNumber} (${neighbor.zoneId}) ` +
          `with R${outlier.rowNumber} (${outlier.zoneId})`,
        bottlesAffected: SLOTS_PER_ROW
      });
      updateZoneRowMap(zoneRowMap, outlier.zoneId, outlier.rowId, neighbor.zoneId);
      updateZoneRowMap(zoneRowMap, neighbor.zoneId, neighbor.rowId, outlier.zoneId);
      alreadySwapped.add(outlier.rowId);
      alreadySwapped.add(neighbor.rowId);
    }
  }

  return actions;
}

/**
 * Identify which of two adjacent rows is the "outlier" — the one that doesn't
 * belong in its current position based on surrounding context and colour order.
 *
 * Heuristic (in order of priority):
 * 1. If a row is surrounded by the opposite color on both sides, it's the outlier
 * 2. If the row's color doesn't match its expected region (based on whitesOnTop), it's the outlier
 * 3. Default: the row in the higher-numbered position is the outlier in whites-top mode
 *
 * @param {Object} upper - Row with lower number
 * @param {Object} lower - Row with higher number
 * @param {Array} rowColors - Full ordered row-color sequence
 * @param {number} idx - Index of upper in rowColors
 * @param {boolean} whitesOnTop
 * @returns {Object} The outlier row
 */
function identifyOutlier(upper, lower, rowColors, idx, whitesOnTop) {
  // Check surrounding context: what color are the neighbors outside this pair?
  const prevColor = idx > 0 ? rowColors[idx - 1].color : null;
  const nextColor = idx + 2 < rowColors.length ? rowColors[idx + 2].color : null;

  // If upper is sandwiched: prev has same color as lower → upper is the outlier
  if (prevColor && prevColor === lower.color && prevColor !== upper.color) {
    return upper;
  }
  // If lower is sandwiched: next has same color as upper → lower is the outlier
  if (nextColor && nextColor === upper.color && nextColor !== lower.color) {
    return lower;
  }

  // Fall back to positional heuristic: which row's color doesn't match its region?
  if (whitesOnTop) {
    // White should be in lower row numbers. If a white row has a high number,
    // or a red row has a low number, that's the outlier.
    // Use the midpoint of total rows as approximate boundary
    const mid = Math.ceil(TOTAL_ROWS / 2);
    if (upper.color === 'white' && upper.rowNumber > mid) return upper;
    if (lower.color === 'red' && lower.rowNumber < mid) return lower;
    // Default: the row that's deeper into the "wrong" region is the outlier
    return upper.color === 'red' ? upper : lower;
  } else {
    const mid = Math.ceil(TOTAL_ROWS / 2);
    if (upper.color === 'red' && upper.rowNumber > mid) return upper;
    if (lower.color === 'white' && lower.rowNumber < mid) return lower;
    return upper.color === 'white' ? upper : lower;
  }
}

/**
 * Count rows that belong to zones of a specific color.
 * @param {'white'|'red'} color
 * @param {Map} zoneRowMap
 * @returns {number}
 */
function countColorRows(color, zoneRowMap) {
  let count = 0;
  for (const [zoneId, rows] of zoneRowMap) {
    const zoneColor = getZoneColor(zoneId);
    if (zoneColor === color) count += rows.length;
  }
  return count;
}

/**
 * Move a row from one zone to another in the mutable map.
 * @param {Map} zoneRowMap
 * @param {string} fromZone
 * @param {string} rowId
 * @param {string} toZone
 */
function updateZoneRowMap(zoneRowMap, fromZone, rowId, toZone) {
  const fromRows = zoneRowMap.get(fromZone) || [];
  zoneRowMap.set(fromZone, fromRows.filter(r => r !== rowId));
  const toRows = zoneRowMap.get(toZone) || [];
  toRows.push(rowId);
  zoneRowMap.set(toZone, toRows);
}

// ═══════════════════════════════════════════
// Phase 3: Capacity deficit resolution
// ═══════════════════════════════════════════

/**
 * Resolve capacity deficits using greedy best-first scoring.
 *
 * For each zone that needs more rows, score all possible donor rows
 * and pick the best one. Repeat until all deficits are resolved or
 * no more donors are available.
 *
 * Scoring heuristic (higher = better donation candidate):
 *   +30 — same color family (avoids new color violations)
 *   +20 — donor row is adjacent to recipient's existing rows (contiguity)
 *   +20 × (1 - utilization) — lower donor utilization = better to take from
 *   +10 — donor zone has multiple rows (won't lose its last row)
 *   -15 — high stability bias penalty for any change
 *
 * @param {Map} zoneRowMap
 * @param {Map} demand
 * @param {Object} utilization
 * @param {Array} zones
 * @param {Set} neverMerge
 * @param {string} stabilityBias
 * @returns {Array} reallocate_row actions
 */
function resolveCapacityDeficits(zoneRowMap, demand, utilization, zones, neverMerge, stabilityBias) {
  const actions = [];
  const donated = new Set(); // Track rows already donated this round

  // Build deficit list: zones that need more rows
  const deficits = [];
  for (const [zoneId, required] of demand) {
    const currentRows = zoneRowMap.get(zoneId) || [];
    const shortfall = required - currentRows.length;
    if (shortfall > 0) {
      deficits.push({ zoneId, shortfall });
    }
  }

  // Sort by shortfall descending (most urgent first)
  deficits.sort((a, b) => b.shortfall - a.shortfall);

  for (const deficit of deficits) {
    const recipientId = deficit.zoneId;
    const recipientColor = getZoneColor(recipientId);
    const recipientRows = zoneRowMap.get(recipientId) || [];

    for (let needed = 0; needed < deficit.shortfall; needed++) {
      // Score all candidate donor rows
      const candidates = scoreDonorCandidates(
        recipientId, recipientColor, recipientRows,
        zoneRowMap, demand, utilization, neverMerge, donated, stabilityBias
      );

      if (candidates.length === 0) break; // No more donors available

      // Pick the best candidate (highest score)
      const best = candidates[0];

      actions.push({
        type: 'reallocate_row',
        priority: 2,
        fromZoneId: best.donorZoneId,
        toZoneId: recipientId,
        rowNumber: rowNum(best.rowId),
        reason: `Reallocate row ${rowNum(best.rowId)} from ${getZoneDisplayName(best.donorZoneId, zones)} ` +
          `(${best.donorUtilPct}% utilized) to ${getZoneDisplayName(recipientId, zones)} ` +
          `which needs space for overflow bottles`,
        bottlesAffected: best.donorBottlesInRow
      });

      // Update mutable state
      updateZoneRowMap(zoneRowMap, best.donorZoneId, best.rowId, recipientId);
      donated.add(best.rowId);
    }
  }

  return actions;
}

/**
 * Score all candidate donor rows for a specific recipient zone.
 * Returns candidates sorted by score descending (best first).
 *
 * @param {string} recipientId - Zone needing a row
 * @param {string} recipientColor - Effective color of recipient
 * @param {string[]} recipientRows - Current rows of recipient
 * @param {Map} zoneRowMap - Current zone→rows map
 * @param {Map} demand - Zone demand map
 * @param {Object} utilization - Zone utilization data
 * @param {Set} neverMerge - Protected zones
 * @param {Set} donated - Already-donated rows this round
 * @param {string} stabilityBias
 * @returns {Array<{rowId, donorZoneId, score, donorUtilPct, donorBottlesInRow}>}
 */
function scoreDonorCandidates(
  recipientId, recipientColor, recipientRows,
  zoneRowMap, demand, utilization, neverMerge, donated, stabilityBias
) {
  const candidates = [];

  for (const [donorZoneId, donorRows] of zoneRowMap) {
    // Can't donate to yourself
    if (donorZoneId === recipientId) continue;
    // Must have surplus rows (more than demanded)
    const donorDemand = demand.get(donorZoneId) ?? 0;
    if (donorRows.length <= donorDemand) continue;
    // Must keep at least 1 row if zone has bottles
    const donorUtil = utilization[donorZoneId];
    const donorBottles = donorUtil?.bottleCount ?? 0;
    if (donorBottles > 0 && donorRows.length <= 1) continue;

    const donorColor = getZoneColor(donorZoneId);
    const donorUtilPct = donorUtil?.utilizationPct ?? 0;

    for (const candidateRow of donorRows) {
      if (donated.has(candidateRow)) continue;

      let score = 0;

      // Same color family — strongly preferred to avoid new violations
      if (recipientColor === 'any' || donorColor === 'any' || recipientColor === donorColor) {
        score += 30;
      } else {
        score -= 20; // Different color — penalize heavily
      }

      // Adjacency to recipient's existing rows — improves contiguity
      const candidateRowNum = rowNum(candidateRow);
      const recipientRowNums = recipientRows.map(r => rowNum(r));
      const minDist = recipientRowNums.length > 0
        ? Math.min(...recipientRowNums.map(n => Math.abs(n - candidateRowNum)))
        : TOTAL_ROWS;
      if (minDist <= 1) score += 20;
      else if (minDist <= 2) score += 10;
      else if (minDist <= 3) score += 5;

      // Lower donor utilization = better to take from
      score += Math.round(20 * (1 - donorUtilPct / 100));

      // Donor has multiple surplus rows (not losing its last spare)
      if (donorRows.length - donorDemand > 1) score += 10;

      // Stability penalty
      if (stabilityBias === 'high') score -= 15;
      else if (stabilityBias === 'moderate') score -= 5;

      // Estimate bottles in this specific row (rough: total / rows)
      const donorBottlesInRow = donorRows.length > 0
        ? Math.round(donorBottles / donorRows.length)
        : 0;

      candidates.push({
        rowId: candidateRow,
        donorZoneId,
        score,
        donorUtilPct,
        donorBottlesInRow
      });
    }
  }

  // Sort by score descending (best first)
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ═══════════════════════════════════════════
// Phase 4: Zone merge detection
// ═══════════════════════════════════════════

/**
 * Find merge actions for very small or underutilized zones.
 *
 * @param {Map} zoneRowMap
 * @param {Map} demand
 * @param {Object} utilization
 * @param {Array} mergeCandidates - Pre-computed affinity pairs
 * @param {Set} neverMerge
 * @param {number} maxMerges
 * @returns {Array} merge_zones or retire_zone actions
 */
function findMergeActions(zoneRowMap, demand, utilization, mergeCandidates, neverMerge, maxMerges) {
  const actions = [];
  const merged = new Set();

  for (const candidate of mergeCandidates) {
    if (actions.length >= maxMerges) break;
    if (neverMerge.has(candidate.sourceZone) || neverMerge.has(candidate.targetZone)) continue;
    if (merged.has(candidate.sourceZone) || merged.has(candidate.targetZone)) continue;

    const sourceUtil = utilization[candidate.sourceZone];
    const targetUtil = utilization[candidate.targetZone];
    const sourceBottles = sourceUtil?.bottleCount ?? 0;
    const targetBottles = targetUtil?.bottleCount ?? 0;

    // Only merge if source zone is small (≤5 bottles) or very underutilized (<25%)
    if (sourceBottles > 5 && (sourceUtil?.utilizationPct ?? 100) > 25) continue;

    // Check if combined bottles fit in target's current + source's rows
    const targetRows = zoneRowMap.get(candidate.targetZone) || [];
    const sourceRows = zoneRowMap.get(candidate.sourceZone) || [];
    const combinedCapacity = (targetRows.length + sourceRows.length) * SLOTS_PER_ROW;
    if (sourceBottles + targetBottles > combinedCapacity) continue;

    if (sourceBottles <= 2) {
      // Very small zone — retire
      actions.push({
        type: 'retire_zone',
        priority: 4,
        zoneId: candidate.sourceZone,
        mergeIntoZoneId: candidate.targetZone,
        reason: `Retire ${candidate.sourceZone} (only ${sourceBottles} bottle(s)) ` +
          `and merge into ${candidate.targetZone}: ${candidate.reason}`,
        bottlesAffected: sourceBottles
      });
    } else {
      // Small zone — merge
      actions.push({
        type: 'merge_zones',
        priority: 3,
        sourceZones: [candidate.sourceZone],
        targetZoneId: candidate.targetZone,
        reason: `Merge ${candidate.sourceZone} into ${candidate.targetZone}: ${candidate.reason}`,
        bottlesAffected: sourceBottles + targetBottles
      });
    }

    merged.add(candidate.sourceZone);
  }

  return actions;
}

// ═══════════════════════════════════════════
// Phase 5: Scattered wine consolidation
// ═══════════════════════════════════════════

/**
 * Generate row reallocation actions to reduce wine scattering.
 * Wines of the same type scattered across non-adjacent rows can be
 * consolidated by swapping adjacent rows into the zone.
 *
 * @param {Map} zoneRowMap
 * @param {Array} scatteredWines
 * @param {Array} zones
 * @param {Set} neverMerge
 * @param {string} stabilityBias
 * @returns {Array} Actions
 */
function consolidateScatteredWines(zoneRowMap, scatteredWines, zones, neverMerge, stabilityBias) {
  // Only consolidate when stability allows
  if (stabilityBias === 'high') return [];
  if (!scatteredWines || scatteredWines.length === 0) return [];

  // This is a lower-priority optimization — limit to top 3 scattered wines
  const topScattered = scatteredWines.slice(0, 3);

  // For now, scattered wine consolidation is handled by the capacity rebalancing
  // (moving rows to zones with more bottles). Additional scatter-specific logic
  // could be added here as row-swap heuristics.
  return [];
}

// ═══════════════════════════════════════════
// Phase 6: Prioritize and limit
// ═══════════════════════════════════════════

/**
 * Sort actions by priority and limit total count.
 * @param {Array} actions
 * @param {number} maxActions
 * @returns {Array}
 */
function prioritizeAndLimit(actions, maxActions) {
  // Deduplicate: filter actions that reallocate the same row
  const seenRows = new Set();
  const deduplicated = actions.filter(a => {
    if (a.type === 'reallocate_row') {
      const key = `R${a.rowNumber}`;
      if (seenRows.has(key)) return false;
      seenRows.add(key);
    }
    return true;
  });

  // Sort by priority (lower = more important)
  deduplicated.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

  return deduplicated.slice(0, maxActions);
}

// ═══════════════════════════════════════════
// Reasoning narrative builder
// ═══════════════════════════════════════════

/**
 * Build a human-readable reasoning narrative from the solver actions.
 *
 * @param {Array} actions - Final plan actions
 * @param {string[]} reasoningParts - Phase-level summaries
 * @param {Object} utilization
 * @param {Array} zones
 * @param {string} stabilityBias
 * @returns {string}
 */
function buildReasoning(actions, reasoningParts, utilization, zones, stabilityBias) {
  if (actions.length === 0) {
    return 'No reconfiguration actions needed — the cellar layout is well-balanced within current constraints.';
  }

  const parts = [];

  // Opening
  const reallocations = actions.filter(a => a.type === 'reallocate_row').length;
  const merges = actions.filter(a => a.type === 'merge_zones' || a.type === 'retire_zone').length;

  let openingSentence = `Generated a plan with ${actions.length} action(s)`;
  if (reallocations > 0 && merges > 0) {
    openingSentence += ` (${reallocations} row reallocation(s), ${merges} zone merge(s))`;
  } else if (reallocations > 0) {
    openingSentence += ` (${reallocations} row reallocation(s))`;
  } else if (merges > 0) {
    openingSentence += ` (${merges} zone merge(s))`;
  }
  openingSentence += ` within the ${TOTAL_ROWS}-row physical limit.`;
  parts.push(openingSentence);

  // Phase summaries
  parts.push(...reasoningParts);

  // Stability note
  if (stabilityBias === 'high') {
    parts.push('High stability bias: only critical changes proposed to minimize disruption.');
  }

  return parts.join(' ');
}
