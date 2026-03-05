/**
 * @fileoverview Deterministic unit tests for planRowGrouping.
 * All tests are self-contained — no DB, no imports beyond the module under test.
 */
import { describe, it, expect } from 'vitest';
import { planRowGrouping } from '../../../../src/services/cellar/cellarGrouping.js';

// Helper: build a board Map from an array of [col, wineId, wineName?] tuples
function makeBoard(entries) {
  const board = new Map();
  for (const [col, wineId, wineName] of entries) {
    board.set(col, { wineId, wineName: wineName ?? `Wine${wineId}` });
  }
  return board;
}

// Helper: apply all step moves atomically (snapshot all sources, delete all sources, then write all targets)
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

function colsOf(board, wineId) {
  return [...board.entries()]
    .filter(([, e]) => e.wineId === wineId)
    .map(([col]) => col)
    .sort((a, b) => a - b);
}

function isContiguous(cols) {
  return cols.every((c, i) => i === 0 || c === cols[i - 1] + 1);
}

// ───────────────────────────────────────────────────────────
// Edge / trivial cases
// ───────────────────────────────────────────────────────────

describe('planRowGrouping — edge cases', () => {
  it('returns empty plan for empty board', () => {
    const plan = planRowGrouping(new Map(), 9);
    expect(plan.steps).toHaveLength(0);
    expect(plan.cost).toBe(0);
  });

  it('returns empty plan when board is null', () => {
    const plan = planRowGrouping(null, 9);
    expect(plan.steps).toHaveLength(0);
  });

  it('returns empty plan for maxCol < 1', () => {
    const board = makeBoard([[1, 1], [3, 1]]);
    const plan = planRowGrouping(board, 0);
    expect(plan.steps).toHaveLength(0);
  });

  it('returns empty plan when all wines are single-bottle', () => {
    const board = makeBoard([[1, 10], [4, 20], [7, 30]]);
    const plan = planRowGrouping(board, 9);
    expect(plan.steps).toHaveLength(0);
    expect(plan.cost).toBe(0);
  });

  it('returns empty plan when multi-bottle wine is already contiguous', () => {
    // W1 at C3,C4 — already adjacent; wine 99 is a single bottle (no grouping needed)
    const board = makeBoard([[1, 99], [3, 1], [4, 1]]);
    const plan = planRowGrouping(board, 9);
    expect(plan.steps).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────
// Simple move cases (chain — destination is empty)
// ───────────────────────────────────────────────────────────

describe('planRowGrouping — simple moves', () => {
  it('moves a scattered bottle to make wine contiguous', () => {
    // Wine 1 at C1 and C5; empty C2 nearby
    const board = makeBoard([[1, 1, 'Riesling'], [5, 1, 'Riesling']]);
    const plan = planRowGrouping(board, 9);

    expect(plan.steps.length).toBeGreaterThan(0);
    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 1))).toBe(true);
  });

  it('generates exactly one step for a trivial 2-bottle gap with empty target', () => {
    // Wine at C1,C3; C2 is empty → move C3→C2
    const board = makeBoard([[1, 1], [3, 1]]);
    const plan = planRowGrouping(board, 9);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].stepType).toBe('move');
    expect(plan.steps[0].moves[0].from).toBe(3);
    expect(plan.steps[0].moves[0].to).toBe(2);
  });

  it('assigns correct wineId and wineName to move', () => {
    const board = makeBoard([[2, 42, 'Chateau X'], [5, 42, 'Chateau X']]);
    const plan = planRowGrouping(board, 9);

    const allMoves = plan.steps.flatMap(s => s.moves);
    for (const m of allMoves) {
      if (m.wineId === 42) {
        expect(m.wineName).toBe('Chateau X');
      }
    }
  });

  it('handles 3-bottle wine scattered across 9-slot row', () => {
    // Wine at C1,C5,C9 — minimum-cost block is C1,C2,C3 or similar
    const board = makeBoard([[1, 7], [5, 7], [9, 7]]);
    const plan = planRowGrouping(board, 9);

    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 7))).toBe(true);
  });

  it('handles variable maxCol (5-slot row)', () => {
    // W1 at C1,C5 in a 5-slot row: target block C1,C2. Move C5→C2.
    const board = makeBoard([[1, 1], [5, 1]]);
    const plan = planRowGrouping(board, 5);

    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 1))).toBe(true);
    // C5 should be vacated
    expect(finalBoard.has(5)).toBe(false);
  });

  it('handles 7-slot row (R1 legacy capacity)', () => {
    const board = makeBoard([[1, 5], [4, 5], [7, 5]]);
    const plan = planRowGrouping(board, 7);

    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 5))).toBe(true);
  });

  it('handles 12-slot row', () => {
    const board = makeBoard([[1, 3], [6, 3], [12, 3]]);
    const plan = planRowGrouping(board, 12);

    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 3))).toBe(true);
  });

  it('returns 0 cost for already-contiguous multi-bottle wine', () => {
    const board = makeBoard([[3, 1], [4, 1], [5, 1]]);
    const plan = planRowGrouping(board, 9);
    expect(plan.steps).toHaveLength(0);
    expect(plan.cost).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────
// Swap cases (2-element cycle)
// ───────────────────────────────────────────────────────────

describe('planRowGrouping — swaps', () => {
  it('resolves a mutual swap when two wines need to exchange positions', () => {
    // W1 at C1,C3; W2 at C2,C4 → optimal: W1 to C1,C2 (move C3→C2), W2 to C3,C4 (move C2→C3)
    // This is a 2-cycle. Both are primary moves (mutual swap).
    const board = makeBoard([[1, 1], [2, 2], [3, 1], [4, 2]]);
    const plan = planRowGrouping(board, 9);

    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 1))).toBe(true);
    expect(isContiguous(colsOf(finalBoard, 2))).toBe(true);
  });

  it('tags displacement with isDisplacement=true when target is occupied by non-moving wine', () => {
    // W1 at C1,C3; W2 (single bottle) at C2 — W1 wants C1,C2 but C2 has W2
    // → W1's move C3→C2. W2 at C2 displaced to C3 (isDisplacement=true).
    const board = makeBoard([[1, 1, 'Pinot'], [2, 99, 'Other'], [3, 1, 'Pinot']]);
    const plan = planRowGrouping(board, 9);

    const allMoves = plan.steps.flatMap(s => s.moves);
    const displacement = allMoves.find(m => m.isDisplacement);
    expect(displacement).toBeDefined();
    expect(displacement.wineId).toBe(99);
  });

  it('produces a swap step for the 2-cycle case', () => {
    const board = makeBoard([[1, 1], [2, 2], [3, 1], [4, 2]]);
    const plan = planRowGrouping(board, 9);

    const swapSteps = plan.steps.filter(s => s.stepType === 'swap');
    expect(swapSteps.length).toBeGreaterThan(0);
    // Swap step has exactly 2 moves
    for (const step of swapSteps) {
      expect(step.moves).toHaveLength(2);
    }
  });

  it('returns stepNumber starting from 1', () => {
    const board = makeBoard([[1, 1], [3, 1]]); // simple move
    const plan = planRowGrouping(board, 9);

    expect(plan.steps[0].stepNumber).toBe(1);
    if (plan.steps.length > 1) {
      plan.steps.forEach((s, i) => expect(s.stepNumber).toBe(i + 1));
    }
  });
});

