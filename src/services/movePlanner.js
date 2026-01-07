/**
 * @fileoverview Move planner for effort-minimised cellar reorganisation.
 * Optimises moves to minimise total effort while achieving zone consolidation.
 * @module services/movePlanner
 */

import db from '../db/index.js';

/**
 * Move types with effort scores.
 * Lower is better (less effort).
 */
const MOVE_EFFORT = {
  NONE: 0,           // No move needed
  SINGLE: 1,         // Direct move to empty slot
  SWAP: 2,           // Two-way swap
  CHAIN: 3,          // Multi-step chain move
  MANUAL: 5          // Requires manual intervention
};

/**
 * Plan optimised moves for zone consolidation.
 * @param {Array} misplacedWines - Wines not in their target zone
 * @param {Object} zoneSlots - Map of zone ID to available slots
 * @param {Object} options - Planning options
 * @returns {Object} Optimised move plan
 */
export function planMoves(misplacedWines, zoneSlots, options = {}) {
  const {
    maxMoves = 50,
    preferBatching = true,
    minimiseSwaps = true
  } = options;

  const plan = {
    moves: [],
    swaps: [],
    chains: [],
    skipped: [],
    stats: {
      totalMoves: 0,
      singleMoves: 0,
      swapMoves: 0,
      chainMoves: 0,
      totalEffort: 0
    }
  };

  // Create working copy of zone slots
  const availableSlots = JSON.parse(JSON.stringify(zoneSlots));

  // Sort misplaced wines by priority:
  // 1. High confidence zone matches first
  // 2. Wines with available slots in target zone
  // 3. Lower row numbers (top of cellar) first
  const sortedWines = [...misplacedWines].sort((a, b) => {
    // Confidence first
    const confOrder = { high: 0, medium: 1, low: 2 };
    const confDiff = (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
    if (confDiff !== 0) return confDiff;

    // Available slots in target zone
    const aSlots = availableSlots[a.targetZone]?.length || 0;
    const bSlots = availableSlots[b.targetZone]?.length || 0;
    if (aSlots !== bSlots) return bSlots - aSlots;

    // Row number
    return extractRowNumber(a.currentSlot) - extractRowNumber(b.currentSlot);
  });

  // Process each misplaced wine
  for (const wine of sortedWines) {
    if (plan.moves.length >= maxMoves) {
      plan.skipped.push({
        ...wine,
        reason: 'Max moves reached'
      });
      continue;
    }

    const targetSlots = availableSlots[wine.targetZone] || [];

    if (targetSlots.length > 0) {
      // Simple single move - slot available
      const targetSlot = findBestSlot(targetSlots, wine, preferBatching);
      plan.moves.push({
        type: 'single',
        wineId: wine.wineId,
        wineName: wine.wineName,
        vintage: wine.vintage,
        from: wine.currentSlot,
        to: targetSlot,
        zoneId: wine.targetZone,
        reason: wine.reason,
        confidence: wine.confidence,
        effort: MOVE_EFFORT.SINGLE
      });

      // Remove slot from available
      const slotIndex = targetSlots.indexOf(targetSlot);
      if (slotIndex > -1) targetSlots.splice(slotIndex, 1);

      // Add vacated slot to its zone
      const vacatedZone = getZoneForSlot(wine.currentSlot);
      if (vacatedZone && availableSlots[vacatedZone]) {
        availableSlots[vacatedZone].push(wine.currentSlot);
      }

      plan.stats.singleMoves++;
      plan.stats.totalEffort += MOVE_EFFORT.SINGLE;
    } else if (!minimiseSwaps) {
      // Try to find a swap opportunity
      const swapResult = findSwapOpportunity(wine, sortedWines, availableSlots);
      if (swapResult) {
        plan.swaps.push(swapResult);
        plan.stats.swapMoves++;
        plan.stats.totalEffort += MOVE_EFFORT.SWAP;
      } else {
        plan.skipped.push({
          ...wine,
          reason: 'No slot available and no swap found'
        });
      }
    } else {
      plan.skipped.push({
        ...wine,
        reason: 'No slot available in target zone'
      });
    }
  }

  plan.stats.totalMoves = plan.moves.length + plan.swaps.length;

  return plan;
}

/**
 * Find best slot for a wine (prefers adjacent to same wines if batching).
 * @param {string[]} slots - Available slots
 * @param {Object} wine - Wine being moved
 * @param {boolean} preferBatching - Prefer slots near same wines
 * @returns {string} Best slot
 */
function findBestSlot(slots, wine, preferBatching) {
  if (!preferBatching || slots.length === 1) {
    return slots[0];
  }

  // Check for adjacent slots with same wine already there
  const wineSlots = db.prepare(
    'SELECT location_code FROM slots WHERE wine_id = ?'
  ).all(wine.wineId);

  const existingLocations = new Set(wineSlots.map(s => s.location_code));

  // Score each slot by proximity to existing bottles of same wine
  let bestSlot = slots[0];
  let bestScore = -1;

  for (const slot of slots) {
    const score = calculateProximityScore(slot, existingLocations);
    if (score > bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  }

  return bestSlot;
}

/**
 * Calculate proximity score for a slot.
 * @param {string} slot - Slot to score
 * @param {Set<string>} existingLocations - Existing wine locations
 * @returns {number} Proximity score
 */
function calculateProximityScore(slot, existingLocations) {
  const { row, col } = parseSlot(slot);
  let score = 0;

  for (const existing of existingLocations) {
    const existingParsed = parseSlot(existing);
    if (existingParsed.row === row) {
      // Same row bonus
      score += 2;
      // Adjacent column bonus
      if (Math.abs(existingParsed.col - col) === 1) {
        score += 5;
      }
    }
  }

  return score;
}

/**
 * Find swap opportunity for a wine.
 * @param {Object} wine - Wine needing swap
 * @param {Array} allWines - All misplaced wines
 * @param {Object} availableSlots - Available slots by zone
 * @returns {Object|null} Swap move or null
 */
function findSwapOpportunity(wine, allWines, _availableSlots) {
  // Look for a wine in the target zone that wants to be where this wine is
  const wineZone = getZoneForSlot(wine.currentSlot);

  for (const other of allWines) {
    if (other.wineId === wine.wineId) continue;

    // Check if other wine is in our target zone and wants to be in our current zone
    const otherZone = getZoneForSlot(other.currentSlot);
    if (otherZone === wine.targetZone && other.targetZone === wineZone) {
      return {
        type: 'swap',
        wine1: {
          wineId: wine.wineId,
          wineName: wine.wineName,
          from: wine.currentSlot,
          to: other.currentSlot
        },
        wine2: {
          wineId: other.wineId,
          wineName: other.wineName,
          from: other.currentSlot,
          to: wine.currentSlot
        },
        effort: MOVE_EFFORT.SWAP
      };
    }
  }

  return null;
}

/**
 * Parse slot into row and column.
 * @param {string} slot - Slot code (e.g., "R3C5", "F2")
 * @returns {Object} {row, col}
 */
function parseSlot(slot) {
  if (slot.startsWith('F')) {
    return { row: 0, col: parseInt(slot.slice(1)) };
  }
  const match = slot.match(/^R(\d+)C(\d+)$/);
  if (match) {
    return { row: parseInt(match[1]), col: parseInt(match[2]) };
  }
  return { row: 0, col: 0 };
}

/**
 * Extract row number from slot.
 * @param {string} slot - Slot code
 * @returns {number} Row number
 */
function extractRowNumber(slot) {
  const match = slot.match(/^R(\d+)C/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * Get zone for a slot based on zone layout.
 * @param {string} slot - Slot code
 * @returns {string|null} Zone ID
 */
function getZoneForSlot(slot) {
  const row = extractRowNumber(slot);
  if (row === 0) return 'fridge';

  // Look up in zone_layout
  const layout = db.prepare(
    'SELECT zone_id FROM zone_layout WHERE assigned_rows LIKE ?'
  ).get(`%R${row}%`);

  return layout?.zone_id || null;
}

/**
 * Batch moves by zone for efficient execution.
 * @param {Array} moves - Individual moves
 * @returns {Object} Batched moves by zone
 */
export function batchMovesByZone(moves) {
  const batches = {};

  for (const move of moves) {
    const zoneId = move.zoneId || 'unclassified';
    if (!batches[zoneId]) {
      batches[zoneId] = {
        zoneId,
        moves: [],
        totalBottles: 0
      };
    }
    batches[zoneId].moves.push(move);
    batches[zoneId].totalBottles++;
  }

  // Sort batches by size (biggest first for visibility)
  const sortedBatches = Object.values(batches).sort(
    (a, b) => b.totalBottles - a.totalBottles
  );

  return {
    batches: sortedBatches,
    totalMoves: moves.length,
    zoneCount: sortedBatches.length
  };
}

/**
 * Calculate move statistics.
 * @param {Object} plan - Move plan
 * @returns {Object} Statistics
 */
export function calculateMoveStats(plan) {
  return {
    totalMoves: plan.moves.length + plan.swaps.length * 2,
    singleMoves: plan.moves.filter(m => m.type === 'single').length,
    swaps: plan.swaps.length,
    skipped: plan.skipped.length,
    totalEffort: plan.stats.totalEffort,
    averageEffort: plan.stats.totalMoves > 0
      ? (plan.stats.totalEffort / plan.stats.totalMoves).toFixed(2)
      : 0,
    efficiency: plan.skipped.length > 0
      ? (plan.stats.totalMoves / (plan.stats.totalMoves + plan.skipped.length) * 100).toFixed(1)
      : 100
  };
}

/**
 * Generate human-readable move summary.
 * @param {Object} plan - Move plan
 * @returns {string} Summary text
 */
export function generateMoveSummary(plan) {
  const stats = calculateMoveStats(plan);

  const parts = [];

  if (stats.singleMoves > 0) {
    parts.push(`${stats.singleMoves} direct move${stats.singleMoves !== 1 ? 's' : ''}`);
  }

  if (stats.swaps > 0) {
    parts.push(`${stats.swaps} swap${stats.swaps !== 1 ? 's' : ''}`);
  }

  if (stats.skipped > 0) {
    parts.push(`${stats.skipped} skipped (no slot available)`);
  }

  const summary = parts.join(', ');
  const efficiency = stats.efficiency < 100
    ? ` (${stats.efficiency}% can be automated)`
    : ' (all automated)';

  return summary + efficiency;
}

/**
 * Validate a move plan before execution.
 * @param {Object} plan - Move plan
 * @returns {Object} Validation result
 */
export function validatePlan(plan) {
  const issues = [];

  // Check for duplicate targets
  const targets = new Set();
  for (const move of plan.moves) {
    if (targets.has(move.to)) {
      issues.push(`Duplicate target slot: ${move.to}`);
    }
    targets.add(move.to);
  }

  // Check for circular moves
  const sources = new Set(plan.moves.map(m => m.from));
  for (const move of plan.moves) {
    if (sources.has(move.to)) {
      issues.push(`Potential circular move involving ${move.to}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export { MOVE_EFFORT };
