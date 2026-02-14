/**
 * @fileoverview Tests for the sequential plan simulator.
 * @module tests/unit/services/zone/planSimulator.test
 */

// Mock cellarZones and cellarCapacity before imports
vi.mock('../../../../src/config/cellarZones.js', () => {
  const zones = [
    { id: 'sauvignon_blanc', displayName: 'Sauvignon Blanc', color: 'white', rules: {} },
    { id: 'chenin_blanc', displayName: 'Chenin Blanc', color: 'white', rules: {} },
    { id: 'cabernet', displayName: 'Cabernet', color: 'red', rules: {} },
    { id: 'shiraz', displayName: 'Shiraz', color: 'red', rules: {} },
    { id: 'curiosities', displayName: 'Curiosities', color: 'red', rules: {} },
    { id: 'red_buffer', displayName: 'Red Buffer', color: 'red', rules: {} },
    { id: 'unclassified', displayName: 'Unclassified', color: ['red', 'white'], rules: {} }
  ];
  return {
    CELLAR_ZONES: { zones },
    getZoneById: (id) => zones.find(z => z.id === id) || null
  };
});

vi.mock('../../../../src/config/cellarCapacity.js', () => ({
  getRowCapacity: (rowId) => {
    const key = typeof rowId === 'number' ? `R${rowId}` : String(rowId);
    return key === 'R1' ? 7 : 9;
  },
  parseRowNumber: (rowId) => {
    if (typeof rowId === 'number') return rowId;
    return parseInt(String(rowId).replace(/^R/i, ''), 10);
  }
}));

import {
  buildInitialState,
  simulatePlan,
  autoRepairPlan,
  computePlanScore
} from '../../../../src/services/zone/planSimulator.js';