// ───────────────────────────────────────────────────────────
// Rotation cases (k-cycle, k > 2)
// ───────────────────────────────────────────────────────────

describe('planRowGrouping — rotations', () => {
  it('resolves a 3-element rotation cycle', () => {
    // Force a 3-cycle: W1 at C1,C4; W2 at C2,C5; W3 at C3,C6— interleaved in 6-slot row
    // Min-cost assignment: W1→C1,C2, W2→C3,C4, W3→C5,C6
    const board = makeBoard([[1,1],[2,2],[3,3],[4,1],[5,2],[6,3]]);
    const plan = planRowGrouping(board, 9);

    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 1))).toBe(true);
    expect(isContiguous(colsOf(finalBoard, 2))).toBe(true);
    expect(isContiguous(colsOf(finalBoard, 3))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// Ordering invariant
// ───────────────────────────────────────────────────────────

describe('planRowGrouping — step ordering', () => {
  it('simple moves come before swaps come before rotations', () => {
    const typeOrder = { move: 0, swap: 1, rotation: 2 };
    // Create a board that should produce at least a move
    const board = makeBoard([[1, 1], [5, 1], [3, 2], [7, 2]]);
    const plan = planRowGrouping(board, 9);

    for (let i = 1; i < plan.steps.length; i++) {
      const prev = typeOrder[plan.steps[i - 1].stepType] ?? 0;
      const curr = typeOrder[plan.steps[i].stepType] ?? 0;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('each step has stepNumber equal to its 1-based index', () => {
    const board = makeBoard([[1, 1], [5, 1], [3, 2], [7, 2]]);
    const plan = planRowGrouping(board, 9);

    plan.steps.forEach((s, i) => {
      expect(s.stepNumber).toBe(i + 1);
    });
  });
});

// ───────────────────────────────────────────────────────────
// Multi-wine full-row reorganisation
// ───────────────────────────────────────────────────────────

describe('planRowGrouping — full-row scenarios', () => {
  it('groups two wines interleaved in a 9-slot row', () => {
    // W1 at odd positions, W2 at even — should group each into contiguous blocks
    const board = makeBoard([[1,1],[2,2],[3,1],[4,2],[5,1],[6,2]]);
    const plan = planRowGrouping(board, 9);

    const finalBoard = applyMovesAtomic(board, plan);
    expect(isContiguous(colsOf(finalBoard, 1))).toBe(true);
    expect(isContiguous(colsOf(finalBoard, 2))).toBe(true);
  });

  it('handles an already-sorted full row with no moves', () => {
    // W1 at C1-C3, W2 at C4-C6, W3 at C7-C9 — all contiguous
    const board = makeBoard([[1,1],[2,1],[3,1],[4,2],[5,2],[6,2],[7,3],[8,3],[9,3]]);
    const plan = planRowGrouping(board, 9);
    expect(plan.steps).toHaveLength(0);
  });

  it('preserves board bottle count after moves', () => {
    const board = makeBoard([[1,1],[2,2],[3,1],[4,2],[5,3],[6,3],[7,1],[8,2],[9,3]]);
    const plan = planRowGrouping(board, 9);
    const finalBoard = applyMovesAtomic(board, plan);

    // Same number of occupied slots
    expect(finalBoard.size).toBe(board.size);
    // Same wine IDs present
    const before = [...board.values()].map(e => e.wineId).sort();
    const after = [...finalBoard.values()].map(e => e.wineId).sort();
    expect(after).toEqual(before);
  });

  it('does not produce duplicate from or to slots within a step', () => {
    const board = makeBoard([[1,1],[2,2],[3,1],[4,2],[5,3],[6,3]]);
    const plan = planRowGrouping(board, 9);

    for (const step of plan.steps) {
      const froms = step.moves.map(m => m.from);
      const tos = step.moves.map(m => m.to);
      expect(new Set(froms).size).toBe(froms.length); // no duplicate froms
      expect(new Set(tos).size).toBe(tos.length); // no duplicate tos
    }
  });

  it('cost equals the sum of absolute displacements across all moves', () => {
    const board = makeBoard([[1, 1], [5, 1]]);
    const plan = planRowGrouping(board, 9);

    let manualCost = 0;
    for (const step of plan.steps) {
      for (const m of step.moves) {
        manualCost += Math.abs(m.from - m.to);
      }
    }
    expect(plan.cost).toBe(manualCost);
  });

  it('empty row returns no steps', () => {
    const plan = planRowGrouping(new Map(), 9);
    expect(plan.steps).toHaveLength(0);
    expect(plan.cost).toBe(0);
  });
});
