/**
 * @fileoverview Unit tests for Phase 4.4 zone health suggestion engine.
 * Tests the classification and zone filtering logic used by the engine,
 * and exercises generateZoneHealthSuggestions end-to-end via its test export.
 * @module tests/unit/services/cellar/zoneHealthSuggestions.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/cellar/cellarLayout.js', () => ({
  getStorageAreaRows:     vi.fn().mockResolvedValue([]),
  getCellarRowCount:      vi.fn().mockResolvedValue(19),
  getStorageAreasByType:  vi.fn().mockResolvedValue({})
}));

vi.mock('../../../../src/services/shared/cellarLayoutSettings.js', async () => {
  const actual = await vi.importActual('../../../../src/services/shared/cellarLayoutSettings.js');
  return {
    ...actual,
    getCellarLayoutSettings: vi.fn().mockResolvedValue({ fillDirection: 'left', colourOrder: 'whites-top' }),
    getDynamicColourRowRanges: vi.fn().mockResolvedValue({
      whiteRows: [1,2,3,4,5,6,7], redRows: [8,9,10,11,12,13,14,15,16,17,18,19],
      whiteRowCount: 7, redRowCount: 12, whiteCount: 0, redCount: 0
    })
  };
});

// ── Tests ──────────────────────────────────────────────────

describe('findBestZone — zone filtering (options.zones)', () => {
  let findBestZone, getZoneById, CELLAR_ZONES;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ findBestZone } = await vi.importActual('../../../../src/services/cellar/cellarPlacement.js'));
    ({ getZoneById, CELLAR_ZONES } = await vi.importActual('../../../../src/config/cellarZones.js'));
  });

  it('classifies red Bordeaux wine into a red zone', () => {
    const wine = { colour: 'red', country: 'France', region: 'Bordeaux', grapes: 'Cabernet Sauvignon' };
    const result = findBestZone(wine);
    expect(result).toHaveProperty('zoneId');
    expect(['high', 'medium', 'low']).toContain(result.confidence);
    const zone = getZoneById(result.zoneId);
    expect(zone).toBeDefined();
  });

  it('classifies white Burgundy into a white zone', () => {
    const wine = { colour: 'white', country: 'France', region: 'Burgundy', grapes: 'Chardonnay' };
    const result = findBestZone(wine);
    expect(result).toHaveProperty('zoneId');
    const zone = getZoneById(result.zoneId);
    expect(zone).toBeDefined();
  });

  it('when options.zones restricts to buffer-only, wine lands in a buffer or fallback', () => {
    const bufferOnly = CELLAR_ZONES.zones.filter(z => z.isBufferZone || z.isFallbackZone);
    const wine = { colour: 'red', country: 'France', grapes: 'Cabernet Sauvignon' };
    const result = findBestZone(wine, { zones: bufferOnly });
    const validIds = new Set(bufferOnly.map(z => z.id));
    expect(validIds.has(result.zoneId)).toBe(true);
  });

  it('returns alternativeZones array when explain: true', () => {
    const wine = { colour: 'red', country: 'France', region: 'Bordeaux', grapes: 'Cabernet Sauvignon' };
    const result = findBestZone(wine, { explain: true });
    expect(Array.isArray(result.alternativeZones)).toBe(true);
  });
});

function makeDb(rows, throwError = false) {
  return {
    prepare: vi.fn().mockReturnValue({
      all: throwError
        ? vi.fn().mockRejectedValue(new Error('table not found'))
        : vi.fn().mockResolvedValue(rows)
    })
  };
}

describe('getZonesForCellar — per-cellar config lookup', () => {
  let getZonesForCellar, CELLAR_ZONES;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ getZonesForCellar, CELLAR_ZONES } = await vi.importActual('../../../../src/config/cellarZones.js'));
  });

  it('returns global list on DB error', async () => {
    const result = await getZonesForCellar('cellar-1', makeDb([], true));
    expect(result).toBe(CELLAR_ZONES.zones);
  });

  it('filters out disabled zones', async () => {
    const targetZone = CELLAR_ZONES.zones[0];
    const rows = [{ zone_id: targetZone.id, enabled: false, display_name: null, sort_order: null }];
    const result = await getZonesForCellar('cellar-1', makeDb(rows));
    expect(result.find(z => z.id === targetZone.id)).toBeUndefined();
  });

  it('applies display_name override from config', async () => {
    const targetZone = CELLAR_ZONES.zones[0];
    const rows = [{ zone_id: targetZone.id, enabled: true, display_name: 'Custom Name', sort_order: null }];
    const result = await getZonesForCellar('cellar-1', makeDb(rows));
    const zone = result.find(z => z.id === targetZone.id);
    expect(zone.displayName).toBe('Custom Name');
  });
});

describe('getZoneById', () => {
  let getZoneById;

  beforeEach(async () => {
    ({ getZoneById } = await vi.importActual('../../../../src/config/cellarZones.js'));
  });

  it('returns zone for red_buffer', () => {
    const zone = getZoneById('red_buffer');
    expect(zone).toBeDefined();
    expect(zone.isBufferZone).toBe(true);
  });

  it('returns zone for white_buffer', () => {
    const zone = getZoneById('white_buffer');
    expect(zone).toBeDefined();
    expect(zone.isBufferZone).toBe(true);
  });

  it('returns undefined for unknown zone', () => {
    expect(getZoneById('does_not_exist_xyz')).toBeUndefined();
  });
});

// ── Helpers ────────────────────────────────────────────────

/**
 * Build a wine fixture that strongly matches the 'piedmont' zone
 * (Nebbiolo + Barolo keyword + Italy/Piedmont region).
 * Used to test enable_zone suggestions.
 */
