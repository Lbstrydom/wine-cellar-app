/**
 * @fileoverview Unit tests for cellar allocation — cross-colour row safety.
 * @module tests/unit/services/cellar/cellarAllocation.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

vi.mock('../../../../src/services/shared/cellarLayoutSettings.js', () => ({
  isWhiteFamily: vi.fn((colour) => {
    const whiteFamilyColours = ['white', 'rose', 'rosé', 'orange', 'sparkling', 'dessert', 'fortified'];
    return whiteFamilyColours.includes((colour || '').toLowerCase());
  }),
  getCellarLayoutSettings: vi.fn().mockResolvedValue({
    fillDirection: 'left',
    colourOrder: 'whites-top'
  }),
  getDynamicColourRowRanges: vi.fn().mockResolvedValue({
    whiteRows: [1, 2, 3, 4, 5, 6, 7],
    redRows: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    whiteRowCount: 7,
    redRowCount: 12
  })
}));

import db from '../../../../src/db/index.js';
import { allocateRowToZone, adjustZoneCountAfterBottleCrud } from '../../../../src/services/cellar/cellarAllocation.js';

describe('allocateRowToZone cross-colour safety (Phase 3.1)', () => {
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

  it('throws when no colour-compatible rows are available for a white zone', async () => {
    // All white rows (1-7) already allocated
    const usedRows = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue(
        usedRows.map(r => ({ assigned_rows: JSON.stringify([r]) }))
      ),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    });

    await expect(
      allocateRowToZone('chenin_blanc', 'cellar-1')
    ).rejects.toThrow(/No colour-compatible rows/);
  });

  it('throws when no colour-compatible rows are available for a red zone', async () => {
    // All red rows (8-19) already allocated
    const usedRows = [];
    for (let i = 8; i <= 19; i++) usedRows.push(`R${i}`);
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue(
        usedRows.map(r => ({ assigned_rows: JSON.stringify([r]) }))
      ),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    });

    await expect(
      allocateRowToZone('cabernet', 'cellar-1')
    ).rejects.toThrow(/No colour-compatible rows/);
  });

  it('allocates a preferred row when one is available', async () => {
    // No rows allocated yet
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    });

    const row = await allocateRowToZone('chenin_blanc', 'cellar-1');
    // chenin_blanc's preferredRowRange starts at low numbers
    expect(row).toMatch(/^R\d+$/);
  });
});

describe('adjustZoneCountAfterBottleCrud (Phase C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defensive: always re-establish db.prepare as a fresh vi.fn()
    db.prepare = vi.fn();
  });

  it('increments zone count when first bottle of a wine enters cellar', async () => {
    const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ zone_id: 'sauvignon_blanc' })  // SELECT wine zone_id
      .mockResolvedValueOnce({ count: 1 })                      // SELECT COUNT(*) from slots (1 = first bottle)
      .mockResolvedValueOnce({ wine_count: 5 });                 // updateZoneWineCount reads count (not zero)

    db.prepare.mockReturnValue({ get: mockGet, run: mockRun });

    await adjustZoneCountAfterBottleCrud(42, 'cellar-1', 'added');

    // Should have called run() to UPDATE wine_count
    expect(mockRun).toHaveBeenCalled();
  });

  it('does NOT increment when adding a second bottle of same wine', async () => {
    const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ zone_id: 'sauvignon_blanc' })  // wine zone_id
      .mockResolvedValueOnce({ count: 2 });                      // 2 bottles = not first

    db.prepare.mockReturnValue({ get: mockGet, run: mockRun });

    await adjustZoneCountAfterBottleCrud(42, 'cellar-1', 'added');

    // Should NOT have called run() — count is 2, not 1
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('decrements zone count when last bottle of a wine leaves cellar', async () => {
    const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ zone_id: 'cabernet' })  // wine zone_id
      .mockResolvedValueOnce({ count: 0 })               // 0 bottles = last one removed
      .mockResolvedValueOnce({ wine_count: 1 });          // updateZoneWineCount reads count

    db.prepare.mockReturnValue({ get: mockGet, run: mockRun });

    await adjustZoneCountAfterBottleCrud(42, 'cellar-1', 'removed');

    // Should have called run() to decrement wine_count
    expect(mockRun).toHaveBeenCalled();
  });

  it('does NOT decrement when bottles still remain', async () => {
    const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ zone_id: 'cabernet' })  // wine zone_id
      .mockResolvedValueOnce({ count: 3 });               // 3 bottles remain

    db.prepare.mockReturnValue({ get: mockGet, run: mockRun });

    await adjustZoneCountAfterBottleCrud(42, 'cellar-1', 'removed');

    // Should NOT have called run() — bottles still remain
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('does nothing if wine has no zone_id', async () => {
    const mockRun = vi.fn();
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ zone_id: null });  // no zone assigned

    db.prepare.mockReturnValue({ get: mockGet, run: mockRun });

    await adjustZoneCountAfterBottleCrud(42, 'cellar-1', 'added');

    // Should have only called get() once (for wine zone_id), then returned
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
