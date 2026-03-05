/**
 * @fileoverview Property-based tests for planRowGrouping.
 *
 * Uses an inline Mulberry32 LCG (no external deps) to generate 500+ random
 * boards and validate key invariants on every output plan.
 *
 * Invariants under test:
 *   1. Conservation  — same wine IDs and bottle counts before and after
 *   2. Contiguity    — every multi-bottle wine is contiguous after steps applied
 *   3. Step safety   — each step applied atomically leaves board consistent
 *   4. Bounded cost  — total cost ≤ 2 × (maxCol × bottles in row)
 *   5. Idempotency   — applying plan to its own output yields 0 steps
 */
import { describe, it, expect } from 'vitest';
import { planRowGrouping } from '../../../../src/services/cellar/cellarGrouping.js';

// ───────────────────────────────────────────────────────────
// Inline Mulberry32 LCG (no external deps)
// ───────────────────────────────────────────────────────────

/**
 * Create a seedable Mulberry32 pseudo-random number generator.
 * Returns a function that yields values in [0, 1).
 * @param {number} seed - 32-bit unsigned integer
 * @returns {() => number}
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────────────────────────────────────
// Board generation
// ───────────────────────────────────────────────────────────

/**
 * Generate a random board for a single row.
 * @param {() => number} rand - RNG function
 * @param {number} maxCol - Row capacity
 * @param {number} maxWines - Max distinct wine IDs
 * @returns {Map<number, {wineId: number, wineName: string}>}
 */
function randomBoard(rand, maxCol, maxWines) {
  const board = new Map();
  const fill = Math.floor(rand() * maxCol) + 1; // 1 to maxCol bottles
  const slots = Array.from({ length: maxCol }, (_, i) => i + 1);

  // Fisher-Yates shuffle to pick fill random slots
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  for (let i = 0; i < fill; i++) {
    const col = slots[i];
    const wineId = Math.floor(rand() * maxWines) + 1;
    board.set(col, { wineId, wineName: `Wine${wineId}` });
  }
  return board;
}

// ───────────────────────────────────────────────────────────
// Board application helpers
// ───────────────────────────────────────────────────────────

function applyMovesAtomic(board, plan) {
  const result = new Map(board);
  for (const step of plan.steps) {
    const snapshots = new Map(step.moves.map(m => [m.from, result.get(m.from)]));
    for (const m of step.moves) result.delete(m.from);
    for (const m of step.moves) {
      const val = snapshots.get(m.from);
      if (val !== undefined) result.set(m.to, val);
    }
  }
  return result;
}

function wineBottleCounts(board) {
  const counts = new Map();
  for (const { wineId } of board.values()) {
    counts.set(wineId, (counts.get(wineId) ?? 0) + 1);
  }
  return counts;
}

function isContiguous(cols) {
  if (cols.length <= 1) return true;
  return cols.every((c, i) => i === 0 || c === cols[i - 1] + 1);
}

// ───────────────────────────────────────────────────────────
// Invariant checkers
// ───────────────────────────────────────────────────────────

function checkConservation(before, after) {
  const beforeCounts = wineBottleCounts(before);
  const afterCounts = wineBottleCounts(after);

  if (beforeCounts.size !== afterCounts.size) return false;
  for (const [wineId, count] of beforeCounts) {
    if (afterCounts.get(wineId) !== count) return false;
  }
  return true;
}

function checkContiguity(board) {
  const wineColsMap = new Map();
  for (const [col, { wineId }] of board) {
    if (!wineColsMap.has(wineId)) wineColsMap.set(wineId, []);
    wineColsMap.get(wineId).push(col);
  }
  for (const cols of wineColsMap.values()) {
    if (cols.length >= 2) {
      const sorted = cols.slice().sort((a, b) => a - b);
      if (!isContiguous(sorted)) return false;
    }
  }
  return true;
}

// ───────────────────────────────────────────────────────────
// Property-based test suite
// ───────────────────────────────────────────────────────────

