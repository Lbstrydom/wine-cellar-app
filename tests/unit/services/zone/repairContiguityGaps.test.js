/**
 * @fileoverview Tests for repairContiguityGaps in the zone reconfiguration planner.
 * Validates that the repair function correctly resolves zone interleaving.
 * @module tests/unit/services/zone/repairContiguityGaps.test
 */

// Mock cellarZones before importing
vi.mock('../../../../src/config/cellarZones.js', () => {
  const zones = [
    { id: 'sauvignon_blanc', displayName: 'Sauvignon Blanc', color: 'white', rules: { grapes: ['sauvignon blanc'] } },
    { id: 'chenin_blanc', displayName: 'Chenin Blanc', color: 'white', rules: { grapes: ['chenin blanc'] } },
    { id: 'chardonnay', displayName: 'Chardonnay', color: 'white', rules: { grapes: ['chardonnay'] } },
    { id: 'loire_light', displayName: 'Loire & Light', color: 'white', rules: {} },
    { id: 'aromatic_whites', displayName: 'Aromatic Whites', color: 'white', rules: {} },
    { id: 'cabernet', displayName: 'Cabernet Sauvignon', color: 'red', rules: { grapes: ['cabernet sauvignon'] } },
    { id: 'shiraz', displayName: 'Shiraz', color: 'red', rules: { grapes: ['shiraz', 'syrah'] } },
    { id: 'southern_france', displayName: 'Southern France', color: 'red', rules: {} },
    { id: 'pinot_noir', displayName: 'Pinot Noir', color: 'red', rules: { grapes: ['pinot noir'] } },
    { id: 'merlot', displayName: 'Merlot', color: 'red', rules: { grapes: ['merlot'] } },
    { id: 'curiosities', displayName: 'Curiosities', color: 'red', rules: {} }
  ];
  return {
    CELLAR_ZONES: { zones },
    getZoneById: (id) => zones.find(z => z.id === id) || null
  };
});

vi.mock('../../../../src/services/cellar/cellarMetrics.js', () => ({
  getEffectiveZoneColor: (zone) => {
    if (!zone) return 'any';
    const color = zone.color;
    if (Array.isArray(color)) return color.includes('red') ? 'red' : 'white';
    if (color === 'red' || color === 'white') return color;
    return 'any';
  }
}));

// Stub other planner imports that aren't used by repair function
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: {} }));
vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: () => 'test-model',
  getThinkingConfig: () => null
}));
vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: () => ''
}));
vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getAllZoneAllocations: async () => new Map()
}));
vi.mock('../../../../src/services/shared/cellarLayoutSettings.js', () => ({
  getCellarLayoutSettings: async () => ({}),
  getDynamicColourRowRanges: () => ({ white: [], red: [] })
}));
vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: () => ({ all: async () => [], get: async () => null, run: async () => ({}) }) }
}));
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}));
vi.mock('../../../../src/services/ai/openaiReviewer.js', () => ({
  reviewReconfigurationPlan: async () => null,
  applyPatches: (a) => a,
  saveTelemetry: async () => {},
  hashPlan: () => 'test',
  calculateStabilityScore: () => 1
}));
vi.mock('../../../../src/services/zone/rowAllocationSolver.js', () => ({
  solveRowAllocation: () => ({ actions: [], warnings: [] })
}));
vi.mock('../../../../src/services/zone/zonePins.js', () => ({
  getNeverMergeZones: async () => new Set()
}));

import { repairContiguityGaps, buildMutatedZoneRowMap } from '../../../../src/services/zone/zoneReconfigurationPlanner.js';

