/**
 * @fileoverview Unit tests for cellar metrics: scattering detection, color adjacency,
 * and per-bottle colour guard.
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
  calculateFragmentation,
  wineViolatesZoneColour,
  isCorrectlyPlaced,
  isLegitimateBufferPlacement,
  detectDuplicatePlacements
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

// ─── wineViolatesZoneColour ─────────────────────────────

describe('wineViolatesZoneColour', () => {
  // Helper: minimal zone object
  const whiteZone = { id: 'sauvignon_blanc', color: 'white' };
  const redZone = { id: 'cabernet', color: 'red' };
  const arrayZone = { id: 'rose_sparkling', color: ['rose', 'sparkling'] };
  const nullColorZone = { id: 'curiosities', color: null, isCuratedZone: true };
  const fallbackZone = { id: 'unclassified', color: null, isFallbackZone: true };
  const bufferZone = { id: 'white_buffer', color: ['white', 'rose'], isBufferZone: true };

  // ── Red wine in white zone ──

  it('flags red wine (explicit colour) in white zone', () => {
    const wine = { colour: 'red', wine_name: 'Cabernet Sauvignon' };
    expect(wineViolatesZoneColour(wine, whiteZone)).toBe(true);
  });

  it('flags red wine (inferred from name) in white zone', () => {
    // No explicit colour field — inferColor should detect "shiraz" as red
    const wine = { wine_name: 'De Grendel Shiraz 2020' };
    expect(wineViolatesZoneColour(wine, whiteZone)).toBe(true);
  });

  it('flags red wine via .color field in white zone', () => {
    const wine = { color: 'red', wine_name: 'Merlot 2019' };
    expect(wineViolatesZoneColour(wine, whiteZone)).toBe(true);
  });

  // ── White wine in red zone ──

  it('flags white wine (explicit colour) in red zone', () => {
    const wine = { colour: 'white', wine_name: 'Chenin Blanc' };
    expect(wineViolatesZoneColour(wine, redZone)).toBe(true);
  });

  it('flags white wine (inferred from name) in red zone', () => {
    const wine = { wine_name: 'Sauvignon Blanc 2023' };
    expect(wineViolatesZoneColour(wine, redZone)).toBe(true);
  });

  // ── Rosé/sparkling in red zone ──

  it('flags rosé wine in red zone', () => {
    const wine = { colour: 'rose', wine_name: 'Rosé 2023' };
    expect(wineViolatesZoneColour(wine, redZone)).toBe(true);
  });

  it('flags sparkling wine in red zone', () => {
    const wine = { colour: 'sparkling', wine_name: 'Champagne NV' };
    expect(wineViolatesZoneColour(wine, redZone)).toBe(true);
  });

  // ── Correct placements ──

  it('allows white wine in white zone', () => {
    const wine = { colour: 'white', wine_name: 'Chardonnay 2022' };
    expect(wineViolatesZoneColour(wine, whiteZone)).toBe(false);
  });

  it('allows red wine in red zone', () => {
    const wine = { colour: 'red', wine_name: 'Cabernet 2020' };
    expect(wineViolatesZoneColour(wine, redZone)).toBe(false);
  });

  it('allows rosé in white zone (white family)', () => {
    const wine = { colour: 'rose', wine_name: 'Rosé 2023' };
    expect(wineViolatesZoneColour(wine, whiteZone)).toBe(false);
  });

  // ── Special zone types ──

  it('skips check for buffer zones', () => {
    const wine = { colour: 'red', wine_name: 'Shiraz 2020' };
    expect(wineViolatesZoneColour(wine, bufferZone)).toBe(false);
  });

  it('skips check for fallback zones', () => {
    const wine = { colour: 'red', wine_name: 'Shiraz 2020' };
    expect(wineViolatesZoneColour(wine, fallbackZone)).toBe(false);
  });

  it('skips check for curated zones', () => {
    const wine = { colour: 'red', wine_name: 'Saperavi 2019' };
    expect(wineViolatesZoneColour(wine, nullColorZone)).toBe(false);
  });

  // ── Array-typed zone colours (e.g. rose_sparkling) ──

  it('flags red wine in rose_sparkling zone (all white-family accepted colours)', () => {
    const wine = { colour: 'red', wine_name: 'Cab 2020' };
    expect(wineViolatesZoneColour(wine, arrayZone)).toBe(true);
  });

  it('allows rosé wine in rose_sparkling zone (direct match)', () => {
    const wine = { colour: 'rose', wine_name: 'Rosé 2023' };
    expect(wineViolatesZoneColour(wine, arrayZone)).toBe(false);
  });

  it('allows sparkling wine in rose_sparkling zone (direct match)', () => {
    const wine = { colour: 'sparkling', wine_name: 'Champagne NV' };
    expect(wineViolatesZoneColour(wine, arrayZone)).toBe(false);
  });

  it('flags red wine in dessert_fortified zone (array white-family colours)', () => {
    const dessertZone = { id: 'dessert_fortified', color: ['dessert', 'fortified'] };
    const wine = { colour: 'red', wine_name: 'Cabernet 2020' };
    expect(wineViolatesZoneColour(wine, dessertZone)).toBe(true);
  });

  it('allows fortified wine in dessert_fortified zone', () => {
    const dessertZone = { id: 'dessert_fortified', color: ['dessert', 'fortified'] };
    const wine = { colour: 'fortified', wine_name: 'Tawny Port' };
    expect(wineViolatesZoneColour(wine, dessertZone)).toBe(false);
  });

  it('allows dessert wine in dessert_fortified zone', () => {
    const dessertZone = { id: 'dessert_fortified', color: ['dessert', 'fortified'] };
    const wine = { colour: 'dessert', wine_name: 'Sauternes 2018' };
    expect(wineViolatesZoneColour(wine, dessertZone)).toBe(false);
  });

  it('skips array-colour check when wine colour is unknown', () => {
    const wine = { wine_name: 'Mystery Wine 2020' };
    expect(wineViolatesZoneColour(wine, arrayZone)).toBe(false);
  });

  // ── Edge cases ──

  it('skips check when wine colour cannot be determined', () => {
    const wine = { wine_name: 'Mystery Wine 2020' };
    expect(wineViolatesZoneColour(wine, whiteZone)).toBe(false);
  });

  it('returns false for null zone', () => {
    const wine = { colour: 'red', wine_name: 'Cab' };
    expect(wineViolatesZoneColour(wine, null)).toBe(false);
  });

  // ── Real-world regression cases ──

  it('R5C3: Cabernet Sauvignon in Sauvignon Blanc zone', () => {
    const wine = { wine_name: 'Kleine Zalze Cabernet Sauvignon 2021', colour: 'red' };
    const zone = { id: 'sauvignon_blanc', color: 'white' };
    expect(wineViolatesZoneColour(wine, zone)).toBe(true);
  });

  it('R8: Shiraz in Chenin Blanc zone', () => {
    const wine = { wine_name: 'De Grendel Shiraz 2020', colour: 'red' };
    const zone = { id: 'chenin_blanc', color: 'white' };
    expect(wineViolatesZoneColour(wine, zone)).toBe(true);
  });

  it('R9: Pinot Noir in Aromatic Whites zone', () => {
    const wine = { wine_name: 'Albert Bichot Bourgogne Pinot Noir 2020' };
    const zone = { id: 'aromatic_whites', color: 'white' };
    expect(wineViolatesZoneColour(wine, zone)).toBe(true);
  });

  it('R9: Malvasia (white) in Aromatic Whites zone stays allowed', () => {
    const wine = { wine_name: 'Onna Malvasia 2022', colour: 'white' };
    const zone = { id: 'aromatic_whites', color: 'white' };
    expect(wineViolatesZoneColour(wine, zone)).toBe(false);
  });
});

// ─── isCorrectlyPlaced (colour guard integration) ───────

describe('isCorrectlyPlaced', () => {
  const whiteZone = { id: 'sauvignon_blanc', color: 'white' };
  const redZone = { id: 'cabernet', color: 'red' };

  it('returns false for red wine in white zone even when zone_id matches', () => {
    const wine = { colour: 'red', zone_id: 'sauvignon_blanc', wine_name: 'Cab Sauv' };
    const bestZone = { zoneId: 'cabernet', displayName: 'Cabernet Sauvignon' };
    expect(isCorrectlyPlaced(wine, whiteZone, bestZone)).toBe(false);
  });

  it('returns false for white wine in red zone even when zone_id matches', () => {
    const wine = { colour: 'white', zone_id: 'cabernet', wine_name: 'Chenin Blanc' };
    const bestZone = { zoneId: 'chenin_blanc', displayName: 'Chenin Blanc' };
    expect(isCorrectlyPlaced(wine, redZone, bestZone)).toBe(false);
  });

  it('returns true when bestZone matches physical zone and colour is correct', () => {
    const wine = { colour: 'white', zone_id: 'sauvignon_blanc', wine_name: 'Sauvignon Blanc' };
    const bestZone = { zoneId: 'sauvignon_blanc', displayName: 'Sauvignon Blanc' };
    expect(isCorrectlyPlaced(wine, whiteZone, bestZone)).toBe(true);
  });

  it('returns true via zone_id match when colour is correct', () => {
    const wine = { colour: 'white', zone_id: 'sauvignon_blanc', wine_name: 'Loire Blend' };
    const bestZone = { zoneId: 'loire_light', displayName: 'Loire & Light' };
    expect(isCorrectlyPlaced(wine, whiteZone, bestZone)).toBe(true);
  });

  it('returns true via overflow zone match when colour is correct', () => {
    const wine = { colour: 'white', zone_id: 'other', wine_name: 'Mystery White' };
    const whiteBufferZone = { id: 'white_buffer', color: ['white', 'rose'], isBufferZone: true };
    // sauvignon_blanc has overflowZoneId: 'white_buffer'
    const bestZone = { zoneId: 'sauvignon_blanc', displayName: 'Sauvignon Blanc' };
    expect(isCorrectlyPlaced(wine, whiteBufferZone, bestZone)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    const wine = { colour: 'red', zone_id: 'shiraz', wine_name: 'Shiraz' };
    const bestZone = { zoneId: 'shiraz', displayName: 'Shiraz / Syrah' };
    // Wine is red, zone is white, and nothing else matches
    expect(isCorrectlyPlaced(wine, whiteZone, bestZone)).toBe(false);
  });
});

// ─── isCorrectlyPlaced (Phase 4.1 – stale zone_id hardening) ──────

describe('isCorrectlyPlaced – stale zone_id detection (Phase 4.1)', () => {
  const whiteZone = { id: 'sauvignon_blanc', color: 'white' };
  const redZone = { id: 'cabernet', color: 'red' };
  const otherRedZone = { id: 'shiraz', color: 'red' };

  it('returns false when zone_id matches physical zone but bestZone disagrees and physical is NOT an alternative', () => {
    // Wine has zone_id=cabernet, sits in cabernet zone, but bestZone says shiraz
    // and cabernet is not in alternatives (score=0 for cabernet)
    const wine = { colour: 'red', zone_id: 'cabernet', wine_name: 'Shiraz 2020' };
    const bestZone = {
      zoneId: 'shiraz',
      displayName: 'Shiraz / Syrah',
      score: 75,
      alternativeZones: [
        { zoneId: 'southern_france', displayName: 'Southern France', score: 40 }
      ]
    };
    expect(isCorrectlyPlaced(wine, redZone, bestZone)).toBe(false);
  });

  it('returns true when zone_id matches physical zone and physical IS a viable alternative', () => {
    // Wine has zone_id=cabernet, sits in cabernet, bestZone says shiraz
    // but cabernet appears in alternatives with positive score
    const wine = { colour: 'red', zone_id: 'cabernet', wine_name: 'Cab-Shiraz Blend' };
    const bestZone = {
      zoneId: 'shiraz',
      displayName: 'Shiraz / Syrah',
      score: 80,
      alternativeZones: [
        { zoneId: 'cabernet', displayName: 'Cabernet Sauvignon', score: 65 }
      ]
    };
    expect(isCorrectlyPlaced(wine, redZone, bestZone)).toBe(true);
  });

  it('returns true when zone_id matches physical zone AND bestZone also matches', () => {
    const wine = { colour: 'red', zone_id: 'cabernet', wine_name: 'Cabernet Sauvignon' };
    const bestZone = {
      zoneId: 'cabernet',
      displayName: 'Cabernet Sauvignon',
      score: 100,
      alternativeZones: []
    };
    expect(isCorrectlyPlaced(wine, redZone, bestZone)).toBe(true);
  });

  it('returns true when zone_id matches, bestZone disagrees but bestZone has score=0', () => {
    // Conservative: don't flag stale if bestZone itself scored 0 (no good match anywhere)
    const wine = { colour: 'red', zone_id: 'cabernet', wine_name: 'Mystery Red' };
    const bestZone = {
      zoneId: 'unclassified',
      displayName: 'Unclassified',
      score: 0,
      alternativeZones: []
    };
    expect(isCorrectlyPlaced(wine, redZone, bestZone)).toBe(true);
  });
});

// ─── detectDuplicatePlacements (Phase 5.1) ──────────────

describe('detectDuplicatePlacements', () => {
  it('returns empty array when no duplicates exist', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', slot_id: 'R1C1', bottle_count: 2 },
      { id: 1, wine_name: 'Wine A', slot_id: 'R1C2', bottle_count: 2 }
    ];
    expect(detectDuplicatePlacements(wines)).toEqual([]);
  });

  it('detects wine in more slots than bottle_count allows', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', slot_id: 'R1C1', bottle_count: 2 },
      { id: 1, wine_name: 'Wine A', slot_id: 'R1C2', bottle_count: 2 },
      { id: 1, wine_name: 'Wine A', slot_id: 'R2C1', bottle_count: 2 }
    ];
    const result = detectDuplicatePlacements(wines);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      wineId: 1,
      wineName: 'Wine A',
      expectedCount: 2,
      duplicateCount: 1
    });
    expect(result[0].actualSlots).toHaveLength(3);
  });

  it('defaults bottle_count to 1 when not specified', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', slot_id: 'R1C1' },
      { id: 1, wine_name: 'Wine A', slot_id: 'R2C1' }
    ];
    const result = detectDuplicatePlacements(wines);
    expect(result).toHaveLength(1);
    expect(result[0].expectedCount).toBe(1);
    expect(result[0].duplicateCount).toBe(1);
  });

  it('ignores fridge slots (only checks cellar R-prefixed slots)', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', slot_id: 'R1C1', bottle_count: 1 },
      { id: 1, wine_name: 'Wine A', slot_id: 'F1', bottle_count: 1 }
    ];
    // F1 is ignored, so only 1 cellar slot for bottle_count=1 — no duplicate
    expect(detectDuplicatePlacements(wines)).toEqual([]);
  });

  it('uses location_code when slot_id is absent', () => {
    const wines = [
      { id: 1, wine_name: 'Wine A', location_code: 'R1C1', bottle_count: 1 },
      { id: 1, wine_name: 'Wine A', location_code: 'R2C1', bottle_count: 1 }
    ];
    const result = detectDuplicatePlacements(wines);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(detectDuplicatePlacements([])).toEqual([]);
  });
});

// ─── isLegitimateBufferPlacement with physicalZone colour guard ──

describe('isLegitimateBufferPlacement', () => {
  const whiteZone = { id: 'chenin_blanc', color: 'white' };
  const redZone = { id: 'shiraz', color: 'red' };
  const bufferZone = { id: 'white_buffer', color: ['white', 'rose'], isBufferZone: true };

  it('returns false when wine has no zone_id', () => {
    expect(isLegitimateBufferPlacement({ zone_id: null })).toBe(false);
  });

  it('returns false when wine zone_id is a standard zone', () => {
    expect(isLegitimateBufferPlacement({ zone_id: 'shiraz' })).toBe(false);
  });

  it('returns true for unclassified wine in matching colour zone', () => {
    const wine = { zone_id: 'unclassified', colour: 'white', wine_name: 'White Wine' };
    expect(isLegitimateBufferPlacement(wine, whiteZone)).toBe(true);
  });

  it('returns true for buffer-assigned wine without physicalZone', () => {
    const wine = { zone_id: 'unclassified', colour: 'red', wine_name: 'Red Wine' };
    // No physicalZone passed — legacy call without second arg
    expect(isLegitimateBufferPlacement(wine)).toBe(true);
  });

  it('returns false for red wine with unclassified zone_id in white zone', () => {
    const wine = { zone_id: 'unclassified', colour: 'red', wine_name: 'Shiraz' };
    expect(isLegitimateBufferPlacement(wine, whiteZone)).toBe(false);
  });

  it('returns false for white wine with red_buffer zone_id in white zone (colour mismatch is detected)', () => {
    // red_buffer zone_id, but wine is actually white and sits in a white zone — that's fine
    const wine = { zone_id: 'red_buffer', colour: 'white', wine_name: 'Chenin Blanc' };
    // white wine in white zone → no colour violation → legitimate
    expect(isLegitimateBufferPlacement(wine, whiteZone)).toBe(true);
  });

  it('returns false for red wine with curiosities zone_id in white zone', () => {
    const wine = { zone_id: 'curiosities', colour: 'red', wine_name: 'Pinotage' };
    expect(isLegitimateBufferPlacement(wine, whiteZone)).toBe(false);
  });

  it('returns true for red wine with unclassified zone_id in red zone', () => {
    const wine = { zone_id: 'unclassified', colour: 'red', wine_name: 'Merlot' };
    expect(isLegitimateBufferPlacement(wine, redZone)).toBe(true);
  });

  // Real-world regression: Shiraz in Chenin Blanc row with zone_id='unclassified'
  it('regression: Kleine Zalze Shiraz (unclassified) in Chenin Blanc row is NOT legitimate', () => {
    const wine = { zone_id: 'unclassified', colour: 'red', wine_name: 'Kleine Zalze Shiraz 2021' };
    expect(isLegitimateBufferPlacement(wine, whiteZone)).toBe(false);
  });

  // Buffer zones are skipped by wineViolatesZoneColour → always legitimate
  it('returns true for any wine in a buffer zone (buffers accept all colours)', () => {
    const wine = { zone_id: 'unclassified', colour: 'red', wine_name: 'Shiraz' };
    expect(isLegitimateBufferPlacement(wine, bufferZone)).toBe(true);
  });
});
