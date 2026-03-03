/**
 * @fileoverview Unit tests for saveFoodPairings helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

import db from '../../../../src/db/index.js';
import { saveFoodPairings } from '../../../../src/services/shared/foodPairingsService.js';

const WINE_ID = 10;
const CELLAR_ID = 'cellar-uuid';

function mockRun(changes = 1) {
  db.prepare.mockReturnValue({ run: vi.fn().mockResolvedValue({ changes }) });
}

describe('saveFoodPairings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 for empty array', async () => {
    const count = await saveFoodPairings(WINE_ID, CELLAR_ID, []);
    expect(count).toBe(0);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('returns 0 for null input', async () => {
    const count = await saveFoodPairings(WINE_ID, CELLAR_ID, null);
    expect(count).toBe(0);
  });

  it('inserts a single pairing and returns count', async () => {
    mockRun(1);
    const count = await saveFoodPairings(WINE_ID, CELLAR_ID, ['Lamb rack']);
    expect(count).toBe(1);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'));
  });

  it('skips blanks / non-string entries', async () => {
    mockRun(1);
    const count = await saveFoodPairings(WINE_ID, CELLAR_ID, ['  ', 'Beef', null, '']);
    // Only 'Beef' is valid
    expect(count).toBe(1);
  });

  it('counts 0 when DB signals no change (duplicate row)', async () => {
    // ON CONFLICT DO NOTHING → changes = 0
    mockRun(0);
    const count = await saveFoodPairings(WINE_ID, CELLAR_ID, ['Lamb rack']);
    expect(count).toBe(0);
  });

  it('uses default source=search', async () => {
    mockRun(1);
    await saveFoodPairings(WINE_ID, CELLAR_ID, ['Cheese']);
    const runFn = db.prepare.mock.results[0].value.run;
    // 4th arg passed to run should be 'search'
    expect(runFn).toHaveBeenCalledWith(WINE_ID, CELLAR_ID, 'Cheese', 'search');
  });

  it('accepts custom source param', async () => {
    mockRun(1);
    await saveFoodPairings(WINE_ID, CELLAR_ID, ['Cheese'], 'manual');
    const runFn = db.prepare.mock.results[0].value.run;
    expect(runFn).toHaveBeenCalledWith(WINE_ID, CELLAR_ID, 'Cheese', 'manual');
  });

  it('continues and returns partial count when one insert throws', async () => {
    // Track prepare() call index so first pairing throws, second succeeds
    let prepareCall = 0;
    db.prepare.mockImplementation(() => {
      const idx = prepareCall++;
      return {
        run: vi.fn().mockImplementation(async () => {
          if (idx === 0) throw new Error('DB error');
          return { changes: 1 };
        }),
        get: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue([])
      };
    });
    const count = await saveFoodPairings(WINE_ID, CELLAR_ID, ['Bad pairing', 'Good pairing']);
    // First throws (not counted), second succeeds
    expect(count).toBe(1);
  });
});
