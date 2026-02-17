/**
 * @fileoverview Unit tests for bottles-first scanner (Phase B1).
 * @module tests/unit/services/cellar/bottleScanner.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getZoneRows: vi.fn().mockResolvedValue([]),
  allocateRowToZone: vi.fn().mockRejectedValue(new Error('No rows')),
  getActiveZoneMap: vi.fn().mockResolvedValue({})
}));

import { scanBottles, rowCleanlinessSweep } from '../../../../src/services/cellar/bottleScanner.js';

// ── Helpers ────────────────────────────────────────────────────

/** Create a minimal wine object for testing. */
function makeWine(overrides = {}) {
  return {
    id: 1,
    wine_name: 'Test Wine 2020',
    colour: 'red',
    grapes: 'cabernet sauvignon',
    country: 'South Africa',
    region: 'Stellenbosch',
    style: null,
    zone_id: 'cabernet',
    slot_id: 'R8C1',
    ...overrides
  };
}

/** Build a zone map entry. */
function zoneMapEntry(zoneId, displayName, extras = {}) {
  return { zoneId, displayName, rowNumber: 1, totalRows: 1, wineCount: 0, ...extras };
}

// ── Tests ──────────────────────────────────────────────────────

describe('scanBottles (Phase B1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic grouping', () => {
    it('groups wines by canonical zone from findBestZone()', () => {
      const wines = [
        makeWine({ id: 1, wine_name: 'Cab 1', slot_id: 'R8C1' }),
        makeWine({ id: 2, wine_name: 'Cab 2', slot_id: 'R8C2' }),
        makeWine({ id: 3, wine_name: 'Shiraz 1', slot_id: 'R10C1', grapes: 'shiraz', zone_id: 'shiraz' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon'),
        R10: zoneMapEntry('shiraz', 'Shiraz')
      };

      const result = scanBottles(wines, zoneMap);

      expect(result.totalBottles).toBe(3);
      expect(result.totalGroups).toBe(2);
      expect(result.groups).toHaveLength(2);

      const cabGroup = result.groups.find(g => g.zoneId === 'cabernet');
      expect(cabGroup).toBeDefined();
      expect(cabGroup.bottleCount).toBe(2);

      const shirazGroup = result.groups.find(g => g.zoneId === 'shiraz');
      expect(shirazGroup).toBeDefined();
      expect(shirazGroup.bottleCount).toBe(1);
    });

    it('returns empty groups for empty wine list', () => {
      const result = scanBottles([], {});

      expect(result.totalBottles).toBe(0);
      expect(result.totalGroups).toBe(0);
      expect(result.groups).toEqual([]);
      expect(result.consolidationOpportunities).toEqual([]);
    });

    it('sorts groups by bottle count descending', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' }),
        makeWine({ id: 2, wine_name: 'Shiraz 1', slot_id: 'R10C1', grapes: 'shiraz', zone_id: 'shiraz' }),
        makeWine({ id: 3, wine_name: 'Shiraz 2', slot_id: 'R10C2', grapes: 'shiraz', zone_id: 'shiraz' }),
        makeWine({ id: 4, wine_name: 'Shiraz 3', slot_id: 'R10C3', grapes: 'shiraz', zone_id: 'shiraz' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon'),
        R10: zoneMapEntry('shiraz', 'Shiraz')
      };

      const result = scanBottles(wines, zoneMap);

      expect(result.groups[0].zoneId).toBe('shiraz');
      expect(result.groups[0].bottleCount).toBe(3);
      expect(result.groups[1].zoneId).toBe('cabernet');
      expect(result.groups[1].bottleCount).toBe(1);
    });
  });

  describe('fridge exclusion', () => {
    it('excludes fridge wines from scan', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' }),
        makeWine({ id: 2, slot_id: 'F1', wine_name: 'Fridge Wine' }),
        makeWine({ id: 3, slot_id: 'F3', wine_name: 'Fridge Wine 2' })
      ];

      const zoneMap = { R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon') };
      const result = scanBottles(wines, zoneMap);

      expect(result.totalBottles).toBe(1);
      expect(result.totalGroups).toBe(1);
    });

    it('excludes wines with no slot assignment', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' }),
        makeWine({ id: 2, slot_id: null, location_code: null })
      ];

      const zoneMap = { R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon') };
      const result = scanBottles(wines, zoneMap);

      expect(result.totalBottles).toBe(1);
    });
  });

  describe('correctly placed vs misplaced', () => {
    it('marks wine as correctly placed when in allocated row', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1', zone_id: 'cabernet' })
      ];

      const zoneMap = { R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon') };
      const result = scanBottles(wines, zoneMap);
      const group = result.groups[0];

      expect(group.correctlyPlacedCount).toBe(1);
      expect(group.misplacedCount).toBe(0);
      expect(group.wines[0].correctlyPlaced).toBe(true);
    });

    it('marks wine as misplaced when in a different zone row', () => {
      // Wine that findBestZone says is cabernet, but sits in a shiraz row
      const wines = [
        makeWine({ id: 1, slot_id: 'R10C1', zone_id: 'cabernet' })
      ];

      const zoneMap = { R10: zoneMapEntry('shiraz', 'Shiraz') };
      const result = scanBottles(wines, zoneMap);
      const group = result.groups.find(g => g.zoneId === 'cabernet');

      expect(group.correctlyPlacedCount).toBe(0);
      expect(group.misplacedCount).toBe(1);
      expect(group.wines[0].correctlyPlaced).toBe(false);
    });

    it('marks wine as misplaced when zone map has no allocations', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' })
      ];

      // Empty zone map — no rows allocated to any zone
      const result = scanBottles(wines, {});
      const group = result.groups[0];

      expect(group.correctlyPlacedCount).toBe(0);
      expect(group.misplacedCount).toBe(1);
    });
  });

  describe('physical rows and allocated rows', () => {
    it('tracks physical rows where wines actually sit', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' }),
        makeWine({ id: 2, slot_id: 'R8C2' }),
        makeWine({ id: 3, slot_id: 'R9C1' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon'),
        R9: zoneMapEntry('cabernet', 'Cabernet Sauvignon', { rowNumber: 2, totalRows: 2 })
      };

      const result = scanBottles(wines, zoneMap);
      const group = result.groups[0];

      expect(group.physicalRows).toEqual(['R8', 'R9']);
      expect(group.allocatedRows).toEqual(['R8', 'R9']);
    });

    it('shows allocated rows even when no wines sit in them', () => {
      // Only 1 wine in R8, but zone has R8 and R9 allocated
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon', { totalRows: 2 }),
        R9: zoneMapEntry('cabernet', 'Cabernet Sauvignon', { rowNumber: 2, totalRows: 2 })
      };

      const result = scanBottles(wines, zoneMap);
      const group = result.groups[0];

      expect(group.physicalRows).toEqual(['R8']);
      expect(group.allocatedRows).toEqual(['R8', 'R9']);
    });
  });

  describe('demand rows and deficit', () => {
    it('calculates demand rows from bottle count (9 per row)', () => {
      const wines = Array.from({ length: 15 }, (_, i) =>
        makeWine({ id: i + 1, slot_id: `R8C${(i % 9) + 1}` })
      );

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon')
      };

      const result = scanBottles(wines, zoneMap);
      const group = result.groups[0];

      // 15 bottles / 9 per row = ceil(1.67) = 2
      expect(group.demandRows).toBe(2);
    });

    it('calculates positive deficit when demand exceeds allocation', () => {
      const wines = Array.from({ length: 20 }, (_, i) =>
        makeWine({ id: i + 1, slot_id: `R8C${(i % 9) + 1}` })
      );

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon')
      };

      const result = scanBottles(wines, zoneMap);
      const group = result.groups[0];

      // demand = ceil(20/9) = 3, allocated = 1, deficit = 2
      expect(group.demandRows).toBe(3);
      expect(group.rowDeficit).toBe(2);
    });

    it('accounts for R1 reduced capacity (7 slots) in deficit calculation', () => {
      // 8 SB bottles allocated to R1 which only holds 7 — need 1 more row
      const wines = Array.from({ length: 8 }, (_, i) =>
        makeWine({
          id: i + 1,
          wine_name: `Sauvignon Blanc ${i + 1}`,
          grapes: 'sauvignon blanc',
          colour: 'white',
          zone_id: 'sauvignon_blanc',
          slot_id: `R1C${(i % 7) + 1}`
        })
      );

      const zoneMap = {
        R1: zoneMapEntry('sauvignon_blanc', 'Sauvignon Blanc')
      };

      const result = scanBottles(wines, zoneMap);
      const group = result.groups.find(g => g.zoneId === 'sauvignon_blanc');

      // demandRows = ceil(8/9) = 1, but R1 only holds 7 → overflow = 1 → deficit = 1
      expect(group.demandRows).toBe(1);
      expect(group.rowDeficit).toBe(1);
    });

    it('shows zero deficit when R1 capacity exactly fits', () => {
      // 7 SB bottles in R1 — exactly fits
      const wines = Array.from({ length: 7 }, (_, i) =>
        makeWine({
          id: i + 1,
          wine_name: `Sauvignon Blanc ${i + 1}`,
          grapes: 'sauvignon blanc',
          colour: 'white',
          zone_id: 'sauvignon_blanc',
          slot_id: `R1C${i + 1}`
        })
      );

      const zoneMap = {
        R1: zoneMapEntry('sauvignon_blanc', 'Sauvignon Blanc')
      };

      const result = scanBottles(wines, zoneMap);
      const group = result.groups.find(g => g.zoneId === 'sauvignon_blanc');

      expect(group.demandRows).toBe(1);
      expect(group.rowDeficit).toBe(0);
    });

    it('calculates negative deficit when allocation exceeds demand', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon', { totalRows: 3 }),
        R9: zoneMapEntry('cabernet', 'Cabernet Sauvignon', { rowNumber: 2, totalRows: 3 }),
        R10: zoneMapEntry('cabernet', 'Cabernet Sauvignon', { rowNumber: 3, totalRows: 3 })
      };

      const result = scanBottles(wines, zoneMap);
      const group = result.groups[0];

      // demand = ceil(1/9) = 1, allocated = 3, deficit = -2
      expect(group.demandRows).toBe(1);
      expect(group.rowDeficit).toBe(-2);
    });
  });

  describe('consolidation opportunities', () => {
    it('identifies wines scattered outside their allocated zone rows', () => {
      // Wine canonically belongs to cabernet, but sits in R10 (shiraz row)
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' }),
        makeWine({ id: 2, slot_id: 'R10C5' })  // in shiraz row, but findBestZone says cabernet
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon'),
        R10: zoneMapEntry('shiraz', 'Shiraz')
      };

      const result = scanBottles(wines, zoneMap);

      expect(result.consolidationOpportunities).toHaveLength(1);
      const opp = result.consolidationOpportunities[0];

      expect(opp.zoneId).toBe('cabernet');
      expect(opp.totalBottles).toBe(2);
      expect(opp.scattered).toHaveLength(1);
      expect(opp.scattered[0].wineId).toBe(2);
      expect(opp.scattered[0].currentSlot).toBe('R10C5');
      expect(opp.scattered[0].physicalRowZone).toBe('Shiraz');
    });

    it('returns no consolidation when all wines are in their allocated rows', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R8C1' }),
        makeWine({ id: 2, slot_id: 'R8C2' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon')
      };

      const result = scanBottles(wines, zoneMap);
      expect(result.consolidationOpportunities).toHaveLength(0);
    });

    it('shows physicalRowZone as "unallocated" for rows not in zone map', () => {
      const wines = [
        makeWine({ id: 1, slot_id: 'R15C1' })
      ];

      // R15 not in zone map, zone map only has R8
      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon')
      };

      const result = scanBottles(wines, zoneMap);

      expect(result.consolidationOpportunities).toHaveLength(1);
      expect(result.consolidationOpportunities[0].scattered[0].physicalRowZone).toBe('unallocated');
    });

    it('sorts consolidation opportunities by scattered count descending', () => {
      const wines = [
        // 1 shiraz wine scattered
        makeWine({ id: 1, wine_name: 'Shiraz 1', grapes: 'shiraz', zone_id: 'shiraz', slot_id: 'R8C3' }),
        // 3 pinot wines scattered
        makeWine({ id: 2, wine_name: 'Pinot 1', grapes: 'pinot noir', colour: 'red', zone_id: 'pinot_noir', slot_id: 'R8C4' }),
        makeWine({ id: 3, wine_name: 'Pinot 2', grapes: 'pinot noir', colour: 'red', zone_id: 'pinot_noir', slot_id: 'R8C5' }),
        makeWine({ id: 4, wine_name: 'Pinot 3', grapes: 'pinot noir', colour: 'red', zone_id: 'pinot_noir', slot_id: 'R10C1' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon'),
        R10: zoneMapEntry('shiraz', 'Shiraz'),
        R12: zoneMapEntry('pinot_noir', 'Pinot Noir')
      };

      const result = scanBottles(wines, zoneMap);

      // Pinot should be first (3 scattered) then Shiraz (1 scattered)
      expect(result.consolidationOpportunities.length).toBeGreaterThanOrEqual(2);
      const pinotOpp = result.consolidationOpportunities.find(o => o.zoneId === 'pinot_noir');
      const shirazOpp = result.consolidationOpportunities.find(o => o.zoneId === 'shiraz');
      expect(pinotOpp).toBeDefined();
      expect(shirazOpp).toBeDefined();

      const pinotIdx = result.consolidationOpportunities.indexOf(pinotOpp);
      const shirazIdx = result.consolidationOpportunities.indexOf(shirazOpp);
      expect(pinotIdx).toBeLessThan(shirazIdx);
    });
  });

  describe('wine entry shape', () => {
    it('populates all expected fields on each wine entry', () => {
      const wines = [
        makeWine({ id: 42, wine_name: 'Estate Cab 2019', slot_id: 'R8C3', zone_id: 'cabernet' })
      ];

      const zoneMap = { R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon') };
      const result = scanBottles(wines, zoneMap);
      const entry = result.groups[0].wines[0];

      expect(entry).toEqual(expect.objectContaining({
        wineId: 42,
        wineName: 'Estate Cab 2019',
        slot: 'R8C3',
        physicalRow: 'R8',
        currentZoneId: 'cabernet',
        canonicalZoneId: 'cabernet',
        correctlyPlaced: true
      }));
      expect(entry).toHaveProperty('confidence');
      expect(entry).toHaveProperty('score');
    });

    it('uses location_code as fallback when slot_id is missing', () => {
      const wines = [
        makeWine({ id: 1, slot_id: null, location_code: 'R5C2' })
      ];

      const zoneMap = { R5: zoneMapEntry('cabernet', 'Cabernet Sauvignon') };
      const result = scanBottles(wines, zoneMap);

      expect(result.totalBottles).toBe(1);
      expect(result.groups[0].wines[0].slot).toBe('R5C2');
      expect(result.groups[0].wines[0].physicalRow).toBe('R5');
    });
  });

  describe('unclassified wines', () => {
    it('groups unclassified wines into an unclassified zone group', () => {
      // Wine with no grape signal — findBestZone returns unclassified
      const wines = [
        makeWine({
          id: 1,
          wine_name: 'Mystery Blend',
          grapes: null,
          colour: null,
          country: null,
          region: null,
          style: null,
          zone_id: 'unclassified',
          slot_id: 'R15C1'
        })
      ];

      const zoneMap = { R15: zoneMapEntry('unclassified', 'Unclassified') };
      const result = scanBottles(wines, zoneMap);

      const unclassifiedGroup = result.groups.find(g => g.zoneId === 'unclassified');
      expect(unclassifiedGroup).toBeDefined();
      expect(unclassifiedGroup.bottleCount).toBe(1);
    });
  });

  describe('mixed scenario — real-world-like cellar', () => {
    it('handles a cellar with correctly placed, misplaced, and scattered wines', () => {
      const wines = [
        // Correctly placed cabernets in R8
        makeWine({ id: 1, wine_name: 'Cab 1', slot_id: 'R8C1' }),
        makeWine({ id: 2, wine_name: 'Cab 2', slot_id: 'R8C2' }),
        // Cabernet sitting in shiraz row (scattered)
        makeWine({ id: 3, wine_name: 'Cab 3', slot_id: 'R10C1' }),
        // Shiraz correctly in R10
        makeWine({ id: 4, wine_name: 'Shiraz 1', grapes: 'shiraz', zone_id: 'shiraz', slot_id: 'R10C5' }),
        // Fridge wine (excluded)
        makeWine({ id: 5, wine_name: 'Fridge SB', slot_id: 'F1' })
      ];

      const zoneMap = {
        R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon'),
        R10: zoneMapEntry('shiraz', 'Shiraz')
      };

      const result = scanBottles(wines, zoneMap);

      expect(result.totalBottles).toBe(4); // excludes fridge
      expect(result.totalGroups).toBe(2);

      const cabGroup = result.groups.find(g => g.zoneId === 'cabernet');
      expect(cabGroup.bottleCount).toBe(3);
      expect(cabGroup.correctlyPlacedCount).toBe(2);
      expect(cabGroup.misplacedCount).toBe(1);
      expect(cabGroup.physicalRows).toEqual(['R8', 'R10']);
      expect(cabGroup.allocatedRows).toEqual(['R8']);

      const shirazGroup = result.groups.find(g => g.zoneId === 'shiraz');
      expect(shirazGroup.bottleCount).toBe(1);
      expect(shirazGroup.correctlyPlacedCount).toBe(1);
      expect(shirazGroup.misplacedCount).toBe(0);

      // Cabernet has 1 scattered bottle in R10 (shiraz row)
      const cabConsolidation = result.consolidationOpportunities.find(o => o.zoneId === 'cabernet');
      expect(cabConsolidation).toBeDefined();
      expect(cabConsolidation.scattered).toHaveLength(1);
      expect(cabConsolidation.scattered[0].wineId).toBe(3);
    });
  });
});

