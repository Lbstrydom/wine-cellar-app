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
import { getZoneRows, allocateRowToZone, getActiveZoneMap } from '../../../../src/services/cellar/cellarAllocation.js';

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

describe('findAvailableSlot allowFallback + enforceAffinity overflow chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Simulate a fully occupied cellar: fill all white-region rows (R1-R7)
   * so that the buffer zone search also fails.
   */
  function buildFullyOccupiedWhiteRegion() {
    const occupied = new Set();
    for (let row = 1; row <= 7; row++) {
      const maxCol = row === 1 ? 7 : 9;
      for (let col = 1; col <= maxCol; col++) {
        occupied.add(`R${row}C${col}`);
      }
    }
    return occupied;
  }

  /**
   * Build a zone map where every white row is allocated to some zone.
   */
  function buildFullyAllocatedWhiteZoneMap() {
    return {
      R1: { zoneId: 'sauvignon_blanc' },
      R2: { zoneId: 'sauvignon_blanc' },
      R3: { zoneId: 'chenin_blanc' },
      R4: { zoneId: 'chenin_blanc' },
      R5: { zoneId: 'aromatic_whites' },
      R6: { zoneId: 'chardonnay' },
      R7: { zoneId: 'loire_light' }
    };
  }

  it('returns null when enforceAffinity=true and allowFallback=false (zone + buffer full)', async () => {
    // Zone has rows but they are full
    getZoneRows.mockResolvedValue(['R3']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));
    // All white rows allocated → buffer finds no unallocated rows
    getActiveZoneMap.mockResolvedValue(buildFullyAllocatedWhiteZoneMap());

    const occupied = buildFullyOccupiedWhiteRegion();

    const result = await findAvailableSlot('chenin_blanc', occupied, { colour: 'white' }, {
      allowFallback: false,
      enforceAffinity: true,
      cellarId: 'test-cellar'
    });

    expect(result).toBeNull();
  });

  it('reaches fallback zone when enforceAffinity=true and allowFallback=true (zone + buffer full)', async () => {
    // Zone has rows but they are full
    getZoneRows.mockResolvedValue(['R3']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));
    // All white rows allocated → buffer search finds nothing
    getActiveZoneMap.mockResolvedValue(buildFullyAllocatedWhiteZoneMap());

    // Fill all white rows, but leave a slot in R9 (red region) so fallback can find it
    const occupied = buildFullyOccupiedWhiteRegion();

    const result = await findAvailableSlot('chenin_blanc', occupied, { colour: 'white' }, {
      allowFallback: true,
      enforceAffinity: true,
      cellarId: 'test-cellar'
    });

    // Should find a slot via the fallback zone's whole-cellar scan
    expect(result).not.toBeNull();
    expect(result.isOverflow).toBe(true);
    // The slot should be in the red region (only place with space)
    const rowNum = parseInt(result.slotId.replace(/R(\d+)C\d+/, '$1'), 10);
    expect(rowNum).toBeGreaterThanOrEqual(8);
  });

  it('prefers colour-appropriate rows in fallback scan (white wine prefers white rows)', async () => {
    // Zone rows full
    getZoneRows.mockResolvedValue(['R3']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));
    getActiveZoneMap.mockResolvedValue(buildFullyAllocatedWhiteZoneMap());

    // Fill white rows EXCEPT R5C9 — leave one slot in the white region
    const occupied = buildFullyOccupiedWhiteRegion();
    occupied.delete('R5C9');

    const result = await findAvailableSlot('chenin_blanc', occupied, { colour: 'white' }, {
      allowFallback: true,
      enforceAffinity: true,
      cellarId: 'test-cellar'
    });

    // Fallback should find R5C9 (white region) since it prefers colour-matching rows
    expect(result).not.toBeNull();
    expect(result.slotId).toBe('R5C9');
    expect(result.isOverflow).toBe(true);
  });

  it('works for red wines too: reaches fallback when red zone + red buffer are full', async () => {
    // Red zone with rows full
    getZoneRows.mockResolvedValue(['R12']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));
    // All red rows allocated
    getActiveZoneMap.mockResolvedValue({
      ...buildFullyAllocatedWhiteZoneMap(),
      R8: { zoneId: 'iberian_fresh' },
      R9: { zoneId: 'portugal' },
      R10: { zoneId: 'cabernet' },
      R11: { zoneId: 'cabernet' },
      R12: { zoneId: 'cabernet' },
      R13: { zoneId: 'shiraz' },
      R14: { zoneId: 'pinot_noir' },
      R15: { zoneId: 'southern_france' },
      R16: { zoneId: 'puglia_primitivo' },
      R17: { zoneId: 'sa_blends' },
      R18: { zoneId: 'piedmont' },
      R19: { zoneId: 'chile_argentina' }
    });

    // Fill red region except R19C9
    const occupied = buildFullyOccupiedWhiteRegion();
    for (let row = 8; row <= 19; row++) {
      for (let col = 1; col <= 9; col++) {
        occupied.add(`R${row}C${col}`);
      }
    }
    occupied.delete('R19C9');

    const result = await findAvailableSlot('cabernet', occupied, { colour: 'red' }, {
      allowFallback: true,
      enforceAffinity: true,
      cellarId: 'test-cellar'
    });

    expect(result).not.toBeNull();
    expect(result.slotId).toBe('R19C9');
    expect(result.isOverflow).toBe(true);
  });

  it('returns null when cellar is completely full even with allowFallback=true', async () => {
    getZoneRows.mockResolvedValue(['R3']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));
    getActiveZoneMap.mockResolvedValue(buildFullyAllocatedWhiteZoneMap());

    // Fill EVERY slot in the cellar
    const occupied = new Set();
    for (let row = 1; row <= 19; row++) {
      const maxCol = row === 1 ? 7 : 9;
      for (let col = 1; col <= maxCol; col++) {
        occupied.add(`R${row}C${col}`);
      }
    }

    const result = await findAvailableSlot('chenin_blanc', occupied, { colour: 'white' }, {
      allowFallback: true,
      enforceAffinity: true,
      cellarId: 'test-cellar'
    });

    expect(result).toBeNull();
  });
});
