/**
 * @fileoverview Move suggestion generation and zone allocation helpers.
 * Extracted from cellarAnalysis.js to keep each module under 300 lines.
 * @module services/cellar/cellarSuggestions
 */

import { getZoneById } from '../../config/cellarZones.js';
import { findAvailableSlot } from './cellarPlacement.js';
import { getActiveZoneMap, getAllocatedRowMap } from './cellarAllocation.js';
import { detectRowGaps, parseSlot } from './cellarMetrics.js';

// ───────────────────────────────────────────────────────────
// Zone allocation queries
// ───────────────────────────────────────────────────────────

/**
 * Get the rows allocated to a specific zone.
 * @param {string} zoneId - Zone ID
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<string[]>} Sorted row IDs (e.g. ["R3", "R4"])
 */
export async function getActiveZoneRowsForZone(zoneId, cellarId) {
  const zoneMap = await getActiveZoneMap(cellarId);
  const rows = [];
  for (const [rowId, info] of Object.entries(zoneMap)) {
    if (info.zoneId === zoneId) rows.push(rowId);
  }
  return rows.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

/**
 * Get the full zone-to-rows and row-to-zone allocation.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<{zoneToRows: Object, rowToZoneId: Object}>}
 */
export async function getCurrentZoneAllocation(cellarId) {
  const zoneMap = await getActiveZoneMap(cellarId);
  const zoneToRows = {};
  const rowToZoneId = {};

  for (const [rowId, info] of Object.entries(zoneMap)) {
    rowToZoneId[rowId] = info.zoneId;
    if (!zoneToRows[info.zoneId]) zoneToRows[info.zoneId] = [];
    zoneToRows[info.zoneId].push(rowId);
  }

  for (const rows of Object.values(zoneToRows)) {
    rows.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  }

  return { zoneToRows, rowToZoneId };
}

/**
 * Get cellar rows not currently allocated to any zone.
 * Checks ALL allocations (not just active ones with wine_count > 0)
 * to match the same logic used by allocateRowToZone().
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<string[]>} Available row IDs
 */
export async function getAvailableCellarRows(cellarId) {
  const allRows = await getAllocatedRowMap(cellarId);
  const used = new Set(Object.keys(allRows));
  const available = [];
  for (let rowNum = 1; rowNum <= 19; rowNum++) {
    const rowId = `R${rowNum}`;
    if (!used.has(rowId)) available.push(rowId);
  }
  return available;
}

/**
 * Get zones adjacent to the given rows in the current allocation.
 * @param {string[]} zoneRows - Row IDs belonging to the zone
 * @param {Object} rowToZoneId - Row-to-zone mapping
 * @returns {string[]} Adjacent zone IDs
 */
export function getAdjacentZonesFromAllocation(zoneRows, rowToZoneId) {
  const adjacent = new Set();

  for (const rowId of zoneRows) {
    const rowNum = parseInt(rowId.slice(1), 10);
    const prev = `R${rowNum - 1}`;
    const next = `R${rowNum + 1}`;

    if (rowToZoneId[prev]) adjacent.add(rowToZoneId[prev]);
    if (rowToZoneId[next]) adjacent.add(rowToZoneId[next]);
  }

  return [...adjacent];
}

// ───────────────────────────────────────────────────────────
// Zone capacity issue helpers
// ───────────────────────────────────────────────────────────

/**
 * Build zone capacity alerts from issues found during suggestion generation.
 * @param {Array} zoneCapacityIssues - Issues from generateMoveSuggestions
 * @param {boolean} needsZoneSetup - Whether zones are not configured
 * @param {boolean} allowFallback - Whether fallback placement is allowed
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Array>} Alert objects for the report
 */
export async function buildZoneCapacityAlerts(zoneCapacityIssues, needsZoneSetup, allowFallback, cellarId) {
  const alerts = [];

  if (zoneCapacityIssues.length === 0 || needsZoneSetup || allowFallback) {
    return alerts;
  }

  const issuesByZone = new Map();
  for (const issue of zoneCapacityIssues) {
    if (!issuesByZone.has(issue.overflowingZoneId)) {
      issuesByZone.set(issue.overflowingZoneId, []);
    }
    issuesByZone.get(issue.overflowingZoneId).push(issue.wine);
  }

  for (const [overflowingZoneId, winesNeedingPlacement] of issuesByZone) {
    const zone = getZoneById(overflowingZoneId);
    const zoneRows = await getActiveZoneRowsForZone(overflowingZoneId, cellarId);
    const currentZoneAllocation = await getCurrentZoneAllocation(cellarId);
    const availableRows = await getAvailableCellarRows(cellarId);
    const adjacentZones = getAdjacentZonesFromAllocation(zoneRows, currentZoneAllocation.rowToZoneId)
      .filter(z => z !== overflowingZoneId);

    const affectedCount = winesNeedingPlacement.length;

    alerts.push({
      type: 'zone_capacity_issue',
      severity: 'warning',
      message: `The "${zone?.displayName || overflowingZoneId}" zone is full. ${affectedCount} wine(s) need placement but would fall back to unrelated areas.`,
      data: {
        overflowingZoneId,
        overflowingZoneName: zone?.displayName || overflowingZoneId,
        winesNeedingPlacement,
        currentZoneAllocation: currentZoneAllocation.zoneToRows,
        availableRows,
        adjacentZones
      }
    });
  }

  return alerts;
}

// ───────────────────────────────────────────────────────────
// Swap pair detection
// ───────────────────────────────────────────────────────────

/**
 * Detect natural swap pairs among misplaced wines.
 * Two misplaced wines form a natural swap when each currently sits
 * in the other's target zone — swapping them places both correctly.
 * @param {Array} misplacedWines - Sorted misplaced wine entries (must have currentZoneId & suggestedZoneId)
 * @returns {Array<[number, number]>} Array of [indexA, indexB] swap pairs
 */
export function detectNaturalSwapPairs(misplacedWines) {
  const pairs = [];
  const used = new Set();

  for (let i = 0; i < misplacedWines.length; i++) {
    if (used.has(i)) continue;
    const wineA = misplacedWines[i];
    if (!wineA.currentZoneId || !wineA.suggestedZoneId) continue;

    for (let j = i + 1; j < misplacedWines.length; j++) {
      if (used.has(j)) continue;
      const wineB = misplacedWines[j];
      if (!wineB.currentZoneId || !wineB.suggestedZoneId) continue;

      // Natural swap: each wine is sitting in the other's target zone
      if (wineA.currentZoneId === wineB.suggestedZoneId &&
          wineB.currentZoneId === wineA.suggestedZoneId) {
        pairs.push([i, j]);
        used.add(i);
        used.add(j);
        break; // Wine A is paired, move to next
      }
    }
  }

  return pairs;
}

/**
 * Detect displacement swap opportunities among misplaced wines.
 * A displacement swap is weaker than a natural swap: Wine A needs to go
 * to a zone where Wine B currently sits, and Wine B is also misplaced
 * (but may target a DIFFERENT zone than A's current zone).
 * The pair resolves to: A → B's slot, B → A's slot (freeing both for
 * zone-correct placement in a second pass or later execution).
 * @param {Array} misplacedWines - Misplaced wine entries
 * @param {Set} usedIndices - Indices already consumed by natural swaps
 * @returns {Array<[number, number]>} Array of [needsSlotIdx, displacedIdx] pairs
 */
export function detectDisplacementSwaps(misplacedWines, usedIndices) {
  const pairs = [];
  const used = new Set(usedIndices);

  for (let i = 0; i < misplacedWines.length; i++) {
    if (used.has(i)) continue;
    const wineA = misplacedWines[i];
    if (!wineA.currentZoneId || !wineA.suggestedZoneId) continue;

    for (let j = 0; j < misplacedWines.length; j++) {
      if (i === j || used.has(j)) continue;
      const wineB = misplacedWines[j];
      if (!wineB.currentZoneId || !wineB.suggestedZoneId) continue;

      // Displacement: A wants B's zone, and B is misplaced (going anywhere)
      if (wineA.suggestedZoneId === wineB.currentZoneId) {
        pairs.push([i, j]);
        used.add(i);
        used.add(j);
        break; // Wine A is paired, move to next
      }
    }
  }

  return pairs;
}

// ───────────────────────────────────────────────────────────
// Move suggestion generation
// ───────────────────────────────────────────────────────────

/**
 * Generate move suggestions for misplaced wines.
 * @param {Array} misplacedWines
 * @param {Array} allWines
 * @param {Map} _slotToWine - Slot to wine mapping (reserved)
 * @param {Object} [options]
 * @param {boolean} [options.allowFallback=false]
 * @returns {Promise<Array>} Move suggestions (with _hasSwaps and _zoneCapacityIssues attached)
 */
export async function generateMoveSuggestions(misplacedWines, allWines, _slotToWine, options = {}) {
  const { allowFallback = false, cellarId } = options;
  const occupiedSlots = new Set();
  allWines.forEach(w => {
    const slotId = w.slot_id || w.location_code;
    if (slotId) occupiedSlots.add(slotId);
  });

  const suggestions = [];
  const pendingMoves = new Map();
  const zoneCapacityIssues = [];

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

  // ── Pre-detect natural swap pairs ─────────────────────────
  // Two misplaced wines form a natural swap when each currently sits
  // in the other's target zone (A→B, B→A).  Detecting them upfront
  // avoids the sequential loop routing them into chain dependencies.
  const swapPairsDetected = detectNaturalSwapPairs(sortedMisplaced);
  const usedInSwaps = new Set();

  for (const [i, j] of swapPairsDetected) {
    usedInSwaps.add(i);
    usedInSwaps.add(j);

    const wineA = sortedMisplaced[i];
    const wineB = sortedMisplaced[j];

    const higherPriority = Math.min(
      wineA.confidence === 'high' ? 1 : wineA.confidence === 'medium' ? 2 : 3,
      wineB.confidence === 'high' ? 1 : wineB.confidence === 'medium' ? 2 : 3
    );

    suggestions.push({
      type: 'move',
      wineId: wineA.wineId,
      wineName: wineA.name,
      from: wineA.currentSlot,
      to: wineB.currentSlot,
      toZone: wineA.suggestedZone,
      toZoneId: wineA.suggestedZoneId,
      reason: wineA.reason,
      confidence: wineA.confidence,
      isOverflow: false,
      priority: higherPriority
    });

    suggestions.push({
      type: 'move',
      wineId: wineB.wineId,
      wineName: wineB.name,
      from: wineB.currentSlot,
      to: wineA.currentSlot,
      toZone: wineB.suggestedZone,
      toZoneId: wineB.suggestedZoneId,
      reason: wineB.reason,
      confidence: wineB.confidence,
      isOverflow: false,
      priority: higherPriority
    });

    // Both slots stay occupied (swapped contents), mark as allocated
    allocatedTargets.add(wineA.currentSlot);
    allocatedTargets.add(wineB.currentSlot);
  }

  // ── Pre-detect displacement swap pairs ────────────────────
  // Weaker than natural swaps: Wine A needs to go to the zone where
  // Wine B sits, and Wine B is also misplaced (but targets a different
  // zone, not necessarily A's zone).  We swap A↔B: A lands in B's
  // zone (correct), B lands in A's slot (still misplaced, but the
  // sequential loop can now route B to an empty slot since A's slot
  // is vacated in B's new zone context).
  const displacementPairs = detectDisplacementSwaps(sortedMisplaced, usedInSwaps);

  for (const [i, j] of displacementPairs) {
    usedInSwaps.add(i);
    usedInSwaps.add(j);

    const wineA = sortedMisplaced[i]; // Needs B's zone
    const wineB = sortedMisplaced[j]; // Currently in A's target zone

    const higherPriority = Math.min(
      wineA.confidence === 'high' ? 1 : wineA.confidence === 'medium' ? 2 : 3,
      wineB.confidence === 'high' ? 1 : wineB.confidence === 'medium' ? 2 : 3
    );

    // A → B's slot (A is now in the correct zone)
    suggestions.push({
      type: 'move',
      wineId: wineA.wineId,
      wineName: wineA.name,
      from: wineA.currentSlot,
      to: wineB.currentSlot,
      toZone: wineA.suggestedZone,
      toZoneId: wineA.suggestedZoneId,
      reason: wineA.reason,
      confidence: wineA.confidence,
      isOverflow: false,
      priority: higherPriority
    });

    // B → A's slot (B is displaced but now the sequential loop can re-process)
    suggestions.push({
      type: 'move',
      wineId: wineB.wineId,
      wineName: wineB.name,
      from: wineB.currentSlot,
      to: wineA.currentSlot,
      toZone: wineB.suggestedZone,
      toZoneId: wineB.suggestedZoneId,
      reason: `${wineB.reason} (displaced swap — will need follow-up move to reach ${wineB.suggestedZone})`,
      confidence: wineB.confidence,
      isOverflow: false,
      isDisplacementSwap: true,
      priority: higherPriority
    });

    // Both slots stay occupied (swapped), mark as allocated
    allocatedTargets.add(wineA.currentSlot);
    allocatedTargets.add(wineB.currentSlot);

    // Track that A's old slot now holds B (for the sequential loop)
    pendingMoves.set(wineB.currentSlot, wineA.currentSlot);
    pendingMoves.set(wineA.currentSlot, wineB.currentSlot);
  }

  // ── Sequential processing for remaining wines ─────────────
  for (let idx = 0; idx < sortedMisplaced.length; idx++) {
    if (usedInSwaps.has(idx)) continue;
    const wine = sortedMisplaced[idx];
    // Calculate currently available slots (accounting for pending moves AND allocated targets)
    const currentlyOccupied = new Set(occupiedSlots);
    pendingMoves.forEach((toSlot, fromSlot) => {
      currentlyOccupied.delete(fromSlot);
      currentlyOccupied.add(toSlot);
    });

    // Add already-allocated targets to the occupied set
    allocatedTargets.forEach(target => currentlyOccupied.add(target));

    let slot;
    try {
      slot = await findAvailableSlot(wine.suggestedZoneId, currentlyOccupied, wine, {
        allowFallback,
        enforceAffinity: true,
        cellarId
      });
    } catch (err) {
      console.error(`[MoveSuggestions] findAvailableSlot failed for wine ${wine.wineId}:`, err.message);
      slot = null;
    }

    if (slot) {
      suggestions.push({
        type: 'move',
        wineId: wine.wineId,
        wineName: wine.name,
        from: wine.currentSlot,
        to: slot.slotId,
        toZone: wine.suggestedZone,
        toZoneId: wine.suggestedZoneId,
        actualTargetZoneId: slot.zoneId, // May differ from toZoneId when overflow
        reason: wine.reason,
        confidence: wine.confidence,
        isOverflow: slot.isOverflow,
        priority: wine.confidence === 'high' ? 1 : wine.confidence === 'medium' ? 2 : 3
      });
      pendingMoves.set(wine.currentSlot, slot.slotId);
      allocatedTargets.add(slot.slotId); // Mark this target as allocated
    } else {
      if (!allowFallback) {
        zoneCapacityIssues.push({
          overflowingZoneId: wine.suggestedZoneId,
          wine: {
            wineId: wine.wineId,
            wineName: wine.name,
            currentSlot: wine.currentSlot
          }
        });
      }
      suggestions.push({
        type: 'manual',
        wineId: wine.wineId,
        wineName: wine.name,
        currentSlot: wine.currentSlot,
        suggestedZone: wine.suggestedZone,
        suggestedZoneId: wine.suggestedZoneId,
        reason: wine.reason,
        zoneFullReason: `The ${wine.suggestedZone} zone has no empty slots. Run AI Zone Structuring to rebalance rows across zones, or use Find Slot to search overflow areas.`,
        confidence: wine.confidence,
        priority: 3
      });
    }
  }

  // ── Second pass: resolve manual suggestions via displacement swaps ──
  // For each `manual` suggestion (zone was full), find a misplaced wine
  // occupying the target zone and swap them.  The Manual wine lands in
  // the correct zone; the displaced wine moves to Manual's old slot
  // and can be re-routed in a future analysis run or manual step.
  const manualIndices = [];
  suggestions.forEach((s, idx) => {
    if (s.type === 'manual') manualIndices.push(idx);
  });

  // Build a lookup: slot → misplaced wine info (for wines not yet resolved)
  const slotToMisplaced = new Map();
  for (const mw of sortedMisplaced) {
    if (!mw.currentSlot) continue;
    // Only include wines that haven't already been resolved as a 'move'
    const alreadyResolved = suggestions.some(
      s => s.type === 'move' && s.wineId === mw.wineId
    );
    if (!alreadyResolved) {
      slotToMisplaced.set(mw.currentSlot, mw);
    }
  }

  // Also build: slot → wine (for ALL wines, to find zone occupants)
  const slotToWineMap = new Map();
  for (const w of allWines) {
    const slotId = w.slot_id || w.location_code;
    if (slotId) slotToWineMap.set(slotId, w);
  }

  // Track which manuals we've resolved to avoid double-processing
  const resolvedManualIndices = new Set();
  const resolvedWineIds = new Set();

  for (const mIdx of manualIndices) {
    const manual = suggestions[mIdx];
    if (resolvedManualIndices.has(mIdx)) continue;

    // Find a misplaced wine currently in the target zone that we can swap with
    let swapPartner = null;
    for (const mw of sortedMisplaced) {
      if (mw.wineId === manual.wineId) continue;
      if (resolvedWineIds.has(mw.wineId)) continue;
      // Partner must be in the manual wine's target zone AND also be misplaced
      if (mw.currentZoneId === manual.suggestedZoneId &&
          mw.suggestedZoneId !== mw.currentZoneId) {
        swapPartner = mw;
        break;
      }
    }

    if (!swapPartner) continue;

    // Convert this manual into a displacement swap pair
    resolvedManualIndices.add(mIdx);
    resolvedWineIds.add(manual.wineId);
    resolvedWineIds.add(swapPartner.wineId);

    // Remove the partner's existing suggestion (manual or otherwise)
    const partnerSuggIdx = suggestions.findIndex(
      s => s.wineId === swapPartner.wineId && s !== suggestions[mIdx]
    );
    if (partnerSuggIdx !== -1) {
      resolvedManualIndices.add(partnerSuggIdx);
    }

    const higherPriority = Math.min(
      manual.confidence === 'high' ? 1 : manual.confidence === 'medium' ? 2 : 3,
      swapPartner.confidence === 'high' ? 1 : swapPartner.confidence === 'medium' ? 2 : 3
    );

    // Manual wine → partner's slot (now in correct zone)
    suggestions.push({
      type: 'move',
      wineId: manual.wineId,
      wineName: manual.wineName,
      from: manual.currentSlot,
      to: swapPartner.currentSlot,
      toZone: manual.suggestedZone,
      toZoneId: manual.suggestedZoneId,
      reason: manual.reason,
      confidence: manual.confidence,
      isOverflow: false,
      priority: higherPriority
    });

    // Partner → manual wine's old slot (displaced, may need follow-up)
    suggestions.push({
      type: 'move',
      wineId: swapPartner.wineId,
      wineName: swapPartner.name,
      from: swapPartner.currentSlot,
      to: manual.currentSlot,
      toZone: swapPartner.suggestedZone,
      toZoneId: swapPartner.suggestedZoneId,
      reason: `${swapPartner.reason} (displaced swap — will need follow-up move to reach ${swapPartner.suggestedZone})`,
      confidence: swapPartner.confidence,
      isOverflow: false,
      isDisplacementSwap: true,
      priority: higherPriority
    });
  }

  // Remove resolved manual suggestions (iterate in reverse to preserve indices)
  const indicesToRemove = [...resolvedManualIndices].sort((a, b) => b - a);
  for (const idx of indicesToRemove) {
    suggestions.splice(idx, 1);
  }

  const sortedSuggestions = suggestions.sort((a, b) => a.priority - b.priority);

  // Check if any moves involve swaps or dependencies (source of one move is target of another)
  const moveSuggestions = sortedSuggestions.filter(s => s.type === 'move');
  const sources = new Set(moveSuggestions.map(m => m.from));
  const targets = new Set(moveSuggestions.map(m => m.to));
  const hasSwaps = [...sources].some(s => targets.has(s));

  // Attach swap flag to the result (frontend calculates individual swap pairs)
  sortedSuggestions._hasSwaps = hasSwaps;

  // Attach zone capacity issues for alert rendering
  sortedSuggestions._zoneCapacityIssues = zoneCapacityIssues;

  return sortedSuggestions;
}

// ───────────────────────────────────────────────────────────
// Post-generation zone validator
// ───────────────────────────────────────────────────────────

/**
 * Validate that each non-overflow move's target slot is in a row allocated
 * to the declared toZoneId. Overflow moves are exempt because the placement
 * engine may have spilled them into a different zone intentionally.
 *
 * Does NOT remove invalid moves — it annotates them with a `zoneRowMismatch`
 * flag so that the auditor and UI can surface them as warnings.
 *
 * @param {Array} moves - Move suggestions from generateMoveSuggestions()
 * @param {Object} zoneMap - Row-to-zone mapping from getActiveZoneMap()
 * @returns {{annotatedMoves: Array, violations: Array}} Annotated moves and violation list
 */
export function validateMoveZoneAlignment(moves, zoneMap) {
  if (!Array.isArray(moves) || Object.keys(zoneMap).length === 0) {
    return { annotatedMoves: moves || [], violations: [] };
  }

  // Build reverse lookup: zoneId → Set of row IDs
  const zoneToRows = new Map();
  for (const [rowId, info] of Object.entries(zoneMap)) {
    if (!zoneToRows.has(info.zoneId)) zoneToRows.set(info.zoneId, new Set());
    zoneToRows.get(info.zoneId).add(rowId);
  }

  const violations = [];

  for (const move of moves) {
    // Only check type:'move' with a declared toZoneId that isn't overflow
    if (move.type !== 'move') continue;
    if (move.isOverflow) continue;
    if (!move.toZoneId) continue;
    if (!move.to) continue;

    const targetMatch = move.to.match?.(/^R(\d+)C\d+$/);
    if (!targetMatch) continue; // Fridge slots etc. — skip

    const targetRowId = `R${targetMatch[1]}`;
    const zoneRows = zoneToRows.get(move.toZoneId);

    if (!zoneRows || !zoneRows.has(targetRowId)) {
      // Target slot is NOT in a row allocated to the declared toZoneId
      const actualZoneInfo = zoneMap[targetRowId];
      move.zoneRowMismatch = true;
      move.actualTargetZoneId = actualZoneInfo?.zoneId || null;

      violations.push({
        wineId: move.wineId,
        wineName: move.wineName,
        from: move.from,
        to: move.to,
        declaredZoneId: move.toZoneId,
        actualZoneId: actualZoneInfo?.zoneId || null,
        targetRow: targetRowId,
        message: `${move.wineName || `Wine ${move.wineId}`} targets ${move.to} (${targetRowId}) but toZoneId "${move.toZoneId}" owns rows [${zoneRows ? [...zoneRows].join(', ') : 'none'}]`
      });
    }
  }

  return { annotatedMoves: moves, violations };
}

// ───────────────────────────────────────────────────────────
// Compaction move generation
// ───────────────────────────────────────────────────────────

/**
 * Generate compaction moves to fill gaps in rows.
 * Each move shifts a bottle into an empty slot to keep rows tightly packed.
 * @param {Map} slotToWine - Slot to wine mapping
 * @param {string} fillDirection - 'left' or 'right'
 * @returns {Array<Object>} Compaction move suggestions
 */
export function generateCompactionMoves(slotToWine, fillDirection = 'left') {
  const gaps = detectRowGaps(slotToWine, fillDirection);

  return gaps.map(gap => ({
    type: 'compaction',
    wineId: gap.wineId,
    wineName: gap.wineName,
    from: gap.shiftFrom,
    to: gap.gapSlot,
    reason: `Fill gap — keep row ${gap.row} packed from the ${fillDirection}`,
    confidence: 'high',
    priority: 4 // Lower priority than zone moves (1-3)
  }));
}

// ───────────────────────────────────────────────────────────
// Same-wine grouping within zone rows
// ───────────────────────────────────────────────────────────

/**
 * Generate swap moves that group same-wine bottles adjacently within each
 * zone's rows. For example, if Kleine Zalze Cab Sauv has bottles at R11C2
 * and R11C7, this suggests swaps so they end up next to each other.
 *
 * Only generates moves within the same row to keep swaps simple and
 * low-risk. Cross-row grouping is handled by the initial placement
 * adjacency logic in findSlotInRows.
 *
 * @param {Map} slotToWine - Map of slotId → wine object (with .id, .wine_name)
 * @param {Object} zoneMap - Row-to-zone mapping from getActiveZoneMap()
 * @returns {Array<Object>} Grouping swap suggestions (priority 5)
 */
export function generateSameWineGroupingMoves(slotToWine, zoneMap) {
  const moves = [];

  // Build per-row wine groups: row → Map<wineId, [{slotId, col}]>
  const rowWineGroups = new Map();
  for (const [slotId, wine] of slotToWine) {
    const parsed = parseSlot(slotId);
    if (!parsed) continue;
    const rowId = `R${parsed.row}`;
    if (!rowWineGroups.has(rowId)) rowWineGroups.set(rowId, new Map());
    const wineMap = rowWineGroups.get(rowId);
    if (!wineMap.has(wine.id)) wineMap.set(wine.id, []);
    wineMap.get(wine.id).push({ slotId, col: parsed.col, wine });
  }

  // For each row, find wines with 2+ bottles that aren't all adjacent
  for (const [rowId, wineMap] of rowWineGroups) {
    for (const [wineId, bottles] of wineMap) {
      if (bottles.length < 2) continue;

      // Sort by column
      bottles.sort((a, b) => a.col - b.col);

      // Check if already contiguous
      const isContiguous = bottles.every((b, i) =>
        i === 0 || b.col === bottles[i - 1].col + 1
      );
      if (isContiguous) continue;

      // Find the ideal contiguous block position.
      // Anchor on the leftmost bottle and try to consolidate others near it.
      const anchorCol = bottles[0].col;
      const wineName = bottles[0].wine.wine_name;

      // Build the current contiguous block starting from anchor
      const blockCols = new Set([anchorCol]);
      for (const b of bottles) {
        let adjacent = false;
        for (const bc of blockCols) {
          if (Math.abs(b.col - bc) === 1) {
            adjacent = true;
            break;
          }
        }
        if (adjacent) blockCols.add(b.col);
      }

      // Scattered bottles = those not in the contiguous block
      const scattered = bottles.filter(b => !blockCols.has(b.col));
      if (scattered.length === 0) continue;

      // For each scattered bottle, find best adjacent slot via swap
      const maxCol = rowId === 'R1' ? 7 : 9;
      const usedInThisRound = new Set();

      for (const scatteredBottle of scattered) {
        // Find adjacent slots near the anchor block
        const targetCols = [];
        for (const bc of blockCols) {
          if (bc - 1 >= 1) targetCols.push(bc - 1);
          if (bc + 1 <= maxCol) targetCols.push(bc + 1);
        }
        // Also consider slots adjacent to already-placed scattered bottles
        for (const placed of usedInThisRound) {
          if (placed - 1 >= 1) targetCols.push(placed - 1);
          if (placed + 1 <= maxCol) targetCols.push(placed + 1);
        }

        // Sort target columns by distance to anchor block center
        const blockCenter = [...blockCols].reduce((a, b) => a + b, 0) / blockCols.size;
        const uniqueTargets = [...new Set(targetCols)]
          .filter(c => c !== scatteredBottle.col && !blockCols.has(c) && !usedInThisRound.has(c))
          .sort((a, b) => Math.abs(a - blockCenter) - Math.abs(b - blockCenter));

        for (const targetCol of uniqueTargets) {
          const targetSlot = `${rowId}C${targetCol}`;
          const occupant = slotToWine.get(targetSlot);

          if (!occupant) {
            // Empty slot — simple move
            moves.push({
              type: 'grouping',
              wineId,
              wineName,
              from: scatteredBottle.slotId,
              to: targetSlot,
              reason: `Group ${wineName} bottles together in ${rowId}`,
              confidence: 'medium',
              priority: 5
            });
            blockCols.add(targetCol);
            usedInThisRound.add(targetCol);
            break;
          } else if (occupant.id !== wineId) {
            // Occupied by a different wine — propose swap
            moves.push({
              type: 'grouping',
              wineId,
              wineName,
              from: scatteredBottle.slotId,
              to: targetSlot,
              reason: `Group ${wineName} bottles together in ${rowId}`,
              confidence: 'medium',
              priority: 5
            });
            moves.push({
              type: 'grouping',
              wineId: occupant.id,
              wineName: occupant.wine_name,
              from: targetSlot,
              to: scatteredBottle.slotId,
              reason: `Make room for ${wineName} grouping in ${rowId}`,
              confidence: 'medium',
              priority: 5
            });
            blockCols.add(targetCol);
            usedInThisRound.add(targetCol);
            break;
          }
          // If occupied by same wine, skip (already grouped)
        }
      }
    }
  }

  return moves;
}

/**
 * Generate cross-row grouping moves for wines scattered across multiple rows
 * within the same zone. Only suggests moves when ALL scattered bottles can fit
 * into the anchor row (no partial consolidation).
 *
 * Must be called AFTER generateSameWineGroupingMoves() and receive the same-row
 * moves to avoid conflicting suggestions via occupancy tracking.
 *
 * @param {Map} slotToWine - Map of slotId → wine object (with .id, .wine_name)
 * @param {Object} zoneMap - Row-to-zone mapping from getActiveZoneMap()
 * @param {Array<Object>} sameRowMoves - Moves from generateSameWineGroupingMoves()
 * @returns {Array<Object>} Cross-row grouping move suggestions (priority 6)
 */
export function generateCrossRowGroupingMoves(slotToWine, zoneMap, sameRowMoves = []) {
  const moves = [];

  // Build simulated occupancy from same-row pass to avoid conflicts
  const allocatedTargets = new Set(sameRowMoves.map(m => m.to));
  const allocatedSources = new Set(sameRowMoves.map(m => m.from));

  // Build wineId → Map<zoneId, [{slotId, row, col}]>
  const wineZoneSlots = new Map();
  for (const [slotId, wine] of slotToWine) {
    const parsed = parseSlot(slotId);
    if (!parsed || parsed.row === 0) continue; // Skip fridge slots
    const rowId = `R${parsed.row}`;
    const zone = zoneMap[rowId];
    if (!zone) continue;
    const zoneId = zone.zoneId;

    if (!wineZoneSlots.has(wine.id)) wineZoneSlots.set(wine.id, new Map());
    const zoneSlots = wineZoneSlots.get(wine.id);
    if (!zoneSlots.has(zoneId)) zoneSlots.set(zoneId, []);
    zoneSlots.get(zoneId).push({ slotId, row: parsed.row, col: parsed.col, wine });
  }

  // Build current occupied set from slotToWine
  const occupiedSet = new Set(slotToWine.keys());

  for (const [wineId, zoneSlots] of wineZoneSlots) {
    for (const [zoneId, slots] of zoneSlots) {
      // Group by row
      const rowGroups = new Map();
      for (const s of slots) {
        if (!rowGroups.has(s.row)) rowGroups.set(s.row, []);
        rowGroups.get(s.row).push(s);
      }

      // Only care about wines spanning 2+ rows with 2+ total bottles
      if (rowGroups.size < 2 || slots.length < 2) continue;

      // Find anchor row (row with most bottles of this wine)
      let anchorRow = null;
      let anchorCount = 0;
      for (const [row, rowSlots] of rowGroups) {
        if (rowSlots.length > anchorCount) {
          anchorCount = rowSlots.length;
          anchorRow = row;
        }
      }

      // Scattered bottles = bottles NOT in anchor row, NOT already being moved by same-row pass
      const scattered = slots.filter(s =>
        s.row !== anchorRow && !allocatedSources.has(s.slotId)
      );
      if (scattered.length === 0) continue;

      // Count empty slots in anchor row, excluding already-allocated targets
      const maxCol = anchorRow === 1 ? 7 : 9;
      const emptyInAnchor = [];
      for (let c = 1; c <= maxCol; c++) {
        const slotId = `R${anchorRow}C${c}`;
        if (!occupiedSet.has(slotId) && !allocatedTargets.has(slotId)) {
          emptyInAnchor.push(slotId);
        }
      }

      // Only suggest when ALL scattered bottles can fit (no partial consolidation)
      if (emptyInAnchor.length < scattered.length) continue;

      // Find closest empty slots to existing anchor bottles for tight grouping
      const anchorCols = rowGroups.get(anchorRow).map(s => s.col);
      const anchorCenter = anchorCols.reduce((a, b) => a + b, 0) / anchorCols.length;

      const sortedEmpty = emptyInAnchor
        .map(slotId => {
          const col = parseInt(slotId.match(/C(\d+)$/)[1], 10);
          return { slotId, dist: Math.abs(col - anchorCenter) };
        })
        .sort((a, b) => a.dist - b.dist);

      const wineName = scattered[0].wine.wine_name;

      for (let i = 0; i < scattered.length; i++) {
        const target = sortedEmpty[i].slotId;
        moves.push({
          type: 'grouping',
          wineId,
          wineName,
          from: scattered[i].slotId,
          to: target,
          reason: `Consolidate ${wineName} into R${anchorRow} (cross-row grouping)`,
          confidence: 'medium',
          priority: 6
        });
        allocatedTargets.add(target); // Prevent collision within cross-row pass
      }
    }
  }

  return moves;
}
