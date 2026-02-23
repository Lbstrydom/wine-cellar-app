/**
 * @fileoverview Integration tests for proposeIdealLayout (async, with mocks).
 * Separated from pure function tests to avoid --no-isolate mock leakage
 * into cellarAllocation.test.js.
 * @module tests/unit/services/cellar/layoutProposerIntegration.test
 */

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getActiveZoneMap: vi.fn().mockResolvedValue({}),
  getZoneRows: vi.fn().mockResolvedValue([]),
  allocateRowToZone: vi.fn().mockRejectedValue(new Error('No rows')),
  getAllocatedRowMap: vi.fn().mockResolvedValue({})
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

import { getActiveZoneMap, allocateRowToZone } from '../../../../src/services/cellar/cellarAllocation.js';
import { proposeIdealLayout } from '../../../../src/services/cellar/layoutProposer.js';

describe('proposeIdealLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns noZones when no zone allocations exist', async () => {
    getActiveZoneMap.mockResolvedValue({});

    const result = await proposeIdealLayout([], { cellarId: 'test' });

    expect(result.stats.noZones).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ type: 'no_zones' })
    );
  });

  it('builds current layout excluding fridge slots', async () => {
    getActiveZoneMap.mockResolvedValue({
      R8: { zoneId: 'shiraz', displayName: 'Shiraz', rowNumber: 1, totalRows: 1, wineCount: 1 }
    });

    const wines = [
      { id: 1, wine_name: 'Shiraz 2020', colour: 'red', grapes: 'shiraz', slot_id: 'R8C1', zone_id: 'shiraz' },
      { id: 2, wine_name: 'Sauv Blanc', colour: 'white', grapes: 'sauvignon blanc', slot_id: 'F1', zone_id: 'fridge' }
    ];

    const result = await proposeIdealLayout(wines, { cellarId: 'test' });

    expect(result.currentLayout.size).toBe(1);
    expect(result.currentLayout.has('R8C1')).toBe(true);
    expect(result.currentLayout.has('F1')).toBe(false);
  });

  it('proposes layout with single wine in allocated zone', async () => {
    getActiveZoneMap.mockResolvedValue({
      R8: { zoneId: 'shiraz', displayName: 'Shiraz', rowNumber: 1, totalRows: 1, wineCount: 1 }
    });

    const wines = [
      { id: 1, wine_name: 'Shiraz Reserve 2020', colour: 'red', country: 'South Africa', grapes: 'shiraz', slot_id: 'R8C5', zone_id: 'shiraz' }
    ];

    const result = await proposeIdealLayout(wines, { cellarId: 'test' });

    expect(result.stats.noZones).toBe(false);
    expect(result.targetLayout.size).toBeGreaterThanOrEqual(1);

    let foundInR8 = false;
    for (const [slot, info] of result.targetLayout) {
      if (slot.startsWith('R8') && info.wineId === 1) {
        foundInR8 = true;
        break;
      }
    }
    expect(foundInR8).toBe(true);
  });

  it('attempts on-demand row allocation when zone is at capacity', async () => {
    getActiveZoneMap.mockResolvedValue({
      R8: { zoneId: 'shiraz', displayName: 'Shiraz', rowNumber: 1, totalRows: 1, wineCount: 10 }
    });

    allocateRowToZone.mockResolvedValueOnce('R9');

    const wines = [];
    for (let i = 1; i <= 10; i++) {
      wines.push({
        id: i, wine_name: `Shiraz ${i}`, colour: 'red', country: 'South Africa',
        grapes: 'shiraz', slot_id: `R8C${i <= 9 ? i : 1}`, zone_id: 'shiraz'
      });
    }

    const result = await proposeIdealLayout(wines, { cellarId: 'test' });

    expect(allocateRowToZone).toHaveBeenCalled();
    expect(result.targetLayout.size).toBe(10);
  });

  it('reports allocation_exhausted when on-demand allocation fails', async () => {
    getActiveZoneMap.mockResolvedValue({
      R8: { zoneId: 'shiraz', displayName: 'Shiraz', rowNumber: 1, totalRows: 1, wineCount: 10 }
    });

    allocateRowToZone.mockRejectedValue(new Error('No colour-compatible rows'));

    const wines = [];
    for (let i = 1; i <= 10; i++) {
      wines.push({
        id: i, wine_name: `Shiraz ${i}`, colour: 'red', country: 'South Africa',
        grapes: 'shiraz', slot_id: `R8C${i <= 9 ? i : 1}`, zone_id: 'shiraz'
      });
    }

    const result = await proposeIdealLayout(wines, { cellarId: 'test' });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ type: 'allocation_exhausted', zoneId: 'shiraz' })
    );
  });

  // NOTE: Do NOT add afterAll with vi.doUnmock/vi.resetModules here.
  // In --no-isolate mode, un-mocking corrupts the module registry for
  // downstream suites (e.g. cellarAllocation.test.js).
});
