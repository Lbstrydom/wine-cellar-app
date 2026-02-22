/**
 * @fileoverview Unit tests for cellar layout settings helpers.
 * @module tests/unit/services/shared/cellarLayoutSettings.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

import db from '../../../../src/db/index.js';
import {
  getCellarLayoutSettings,
  getColourRowRanges,
  isWhiteFamily,
  computeDynamicRowSplit
} from '../../../../src/services/shared/cellarLayoutSettings.js';

// ─── isWhiteFamily ────────────────────────────────────────

describe('isWhiteFamily', () => {
  it('returns true for white', () => {
    expect(isWhiteFamily('White')).toBe(true);
  });

  it('returns true for rosé variants', () => {
    expect(isWhiteFamily('Rosé')).toBe(true);
    expect(isWhiteFamily('Rose')).toBe(true);
    expect(isWhiteFamily('rosé')).toBe(true);
    expect(isWhiteFamily('rose')).toBe(true);
  });

  it('returns true for orange', () => {
    expect(isWhiteFamily('Orange')).toBe(true);
  });

  it('returns true for sparkling', () => {
    expect(isWhiteFamily('Sparkling')).toBe(true);
  });

  it('returns true for dessert', () => {
    expect(isWhiteFamily('Dessert')).toBe(true);
  });

  it('returns true for fortified', () => {
    expect(isWhiteFamily('Fortified')).toBe(true);
  });

  it('returns false for red', () => {
    expect(isWhiteFamily('Red')).toBe(false);
  });

  it('returns false for undefined/null', () => {
    expect(isWhiteFamily(undefined)).toBe(false);
    expect(isWhiteFamily(null)).toBe(false);
    expect(isWhiteFamily('')).toBe(false);
  });
});

// ─── getColourRowRanges (with dynamic whiteRowCount) ──────

describe('getColourRowRanges', () => {
  it('whites-top: 7 white rows puts whites in 1-7 and reds in 8-19', () => {
    const ranges = getColourRowRanges('whites-top', 7);
    expect(ranges.whiteRows).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ranges.redRows).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('whites-top: 4 white rows puts whites in 1-4 and reds in 5-19', () => {
    const ranges = getColourRowRanges('whites-top', 4);
    expect(ranges.whiteRows).toEqual([1, 2, 3, 4]);
    expect(ranges.redRows).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('whites-top: 0 white rows gives all 19 rows to reds', () => {
    const ranges = getColourRowRanges('whites-top', 0);
    expect(ranges.whiteRows).toEqual([]);
    expect(ranges.redRows).toHaveLength(19);
  });

  it('whites-top: 19 white rows gives all rows to whites', () => {
    const ranges = getColourRowRanges('whites-top', 19);
    expect(ranges.whiteRows).toHaveLength(19);
    expect(ranges.redRows).toEqual([]);
  });

  it('reds-top: 5 white rows puts reds in 1-14 and whites in 15-19', () => {
    const ranges = getColourRowRanges('reds-top', 5);
    expect(ranges.redRows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(ranges.whiteRows).toEqual([15, 16, 17, 18, 19]);
  });

  it('uses fallback whiteRowCount when not provided', () => {
    const ranges = getColourRowRanges('whites-top');
    expect(ranges.whiteRows.length + ranges.redRows.length).toBe(19);
    expect(ranges.whiteRows.length).toBeGreaterThan(0);
    expect(ranges.redRows.length).toBeGreaterThan(0);
  });
});

// ─── computeDynamicRowSplit ───────────────────────────────

describe('computeDynamicRowSplit', () => {
  it('gives all rows to reds when no bottles', () => {
    const split = computeDynamicRowSplit(0, 0);
    expect(split).toEqual({ whiteRowCount: 0, redRowCount: 19 });
  });

  it('gives all rows to whites when only whites', () => {
    const split = computeDynamicRowSplit(10, 0);
    expect(split).toEqual({ whiteRowCount: 19, redRowCount: 0 });
  });

  it('gives all rows to reds when only reds', () => {
    const split = computeDynamicRowSplit(0, 10);
    expect(split).toEqual({ whiteRowCount: 0, redRowCount: 19 });
  });

  it('splits proportionally for mixed inventory', () => {
    // 50/50 split: 10 whites, 10 reds → ~10 rows whites, ~9 reds
    const split = computeDynamicRowSplit(10, 10);
    expect(split.whiteRowCount).toBe(10);
    expect(split.redRowCount).toBe(9);
  });

  it('respects minimum of 2 rows when both colours present', () => {
    // 1 white, 100 reds → white gets minimum 2 rows
    const split = computeDynamicRowSplit(1, 100);
    expect(split.whiteRowCount).toBe(2);
    expect(split.redRowCount).toBe(17);
  });

  it('respects minimum for reds too', () => {
    // 100 whites, 1 red → red gets minimum 2 rows
    const split = computeDynamicRowSplit(100, 1);
    expect(split.whiteRowCount).toBe(17);
    expect(split.redRowCount).toBe(2);
  });

  it('allocates proportionally for realistic cellar', () => {
    // 30 whites, 70 reds → ~6 white rows, ~13 red rows
    const split = computeDynamicRowSplit(30, 70);
    expect(split.whiteRowCount).toBe(6);
    expect(split.redRowCount).toBe(13);
  });

  it('handles custom total rows', () => {
    const split = computeDynamicRowSplit(5, 5, 10);
    expect(split.whiteRowCount).toBe(5);
    expect(split.redRowCount).toBe(5);
  });

  it('always sums to total rows', () => {
    for (const [w, r] of [[3, 7], [0, 10], [10, 0], [1, 100], [50, 50]]) {
      const split = computeDynamicRowSplit(w, r);
      expect(split.whiteRowCount + split.redRowCount).toBe(19);
    }
  });
});

// ─── getCellarLayoutSettings ──────────────────────────────

describe('getCellarLayoutSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defensive: always re-establish db.prepare with safe defaults.
    // In --no-isolate mode other test files' vi.clearAllMocks() can reset
    // the mock return value, causing chained calls like .get()/.all() to fail.
    db.prepare = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 })
    });
  });

  it('returns defaults when cellarId is null', async () => {
    const result = await getCellarLayoutSettings(null);
    expect(result).toEqual({ colourOrder: 'whites-top', fillDirection: 'left' });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('returns defaults when cellarId is undefined', async () => {
    const result = await getCellarLayoutSettings(undefined);
    expect(result).toEqual({ colourOrder: 'whites-top', fillDirection: 'left' });
  });

  it('reads settings from DB and returns them', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        { key: 'cellar_colour_order', value: 'reds-top' },
        { key: 'cellar_fill_direction', value: 'right' }
      ])
    });
    const result = await getCellarLayoutSettings('cellar-123');
    expect(result).toEqual({ colourOrder: 'reds-top', fillDirection: 'right' });
  });

  it('falls back to defaults for invalid DB values', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        { key: 'cellar_colour_order', value: 'invalid' },
        { key: 'cellar_fill_direction', value: 'invalid' }
      ])
    });
    const result = await getCellarLayoutSettings('cellar-123');
    expect(result).toEqual({ colourOrder: 'whites-top', fillDirection: 'left' });
  });

  it('uses defaults when no rows returned from DB', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([])
    });
    const result = await getCellarLayoutSettings('cellar-123');
    expect(result).toEqual({ colourOrder: 'whites-top', fillDirection: 'left' });
  });
});
