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
    { id: 'aromatic_whites', displayName: 'Aromatic Whites', color: 'white', rules: { grapes: ['riesling', 'viognier'] } },
    { id: 'cabernet', displayName: 'Cabernet Sauvignon', color: 'red', rules: { grapes: ['cabernet sauvignon'] } },
    { id: 'shiraz', displayName: 'Shiraz', color: 'red', rules: { grapes: ['shiraz', 'syrah'] } },
    { id: 'pinot_noir', displayName: 'Pinot Noir', color: 'red', rules: { grapes: ['pinot noir'] } },
    { id: 'merlot', displayName: 'Merlot', color: 'red', rules: { grapes: ['merlot'] } },
    { id: 'southern_france', displayName: 'Southern France', color: 'red', rules: {} },
    { id: 'iberian_fresh', displayName: 'Iberian Fresh', color: 'red', rules: {} },
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

import { solveRowAllocation, MIN_BOTTLES_FOR_ROW } from '../../../../src/services/zone/rowAllocationSolver.js';

// ─── Test helpers ───

function makeZone(id, rows, bottles) {
  return { id, name: id, color: getColorForId(id), actualAssignedRows: rows };
}

function getColorForId(id) {
  const whites = ['sauvignon_blanc', 'chenin_blanc', 'chardonnay', 'aromatic_whites', 'white_buffer'];
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

  describe('colourOrder support', () => {
    it('fixes white zones in red region for whites-top (default)', () => {
      // White zone (chenin_blanc) at R15, red zone (cabernet) at R1 → both violated
      // boundary = countColorRows('white') = 1, so white region = R1, red region = R2-19
      const zones = [
        makeZone('chenin_blanc', ['R15'], 5),
        makeZone('cabernet', ['R1'], 8)
      ];
      const utilization = {
        chenin_blanc: makeUtil(5, 1),
        cabernet: makeUtil(8, 1)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        colourOrder: 'whites-top'
      });

      // Should produce swap actions to fix colour boundary
      const reallocateActions = result.actions.filter(a => a.type === 'reallocate_row');
      expect(reallocateActions.length).toBeGreaterThanOrEqual(2);
      expect(reallocateActions.some(a => a.reason.includes('color boundary'))).toBe(true);
    });

    it('fixes red zones in white region for reds-top', () => {
      // reds-top: red zones should be in low rows (1..redBoundary), white in high rows
      // redBoundary = TOTAL_ROWS - whiteRowCount = 19 - 1 = 18
      // cabernet at R19 (> 18, red in white region), chenin at R1 (≤ 18, white in red region)
      const zones = [
        makeZone('cabernet', ['R19'], 8),
        makeZone('chenin_blanc', ['R1'], 5)
      ];
      const utilization = {
        cabernet: makeUtil(8, 1),
        chenin_blanc: makeUtil(5, 1)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        colourOrder: 'reds-top'
      });

      // Should produce swap actions since both are in wrong regions for reds-top
      const reallocateActions = result.actions.filter(a => a.type === 'reallocate_row');
      expect(reallocateActions.length).toBeGreaterThanOrEqual(2);
    });

    it('does not generate swaps when colours are already correct for whites-top', () => {
      // whites-top: white in R1-R3, red in R10-R12 → no violations
      const zones = [
        makeZone('chenin_blanc', ['R1', 'R2', 'R3'], 20),
        makeZone('cabernet', ['R10', 'R11', 'R12'], 25)
      ];
      const utilization = {
        chenin_blanc: makeUtil(20, 3),
        cabernet: makeUtil(25, 3)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        colourOrder: 'whites-top'
      });

      const reallocateActions = result.actions.filter(a => a.type === 'reallocate_row');
      expect(reallocateActions).toHaveLength(0);
    });
  });

  describe('Phase B: no ping-pong adjacent swaps', () => {
    it('does not generate direct adjacent swap when no remote partner exists', () => {
      // Two adjacent rows of different colours, no remote partner to swap with.
      // Before Phase B fix, the solver would do a direct adjacent swap that
      // ping-pongs on each run. Now it should skip.
      const zones = [
        makeZone('chenin_blanc', ['R7'], 5),   // white, at boundary edge
        makeZone('cabernet', ['R8'], 7)         // red, right next to it
      ];
      const utilization = {
        chenin_blanc: makeUtil(5, 1),
        cabernet: makeUtil(7, 1)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        colourOrder: 'whites-top'
      });

      // There are only 2 zones, both at the boundary. No remote swap partner.
      // The solver should NOT generate swap actions for this pair.
      const colorSwaps = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.reason.includes('color')
      );
      expect(colorSwaps).toHaveLength(0);
    });
  });

  describe('Phase 3b: surplus right-sizing', () => {
    it('reclaims surplus rows from over-provisioned zones', () => {
      // Sauvignon Blanc: 14 bottles in 4 rows → needs 2, surplus = 2
      const zones = [
        makeZone('sauvignon_blanc', ['R1', 'R3', 'R4', 'R5'], 14),
        makeZone('chenin_blanc', ['R2'], 7)
      ];
      const utilization = {
        sauvignon_blanc: makeUtil(14, 4),
        chenin_blanc: makeUtil(7, 1)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        stabilityBias: 'low'
      });

      // Should generate surplus-reclaim actions for Sauvignon Blanc
      const surplusActions = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.reason.includes('Right-size')
      );
      expect(surplusActions.length).toBeGreaterThanOrEqual(1);
      expect(surplusActions[0].fromZoneId).toBe('sauvignon_blanc');
    });

    it('routes freed surplus rows to deficit zones when possible', () => {
      // Curiosities: 3 bottles in 3 rows → needs 1, surplus = 2
      // Cabernet: 20 bottles in 2 rows → needs 3, deficit = 1
      const zones = [
        makeZone('curiosities', ['R14', 'R15', 'R16'], 3),
        makeZone('cabernet', ['R10', 'R11'], 20)
      ];
      const utilization = {
        curiosities: makeUtil(3, 3),
        cabernet: makeUtil(20, 2)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        stabilityBias: 'moderate'
      });

      // Phase 3 should donate to cabernet, Phase 3b may also free surplus.
      // Either way, curiosities should lose at least one row.
      const fromCuriosities = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'curiosities'
      );
      expect(fromCuriosities.length).toBeGreaterThanOrEqual(1);
    });

    it('respects neverMerge for surplus reclaim', () => {
      const zones = [
        makeZone('sauvignon_blanc', ['R1', 'R2', 'R3', 'R4'], 5)
      ];
      const utilization = {
        sauvignon_blanc: makeUtil(5, 4) // needs 1 row, has 4 → surplus 3
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        neverMerge: new Set(['sauvignon_blanc']),
        stabilityBias: 'low'
      });

      const surplusActions = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'sauvignon_blanc'
      );
      expect(surplusActions).toHaveLength(0);
    });

    it('limits reclaims based on stability bias', () => {
      const zones = [
        makeZone('sauvignon_blanc', ['R1', 'R2', 'R3', 'R4', 'R5'], 5)
      ];
      const utilization = {
        sauvignon_blanc: makeUtil(5, 5) // needs 1 row, surplus = 4
      };

      const highResult = solveRowAllocation({
        zones,
        utilization,
        stabilityBias: 'high'
      });
      const lowResult = solveRowAllocation({
        zones,
        utilization,
        stabilityBias: 'low'
      });

      const highSurplus = highResult.actions.filter(a => a.reason?.includes('Right-size'));
      const lowSurplus = lowResult.actions.filter(a => a.reason?.includes('Right-size'));

      // High stability should reclaim fewer rows than low
      expect(highSurplus.length).toBeLessThanOrEqual(lowSurplus.length);
    });

    it('reclaims from edge rows (highest numbers) to preserve contiguity', () => {
      const zones = [
        makeZone('sauvignon_blanc', ['R1', 'R2', 'R3', 'R4'], 5)
      ];
      const utilization = {
        sauvignon_blanc: makeUtil(5, 4) // needs 1 row, surplus = 3
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        stabilityBias: 'low'
      });

      const surplusActions = result.actions.filter(a => a.reason?.includes('Right-size'));
      if (surplusActions.length > 0) {
        // First reclaimed should be highest row number (R4)
        expect(surplusActions[0].rowNumber).toBe(4);
      }
    });
  });

  describe('Phase 5: scatter consolidation', () => {
    it('proposes swaps to consolidate non-contiguous zone rows', () => {
      // Cabernet has R10 and R14 (non-contiguous), R11 belongs to shiraz
      const zones = [
        makeZone('cabernet', ['R10', 'R14'], 12),
        makeZone('shiraz', ['R11', 'R12'], 10),
        makeZone('merlot', ['R13'], 7)
      ];
      const utilization = {
        cabernet: makeUtil(12, 2),
        shiraz: makeUtil(10, 2),
        merlot: makeUtil(7, 1)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        scatteredWines: [{ wineName: 'Test Cab', bottleCount: 12, rows: ['R10', 'R14'], zoneId: 'cabernet' }],
        stabilityBias: 'low'
      });

      const scatterActions = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.reason.includes('Consolidate')
      );
      // Should propose a swap to bring R14 closer to R10 (e.g. swap R14↔R11)
      expect(scatterActions.length).toBeGreaterThanOrEqual(1);
    });

    it('skips consolidation when stabilityBias is high', () => {
      const zones = [
        makeZone('cabernet', ['R10', 'R14'], 12),
        makeZone('shiraz', ['R11'], 7)
      ];
      const utilization = {
        cabernet: makeUtil(12, 2),
        shiraz: makeUtil(7, 1)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        scatteredWines: [{ wineName: 'Test', bottleCount: 12, rows: ['R10', 'R14'], zoneId: 'cabernet' }],
        stabilityBias: 'high'
      });

      const scatterActions = result.actions.filter(a =>
        a.reason?.includes('Consolidate')
      );
      expect(scatterActions).toHaveLength(0);
    });

    it('skips consolidation when no scattered wines', () => {
      const zones = [makeZone('cabernet', ['R10', 'R11'], 12)];
      const utilization = { cabernet: makeUtil(12, 2) };

      const result = solveRowAllocation({
        zones,
        utilization,
        scatteredWines: [],
        stabilityBias: 'low'
      });

      const scatterActions = result.actions.filter(a =>
        a.reason?.includes('Consolidate')
      );
      expect(scatterActions).toHaveLength(0);
    });
  });

  describe('color interleaving detection', () => {
    it('fixes white zone sandwiched between red zones (R8=red, R9=white, R10=red)', () => {
      // Real scenario: Aromatic Whites in R9 (white region should be R1-R7)
      // surrounded by red zones on both sides. In whites-top mode, white→red
      // is technically "correct order" but the white zone is interleaved in the
      // red region, causing a color adjacency violation.
      const zones = [
        makeZone('sauvignon_blanc', ['R1', 'R2'], 12),
        makeZone('chenin_blanc', ['R3'], 7),
        makeZone('chardonnay', ['R4', 'R5'], 10),
        makeZone('white_buffer', ['R6', 'R7'], 4),
        makeZone('iberian_fresh', ['R8'], 6),       // red
        makeZone('aromatic_whites', ['R9'], 5),      // white — sandwiched!
        makeZone('southern_france', ['R10', 'R11'], 12), // red
        makeZone('cabernet', ['R12', 'R13', 'R14'], 20),
        makeZone('shiraz', ['R15', 'R16'], 14),
        makeZone('merlot', ['R17', 'R18', 'R19'], 18)
      ];

      const utilization = {};
      for (const z of zones) {
        const rows = z.actualAssignedRows;
        const bottles = z.id === 'sauvignon_blanc' ? 12 :
          z.id === 'chenin_blanc' ? 7 : z.id === 'chardonnay' ? 10 :
            z.id === 'white_buffer' ? 4 : z.id === 'iberian_fresh' ? 6 :
              z.id === 'aromatic_whites' ? 5 : z.id === 'southern_france' ? 12 :
                z.id === 'cabernet' ? 20 : z.id === 'shiraz' ? 14 : 18;
        utilization[z.id] = makeUtil(bottles, rows.length);
      }

      const result = solveRowAllocation({
        zones,
        utilization,
        colourOrder: 'whites-top',
        colorAdjacencyIssues: [
          { row1: 'R8', zone1: 'iberian_fresh', color1: 'red',
            row2: 'R9', zone2: 'aromatic_whites', color2: 'white' },
          { row1: 'R9', zone1: 'aromatic_whites', color1: 'white',
            row2: 'R10', zone2: 'southern_france', color2: 'red' }
        ]
      });

      // Solver should detect the interleaving and produce swap actions
      const colorFixes = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.reason.includes('color')
      );
      expect(colorFixes.length).toBeGreaterThanOrEqual(1);

      // The aromatic_whites row (R9) should be involved in a swap
      const involvesR9 = colorFixes.some(a => a.rowNumber === 9);
      expect(involvesR9).toBe(true);
    });

    it('fixes red zone sandwiched between white zones', () => {
      // Red zone at R5 sandwiched between white zones at R4 and R6
      const zones = [
        makeZone('sauvignon_blanc', ['R1', 'R2', 'R3'], 20),
        makeZone('chardonnay', ['R4'], 8),
        makeZone('cabernet', ['R5'], 7),             // red — sandwiched in white region
        makeZone('chenin_blanc', ['R6', 'R7'], 10),
        makeZone('shiraz', ['R10', 'R11', 'R12'], 20),
        makeZone('merlot', ['R13', 'R14', 'R15'], 18)
      ];

      const utilization = {};
      for (const z of zones) {
        const bottles = z.id === 'sauvignon_blanc' ? 20 :
          z.id === 'chardonnay' ? 8 : z.id === 'cabernet' ? 7 :
            z.id === 'chenin_blanc' ? 10 : z.id === 'shiraz' ? 20 : 18;
        utilization[z.id] = makeUtil(bottles, z.actualAssignedRows.length);
      }

      const result = solveRowAllocation({
        zones,
        utilization,
        colourOrder: 'whites-top'
      });

      // Solver should detect the red zone (R5) interleaved in white region
      const colorFixes = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.reason.includes('color')
      );
      expect(colorFixes.length).toBeGreaterThanOrEqual(1);

      // R5 (cabernet) should be involved in the fix
      const involvesR5 = colorFixes.some(a => a.rowNumber === 5);
      expect(involvesR5).toBe(true);
    });
  });

  describe('Phase B2: MIN_BOTTLES_FOR_ROW threshold', () => {
    it('exports MIN_BOTTLES_FOR_ROW = 5', () => {
      expect(MIN_BOTTLES_FOR_ROW).toBe(5);
    });

    it('gives demand=0 to a zone with 1 bottle (below threshold)', () => {
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
        stabilityBias: 'low'
      });

      // curiosities has 1 bottle → demand=0 → surplus=1
      // Solver should reclaim its row
      const fromCuriosities = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'curiosities'
      );
      expect(fromCuriosities.length).toBeGreaterThanOrEqual(1);
    });

    it('gives demand=0 to a zone with 4 bottles (below threshold)', () => {
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
        stabilityBias: 'low'
      });

      // curiosities has 4 bottles → demand=0 → surplus=1
      const fromCuriosities = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'curiosities'
      );
      expect(fromCuriosities.length).toBeGreaterThanOrEqual(1);
    });

    it('gives demand=1 to a zone with 5 bottles (at threshold)', () => {
      const zones = [
        makeZone('curiosities', ['R14'], 5),
        makeZone('cabernet', ['R10', 'R11'], 12)
      ];
      const utilization = {
        curiosities: makeUtil(5, 1),
        cabernet: makeUtil(12, 2)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        stabilityBias: 'low'
      });

      // curiosities has 5 bottles → demand=1 → surplus=0
      // Should NOT reclaim its row
      const fromCuriosities = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'curiosities'
      );
      expect(fromCuriosities).toHaveLength(0);
    });

    it('gives demand=2 to a zone with 10 bottles', () => {
      const zones = [
        makeZone('curiosities', ['R14', 'R15'], 10),
        makeZone('cabernet', ['R10', 'R11'], 12)
      ];
      const utilization = {
        curiosities: makeUtil(10, 2),
        cabernet: makeUtil(12, 2)
      };

      const result = solveRowAllocation({
        zones,
        utilization,
        stabilityBias: 'low'
      });

      // curiosities has 10 bottles → demand=ceil(10/9)=2 → surplus=0
      // Should NOT reclaim any rows
      const fromCuriosities = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'curiosities'
      );
      expect(fromCuriosities).toHaveLength(0);
    });
  });

  describe('Phase B4: idealBottleCounts (bottles-first demand)', () => {
    it('uses idealBottleCounts for demand when provided', () => {
      // Physical utilization: cabernet has 3 bottles in 1 row (demand=1)
      // Ideal counts: cabernet should have 15 bottles (demand=2)
      // Shiraz: physical has 12, ideal has 5 (demand=1)
      const zones = [
        makeZone('cabernet', ['R10'], 3),
        makeZone('shiraz', ['R12', 'R13'], 12)
      ];
      const utilization = {
        cabernet: makeUtil(3, 1),
        shiraz: makeUtil(12, 2)
      };

      const idealBottleCounts = new Map([
        ['cabernet', 15],  // needs 2 rows (ideal)
        ['shiraz', 5]       // needs 1 row (ideal)
      ]);

      const result = solveRowAllocation({
        zones,
        utilization,
        idealBottleCounts,
        stabilityBias: 'low'
      });

      // With ideal counts, cabernet needs 2 rows but has 1 → deficit
      // Shiraz needs 1 row but has 2 → surplus
      // Solver should reallocate a row from shiraz to cabernet
      const shirazToCabernet = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'shiraz' && a.toZoneId === 'cabernet'
      );
      expect(shirazToCabernet.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to physical utilization when idealBottleCounts is null', () => {
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
        idealBottleCounts: null,
        stabilityBias: 'moderate'
      });

      // No surplus/deficit with physical counts → no actions
      expect(result.actions).toHaveLength(0);
    });

    it('applies MIN_BOTTLES_FOR_ROW threshold to ideal counts', () => {
      // Ideal counts put only 2 bottles in curiosities → demand=0
      const zones = [
        makeZone('curiosities', ['R14'], 2),
        makeZone('cabernet', ['R10', 'R11'], 12)
      ];
      const utilization = {
        curiosities: makeUtil(2, 1),
        cabernet: makeUtil(12, 2)
      };

      const idealBottleCounts = new Map([
        ['curiosities', 2],  // below threshold → demand=0
        ['cabernet', 12]
      ]);

      const result = solveRowAllocation({
        zones,
        utilization,
        idealBottleCounts,
        stabilityBias: 'low'
      });

      // curiosities has demand=0 with ideal counts → surplus=1
      const fromCuriosities = result.actions.filter(a =>
        a.type === 'reallocate_row' && a.fromZoneId === 'curiosities'
      );
      expect(fromCuriosities.length).toBeGreaterThanOrEqual(1);
    });

    it('handles zones missing from idealBottleCounts by falling back to utilization', () => {
      const zones = [
        makeZone('cabernet', ['R10', 'R11'], 12),
        makeZone('shiraz', ['R12'], 8)
      ];
      const utilization = {
        cabernet: makeUtil(12, 2),
        shiraz: makeUtil(8, 1)
      };

      // Only shiraz has ideal counts; cabernet falls back to physical
      const idealBottleCounts = new Map([
        ['shiraz', 8]
      ]);

      const result = solveRowAllocation({
        zones,
        utilization,
        idealBottleCounts,
        stabilityBias: 'moderate'
      });

      // No surplus/deficit → no actions
      expect(result.actions).toHaveLength(0);
    });
  });
});
