/**
 * @fileoverview Unit tests for the deterministic row allocation solver.
 * @module tests/unit/services/zone/rowAllocationSolver.test
 */

// Mock cellarZones before importing solver
vi.mock('../../../../src/config/cellarZones.js', () => {
  const zones = [
    { id: 'sauvignon_blanc', displayName: 'Sauvignon Blanc', color: 'white', rules: { grapes: ['sauvignon blanc'] } },
    { id: 'chenin_blanc', displayName: 'Chenin Blanc', color: 'white', rules: { grapes: ['chenin blanc'] } },
    { id: 'chardonnay', displayName: 'Chardonnay', color: 'white', rules: { grapes: ['chardonnay'] } },
    { id: 'cabernet', displayName: 'Cabernet Sauvignon', color: 'red', rules: { grapes: ['cabernet sauvignon'] } },
    { id: 'shiraz', displayName: 'Shiraz', color: 'red', rules: { grapes: ['shiraz', 'syrah'] } },
    { id: 'pinot_noir', displayName: 'Pinot Noir', color: 'red', rules: { grapes: ['pinot noir'] } },
    { id: 'merlot', displayName: 'Merlot', color: 'red', rules: { grapes: ['merlot'] } },
    { id: 'curiosities', displayName: 'Curiosities', color: 'red', rules: {} },
    { id: 'unclassified', displayName: 'Unclassified', color: ['red', 'white'], rules: {} },
    { id: 'white_buffer', displayName: 'White Buffer', color: 'white', rules: {} },
    { id: 'red_buffer', displayName: 'Red Buffer', color: 'red', rules: {} }
  ];
  return {
    CELLAR_ZONES: { zones },
    getZoneById: (id) => zones.find(z => z.id === id) || null
  };
});

// Mock cellarMetrics
vi.mock('../../../../src/services/cellar/cellarMetrics.js', () => ({
  getEffectiveZoneColor: (zone) => {
    if (!zone) return 'any';
    const color = zone.color;
    if (Array.isArray(color)) {
      return color.includes('red') ? 'red' : 'white';
    }
    if (color === 'red' || color === 'white') return color;
    return 'any';
  }
}));

import { solveRowAllocation } from '../../../../src/services/zone/rowAllocationSolver.js';

// ─── Test helpers ───

function makeZone(id, rows, bottles) {
  return { id, name: id, color: getColorForId(id), actualAssignedRows: rows };
}

function getColorForId(id) {
  const whites = ['sauvignon_blanc', 'chenin_blanc', 'chardonnay', 'white_buffer'];
  if (whites.includes(id)) return 'white';
  if (id === 'unclassified') return ['red', 'white'];
  return 'red';
}

function makeUtil(bottleCount, rowCount) {
  const capacity = rowCount * 9;
  return {
    bottleCount,
    rowCount,
    capacity,
    utilizationPct: capacity > 0 ? Math.round((bottleCount / capacity) * 100) : 0,
    isOverflowing: bottleCount > capacity
  };
}

// ─── Tests ───

