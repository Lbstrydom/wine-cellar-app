/**
 * @fileoverview Unit tests for storage areas route — Fix D changes.
 * Tests colour_zone in CRUD and row continuity guard.
 * @module tests/unit/routes/storageAreas.test
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Hoist so these refs are available inside the vi.mock factory
const { mockTransaction, mockWrapClient } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockWrapClient: vi.fn()
}));

vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    transaction: mockTransaction
  },
  wrapClient: mockWrapClient
}));

// Mock reconciliation helpers so route tests focus on route logic,
// not the slot-provisioning internals (covered by slotReconciliation.test.js)
vi.mock('../../../src/services/cellar/slotReconciliation.js', () => ({
  syncStorageAreaSlots: vi.fn().mockResolvedValue(undefined),
  resequenceFridgeSlots: vi.fn().mockResolvedValue(undefined)
}));

import express from 'express';
import request from 'supertest';
import storageAreasRouter from '../../../src/routes/storageAreas.js';
import db from '../../../src/db/index.js';
import { syncStorageAreaSlots, resequenceFridgeSlots } from '../../../src/services/cellar/slotReconciliation.js';

const CELLAR_ID = 'cellar-123';
const AREA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function createApp(cellarId = CELLAR_ID) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = cellarId; next(); });
  app.use('/storage-areas', storageAreasRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('Storage Areas routes — Fix D', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    // Make db.transaction(fn) call fn with db as the client (transparent pass-through)
    mockTransaction.mockImplementation(fn => fn(db));
    // Make wrapClient(client) return the client as-is so txDb.prepare === db.prepare
    mockWrapClient.mockImplementation(client => client);
  });

  // Helper: set up sequential db.prepare mock calls
  function mockPrepareSequence(...calls) {
    let callIndex = 0;
    db.prepare.mockImplementation(() => {
      const mock = calls[callIndex] || { get: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue([]), run: vi.fn().mockResolvedValue({ changes: 0 }) };
      callIndex++;
      return mock;
    });
  }

  describe('GET /storage-areas', () => {
    it('includes colour_zone in list response', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([
          { id: AREA_ID, name: 'Main', storage_type: 'cellar', colour_zone: 'mixed' },
          { id: 'area-2', name: 'Garage', storage_type: 'rack', colour_zone: 'red' }
        ])
      });

      const res = await request(app).get('/storage-areas');

      expect(res.status).toBe(200);
      expect(res.body.data[0].colour_zone).toBe('mixed');
      expect(res.body.data[1].colour_zone).toBe('red');
    });
  });

  describe('GET /storage-areas/:id', () => {
    it('includes colour_zone in single area response', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Main', colour_zone: 'white' }) },
        { all: vi.fn().mockResolvedValue([{ row_num: 1, col_count: 9 }]) }
      );

      const res = await request(app).get(`/storage-areas/${AREA_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data.colour_zone).toBe('white');
    });
  });

  describe('POST /storage-areas — colour_zone', () => {
    function mockCreateSuccess(maxRow = 0) {
      mockPrepareSequence(
        // 1. Area count check
        { get: vi.fn().mockResolvedValue({ count: 1 }) },
        // 2. Unique name check
        { get: vi.fn().mockResolvedValue(null) },
        // 3. Row continuity guard: max row
        { get: vi.fn().mockResolvedValue({ max_row: maxRow }) },
        // 4. Max display_order
        { get: vi.fn().mockResolvedValue({ max_order: 0 }) },
        // 5. INSERT storage area
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Garage', storage_type: 'rack', temp_zone: 'ambient', display_order: 1, colour_zone: 'red', created_at: '2026-01-01' }) },
        // 6. INSERT row
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );
    }

    it('accepts colour_zone in create body', async () => {
      mockCreateSuccess();

      const res = await request(app)
        .post('/storage-areas')
        .send({
          name: 'Garage',
          storage_type: 'rack',
          temp_zone: 'ambient',
          rows: [{ row_num: 20, col_count: 6 }],
          colour_zone: 'red'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.colour_zone).toBe('red');
    });

    it('defaults colour_zone to mixed when not provided', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ count: 0 }) },
        { get: vi.fn().mockResolvedValue(null) },
        { get: vi.fn().mockResolvedValue({ max_row: 0 }) },
        { get: vi.fn().mockResolvedValue({ max_order: -1 }) },
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Cellar', storage_type: 'cellar', temp_zone: 'cellar', display_order: 0, colour_zone: 'mixed', created_at: '2026-01-01' }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );

      const res = await request(app)
        .post('/storage-areas')
        .send({
          name: 'Cellar',
          storage_type: 'cellar',
          temp_zone: 'cellar',
          rows: [{ row_num: 1, col_count: 9 }]
        });

      expect(res.status).toBe(201);
      // INSERT should pass 'mixed' as colour_zone
      const insertCall = db.prepare.mock.calls.find(c => c[0].includes('INSERT INTO storage_areas'));
      expect(insertCall).toBeDefined();
    });

    it('rejects invalid colour_zone values', async () => {
      const res = await request(app)
        .post('/storage-areas')
        .send({
          name: 'Test',
          storage_type: 'cellar',
          temp_zone: 'cellar',
          rows: [{ row_num: 1, col_count: 9 }],
          colour_zone: 'purple'
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /storage-areas — row continuity guard (Fix D.4)', () => {
    it('rejects rows that overlap existing cellar rows', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ count: 1 }) }, // area count
        { get: vi.fn().mockResolvedValue(null) },          // unique name
        { get: vi.fn().mockResolvedValue({ max_row: 19 }) } // existing max row
      );

      const res = await request(app)
        .post('/storage-areas')
        .send({
          name: 'Garage',
          storage_type: 'rack',
          temp_zone: 'ambient',
          rows: [{ row_num: 15, col_count: 6 }] // overlaps rows 1-19
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Row numbers must be continuous');
      expect(res.body.current_max_row).toBe(19);
    });

    it('accepts rows that start after existing max', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ count: 1 }) },
        { get: vi.fn().mockResolvedValue(null) },
        { get: vi.fn().mockResolvedValue({ max_row: 19 }) }, // existing max
        { get: vi.fn().mockResolvedValue({ max_order: 0 }) },
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Garage', storage_type: 'rack', temp_zone: 'ambient', display_order: 1, colour_zone: 'mixed', created_at: '2026-01-01' }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );

      const res = await request(app)
        .post('/storage-areas')
        .send({
          name: 'Garage',
          storage_type: 'rack',
          temp_zone: 'ambient',
          rows: [{ row_num: 20, col_count: 6 }]
        });

      expect(res.status).toBe(201);
    });

    it('allows any rows when no existing rows in cellar', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ count: 0 }) },
        { get: vi.fn().mockResolvedValue(null) },
        { get: vi.fn().mockResolvedValue({ max_row: 0 }) }, // no existing rows
        { get: vi.fn().mockResolvedValue({ max_order: -1 }) },
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Main', storage_type: 'cellar', temp_zone: 'cellar', display_order: 0, colour_zone: 'mixed', created_at: '2026-01-01' }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );

      const res = await request(app)
        .post('/storage-areas')
        .send({
          name: 'Main',
          storage_type: 'cellar',
          temp_zone: 'cellar',
          rows: [{ row_num: 1, col_count: 9 }, { row_num: 2, col_count: 9 }]
        });

      expect(res.status).toBe(201);
    });
  });

  describe('PUT /storage-areas/:id — colour_zone', () => {
    it('accepts colour_zone update', async () => {
      mockPrepareSequence(
        // 1. Verify area exists
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },
        // 2. UPDATE query
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Main', colour_zone: 'white', updated_at: '2026-01-01' }) }
      );

      const res = await request(app)
        .put(`/storage-areas/${AREA_ID}`)
        .send({ colour_zone: 'white' });

      expect(res.status).toBe(200);
      const updateSql = db.prepare.mock.calls.find(c => c[0].includes('UPDATE storage_areas'));
      expect(updateSql[0]).toContain('colour_zone');
    });

    it('includes colour_zone in RETURNING clause', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Garage', colour_zone: 'red', updated_at: '2026-01-01' }) }
      );

      const res = await request(app)
        .put(`/storage-areas/${AREA_ID}`)
        .send({ colour_zone: 'red' });

      expect(res.status).toBe(200);
      expect(res.body.data.colour_zone).toBe('red');
    });

    it('rejects invalid colour_zone in update', async () => {
      const res = await request(app)
        .put(`/storage-areas/${AREA_ID}`)
        .send({ colour_zone: 'blue' });

      expect(res.status).toBe(400);
    });

    it('uses correct parameter indices in WHERE clause', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Main', colour_zone: 'red', updated_at: '2026-01-01' }) }
      );

      await request(app)
        .put(`/storage-areas/${AREA_ID}`)
        .send({ colour_zone: 'red' });

      const updateCall = db.prepare.mock.calls.find(c => c[0].includes('UPDATE storage_areas'));
      // With 1 field (colour_zone = $1), id should be $2, cellar_id should be $3
      expect(updateCall[0]).toContain('WHERE id = $2 AND cellar_id = $3');
    });

    it('uses correct parameter indices with multiple fields', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },
        { get: vi.fn().mockResolvedValue(null) }, // name uniqueness check
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Updated', colour_zone: 'white', updated_at: '2026-01-01' }) }
      );

      await request(app)
        .put(`/storage-areas/${AREA_ID}`)
        .send({ name: 'Updated', colour_zone: 'white' });

      const updateCall = db.prepare.mock.calls.find(c => c[0].includes('UPDATE storage_areas'));
      // With 2 fields (name = $1, colour_zone = $2), id should be $3, cellar_id should be $4
      expect(updateCall[0]).toContain('WHERE id = $3 AND cellar_id = $4');
    });
  });

  describe('POST /storage-areas — slot provisioning', () => {
    it('calls syncStorageAreaSlots after creating area + rows', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ count: 0 }) },           // area count
        { get: vi.fn().mockResolvedValue(null) },                    // name check
        { get: vi.fn().mockResolvedValue({ max_row: 0 }) },         // row continuity
        { get: vi.fn().mockResolvedValue({ max_order: -1 }) },      // max display_order
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Cellar', storage_type: 'cellar', temp_zone: 'cellar', display_order: 0, colour_zone: 'mixed', created_at: '2026-01-01' }) }, // INSERT area
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }          // INSERT row
      );

      const res = await request(app)
        .post('/storage-areas')
        .send({ name: 'Cellar', storage_type: 'cellar', temp_zone: 'cellar', rows: [{ row_num: 1, col_count: 9 }] });

      expect(res.status).toBe(201);
      expect(syncStorageAreaSlots).toHaveBeenCalledOnce();
      expect(syncStorageAreaSlots).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar' })
      );
    });

    it('calls resequenceFridgeSlots when creating a fridge-type area', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ count: 0 }) },
        { get: vi.fn().mockResolvedValue(null) },
        { get: vi.fn().mockResolvedValue({ max_row: 0 }) },
        { get: vi.fn().mockResolvedValue({ max_order: -1 }) },
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Fridge', storage_type: 'wine_fridge', temp_zone: 'cool', display_order: 0, colour_zone: 'mixed', created_at: '2026-01-01' }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );

      const res = await request(app)
        .post('/storage-areas')
        .send({ name: 'Fridge', storage_type: 'wine_fridge', temp_zone: 'cool', rows: [{ row_num: 1, col_count: 6 }] });

      expect(res.status).toBe(201);
      expect(resequenceFridgeSlots).toHaveBeenCalledOnce();
      expect(resequenceFridgeSlots).toHaveBeenCalledWith(expect.anything(), CELLAR_ID);
    });

    it('does NOT call resequenceFridgeSlots for non-fridge type', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ count: 0 }) },
        { get: vi.fn().mockResolvedValue(null) },
        { get: vi.fn().mockResolvedValue({ max_row: 0 }) },
        { get: vi.fn().mockResolvedValue({ max_order: -1 }) },
        { get: vi.fn().mockResolvedValue({ id: AREA_ID, name: 'Rack', storage_type: 'rack', temp_zone: 'ambient', display_order: 0, colour_zone: 'mixed', created_at: '2026-01-01' }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );

      await request(app)
        .post('/storage-areas')
        .send({ name: 'Rack', storage_type: 'rack', temp_zone: 'ambient', rows: [{ row_num: 1, col_count: 6 }] });

      expect(resequenceFridgeSlots).not.toHaveBeenCalled();
    });
  });

  describe('PUT /storage-areas/:id/layout — slot provisioning', () => {
    it('calls syncStorageAreaSlots after updating layout', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },                          // area exists
        { all: vi.fn().mockResolvedValue([]) },                                        // other area rows
        { all: vi.fn().mockResolvedValue([{ row_num: 1, col_count: 6 }]) },           // current rows
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },                           // DELETE rows
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },                           // INSERT row
        { get: vi.fn().mockResolvedValue({ storage_type: 'cellar' }) }                // SELECT storage_type
      );

      const res = await request(app)
        .put(`/storage-areas/${AREA_ID}/layout`)
        .send({ rows: [{ row_num: 1, col_count: 9 }] });

      expect(res.status).toBe(200);
      expect(syncStorageAreaSlots).toHaveBeenCalledOnce();
      expect(syncStorageAreaSlots).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cellarId: CELLAR_ID, areaId: AREA_ID, storageType: 'cellar' })
      );
    });

    it('calls resequenceFridgeSlots when updating a fridge area layout', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },
        { all: vi.fn().mockResolvedValue([]) },
        { all: vi.fn().mockResolvedValue([{ row_num: 1, col_count: 4 }]) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },
        { get: vi.fn().mockResolvedValue({ storage_type: 'wine_fridge' }) }
      );

      await request(app)
        .put(`/storage-areas/${AREA_ID}/layout`)
        .send({ rows: [{ row_num: 1, col_count: 6 }] });

      expect(resequenceFridgeSlots).toHaveBeenCalledOnce();
      expect(resequenceFridgeSlots).toHaveBeenCalledWith(expect.anything(), CELLAR_ID);
    });
  });

  describe('DELETE /storage-areas/:id', () => {
    it('deletes area and returns 200', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ name: 'Old Cellar', storage_type: 'cellar' }) }, // area exists
        { get: vi.fn().mockResolvedValue({ count: 0 }) },                                    // no occupied slots
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }                                   // DELETE
      );

      const res = await request(app).delete(`/storage-areas/${AREA_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Old Cellar');
    });

    it('returns 409 when area contains wines', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ name: 'Full Cellar', storage_type: 'cellar' }) },
        { get: vi.fn().mockResolvedValue({ count: 5 }) }  // 5 occupied slots
      );

      const res = await request(app).delete(`/storage-areas/${AREA_ID}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('5 wine(s)');
    });

    it('calls resequenceFridgeSlots when deleting a fridge area', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ name: 'Wine Fridge', storage_type: 'wine_fridge' }) },
        { get: vi.fn().mockResolvedValue({ count: 0 }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );

      await request(app).delete(`/storage-areas/${AREA_ID}`);

      expect(resequenceFridgeSlots).toHaveBeenCalledOnce();
      expect(resequenceFridgeSlots).toHaveBeenCalledWith(expect.anything(), CELLAR_ID);
    });

    it('does NOT call resequenceFridgeSlots when deleting a cellar-type area', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue({ name: 'Old Cellar', storage_type: 'cellar' }) },
        { get: vi.fn().mockResolvedValue({ count: 0 }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) }
      );

      await request(app).delete(`/storage-areas/${AREA_ID}`);

      expect(resequenceFridgeSlots).not.toHaveBeenCalled();
    });

    it('returns 404 when area not found', async () => {
      mockPrepareSequence(
        { get: vi.fn().mockResolvedValue(null) }
      );

      const res = await request(app).delete(`/storage-areas/${AREA_ID}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /storage-areas/:id/layout — row overlap guard', () => {
    it('rejects rows that overlap other areas', async () => {
      mockPrepareSequence(
        // 1. Verify area exists
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },
        // 2. Other areas row query → rows 1-5 belong to another area
        { all: vi.fn().mockResolvedValue([{ row_num: 1 }, { row_num: 2 }, { row_num: 3 }, { row_num: 4 }, { row_num: 5 }]) }
      );

      const res = await request(app)
        .put(`/storage-areas/${AREA_ID}/layout`)
        .send({ rows: [{ row_num: 3, col_count: 9 }, { row_num: 6, col_count: 9 }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('overlap');
      expect(res.body.overlapping_rows).toEqual([3]);
    });

    it('accepts rows that do not overlap other areas', async () => {
      mockPrepareSequence(
        // 1. Verify area exists (pre-txn)
        { get: vi.fn().mockResolvedValue({ id: AREA_ID }) },
        // 2. Other areas row query → rows 1-5 belong to another area (pre-txn)
        { all: vi.fn().mockResolvedValue([{ row_num: 1 }, { row_num: 2 }, { row_num: 3 }, { row_num: 4 }, { row_num: 5 }]) },
        // 3. Current rows for this area (pre-txn)
        { all: vi.fn().mockResolvedValue([{ row_num: 6, col_count: 6 }]) },
        // 4. DELETE old rows (in txn)
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },
        // 5. INSERT new rows (in txn)
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },
        { run: vi.fn().mockResolvedValue({ changes: 1 }) },
        // 6. SELECT storage_type for sync decision (in txn)
        { get: vi.fn().mockResolvedValue({ storage_type: 'cellar' }) }
      );

      const res = await request(app)
        .put(`/storage-areas/${AREA_ID}/layout`)
        .send({ rows: [{ row_num: 6, col_count: 9 }, { row_num: 7, col_count: 9 }] });

      expect(res.status).toBe(200);
    });
  });
});
