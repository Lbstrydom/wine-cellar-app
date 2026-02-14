/**
 * @fileoverview Unit tests for cellar metrics: scattering detection and color adjacency.
 * @module tests/unit/services/cellar/cellarMetrics.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import {
  detectScatteredWines,
  detectColorAdjacencyIssues,
  getEffectiveZoneColor,
  parseSlot,
  calculateFragmentation
} from '../../../../src/services/cellar/cellarMetrics.js';

// ─── parseSlot ────────────────────────────────────────────

describe('parseSlot', () => {
  it('parses R3C7 correctly', () => {
    expect(parseSlot('R3C7')).toEqual({ row: 3, col: 7 });
  });

  it('returns null for fridge slots', () => {
    expect(parseSlot('F1')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot(undefined)).toBeNull();
  });
});

// ─── detectScatteredWines ─────────────────────────────────

describe('detectScatteredWines', () => {
  it('returns empty array when no wines', () => {
    expect(detectScatteredWines([])).toEqual([]);
  });

  it('returns empty when all bottles of a wine are in same row', () => {
    const wines = [
      { id: 1, wine_name: 'Cab', location_code: 'R3C1' },
      { id: 1, wine_name: 'Cab', location_code: 'R3C5' }
    ];
    expect(detectScatteredWines(wines)).toEqual([]);
  });

  it('returns empty when bottles are in contiguous rows', () => {
    const wines = [
      { id: 1, wine_name: 'Cab', location_code: 'R3C1' },
      { id: 1, wine_name: 'Cab', location_code: 'R4C1' }
    ];
    expect(detectScatteredWines(wines)).toEqual([]);
  });

  it('detects scattered wine in non-contiguous rows', () => {
    const wines = [
      { id: 1, wine_name: 'Grenache 2020', location_code: 'R1C3' },
      { id: 1, wine_name: 'Grenache 2020', location_code: 'R5C7' }
    ];
    const result = detectScatteredWines(wines);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      wineId: 1,
      wineName: 'Grenache 2020',
      bottleCount: 2,
      rows: ['R1', 'R5'],
      slots: ['R1C3', 'R5C7']
    });
  });

  it('detects multiple scattered wines', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', location_code: 'R1C1' },
      { id: 1, wine_name: 'Wine A', location_code: 'R10C1' },
      { id: 2, wine_name: 'Wine B', location_code: 'R3C1' },
      { id: 2, wine_name: 'Wine B', location_code: 'R8C1' },
      { id: 3, wine_name: 'Wine C', location_code: 'R5C1' },
      { id: 3, wine_name: 'Wine C', location_code: 'R5C2' }
    ];
    const result = detectScatteredWines(wines);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.wineId === 1)).toBeTruthy();
    expect(result.find(r => r.wineId === 2)).toBeTruthy();
    // Wine C is in same row, not scattered
    expect(result.find(r => r.wineId === 3)).toBeFalsy();
  });

  it('sorts by bottle count descending', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', location_code: 'R1C1' },
      { id: 1, wine_name: 'Wine A', location_code: 'R5C1' },
      { id: 2, wine_name: 'Wine B', location_code: 'R1C2' },
      { id: 2, wine_name: 'Wine B', location_code: 'R5C2' },
      { id: 2, wine_name: 'Wine B', location_code: 'R10C2' }
    ];
    const result = detectScatteredWines(wines);
    expect(result[0].wineName).toBe('Wine B');
    expect(result[0].bottleCount).toBe(3);
  });

  it('ignores fridge slots', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', location_code: 'F1' },
      { id: 1, wine_name: 'Wine A', location_code: 'R5C1' }
    ];
    const result = detectScatteredWines(wines);
    expect(result).toEqual([]);
  });

  it('uses slot_id when location_code not present', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', slot_id: 'R1C1' },
      { id: 1, wine_name: 'Wine A', slot_id: 'R19C1' }
    ];
    const result = detectScatteredWines(wines);
    expect(result).toHaveLength(1);
  });

  it('three contiguous rows is not scattered', () => {
    const wines = [
      { id: 1, wine_name: 'Cab', location_code: 'R3C1' },
      { id: 1, wine_name: 'Cab', location_code: 'R4C1' },
      { id: 1, wine_name: 'Cab', location_code: 'R5C1' }
    ];
    expect(detectScatteredWines(wines)).toEqual([]);
  });
});

// ─── getEffectiveZoneColor ────────────────────────────────

describe('getEffectiveZoneColor', () => {
  it('returns "red" for red zones', () => {
    expect(getEffectiveZoneColor({ color: 'red' })).toBe('red');
  });

  it('returns "white" for white zones', () => {
    expect(getEffectiveZoneColor({ color: 'white' })).toBe('white');
  });

  it('returns "white" for rose/sparkling array colors', () => {
    expect(getEffectiveZoneColor({ color: ['rose', 'sparkling'] })).toBe('white');
  });

  it('returns "red" for array containing red', () => {
    expect(getEffectiveZoneColor({ color: ['red'] })).toBe('red');
  });

  it('returns "any" for fallback zones', () => {
    expect(getEffectiveZoneColor({ isFallbackZone: true, color: 'red' })).toBe('any');
  });

  it('returns "any" for curated zones', () => {
    expect(getEffectiveZoneColor({ isCuratedZone: true, color: null })).toBe('any');
  });

  it('returns "any" for null input', () => {
    expect(getEffectiveZoneColor(null)).toBe('any');
  });
});

// ─── detectColorAdjacencyIssues ───────────────────────────

describe('detectColorAdjacencyIssues', () => {
  it('returns empty array when no zones allocated', () => {
    expect(detectColorAdjacencyIssues({})).toEqual([]);
  });

  it('returns empty when same zone occupies adjacent rows', () => {
    const rowToZone = { R3: 'sauvignon_blanc', R4: 'sauvignon_blanc' };
    expect(detectColorAdjacencyIssues(rowToZone)).toEqual([]);
  });

  it('returns empty when white zones are adjacent', () => {
    const rowToZone = { R1: 'sauvignon_blanc', R2: 'chenin_blanc' };
    expect(detectColorAdjacencyIssues(rowToZone)).toEqual([]);
  });

  it('returns empty when red zones are adjacent', () => {
    const rowToZone = { R8: 'cabernet', R9: 'shiraz' };
    expect(detectColorAdjacencyIssues(rowToZone)).toEqual([]);
  });

  it('detects red zone adjacent to white zone', () => {
    const rowToZone = { R6: 'sauvignon_blanc', R7: 'cabernet' };
    const result = detectColorAdjacencyIssues(rowToZone);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      row1: 'R6',
      zone1: 'sauvignon_blanc',
      color1: 'white',
      row2: 'R7',
      zone2: 'cabernet',
      color2: 'red'
    });
  });

  it('detects multiple adjacency violations', () => {
    const rowToZone = {
      R3: 'cabernet',     // red
      R4: 'chenin_blanc', // white
      R5: 'shiraz'        // red
    };
    const result = detectColorAdjacencyIssues(rowToZone);
    // R3-R4: red next to white, R4-R5: white next to red
    expect(result).toHaveLength(2);
  });

  it('skips buffer/fallback zones (any color)', () => {
    const rowToZone = {
      R7: 'sauvignon_blanc', // white
      R8: 'unclassified',     // fallback - any
      R9: 'cabernet'          // red
    };
    const result = detectColorAdjacencyIssues(rowToZone);
    expect(result).toEqual([]);
  });

  it('skips curated zones (curiosities)', () => {
    const rowToZone = {
      R5: 'sauvignon_blanc',
      R6: 'curiosities',
      R7: 'cabernet'
    };
    const result = detectColorAdjacencyIssues(rowToZone);
    expect(result).toEqual([]);
  });

  it('handles non-contiguous row allocations', () => {
    // Only R1 and R3 are allocated, R2 is empty
    const rowToZone = { R1: 'sauvignon_blanc', R3: 'cabernet' };
    // R1-R2: R2 is empty (no zone), R2-R3: R2 is empty
    expect(detectColorAdjacencyIssues(rowToZone)).toEqual([]);
  });
});
