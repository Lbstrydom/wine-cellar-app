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
import { allocateRowToZone } from '../../../../src/services/cellar/cellarAllocation.js';

describe('allocateRowToZone cross-colour safety (Phase 3.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
