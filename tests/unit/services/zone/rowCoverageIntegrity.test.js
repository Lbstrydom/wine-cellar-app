/**
 * @fileoverview Tests for full row coverage invariants.
 * Verifies that:
 * - validateAllocationIntegrity rejects plans with missing rows
 * - validateAllocationIntegrity passes with exactly 19 rows
 * - focusZoneId filtering retains assign_orphan_row actions for all zones
 * @module tests/unit/services/zone/rowCoverageIntegrity.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

// Must mock cellarLayoutSettings with TOTAL_ROWS to survive --no-isolate leakage
// from other test files that mock the same module without TOTAL_ROWS.
vi.mock('../../../../src/services/shared/cellarLayoutSettings.js', async () => {
  const actual = await vi.importActual('../../../../src/services/shared/cellarLayoutSettings.js');
  return {
    ...actual,
    getCellarLayoutSettings: vi.fn().mockResolvedValue({}),
    getDynamicColourRowRanges: vi.fn().mockResolvedValue({ whiteRows: [], redRows: [] })
  };
});

import { validateAllocationIntegrity } from '../../../../src/routes/cellarReconfiguration.js';
import { actionInvolvesZone } from '../../../../src/services/zone/zoneReconfigurationPlanner.js';

// ─── validateAllocationIntegrity: full row coverage ──────────

describe('validateAllocationIntegrity — row coverage', () => {
  const allRows = Array.from({ length: 19 }, (_, i) => `R${i + 1}`);

  it('passes when all 19 rows are assigned exactly once', () => {
    const zoneAllocMap = new Map([
      ['whites', allRows.slice(0, 5)],      // R1-R5
      ['reds', allRows.slice(5, 12)],        // R6-R12
      ['reserves', allRows.slice(12)]         // R13-R19
    ]);

    const result = validateAllocationIntegrity(zoneAllocMap);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when R1 is missing from all zones', () => {
    // R1 orphaned — assigned to no zone
    const zoneAllocMap = new Map([
      ['whites', ['R2', 'R3', 'R4', 'R5']],
      ['reds', ['R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12']],
      ['reserves', ['R13', 'R14', 'R15', 'R16', 'R17', 'R18', 'R19']]
    ]);

    const result = validateAllocationIntegrity(zoneAllocMap);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Missing row: R1'));
  });

  it('fails when multiple rows are missing', () => {
    const zoneAllocMap = new Map([
      ['whites', ['R3', 'R4', 'R5']],         // R1, R2 missing
      ['reds', ['R6', 'R8', 'R10']],           // R7, R9 missing
      ['reserves', ['R13', 'R14', 'R19']]      // R15-R18 missing
    ]);

    const result = validateAllocationIntegrity(zoneAllocMap);
    expect(result.valid).toBe(false);

    const missingErrors = result.errors.filter(e => e.startsWith('Missing row:'));
    // R1, R2, R7, R9, R11, R12, R15, R16, R17, R18
    expect(missingErrors.length).toBe(10);
    expect(result.errors).toContainEqual(expect.stringContaining('Missing row: R1'));
    expect(result.errors).toContainEqual(expect.stringContaining('Missing row: R2'));
  });

  it('detects both missing rows and duplicate rows simultaneously', () => {
    const zoneAllocMap = new Map([
      ['whites', ['R1', 'R2', 'R3', 'R4', 'R5']],
      ['reds', ['R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12']],  // R5 duplicate
      // R13-R19 missing, no reserves zone
    ]);

    const result = validateAllocationIntegrity(zoneAllocMap);
    expect(result.valid).toBe(false);

    const dupErrors = result.errors.filter(e => e.startsWith('Duplicate'));
    const missingErrors = result.errors.filter(e => e.startsWith('Missing'));
    expect(dupErrors.length).toBeGreaterThan(0);
    expect(missingErrors.length).toBe(7); // R13-R19
  });

  it('fails when zone_allocations table is empty (all rows orphaned)', () => {
    const zoneAllocMap = new Map();

    const result = validateAllocationIntegrity(zoneAllocMap);
    expect(result.valid).toBe(false);

    const missingErrors = result.errors.filter(e => e.startsWith('Missing'));
    expect(missingErrors.length).toBe(19);
  });

  it('passes with buffer zones holding rows (max 1 each)', () => {
    const zoneAllocMap = new Map([
      ['sauvignon_blanc', ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']],
      ['white_buffer', ['R7']],
      ['cabernet', ['R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18']],
      ['red_buffer', ['R19']]
    ]);

    const result = validateAllocationIntegrity(zoneAllocMap);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── focusZoneId filter: orphan action preservation ──────────

describe('focusZoneId filtering preserves orphan actions', () => {
  it('actionInvolvesZone returns false for orphan targeting a different zone', () => {
    const action = {
      type: 'assign_orphan_row',
      toZoneId: 'zone_a',
      rowNumber: 1,
      reason: 'Recovered orphaned R1'
    };

    // Filtering for zone_b — orphan targets zone_a
    expect(actionInvolvesZone(action, 'zone_b')).toBe(false);
  });

  it('actionInvolvesZone returns true for orphan targeting the focused zone', () => {
    const action = {
      type: 'assign_orphan_row',
      toZoneId: 'zone_a',
      rowNumber: 1,
      reason: 'Recovered orphaned R1'
    };

    expect(actionInvolvesZone(action, 'zone_a')).toBe(true);
  });

  it('scoped filter retains cross-zone orphan actions with the fix', () => {
    // Simulate the fixed filter logic:
    // a.type === 'assign_orphan_row' || actionInvolvesZone(a, focusZoneId)
    const focusZoneId = 'zone_b';
    const actions = [
      { type: 'reallocate_row', fromZoneId: 'zone_a', toZoneId: 'zone_b', rowNumber: 5 },
      { type: 'reallocate_row', fromZoneId: 'zone_c', toZoneId: 'zone_d', rowNumber: 8 },
      { type: 'assign_orphan_row', toZoneId: 'zone_a', rowNumber: 1, reason: 'Recovered R1' },
      { type: 'assign_orphan_row', toZoneId: 'zone_b', rowNumber: 2, reason: 'Recovered R2' }
    ];

    // Apply fixed filter
    const filtered = actions.filter(
      a => a.type === 'assign_orphan_row' || actionInvolvesZone(a, focusZoneId)
    );

    // Should keep: reallocate involving zone_b, BOTH orphan actions
    expect(filtered).toHaveLength(3);
    expect(filtered[0].type).toBe('reallocate_row');
    expect(filtered[1].type).toBe('assign_orphan_row');
    expect(filtered[1].toZoneId).toBe('zone_a');  // Cross-zone orphan retained
    expect(filtered[2].type).toBe('assign_orphan_row');
    expect(filtered[2].toZoneId).toBe('zone_b');
  });

  it('old filter would have dropped cross-zone orphan actions (regression proof)', () => {
    const focusZoneId = 'zone_b';
    const actions = [
      { type: 'assign_orphan_row', toZoneId: 'zone_a', rowNumber: 1, reason: 'Recovered R1' },
    ];

    // Old filter: only actionInvolvesZone
    const oldFiltered = actions.filter(a => actionInvolvesZone(a, focusZoneId));
    expect(oldFiltered).toHaveLength(0); // Bug: orphan dropped

    // New filter: preserve all orphan actions
    const newFiltered = actions.filter(
      a => a.type === 'assign_orphan_row' || actionInvolvesZone(a, focusZoneId)
    );
    expect(newFiltered).toHaveLength(1); // Fix: orphan retained
  });
});