describe('repairContiguityGaps', () => {
  it('fixes Chenin Blanc [R5,R8] / Loire [R6,R7] sandwich by swapping to make both contiguous', () => {
    // The classic interleaving bug: Chenin at R5 + R8, Loire at R6 + R7 between them
    const zoneRowMap = new Map([
      ['sauvignon_blanc', ['R2']],
      ['chardonnay', ['R4']],
      ['chenin_blanc', ['R5', 'R8']],
      ['loire_light', ['R6', 'R7']],
      ['shiraz', ['R9']],
      ['southern_france', ['R10']],
      ['cabernet', ['R11', 'R12']]
    ]);

    const result = repairContiguityGaps([], zoneRowMap, 20);

    // Should emit exactly one swap pair (2 actions)
    const swapActions = result.filter(a => a.type === 'reallocate_row');
    expect(swapActions.length).toBe(2);

    // After applying the swap, both Chenin and Loire must be contiguous
    const postMap = buildMutatedZoneRowMap(zoneRowMap, swapActions);

    const cheninRows = (postMap.get('chenin_blanc') || [])
      .map(r => parseInt(r.replace('R', ''), 10))
      .sort((a, b) => a - b);
    const loireRows = (postMap.get('loire_light') || [])
      .map(r => parseInt(r.replace('R', ''), 10))
      .sort((a, b) => a - b);

    // Both zones must be contiguous (no gaps)
    expect(cheninRows.length).toBe(2);
    expect(cheninRows[1] - cheninRows[0]).toBe(1);

    expect(loireRows.length).toBe(2);
    expect(loireRows[1] - loireRows[0]).toBe(1);
  });

  it('does not break other zone contiguity when repairing', () => {
    // Zone A at [R3, R7] with Zone B [R4, R5, R6] between them
    // Swapping R7↔R4 would give A=[R3,R4], B=[R5,R6,R7] — both contiguous
    // But swapping R3↔R6 would give A=[R6,R7], B=[R3,R4,R5] — also both contiguous
    // Either outcome is valid; neither should break zone B
    const zoneRowMap = new Map([
      ['chenin_blanc', ['R3', 'R7']],
      ['loire_light', ['R4', 'R5', 'R6']],
      ['cabernet', ['R11', 'R12']]
    ]);

    const result = repairContiguityGaps([], zoneRowMap, 20);
    const swapActions = result.filter(a => a.type === 'reallocate_row');
    expect(swapActions.length).toBe(2);

    // Verify post-swap contiguity for all zones
    const postMap = buildMutatedZoneRowMap(zoneRowMap, swapActions);

    for (const [zoneId, rows] of postMap) {
      if (rows.length < 2) continue;
      const nums = rows.map(r => parseInt(r.replace('R', ''), 10)).sort((a, b) => a - b);
      for (let i = 1; i < nums.length; i++) {
        expect(nums[i] - nums[i - 1]).toBe(1);
      }
    }
  });

  it('skips repair when swap would break other zone contiguity', () => {
    // Zone A at [R3, R8] with Zone B [R4, R5] and Zone C [R6, R7]
    // Taking R4 from B would break B's contiguity if B also has other rows that depend on R4
    // But actually taking R4: B=[R5], C=[R6,R7], A=[R3,R4] — B becomes single-row (OK)
    // This is fine. Let's construct a case where the swap WOULD break contiguity:
    // Zone A at [R3, R8], Zone B at [R4, R6] (already non-contiguous)
    // Taking R4 from B gives B=[R6] (single-row, contiguous) and A gets [R3,R4] (contiguous)
    // A gets R8 swapped out to B: B=[R6,R8] (non-contiguous!)
    // The repair should check this and skip if it would create a NEW gap for B.
    const zoneRowMap = new Map([
      ['chenin_blanc', ['R3', 'R8']],       // non-contiguous
      ['loire_light', ['R4', 'R6']],         // also non-contiguous
      ['aromatic_whites', ['R5']],
      ['cabernet', ['R11', 'R12']]
    ]);

    const result = repairContiguityGaps([], zoneRowMap, 20);

    // Verify no swap makes things worse
    const postMap = buildMutatedZoneRowMap(zoneRowMap, result);

    // For any zone with 2+ rows, check if it GAINED a gap it didn't have before
    for (const [zoneId, rows] of postMap) {
      if (rows.length < 2) continue;
      const nums = rows.map(r => parseInt(r.replace('R', ''), 10)).sort((a, b) => a - b);

      const preRows = (zoneRowMap.get(zoneId) || [])
        .map(r => parseInt(r.replace('R', ''), 10)).sort((a, b) => a - b);

      // Count gaps before and after
      const gapsBefore = preRows.length > 1
        ? preRows.filter((n, i) => i > 0 && n - preRows[i - 1] > 1).length
        : 0;
      const gapsAfter = nums.filter((n, i) => i > 0 && n - nums[i - 1] > 1).length;

      // Should not introduce new gaps
      expect(gapsAfter).toBeLessThanOrEqual(gapsBefore);
    }
  });

  it('repairs zone with prior actions that moved rows INTO the zone', () => {
    // Simulate: prior action moved R8 into Chenin. Chenin is now [R5, R8] but
    // the old code would skip repair because R8 was "already acted on".
    const zoneRowMap = new Map([
      ['chenin_blanc', ['R5']],
      ['loire_light', ['R6', 'R7', 'R8']],
      ['cabernet', ['R11', 'R12']]
    ]);

    // Prior action: move R8 from Loire to Chenin
    const priorActions = [{
      type: 'reallocate_row',
      fromZoneId: 'loire_light',
      toZoneId: 'chenin_blanc',
      rowNumber: 8,
      reason: 'capacity rebalance'
    }];

    // After priorActions, Chenin = [R5, R8], Loire = [R6, R7]
    // Repair should still fix the gap despite R8 being acted on
    const result = repairContiguityGaps(priorActions, zoneRowMap, 20);

    // Should have priorActions + repair actions
    const repairActions = result.filter(a => a.reason?.includes('contiguity repair'));
    expect(repairActions.length).toBe(2); // One swap pair

    // After ALL actions (prior + repair), both zones should be contiguous
    const postMap = buildMutatedZoneRowMap(zoneRowMap, result);

    const cheninRows = (postMap.get('chenin_blanc') || [])
      .map(r => parseInt(r.replace('R', ''), 10))
      .sort((a, b) => a - b);
    const loireRows = (postMap.get('loire_light') || [])
      .map(r => parseInt(r.replace('R', ''), 10))
      .sort((a, b) => a - b);

    // Both must be contiguous
    if (cheninRows.length >= 2) {
      expect(cheninRows[1] - cheninRows[0]).toBe(1);
    }
    if (loireRows.length >= 2) {
      expect(loireRows[1] - loireRows[0]).toBe(1);
    }
  });

  it('does not swap across colour boundaries', () => {
    // Chenin (white) at [R5, R12] — R12 is in red zone territory
    // Should not try to swap R12 with a red zone row to make it contiguous
    // (unless a white zone owns the target row)
    const zoneRowMap = new Map([
      ['chenin_blanc', ['R5', 'R12']],
      ['cabernet', ['R6', 'R7']],
      ['shiraz', ['R11']]
    ]);

    const result = repairContiguityGaps([], zoneRowMap, 20);
    const repairActions = result.filter(a => a.reason?.includes('contiguity repair'));

    // Any repair should not swap white with red
    for (const action of repairActions) {
      const isWhiteToRed = (
        ['chenin_blanc', 'loire_light', 'sauvignon_blanc', 'chardonnay'].includes(action.fromZoneId) &&
        ['cabernet', 'shiraz', 'pinot_noir', 'merlot', 'southern_france'].includes(action.toZoneId)
      ) || (
        ['cabernet', 'shiraz', 'pinot_noir', 'merlot', 'southern_france'].includes(action.fromZoneId) &&
        ['chenin_blanc', 'loire_light', 'sauvignon_blanc', 'chardonnay'].includes(action.toZoneId)
      );
      expect(isWhiteToRed).toBe(false);
    }
  });

  it('returns original actions unchanged if no zones need repair', () => {
    const zoneRowMap = new Map([
      ['chenin_blanc', ['R5', 'R6']],
      ['loire_light', ['R7', 'R8']],
      ['cabernet', ['R11', 'R12']]
    ]);

    const priorActions = [{ type: 'reallocate_row', fromZoneId: 'x', toZoneId: 'y', rowNumber: 1 }];
    const result = repairContiguityGaps(priorActions, zoneRowMap, 20);

    // No repairs needed — result should be just the prior actions
    expect(result.length).toBe(1);
    expect(result[0]).toBe(priorActions[0]);
  });

  it('handles multiple non-contiguous zones in a single pass', () => {
    // Two zones both need repair
    const zoneRowMap = new Map([
      ['chenin_blanc', ['R5', 'R8']],   // gap: R6,R7 missing
      ['loire_light', ['R6', 'R7']],     // contiguous but sandwiched
      ['cabernet', ['R11', 'R14']],       // gap: R12,R13 missing
      ['shiraz', ['R12', 'R13']]          // contiguous but sandwiched
    ]);

    const result = repairContiguityGaps([], zoneRowMap, 20);
    const repairActions = result.filter(a => a.reason?.includes('contiguity repair'));

    // Should repair both zones (2 swap pairs = 4 actions)
    expect(repairActions.length).toBe(4);

    // After ALL repairs, all multi-row zones should be contiguous
    const postMap = buildMutatedZoneRowMap(zoneRowMap, result);
    for (const [zoneId, rows] of postMap) {
      if (rows.length < 2) continue;
      const nums = rows.map(r => parseInt(r.replace('R', ''), 10)).sort((a, b) => a - b);
      for (let i = 1; i < nums.length; i++) {
        expect(nums[i] - nums[i - 1]).toBe(1);
      }
    }
  });

  it('updates postMap between repairs so second repair sees corrected state', () => {
    // After fixing zone A, the postMap should reflect the fix for zone B's repair
    const zoneRowMap = new Map([
      ['chenin_blanc', ['R3', 'R6']],     // gap: needs R4 or R5
      ['loire_light', ['R4', 'R5']],       // contiguous, blocks chenin
      ['cabernet', ['R11', 'R14']],        // gap: needs R12 or R13
      ['shiraz', ['R12', 'R13']]           // contiguous, blocks cabernet
    ]);

    const result = repairContiguityGaps([], zoneRowMap, 20);

    // After ALL repairs, verify no double-assignments exist
    const postMap = buildMutatedZoneRowMap(zoneRowMap, result);
    const allRowAssignments = new Map();
    for (const [zoneId, rows] of postMap) {
      for (const r of rows) {
        const existing = allRowAssignments.get(r);
        if (existing) {
          throw new Error(`Row ${r} assigned to both ${existing} and ${zoneId}`);
        }
        allRowAssignments.set(r, zoneId);
      }
    }
  });
});