describe('planSimulator', () => {
  const zones = [
    { id: 'cabernet', actualAssignedRows: ['R10', 'R11'] },
    { id: 'shiraz', actualAssignedRows: ['R12', 'R13'] },
    { id: 'curiosities', actualAssignedRows: ['R14', 'R15', 'R16'] }
  ];
  const utilization = {
    cabernet: { bottleCount: 15, rowCount: 2, capacity: 18 },
    shiraz: { bottleCount: 10, rowCount: 2, capacity: 18 },
    curiosities: { bottleCount: 3, rowCount: 3, capacity: 27 }
  };

  describe('buildInitialState', () => {
    it('builds correct row→zone mapping', () => {
      const state = buildInitialState(zones, utilization);
      expect(state.rowToZone.get('R10')).toBe('cabernet');
      expect(state.rowToZone.get('R14')).toBe('curiosities');
    });

    it('builds correct zone→rows mapping', () => {
      const state = buildInitialState(zones, utilization);
      expect(state.zoneToRows.get('cabernet').size).toBe(2);
      expect(state.zoneToRows.get('curiosities').size).toBe(3);
    });

    it('records bottle counts', () => {
      const state = buildInitialState(zones, utilization);
      expect(state.zoneBottles.get('cabernet')).toBe(15);
      expect(state.zoneBottles.get('curiosities')).toBe(3);
    });
  });

  describe('simulatePlan', () => {
    it('validates a correct reallocate_row action', () => {
      const actions = [{
        type: 'reallocate_row',
        priority: 2,
        fromZoneId: 'curiosities',
        toZoneId: 'cabernet',
        rowNumber: 16,
        reason: 'test',
        bottlesAffected: 1
      }];
      const result = simulatePlan(actions, zones, utilization);
      expect(result.valid).toBe(true);
      expect(result.validActions).toEqual([0]);
      expect(result.invalidActions).toHaveLength(0);
    });

    it('rejects moving a row that does not belong to fromZone', () => {
      const actions = [{
        type: 'reallocate_row',
        priority: 2,
        fromZoneId: 'cabernet',
        toZoneId: 'shiraz',
        rowNumber: 14,  // R14 belongs to curiosities, not cabernet
        reason: 'test',
        bottlesAffected: 0
      }];
      const result = simulatePlan(actions, zones, utilization);
      expect(result.valid).toBe(false);
      expect(result.invalidActions).toHaveLength(1);
      expect(result.invalidActions[0].violation).toContain('owned by');
    });

    it('rejects moving the same row twice', () => {
      const actions = [
        {
          type: 'reallocate_row', priority: 2,
          fromZoneId: 'curiosities', toZoneId: 'cabernet',
          rowNumber: 14, reason: 'first move', bottlesAffected: 1
        },
        {
          type: 'reallocate_row', priority: 2,
          fromZoneId: 'cabernet', toZoneId: 'shiraz',
          rowNumber: 14, reason: 'second move', bottlesAffected: 1
        }
      ];
      const result = simulatePlan(actions, zones, utilization);
      expect(result.valid).toBe(false);
      expect(result.invalidActions.some(a => a.violation.includes('already moved'))).toBe(true);
    });

    it('rejects removing last row from zone with bottles', () => {
      // Give cabernet only 1 row
      const singleRowZones = [
        { id: 'cabernet', actualAssignedRows: ['R10'] },
        { id: 'shiraz', actualAssignedRows: ['R12', 'R13'] }
      ];
      const singleRowUtil = {
        cabernet: { bottleCount: 5, rowCount: 1, capacity: 9 },
        shiraz: { bottleCount: 10, rowCount: 2, capacity: 18 }
      };
      const actions = [{
        type: 'reallocate_row', priority: 2,
        fromZoneId: 'cabernet', toZoneId: 'shiraz',
        rowNumber: 10, reason: 'take last row', bottlesAffected: 5
      }];
      const result = simulatePlan(actions, singleRowZones, singleRowUtil);
      expect(result.valid).toBe(false);
      expect(result.invalidActions[0].violation).toContain('last row');
    });

    it('validates merge_zones action', () => {
      const actions = [{
        type: 'merge_zones',
        priority: 3,
        sourceZones: ['curiosities'],
        targetZoneId: 'cabernet',
        reason: 'merge small zone',
        bottlesAffected: 3
      }];
      const result = simulatePlan(actions, zones, utilization);
      expect(result.valid).toBe(true);
    });

    it('validates retire_zone action', () => {
      const actions = [{
        type: 'retire_zone',
        priority: 4,
        zoneId: 'curiosities',
        mergeIntoZoneId: 'red_buffer',
        reason: 'retire empty zone',
        bottlesAffected: 3
      }];
      // Add red_buffer to zones
      const withBuffer = [
        ...zones,
        { id: 'red_buffer', actualAssignedRows: ['R17'] }
      ];
      const withBufferUtil = {
        ...utilization,
        red_buffer: { bottleCount: 2, rowCount: 1, capacity: 9 }
      };
      const result = simulatePlan(actions, withBuffer, withBufferUtil);
      expect(result.valid).toBe(true);
    });

    it('rejects retiring a zone twice', () => {
      const actions = [
        {
          type: 'retire_zone', priority: 4,
          zoneId: 'curiosities', mergeIntoZoneId: 'cabernet',
          reason: 'first retire', bottlesAffected: 3
        },
        {
          type: 'retire_zone', priority: 4,
          zoneId: 'curiosities', mergeIntoZoneId: 'shiraz',
          reason: 'second retire', bottlesAffected: 0
        }
      ];
      const result = simulatePlan(actions, zones, utilization);
      expect(result.valid).toBe(false);
      expect(result.invalidActions.some(a => a.violation.includes('already retired'))).toBe(true);
    });

    it('rejects invalid zone IDs', () => {
      const actions = [{
        type: 'reallocate_row', priority: 2,
        fromZoneId: 'nonexistent_zone', toZoneId: 'cabernet',
        rowNumber: 14, reason: 'test', bottlesAffected: 0
      }];
      const result = simulatePlan(actions, zones, utilization);
      expect(result.valid).toBe(false);
      expect(result.invalidActions[0].violation).toContain('not a valid zone');
    });

    it('preserves total bottle count after valid operations', () => {
      const actions = [
        {
          type: 'reallocate_row', priority: 2,
          fromZoneId: 'curiosities', toZoneId: 'cabernet',
          rowNumber: 16, reason: 'realloc', bottlesAffected: 1
        },
        {
          type: 'merge_zones', priority: 3,
          sourceZones: ['curiosities'], targetZoneId: 'shiraz',
          reason: 'merge', bottlesAffected: 3
        }
      ];
      const result = simulatePlan(actions, zones, utilization);
      // The total bottles should remain unchanged
      const totalBefore = Object.values(utilization).reduce((s, z) => s + z.bottleCount, 0);
      const totalAfter = [...result.postState.zoneBottles.values()].reduce((a, b) => a + b, 0);
      expect(totalAfter).toBe(totalBefore);
    });
  });

  describe('autoRepairPlan', () => {
    it('removes invalid actions and keeps valid ones', () => {
      const actions = [
        {
          type: 'reallocate_row', priority: 2,
          fromZoneId: 'curiosities', toZoneId: 'cabernet',
          rowNumber: 14, reason: 'valid', bottlesAffected: 1
        },
        {
          type: 'reallocate_row', priority: 2,
          fromZoneId: 'cabernet', toZoneId: 'shiraz',
          rowNumber: 14, reason: 'invalid - already moved', bottlesAffected: 1
        }
      ];
      const result = autoRepairPlan(actions, zones, utilization);
      expect(result.actions).toHaveLength(1);
      expect(result.removed).toBe(1);
      expect(result.violations).toHaveLength(1);
    });

    it('keeps all valid actions', () => {
      const actions = [{
        type: 'reallocate_row', priority: 2,
        fromZoneId: 'curiosities', toZoneId: 'cabernet',
        rowNumber: 15, reason: 'ok', bottlesAffected: 1
      }];
      const result = autoRepairPlan(actions, zones, utilization);
      expect(result.actions).toHaveLength(1);
      expect(result.removed).toBe(0);
    });
  });

  describe('computePlanScore', () => {
    it('returns a numeric score', () => {
      const actions = [{
        type: 'reallocate_row', priority: 2,
        fromZoneId: 'curiosities', toZoneId: 'cabernet',
        rowNumber: 14, reason: 'test', bottlesAffected: 1
      }];
      const result = computePlanScore(actions, zones, utilization);
      expect(typeof result.score).toBe('number');
      expect(result.components).toHaveProperty('fit');
      expect(result.components).toHaveProperty('contiguity');
      expect(result.components).toHaveProperty('churn');
    });

    it('penalizes more actions (higher churn)', () => {
      const few = computePlanScore(
        [{ type: 'reallocate_row', priority: 2, fromZoneId: 'curiosities', toZoneId: 'cabernet', rowNumber: 14, reason: 'a', bottlesAffected: 1 }],
        zones, utilization
      );
      const many = computePlanScore(
        [
          { type: 'reallocate_row', priority: 2, fromZoneId: 'curiosities', toZoneId: 'cabernet', rowNumber: 14, reason: 'a', bottlesAffected: 1 },
          { type: 'reallocate_row', priority: 2, fromZoneId: 'curiosities', toZoneId: 'shiraz', rowNumber: 15, reason: 'b', bottlesAffected: 1 },
          { type: 'reallocate_row', priority: 2, fromZoneId: 'curiosities', toZoneId: 'shiraz', rowNumber: 16, reason: 'c', bottlesAffected: 1 }
        ],
        zones, utilization
      );
      expect(few.components.churn).toBeGreaterThan(many.components.churn);
    });
  });
});
