/**
 * @fileoverview Unit tests for slotReconciliation service.
 * Tests syncStorageAreaSlots and resequenceFridgeSlots against a mock txDb.
 * @module tests/unit/services/cellar/slotReconciliation.test
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// slotReconciliation imports isFridgeType — mock storageTypes to keep tests isolated
vi.mock('../../../../src/config/storageTypes.js', () => ({
  isFridgeType: vi.fn((t) => t === 'wine_fridge' || t === 'kitchen_fridge'),
  isCellarType: vi.fn((t) => t === 'cellar' || t === 'rack' || t === 'other')
}));

let syncStorageAreaSlots, resequenceFridgeSlots;
beforeAll(async () => {
  ({ syncStorageAreaSlots, resequenceFridgeSlots } = await vi.importActual(
    '../../../../src/services/cellar/slotReconciliation.js'
  ));
});

// Helper: build a mock txDb whose prepare().all/get/run are controllable
function makeTxDb(queries = []) {
  let callIndex = 0;
  return {
    prepare: vi.fn(() => {
      const q = queries[callIndex] || {
        all: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ changes: 0 })
      };
      callIndex++;
      return q;
    })
  };
}

// ── syncStorageAreaSlots ───────────────────────────────────────────────────────

describe('syncStorageAreaSlots', () => {
  const CELLAR_ID = 'cellar-uuid';
  const AREA_ID = 'area-uuid';

  describe('provisions slots for a new area (zero existing slots)', () => {
    it('inserts correct slots for a single cellar row', async () => {
      const runs = [];
      const txDb = {
        prepare: vi.fn()
          // 1. SELECT existing slots → []
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue([]) })
          // 2-4. INSERT slots (1 row × 3 cols)
          .mockImplementation(() => ({ run: vi.fn((...args) => { runs.push(args); return Promise.resolve(); }) }))
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [{ row_num: 1, col_count: 3 }]
      });

      expect(runs).toHaveLength(3);
      // Each INSERT should carry cellarId, areaId, 'cellar', row_num, col_num, locationCode
      expect(runs[0]).toEqual([CELLAR_ID, AREA_ID, 'cellar', 1, 1, 'R1C1']);
      expect(runs[1]).toEqual([CELLAR_ID, AREA_ID, 'cellar', 1, 2, 'R1C2']);
      expect(runs[2]).toEqual([CELLAR_ID, AREA_ID, 'cellar', 1, 3, 'R1C3']);
    });

    it('inserts fridge slots with F_TEMP_ provisional codes', async () => {
      const runs = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue([]) })
          .mockImplementation(() => ({ run: vi.fn((...args) => { runs.push(args); return Promise.resolve(); }) }))
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'wine_fridge',
        rows: [{ row_num: 1, col_count: 2 }]
      });

      expect(runs).toHaveLength(2);
      expect(runs[0][5]).toBe('F_TEMP_1_1');
      expect(runs[1][5]).toBe('F_TEMP_1_2');
      expect(runs[0][2]).toBe('fridge');
    });
  });

  describe('row growth — adds new slots', () => {
    it('inserts only the new row\'s slots, leaving existing untouched', async () => {
      const existingSlots = [
        { id: 1, row_num: 1, col_num: 1, location_code: 'R1C1', wine_id: null },
        { id: 2, row_num: 1, col_num: 2, location_code: 'R1C2', wine_id: null },
        { id: 3, row_num: 2, col_num: 1, location_code: 'R2C1', wine_id: null },
        { id: 4, row_num: 2, col_num: 2, location_code: 'R2C2', wine_id: null }
      ];
      const runs = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
          .mockImplementation(() => ({ run: vi.fn((...args) => { runs.push(args); return Promise.resolve(); }) }))
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [
          { row_num: 1, col_count: 2 },
          { row_num: 2, col_count: 2 },
          { row_num: 3, col_count: 2 }  // new row
        ]
      });

      // 2 new slots for row 3, no deletes
      expect(runs).toHaveLength(2);
      expect(runs[0]).toEqual([CELLAR_ID, AREA_ID, 'cellar', 3, 1, 'R3C1']);
      expect(runs[1]).toEqual([CELLAR_ID, AREA_ID, 'cellar', 3, 2, 'R3C2']);
    });
  });

  describe('column growth — adds new column slots', () => {
    it('inserts only new column slots when col_count grows', async () => {
      const existingSlots = [
        { id: 1, row_num: 1, col_num: 1, location_code: 'R1C1', wine_id: null },
        { id: 2, row_num: 1, col_num: 2, location_code: 'R1C2', wine_id: null },
        { id: 3, row_num: 1, col_num: 3, location_code: 'R1C3', wine_id: null }
      ];
      const runs = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
          .mockImplementation(() => ({ run: vi.fn((...args) => { runs.push(args); return Promise.resolve(); }) }))
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [{ row_num: 1, col_count: 5 }]
      });

      // Only cols 4 and 5 should be inserted
      expect(runs).toHaveLength(2);
      expect(runs[0]).toEqual([CELLAR_ID, AREA_ID, 'cellar', 1, 4, 'R1C4']);
      expect(runs[1]).toEqual([CELLAR_ID, AREA_ID, 'cellar', 1, 5, 'R1C5']);
    });
  });

  describe('row shrink — deletes empty slots for removed row', () => {
    it('deletes empty slots outside desired coordinates', async () => {
      const existingSlots = [
        { id: 1, row_num: 1, col_num: 1, location_code: 'R1C1', wine_id: null },
        { id: 2, row_num: 2, col_num: 1, location_code: 'R2C1', wine_id: null },
        { id: 3, row_num: 3, col_num: 1, location_code: 'R3C1', wine_id: null }
      ];
      const deletes = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
          // DELETE slots WHERE id IN (...)
          .mockImplementation(() => ({ run: vi.fn((...args) => { deletes.push(args); return Promise.resolve(); }) }))
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [
          { row_num: 1, col_count: 1 },
          { row_num: 2, col_count: 1 }
          // row 3 removed
        ]
      });

      // Slot id=3 (row 3) should be deleted; no inserts needed
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).toContain(3); // DELETE WHERE id IN (3)
    });
  });

  describe('column shrink — deletes empty slots beyond new col_count', () => {
    it('deletes empty slots in columns beyond new col_count', async () => {
      const existingSlots = [
        { id: 1, row_num: 1, col_num: 1, location_code: 'R1C1', wine_id: null },
        { id: 2, row_num: 1, col_num: 2, location_code: 'R1C2', wine_id: null },
        { id: 3, row_num: 1, col_num: 3, location_code: 'R1C3', wine_id: null },
        { id: 4, row_num: 1, col_num: 4, location_code: 'R1C4', wine_id: null },
        { id: 5, row_num: 1, col_num: 5, location_code: 'R1C5', wine_id: null }
      ];
      const deletes = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
          .mockImplementation(() => ({ run: vi.fn((...args) => { deletes.push(args); return Promise.resolve(); }) }))
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [{ row_num: 1, col_count: 3 }]
      });

      // Slots 4 and 5 (cols 4+5) should be in the delete batch
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).toContain(4);
      expect(deletes[0]).toContain(5);
    });
  });

  describe('occupied slots outside desired coords — not deleted', () => {
    it('leaves occupied slots outside desired coords untouched (caller guards handle this)', async () => {
      const existingSlots = [
        { id: 1, row_num: 1, col_num: 1, location_code: 'R1C1', wine_id: null },
        { id: 2, row_num: 2, col_num: 1, location_code: 'R2C1', wine_id: 'wine-123' } // occupied, row removed
      ];
      const deletes = [];
      const inserts = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
          .mockImplementation(() => ({
            run: vi.fn((...args) => {
              // Distinguish DELETE from INSERT by SQL in prepare call
              deletes.push(args);
              return Promise.resolve();
            })
          }))
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [{ row_num: 1, col_count: 1 }]  // row 2 removed
      });

      // Only empty slots should be deleted; occupied slot id=2 is NOT in the delete list
      // (empty toDelete array — no empty orphans)
      expect(txDb.prepare).toHaveBeenCalledTimes(1); // only the SELECT, no DELETE/INSERT
    });
  });

  describe('storage_type change — rewrites kept slot codes', () => {
    it('rewrites F... codes to R...C... when type changes fridge → cellar, returns needsResequence=true', async () => {
      const existingSlots = [
        { id: 1, row_num: 1, col_num: 1, location_code: 'F1', wine_id: null },
        { id: 2, row_num: 1, col_num: 2, location_code: 'F2', wine_id: null }
      ];
      const updates = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
          // Two UPDATE calls for the two kept slots
          .mockImplementation(() => ({ run: vi.fn((...args) => { updates.push(args); return Promise.resolve(); }) }))
      };

      const result = await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [{ row_num: 1, col_count: 2 }]
      });

      expect(updates).toHaveLength(2);
      expect(updates[0]).toEqual(['R1C1', 1]);
      expect(updates[1]).toEqual(['R1C2', 2]);
      expect(result.needsResequence).toBe(true);
    });

    it('rewrites R...C... codes to F_TEMP_... when type changes cellar → fridge, returns needsResequence=false', async () => {
      const existingSlots = [
        { id: 10, row_num: 2, col_num: 3, location_code: 'R2C3', wine_id: null }
      ];
      const updates = [];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
          .mockImplementation(() => ({ run: vi.fn((...args) => { updates.push(args); return Promise.resolve(); }) }))
      };

      const result = await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'wine_fridge',
        rows: [{ row_num: 2, col_count: 3 }]
      });

      // UPDATE for the kept slot is the first run() call; cols 1 and 2 are new → inserts follow
      expect(updates[0]).toEqual(['F_TEMP_2_3', 10]);
      expect(result.needsResequence).toBe(false);
    });

    it('returns needsResequence=false when no type mismatch', async () => {
      const existingSlots = [
        { id: 5, row_num: 1, col_num: 1, location_code: 'R1C1', wine_id: null }
      ];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
      };

      const result = await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [{ row_num: 1, col_count: 1 }]
      });

      expect(result.needsResequence).toBe(false);
      // No UPDATE calls — only the initial SELECT
      expect(txDb.prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotent on no-change', () => {
    it('does nothing when layout matches existing slots exactly', async () => {
      const existingSlots = [
        { id: 1, row_num: 1, col_num: 1, location_code: 'R1C1', wine_id: null },
        { id: 2, row_num: 1, col_num: 2, location_code: 'R1C2', wine_id: null }
      ];
      const txDb = {
        prepare: vi.fn()
          .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(existingSlots) })
      };

      await syncStorageAreaSlots(txDb, {
        cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar',
        rows: [{ row_num: 1, col_count: 2 }]
      });

      // Only the SELECT was called — no DELETE, no INSERT
      expect(txDb.prepare).toHaveBeenCalledTimes(1);
    });
  });
});

// ── resequenceFridgeSlots ─────────────────────────────────────────────────────

describe('resequenceFridgeSlots', () => {
  const CELLAR_ID = 'cellar-uuid';

  it('assigns contiguous F1..Fn in canonical order', async () => {
    const fridgeSlots = [
      { id: 10, location_code: 'F1' },
      { id: 20, location_code: 'F2' },
      { id: 30, location_code: 'F3' }
    ];
    const pass1 = [];
    const pass2 = [];
    let pass1Done = false;
    const txDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(fridgeSlots) })
        .mockImplementation(() => ({
          run: vi.fn((...args) => {
            if (!pass1Done) {
              pass1.push(args);
              if (pass1.length === fridgeSlots.length) pass1Done = true;
            } else {
              pass2.push(args);
            }
            return Promise.resolve();
          })
        }))
    };

    await resequenceFridgeSlots(txDb, CELLAR_ID);

    // Pass 1: temp codes
    expect(pass1[0]).toEqual([`__reseq_10`, 10]);
    expect(pass1[1]).toEqual([`__reseq_20`, 20]);
    expect(pass1[2]).toEqual([`__reseq_30`, 30]);

    // Pass 2: final F-codes
    expect(pass2[0]).toEqual(['F1', 10]);
    expect(pass2[1]).toEqual(['F2', 20]);
    expect(pass2[2]).toEqual(['F3', 30]);
  });

  it('is a no-op when no fridge slots exist', async () => {
    const txDb = {
      prepare: vi.fn().mockReturnValueOnce({ all: vi.fn().mockResolvedValue([]) })
    };

    await resequenceFridgeSlots(txDb, CELLAR_ID);

    // Only the SELECT was called — no UPDATEs
    expect(txDb.prepare).toHaveBeenCalledTimes(1);
  });

  it('replaces F_TEMP_ provisional codes with final F-codes', async () => {
    const fridgeSlots = [
      { id: 5, location_code: 'F_TEMP_1_1' },
      { id: 6, location_code: 'F_TEMP_1_2' }
    ];
    const finalCodes = [];
    let callCount = 0;
    const txDb = {
      prepare: vi.fn()
        .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(fridgeSlots) })
        .mockImplementation(() => ({
          run: vi.fn((...args) => {
            callCount++;
            if (callCount > fridgeSlots.length) finalCodes.push(args[0]);
            return Promise.resolve();
          })
        }))
    };

    await resequenceFridgeSlots(txDb, CELLAR_ID);

    expect(finalCodes).toEqual(['F1', 'F2']);
  });
});