describe('rowAllocationSolver', () => {
  describe('solveRowAllocation', () => {
    it('returns empty actions when no capacity issues exist', () => {
      const zones = [
        makeZone('cabernet', ['R10', 'R11'], 12),
        makeZone('shiraz', ['R12', 'R13'], 10)
      ];
      const utilization = {
        cabernet: makeUtil(12, 2),
        shiraz: makeUtil(10, 2)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [],
        underutilizedZones: [],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      expect(result.actions).toHaveLength(0);
      expect(result.reasoning).toContain('No reconfiguration actions needed');
    });

    it('reallocates a row from underutilized zone to overflowing zone', () => {
      const zones = [
        makeZone('cabernet', ['R10', 'R11'], 18),  // 18 bottles in 2 rows (9 cap each) → overflow
        makeZone('curiosities', ['R14', 'R15', 'R16'], 3) // 3 bottles in 3 rows → underutilized
      ];
      const utilization = {
        cabernet: makeUtil(18, 2),       // needs ceil(18/9)=2 rows, has 2 but overflows
        curiosities: makeUtil(3, 3)       // needs ceil(3/9)=1 row, has 3 → 2 surplus
      };
      // Manually mark cabernet as overflowing for the demand calc
      utilization.cabernet.isOverflowing = true;

      // Cabernet has 18 bottles needing 2 rows but is overflowing
      // Actually, 18 bottles / 9 slots = 2 rows exactly. For overflow, bottles > capacity:
      // 18 > 18 → not overflowing? Let's use 20 bottles.
      utilization.cabernet = makeUtil(20, 2);
      utilization.cabernet.isOverflowing = true;
      zones[0] = makeZone('cabernet', ['R10', 'R11'], 20);

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }],
        underutilizedZones: [{ zoneId: 'curiosities', utilizationPct: 11, rowCount: 3, bottleCount: 3 }],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      // Solver should reallocate a row from curiosities to cabernet
      const reallocations = result.actions.filter(a => a.type === 'reallocate_row');
      expect(reallocations.length).toBeGreaterThanOrEqual(1);

      const action = reallocations[0];
      expect(action.fromZoneId).toBe('curiosities');
      expect(action.toZoneId).toBe('cabernet');
      expect([14, 15, 16]).toContain(action.rowNumber);
    });

    it('respects neverMerge zones', () => {
      const zones = [
        makeZone('cabernet', ['R10', 'R11'], 20),
        makeZone('curiosities', ['R14', 'R15', 'R16'], 3)
      ];
      const utilization = {
        cabernet: makeUtil(20, 2),
        curiosities: makeUtil(3, 3)
      };
      utilization.cabernet.isOverflowing = true;

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }],
        underutilizedZones: [{ zoneId: 'curiosities', utilizationPct: 11, rowCount: 3 }],
        mergeCandidates: [
          { sourceZone: 'curiosities', targetZone: 'cabernet', affinity: 0.8, reason: 'both red' }
        ],
        neverMerge: new Set(['curiosities']),
        stabilityBias: 'moderate'
      });

      // Should still reallocate rows (that's not a merge), but should NOT merge
      const merges = result.actions.filter(a => a.type === 'merge_zones' || a.type === 'retire_zone');
      expect(merges).toHaveLength(0);
    });

    it('limits actions based on high stability bias', () => {
      const zones = [
        makeZone('cabernet', ['R10'], 20),
        makeZone('shiraz', ['R12'], 15),
        makeZone('curiosities', ['R14', 'R15', 'R16', 'R17'], 2),
        makeZone('merlot', ['R18', 'R19'], 3)
      ];
      const utilization = {
        cabernet: makeUtil(20, 1),
        shiraz: makeUtil(15, 1),
        curiosities: makeUtil(2, 4),
        merlot: makeUtil(3, 2)
      };
      utilization.cabernet.isOverflowing = true;
      utilization.shiraz.isOverflowing = true;

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }, { zoneId: 'shiraz' }],
        underutilizedZones: [
          { zoneId: 'curiosities', utilizationPct: 6, rowCount: 4, bottleCount: 2 },
          { zoneId: 'merlot', utilizationPct: 17, rowCount: 2, bottleCount: 3 }
        ],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'high'
      });

      // High stability: max 3 actions
      expect(result.actions.length).toBeLessThanOrEqual(3);
    });

    it('proposes merge for zones with ≤2 bottles', () => {
      const zones = [
        makeZone('curiosities', ['R14'], 1),
        makeZone('cabernet', ['R10', 'R11'], 12)
      ];
      const utilization = {
        curiosities: makeUtil(1, 1),
        cabernet: makeUtil(12, 2)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [],
        underutilizedZones: [],
        mergeCandidates: [
          { sourceZone: 'curiosities', targetZone: 'cabernet', affinity: 0.8, reason: 'both red' }
        ],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      const retires = result.actions.filter(a => a.type === 'retire_zone');
      expect(retires.length).toBeGreaterThanOrEqual(1);
      expect(retires[0].zoneId).toBe('curiosities');
      expect(retires[0].mergeIntoZoneId).toBe('cabernet');
    });

    it('proposes merge_zones for zones with 3-5 bottles', () => {
      const zones = [
        makeZone('curiosities', ['R14'], 4),
        makeZone('cabernet', ['R10', 'R11'], 12)
      ];
      const utilization = {
        curiosities: makeUtil(4, 1),
        cabernet: makeUtil(12, 2)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [],
        underutilizedZones: [],
        mergeCandidates: [
          { sourceZone: 'curiosities', targetZone: 'cabernet', affinity: 0.8, reason: 'both red' }
        ],
        neverMerge: new Set(),
        stabilityBias: 'low'
      });

      const merges = result.actions.filter(a => a.type === 'merge_zones');
      expect(merges.length).toBeGreaterThanOrEqual(1);
      expect(merges[0].sourceZones).toContain('curiosities');
      expect(merges[0].targetZoneId).toBe('cabernet');
    });

    it('prefers same-color donors for row reallocation', () => {
      const zones = [
        makeZone('cabernet', ['R10'], 15),         // red, overflowing
        makeZone('sauvignon_blanc', ['R1', 'R2', 'R3'], 3),  // white, underutilized
        makeZone('curiosities', ['R14', 'R15', 'R16'], 3)    // red, underutilized
      ];
      const utilization = {
        cabernet: makeUtil(15, 1),
        sauvignon_blanc: makeUtil(3, 3),
        curiosities: makeUtil(3, 3)
      };
      utilization.cabernet.isOverflowing = true;

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }],
        underutilizedZones: [
          { zoneId: 'sauvignon_blanc', utilizationPct: 11, rowCount: 3, bottleCount: 3 },
          { zoneId: 'curiosities', utilizationPct: 11, rowCount: 3, bottleCount: 3 }
        ],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      const reallocations = result.actions.filter(a => a.type === 'reallocate_row');
      expect(reallocations.length).toBeGreaterThanOrEqual(1);
      // Should prefer curiosities (red) over sauvignon_blanc (white) for a red zone
      expect(reallocations[0].fromZoneId).toBe('curiosities');
    });

    it('produces valid action schema fields', () => {
      const zones = [
        makeZone('cabernet', ['R10'], 15),
        makeZone('curiosities', ['R14', 'R15'], 2)
      ];
      const utilization = {
        cabernet: makeUtil(15, 1),
        curiosities: makeUtil(2, 2)
      };
      utilization.cabernet.isOverflowing = true;

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }],
        underutilizedZones: [{ zoneId: 'curiosities', utilizationPct: 11, rowCount: 2, bottleCount: 2 }],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      for (const action of result.actions) {
        expect(action).toHaveProperty('type');
        expect(action).toHaveProperty('priority');
        expect(action).toHaveProperty('reason');
        expect(typeof action.reason).toBe('string');
        expect(typeof action.priority).toBe('number');

        if (action.type === 'reallocate_row') {
          expect(action).toHaveProperty('fromZoneId');
          expect(action).toHaveProperty('toZoneId');
          expect(action).toHaveProperty('rowNumber');
          expect(action).toHaveProperty('bottlesAffected');
          expect(typeof action.rowNumber).toBe('number');
        }
      }
    });

    it('handles empty zones array gracefully', () => {
      const result = solveRowAllocation({
        zones: [],
        utilization: {},
        overflowingZones: [],
        underutilizedZones: [],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      expect(result.actions).toHaveLength(0);
      expect(result.reasoning).toBeTruthy();
    });

    it('does not reallocate the last row from a zone with bottles', () => {
      const zones = [
        makeZone('cabernet', ['R10'], 15),
        makeZone('curiosities', ['R14'], 5)  // 1 row, 5 bottles → cannot donate
      ];
      const utilization = {
        cabernet: makeUtil(15, 1),
        curiosities: makeUtil(5, 1)
      };
      utilization.cabernet.isOverflowing = true;

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }],
        underutilizedZones: [],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      // curiosities has only 1 row and bottles → cannot donate
      const reallocations = result.actions.filter(a => a.type === 'reallocate_row');
      const fromCuriosities = reallocations.filter(a => a.fromZoneId === 'curiosities');
      expect(fromCuriosities).toHaveLength(0);
    });

    it('reasoning string is meaningful', () => {
      const zones = [
        makeZone('cabernet', ['R10'], 15),
        makeZone('curiosities', ['R14', 'R15', 'R16'], 2)
      ];
      const utilization = {
        cabernet: makeUtil(15, 1),
        curiosities: makeUtil(2, 3)
      };
      utilization.cabernet.isOverflowing = true;

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }],
        underutilizedZones: [{ zoneId: 'curiosities', utilizationPct: 7, rowCount: 3, bottleCount: 2 }],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      expect(result.reasoning).toBeTruthy();
      expect(typeof result.reasoning).toBe('string');
      expect(result.reasoning.length).toBeGreaterThan(20);
    });

    it('deduplicates row reallocations', () => {
      // If somehow the same row would be reallocated twice, it should be deduplicated
      const zones = [
        makeZone('cabernet', ['R10', 'R11'], 25),
        makeZone('shiraz', ['R12'], 12),
        makeZone('curiosities', ['R14', 'R15', 'R16', 'R17'], 2)
      ];
      const utilization = {
        cabernet: makeUtil(25, 2),
        shiraz: makeUtil(12, 1),
        curiosities: makeUtil(2, 4)
      };
      utilization.cabernet.isOverflowing = true;
      utilization.shiraz.isOverflowing = true;

      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'cabernet' }, { zoneId: 'shiraz' }],
        underutilizedZones: [{ zoneId: 'curiosities', utilizationPct: 6, rowCount: 4, bottleCount: 2 }],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate'
      });

      // Each row should appear at most once
      const rowNumbers = result.actions
        .filter(a => a.type === 'reallocate_row')
        .map(a => a.rowNumber);
      const uniqueRows = new Set(rowNumbers);
      expect(uniqueRows.size).toBe(rowNumbers.length);
    });

    it('completes in under 50ms for a realistic cellar', () => {
      // Simulate a full 19-row cellar with 25 zones
      const zones = [
        makeZone('sauvignon_blanc', ['R1', 'R2'], 12),
        makeZone('chenin_blanc', ['R3'], 7),
        makeZone('chardonnay', ['R4'], 5),
        makeZone('cabernet', ['R8', 'R9', 'R10'], 25),
        makeZone('shiraz', ['R11', 'R12'], 20),
        makeZone('pinot_noir', ['R13'], 8),
        makeZone('merlot', ['R14', 'R15'], 10),
        makeZone('curiosities', ['R16', 'R17', 'R18', 'R19'], 3),
        makeZone('white_buffer', ['R5'], 2),
        makeZone('red_buffer', ['R6', 'R7'], 4)
      ];
      const utilization = {};
      for (const z of zones) {
        const bottles = z.name === 'sauvignon_blanc' ? 12 :
          z.name === 'chenin_blanc' ? 7 :
            z.name === 'chardonnay' ? 5 :
              z.name === 'cabernet' ? 25 :
                z.name === 'shiraz' ? 20 :
                  z.name === 'pinot_noir' ? 8 :
                    z.name === 'merlot' ? 10 :
                      z.name === 'curiosities' ? 3 :
                        z.name === 'white_buffer' ? 2 : 4;
        utilization[z.id] = makeUtil(bottles, z.actualAssignedRows.length);
      }
      utilization.shiraz.isOverflowing = true;

      const start = performance.now();
      const result = solveRowAllocation({
        zones,
        utilization,
        overflowingZones: [{ zoneId: 'shiraz' }],
        underutilizedZones: [
          { zoneId: 'curiosities', utilizationPct: 8, rowCount: 4, bottleCount: 3 },
          { zoneId: 'white_buffer', utilizationPct: 22, rowCount: 1, bottleCount: 2 }
        ],
        mergeCandidates: [],
        neverMerge: new Set(),
        stabilityBias: 'moderate',
        scatteredWines: [],
        colorAdjacencyIssues: []
      });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('reasoning');
    });
  });
});
