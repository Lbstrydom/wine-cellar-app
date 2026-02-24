/**
 * @fileoverview Unit tests for the reconfiguration change tracker.
 * Tests percentage-based threshold computation and DB interactions.
 * @module tests/unit/services/zone/reconfigChangeTracker.test
 */

// Mock the db module
const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
const mockGet = vi.fn().mockResolvedValue(null);
const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet }));
vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: (...args) => mockPrepare(...args) }
}));

// Mock logger
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

import {
  getReconfigChangeThresholdPct,
  getTotalBottleCount,
  computeAbsoluteThreshold,
  incrementBottleChangeCount,
  getBottleChangeStatus,
  resetBottleChangeCount,
  checkReconfigThreshold
} from '../../../../src/services/zone/reconfigChangeTracker.js';

const CELLAR_ID = 'test-cellar-uuid';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RECONFIG_CHANGE_THRESHOLD_PCT;
});

// ─── computeAbsoluteThreshold (pure function) ───

describe('computeAbsoluteThreshold', () => {
  it('returns 0 when pct is 0 (disabled)', () => {
    expect(computeAbsoluteThreshold(0, 100)).toBe(0);
  });

  it('computes ceil of percentage', () => {
    expect(computeAbsoluteThreshold(10, 60)).toBe(6);
    expect(computeAbsoluteThreshold(10, 65)).toBe(7); // ceil(6.5)
  });

  it('enforces minimum of 2', () => {
    // 10% of 5 = 0.5 → ceil = 1, but min is 2
    expect(computeAbsoluteThreshold(10, 5)).toBe(2);
    // 10% of 10 = 1 → min is 2
    expect(computeAbsoluteThreshold(10, 10)).toBe(2);
  });

  it('handles large cellars', () => {
    expect(computeAbsoluteThreshold(10, 200)).toBe(20);
    expect(computeAbsoluteThreshold(5, 200)).toBe(10);
  });

  it('handles 100%', () => {
    expect(computeAbsoluteThreshold(100, 50)).toBe(50);
  });
});

// ─── getReconfigChangeThresholdPct ───

describe('getReconfigChangeThresholdPct', () => {
  it('returns default 10 when no setting or env var', async () => {
    // DB returns no row
    mockGet.mockResolvedValueOnce(null);
    const pct = await getReconfigChangeThresholdPct(CELLAR_ID);
    expect(pct).toBe(10);
  });

  it('reads from user_settings when row exists', async () => {
    mockGet.mockResolvedValueOnce({ value: '15' });
    const pct = await getReconfigChangeThresholdPct(CELLAR_ID);
    expect(pct).toBe(15);
  });

  it('falls through to env var when user_settings query fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('table missing'));
    process.env.RECONFIG_CHANGE_THRESHOLD_PCT = '20';
    const pct = await getReconfigChangeThresholdPct(CELLAR_ID);
    expect(pct).toBe(20);
  });

  it('falls through to default when env var is invalid', async () => {
    mockGet.mockResolvedValueOnce(null);
    process.env.RECONFIG_CHANGE_THRESHOLD_PCT = 'abc';
    const pct = await getReconfigChangeThresholdPct(CELLAR_ID);
    expect(pct).toBe(10);
  });

  it('rejects negative values from user_settings', async () => {
    mockGet.mockResolvedValueOnce({ value: '-5' });
    const pct = await getReconfigChangeThresholdPct(CELLAR_ID);
    expect(pct).toBe(10);
  });

  it('rejects >100 values from user_settings', async () => {
    mockGet.mockResolvedValueOnce({ value: '150' });
    const pct = await getReconfigChangeThresholdPct(CELLAR_ID);
    expect(pct).toBe(10);
  });

  it('accepts 0 (disabled)', async () => {
    mockGet.mockResolvedValueOnce({ value: '0' });
    const pct = await getReconfigChangeThresholdPct(CELLAR_ID);
    expect(pct).toBe(0);
  });
});

// ─── getTotalBottleCount ───

describe('getTotalBottleCount', () => {
  it('returns count from DB', async () => {
    mockGet.mockResolvedValueOnce({ cnt: 42 });
    const count = await getTotalBottleCount(CELLAR_ID);
    expect(count).toBe(42);
  });

  it('returns 0 on error', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const count = await getTotalBottleCount(CELLAR_ID);
    expect(count).toBe(0);
  });

  it('returns 0 when row is null', async () => {
    mockGet.mockResolvedValueOnce(null);
    const count = await getTotalBottleCount(CELLAR_ID);
    expect(count).toBe(0);
  });
});

// ─── incrementBottleChangeCount ───

