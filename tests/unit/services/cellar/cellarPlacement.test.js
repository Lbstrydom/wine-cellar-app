/**
 * @fileoverview Unit tests for cellar placement matching.
 * @module tests/unit/services/cellar/cellarPlacement.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getZoneRows: vi.fn().mockResolvedValue([]),
  allocateRowToZone: vi.fn().mockRejectedValue(new Error('No rows')),
  getActiveZoneMap: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../../src/services/shared/cellarLayoutSettings.js', () => ({
  LAYOUT_DEFAULTS: { colourOrder: 'whites-top', fillDirection: 'left' },
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

import { findBestZone, findAvailableSlot } from '../../../../src/services/cellar/cellarPlacement.js';
import { getZoneRows, allocateRowToZone } from '../../../../src/services/cellar/cellarAllocation.js';

describe('cellarPlacement varietal disambiguation', () => {
  it('does not infer cabernet sauvignon as a white wine', () => {
    const result = findBestZone({
      wine_name: 'Estate Cabernet Sauvignon 2022',
      style: '',
      colour: null,
      grapes: null
    });

    expect(result.zoneId).toBe('cabernet');
    expect(result.zoneId).not.toBe('sauvignon_blanc');
  });

  it('continues to map sauvignon blanc to a white zone', () => {
    const result = findBestZone({
      wine_name: 'Marlborough Sauvignon Blanc 2024',
      style: '',
      colour: null,
      grapes: null
    });

    expect(result.zoneId).toBe('sauvignon_blanc');
  });

  it('uses grapes text field for zoning when wine name is generic', () => {
    const result = findBestZone({
      wine_name: 'Estate Reserve 2022',
      style: '',
      colour: null,
      grapes: 'cabernet sauvignon'
    });

    expect(result.zoneId).toBe('cabernet');
  });
});

describe('findAvailableSlot colour-region filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out red-region rows for a white zone (prevents whites moving to red territory)', async () => {
    // chenin_blanc zone has R17 allocated (wrong — R17 is in range 8-19 = red territory)
    getZoneRows.mockResolvedValue(['R17']);
    // No new row allocation available
    allocateRowToZone.mockRejectedValue(new Error('No rows'));

    const occupied = new Set();
    const result = await findAvailableSlot('chenin_blanc', occupied, null, {
      cellarId: 'test-cellar'
    });

    // Should NOT return a slot in R17 (red territory for whites-top)
    if (result) {
      expect(result.slotId).not.toMatch(/^R17/);
    }
  });

  it('keeps white-region rows for a white zone', async () => {
    // chenin_blanc zone has R3 allocated (correct — R3 is in range 1-7 = white territory)
    getZoneRows.mockResolvedValue(['R3']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));

    const occupied = new Set();
    const result = await findAvailableSlot('chenin_blanc', occupied, null, {
      cellarId: 'test-cellar'
    });

    // Should return a slot in R3 (white territory for whites-top)
    expect(result).not.toBeNull();
    expect(result.slotId).toMatch(/^R3C/);
    expect(result.isOverflow).toBe(false);
  });

  it('filters out white-region rows for a red zone (prevents reds in white territory)', async () => {
    // cabernet zone has R5 allocated (wrong — R5 is in range 1-7 = white territory)
    getZoneRows.mockResolvedValue(['R5']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));

    const occupied = new Set();
    const result = await findAvailableSlot('cabernet', occupied, null, {
      cellarId: 'test-cellar'
    });

    // Should NOT return a slot in R5 (white territory for whites-top)
    if (result) {
      expect(result.slotId).not.toMatch(/^R5/);
    }
  });

  it('keeps red-region rows for a red zone', async () => {
    // cabernet zone has R12 allocated (correct — R12 is in range 8-19 = red territory)
    getZoneRows.mockResolvedValue(['R12']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));

    const occupied = new Set();
    const result = await findAvailableSlot('cabernet', occupied, null, {
      cellarId: 'test-cellar'
    });

    // Should return a slot in R12 (red territory for whites-top)
    expect(result).not.toBeNull();
    expect(result.slotId).toMatch(/^R12C/);
    expect(result.isOverflow).toBe(false);
  });
});
