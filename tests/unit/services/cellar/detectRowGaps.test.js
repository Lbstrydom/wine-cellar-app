/**
 * @fileoverview Unit tests for detectRowGaps and generateCompactionMoves.
 * @module tests/unit/services/cellar/detectRowGaps.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import { detectRowGaps } from '../../../../src/services/cellar/cellarMetrics.js';
import { generateCompactionMoves } from '../../../../src/services/cellar/cellarSuggestions.js';

// ─── Helper ───────────────────────────────────────────────

function buildSlotMap(entries) {
  const map = new Map();
  for (const [slot, wine] of entries) {
    map.set(slot, wine);
  }
  return map;
}

const wine = (id, name = 'Wine') => ({ id, wine_name: name });

// ─── detectRowGaps (fill left) ────────────────────────────

describe('detectRowGaps (fill left)', () => {
  it('returns empty for completely empty cellar', () => {
    const gaps = detectRowGaps(new Map(), 'left');
    expect(gaps).toEqual([]);
  });

  it('returns empty for a full row', () => {
    const map = buildSlotMap([
      ['R2C1', wine(1)], ['R2C2', wine(1)], ['R2C3', wine(1)],
      ['R2C4', wine(1)], ['R2C5', wine(1)], ['R2C6', wine(1)],
      ['R2C7', wine(1)], ['R2C8', wine(1)], ['R2C9', wine(1)]
    ]);
    expect(detectRowGaps(map, 'left')).toEqual([]);
  });

  it('returns empty when bottles are already packed left', () => {
    const map = buildSlotMap([
      ['R3C1', wine(1, 'A')],
      ['R3C2', wine(2, 'B')],
      ['R3C3', wine(3, 'C')]
    ]);
    expect(detectRowGaps(map, 'left')).toEqual([]);
  });

  it('detects a gap between occupied slots', () => {
    // R5: [A] [ ] [B] — B should shift to C2
    const map = buildSlotMap([
      ['R5C1', wine(1, 'A')],
      ['R5C3', wine(2, 'B')]
    ]);
    const gaps = detectRowGaps(map, 'left');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      row: 5,
      gapSlot: 'R5C2',
      shiftFrom: 'R5C3',
      wineId: 2,
      wineName: 'B'
    });
  });

  it('detects gap at the left with a bottle further right', () => {
    // R4: [ ] [ ] [A] — A should be at C1
    const map = buildSlotMap([
      ['R4C3', wine(1, 'A')]
    ]);
    const gaps = detectRowGaps(map, 'left');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      row: 4,
      gapSlot: 'R4C1',
      shiftFrom: 'R4C3',
      wineId: 1
    });
  });

  it('detects multiple gaps in the same row', () => {
    // R6: [ ] [A] [ ] [B] — both need to shift left
    const map = buildSlotMap([
      ['R6C2', wine(1, 'A')],
      ['R6C4', wine(2, 'B')]
    ]);
    const gaps = detectRowGaps(map, 'left');
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    // At minimum, B at C4 needs to move (since its expected position ≤ 2)
    const bGap = gaps.find(g => g.wineId === 2);
    expect(bGap).toBeDefined();
  });

  it('handles row 1 with 7 cols correctly', () => {
    // R1 only has 7 columns; no R1C8 or R1C9
    const map = buildSlotMap([
      ['R1C1', wine(1, 'A')],
      ['R1C7', wine(2, 'B')]
    ]);
    const gaps = detectRowGaps(map, 'left');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      row: 1,
      gapSlot: 'R1C2',
      shiftFrom: 'R1C7',
      wineId: 2
    });
  });

  it('detects gaps across multiple rows', () => {
    const map = buildSlotMap([
      ['R2C5', wine(1, 'A')],  // Gap in row 2
      ['R3C3', wine(2, 'B')]   // Gap in row 3
    ]);
    const gaps = detectRowGaps(map, 'left');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].row).toBe(2);
    expect(gaps[1].row).toBe(3);
  });
});

// ─── detectRowGaps (fill right) ───────────────────────────

describe('detectRowGaps (fill right)', () => {
  it('returns empty when bottles are packed right', () => {
    const map = buildSlotMap([
      ['R3C7', wine(1, 'A')],
      ['R3C8', wine(2, 'B')],
      ['R3C9', wine(3, 'C')]
    ]);
    expect(detectRowGaps(map, 'right')).toEqual([]);
  });

  it('detects a gap when bottle is left of where it should be', () => {
    // R5: [A] [ ] ... [ ] [B] — with 2 bottles, expected at C8,C9
    // A at C1 should shift to C8
    const map = buildSlotMap([
      ['R5C1', wine(1, 'A')],
      ['R5C9', wine(2, 'B')]
    ]);
    const gaps = detectRowGaps(map, 'right');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      row: 5,
      shiftFrom: 'R5C1',
      wineId: 1
    });
  });

  it('handles row 1 (7 cols) packed right', () => {
    // R1 has 7 cols; pack right means bottles at C6, C7
    const map = buildSlotMap([
      ['R1C6', wine(1, 'A')],
      ['R1C7', wine(2, 'B')]
    ]);
    expect(detectRowGaps(map, 'right')).toEqual([]);
  });

  it('detects gap in row 1 when not packed right', () => {
    // R1 has 7 cols; 1 bottle at C1 should be at C7
    const map = buildSlotMap([
      ['R1C1', wine(1, 'A')]
    ]);
    const gaps = detectRowGaps(map, 'right');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      row: 1,
      gapSlot: 'R1C7',
      shiftFrom: 'R1C1'
    });
  });
});

// ─── generateCompactionMoves ──────────────────────────────

describe('generateCompactionMoves', () => {
  it('returns empty when no gaps', () => {
    const map = buildSlotMap([
      ['R3C1', wine(1, 'A')],
      ['R3C2', wine(2, 'B')]
    ]);
    const moves = generateCompactionMoves(map, 'left');
    expect(moves).toEqual([]);
  });

  it('generates moves with correct structure', () => {
    const map = buildSlotMap([
      ['R5C1', wine(1, 'A')],
      ['R5C3', wine(2, 'B')]
    ]);
    const moves = generateCompactionMoves(map, 'left');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      type: 'compaction',
      wineId: 2,
      wineName: 'B',
      from: 'R5C3',
      to: 'R5C2',
      confidence: 'high',
      priority: 4
    });
    expect(moves[0].reason).toContain('left');
  });

  it('generates moves for right fill direction', () => {
    const map = buildSlotMap([
      ['R5C1', wine(1, 'A')],
      ['R5C9', wine(2, 'B')]
    ]);
    const moves = generateCompactionMoves(map, 'right');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      type: 'compaction',
      from: 'R5C1',
      confidence: 'high',
      priority: 4
    });
    expect(moves[0].reason).toContain('right');
  });
});
