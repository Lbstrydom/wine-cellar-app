/**
 * @fileoverview Unit tests for zoneAutoDiscovery.proposeZones
 * @module tests/unit/services/zone/zoneAutoDiscovery.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/cellar/cellarLayout.js', () => ({
  getStorageAreaRows: vi.fn().mockResolvedValue([]),
  getCellarRowCount:  vi.fn().mockResolvedValue(19)
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

// ── Helpers ────────────────────────────────────────────────

import db from '../../../../src/db/index.js';

function makeWine(overrides = {}) {
  return {
    id: overrides.id || 1,
    wine_name: overrides.wine_name || 'Test Wine',
    vintage: overrides.vintage || 2018,
    colour: overrides.colour || 'red',
    country: overrides.country || 'France',
    region: overrides.region || null,
    grapes: overrides.grapes || null,
    style: overrides.style || null,
    appellation: overrides.appellation || null,
    winemaking: overrides.winemaking || null,
    sweetness: overrides.sweetness || null,
    zone_id: overrides.zone_id || null,
    location_code: overrides.location_code || 'R1C1'
  };
}

function mockDbAll(rows) {
  db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(rows) });
}

// ── Tests ──────────────────────────────────────────────────

describe('proposeZones', () => {
  let proposeZones;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ proposeZones } = await vi.importActual('../../../../src/services/zone/zoneAutoDiscovery.js'));
  });

  it('returns empty proposals when cellar has no wines', async () => {
    mockDbAll([]);
    const result = await proposeZones('cellar-1');
    expect(result).toMatchObject({
      totalBottles: 0,
      proposals: expect.any(Array),
      mergedZones: expect.any(Array),
      underThresholdZones: expect.any(Array),
      confidenceSummary: expect.objectContaining({ total: 0 })
    });
    expect(result.timestamp).toBeTruthy();
  });

  it('returns result shape with required fields', async () => {
    mockDbAll([makeWine()]);
    const result = await proposeZones('cellar-1');
    expect(result).toHaveProperty('proposals');
    expect(result).toHaveProperty('underThresholdZones');
    expect(result).toHaveProperty('mergedZones');
    expect(result).toHaveProperty('unassignedRows');
    expect(result).toHaveProperty('confidenceSummary');
    expect(result).toHaveProperty('minBottlesPerZone');
    expect(result).toHaveProperty('timestamp');
  });

  it('respects minBottlesPerZone option', async () => {
    mockDbAll([makeWine()]);
    const result = await proposeZones('cellar-1', { minBottlesPerZone: 1 });
    expect(result.minBottlesPerZone).toBe(1);
  });

  it('counts total bottles in confidenceSummary', async () => {
    const wines = [makeWine({ id: 1 }), makeWine({ id: 2 }), makeWine({ id: 3 })];
    mockDbAll(wines);
    const result = await proposeZones('cellar-1');
    expect(result.confidenceSummary.total).toBe(3);
    const { high, medium, low } = result.confidenceSummary;
    expect(high + medium + low).toBe(3);
  });

  it('does not merge buffer zones into themselves', async () => {
    mockDbAll([makeWine({ colour: 'red' }), makeWine({ colour: 'white' })]);
    const result = await proposeZones('cellar-1', { minBottlesPerZone: 100 });
    // All specific zones go under threshold; buffer zones must not appear in mergedZones as targets that are also sources
    for (const m of result.mergedZones) {
      expect(m.zoneId).not.toBe(m.mergedInto);
    }
  });

  it('never returns duplicate zone IDs in proposals', async () => {
    const wines = Array.from({ length: 20 }, (_, i) => makeWine({ id: i + 1 }));
    mockDbAll(wines);
    const result = await proposeZones('cellar-1', { minBottlesPerZone: 1 });
    const ids = result.proposals.map(p => p.zoneId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
