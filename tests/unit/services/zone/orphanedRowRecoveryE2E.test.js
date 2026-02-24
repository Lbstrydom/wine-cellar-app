/**
 * @fileoverview End-to-end tests for orphaned row recovery through
 * generateReconfigurationPlan Phase 0.
 *
 * Verifies that when rows are absent from all zone allocations,
 * the pipeline detects them, emits assign_orphan_row actions, and
 * includes those actions in the final plan output.
 *
 * @module tests/unit/services/zone/orphanedRowRecoveryE2E.test
 */

// ─── Mocks ─────────────────────────────────────────────────────

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/config/cellarZones.js', () => {
  const zones = [
    { id: 'sauvignon_blanc', displayName: 'Sauvignon Blanc', color: 'white', rules: { grapes: ['sauvignon blanc'] } },
    { id: 'chenin_blanc', displayName: 'Chenin Blanc', color: 'white', rules: { grapes: ['chenin blanc'] } },
    { id: 'cabernet', displayName: 'Cabernet Sauvignon', color: 'red', rules: { grapes: ['cabernet sauvignon'] } },
    { id: 'shiraz', displayName: 'Shiraz', color: 'red', rules: { grapes: ['shiraz'] } }
  ];
  return {
    CELLAR_ZONES: { zones },
    getZoneById: (id) => zones.find(z => z.id === id) || null
  };
});

vi.mock('../../../../src/services/cellar/cellarMetrics.js', () => ({
  getEffectiveZoneColor: (zone) => {
    if (!zone) return 'any';
    const c = zone.color;
    if (Array.isArray(c)) return c.includes('red') ? 'red' : 'white';
    return c === 'red' || c === 'white' ? c : 'any';
  }
}));

vi.mock('../../../../src/services/cellar/slotUtils.js', () => ({
  getRowCapacity: (rowId) => {
    const n = parseInt(String(rowId).replace('R', ''), 10);
    return isNaN(n) ? 0 : (n === 1 ? 7 : 9);
  }
}));

// Zone allocations: R1 is intentionally MISSING (orphaned from a previous reconfig)
// Return fresh arrays each call — Phase 0 mutates actualAssignedRows in-place
vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getAllZoneAllocations: vi.fn().mockImplementation(async () => [
    { zone_id: 'sauvignon_blanc', assigned_rows: ['R2', 'R3'] },
    { zone_id: 'chenin_blanc', assigned_rows: ['R4', 'R5', 'R6', 'R7', 'R8'] },
    { zone_id: 'cabernet', assigned_rows: ['R9', 'R10', 'R11', 'R12', 'R13'] },
    { zone_id: 'shiraz', assigned_rows: ['R14', 'R15', 'R16', 'R17', 'R18', 'R19'] }
  ])
}));

vi.mock('../../../../src/services/zone/zonePins.js', () => ({
  getNeverMergeZones: vi.fn().mockResolvedValue(new Set())
}));

// Layout settings: whites-top (R1-R8 = white, R9-R19 = red)
vi.mock('../../../../src/services/shared/cellarLayoutSettings.js', () => ({
  getCellarLayoutSettings: vi.fn().mockResolvedValue({ colourOrder: 'whites-top' }),
  getDynamicColourRowRanges: vi.fn().mockResolvedValue({
    whiteRows: [1, 2, 3, 4, 5, 6, 7, 8],
    redRows: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    whiteRowCount: 8,
    redRowCount: 11,
    whiteCount: 0,
    redCount: 0
  })
}));

// Solver — returns empty actions (no capacity issues)
vi.mock('../../../../src/services/zone/rowAllocationSolver.js', () => ({
  solveRowAllocation: vi.fn().mockReturnValue({
    actions: [],
    reasoning: 'No issues detected'
  })
}));

// OpenAI reviewer — approve with no changes
vi.mock('../../../../src/services/ai/openaiReviewer.js', () => ({
  reviewReconfigurationPlan: vi.fn().mockResolvedValue({
    skipped: true,
    verdict: 'approve',
    reasoning: 'Skipped'
  }),
  applyPatches: vi.fn((plan) => plan),
  saveTelemetry: vi.fn().mockResolvedValue(undefined),
  hashPlan: vi.fn().mockReturnValue('hash_test'),
  calculateStabilityScore: vi.fn().mockReturnValue(85)
}));

