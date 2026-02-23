/**
 * @fileoverview Unit tests for layoutSorter — minimum move computation.
 * @module tests/unit/services/cellar/layoutSorter.test
 */

import { computeSortPlan } from '../../../../src/services/cellar/layoutSorter.js';

// ─── Helper to build Maps from objects ───────────────────────────────

function toMap(obj) {
  return new Map(Object.entries(obj));
}

function wine(wineId, wineName = `Wine ${wineId}`, zoneId = 'z', confidence = 'high') {
  return { wineId, wineName, zoneId, confidence };
}

// ─── computeSortPlan ─────────────────────────────────────────────────

describe('computeSortPlan', () => {
  it('returns zero moves when current matches target exactly', () => {
    const current = toMap({ R1C1: wine(1), R1C2: wine(2) });
    const target = toMap({ R1C1: wine(1), R1C2: wine(2) });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(0);
    expect(result.stats.stayInPlace).toBe(2);
    expect(result.stats.totalMoves).toBe(0);
  });

  it('returns zero moves when both layouts are empty', () => {
    const result = computeSortPlan(new Map(), new Map());
    expect(result.moves).toHaveLength(0);
    expect(result.stats.stayInPlace).toBe(0);
  });

  it('computes a direct move when target slot is empty', () => {
    const current = toMap({ R1C1: wine(1) });
    const target = toMap({ R1C2: wine(1) });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toMatchObject({
      wineId: 1,
      from: 'R1C1',
      to: 'R1C2',
      moveType: 'direct'
    });
    expect(result.stats.directMoves).toBe(1);
    expect(result.stats.stayInPlace).toBe(0);
  });

  it('computes a swap when two wines exchange positions', () => {
    const current = toMap({ R1C1: wine(1), R1C2: wine(2) });
    const target = toMap({ R1C1: wine(2), R1C2: wine(1) });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(2);
    expect(result.stats.swaps).toBe(1);
    expect(result.stats.directMoves).toBe(0);

    // Both moves should be tagged as swap
    expect(result.moves.every(m => m.moveType === 'swap')).toBe(true);

    // Verify the actual moves
    const move1to2 = result.moves.find(m => m.wineId === 1);
    const move2to1 = result.moves.find(m => m.wineId === 2);
    expect(move1to2).toMatchObject({ from: 'R1C1', to: 'R1C2' });
    expect(move2to1).toMatchObject({ from: 'R1C2', to: 'R1C1' });
  });

  it('computes a 3-cycle (A→B, B→C, C→A)', () => {
    const current = toMap({
      R1C1: wine(1),
      R1C2: wine(2),
      R1C3: wine(3)
    });
    const target = toMap({
      R1C1: wine(3),  // Wine 3 moves from R1C3 to R1C1
      R1C2: wine(1),  // Wine 1 moves from R1C1 to R1C2
      R1C3: wine(2)   // Wine 2 moves from R1C2 to R1C3
    });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(3);
    expect(result.stats.cycles).toBe(1);
    expect(result.moves.every(m => m.moveType === 'cycle')).toBe(true);
  });

  it('handles mixed scenario: some stay, some move, some swap', () => {
    const current = toMap({
      R1C1: wine(1),  // stays
      R1C2: wine(2),  // swaps with wine 3
      R1C3: wine(3),  // swaps with wine 2
      R2C1: wine(4)   // moves to R2C2
    });
    const target = toMap({
      R1C1: wine(1),  // stays
      R1C2: wine(3),  // was at R1C3
      R1C3: wine(2),  // was at R1C2
      R2C2: wine(4)   // was at R2C1
    });

    const result = computeSortPlan(current, target);

    expect(result.stats.stayInPlace).toBe(1);
    expect(result.stats.swaps).toBe(1);
    expect(result.stats.directMoves).toBe(1);
    expect(result.stats.totalMoves).toBe(3); // 2 swap moves + 1 direct
  });

  it('handles multiple bottles of the same wine_id', () => {
    // Wine 1 occupies R1C1 and R1C2 — needs to move to R2C1 and R2C2
    const current = toMap({
      R1C1: wine(1, 'Cab 2020'),
      R1C2: wine(1, 'Cab 2020')
    });
    const target = toMap({
      R2C1: wine(1, 'Cab 2020'),
      R2C2: wine(1, 'Cab 2020')
    });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(2);
    // Both moves should have wineId 1 but distinct from/to
    const froms = new Set(result.moves.map(m => m.from));
    const tos = new Set(result.moves.map(m => m.to));
    expect(froms.size).toBe(2);
    expect(tos.size).toBe(2);
    expect(froms).toContain('R1C1');
    expect(froms).toContain('R1C2');
    expect(tos).toContain('R2C1');
    expect(tos).toContain('R2C2');
  });

  it('preserves zone info and confidence in emitted moves', () => {
    const current = toMap({ R1C1: wine(1, 'W1', 'shiraz', 'high') });
    const target = toMap({ R2C1: wine(1, 'W1', 'shiraz', 'high') });

    const result = computeSortPlan(current, target);

    expect(result.moves[0]).toMatchObject({
      zoneId: 'shiraz',
      confidence: 'high',
      wineName: 'W1'
    });
  });

  it('handles target slots with no matching source (wine not in cellar)', () => {
    // Wine 99 is in the target but not in current — should not emit a move
    const current = toMap({ R1C1: wine(1) });
    const target = toMap({ R1C1: wine(1), R1C2: wine(99) });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(0);
    expect(result.stats.stayInPlace).toBe(1);
  });

  it('handles empty current layout with non-empty target', () => {
    const current = new Map();
    const target = toMap({ R1C1: wine(1) });

    const result = computeSortPlan(current, target);

    // Wine 1 has no source slot — can't move what isn't there
    expect(result.moves).toHaveLength(0);
  });

  it('handles current layout with bottles not in target (removals)', () => {
    // Wine 1 is currently placed but not in the target — should not generate a move
    const current = toMap({ R1C1: wine(1), R1C2: wine(2) });
    const target = toMap({ R1C2: wine(2) });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(0);
    expect(result.stats.stayInPlace).toBe(1); // Wine 2 stays
  });

  it('handles large reorganisation with multiple independent moves', () => {
    const current = toMap({
      R1C1: wine(1), R1C2: wine(2), R1C3: wine(3),
      R2C1: wine(4), R2C2: wine(5), R2C3: wine(6)
    });
    const target = toMap({
      R3C1: wine(1), R3C2: wine(2), R3C3: wine(3),
      R4C1: wine(4), R4C2: wine(5), R4C3: wine(6)
    });

    const result = computeSortPlan(current, target);

    expect(result.moves).toHaveLength(6);
    expect(result.stats.directMoves).toBe(6);
    expect(result.stats.stayInPlace).toBe(0);
  });
});
