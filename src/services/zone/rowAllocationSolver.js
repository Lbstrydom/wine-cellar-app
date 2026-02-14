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
import { getRowCapacity, computeRowsCapacity, getTotalRows } from '../../config/cellarCapacity.js';

const TOTAL_ROWS = getTotalRows();

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
    colorAdjacencyIssues = []
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
  const colorFixActions = fixColorBoundaryViolations(zoneRowMap, zones, neverMerge);
  if (colorFixActions.length > 0) {
    actions.push(...colorFixActions);
    reasoningParts.push(
      `Fixed ${colorFixActions.length} color boundary violation(s) — ` +
      'white/rosé/sparkling zones must be in lower rows and red zones in higher rows.'
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
 * Compute minimum row demand for each zone using true row capacities.
 * Returns the minimum number of rows needed to hold each zone's bottles,
 * which enables detecting surplus rows that can be donated.
 *
 * Uses a greedy approach: fill the smallest available rows first to
 * get a tight lower bound. For most rows (9 slots), this is equivalent
 * to Math.ceil(bottles / 9), except Row 1 has 7 slots.
 *
 * @param {Array} zones
 * @param {Object} utilization
 * @returns {Map<string, number>} zoneId → minimum required rows
 */
function computeDemand(zones, utilization) {
  const demand = new Map();
  for (const zone of zones) {
    const util = utilization[zone.id];
    const bottles = util?.bottleCount ?? 0;
    if (bottles === 0) {
      demand.set(zone.id, 0);
      continue;
    }
    // Compute minimum rows needed based on actual row capacities.
    // Most rows have 9 slots, but Row 1 has 7. For a tight bound,
    // check if the zone owns Row 1 (smaller capacity) or only standard rows.
    const currentRows = zone.actualAssignedRows || [];
    const hasRow1 = currentRows.some(r => r === 'R1');
    // Use the smallest capacity in the zone's rows for conservative estimate
    const effectiveCapacity = hasRow1 ? 7 : 9;
    const required = Math.max(1, Math.ceil(bottles / effectiveCapacity));
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
 * White zones should be in lower rows, red zones in higher rows.
 *
 * Strategy: Find row pairs where a white-zone row is in the red region
 * and a red-zone row is in the white region, then swap them.
 *
 * @param {Map} zoneRowMap - Mutable zone→rows map
 * @param {Array} zones - Zone metadata
 * @param {Set} neverMerge - Protected zones
 * @returns {Array} Actions to fix color violations
 */
function fixColorBoundaryViolations(zoneRowMap, zones, neverMerge) {
  const actions = [];

  // Build row→zone map
  const rowToZone = new Map();
  for (const [zoneId, rows] of zoneRowMap) {
    for (const r of rows) {
      rowToZone.set(r, zoneId);
    }
  }

  // Find the natural color boundary: last row that should be white
  // Based on actual bottle distribution
  const whiteRowCount = countColorRows('white', zoneRowMap);
  const boundary = Math.max(whiteRowCount, 1);

  // Find white-zone rows that are above the boundary (should be lower)
  const whiteRowsInRedRegion = [];
  // Find red-zone rows that are below the boundary (should be higher)
  const redRowsInWhiteRegion = [];

  for (let r = 1; r <= TOTAL_ROWS; r++) {
    const rId = `R${r}`;
    const zoneId = rowToZone.get(rId);
    if (!zoneId) continue;
    const color = getZoneColor(zoneId);
    if (color === 'any') continue;

    if (color === 'white' && r > boundary) {
      whiteRowsInRedRegion.push({ rowId: rId, rowNumber: r, zoneId });
    } else if (color === 'red' && r <= boundary) {
      redRowsInWhiteRegion.push({ rowId: rId, rowNumber: r, zoneId });
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
      bottlesAffected: getRowCapacity(whiteRow.rowId)
    });
    actions.push({
      type: 'reallocate_row',
      priority: 1,
      fromZoneId: redRow.zoneId,
      toZoneId: whiteRow.zoneId,
      rowNumber: redRow.rowNumber,
      reason: `Fix color boundary: move row ${redRow.rowNumber} (${redRow.zoneId}, red) ` +
        `to white region, swap with row ${whiteRow.rowNumber}`,
      bottlesAffected: getRowCapacity(redRow.rowId)
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
      if (minDist <= 1) score += 25; // Directly adjacent — strong contiguity
      else if (minDist <= 2) score += 12;
      else if (minDist <= 3) score += 5;

      // Contiguity bonus: would this row extend a contiguous block?
      if (recipientRowNums.length > 0) {
        const wouldExtend = recipientRowNums.includes(candidateRowNum - 1) ||
                           recipientRowNums.includes(candidateRowNum + 1);
        if (wouldExtend) score += 8; // Extends contiguous span
      }

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
    const combinedCapacity = computeRowsCapacity([...targetRows, ...sourceRows]);
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
 * consolidated by acquiring adjacent rows from underutilized neighbours.
 *
 * Strategy: For each scattered wine, find the zone it belongs to,
 * identify a gap row between the zone's existing rows, and try to
 * reallocate that gap row from its current zone (if underutilized).
 *
 * @param {Map} zoneRowMap - Mutable zone→rows map
 * @param {Array} scatteredWines - [{wineName, bottleCount, rows, zoneId?}]
 * @param {Array} zones - Zone metadata
 * @param {Set} neverMerge - Protected zones
 * @param {string} stabilityBias
 * @returns {Array} reallocate_row actions
 */
function consolidateScatteredWines(zoneRowMap, scatteredWines, zones, neverMerge, stabilityBias) {
  if (stabilityBias === 'high') return [];
  if (!scatteredWines || scatteredWines.length === 0) return [];

  const actions = [];
  const maxScatterActions = stabilityBias === 'moderate' ? 2 : 3;
  const donated = new Set();

  // Build row→zone reverse map
  const rowToZone = new Map();
  for (const [zoneId, rows] of zoneRowMap) {
    for (const r of rows) {
      rowToZone.set(r, zoneId);
    }
  }

  // Focus on the most scattered wines (highest bottle count first)
  const topScattered = scatteredWines.slice(0, 5);

  for (const scattered of topScattered) {
    if (actions.length >= maxScatterActions) break;

    // Determine which zone these scattered bottles belong to
    const scatteredRows = scattered.rows || [];
    if (scatteredRows.length < 2) continue;

    // Find the zone that owns the majority of these rows
    const zoneCounts = new Map();
    for (const r of scatteredRows) {
      const z = rowToZone.get(r);
      if (z) zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1);
    }
    if (zoneCounts.size === 0) continue;

    const ownerZoneId = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const ownerRows = zoneRowMap.get(ownerZoneId) || [];
    const ownerRowNums = ownerRows.map(r => rowNum(r)).sort((a, b) => a - b);

    if (ownerRowNums.length < 1) continue;

    // Find gap rows between the zone's existing rows
    const minRow = ownerRowNums[0];
    const maxRow = ownerRowNums[ownerRowNums.length - 1];
    const ownerRowSet = new Set(ownerRowNums);

    for (let r = minRow; r <= maxRow; r++) {
      if (actions.length >= maxScatterActions) break;
      if (ownerRowSet.has(r)) continue; // Already owned

      const gapRowId = `R${r}`;
      if (donated.has(gapRowId)) continue;

      const gapOwner = rowToZone.get(gapRowId);
      if (!gapOwner || gapOwner === ownerZoneId) continue;
      if (neverMerge.has(gapOwner)) continue;

      // Only take from underutilized zones with surplus rows
      const gapOwnerRows = zoneRowMap.get(gapOwner) || [];
      if (gapOwnerRows.length <= 1) continue;

      // Check colors are compatible
      const ownerColor = getZoneColor(ownerZoneId);
      const gapColor = getZoneColor(gapOwner);
      if (ownerColor !== 'any' && gapColor !== 'any' && ownerColor !== gapColor) continue;

      actions.push({
        type: 'reallocate_row',
        priority: 4,
        fromZoneId: gapOwner,
        toZoneId: ownerZoneId,
        rowNumber: r,
        reason: `Consolidate scattered ${scattered.wineName} (${scattered.bottleCount} bottles across ` +
          `${scatteredRows.length} rows): fill gap row ${r} from ${getZoneDisplayName(gapOwner, zones)}`,
        bottlesAffected: Math.round((scattered.bottleCount || 0) / scatteredRows.length),
        source: 'solver'
      });

      updateZoneRowMap(zoneRowMap, gapOwner, gapRowId, ownerZoneId);
      donated.add(gapRowId);
    }
  }

  return actions;
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
