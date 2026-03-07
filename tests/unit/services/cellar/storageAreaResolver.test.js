/**
 * @fileoverview Unit tests for storageAreaResolver helpers.
 * @module tests/unit/services/cellar/storageAreaResolver.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database BEFORE importing the module that uses it
vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

vi.mock('../../../../src/utils/errorResponse.js', async () => {
  const actual = await vi.importActual('../../../../src/utils/errorResponse.js');
  return actual;
});

import { resolveStorageAreaId, resolveAreaFromSlot } from '../../../../src/services/cellar/storageAreaResolver.js';
import db from '../../../../src/db/index.js';

const CELLAR_ID = 'cellar-uuid-1234';
const AREA_ID = 'area-uuid-5678';

describe('resolveStorageAreaId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when storageAreaId is provided', () => {
    it('returns area when it belongs to the cellar', async () => {
      const area = { id: AREA_ID, storage_type: 'cellar', name: 'Main Cellar' };
      db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(area) });

      const result = await resolveStorageAreaId(CELLAR_ID, AREA_ID);

      expect(result).toEqual(area);
      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain('storage_areas');
      expect(sql).toContain('cellar_id');
    });

    it('queries by both area ID and cellar ID for tenant isolation', async () => {
      const area = { id: AREA_ID, storage_type: 'wine_fridge', name: 'Fridge' };
      const getMock = vi.fn().mockResolvedValue(area);
      db.prepare.mockReturnValue({ get: getMock });

      await resolveStorageAreaId(CELLAR_ID, AREA_ID);

      const args = getMock.mock.calls[0];
      expect(args).toContain(AREA_ID);
      expect(args).toContain(CELLAR_ID);
    });

    it('throws 404 when area is not found', async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(null) });

      await expect(resolveStorageAreaId(CELLAR_ID, AREA_ID))
        .rejects.toThrow(/not found/i);
    });

    it('throws 404 when area belongs to a different cellar', async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(null) });

      await expect(resolveStorageAreaId('other-cellar-id', AREA_ID))
        .rejects.toThrow();
    });
  });

  describe('when storageAreaId is null/undefined', () => {
    it('falls back to first area of default storage type (cellar)', async () => {
      const area = { id: AREA_ID, storage_type: 'cellar', name: 'Main Cellar' };
      db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(area) });

      const result = await resolveStorageAreaId(CELLAR_ID, null);

      expect(result).toEqual(area);
      const sql = db.prepare.mock.calls[0][0];
      expect(sql).toContain("storage_type = $2");
    });

    it('uses the specified storageType for fallback query', async () => {
      const area = { id: AREA_ID, storage_type: 'wine_fridge', name: 'Fridge' };
      const getMock = vi.fn().mockResolvedValue(area);
      db.prepare.mockReturnValue({ get: getMock });

      const result = await resolveStorageAreaId(CELLAR_ID, undefined, 'wine_fridge');

      expect(result).toEqual(area);
      const args = getMock.mock.calls[0];
      expect(args).toContain('wine_fridge');
    });

    it('defaults to cellar storage type when not specified', async () => {
      const getMock = vi.fn().mockResolvedValue({ id: AREA_ID, storage_type: 'cellar', name: 'Main' });
      db.prepare.mockReturnValue({ get: getMock });

      await resolveStorageAreaId(CELLAR_ID, null);

      const args = getMock.mock.calls[0];
      expect(args).toContain('cellar');
    });

    it('throws 404 when no area of the given type exists', async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(null) });

      await expect(resolveStorageAreaId(CELLAR_ID, null, 'wine_fridge'))
        .rejects.toThrow(/wine_fridge/);
    });

    it('throws 404 when cellar has no storage areas at all', async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(null) });

      await expect(resolveStorageAreaId(CELLAR_ID, null))
        .rejects.toThrow();
    });
  });
});

describe('resolveAreaFromSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns storage_area_id when exactly one slot matches', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ storage_area_id: AREA_ID }])
    });

    const result = await resolveAreaFromSlot(CELLAR_ID, 'R5C3');

    expect(result).toBe(AREA_ID);
  });

  it('queries slots by cellar_id and location_code', async () => {
    const allMock = vi.fn().mockResolvedValue([{ storage_area_id: AREA_ID }]);
    db.prepare.mockReturnValue({ all: allMock });

    await resolveAreaFromSlot(CELLAR_ID, 'R5C3');

    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('slots');
    expect(sql).toContain('cellar_id');
    expect(sql).toContain('location_code');

    const args = allMock.mock.calls[0];
    expect(args).toContain(CELLAR_ID);
    expect(args).toContain('R5C3');
  });

  it('throws 404 when no slot is found', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue([]) });

    await expect(resolveAreaFromSlot(CELLAR_ID, 'R99C9'))
      .rejects.toThrow(/not found/i);
  });

  it('throws 404 when rows is null', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(null) });

    await expect(resolveAreaFromSlot(CELLAR_ID, 'R1C1'))
      .rejects.toThrow();
  });

  it('throws 409 when multiple slots match (defence-in-depth)', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([
        { storage_area_id: 'area-1' },
        { storage_area_id: 'area-2' }
      ])
    });

    await expect(resolveAreaFromSlot(CELLAR_ID, 'R5C3'))
      .rejects.toThrow(/ambiguous|supply/i);
  });

  it('throws 404 when slot exists but has no storage_area_id', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ storage_area_id: null }])
    });

    await expect(resolveAreaFromSlot(CELLAR_ID, 'R5C3'))
      .rejects.toThrow(/no storage area/i);
  });

  it('works with fridge slot codes', async () => {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ storage_area_id: AREA_ID }])
    });

    const result = await resolveAreaFromSlot(CELLAR_ID, 'F2');

    expect(result).toBe(AREA_ID);
  });
});
