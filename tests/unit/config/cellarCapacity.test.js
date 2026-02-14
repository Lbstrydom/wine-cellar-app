/**
 * @fileoverview Tests for the row capacity map module.
 * @module tests/unit/config/cellarCapacity.test
 */

import {
  ROW_CAPACITY_MAP,
  getRowCapacity,
  computeRowsCapacity,
  getTotalCapacity,
  getTotalRows,
  getAllRowIds,
  parseRowNumber
} from '../../../src/config/cellarCapacity.js';

describe('cellarCapacity', () => {
  describe('ROW_CAPACITY_MAP', () => {
    it('has 19 rows', () => {
      expect(Object.keys(ROW_CAPACITY_MAP)).toHaveLength(19);
    });

    it('Row 1 has 7 slots', () => {
      expect(ROW_CAPACITY_MAP['R1']).toBe(7);
    });

    it('Rows 2-19 have 9 slots each', () => {
      for (let i = 2; i <= 19; i++) {
        expect(ROW_CAPACITY_MAP[`R${i}`]).toBe(9);
      }
    });
  });

  describe('getRowCapacity', () => {
    it('returns 7 for R1', () => {
      expect(getRowCapacity('R1')).toBe(7);
    });

    it('returns 9 for R2', () => {
      expect(getRowCapacity('R2')).toBe(9);
    });

    it('returns 9 for R19', () => {
      expect(getRowCapacity('R19')).toBe(9);
    });

    it('accepts numeric input', () => {
      expect(getRowCapacity(1)).toBe(7);
      expect(getRowCapacity(5)).toBe(9);
    });

    it('defaults to 9 for unknown rows', () => {
      expect(getRowCapacity('R99')).toBe(9);
    });
  });

  describe('computeRowsCapacity', () => {
    it('returns 0 for empty array', () => {
      expect(computeRowsCapacity([])).toBe(0);
    });

    it('returns 0 for null/undefined', () => {
      expect(computeRowsCapacity(null)).toBe(0);
      expect(computeRowsCapacity(undefined)).toBe(0);
    });

    it('correctly sums R1 + R2', () => {
      expect(computeRowsCapacity(['R1', 'R2'])).toBe(7 + 9);
    });

    it('correctly sums multiple standard rows', () => {
      expect(computeRowsCapacity(['R3', 'R4', 'R5'])).toBe(27);
    });

    it('correctly sums all rows', () => {
      const allRows = Array.from({ length: 19 }, (_, i) => `R${i + 1}`);
      expect(computeRowsCapacity(allRows)).toBe(169);
    });
  });

  describe('getTotalCapacity', () => {
    it('returns 169 (7 + 18*9)', () => {
      expect(getTotalCapacity()).toBe(169);
    });
  });

  describe('getTotalRows', () => {
    it('returns 19', () => {
      expect(getTotalRows()).toBe(19);
    });
  });

  describe('getAllRowIds', () => {
    it('returns 19 row IDs in order', () => {
      const ids = getAllRowIds();
      expect(ids).toHaveLength(19);
      expect(ids[0]).toBe('R1');
      expect(ids[18]).toBe('R19');
    });
  });

  describe('parseRowNumber', () => {
    it('parses "R3" to 3', () => {
      expect(parseRowNumber('R3')).toBe(3);
    });

    it('parses "R19" to 19', () => {
      expect(parseRowNumber('R19')).toBe(19);
    });

    it('returns number as-is', () => {
      expect(parseRowNumber(5)).toBe(5);
    });
  });
});