describe('planRowGrouping — property-based invariants (500+ random trials)', () => {
  const TRIALS = 500;
  const SEED = 0xDEADBEEF; // Deterministic seed for reproducibility
  const rand = mulberry32(SEED);

  // Row configurations to vary across trials
  const rowConfigs = [5, 7, 9, 9, 9, 12]; // weighted toward 9

  it('[1] Conservation: output board has exactly the same wine IDs and counts as input', () => {
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);
      const afterBoard = applyMovesAtomic(board, plan);

      if (!checkConservation(board, afterBoard)) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });

  it('[2] Contiguity: every multi-bottle wine is contiguous after applying all steps', () => {
    const rand2 = mulberry32(0xCAFEBABE);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand2, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);
      const afterBoard = applyMovesAtomic(board, plan);

      if (!checkContiguity(afterBoard)) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });

  it('[3] Step safety: each step can be applied atomically without losing bottles', () => {
    const rand3 = mulberry32(0x0F0F0F0F);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand3, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);

      // Apply step-by-step and verify bottle count doesn't change at any step
      let current = new Map(board);
      const totalBottles = board.size;
      for (const step of plan.steps) {
        const snapshots = new Map(step.moves.map(m => [m.from, current.get(m.from)]));
        // Apply atomically: delete all sources first, then set all destinations.
        // This correctly handles swap/rotation cycles where from/to overlap.
        for (const m of step.moves) current.delete(m.from);
        for (const m of step.moves) {
          const val = snapshots.get(m.from);
          if (val !== undefined) current.set(m.to, val);
        }
        if (current.size !== totalBottles) {
          failures++;
          break;
        }
      }
    }
    expect(failures).toBe(0);
  });

  it('[4] Bounded cost: total cost ≤ 2 × (maxCol × board.size)', () => {
    const rand4 = mulberry32(0x11223344);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand4, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);

      const bound = 2 * maxCol * board.size;
      if (plan.cost > bound) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });

  it('[5] Idempotency: applying plan to its own output yields 0 steps or same result', () => {
    const rand5 = mulberry32(0xABCDEF01);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand5, maxCol, 4);
      const plan1 = planRowGrouping(board, maxCol);
      const afterBoard1 = applyMovesAtomic(board, plan1);

      // Plan on the already-optimised board should require 0 steps
      const plan2 = planRowGrouping(afterBoard1, maxCol);
      if (plan2.steps.length !== 0) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });

  it('[6] No duplicate from-slots within a single step', () => {
    const rand6 = mulberry32(0x55AA55AA);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand6, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);

      for (const step of plan.steps) {
        const froms = step.moves.map(m => m.from);
        if (new Set(froms).size !== froms.length) {
          failures++;
          break;
        }
      }
    }
    expect(failures).toBe(0);
  });

  it('[7] No duplicate to-slots within a single step', () => {
    const rand7 = mulberry32(0xFF00FF00);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand7, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);

      for (const step of plan.steps) {
        const tos = step.moves.map(m => m.to);
        if (new Set(tos).size !== tos.length) {
          failures++;
          break;
        }
      }
    }
    expect(failures).toBe(0);
  });

  it('[8] All from/to columns within [1, maxCol]', () => {
    const rand8 = mulberry32(0x12345678);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand8, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);

      for (const step of plan.steps) {
        for (const m of step.moves) {
          if (m.from < 1 || m.from > maxCol || m.to < 1 || m.to > maxCol) {
            failures++;
            break;
          }
        }
        if (failures > 0) break;
      }
    }
    expect(failures).toBe(0);
  });

  it('[9] Step numbering is sequential 1-based', () => {
    const rand9 = mulberry32(0x87654321);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand9, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);

      for (let j = 0; j < plan.steps.length; j++) {
        if (plan.steps[j].stepNumber !== j + 1) {
          failures++;
          break;
        }
      }
    }
    expect(failures).toBe(0);
  });

  it('[10] Reported cost matches sum of |from-to| across all moves', () => {
    const rand10 = mulberry32(0xFEDCBA98);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      const board = randomBoard(rand10, maxCol, 4);
      const plan = planRowGrouping(board, maxCol);

      let manualCost = 0;
      for (const step of plan.steps) {
        for (const m of step.moves) {
          manualCost += Math.abs(m.from - m.to);
        }
      }
      if (plan.cost !== manualCost) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });

  it('[11] Out-of-range source columns: handles board entries beyond maxCol (post-resize)', () => {
    // Simulates a row that was resized from 12 to 9 columns — existing bottles at cols 10-12
    // should still produce a valid, conservative plan (or no-op) without crashing.
    const rand11 = mulberry32(0x1234ABCD);
    let failures = 0;
    for (let i = 0; i < TRIALS; i++) {
      const maxCol = rowConfigs[i % rowConfigs.length];
      // Build a board with some columns beyond maxCol (simulating data drift)
      const board = randomBoard(rand11, maxCol, 4);
      // Add 1-2 bottles at out-of-range positions
      const overflowCol1 = maxCol + 1 + Math.floor(rand11() * 3);
      const overflowCol2 = overflowCol1 + 1;
      const wineId = Math.floor(rand11() * 4) + 1;
      board.set(overflowCol1, { wineId, wineName: `Wine${wineId}` });
      if (rand11() > 0.5) {
        board.set(overflowCol2, { wineId, wineName: `Wine${wineId}` });
      }

      let plan;
      try {
        plan = planRowGrouping(board, maxCol);
      } catch {
        failures++;
        continue;
      }
      // Conservation must still hold
      const afterBoard = applyMovesAtomic(board, plan);
      if (afterBoard.size !== board.size) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });
});
