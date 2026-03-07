/**
 * @fileoverview Unit tests for slots route — area ID threading.
 * Verifies that storage_area_id is included in slot queries (Phase 1 threading).
 * @module tests/unit/routes/slots.test
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const { mockResolveAreaFromSlot, mockResolveStorageAreaId } = vi.hoisted(() => ({
  mockResolveAreaFromSlot: vi.fn(),
  mockResolveStorageAreaId: vi.fn()
}));

vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    transaction: vi.fn()
  }
}));

vi.mock('../../../src/services/cellar/storageAreaResolver.js', () => ({
  resolveAreaFromSlot: mockResolveAreaFromSlot,
  resolveStorageAreaId: mockResolveStorageAreaId
}));

vi.mock('../../../src/services/shared/cacheService.js', () => ({
  invalidateAnalysisCache: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/pairing/pairingSession.js', () => ({
  findRecentSessionForWine: vi.fn().mockResolvedValue(null),
  linkConsumption: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/recipe/buyingGuide.js', () => ({
  invalidateBuyingGuideCache: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/zone/reconfigChangeTracker.js', () => ({
  incrementBottleChangeCount: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/cellar/cellarAllocation.js', () => ({
  adjustZoneCountAfterBottleCrud: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/cellar/cellarMetrics.js', () => ({
  parseSlot: vi.fn().mockReturnValue({ row: 1, col: 1 }),
  detectRowGaps: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../src/services/shared/cellarLayoutSettings.js', () => ({
  getCellarLayoutSettings: vi.fn().mockResolvedValue({ totalRows: 19 })
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import express from 'express';
import request from 'supertest';
import slotsRouter from '../../../src/routes/slots.js';
import db from '../../../src/db/index.js';

const AREA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const CELLAR_ID = 42;

function createApp(cellarId = CELLAR_ID) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = cellarId; next(); });
  app.use('/slots', slotsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('POST /slots/move — area ID threading', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAreaFromSlot.mockResolvedValue(AREA_ID);
    mockResolveStorageAreaId.mockResolvedValue({ id: AREA_ID });

    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation((...args) => {
        // Source slot has a wine; target slot is empty
        if (sql.includes('location_code = $2') && args[1] === 'R1C1') {
          return Promise.resolve({ wine_id: 5 });
        }
        return Promise.resolve({ wine_id: null });
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    }));

    db.transaction.mockImplementation(async (fn) => {
      await fn({ query: vi.fn().mockResolvedValue({}) });
    });
  });

  it('uses provided area IDs in slot SELECT queries', async () => {
    const res = await request(app)
      .post('/slots/move')
      .send({
        from_location: 'R1C1',
        to_location: 'R2C1',
        from_storage_area_id: AREA_ID,
        to_storage_area_id: AREA_ID
      });

    expect(res.status).toBe(200);
    // resolveAreaFromSlot should NOT be called when area IDs are provided
    expect(mockResolveAreaFromSlot).not.toHaveBeenCalled();
  });

  it('falls back to resolveAreaFromSlot when area IDs are omitted', async () => {
    await request(app)
      .post('/slots/move')
      .send({ from_location: 'R1C1', to_location: 'R2C1' });

    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R1C1');
    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R2C1');
  });

  it('includes storage_area_id in SELECT query for source slot', async () => {
    await request(app)
      .post('/slots/move')
      .send({
        from_location: 'R1C1',
        to_location: 'R2C1',
        from_storage_area_id: AREA_ID,
        to_storage_area_id: AREA_ID
      });

    const sqls = db.prepare.mock.calls.map(c => c[0]);
    const sourceSelect = sqls.find(s => s.includes('SELECT wine_id') && s.includes('storage_area_id'));
    expect(sourceSelect).toBeTruthy();
  });

  it('returns 400 when source slot is empty', async () => {
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ wine_id: null })
    });

    const res = await request(app)
      .post('/slots/move')
      .send({
        from_location: 'R1C1',
        to_location: 'R2C1',
        from_storage_area_id: AREA_ID,
        to_storage_area_id: AREA_ID
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty/i);
  });

  it('returns 400 when target slot is occupied', async () => {
    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({ wine_id: 99 }) // Both slots occupied
    }));

    const res = await request(app)
      .post('/slots/move')
      .send({
        from_location: 'R1C1',
        to_location: 'R2C1',
        from_storage_area_id: AREA_ID,
        to_storage_area_id: AREA_ID
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/occupied/i);
  });

  it('returns 422 when from_location equals to_location', async () => {
    const res = await request(app)
      .post('/slots/move')
      .send({ from_location: 'R1C1', to_location: 'R1C1' });

    expect(res.status).toBe(400);
  });
});

describe('POST /slots/direct-swap — area ID threading', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAreaFromSlot.mockResolvedValue(AREA_ID);
    mockResolveStorageAreaId.mockResolvedValue({ id: AREA_ID });

    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({ wine_id: 5 }),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    }));

    db.transaction.mockImplementation(async (fn) => {
      await fn({ query: vi.fn().mockResolvedValue({}) });
    });
  });

  it('uses provided area IDs without calling resolveAreaFromSlot', async () => {
    await request(app)
      .post('/slots/direct-swap')
      .send({
        slot_a: 'R1C1',
        slot_b: 'R2C1',
        slot_a_storage_area_id: AREA_ID,
        slot_b_storage_area_id: AREA_ID
      });

    expect(mockResolveAreaFromSlot).not.toHaveBeenCalled();
  });

  it('falls back to resolveAreaFromSlot when area IDs are omitted', async () => {
    await request(app)
      .post('/slots/direct-swap')
      .send({ slot_a: 'R1C1', slot_b: 'R2C1' });

    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R1C1');
    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R2C1');
  });

  it('includes storage_area_id in SELECT queries', async () => {
    await request(app)
      .post('/slots/direct-swap')
      .send({
        slot_a: 'R1C1',
        slot_b: 'R2C1',
        slot_a_storage_area_id: AREA_ID,
        slot_b_storage_area_id: AREA_ID
      });

    const sqls = db.prepare.mock.calls.map(c => c[0]);
    const areaAwareSelects = sqls.filter(s => s.includes('SELECT wine_id') && s.includes('storage_area_id'));
    expect(areaAwareSelects.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 422 when slot_a equals slot_b', async () => {
    const res = await request(app)
      .post('/slots/direct-swap')
      .send({ slot_a: 'R1C1', slot_b: 'R1C1' });

    expect(res.status).toBe(400);
  });
});

describe('POST /slots/:location/drink — area ID threading', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAreaFromSlot.mockResolvedValue(AREA_ID);
    mockResolveStorageAreaId.mockResolvedValue({ id: AREA_ID });

    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({ wine_id: 5 }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([])
    }));

    db.transaction.mockImplementation(async (fn) => {
      await fn({
        query: vi.fn().mockImplementation((sql) => {
          // COUNT query for remaining bottles
          if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '1' }] });
          return Promise.resolve({ rows: [], rowCount: 1 });
        })
      });
    });
  });

  it('uses provided storage_area_id without calling resolveAreaFromSlot', async () => {
    await request(app)
      .post('/slots/R1C1/drink')
      .send({ storage_area_id: AREA_ID });

    expect(mockResolveAreaFromSlot).not.toHaveBeenCalled();
  });

  it('calls resolveAreaFromSlot when storage_area_id is omitted', async () => {
    await request(app)
      .post('/slots/R1C1/drink')
      .send({});

    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R1C1');
  });

  it('includes storage_area_id in SELECT query before drink', async () => {
    await request(app)
      .post('/slots/R1C1/drink')
      .send({ storage_area_id: AREA_ID });

    // The drink route does a db.prepare SELECT to verify the slot before transacting
    const sqls = db.prepare.mock.calls.map(c => c[0]);
    const selectSql = sqls.find(s => s.includes('SELECT wine_id') && s.includes('storage_area_id'));
    expect(selectSql).toBeTruthy();
  });
});

describe('DELETE /slots/:location/remove — area ID threading', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAreaFromSlot.mockResolvedValue(AREA_ID);
    mockResolveStorageAreaId.mockResolvedValue({ id: AREA_ID });

    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({ wine_id: 5 }),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    }));
  });

  it('always calls resolveAreaFromSlot (no body param for remove)', async () => {
    await request(app)
      .delete('/slots/R1C1/remove');

    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R1C1');
  });

  it('includes storage_area_id in UPDATE query', async () => {
    await request(app)
      .delete('/slots/R1C1/remove');

    const sqls = db.prepare.mock.calls.map(c => c[0]);
    const updateSql = sqls.find(s =>
      (s.includes('UPDATE slots') || s.includes('wine_id = NULL')) &&
      s.includes('storage_area_id')
    );
    expect(updateSql).toBeTruthy();
  });
});
