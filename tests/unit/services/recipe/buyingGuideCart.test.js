/**
 * @fileoverview Unit tests for buying guide cart service.
 * Tests CRUD, state machine, cellar isolation, currency-segmented totals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before imports
vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
}));

vi.mock('../../../../src/services/recipe/buyingGuide.js', () => ({
  invalidateBuyingGuideCache: vi.fn(() => Promise.resolve())
}));

import db from '../../../../src/db/index.js';
import {
  listItems, getItem, createItem, updateItem,
  updateItemStatus, batchUpdateStatus, deleteItem,
  getCartSummary, getActiveItems
} from '../../../../src/services/recipe/buyingGuideCart.js';

const CELLAR_ID = 'cellar-uuid-123';

/** Helper to setup db.prepare mock with query-routing. */
function mockDb(handlers = {}) {
  db.prepare.mockImplementation((sql) => ({
    get: vi.fn((...args) => Promise.resolve(
      handlers.get ? handlers.get(sql, args) : null
    )),
    all: vi.fn((...args) => Promise.resolve(
      handlers.all ? handlers.all(sql, args) : []
    )),
    run: vi.fn((...args) => Promise.resolve(
      handlers.run ? handlers.run(sql, args) : { changes: 1 }
    ))
  }));
}

describe('buyingGuideCart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listItems', () => {
    it('returns items with total count', async () => {
      mockDb({
        get: (sql) => {
          if (sql.includes('COUNT')) return { count: 2 };
          return null;
        },
        all: () => [
          { id: 1, wine_name: 'Chenin Blanc', status: 'planned' },
          { id: 2, wine_name: 'Pinotage', status: 'ordered' }
        ]
      });

      const result = await listItems(CELLAR_ID);
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('filters by status', async () => {
      let capturedSql = '';
      mockDb({
        get: () => ({ count: 1 }),
        all: (sql) => { capturedSql = sql; return [{ id: 1 }]; }
      });

      await listItems(CELLAR_ID, { status: 'planned' });
      expect(capturedSql).toContain('status = $2');
    });

    it('filters by style_id', async () => {
      let capturedSql = '';
      mockDb({
        get: () => ({ count: 0 }),
        all: (sql) => { capturedSql = sql; return []; }
      });

      await listItems(CELLAR_ID, { style_id: 'red_full' });
      expect(capturedSql).toContain('style_id = $2');
    });

    it('applies pagination', async () => {
      let capturedArgs;
      mockDb({
        get: () => ({ count: 50 }),
        all: (_sql, args) => { capturedArgs = args; return []; }
      });

      await listItems(CELLAR_ID, { limit: 10, offset: 20 });
      expect(capturedArgs).toContain(10);
      expect(capturedArgs).toContain(20);
    });
  });

  describe('getItem', () => {
    it('returns item for matching cellar', async () => {
      const mockItem = { id: 1, cellar_id: CELLAR_ID, wine_name: 'Test' };
      mockDb({ get: () => mockItem });

      const item = await getItem(CELLAR_ID, 1);
      expect(item).toEqual(mockItem);
    });

    it('returns null for non-existent item', async () => {
      mockDb({ get: () => null });

      const item = await getItem(CELLAR_ID, 999);
      expect(item).toBeNull();
    });
  });

  describe('createItem', () => {
    it('creates item with all fields', async () => {
      const data = {
        wine_name: 'Kanonkop Pinotage',
        producer: 'Kanonkop',
        quantity: 2,
        style_id: 'red_full',
        price: 350,
        currency: 'ZAR',
        vintage: 2021,
        colour: 'red',
        source_gap_style: 'red_full'
      };
      const expected = { id: 1, ...data, status: 'planned' };
      mockDb({ get: () => expected });

      const result = await createItem(CELLAR_ID, data);
      expect(result.id).toBe(1);
      expect(result.wine_name).toBe('Kanonkop Pinotage');
    });

    it('defaults quantity to 1', async () => {
      let capturedArgs;
      mockDb({
        get: (_sql, args) => {
          capturedArgs = args;
          return { id: 1, wine_name: 'Test', quantity: 1 };
        }
      });

      await createItem(CELLAR_ID, { wine_name: 'Test' });
      // quantity is the 4th arg (index 3)
      expect(capturedArgs[3]).toBe(1);
    });

    it('defaults source to manual', async () => {
      let capturedArgs;
      mockDb({
        get: (_sql, args) => {
          capturedArgs = args;
          return { id: 1, wine_name: 'Test', source: 'manual' };
        }
      });

      await createItem(CELLAR_ID, { wine_name: 'Test' });
      // source is the 16th arg (index 15)
      expect(capturedArgs[15]).toBe('manual');
    });
  });

  describe('updateItem', () => {
    it('updates specified fields with updated_at', async () => {
      let capturedSql = '';
      mockDb({
        get: (sql) => {
          capturedSql = sql;
          if (sql.includes('UPDATE')) {
            return { id: 1, wine_name: 'New Name', updated_at: '2026-02-27' };
          }
          return { id: 1, wine_name: 'Old Name' };
        }
      });

      const result = await updateItem(CELLAR_ID, 1, { wine_name: 'New Name' });
      expect(capturedSql).toContain('updated_at = NOW()');
      expect(result.wine_name).toBe('New Name');
    });

    it('returns existing item when no fields provided', async () => {
      mockDb({ get: () => ({ id: 1, wine_name: 'Unchanged' }) });

      const result = await updateItem(CELLAR_ID, 1, {});
      expect(result.wine_name).toBe('Unchanged');
    });

    it('returns null when item not found', async () => {
      mockDb({ get: () => null });

      const result = await updateItem(CELLAR_ID, 999, { wine_name: 'X' });
      expect(result).toBeNull();
    });
  });

  describe('updateItemStatus — state machine', () => {
    it('allows planned → ordered', async () => {
      let statusSet;
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'planned', cellar_id: CELLAR_ID });
          }
          // UPDATE query
          statusSet = args[0];
          return Promise.resolve({ id: 1, status: args[0] });
        }),
        all: vi.fn(() => Promise.resolve([]))
      }));

      const { item, error } = await updateItemStatus(CELLAR_ID, 1, 'ordered');
      expect(error).toBeNull();
      expect(statusSet).toBe('ordered');
    });

    it('allows planned → arrived (skip ordered)', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'planned', cellar_id: CELLAR_ID });
          }
          return Promise.resolve({ id: 1, status: args[0] });
        })
      }));

      const { error } = await updateItemStatus(CELLAR_ID, 1, 'arrived');
      expect(error).toBeNull();
    });

    it('allows planned → cancelled', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'planned', cellar_id: CELLAR_ID });
          }
          return Promise.resolve({ id: 1, status: args[0] });
        })
      }));

      const { error } = await updateItemStatus(CELLAR_ID, 1, 'cancelled');
      expect(error).toBeNull();
    });

    it('allows ordered → cancelled', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'ordered', cellar_id: CELLAR_ID });
          }
          return Promise.resolve({ id: 1, status: args[0] });
        })
      }));

      const { error } = await updateItemStatus(CELLAR_ID, 1, 'cancelled');
      expect(error).toBeNull();
    });

    it('allows cancelled → planned (recovery)', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'cancelled', cellar_id: CELLAR_ID });
          }
          return Promise.resolve({ id: 1, status: args[0] });
        })
      }));

      const { error } = await updateItemStatus(CELLAR_ID, 1, 'planned');
      expect(error).toBeNull();
    });

    it('rejects arrived → ordered (backwards)', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'arrived', cellar_id: CELLAR_ID });
          }
          return Promise.resolve(null);
        })
      }));

      const { item, error } = await updateItemStatus(CELLAR_ID, 1, 'ordered');
      expect(error).toContain("Cannot transition from 'arrived' to 'ordered'");
      expect(item).toBeNull();
    });

    it('rejects cancelled → ordered (no shortcut)', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'cancelled', cellar_id: CELLAR_ID });
          }
          return Promise.resolve(null);
        })
      }));

      const { error } = await updateItemStatus(CELLAR_ID, 1, 'ordered');
      expect(error).toContain("Cannot transition from 'cancelled' to 'ordered'");
    });

    it('returns error for non-existent item', async () => {
      mockDb({ get: () => null });

      const { error } = await updateItemStatus(CELLAR_ID, 999, 'ordered');
      expect(error).toBe('Item not found');
    });
  });

  describe('batchUpdateStatus', () => {
    it('updates valid items and skips invalid ones', async () => {
      let callCount = 0;
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            callCount++;
            // First item: planned (valid for ordered), second: arrived (invalid for ordered)
            if (callCount <= 1) return Promise.resolve({ id: 1, status: 'planned', cellar_id: CELLAR_ID });
            return Promise.resolve({ id: 2, status: 'arrived', cellar_id: CELLAR_ID });
          }
          return Promise.resolve({ id: args[1], status: args[0] });
        })
      }));

      const result = await batchUpdateStatus(CELLAR_ID, [1, 2], 'ordered');
      expect(result.updated).toBe(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].id).toBe(2);
    });
  });

  describe('deleteItem', () => {
    it('deletes non-converted item', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, converted_wine_id: null, cellar_id: CELLAR_ID });
          }
          return Promise.resolve(null);
        }),
        run: vi.fn(() => Promise.resolve({ changes: 1 }))
      }));

      const { deleted, error } = await deleteItem(CELLAR_ID, 1);
      expect(deleted).toBe(true);
      expect(error).toBeNull();
    });

    it('rejects deletion of converted item', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, converted_wine_id: 42, cellar_id: CELLAR_ID });
          }
          return Promise.resolve(null);
        })
      }));

      const { deleted, error } = await deleteItem(CELLAR_ID, 1);
      expect(deleted).toBe(false);
      expect(error).toBe('Cannot delete a converted item');
    });

    it('returns error for non-existent item', async () => {
      mockDb({ get: () => null });

      const { deleted, error } = await deleteItem(CELLAR_ID, 999);
      expect(deleted).toBe(false);
      expect(error).toBe('Item not found');
    });
  });

  describe('getCartSummary', () => {
    it('returns status counts and currency-segmented totals', async () => {
      db.prepare.mockImplementation((sql) => ({
        all: vi.fn(() => {
          if (sql.includes('GROUP BY status')) {
            return Promise.resolve([
              { status: 'planned', count: '3', bottles: '5' },
              { status: 'ordered', count: '1', bottles: '2' }
            ]);
          }
          if (sql.includes('GROUP BY currency')) {
            return Promise.resolve([
              { currency: 'ZAR', bottles: '4', cost: '1400.00' },
              { currency: 'EUR', bottles: '3', cost: '90.50' }
            ]);
          }
          return Promise.resolve([]);
        })
      }));

      const summary = await getCartSummary(CELLAR_ID);
      expect(summary.counts.planned).toEqual({ items: 3, bottles: 5 });
      expect(summary.counts.ordered).toEqual({ items: 1, bottles: 2 });
      expect(summary.totals.ZAR).toEqual({ bottles: 4, cost: 1400 });
      expect(summary.totals.EUR).toEqual({ bottles: 3, cost: 90.5 });
    });
  });

  describe('getActiveItems', () => {
    it('returns planned + ordered + arrived (unconverted)', async () => {
      let capturedSql = '';
      mockDb({
        all: (sql) => {
          capturedSql = sql;
          return [
            { id: 1, status: 'planned', converted_wine_id: null },
            { id: 2, status: 'ordered', converted_wine_id: null },
            { id: 3, status: 'arrived', converted_wine_id: null }
          ];
        }
      });

      const items = await getActiveItems(CELLAR_ID);
      expect(items).toHaveLength(3);
      expect(capturedSql).toContain("IN ('planned', 'ordered', 'arrived')");
      expect(capturedSql).toContain('converted_wine_id IS NULL');
    });
  });

  describe('cellar isolation', () => {
    it('all queries include cellar_id parameter', async () => {
      const queriedCellarIds = [];
      db.prepare.mockImplementation(() => ({
        get: vi.fn((...args) => {
          queriedCellarIds.push(args[0]);
          return Promise.resolve({ id: 1, count: 0 });
        }),
        all: vi.fn((...args) => {
          queriedCellarIds.push(args[0]);
          return Promise.resolve([]);
        }),
        run: vi.fn((...args) => {
          queriedCellarIds.push(args[0]);
          return Promise.resolve({ changes: 0 });
        })
      }));

      // Call various functions — all should use CELLAR_ID
      await listItems(CELLAR_ID);
      await getCartSummary(CELLAR_ID);
      await getActiveItems(CELLAR_ID);

      // Every call should have used our cellar ID
      for (const id of queriedCellarIds) {
        expect(id).toBe(CELLAR_ID);
      }
    });
  });
});
