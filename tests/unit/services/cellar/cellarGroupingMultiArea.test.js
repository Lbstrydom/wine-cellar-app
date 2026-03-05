/**
 * @fileoverview Unit tests for planStorageAreaGrouping (Phase 3.1).
 * Verifies that per-area grouping correctly scopes to each area's rows.
 */
import { describe, it, expect } from 'vitest';

vi.mock('../../../../src/db/index.js', () => ({ default: { prepare: vi.fn() } }));
vi.mock('../../../../src/services/cellar/cellarPlacement.js', () => ({
  findAvailableSlot: vi.fn()
}));
vi.mock('../../../../src/config/cellarZones.js', () => ({
  getZoneById: vi.fn(() => null)
}));
vi.mock('../../../../src/services/cellar/cellarAllocation.js', () => ({
  getActiveZoneMap: vi.fn().mockResolvedValue({}),
  getAllocatedRowMap: vi.fn().mockResolvedValue({})
}));
vi.mock('../../../../src/services/cellar/cellarMetrics.js', () => ({
  parseSlot: vi.fn((slotId) => {
    if (!slotId) return null;
    if (slotId.startsWith('F')) return { row: 0, col: parseInt(slotId.slice(1), 10) };
    const m = slotId.match(/^R(\d+)C(\d+)$/);
    return m ? { row: parseInt(m[1], 10), col: parseInt(m[2], 10) } : null;
  }),
  detectRowGaps: vi.fn(() => [])
}));
vi.mock('../../../../src/services/cellar/cellarLayout.js', () => ({
  getCellarRowCount: vi.fn().mockResolvedValue(19),
  getStorageAreaRows: vi.fn().mockResolvedValue([]),
  getStorageAreasByType: vi.fn().mockResolvedValue({})
}));

import { planStorageAreaGrouping } from '../../../../src/services/cellar/cellarSuggestions.js';

// Two wine IDs: 10 in area A (R1-R3), 20 in area B (R4-R6)
const AREA_A_ROWS = [
  { row_num: 1, col_count: 9 },
  { row_num: 2, col_count: 9 },
  { row_num: 3, col_count: 9 }
];
const AREA_B_ROWS = [
  { row_num: 4, col_count: 9 },
  { row_num: 5, col_count: 9 },
  { row_num: 6, col_count: 9 }
];
const AREA_A = { id: 'area-a', name: 'Main Cellar' };
const AREA_B = { id: 'area-b', name: 'Side Rack' };

function makeSlotToWine(entries) {
  const m = new Map();
  for (const [slotId, wine] of entries) m.set(slotId, wine);
  return m;
}

describe('planStorageAreaGrouping', () => {
  it('returns areaId and areaName in result', () => {
    const slotToWine = makeSlotToWine([
      ['R1C1', { id: 10, wine_name: 'Chenin' }],
      ['R1C3', { id: 10, wine_name: 'Chenin' }]
    ]);
    const result = planStorageAreaGrouping(slotToWine, {}, AREA_A_ROWS, AREA_A);
    expect(result.areaId).toBe('area-a');
    expect(result.areaName).toBe('Main Cellar');
  });

  it('only groups bottles in the specified area rows', () => {
    // Wine 10 is in area A rows; wine 20 is in area B rows
    const slotToWine = makeSlotToWine([
      ['R1C1', { id: 10, wine_name: 'Chenin' }],
      ['R1C5', { id: 10, wine_name: 'Chenin' }],
      ['R4C1', { id: 20, wine_name: 'Syrah' }],
      ['R4C5', { id: 20, wine_name: 'Syrah' }]
    ]);

    const resultA = planStorageAreaGrouping(slotToWine, {}, AREA_A_ROWS, AREA_A);
    const resultB = planStorageAreaGrouping(slotToWine, {}, AREA_B_ROWS, AREA_B);

    // Area A moves should only involve wine 10 (R1 slots)
    const aWineIds = new Set(resultA.groupingMoves.map(m => m.wineId));
    expect(aWineIds.has(10)).toBe(true);
    expect(aWineIds.has(20)).toBe(false);

    // Area B moves should only involve wine 20 (R4 slots)
    const bWineIds = new Set(resultB.groupingMoves.map(m => m.wineId));
    expect(bWineIds.has(20)).toBe(true);
    expect(bWineIds.has(10)).toBe(false);
  });

  it('returns zero moves when area has no bottles', () => {
    const slotToWine = makeSlotToWine([
      ['R1C1', { id: 10, wine_name: 'Chenin' }]
    ]);
    const result = planStorageAreaGrouping(slotToWine, {}, AREA_B_ROWS, AREA_B);
    expect(result.moveCount).toBe(0);
    expect(result.groupingMoves).toHaveLength(0);
  });

  it('returns zero moves when each wine has only one bottle in the area', () => {
    const slotToWine = makeSlotToWine([
      ['R1C1', { id: 10, wine_name: 'Chenin' }],
      ['R1C2', { id: 20, wine_name: 'Sauvignon' }]
    ]);
    const result = planStorageAreaGrouping(slotToWine, {}, AREA_A_ROWS, AREA_A);
    expect(result.moveCount).toBe(0);
  });

  it('returns steps array for same-row grouping', () => {
    const slotToWine = makeSlotToWine([
      ['R2C1', { id: 10, wine_name: 'Chardonnay' }],
      ['R2C4', { id: 10, wine_name: 'Chardonnay' }]
    ]);
    const result = planStorageAreaGrouping(slotToWine, {}, AREA_A_ROWS, AREA_A);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[0]).toHaveProperty('rowId');
    expect(result.steps[0]).toHaveProperty('steps');
  });

  it('ignores fridge slots (row 0)', () => {
    const slotToWine = makeSlotToWine([
      ['F1', { id: 99, wine_name: 'Sparkling' }],
      ['F2', { id: 99, wine_name: 'Sparkling' }],
      ['R1C1', { id: 10, wine_name: 'Chenin' }],
      ['R1C3', { id: 10, wine_name: 'Chenin' }]
    ]);
    const result = planStorageAreaGrouping(slotToWine, {}, AREA_A_ROWS, AREA_A);
    const wineIds = new Set(result.groupingMoves.map(m => m.wineId));
    expect(wineIds.has(99)).toBe(false);
  });
});
