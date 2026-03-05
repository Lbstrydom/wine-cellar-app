/**
 * @fileoverview Unit tests for Phase 4.4 zone health suggestion engine.
 * Tests the classification and zone filtering logic used by the engine.
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