function makePiedmontWine(slotId) {
  return {
    colour: 'red',
    country: 'Italy',
    region: 'Piedmont',
    grapes: 'Nebbiolo',
    wine_name: 'Barolo Riserva',
    vintage: 2018,
    slot_id: slotId,
    location_code: slotId
  };
}

describe('generateZoneHealthSuggestions — enable_zone', () => {
  let generateZoneHealthSuggestions;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ _generateZoneHealthSuggestions: generateZoneHealthSuggestions } =
      await vi.importActual('../../../../src/services/cellar/cellarAnalysis.js'));
  });

  it('generates enable_zone when ≥10 buffer-zone wines match a specific zone', () => {
    // 10 Piedmont wines physically stored in red_buffer rows
    const wines = Array.from({ length: 10 }, (_, i) => makePiedmontWine(`R8C${i + 1}`));

    const zoneMap = {
      R8: { zoneId: 'red_buffer' }
    };

    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);
    const enableSuggestions = suggestions.filter(s => s.type === 'enable_zone');

    expect(enableSuggestions).toHaveLength(1);
    expect(enableSuggestions[0].zoneId).toBe('piedmont');
    expect(enableSuggestions[0].bottleCount).toBe(10);
    expect(enableSuggestions[0].message).toContain('Piedmont');
  });

  it('does NOT generate enable_zone when fewer than 10 buffer wines match', () => {
    // Only 9 Piedmont wines in red_buffer rows → below threshold
    const wines = Array.from({ length: 9 }, (_, i) => makePiedmontWine(`R8C${i + 1}`));

    const zoneMap = { R8: { zoneId: 'red_buffer' } };
    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);

    expect(suggestions.filter(s => s.type === 'enable_zone')).toHaveLength(0);
  });

  it('does NOT generate enable_zone for wines NOT in buffer/fallback rows', () => {
    // 15 Piedmont wines — but their rows map to 'piedmont', not a buffer zone
    const wines = Array.from({ length: 15 }, (_, i) => makePiedmontWine(`R9C${i + 1}`));

    const zoneMap = { R9: { zoneId: 'piedmont' } };
    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);

    expect(suggestions.filter(s => s.type === 'enable_zone')).toHaveLength(0);
  });

  it('ignores fridge wines (non-R slots) in enable_zone counting', () => {
    // 10 Piedmont wines in fridge slots — should be filtered out
    const wines = Array.from({ length: 10 }, (_, i) => ({
      ...makePiedmontWine(`F${i + 1}`),
      slot_id: `F${i + 1}`,
      location_code: `F${i + 1}`
    }));

    const zoneMap = { R8: { zoneId: 'red_buffer' } };
    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);

    expect(suggestions.filter(s => s.type === 'enable_zone')).toHaveLength(0);
  });
});

