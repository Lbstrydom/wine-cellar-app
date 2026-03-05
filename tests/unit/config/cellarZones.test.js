/**
 * @fileoverview Unit tests for getZonesForCellar (Phase 4.3 per-cellar zone config).
 * @module tests/unit/config/cellarZones.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Imports ────────────────────────────────────────────────

let getZonesForCellar, CELLAR_ZONES;

beforeEach(async () => {
  ({ getZonesForCellar, CELLAR_ZONES } = await vi.importActual('../../../src/config/cellarZones.js'));
});

// ── Fake DB factory ────────────────────────────────────────

function makeDb(rows, throwError = false) {
  return {
    prepare: vi.fn().mockReturnValue({
      all: throwError
        ? vi.fn().mockRejectedValue(new Error('table not found'))
        : vi.fn().mockResolvedValue(rows)
    })
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('getZonesForCellar', () => {
  it('returns full global zone list when cellarId is null', async () => {
    const result = await getZonesForCellar(null, makeDb([]));
    expect(result).toBe(CELLAR_ZONES.zones);
  });

  it('returns full global zone list when db is null', async () => {
    const result = await getZonesForCellar('cellar-1', null);
    expect(result).toBe(CELLAR_ZONES.zones);
  });

  it('returns full global list when no config rows exist', async () => {
    const result = await getZonesForCellar('cellar-1', makeDb([]));
    expect(result).toBe(CELLAR_ZONES.zones);
  });

  it('gracefully falls back to global list on DB error (table not found)', async () => {
    const result = await getZonesForCellar('cellar-1', makeDb([], true));
    expect(result).toBe(CELLAR_ZONES.zones);
  });

  it('filters out disabled zones', async () => {
    const globalZone = CELLAR_ZONES.zones[0];
    const rows = [{ zone_id: globalZone.id, enabled: false, display_name: null, sort_order: null }];
    const result = await getZonesForCellar('cellar-1', makeDb(rows));
    expect(result.find(z => z.id === globalZone.id)).toBeUndefined();
  });

  it('keeps zones not mentioned in config (implicitly enabled)', async () => {
    const [z1, z2] = CELLAR_ZONES.zones;
    // Only z1 is explicitly disabled; z2 has no row → implicitly enabled
    const rows = [{ zone_id: z1.id, enabled: false, display_name: null, sort_order: null }];
    const result = await getZonesForCellar('cellar-1', makeDb(rows));
    expect(result.find(z => z.id === z2.id)).toBeDefined();
  });

  it('applies display_name override', async () => {
    const globalZone = CELLAR_ZONES.zones[0];
    const rows = [{ zone_id: globalZone.id, enabled: true, display_name: 'My Custom Name', sort_order: null }];
    const result = await getZonesForCellar('cellar-1', makeDb(rows));
    const zone = result.find(z => z.id === globalZone.id);
    expect(zone.displayName).toBe('My Custom Name');
  });

  it('applies custom sort_order to bring a zone to the front', async () => {
    // Give the last global zone sort_order: 0 — it should sort to the front
    const lastZone = CELLAR_ZONES.zones[CELLAR_ZONES.zones.length - 1];
    const rows = [{ zone_id: lastZone.id, enabled: true, display_name: null, sort_order: 0 }];
    const result = await getZonesForCellar('cellar-1', makeDb(rows));
    // The zone with sort_order: 0 should come before zones with no sort_order
    const idx = result.findIndex(z => z.id === lastZone.id);
    expect(idx).toBe(0);
  });

  it('returns all zones when config only has enabled: true rows', async () => {
    const rows = CELLAR_ZONES.zones.slice(0, 3).map(z => ({
      zone_id: z.id, enabled: true, display_name: null, sort_order: null
    }));
    const result = await getZonesForCellar('cellar-1', makeDb(rows));
    // All zones should be present (the 3 explicit + the rest implicit)
    expect(result.length).toBe(CELLAR_ZONES.zones.length);
  });
});
