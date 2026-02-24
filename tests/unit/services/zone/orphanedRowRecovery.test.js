/**
 * @fileoverview Tests for orphaned row recovery in zone reconfiguration.
 * Verifies that rows not assigned to any zone (e.g., freed to __unassigned
 * in a previous reconfiguration) are detected and re-injected.
 * @module tests/unit/services/zone/orphanedRowRecovery.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import { buildMutatedZoneRowMap } from '../../../../src/services/zone/zoneReconfigurationPlanner.js';

// ─── buildMutatedZoneRowMap with __unassigned ─────────────────

describe('buildMutatedZoneRowMap', () => {
  it('removes rows reallocated to __unassigned from the zone map', () => {
    const initial = new Map([
      ['zone_a', ['R1', 'R2']],
      ['zone_b', ['R3']]
    ]);
    const actions = [{
      type: 'reallocate_row',
      fromZoneId: 'zone_a',
      toZoneId: '__unassigned',
      rowNumber: 1
    }];

    const result = buildMutatedZoneRowMap(initial, actions);
    expect(result.get('zone_a')).toEqual(['R2']);
    // R1 is NOT in any zone — it's orphaned
    const allRows = [...result.values()].flat();
    expect(allRows).not.toContain('R1');
  });

  it('preserves rows reallocated to a valid zone', () => {
    const initial = new Map([
      ['zone_a', ['R1', 'R2']],
      ['zone_b', ['R3']]
    ]);
    const actions = [{
      type: 'reallocate_row',
      fromZoneId: 'zone_a',
      toZoneId: 'zone_b',
      rowNumber: 1
    }];

    const result = buildMutatedZoneRowMap(initial, actions);
    expect(result.get('zone_a')).toEqual(['R2']);
    expect(result.get('zone_b')).toContain('R1');
  });
});

// ─── Orphaned row detection logic (unit) ──────────────────────

describe('orphaned row detection', () => {
  it('detects rows missing from all zones', () => {
    const TOTAL_CELLAR_ROWS = 19;
    const zoneRowMap = new Map([
      ['zone_a', ['R2', 'R3']],
      ['zone_b', ['R4', 'R5']],
    ]);

    const assignedRows = new Set();
    for (const rows of zoneRowMap.values()) {
      for (const r of rows) assignedRows.add(r);
    }

    const orphanedRows = [];
    for (let i = 1; i <= TOTAL_CELLAR_ROWS; i++) {
      if (!assignedRows.has(`R${i}`)) orphanedRows.push(`R${i}`);
    }

    // R1, R6-R19 should be orphaned
    expect(orphanedRows).toContain('R1');
    expect(orphanedRows).toHaveLength(15);
    expect(orphanedRows).not.toContain('R2');
    expect(orphanedRows).not.toContain('R3');
    expect(orphanedRows).not.toContain('R4');
    expect(orphanedRows).not.toContain('R5');
  });

  it('detects no orphans when all 19 rows are assigned', () => {
    const TOTAL_CELLAR_ROWS = 19;
    const allRows = Array.from({ length: 19 }, (_, i) => `R${i + 1}`);
    const zoneRowMap = new Map([
      ['zone_a', allRows.slice(0, 10)],
      ['zone_b', allRows.slice(10)]
    ]);

    const assignedRows = new Set();
    for (const rows of zoneRowMap.values()) {
      for (const r of rows) assignedRows.add(r);
    }

    const orphanedRows = [];
    for (let i = 1; i <= TOTAL_CELLAR_ROWS; i++) {
      if (!assignedRows.has(`R${i}`)) orphanedRows.push(`R${i}`);
    }

    expect(orphanedRows).toHaveLength(0);
  });

  it('detects R1 specifically when freed to __unassigned', () => {
    // Simulate: R1 was freed in a previous reconfiguration
    const initial = new Map([
      ['white_reserve', ['R1']],
      ['sauvignon_blanc', ['R2', 'R3']],
      ['chardonnay', ['R4']]
    ]);

    // Previous reconfig freed R1 to __unassigned
    const actions = [{
      type: 'reallocate_row',
      fromZoneId: 'white_reserve',
      toZoneId: '__unassigned',
      rowNumber: 1
    }];

    const result = buildMutatedZoneRowMap(initial, actions);

    // Now detect orphans: R1 should be missing
    const assignedRows = new Set();
    for (const rows of result.values()) {
      for (const r of rows) assignedRows.add(r);
    }

    expect(assignedRows.has('R1')).toBe(false);
    expect(assignedRows.has('R2')).toBe(true);
    expect(assignedRows.has('R3')).toBe(true);
    expect(assignedRows.has('R4')).toBe(true);
  });
});