describe('generateZoneHealthSuggestions — merge_zone', () => {
  let generateZoneHealthSuggestions;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ _generateZoneHealthSuggestions: generateZoneHealthSuggestions } =
      await vi.importActual('../../../../src/services/cellar/cellarAnalysis.js'));
  });

  it('generates merge_zone when ≤3 wines occupy a dedicated zone row', () => {
    // 2 wines in R8 which is mapped to 'piedmont' (a non-buffer zone)
    const wines = [
      { colour: 'red', slot_id: 'R8C1', location_code: 'R8C1' },
      { colour: 'red', slot_id: 'R8C2', location_code: 'R8C2' }
    ];
    const zoneMap = { R8: { zoneId: 'piedmont' } };

    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);
    const mergeSuggestions = suggestions.filter(s => s.type === 'merge_zone');

    expect(mergeSuggestions).toHaveLength(1);
    expect(mergeSuggestions[0].zoneId).toBe('piedmont');
    expect(mergeSuggestions[0].bottleCount).toBe(2);
    expect(mergeSuggestions[0].message).toContain('Piedmont');
  });

  it('does NOT generate merge_zone when >3 wines in zone', () => {
    // 4 wines → above threshold
    const wines = Array.from({ length: 4 }, (_, i) => ({
      colour: 'red', slot_id: `R8C${i + 1}`, location_code: `R8C${i + 1}`
    }));
    const zoneMap = { R8: { zoneId: 'piedmont' } };

    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);
    expect(suggestions.filter(s => s.type === 'merge_zone')).toHaveLength(0);
  });

  it('suppresses merge_zone suggestions when hasZoneAllocations is false', () => {
    const wines = [
      { colour: 'red', slot_id: 'R8C1', location_code: 'R8C1' }
    ];
    const zoneMap = { R8: { zoneId: 'piedmont' } };

    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, false);
    expect(suggestions.filter(s => s.type === 'merge_zone')).toHaveLength(0);
  });

  it('does NOT generate merge_zone for buffer zones', () => {
    // 1 wine in a red_buffer row → red_buffer is a buffer zone, should not be merge candidate
    const wines = [{ colour: 'red', slot_id: 'R8C1', location_code: 'R8C1' }];
    const zoneMap = { R8: { zoneId: 'red_buffer' } };

    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);
    expect(suggestions.filter(s => s.type === 'merge_zone')).toHaveLength(0);
  });
});

describe('generateZoneHealthSuggestions — healthy collection', () => {
  let generateZoneHealthSuggestions;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ _generateZoneHealthSuggestions: generateZoneHealthSuggestions } =
      await vi.importActual('../../../../src/services/cellar/cellarAnalysis.js'));
  });

  it('returns empty array when no health issues detected', () => {
    // 8 wines in piedmont rows (> merge threshold, < enable threshold trigger)
    const wines = Array.from({ length: 8 }, (_, i) => ({
      colour: 'red', slot_id: `R8C${i + 1}`, location_code: `R8C${i + 1}`
    }));
    const zoneMap = { R8: { zoneId: 'piedmont' } };

    const suggestions = generateZoneHealthSuggestions(wines, zoneMap, true);
    expect(suggestions).toHaveLength(0);
  });
});
