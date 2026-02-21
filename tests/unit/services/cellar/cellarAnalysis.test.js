/**
 * @fileoverview Unit tests for cellar analysis — buffer zone colour violation detection.
 * @module tests/unit/services/cellar/cellarAnalysis.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getActiveZoneMap: vi.fn().mockResolvedValue({}),
  getZoneRows: vi.fn().mockResolvedValue([]),
  allocateRowToZone: vi.fn().mockRejectedValue(new Error('No rows')),
  getAllocatedRowMap: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../../src/services/cellar/cellarSuggestions.js', () => ({
  generateMoveSuggestions: vi.fn().mockResolvedValue([]),
  buildZoneCapacityAlerts: vi.fn().mockResolvedValue([]),
  getCurrentZoneAllocation: vi.fn().mockResolvedValue({ zoneToRows: {}, rowToZoneId: {} }),
  generateCompactionMoves: vi.fn().mockReturnValue([])
}));

vi.mock('../../../../src/services/cellar/cellarNarratives.js', () => ({
  generateZoneNarratives: vi.fn().mockReturnValue([])
}));

vi.mock('../../../../src/services/cellar/moveAuditor.js', () => ({
  auditMoveSuggestions: vi.fn().mockResolvedValue({ skipped: true, reason: 'disabled' })
}));

vi.mock('../../../../src/services/shared/cellarLayoutSettings.js', () => ({
  LAYOUT_DEFAULTS: { colourOrder: 'whites-top', fillDirection: 'left' },
  isWhiteFamily: vi.fn((colour) => {
    const whiteFamilyColours = ['white', 'rose', 'rosé', 'orange', 'sparkling', 'dessert', 'fortified'];
    return whiteFamilyColours.includes((colour || '').toLowerCase());
  }),
  getCellarLayoutSettings: vi.fn().mockResolvedValue({
    fillDirection: 'left',
    colourOrder: 'whites-top'
  }),
  getDynamicColourRowRanges: vi.fn().mockResolvedValue({
    whiteRows: [1, 2, 3, 4, 5, 6, 7],
    redRows: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    whiteRowCount: 7,
    redRowCount: 12,
    whiteCount: 10,
    redCount: 30
  })
}));

import { getActiveZoneMap } from '../../../../src/services/cellar/cellarAllocation.js';
import { generateMoveSuggestions } from '../../../../src/services/cellar/cellarSuggestions.js';
import { auditMoveSuggestions } from '../../../../src/services/cellar/moveAuditor.js';
import { analyseCellar } from '../../../../src/services/cellar/cellarAnalysis.js';

describe('analyseCellar buffer zone colour-violation detection (Phase 3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches bottles-first scan data to the report', async () => {
    getActiveZoneMap.mockResolvedValue({
      R8: {
        zoneId: 'cabernet',
        displayName: 'Cabernet Sauvignon',
        rowNumber: 1,
        totalRows: 1,
        wineCount: 1
      }
    });

    const wines = [
      {
        id: 1,
        wine_name: 'Cabernet Sauvignon 2020',
        colour: 'red',
        country: 'South Africa',
        region: 'Stellenbosch',
        grapes: 'cabernet sauvignon',
        style: null,
        slot_id: 'R8C1',
        zone_id: 'cabernet'
      }
    ];

    const report = await analyseCellar(wines, { cellarId: 'test-cellar' });

    expect(report.bottleScan).toBeDefined();
    expect(report.bottleScan.totalBottles).toBe(1);
    expect(Array.isArray(report.bottleScan.groups)).toBe(true);
    expect(report.bottleScan.totalGroups).toBe(1);
  });

  it('flags red wine in white_buffer as misplaced', async () => {
    // Setup: white_buffer zone has R7 allocated, with a red wine
    getActiveZoneMap.mockResolvedValue({
      R7: {
        zoneId: 'white_buffer',
        displayName: 'White Buffer',
        rowNumber: 1,
        totalRows: 1,
        wineCount: 1
      }
    });

    const wines = [
      {
        id: 1,
        wine_name: 'Shiraz Reserve 2020',
        colour: 'red',
        country: 'South Africa',
        grapes: 'shiraz',
        slot_id: 'R7C1',
        zone_id: 'shiraz'
      }
    ];

    const report = await analyseCellar(wines, { cellarId: 'test-cellar' });

    // Red wine in white_buffer should be flagged as misplaced
    expect(report.misplacedWines.length).toBeGreaterThanOrEqual(1);
    const misplaced = report.misplacedWines.find(m => m.wineId === 1);
    expect(misplaced).toBeDefined();
    expect(misplaced.reason).toContain('Colour violation');
  });

  it('does NOT flag white wine in white_buffer as misplaced', async () => {
    // Setup: white_buffer zone has R7 allocated, with a white wine
    getActiveZoneMap.mockResolvedValue({
      R7: {
        zoneId: 'white_buffer',
        displayName: 'White Buffer',
        rowNumber: 1,
        totalRows: 1,
        wineCount: 1
      }
    });

    const wines = [
      {
        id: 2,
        wine_name: 'Chenin Blanc 2023',
        colour: 'white',
        country: 'South Africa',
        grapes: 'chenin blanc',
        slot_id: 'R7C1',
        zone_id: 'chenin_blanc'
      }
    ];

    const report = await analyseCellar(wines, { cellarId: 'test-cellar' });

    // White wine in white_buffer should NOT be flagged
    const misplaced = report.misplacedWines.find(m => m.wineId === 2);
    expect(misplaced).toBeUndefined();

    // But it should appear in overflowAnalysis
    expect(report.overflowAnalysis.length).toBe(1);
    expect(report.overflowAnalysis[0].zoneId).toBe('white_buffer');
  });

  it('includes buffer zone colour-violation wines in misplacedBottles count', async () => {
    getActiveZoneMap.mockResolvedValue({
      R7: {
        zoneId: 'white_buffer',
        displayName: 'White Buffer',
        rowNumber: 1,
        totalRows: 1,
        wineCount: 2
      }
    });

    const wines = [
      {
        id: 1,
        wine_name: 'Shiraz Reserve 2020',
        colour: 'red',
        country: 'South Africa',
        grapes: 'shiraz',
        slot_id: 'R7C1',
        zone_id: 'shiraz'
      },
      {
        id: 2,
        wine_name: 'Chardonnay 2023',
        colour: 'white',
        country: 'France',
        grapes: 'chardonnay',
        slot_id: 'R7C2',
        zone_id: 'chardonnay'
      }
    ];

    const report = await analyseCellar(wines, { cellarId: 'test-cellar' });

    // Only the red wine should be counted as misplaced
    expect(report.summary.misplacedBottles).toBe(1);
  });

  it('records skipped move-audit metadata when auditor is skipped', async () => {
    getActiveZoneMap.mockResolvedValue({});
    auditMoveSuggestions.mockResolvedValueOnce({
      skipped: true,
      reason: 'Move audit disabled',
      latencyMs: 17
    });

    const report = await analyseCellar([], { cellarId: 'test-cellar' });
    expect(report.moveAudit).toEqual({
      skipped: true,
      reason: 'Move audit disabled',
      latencyMs: 17
    });
  });

  it('recomputes swap metadata from optimized moves and preserves zone capacity issues', async () => {
    getActiveZoneMap.mockResolvedValue({});

    const baseSuggestions = [
      {
        type: 'move',
        wineId: 11,
        wineName: 'Wine One',
        from: 'R1C1',
        to: 'R1C2',
        toZone: 'Shiraz',
        reason: 'test',
        confidence: 'high',
        priority: 1
      }
    ];
    baseSuggestions._hasSwaps = false;
    baseSuggestions._zoneCapacityIssues = [{ overflowingZoneId: 'shiraz', wine: { wineId: 11 } }];
    generateMoveSuggestions.mockResolvedValueOnce(baseSuggestions);

    auditMoveSuggestions.mockResolvedValueOnce({
      audited: true,
      verdict: 'optimize',
      issues: [],
      optimizedMoves: [
        {
          type: 'move',
          wineId: 11,
          wineName: 'Wine One',
          from: 'R1C1',
          to: 'R1C2',
          toZone: 'Shiraz',
          reason: 'test',
          confidence: 'high',
          priority: 1
        },
        {
          type: 'move',
          wineId: 12,
          wineName: 'Wine Two',
          from: 'R1C2',
          to: 'R1C1',
          toZone: 'Cabernet',
          reason: 'test',
          confidence: 'high',
          priority: 1
        }
      ],
      reasoning: 'swap is cleaner',
      confidence: 'high',
      latencyMs: 25
    });

    const report = await analyseCellar([], { cellarId: 'test-cellar' });
    expect(report.movesHaveSwaps).toBe(true);
    expect(report.suggestedMoves._hasSwaps).toBe(true);
    expect(report.zoneCapacityIssues).toEqual(baseSuggestions._zoneCapacityIssues);
  });

  it('sets movesHaveSwaps=false when no move targets overlap with sources', async () => {
    getActiveZoneMap.mockResolvedValue({});
    const independentMoves = [
      { type: 'move', wineId: 1, wineName: 'W1', from: 'R1C1', to: 'R2C1', toZone: 'Z', reason: 'test', confidence: 'high', priority: 1 },
      { type: 'move', wineId: 2, wineName: 'W2', from: 'R3C1', to: 'R4C1', toZone: 'Z', reason: 'test', confidence: 'high', priority: 2 }
    ];
    independentMoves._hasSwaps = false;
    independentMoves._zoneCapacityIssues = [];
    generateMoveSuggestions.mockResolvedValueOnce(independentMoves);
    auditMoveSuggestions.mockResolvedValueOnce({ skipped: true, reason: 'disabled' });

    const report = await analyseCellar([], { cellarId: 'test-cellar' });
    expect(report.movesHaveSwaps).toBe(false);
  });

  it('sets movesHaveSwaps=true for circular swap (A→B, B→C, C→A)', async () => {
    getActiveZoneMap.mockResolvedValue({});
    const circularMoves = [
      { type: 'move', wineId: 1, from: 'R1C1', to: 'R2C1', toZone: 'Z', reason: 'test', confidence: 'high', priority: 1 },
      { type: 'move', wineId: 2, from: 'R2C1', to: 'R3C1', toZone: 'Z', reason: 'test', confidence: 'high', priority: 2 },
      { type: 'move', wineId: 3, from: 'R3C1', to: 'R1C1', toZone: 'Z', reason: 'test', confidence: 'high', priority: 3 }
    ];
    circularMoves._hasSwaps = true;
    circularMoves._zoneCapacityIssues = [];
    generateMoveSuggestions.mockResolvedValueOnce(circularMoves);
    auditMoveSuggestions.mockResolvedValueOnce({ skipped: true, reason: 'disabled' });

    const report = await analyseCellar([], { cellarId: 'test-cellar' });
    expect(report.movesHaveSwaps).toBe(true);
  });

  afterAll(() => {
    vi.doUnmock('../../../../src/db/index.js');
    vi.doUnmock('../../../../src/services/cellar/cellarAllocation.js');
    vi.doUnmock('../../../../src/services/cellar/cellarSuggestions.js');
    vi.doUnmock('../../../../src/services/cellar/cellarNarratives.js');
    vi.doUnmock('../../../../src/services/cellar/moveAuditor.js');
    vi.doUnmock('../../../../src/services/shared/cellarLayoutSettings.js');
    vi.resetModules();
  });
});
