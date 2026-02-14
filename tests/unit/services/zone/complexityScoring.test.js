/**
 * @fileoverview Tests for complexity scoring and Opus escalation.
 * @module tests/unit/services/zone/complexityScoring.test
 */

// Mock dependencies to avoid importing the full module tree
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: {} }));
vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn()
}));
vi.mock('../../../../src/services/ai/openaiReviewer.js', () => ({
  reviewReconfigurationPlan: vi.fn().mockResolvedValue({ skipped: true }),
  applyPatches: vi.fn(p => p),
  saveTelemetry: vi.fn().mockResolvedValue(undefined),
  hashPlan: vi.fn(() => 'hash'),
  calculateStabilityScore: vi.fn(() => 0.8)
}));
vi.mock('../../../../src/config/cellarZones.js', () => ({
  CELLAR_ZONES: { zones: [] },
  getZoneById: () => null
}));
vi.mock('../../../../src/services/zone/zonePins.js', () => ({
  getNeverMergeZones: vi.fn().mockResolvedValue(new Set())
}));
vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getAllZoneAllocations: vi.fn().mockResolvedValue([])
}));
vi.mock('../../../../src/services/cellar/cellarMetrics.js', () => ({
  getEffectiveZoneColor: () => 'any'
}));
vi.mock('../../../../src/db/index.js', () => ({ default: {} }));
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../../../src/config/cellarCapacity.js', () => ({
  getTotalRows: () => 19,
  getTotalCapacity: () => 169,
  getRowCapacity: () => 9,
  computeRowsCapacity: (rows) => (rows?.length ?? 0) * 9
}));
vi.mock('../../../../src/schemas/reconfigurationActions.js', () => ({
  validateActions: (actions) => ({ valid: actions, invalid: [] }),
  LLMDeltaResponseSchema: { safeParse: () => ({ success: false }) },
  applyDelta: vi.fn()
}));
vi.mock('../../../../src/services/zone/planSimulator.js', () => ({
  simulatePlan: () => ({ valid: true, violations: [], validActions: [], invalidActions: [], postState: {} }),
  autoRepairPlan: (actions) => ({ actions, removed: 0, violations: [] })
}));
vi.mock('../../../../src/services/zone/rowAllocationSolver.js', () => ({
  solveRowAllocation: () => ({ actions: [], reasoning: 'empty' })
}));

import { computeComplexityScore } from '../../../../src/services/zone/zoneReconfigurationPlanner.js';

describe('computeComplexityScore', () => {
  it('returns 0 for a simple scenario with no issues', () => {
    const { score, factors } = computeComplexityScore({
      overflowingZones: [],
      colorAdjacencyIssues: [],
      neverMerge: new Set(),
      solverActionCount: 0,
      scatteredWines: [],
      totalBottles: 50
    });
    expect(score).toBe(0);
    expect(Object.keys(factors)).toHaveLength(0);
  });

  it('adds 0.2 for >3 deficit zones', () => {
    const { score, factors } = computeComplexityScore({
      overflowingZones: [{}, {}, {}, {}],
      colorAdjacencyIssues: [],
      neverMerge: new Set(),
      solverActionCount: 0,
      scatteredWines: [],
      totalBottles: 50
    });
    expect(score).toBe(0.2);
    expect(factors.manyDeficits).toBe(true);
  });

  it('adds 0.2 for >2 color boundary violations', () => {
    const { score, factors } = computeComplexityScore({
      overflowingZones: [],
      colorAdjacencyIssues: [{}, {}, {}],
      neverMerge: new Set(),
      solverActionCount: 0,
      scatteredWines: [],
      totalBottles: 50
    });
    expect(score).toBe(0.2);
    expect(factors.colorConflicts).toBe(3);
  });

  it('adds 0.2 for >2 pin constraints', () => {
    const { score, factors } = computeComplexityScore({
      overflowingZones: [],
      colorAdjacencyIssues: [],
      neverMerge: new Set(['a', 'b', 'c']),
      solverActionCount: 0,
      scatteredWines: [],
      totalBottles: 50
    });
    expect(score).toBe(0.2);
    expect(factors.pinConstraints).toBe(3);
  });

  it('adds 0.2 for high solver output (>4 actions)', () => {
    const { score, factors } = computeComplexityScore({
      overflowingZones: [],
      colorAdjacencyIssues: [],
      neverMerge: new Set(),
      solverActionCount: 5,
      scatteredWines: [],
      totalBottles: 50
    });
    expect(score).toBe(0.2);
    expect(factors.highSolverOutput).toBe(5);
  });

  it('adds 0.2 for >5 scattered wines', () => {
    const { score, factors } = computeComplexityScore({
      overflowingZones: [],
      colorAdjacencyIssues: [],
      neverMerge: new Set(),
      solverActionCount: 0,
      scatteredWines: [{}, {}, {}, {}, {}, {}],
      totalBottles: 50
    });
    expect(score).toBe(0.2);
    expect(factors.scatteredWines).toBe(6);
  });

  it('caps at 1.0 when all factors are present', () => {
    const { score } = computeComplexityScore({
      overflowingZones: [{}, {}, {}, {}],
      colorAdjacencyIssues: [{}, {}, {}],
      neverMerge: new Set(['a', 'b', 'c']),
      solverActionCount: 6,
      scatteredWines: [{}, {}, {}, {}, {}, {}],
      totalBottles: 50
    });
    expect(score).toBe(1.0);
  });

  it('returns 0.6 when 3 factors are present (Opus threshold)', () => {
    const { score } = computeComplexityScore({
      overflowingZones: [{}, {}, {}, {}],
      colorAdjacencyIssues: [{}, {}, {}],
      neverMerge: new Set(['a', 'b', 'c']),
      solverActionCount: 0,
      scatteredWines: [],
      totalBottles: 50
    });
    expect(score).toBeCloseTo(0.6);
  });
});
