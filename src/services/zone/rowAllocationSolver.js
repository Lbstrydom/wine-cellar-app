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

  return actions;
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