describe('incrementBottleChangeCount', () => {
  it('calls UPSERT with cellarId and delta', async () => {
    await incrementBottleChangeCount(CELLAR_ID, 3);
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO zone_reconfig_counters'));
    expect(mockRun).toHaveBeenCalledWith(CELLAR_ID, 3);
  });

  it('defaults delta to 1', async () => {
    await incrementBottleChangeCount(CELLAR_ID);
    expect(mockRun).toHaveBeenCalledWith(CELLAR_ID, 1);
  });

  it('does nothing when cellarId is null', async () => {
    await incrementBottleChangeCount(null);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('fails open on DB error', async () => {
    mockRun.mockRejectedValueOnce(new Error('fail'));
    // Should not throw
    await expect(incrementBottleChangeCount(CELLAR_ID)).resolves.toBeUndefined();
  });
});

// ─── getBottleChangeStatus ───

describe('getBottleChangeStatus', () => {
  it('returns exists:false when no row', async () => {
    mockGet.mockResolvedValueOnce(null);
    const status = await getBottleChangeStatus(CELLAR_ID);
    expect(status).toEqual({ changeCount: 0, lastReconfigAt: null, exists: false });
  });

  it('returns row data when found', async () => {
    mockGet.mockResolvedValueOnce({
      bottle_change_count: 5,
      last_reconfig_at: '2026-02-20T10:00:00Z'
    });
    const status = await getBottleChangeStatus(CELLAR_ID);
    expect(status).toEqual({
      changeCount: 5,
      lastReconfigAt: '2026-02-20T10:00:00Z',
      exists: true
    });
  });

  it('fails open on DB error', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const status = await getBottleChangeStatus(CELLAR_ID);
    expect(status).toEqual({ changeCount: 0, lastReconfigAt: null, exists: false });
  });
});

// ─── resetBottleChangeCount ───

describe('resetBottleChangeCount', () => {
  it('calls UPSERT to reset counter', async () => {
    await resetBottleChangeCount(CELLAR_ID);
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('bottle_change_count = 0'));
    expect(mockRun).toHaveBeenCalledWith(CELLAR_ID);
  });

  it('does nothing when cellarId is null', async () => {
    await resetBottleChangeCount(null);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('fails open on DB error', async () => {
    mockRun.mockRejectedValueOnce(new Error('fail'));
    await expect(resetBottleChangeCount(CELLAR_ID)).resolves.toBeUndefined();
  });
});

// ─── checkReconfigThreshold (integration of above) ───

describe('checkReconfigThreshold', () => {
  it('allows first-time reconfig (no counter row)', async () => {
    // getReconfigChangeThresholdPct → user_settings query
    mockGet.mockResolvedValueOnce(null); // no pct setting
    // getTotalBottleCount → slots query
    mockGet.mockResolvedValueOnce({ cnt: 60 });
    // getBottleChangeStatus → counter query
    mockGet.mockResolvedValueOnce(null); // no counter row (first time)

    const result = await checkReconfigThreshold(CELLAR_ID);
    expect(result.allowed).toBe(true);
  });

  it('allows first-time reconfig even when counter row exists from bottle adds', async () => {
    // Counter row was created by incrementBottleChangeCount before any reconfig
    mockGet.mockResolvedValueOnce(null); // no pct setting → default 10%
    mockGet.mockResolvedValueOnce({ cnt: 60 }); // 60 bottles
    // Counter row exists (created by bottle adds) but last_reconfig_at is null
    mockGet.mockResolvedValueOnce({
      bottle_change_count: 2,
      last_reconfig_at: null
    });

    const result = await checkReconfigThreshold(CELLAR_ID);
    expect(result.allowed).toBe(true);
  });

  it('blocks when below percentage threshold', async () => {
    // pct setting = 10%
    mockGet.mockResolvedValueOnce({ value: '10' });
    // total bottles = 60 → threshold = 6
    mockGet.mockResolvedValueOnce({ cnt: 60 });
    // counter = 3 (below 6)
    mockGet.mockResolvedValueOnce({
      bottle_change_count: 3,
      last_reconfig_at: '2026-02-20T10:00:00Z'
    });

    const result = await checkReconfigThreshold(CELLAR_ID);
    expect(result.allowed).toBe(false);
    expect(result.changeCount).toBe(3);
    expect(result.threshold).toBe(6);
    expect(result.thresholdPct).toBe(10);
    expect(result.totalBottles).toBe(60);
  });

  it('allows when at or above threshold', async () => {
    mockGet.mockResolvedValueOnce({ value: '10' }); // 10%
    mockGet.mockResolvedValueOnce({ cnt: 60 }); // 60 bottles → threshold = 6
    mockGet.mockResolvedValueOnce({
      bottle_change_count: 6,
      last_reconfig_at: '2026-02-20T10:00:00Z'
    });

    const result = await checkReconfigThreshold(CELLAR_ID);
    expect(result.allowed).toBe(true);
  });

  it('allows when threshold is 0% (disabled)', async () => {
    mockGet.mockResolvedValueOnce({ value: '0' }); // disabled
    mockGet.mockResolvedValueOnce({ cnt: 60 });
    mockGet.mockResolvedValueOnce({
      bottle_change_count: 0,
      last_reconfig_at: '2026-02-20T10:00:00Z'
    });

    const result = await checkReconfigThreshold(CELLAR_ID);
    expect(result.allowed).toBe(true);
  });

  it('enforces minimum absolute threshold of 2', async () => {
    mockGet.mockResolvedValueOnce({ value: '10' }); // 10%
    mockGet.mockResolvedValueOnce({ cnt: 10 }); // 10 bottles → 10% = 1, but min = 2
    mockGet.mockResolvedValueOnce({
      bottle_change_count: 1,
      last_reconfig_at: '2026-02-20T10:00:00Z'
    });

    const result = await checkReconfigThreshold(CELLAR_ID);
    expect(result.allowed).toBe(false);
    expect(result.threshold).toBe(2);
  });
});
