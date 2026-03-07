/**
 * @fileoverview Unit tests for cellar layout settings helpers.
 * @module tests/unit/services/shared/cellarLayoutSettings.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

vi.mock('../../../../src/services/cellar/cellarLayout.js', () => ({
  getCellarRowCount: vi.fn().mockResolvedValue(19),
  getStorageAreaRows: vi.fn().mockResolvedValue([]),
  getRowCapacity: vi.fn().mockReturnValue(9)
}));

import db from '../../../../src/db/index.js';
import { getCellarRowCount } from '../../../../src/services/cellar/cellarLayout.js';

// In --no-isolate mode, other test files may vi.mock() the entire
// cellarLayoutSettings module (e.g. layoutProposerIntegration.test.js,
// cellarAnalysis.test.js), replacing real exports with mocks.
// Use vi.importActual() to guarantee we test the REAL implementations.
let getCellarLayoutSettings, getColourRowRanges, isWhiteFamily, computeDynamicRowSplit,
  getDynamicColourRowRanges, countColourFamilies;
beforeAll(async () => {
  const actual = await vi.importActual('../../../../src/services/shared/cellarLayoutSettings.js');
  getCellarLayoutSettings = actual.getCellarLayoutSettings;
  getColourRowRanges = actual.getColourRowRanges;
  isWhiteFamily = actual.isWhiteFamily;
  computeDynamicRowSplit = actual.computeDynamicRowSplit;
  getDynamicColourRowRanges = actual.getDynamicColourRowRanges;
  countColourFamilies = actual.countColourFamilies;
});

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

// ─── countColourFamilies ──────────────────────────────────

describe('countColourFamilies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.prepare = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 })
    });
  });

  it('returns zeros when cellarId is null', async () => {
    const result = await countColourFamilies(null);
    expect(result).toEqual({ whiteCount: 0, redCount: 0 });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('counts white-family and red bottles', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        { colour: 'White', cnt: '15' },
        { colour: 'Red', cnt: '25' },
        { colour: 'Rosé', cnt: '5' }
      ])
    });

    const result = await countColourFamilies('cellar-1');
    expect(result).toEqual({ whiteCount: 20, redCount: 25 });
  });

  it('uses cellar-global query when no storageAreaId', async () => {
    const allFn = vi.fn().mockResolvedValue([]);
    db.prepare.mockReturnValue({ all: allFn });

    await countColourFamilies('cellar-1');

    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain("storage_type IN ('cellar', 'rack', 'other')");
    expect(sql).not.toContain('storage_area_id = $2');
  });

  it('uses area-scoped query when storageAreaId provided', async () => {
    const allFn = vi.fn().mockResolvedValue([]);
    db.prepare.mockReturnValue({ all: allFn });

    await countColourFamilies('cellar-1', 'area-uuid');

    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('storage_area_id');
    expect(sql).not.toContain("LIKE 'R%'");
    expect(allFn).toHaveBeenCalledWith('cellar-1', 'area-uuid');
  });
});

// ─── getDynamicColourRowRanges ────────────────────────────

describe('getDynamicColourRowRanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCellarRowCount.mockResolvedValue(19);
  });

  function mockDbSequence(...results) {
    let callIndex = 0;
    db.prepare = vi.fn().mockImplementation(() => ({
      all: vi.fn().mockImplementation((...args) => {
        const result = results[callIndex] || [];
        callIndex++;
        return Promise.resolve(result);
      }),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 })
    }));
  }

  it('falls back to legacy single-area when no storage areas exist', async () => {
    // Call 1: storage areas query → empty
    // Call 2: countColourFamilies (cellar-global)
    mockDbSequence(
      [], // no storage areas
      [{ colour: 'White', cnt: '10' }, { colour: 'Red', cnt: '30' }] // colour counts
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    expect(result.whiteRows.length + result.redRows.length).toBe(19);
    expect(result.whiteCount).toBe(10);
    expect(result.redCount).toBe(30);
  });

  it('assigns all rows to white for white-designated area', async () => {
    mockDbSequence(
      [{ id: 'area-1', colour_zone: 'white', storage_type: 'cellar', area_rows: JSON.stringify([{ row_num: 1 }, { row_num: 2 }, { row_num: 3 }]) }],
      // countColourFamilies for area-1
      [{ colour: 'White', cnt: '12' }]
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    expect(result.whiteRows).toEqual([1, 2, 3]);
    expect(result.redRows).toEqual([]);
    expect(result.whiteCount).toBe(12);
  });

  it('assigns all rows to red for red-designated area', async () => {
    mockDbSequence(
      [{ id: 'area-1', colour_zone: 'red', storage_type: 'rack', area_rows: JSON.stringify([{ row_num: 20 }, { row_num: 21 }]) }],
      // countColourFamilies for area-1
      [{ colour: 'Red', cnt: '8' }]
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    expect(result.whiteRows).toEqual([]);
    expect(result.redRows).toEqual([20, 21]);
    expect(result.redCount).toBe(8);
  });

  it('computes proportional split for mixed area', async () => {
    mockDbSequence(
      // Storage areas query
      [{ id: 'area-1', colour_zone: 'mixed', storage_type: 'cellar', area_rows: JSON.stringify([{ row_num: 1 }, { row_num: 2 }, { row_num: 3 }, { row_num: 4 }, { row_num: 5 }]) }],
      // countColourFamilies for area-1: equal split
      [{ colour: 'White', cnt: '10' }, { colour: 'Red', cnt: '10' }]
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    // 50/50 on 5 rows → 3 white, 2 red (Math.round(2.5) = 3)
    expect(result.whiteRows).toEqual([1, 2, 3]);
    expect(result.redRows).toEqual([4, 5]);
    expect(result.whiteCount).toBe(10);
    expect(result.redCount).toBe(10);
  });

  it('handles multiple areas with different colour zones', async () => {
    mockDbSequence(
      // Two areas: main cellar (mixed, rows 1-5) + garage (red, rows 6-8)
      [
        { id: 'area-main', colour_zone: 'mixed', storage_type: 'cellar', area_rows: JSON.stringify([{ row_num: 1 }, { row_num: 2 }, { row_num: 3 }, { row_num: 4 }, { row_num: 5 }]) },
        { id: 'area-garage', colour_zone: 'red', storage_type: 'rack', area_rows: JSON.stringify([{ row_num: 6 }, { row_num: 7 }, { row_num: 8 }]) }
      ],
      // countColourFamilies for area-main: 5 white, 15 red
      [{ colour: 'White', cnt: '5' }, { colour: 'Red', cnt: '15' }],
      // countColourFamilies for area-garage: 10 red
      [{ colour: 'Red', cnt: '10' }]
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    // Main area: 5 rows, 25% white → 2 white rows (min 2), 3 red rows
    expect(result.whiteRows).toEqual([1, 2]);
    expect(result.redRows).toEqual(expect.arrayContaining([3, 4, 5, 6, 7, 8]));
    expect(result.redRows).toHaveLength(6);
    // Totals include both areas
    expect(result.whiteCount).toBe(5);
    expect(result.redCount).toBe(25);
  });

  it('respects reds-top colour order within mixed areas', async () => {
    mockDbSequence(
      [{ id: 'area-1', colour_zone: 'mixed', storage_type: 'cellar', area_rows: JSON.stringify([{ row_num: 1 }, { row_num: 2 }, { row_num: 3 }, { row_num: 4 }]) }],
      [{ colour: 'White', cnt: '10' }, { colour: 'Red', cnt: '10' }]
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'reds-top');

    // 50/50 on 4 rows → 2 white, 2 red; reds-top puts reds first
    expect(result.redRows).toEqual([1, 2]);
    expect(result.whiteRows).toEqual([3, 4]);
  });

  it('skips fridge-type storage areas', async () => {
    mockDbSequence(
      [
        { id: 'area-fridge', colour_zone: 'mixed', storage_type: 'wine_fridge', area_rows: JSON.stringify([{ row_num: 1 }, { row_num: 2 }]) },
        { id: 'area-cellar', colour_zone: 'red', storage_type: 'cellar', area_rows: JSON.stringify([{ row_num: 3 }, { row_num: 4 }]) }
      ],
      // countColourFamilies for area-cellar (fridge is skipped)
      [{ colour: 'Red', cnt: '6' }]
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    // Only cellar area (red zone) included; fridge skipped
    expect(result.whiteRows).toEqual([]);
    expect(result.redRows).toEqual([3, 4]);
    expect(result.redCount).toBe(6);
  });

  it('handles area with no rows gracefully', async () => {
    mockDbSequence(
      [{ id: 'area-1', colour_zone: 'white', storage_type: 'cellar', area_rows: null }]
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    expect(result.whiteRows).toEqual([]);
    expect(result.redRows).toEqual([]);
  });

  it('defaults colour_zone to mixed when null', async () => {
    mockDbSequence(
      [{ id: 'area-1', colour_zone: null, storage_type: 'cellar', area_rows: JSON.stringify([{ row_num: 1 }, { row_num: 2 }]) }],
      [{ colour: 'Red', cnt: '10' }] // only reds
    );

    const result = await getDynamicColourRowRanges('cellar-1', 'whites-top');

    // Mixed with only reds → all rows are red
    expect(result.whiteRows).toEqual([]);
    expect(result.redRows).toEqual([1, 2]);
  });
});
