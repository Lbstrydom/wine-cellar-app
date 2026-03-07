/**
 * @fileoverview Unit tests for storageBuilder helpers.
 * Tests applyRowOffsets and colour_zone defaults.
 * @module tests/unit/utils/storageBuilder.test
 */

import { applyRowOffsets, addArea, addRow, setAreas, getAreas } from '../../../public/js/storageBuilder.js';

// ── applyRowOffsets ────────────────────────────────────────────────────────────

describe('applyRowOffsets', () => {
  describe('new areas only (no existing id)', () => {
    it('offsets a single new area by maxExistingRow', () => {
      const areas = [
        { name: 'New Area', rows: [{ row_num: 1, col_count: 6 }, { row_num: 2, col_count: 6 }] }
      ];
      const result = applyRowOffsets(areas, 10);
      expect(result[0].rows[0].row_num).toBe(11);
      expect(result[0].rows[1].row_num).toBe(12);
    });

    it('preserves col_count unchanged', () => {
      const areas = [
        { name: 'A', rows: [{ row_num: 1, col_count: 9 }] }
      ];
      const result = applyRowOffsets(areas, 5);
      expect(result[0].rows[0].col_count).toBe(9);
    });

    it('offsets multiple new areas sequentially', () => {
      const areas = [
        { name: 'Area 1', rows: [{ row_num: 1, col_count: 6 }, { row_num: 2, col_count: 6 }] },
        { name: 'Area 2', rows: [{ row_num: 1, col_count: 4 }] },
      ];
      const result = applyRowOffsets(areas, 8);
      // Area 1: offset=8, rows → 9, 10
      expect(result[0].rows[0].row_num).toBe(9);
      expect(result[0].rows[1].row_num).toBe(10);
      // Area 2: nextRow = 8+2=10, offset=10, row → 11
      expect(result[1].rows[0].row_num).toBe(11);
    });

    it('works with maxExistingRow = 0 (empty cellar)', () => {
      const areas = [
        { name: 'First', rows: [{ row_num: 1, col_count: 6 }] }
      ];
      const result = applyRowOffsets(areas, 0);
      expect(result[0].rows[0].row_num).toBe(1);
    });
  });

  describe('existing areas (with id) — unchanged', () => {
    it('keeps original row numbers for existing areas', () => {
      const areas = [
        { id: 'existing-1', name: 'Existing', rows: [{ row_num: 3, col_count: 7 }] }
      ];
      const result = applyRowOffsets(areas, 20);
      expect(result[0].rows[0].row_num).toBe(3); // unchanged
    });

    it('returns the same object reference for existing areas', () => {
      const existingArea = { id: 'existing-1', name: 'Existing', rows: [{ row_num: 1, col_count: 6 }] };
      const result = applyRowOffsets([existingArea], 10);
      expect(result[0]).toBe(existingArea); // same reference
    });
  });

  describe('mixed: existing + new areas', () => {
    it('keeps existing rows unchanged and offsets new ones from maxExistingRow', () => {
      const areas = [
        { id: 'existing-1', name: 'Cellar', rows: [{ row_num: 1, col_count: 8 }, { row_num: 2, col_count: 8 }] },
        { name: 'New Fridge', rows: [{ row_num: 1, col_count: 6 }] }
      ];
      const result = applyRowOffsets(areas, 10);
      // Existing stays at 1, 2
      expect(result[0].rows[0].row_num).toBe(1);
      expect(result[0].rows[1].row_num).toBe(2);
      // New area: offset=10, row → 11
      expect(result[1].rows[0].row_num).toBe(11);
    });
  });

  describe('preserves other area metadata', () => {
    it('does not strip name, storage_type, colour_zone from new areas', () => {
      const areas = [
        { name: 'Rack', storage_type: 'rack', temp_zone: 'cellar', colour_zone: 'red',
          rows: [{ row_num: 1, col_count: 5 }] }
      ];
      const result = applyRowOffsets(areas, 0);
      expect(result[0].name).toBe('Rack');
      expect(result[0].storage_type).toBe('rack');
      expect(result[0].colour_zone).toBe('red');
    });
  });
});

// ── colour_zone defaults ───────────────────────────────────────────────────────

describe('addArea colour_zone', () => {
  beforeEach(() => setAreas([]));

  it('defaults colour_zone to "mixed" when not specified', () => {
    addArea({ name: 'Test', storage_type: 'cellar', temp_zone: 'cellar' });
    const areas = getAreas();
    expect(areas[0].colour_zone).toBe('mixed');
  });

  it('preserves explicit colour_zone value', () => {
    addArea({ name: 'Red Only', storage_type: 'cellar', temp_zone: 'cellar', colour_zone: 'red' });
    const areas = getAreas();
    expect(areas[0].colour_zone).toBe('red');
  });
});

describe('setAreas colour_zone', () => {
  it('defaults colour_zone to "mixed" when area has no colour_zone', () => {
    setAreas([{ name: 'A', storage_type: 'cellar', temp_zone: 'cellar', rows: [] }]);
    expect(getAreas()[0].colour_zone).toBe('mixed');
  });

  it('preserves existing colour_zone when set', () => {
    setAreas([{ name: 'B', colour_zone: 'white', rows: [] }]);
    expect(getAreas()[0].colour_zone).toBe('white');
  });
});

// ── Stable row identity (Fix A) ───────────────────────────────────────────────

describe('stable row identity after deletion', () => {
  beforeEach(() => setAreas([]));

  const BASE_ROWS = [
    { row_num: 5, col_count: 9 },
    { row_num: 6, col_count: 9 },
    { row_num: 7, col_count: 9 }
  ];

  it('preserves gap when middle row is deleted', () => {
    setAreas([{ name: 'Cellar', storage_type: 'cellar', temp_zone: 'cellar', rows: BASE_ROWS }]);
    const area = getAreas()[0];
    // Simulate the onboarding delete handler: filter without renumbering
    setAreas([{ ...area, rows: area.rows.filter(r => r.row_num !== 6) }]);
    expect(getAreas()[0].rows.map(r => r.row_num)).toEqual([5, 7]);
  });

  it('preserves identity when first row is deleted', () => {
    setAreas([{ name: 'Cellar', storage_type: 'cellar', temp_zone: 'cellar', rows: BASE_ROWS }]);
    const area = getAreas()[0];
    setAreas([{ ...area, rows: area.rows.filter(r => r.row_num !== 5) }]);
    expect(getAreas()[0].rows.map(r => r.row_num)).toEqual([6, 7]);
  });

  it('preserves identity when last row is deleted', () => {
    setAreas([{ name: 'Cellar', storage_type: 'cellar', temp_zone: 'cellar', rows: BASE_ROWS }]);
    const area = getAreas()[0];
    setAreas([{ ...area, rows: area.rows.filter(r => r.row_num !== 7) }]);
    expect(getAreas()[0].rows.map(r => r.row_num)).toEqual([5, 6]);
  });

  it('addRow after a gap appends at(-1)+1, not max+1', () => {
    // Area has [5, 7] (gap where 6 was)
    setAreas([{ name: 'Cellar', storage_type: 'cellar', temp_zone: 'cellar',
      rows: [{ row_num: 5, col_count: 9 }, { row_num: 7, col_count: 9 }] }]);
    addRow(0);
    // at(-1) = 7, so next row_num = 8
    expect(getAreas()[0].rows.map(r => r.row_num)).toEqual([5, 7, 8]);
  });
});
