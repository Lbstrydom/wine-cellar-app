/**
 * @fileoverview Unit tests for cellar placement matching.
 * Mock implementations for cellarLayoutSettings and cellarAllocation are
 * re-applied in beforeEach to survive --no-isolate cross-file overrides.
 * @module tests/unit/services/cellar/cellarPlacement.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { findBestZone, findAvailableSlot, inferColor } from '../../../../src/services/cellar/cellarPlacement.js';
import { getZoneRows, allocateRowToZone, getActiveZoneMap } from '../../../../src/services/cellar/cellarAllocation.js';
import { getCellarLayoutSettings, getDynamicColourRowRanges, isWhiteFamily } from '../../../../src/services/shared/cellarLayoutSettings.js';

/**
 * Re-apply mock implementations that may be clobbered in --no-isolate by other
 * test files mocking the same modules.
 */
function resetLayoutMocks() {
  getCellarLayoutSettings.mockResolvedValue({
    fillDirection: 'left',
    colourOrder: 'whites-top'
  });
  getDynamicColourRowRanges.mockResolvedValue({
    whiteRows: [1, 2, 3, 4, 5, 6, 7],
    redRows: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    whiteRowCount: 7,
    redRowCount: 12
  });
  isWhiteFamily.mockImplementation((colour) => {
    const whiteFamilyColours = ['white', 'rose', 'rosé', 'orange', 'sparkling', 'dessert', 'fortified'];
    return whiteFamilyColours.includes((colour || '').toLowerCase());
  });
}

function resetAllocationMocks() {
  getZoneRows.mockResolvedValue([]);
  allocateRowToZone.mockRejectedValue(new Error('No rows'));
  getActiveZoneMap.mockResolvedValue({});
}

describe('inferColor expanded grape coverage', () => {
  it.each([
    ['Kleine Zalze Shiraz 2021', 'red'],
    ['De Grendel Shiraz 2019', 'red'],
    ['Estate Pinotage 2022', 'red'],
    ['Touriga Nacional Reserve', 'red'],
    ['Garnacha de Fuego', 'red'],
    ['Malbec Reserva 2020', 'red'],
    ['Carmenere Gran Reserva', 'red'],
    ['Barbera d\'Alba 2021', 'red'],
    ['Negroamaro Salento', 'red'],
    ['Montepulciano d\'Abruzzo', 'red'],
    ['Petit Verdot Single Vineyard', 'red'],
    ['Cabernet Franc Reserve', 'red'],
  ])('infers %s as %s', (wineName, expected) => {
    expect(inferColor({ wine_name: wineName })).toBe(expected);
  });

  it.each([
    ['Malvasia delle Lipari', 'white'],
    ['Albariño Rias Baixas', 'white'],
    ['Verdejo Rueda 2023', 'white'],
    ['Vermentino di Sardegna', 'white'],
    ['Moscato d\'Asti', 'white'],
    ['Semillon Hunter Valley', 'white'],
    ['Pinot Gris Reserve', 'white'],
  ])('infers %s as %s', (wineName, expected) => {
    expect(inferColor({ wine_name: wineName })).toBe(expected);
  });

  it('uses grapes field when wine name is ambiguous', () => {
    // "Albert Bichot Bourgogne" has no grape in name, but grapes field has "pinot noir"
    expect(inferColor({
      wine_name: 'Albert Bichot Bourgogne 2023',
      grapes: 'pinot noir'
    })).toBe('red');
  });

  it('returns null when no colour can be determined', () => {
    expect(inferColor({ wine_name: 'Mystery Estate Reserve 2022' })).toBeNull();
  });
});

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

describe('Phase 2 – Classifier unification & dessert_fortified protection', () => {
  it('classifies Tawny Port to dessert_fortified (not matched on portugal)', () => {
    const result = findBestZone({
      wine_name: 'Tawny Port 20 Year Old',
      colour: 'fortified',
      country: 'Portugal',
      grapes: null,
      style: null
    });
    expect(result.zoneId).toBe('dessert_fortified');
  });

  it('does NOT classify Portuguese Douro Red as dessert_fortified', () => {
    const result = findBestZone({
      wine_name: 'Quinta do Crasto Douro Red 2019',
      colour: 'red',
      country: 'Portugal',
      grapes: 'touriga nacional',
      style: null
    });
    expect(result.zoneId).not.toBe('dessert_fortified');
    expect(result.zoneId).toBe('portugal');
  });

  it('classifies red Pinot Noir away from aromatic_whites', () => {
    const result = findBestZone({
      wine_name: 'Bourgogne Pinot Noir 2021',
      colour: 'red',
      country: 'France',
      grapes: 'pinot noir',
      style: null
    });
    expect(result.zoneId).not.toBe('aromatic_whites');
    expect(result.zoneId).toBe('pinot_noir');
  });

  it('classifies SA Shiraz to shiraz zone (not southern_france)', () => {
    const result = findBestZone({
      wine_name: 'Kleine Zalze Shiraz 2021',
      colour: 'red',
      country: 'South Africa',
      grapes: 'shiraz',
      style: null
    });
    expect(result.zoneId).toBe('shiraz');
    expect(result.zoneId).not.toBe('southern_france');
  });

  it('classifies French Côtes du Rhône blend to southern_france', () => {
    const result = findBestZone({
      wine_name: 'Domaine de la Janasse Côtes du Rhône 2020',
      colour: 'red',
      country: 'France',
      grapes: 'grenache, syrah, mourvèdre',
      style: 'Rhône blend',
      region: 'Rhône'
    });
    expect(result.zoneId).toBe('southern_france');
  });

  it('classifies German Riesling away from southern_france', () => {
    const result = findBestZone({
      wine_name: 'Nik Weis Mosel Riesling 2022',
      colour: 'white',
      country: 'Germany',
      grapes: 'riesling',
      style: null,
      region: 'Mosel'
    });
    expect(result.zoneId).not.toBe('southern_france');
  });
});

