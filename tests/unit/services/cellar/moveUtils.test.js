/**
 * @fileoverview Unit tests for moveUtils — shared swap/dependency detection.
 * @module tests/unit/services/cellar/moveUtils.test
 */

import { detectSwapPairs, hasMoveDependencies } from '../../../../src/services/cellar/moveUtils.js';

// ─── detectSwapPairs ─────────────────────────────────────────

describe('detectSwapPairs', () => {
  it('detects a simple swap pair (A→B + B→A)', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1', type: 'move' },
      { from: 'R2C1', to: 'R1C1', type: 'move' }
    ];
    const partners = detectSwapPairs(moves);
    expect(partners.get(0)).toBe(1);
    expect(partners.get(1)).toBe(0);
  });

  it('returns empty map when no swaps exist', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1', type: 'move' },
      { from: 'R3C1', to: 'R4C1', type: 'move' }
    ];
    const partners = detectSwapPairs(moves);
    expect(partners.size).toBe(0);
  });

  it('handles empty moves array', () => {
    const partners = detectSwapPairs([]);
    expect(partners.size).toBe(0);
  });

  it('handles single move (no partner possible)', () => {
    const moves = [{ from: 'R1C1', to: 'R2C1', type: 'move' }];
    const partners = detectSwapPairs(moves);
    expect(partners.size).toBe(0);
  });

  it('detects multiple swap pairs in one list', () => {
    const moves = [
      { from: 'R1C1', to: 'R1C2', type: 'move' },
      { from: 'R3C1', to: 'R3C2', type: 'move' },
      { from: 'R1C2', to: 'R1C1', type: 'move' },
      { from: 'R3C2', to: 'R3C1', type: 'move' }
    ];
    const partners = detectSwapPairs(moves);
    expect(partners.size).toBe(4);
    expect(partners.get(0)).toBe(2);
    expect(partners.get(2)).toBe(0);
    expect(partners.get(1)).toBe(3);
    expect(partners.get(3)).toBe(1);
  });

  it('applies typeFilter to only consider matching move types', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1', type: 'move' },
      { from: 'R2C1', to: 'R1C1', type: 'suggestion' }
    ];
    const partners = detectSwapPairs(moves, { typeFilter: 'move' });
    // Second move has type 'suggestion', so no swap detected
    expect(partners.size).toBe(0);
  });

  it('detects swaps when both match the typeFilter', () => {
    const moves = [
      { from: 'R1C1', to: 'R2C1', type: 'move' },
      { from: 'R2C1', to: 'R1C1', type: 'move' }
    ];
    const partners = detectSwapPairs(moves, { typeFilter: 'move' });
    expect(partners.size).toBe(2);
  });

  it('does not pair a move with itself', () => {
    const moves = [
      { from: 'R1C1', to: 'R1C1', type: 'move' }
    ];
    const partners = detectSwapPairs(moves);
    expect(partners.size).toBe(0);
  });

  it('only pairs each move once (first match wins)', () => {
    // Three moves where indices 0 and 1 are swaps, and index 2 also matches 0
    const moves = [
      { from: 'R1C1', to: 'R2C1', type: 'move' },
      { from: 'R2C1', to: 'R1C1', type: 'move' },
      { from: 'R2C1', to: 'R1C1', type: 'move' }
    ];
    const partners = detectSwapPairs(moves);
    // Index 0 pairs with index 1; index 2 is unpaired
    expect(partners.get(0)).toBe(1);
    expect(partners.get(1)).toBe(0);
    expect(partners.has(2)).toBe(false);
  });
});

// ─── hasMoveDependencies ─────────────────────────────────────

describe('hasMoveDependencies', () => {
  it('returns false for independent moves', () => {
    const moves = [
      { type: 'move', from: 'R1C1', to: 'R2C1' },
      { type: 'move', from: 'R3C1', to: 'R4C1' }
    ];
    expect(hasMoveDependencies(moves)).toBe(false);
  });

  it('returns true when a target overlaps a source (swap)', () => {
    const moves = [
      { type: 'move', from: 'R1C1', to: 'R2C1' },
      { type: 'move', from: 'R2C1', to: 'R3C1' }
    ];
    expect(hasMoveDependencies(moves)).toBe(true);
  });

  it('returns true for circular dependency (A→B, B→C, C→A)', () => {
    const moves = [
      { type: 'move', from: 'R1C1', to: 'R2C1' },
      { type: 'move', from: 'R2C1', to: 'R3C1' },
      { type: 'move', from: 'R3C1', to: 'R1C1' }
    ];
    expect(hasMoveDependencies(moves)).toBe(true);
  });

  it('returns false for empty array', () => {
    expect(hasMoveDependencies([])).toBe(false);
  });

  it('returns false for non-array input', () => {
    expect(hasMoveDependencies(null)).toBe(false);
    expect(hasMoveDependencies(undefined)).toBe(false);
    expect(hasMoveDependencies('not an array')).toBe(false);
  });

  it('filters only type=move, ignores other types', () => {
    const suggestions = [
      { type: 'info', from: 'R1C1', to: 'R2C1' },
      { type: 'move', from: 'R3C1', to: 'R4C1' },
      { type: 'suggestion', from: 'R4C1', to: 'R3C1' }
    ];
    // Only the one 'move' type item is considered — no overlap with itself
    expect(hasMoveDependencies(suggestions)).toBe(false);
  });

  it('detects dependency among only the move-type items', () => {
    const suggestions = [
      { type: 'move', from: 'R1C1', to: 'R2C1' },
      { type: 'info', from: 'R5C1', to: 'R6C1' },
      { type: 'move', from: 'R2C1', to: 'R3C1' }
    ];
    expect(hasMoveDependencies(suggestions)).toBe(true);
  });

  it('returns false for single move', () => {
    const moves = [{ type: 'move', from: 'R1C1', to: 'R2C1' }];
    expect(hasMoveDependencies(moves)).toBe(false);
  });
});
