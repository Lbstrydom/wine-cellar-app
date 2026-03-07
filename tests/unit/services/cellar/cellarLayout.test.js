/**
 * @fileoverview Unit tests for cellarLayout service.
 * Tests getStorageAreaRows, getStorageAreaRowsForArea, getCellarRowCount,
 * getRowSlotIds, and getStorageAreasByType.
 * @module tests/unit/services/cellar/cellarLayout.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/cellar/slotUtils.js', () => ({
  getRowCapacity: vi.fn((rowId, rows) => {
    // Mimic real logic: use dynamic rows if available, otherwise default 9 (7 for R1)
    if (rows && rows.length > 0) {
      const rowNum = Number.parseInt(rowId.slice(1), 10);
      const match = rows.find(r => r.row_num === rowNum);
      if (match) return match.col_count;
    }
    const rowNum = Number.parseInt(rowId.slice(1), 10);
    return rowNum === 1 ? 7 : 9;
  })
}));

import {
  getStorageAreaRows,
  getStorageAreaRowsForArea,
  getCellarRowCount,
  getRowSlotIds,
  getStorageAreasByType
} from '../../../../src/services/cellar/cellarLayout.js';
import db from '../../../../src/db/index.js';

const CELLAR_ID = 'cellar-abc';
const AREA_ID = 'area-uuid-1234';

describe('getStorageAreaRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when cellarId is falsy', async () => {
    const result = await getStorageAreaRows(null);
    expect(result).toEqual([]);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('returns rows for a cellar (no storageAreaId)', async () => {
    const rows = [
      { row_num: 1, col_count: 7, label: null },
      { row_num: 2, col_count: 9, label: null }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(rows) });

    const result = await getStorageAreaRows(CELLAR_ID);

    expect(result).toEqual(rows);
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('storage_area_rows');
    expect(sql).toContain("storage_type = 'cellar'");
  });

  it('filters by storageAreaId when provided', async () => {
    const rows = [{ row_num: 3, col_count: 9, label: null }];
    const allMock = vi.fn().mockResolvedValue(rows);
    db.prepare.mockReturnValue({ all: allMock });

    const result = await getStorageAreaRows(CELLAR_ID, AREA_ID);

    expect(result).toEqual(rows);
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('storage_area_id = $2');

    const args = allMock.mock.calls[0];
    expect(args).toContain(CELLAR_ID);
    expect(args).toContain(AREA_ID);
  });

  it('always filters by cellar_id for tenant isolation', async () => {
    const allMock = vi.fn().mockResolvedValue([]);
    db.prepare.mockReturnValue({ all: allMock });

    await getStorageAreaRows(CELLAR_ID, AREA_ID);

    const args = allMock.mock.calls[0];
    expect(args).toContain(CELLAR_ID);
  });

  it('returns [] when db returns null', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(null) });

    const result = await getStorageAreaRows(CELLAR_ID);

    expect(result).toEqual([]);
  });
});

describe('getStorageAreaRowsForArea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when storageAreaId is falsy', async () => {
    const result = await getStorageAreaRowsForArea(null);
    expect(result).toEqual([]);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('returns rows for a specific area ID', async () => {
    const rows = [{ row_num: 5, col_count: 9, label: 'Row 5' }];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(rows) });

    const result = await getStorageAreaRowsForArea(AREA_ID);

    expect(result).toEqual(rows);
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('storage_area_rows');
    expect(sql).toContain('storage_area_id = $1');
  });

  it('queries by area ID only (no cellar_id needed)', async () => {
    const allMock = vi.fn().mockResolvedValue([]);
    db.prepare.mockReturnValue({ all: allMock });

    await getStorageAreaRowsForArea(AREA_ID);

    const args = allMock.mock.calls[0];
    expect(args).toContain(AREA_ID);
    expect(args).toHaveLength(1);
  });

  it('returns [] when db returns null', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(null) });

    const result = await getStorageAreaRowsForArea(AREA_ID);

    expect(result).toEqual([]);
  });
});

describe('getCellarRowCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 19 (legacy fallback) when no rows are defined', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue([]) });

    const result = await getCellarRowCount(CELLAR_ID);

    expect(result).toBe(19);
  });

  it('returns max row_num from defined rows', async () => {
    const rows = [
      { row_num: 1, col_count: 7, label: null },
      { row_num: 15, col_count: 9, label: null },
      { row_num: 8, col_count: 9, label: null }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(rows) });

    const result = await getCellarRowCount(CELLAR_ID);

    expect(result).toBe(15);
  });

  it('returns 19 when db returns null', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(null) });

    const result = await getCellarRowCount(CELLAR_ID);

    expect(result).toBe(19);
  });
});

describe('getRowSlotIds', () => {
  it('returns slot IDs for a row using dynamic col_count', () => {
    const storageAreaRows = [{ row_num: 3, col_count: 5, label: null }];
    const result = getRowSlotIds('R3', storageAreaRows);
    expect(result).toEqual(['R3C1', 'R3C2', 'R3C3', 'R3C4', 'R3C5']);
  });

  it('returns 7 slots for R1 when no dynamic rows provided', () => {
    const result = getRowSlotIds('R1', []);
    expect(result).toEqual(['R1C1', 'R1C2', 'R1C3', 'R1C4', 'R1C5', 'R1C6', 'R1C7']);
  });

  it('returns 9 slots for R2 when no dynamic rows provided', () => {
    const result = getRowSlotIds('R2', []);
    expect(result).toHaveLength(9);
    expect(result[0]).toBe('R2C1');
    expect(result[8]).toBe('R2C9');
  });

  it('returns [] for invalid row ID (non-numeric after first char)', () => {
    const result = getRowSlotIds('RX', []);
    expect(result).toEqual([]);
  });
});

describe('getStorageAreasByType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object when cellarId is falsy', async () => {
    const result = await getStorageAreasByType(null);
    expect(result).toEqual({});
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('groups areas by storage_type', async () => {
    const areas = [
      { id: 'area-1', name: 'Main Cellar', storage_type: 'cellar', temp_zone: null, display_order: 1, rows: '[]' },
      { id: 'area-2', name: 'Fridge', storage_type: 'wine_fridge', temp_zone: 'cold', display_order: 2, rows: '[]' }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(areas) });

    const result = await getStorageAreasByType(CELLAR_ID);

    expect(result).toHaveProperty('cellar');
    expect(result).toHaveProperty('wine_fridge');
    expect(result.cellar).toHaveLength(1);
    expect(result.wine_fridge).toHaveLength(1);
  });

  it('parses rows from JSON string', async () => {
    const rowsJson = JSON.stringify([{ row_num: 1, col_count: 7, label: null }]);
    const areas = [
      { id: 'area-1', name: 'Cellar', storage_type: 'cellar', temp_zone: null, display_order: 1, rows: rowsJson }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(areas) });

    const result = await getStorageAreasByType(CELLAR_ID);

    expect(result.cellar[0].rows).toEqual([{ row_num: 1, col_count: 7, label: null }]);
  });

  it('handles rows already parsed as array (JSONB)', async () => {
    const areas = [
      { id: 'area-1', name: 'Cellar', storage_type: 'cellar', temp_zone: null, display_order: 1,
        rows: [{ row_num: 1, col_count: 7, label: null }] }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(areas) });

    const result = await getStorageAreasByType(CELLAR_ID);

    expect(result.cellar[0].rows).toEqual([{ row_num: 1, col_count: 7, label: null }]);
  });

  it('falls back to empty rows array when rows is null', async () => {
    const areas = [
      { id: 'area-1', name: 'Cellar', storage_type: 'cellar', temp_zone: null, display_order: 1, rows: null }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(areas) });

    const result = await getStorageAreasByType(CELLAR_ID);

    expect(result.cellar[0].rows).toEqual([]);
  });

  it('returns empty object when db returns null', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(null) });

    const result = await getStorageAreasByType(CELLAR_ID);

    expect(result).toEqual({});
  });

  it('groups multiple areas of the same type', async () => {
    const areas = [
      { id: 'area-1', name: 'Cellar A', storage_type: 'cellar', temp_zone: null, display_order: 1, rows: '[]' },
      { id: 'area-2', name: 'Cellar B', storage_type: 'cellar', temp_zone: null, display_order: 2, rows: '[]' }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(areas) });

    const result = await getStorageAreasByType(CELLAR_ID);

    expect(result.cellar).toHaveLength(2);
  });
});