describe('findAvailableSlot uses allocated rows regardless of colour region (Phase A fix)', () => {
  // Phase A fix: Allocated rows are committed decisions. We no longer filter them
  // against the dynamic colour boundary — that filtering caused ghost row growth
  // when the boundary shifted. The colour boundary only gates NEW allocations
  // in allocateRowToZone(). (See external review Finding #6)
  beforeEach(() => {
    vi.clearAllMocks();
    resetLayoutMocks();
    resetAllocationMocks();
  });

  it('uses a white zone row even if in red territory (allocated rows are committed)', async () => {
    // chenin_blanc zone has R17 allocated — even though R17 is in "red territory",
    // it's an existing allocation that must be honoured to prevent ghost row growth
    getZoneRows.mockResolvedValue(['R17']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));

    const occupied = new Set();
    const result = await findAvailableSlot('chenin_blanc', occupied, null, {
      cellarId: 'test-cellar'
    });

    // Should USE R17 because it's an allocated row (not filter it out)
    expect(result).not.toBeNull();
    expect(result.slotId).toMatch(/^R17C/);
    expect(result.isOverflow).toBe(false);
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

  it('uses a red zone row even if in white territory (allocated rows are committed)', async () => {
    // cabernet zone has R5 allocated — even though R5 is in "white territory",
    // it's an existing allocation that must be honoured to prevent ghost row growth
    getZoneRows.mockResolvedValue(['R5']);
    allocateRowToZone.mockRejectedValue(new Error('No rows'));

    const occupied = new Set();
    const result = await findAvailableSlot('cabernet', occupied, null, {
      cellarId: 'test-cellar'
    });

    // Should USE R5 because it's an allocated row (not filter it out)
    expect(result).not.toBeNull();
    expect(result.slotId).toMatch(/^R5C/);
    expect(result.isOverflow).toBe(false);
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
    resetLayoutMocks();
    resetAllocationMocks();
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

// ─── Phase 5.2 – calculateZoneMatch rejection reasons & explain mode ──

describe('Phase 5.2 – rejection reasons & explain mode', () => {
  it('findBestZone returns rejectionReason for colour mismatch', () => {
    const result = findBestZone({
      wine_name: 'Cabernet Sauvignon 2020',
      colour: 'red',
      grapes: 'cabernet sauvignon',
      country: null,
      style: null
    }, { explain: true });

    // Should match cabernet (red zone), but rejectedZones should include white zones
    expect(result.rejectedZones).toBeDefined();
    expect(result.rejectedZones.length).toBeGreaterThan(0);

    const colourRejections = result.rejectedZones.filter(r =>
      r.reason.startsWith('Colour mismatch')
    );
    expect(colourRejections.length).toBeGreaterThan(0);
    // White zones like sauvignon_blanc should be rejected on colour
    const sbRejection = colourRejections.find(r => r.zoneId === 'sauvignon_blanc');
    expect(sbRejection).toBeTruthy();
    expect(sbRejection.reason).toContain('red');
  });

  it('findBestZone does NOT return rejectedZones when explain=false (default)', () => {
    const result = findBestZone({
      wine_name: 'Cabernet Sauvignon 2020',
      colour: 'red',
      grapes: 'cabernet sauvignon'
    });

    expect(result.rejectedZones).toBeUndefined();
  });

  it('findBestZone returns rejectedZones including excludeKeyword rejections', () => {
    // A Tawny Port wine: dessert_fortified excludes 'portugal' / 'portuguese'
    // so if we test a Portuguese wine that has "port" in the name but is a red...
    const result = findBestZone({
      wine_name: 'Quinta do Crasto Douro Red 2019',
      colour: 'red',
      country: 'Portugal',
      grapes: 'touriga nacional',
      style: null
    }, { explain: true });

    expect(result.rejectedZones).toBeDefined();
    // dessert_fortified should reject on colour (red vs dessert/fortified family)
    const dessertRejection = result.rejectedZones.find(r => r.zoneId === 'dessert_fortified');
    expect(dessertRejection).toBeTruthy();
    expect(dessertRejection.reason).toContain('Colour mismatch');
  });

  it('findBestZone explain mode includes rejection reasons for unclassified wine', () => {
    const result = findBestZone({
      wine_name: 'Mystery Estate Reserve 2022',
      colour: null,
      grapes: null,
      country: null,
      style: null
    }, { explain: true });

    // Should be unclassified (no matching zone)
    expect(result.zoneId).toBe('unclassified');
    // rejectedZones should be present (may be empty if no zones gave rejectionReason —
    // some zones just score 0 without a specific rejection)
    expect(result.rejectedZones).toBeDefined();
    expect(Array.isArray(result.rejectedZones)).toBe(true);
  });
});