// ── rowCleanlinessSweep (Phase B3) ────────────────────────────

describe('rowCleanlinessSweep (Phase B3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags red wine in white zone as critical severity', () => {
    // Shiraz (red) sitting in Aromatic Whites (white zone)
    const slotToWine = new Map([
      ['R5C1', makeWine({
        id: 1,
        wine_name: 'Stellenbosch Shiraz 2020',
        grapes: 'shiraz',
        colour: 'red',
        slot_id: 'R5C1'
      })]
    ]);

    const zoneMap = {
      R5: zoneMapEntry('aromatic_whites', 'Aromatic Whites')
    };

    const violations = rowCleanlinessSweep(slotToWine, zoneMap);

    expect(violations.length).toBeGreaterThanOrEqual(1);
    const shirazViolation = violations.find(v => v.wineId === 1);
    expect(shirazViolation).toBeDefined();
    expect(shirazViolation.severity).toBe('critical');
    expect(shirazViolation.reason).toContain('Colour violation');
    expect(shirazViolation.bestZoneId).not.toBe('aromatic_whites');
  });

  it('flags white wine in red zone as critical severity', () => {
    // Sauvignon Blanc (white) in Cabernet zone (red)
    const slotToWine = new Map([
      ['R10C1', makeWine({
        id: 2,
        wine_name: 'Marlborough Sauvignon Blanc 2023',
        grapes: 'sauvignon blanc',
        colour: 'white',
        slot_id: 'R10C1'
      })]
    ]);

    const zoneMap = {
      R10: zoneMapEntry('cabernet', 'Cabernet Sauvignon')
    };

    const violations = rowCleanlinessSweep(slotToWine, zoneMap);

    expect(violations.length).toBeGreaterThanOrEqual(1);
    const sbViolation = violations.find(v => v.wineId === 2);
    expect(sbViolation).toBeDefined();
    expect(sbViolation.severity).toBe('critical');
  });

  it('flags same-colour misplacement as moderate when score delta ≥ 40', () => {
    // Sauvignon Blanc in Chenin Blanc row — both white zones,
    // but findBestZone will score sauvignon_blanc much higher (grape match 35+ pts)
    const slotToWine = new Map([
      ['R3C1', makeWine({
        id: 3,
        wine_name: 'Loire Sauvignon Blanc 2022',
        grapes: 'sauvignon blanc',
        colour: 'white',
        slot_id: 'R3C1'
      })]
    ]);

    const zoneMap = {
      R3: zoneMapEntry('chenin_blanc', 'Chenin Blanc')
    };

    const violations = rowCleanlinessSweep(slotToWine, zoneMap);

    expect(violations.length).toBeGreaterThanOrEqual(1);
    const sbViolation = violations.find(v => v.wineId === 3);
    expect(sbViolation).toBeDefined();
    expect(sbViolation.severity).toBe('moderate');
    expect(sbViolation.bestZoneId).toBe('sauvignon_blanc');
    expect(sbViolation.scoreDelta).toBeGreaterThanOrEqual(40);
    expect(typeof sbViolation.rowZoneScore).toBe('number');
    expect(sbViolation.reason).toContain('Better fit');
  });

  it('does not flag correctly placed wine', () => {
    // Cabernet Sauvignon in its own zone row
    const slotToWine = new Map([
      ['R8C1', makeWine({
        id: 4,
        wine_name: 'Stellenbosch Cabernet 2019',
        grapes: 'cabernet sauvignon',
        colour: 'red',
        slot_id: 'R8C1'
      })]
    ]);

    const zoneMap = {
      R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon')
    };

    const violations = rowCleanlinessSweep(slotToWine, zoneMap);
    expect(violations).toHaveLength(0);
  });

  it('skips empty slots', () => {
    const slotToWine = new Map(); // no wines at all

    const zoneMap = {
      R8: zoneMapEntry('cabernet', 'Cabernet Sauvignon')
    };

    const violations = rowCleanlinessSweep(slotToWine, zoneMap);
    expect(violations).toHaveLength(0);
  });

  it('sorts critical violations before moderate', () => {
    const slotToWine = new Map([
      // Moderate: Sauvignon Blanc in Chenin row (same colour)
      ['R3C1', makeWine({
        id: 1,
        wine_name: 'Loire Sauvignon Blanc 2022',
        grapes: 'sauvignon blanc',
        colour: 'white',
        slot_id: 'R3C1'
      })],
      // Critical: Shiraz in Aromatic Whites (colour violation)
      ['R5C1', makeWine({
        id: 2,
        wine_name: 'Barossa Shiraz 2020',
        grapes: 'shiraz',
        colour: 'red',
        slot_id: 'R5C1'
      })]
    ]);

    const zoneMap = {
      R3: zoneMapEntry('chenin_blanc', 'Chenin Blanc'),
      R5: zoneMapEntry('aromatic_whites', 'Aromatic Whites')
    };

    const violations = rowCleanlinessSweep(slotToWine, zoneMap);

    expect(violations.length).toBeGreaterThanOrEqual(2);
    // Critical should come first
    expect(violations[0].severity).toBe('critical');
    expect(violations[violations.length - 1].severity).toBe('moderate');
  });

  it('populates all expected fields on each violation', () => {
    const slotToWine = new Map([
      ['R5C1', makeWine({
        id: 10,
        wine_name: 'Misplaced Shiraz',
        grapes: 'shiraz',
        colour: 'red',
        slot_id: 'R5C1'
      })]
    ]);

    const zoneMap = {
      R5: zoneMapEntry('aromatic_whites', 'Aromatic Whites')
    };

    const violations = rowCleanlinessSweep(slotToWine, zoneMap);

    expect(violations).toHaveLength(1);
    const v = violations[0];
    expect(v).toEqual(expect.objectContaining({
      wineId: 10,
      wineName: 'Misplaced Shiraz',
      slot: 'R5C1',
      physicalRow: 'R5',
      rowZoneId: 'aromatic_whites',
      rowZoneName: 'Aromatic Whites',
      severity: 'critical'
    }));
    expect(v).toHaveProperty('bestZoneId');
    expect(v).toHaveProperty('bestZoneName');
    expect(v).toHaveProperty('bestScore');
    expect(v).toHaveProperty('rowZoneScore');
    expect(v).toHaveProperty('scoreDelta');
    expect(v).toHaveProperty('confidence');
    expect(v).toHaveProperty('reason');
  });
});