// Claude client — not needed for Phase 0 (no ANTHROPIC_API_KEY in test)
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: {}
}));

vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn().mockReturnValue('')
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// ─── Imports ───────────────────────────────────────────────────

import { generateReconfigurationPlan } from '../../../../src/services/zone/zoneReconfigurationPlanner.js';

// ─── Helpers ───────────────────────────────────────────────────

/** Build a minimal analysis report with no issues */
function buildMinimalReport() {
  return {
    summary: {
      totalBottles: 100,
      misplacedBottles: 0
    },
    zoneAnalysis: [
      { zoneId: 'sauvignon_blanc', rowId: 'R2', bottleCount: 9, capacity: 9, utilizationPct: 100, isOverflowing: false },
      { zoneId: 'sauvignon_blanc', rowId: 'R3', bottleCount: 9, capacity: 9, utilizationPct: 100, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R4', bottleCount: 5, capacity: 9, utilizationPct: 56, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R5', bottleCount: 5, capacity: 9, utilizationPct: 56, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R6', bottleCount: 5, capacity: 9, utilizationPct: 56, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R7', bottleCount: 5, capacity: 9, utilizationPct: 56, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R8', bottleCount: 5, capacity: 9, utilizationPct: 56, isOverflowing: false },
      { zoneId: 'cabernet', rowId: 'R9', bottleCount: 6, capacity: 9, utilizationPct: 67, isOverflowing: false },
      { zoneId: 'cabernet', rowId: 'R10', bottleCount: 6, capacity: 9, utilizationPct: 67, isOverflowing: false },
      { zoneId: 'cabernet', rowId: 'R11', bottleCount: 6, capacity: 9, utilizationPct: 67, isOverflowing: false },
      { zoneId: 'cabernet', rowId: 'R12', bottleCount: 6, capacity: 9, utilizationPct: 67, isOverflowing: false },
      { zoneId: 'cabernet', rowId: 'R13', bottleCount: 6, capacity: 9, utilizationPct: 67, isOverflowing: false }
    ],
    bottleScan: { groups: [] },
    scatteredWines: [],
    colorAdjacencyIssues: []
  };
}

/** Build a report where sauvignon_blanc is overflowing (to test scoring bias) */
function buildOverflowReport() {
  return {
    summary: {
      totalBottles: 120,
      misplacedBottles: 0
    },
    zoneAnalysis: [
      { zoneId: 'sauvignon_blanc', rowId: 'R2', bottleCount: 9, capacity: 9, utilizationPct: 100, isOverflowing: true },
      { zoneId: 'sauvignon_blanc', rowId: 'R3', bottleCount: 9, capacity: 9, utilizationPct: 100, isOverflowing: true },
      { zoneId: 'chenin_blanc', rowId: 'R4', bottleCount: 3, capacity: 9, utilizationPct: 33, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R5', bottleCount: 3, capacity: 9, utilizationPct: 33, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R6', bottleCount: 3, capacity: 9, utilizationPct: 33, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R7', bottleCount: 3, capacity: 9, utilizationPct: 33, isOverflowing: false },
      { zoneId: 'chenin_blanc', rowId: 'R8', bottleCount: 3, capacity: 9, utilizationPct: 33, isOverflowing: false }
    ],
    bottleScan: { groups: [] },
    scatteredWines: [],
    colorAdjacencyIssues: []
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('generateReconfigurationPlan — Phase 0 orphan recovery', () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeAll(() => {
    // Ensure LLM layer is skipped (no API key) so we only test Phase 0 + solver + heuristic
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });

  it('emits assign_orphan_row action when R1 is missing from all zones', async () => {
    const report = buildMinimalReport();
    const result = await generateReconfigurationPlan(report, {
      cellarId: 'test-cellar-001'
    });

    // The plan should contain at least one assign_orphan_row action
    const orphanActions = result.actions.filter(a => a.type === 'assign_orphan_row');
    expect(orphanActions.length).toBeGreaterThanOrEqual(1);

    // Specifically, R1 should be recovered
    const r1Action = orphanActions.find(a => a.rowNumber === 1);
    expect(r1Action).toBeDefined();
    expect(r1Action.toZoneId).toBeTruthy();
    expect(r1Action.reason).toContain('orphaned');
  });

  it('assigns R1 to a white zone when colourOrder is whites-top', async () => {
    const report = buildMinimalReport();
    const result = await generateReconfigurationPlan(report, {
      cellarId: 'test-cellar-002'
    });

    const r1Action = result.actions.find(
      a => a.type === 'assign_orphan_row' && a.rowNumber === 1
    );
    expect(r1Action).toBeDefined();

    // R1 is in the white region → should be assigned to a white zone
    const whiteZones = ['sauvignon_blanc', 'chenin_blanc'];
    expect(whiteZones).toContain(r1Action.toZoneId);
  });

  it('prefers overflowing zones when assigning orphaned rows', async () => {
    const report = buildOverflowReport();
    const result = await generateReconfigurationPlan(report, {
      cellarId: 'test-cellar-003'
    });

    const r1Action = result.actions.find(
      a => a.type === 'assign_orphan_row' && a.rowNumber === 1
    );
    expect(r1Action).toBeDefined();
    // sauvignon_blanc is overflowing → higher score → should be preferred
    expect(r1Action.toZoneId).toBe('sauvignon_blanc');
  });

  it('places orphan actions at the start of the plan', async () => {
    const report = buildMinimalReport();
    const result = await generateReconfigurationPlan(report, {
      cellarId: 'test-cellar-004'
    });

    // First action(s) should be orphan recovery
    const firstAction = result.actions[0];
    expect(firstAction).toBeDefined();
    expect(firstAction.type).toBe('assign_orphan_row');
  });

  it('emits no orphan actions when all 19 rows are assigned', async () => {
    // Override allocations to include R1
    const { getAllZoneAllocations } = await import(
      '../../../../src/services/cellar/cellarAllocation.js'
    );
    getAllZoneAllocations.mockResolvedValueOnce([
      { zone_id: 'sauvignon_blanc', assigned_rows: ['R1', 'R2', 'R3'] },
      { zone_id: 'chenin_blanc', assigned_rows: ['R4', 'R5', 'R6', 'R7', 'R8'] },
      { zone_id: 'cabernet', assigned_rows: ['R9', 'R10', 'R11', 'R12', 'R13'] },
      { zone_id: 'shiraz', assigned_rows: ['R14', 'R15', 'R16', 'R17', 'R18', 'R19'] }
    ]);

    const report = buildMinimalReport();
    const result = await generateReconfigurationPlan(report, {
      cellarId: 'test-cellar-005'
    });

    const orphanActions = result.actions.filter(a => a.type === 'assign_orphan_row');
    expect(orphanActions).toHaveLength(0);
  });

  it('does not assign red-region orphans to white zones', async () => {
    // Override allocations: R19 missing (red region row)
    const { getAllZoneAllocations } = await import(
      '../../../../src/services/cellar/cellarAllocation.js'
    );
    getAllZoneAllocations.mockResolvedValueOnce([
      { zone_id: 'sauvignon_blanc', assigned_rows: ['R1', 'R2', 'R3'] },
      { zone_id: 'chenin_blanc', assigned_rows: ['R4', 'R5', 'R6', 'R7', 'R8'] },
      { zone_id: 'cabernet', assigned_rows: ['R9', 'R10', 'R11', 'R12', 'R13'] },
      { zone_id: 'shiraz', assigned_rows: ['R14', 'R15', 'R16', 'R17', 'R18'] }
      // R19 missing → orphaned, in red region
    ]);

    const report = buildMinimalReport();
    const result = await generateReconfigurationPlan(report, {
      cellarId: 'test-cellar-006'
    });

    const r19Action = result.actions.find(
      a => a.type === 'assign_orphan_row' && a.rowNumber === 19
    );
    expect(r19Action).toBeDefined();

    // R19 is in the red region → must NOT go to a white zone
    const redZones = ['cabernet', 'shiraz'];
    expect(redZones).toContain(r19Action.toZoneId);
  });
});
