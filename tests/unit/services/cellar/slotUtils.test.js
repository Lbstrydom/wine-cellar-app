/**
 * @fileoverview Unit tests for slotUtils — shared slot parsing utilities.
 * @module tests/unit/services/cellar/slotUtils.test
 */

import {
  parseSlot,
  slotToRowId,
  buildSlotId,
  extractRowNumber,
  getRowCapacity,
  isCellarSlot,
  isFridgeSlot,
  sortRowIds
} from '../../../../src/services/cellar/slotUtils.js';

describe('parseSlot', () => {
  it('parses cellar slot R3C7', () => {
    expect(parseSlot('R3C7')).toEqual({ row: 3, col: 7 });
  });

  it('parses cellar slot R19C1', () => {
    expect(parseSlot('R19C1')).toEqual({ row: 19, col: 1 });
  });

  it('parses fridge slot F2 to row 0', () => {
    expect(parseSlot('F2')).toEqual({ row: 0, col: 2 });
  });

  it('parses fridge slot F12', () => {
    expect(parseSlot('F12')).toEqual({ row: 0, col: 12 });
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot(undefined)).toBeNull();
    expect(parseSlot('')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(parseSlot('XYZ')).toBeNull();
    expect(parseSlot('R')).toBeNull();
    expect(parseSlot('F')).toBeNull();
  });
});

describe('slotToRowId', () => {
  it('extracts R3 from R3C5', () => {
    expect(slotToRowId('R3C5')).toBe('R3');
  });

  it('extracts R19 from R19C1', () => {
    expect(slotToRowId('R19C1')).toBe('R19');
  });

  it('returns null for fridge slots', () => {
    expect(slotToRowId('F2')).toBeNull();
  });

  it('returns null for null/invalid', () => {
    expect(slotToRowId(null)).toBeNull();
    expect(slotToRowId('XYZ')).toBeNull();
  });
});

describe('buildSlotId', () => {
  it('builds R3C5 from (3, 5)', () => {
    expect(buildSlotId(3, 5)).toBe('R3C5');
  });

  it('builds R1C1 from (1, 1)', () => {
    expect(buildSlotId(1, 1)).toBe('R1C1');
  });
});

describe('extractRowNumber', () => {
  it('extracts 3 from R3C5', () => {
    expect(extractRowNumber('R3C5')).toBe(3);
  });

  it('returns 0 for fridge slot F2', () => {
    expect(extractRowNumber('F2')).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(extractRowNumber(null)).toBe(0);
  });
});

describe('getRowCapacity', () => {
  it('returns 7 for R1 (legacy default)', () => {
    expect(getRowCapacity('R1')).toBe(7);
  });

  it('returns 9 for R2-R19 (legacy default)', () => {
    expect(getRowCapacity('R2')).toBe(9);
    expect(getRowCapacity('R19')).toBe(9);
  });

  it('returns dynamic capacity from storage area rows', () => {
    const rows = [
      { row_num: 1, col_count: 5 },
      { row_num: 2, col_count: 12 }
    ];
    expect(getRowCapacity('R1', rows)).toBe(5);
    expect(getRowCapacity('R2', rows)).toBe(12);
  });

  it('falls back to default when row not in storage area', () => {
    const rows = [{ row_num: 1, col_count: 5 }];
    expect(getRowCapacity('R2', rows)).toBe(9);
  });

  it('returns 0 for invalid row ID', () => {
    expect(getRowCapacity(null)).toBe(0);
    expect(getRowCapacity('XYZ')).toBe(0);
  });
});

describe('isCellarSlot', () => {
  it('returns true for R3C5', () => {
    expect(isCellarSlot('R3C5')).toBe(true);
  });

  it('returns false for F2', () => {
    expect(isCellarSlot('F2')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isCellarSlot(null)).toBe(false);
  });
});

describe('isFridgeSlot', () => {
  it('returns true for F2', () => {
    expect(isFridgeSlot('F2')).toBe(true);
  });

  it('returns false for R3C5', () => {
    expect(isFridgeSlot('R3C5')).toBe(false);
  });
});

describe('sortRowIds', () => {
  it('sorts rows numerically', () => {
    const rows = ['R10', 'R2', 'R1', 'R19', 'R3'];
    expect(rows.sort(sortRowIds)).toEqual(['R1', 'R2', 'R3', 'R10', 'R19']);
  });
});
