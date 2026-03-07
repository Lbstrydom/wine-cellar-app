/**
 * @fileoverview Unit tests for cellarReconfiguration execute-moves area ID threading.
 * Verifies that from_storage_area_id / to_storage_area_id are resolved and threaded
 * into the two-phase move transaction.
 * @module tests/unit/routes/cellarReconfiguration.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockResolveAreaFromSlot, mockValidateMovePlan } = vi.hoisted(() => ({
  mockResolveAreaFromSlot: vi.fn(),
  mockValidateMovePlan: vi.fn()
}));

vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn(), transaction: vi.fn() }
}));

vi.mock('../../../src/services/cellar/storageAreaResolver.js', () => ({
  resolveAreaFromSlot: mockResolveAreaFromSlot
}));

vi.mock('../../../src/services/cellar/movePlanner.js', () => ({
  validateMovePlan: mockValidateMovePlan
}));

// Stub out all the heavy dependencies this route imports
vi.mock('../../../src/config/cellarZones.js', () => ({
  getZoneById: vi.fn().mockReturnValue(null),
  BUFFER_ZONE_IDS: []
}));

vi.mock('../../../src/services/shared/cellarLayoutSettings.js', () => ({
  isWhiteFamily: vi.fn().mockReturnValue(false),
  getCellarLayoutSettings: vi.fn().mockResolvedValue({ totalRows: 19 }),
  getDynamicColourRowRanges: vi.fn().mockResolvedValue(null),
  TOTAL_ROWS: 19
}));

vi.mock('../../../src/services/shared/cacheService.js', () => ({
  invalidateAnalysisCache: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/cellar/layoutProposer.js', () => ({
  proposeIdealLayout: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../src/services/cellar/layoutSorter.js', () => ({
  computeSortPlan: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../src/services/zone/reconfigurationTables.js', () => ({
  ensureReconfigurationTables: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/zone/reconfigurationPlanStore.js', () => ({
  putPlan: vi.fn().mockResolvedValue(),
  getPlan: vi.fn().mockResolvedValue(null),
  deletePlan: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/zone/zoneReconfigurationPlanner.js', () => ({
  generateReconfigurationPlan: vi.fn().mockResolvedValue({ moves: [] })
}));

vi.mock('../../../src/services/cellar/cellarMetrics.js', () => ({
  detectColourOrderViolations: vi.fn().mockResolvedValue([]),
  getEffectiveZoneColour: vi.fn().mockReturnValue('any')
}));

vi.mock('../../../src/services/cellar/cellarSuggestions.js', () => ({
  getCurrentZoneAllocation: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../src/routes/cellar.js', () => ({
  getAllWinesWithSlots: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../src/routes/cellarAnalysis.js', () => ({
  runAnalysis: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../src/services/zone/reconfigChangeTracker.js', () => ({
  checkReconfigThreshold: vi.fn().mockResolvedValue({ exceeded: false }),
  resetBottleChangeCount: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import express from 'express';
import request from 'supertest';
import cellarReconfigRouter from '../../../src/routes/cellarReconfiguration.js';
import db from '../../../src/db/index.js';

const AREA_ID = 'area-uuid-aaaa-bbbb-cccc-dddddddddddd';
const CELLAR_ID = 'cellar-1234';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = CELLAR_ID; next(); });
  app.use('/cellar', cellarReconfigRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

/**
 * Build a transaction mock that captures the SQL queries sent via client.query().
 */
function buildTransactionMock(overrides = {}) {
  const capturedQueries = [];

  db.transaction.mockImplementation(async (fn) => {
    const client = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        capturedQueries.push({ sql, params });

        // SELECT … FOR UPDATE: return locked slot rows with storage_area_id
        if (sql.includes('FOR UPDATE')) {
          const allLocations = params?.[1] || [];
          return {
            rows: allLocations.map(loc => ({
              location_code: loc,
              storage_area_id: overrides.slotAreaIds?.[loc] ?? AREA_ID,
              wine_id: overrides.slotWineIds?.[loc] ?? 5
            }))
          };
        }

        // Bottle count queries
        if (sql.includes('COUNT(*)')) {
          return { rows: [{ count: overrides.bottleCount ?? '2' }] };
        }

        return { rows: [], rowCount: 1 };
      })
    };

    await fn(client);
    return capturedQueries;
  });

  return capturedQueries;
}

describe('POST /cellar/execute-moves — area ID resolution', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockResolveAreaFromSlot.mockResolvedValue(AREA_ID);

    // Default: validation passes
    mockValidateMovePlan.mockResolvedValue({
      valid: true,
      errors: [],
      summary: { totalMoves: 1, errorCount: 0 }
    });
  });

  it('uses provided from/to area IDs without calling resolveAreaFromSlot', async () => {
    buildTransactionMock({ slotWineIds: { 'R1C1': 5, 'R2C1': null } });

    await request(app)
      .post('/cellar/execute-moves')
      .send({
        moves: [{
          wineId: 5,
          wineName: 'Chianti',
          from: 'R1C1',
          to: 'R2C1',
          from_storage_area_id: AREA_ID,
          to_storage_area_id: AREA_ID
        }]
      });

    expect(mockResolveAreaFromSlot).not.toHaveBeenCalled();
  });

  it('calls resolveAreaFromSlot for each move when area IDs are omitted', async () => {
    buildTransactionMock({ slotWineIds: { 'R1C1': 5, 'R2C1': null } });

    await request(app)
      .post('/cellar/execute-moves')
      .send({
        moves: [{ wineId: 5, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' }]
      });

    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R1C1');
    expect(mockResolveAreaFromSlot).toHaveBeenCalledWith(CELLAR_ID, 'R2C1');
  });

  it('threads from_storage_area_id into Phase 1 (clear) UPDATE', async () => {
    const capturedQueries = buildTransactionMock({ slotWineIds: { 'R1C1': 5, 'R2C1': null } });

    await request(app)
      .post('/cellar/execute-moves')
      .send({
        moves: [{
          wineId: 5,
          wineName: 'Chianti',
          from: 'R1C1',
          to: 'R2C1',
          from_storage_area_id: AREA_ID,
          to_storage_area_id: AREA_ID
        }]
      });

    const clearQuery = capturedQueries.find(q =>
      q.sql?.includes('wine_id = NULL') || q.sql?.includes('SET wine_id = NULL')
    );
    expect(clearQuery).toBeTruthy();
    expect(clearQuery.params).toContain(AREA_ID);
  });

  it('threads to_storage_area_id into Phase 2 (place) UPDATE', async () => {
    const capturedQueries = buildTransactionMock({ slotWineIds: { 'R1C1': 5, 'R2C1': null } });

    await request(app)
      .post('/cellar/execute-moves')
      .send({
        moves: [{
          wineId: 5,
          wineName: 'Chianti',
          from: 'R1C1',
          to: 'R2C1',
          from_storage_area_id: AREA_ID,
          to_storage_area_id: AREA_ID
        }]
      });

    const placeQuery = capturedQueries.find(q =>
      q.sql?.includes('SET wine_id = $1') || q.sql?.includes('wine_id = $1')
    );
    expect(placeQuery).toBeTruthy();
    expect(placeQuery.params).toContain(AREA_ID);
  });

  it('returns 400 when moves array is empty', async () => {
    const res = await request(app)
      .post('/cellar/execute-moves')
      .send({ moves: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/moves array required/i);
  });

  it('returns 400 when validation fails', async () => {
    mockValidateMovePlan.mockResolvedValue({
      valid: false,
      errors: [{ type: 'source_mismatch', wineId: 5, fromSlot: 'R1C1' }],
      summary: { totalMoves: 1, errorCount: 1 }
    });

    const res = await request(app)
      .post('/cellar/execute-moves')
      .send({
        moves: [{ wineId: 5, from: 'R1C1', to: 'R2C1' }]
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.validation).toBeDefined();
  });

  it('resolves area IDs for multiple moves independently', async () => {
    mockResolveAreaFromSlot
      .mockResolvedValueOnce('area-aaa')
      .mockResolvedValueOnce('area-bbb')
      .mockResolvedValueOnce('area-ccc')
      .mockResolvedValueOnce('area-ddd');

    buildTransactionMock({
      slotWineIds: { 'R1C1': 5, 'R2C1': null, 'R3C1': 7, 'R4C1': null }
    });

    mockValidateMovePlan.mockResolvedValue({
      valid: true,
      errors: [],
      summary: { totalMoves: 2, errorCount: 0 }
    });

    await request(app)
      .post('/cellar/execute-moves')
      .send({
        moves: [
          { wineId: 5, wineName: 'Chianti', from: 'R1C1', to: 'R2C1' },
          { wineId: 7, wineName: 'Barolo', from: 'R3C1', to: 'R4C1' }
        ]
      });

    // resolveAreaFromSlot called 4 times (from+to for each move)
    expect(mockResolveAreaFromSlot).toHaveBeenCalledTimes(4);
  });

  describe('Phase 2 Fix C: Phase 0 lock includes storage_area_id', () => {
    it('FOR UPDATE query selects storage_area_id', async () => {
      const capturedQueries = buildTransactionMock({ slotWineIds: { 'R1C1': 5, 'R2C1': null } });

      await request(app)
        .post('/cellar/execute-moves')
        .send({
          moves: [{
            wineId: 5,
            wineName: 'Chianti',
            from: 'R1C1',
            to: 'R2C1',
            from_storage_area_id: AREA_ID,
            to_storage_area_id: AREA_ID
          }]
        });

      const lockQuery = capturedQueries.find(q => q.sql?.includes('FOR UPDATE'));
      expect(lockQuery).toBeTruthy();
      expect(lockQuery.sql).toContain('storage_area_id');
    });

    it('snapshot uses composite areaId:locationCode keys', async () => {
      const GARAGE_AREA = 'area-uuid-garage-1111-2222-333333333333';

      // Override to give different area IDs per location
      buildTransactionMock({
        slotWineIds: { 'R1C1': 5, 'R20C1': null },
        slotAreaIds: { 'R1C1': AREA_ID, 'R20C1': GARAGE_AREA }
      });

      const res = await request(app)
        .post('/cellar/execute-moves')
        .send({
          moves: [{
            wineId: 5,
            wineName: 'Chianti',
            from: 'R1C1',
            to: 'R20C1',
            from_storage_area_id: AREA_ID,
            to_storage_area_id: GARAGE_AREA
          }]
        });

      // Move should succeed — composite keys match the provided area IDs
      expect(res.status).toBe(200);
    });

    it('revalidation detects source mismatch via composite key', async () => {
      const WRONG_AREA = 'area-uuid-wrong-1111-2222-333333333333';

      // Lock returns R1C1 with AREA_ID, but move claims from_storage_area_id = WRONG_AREA
      // The composite key won't match, but location exists — falls through to location-based check
      buildTransactionMock({
        slotWineIds: { 'R1C1': 99, 'R2C1': null }, // wine 99, not 5
        slotAreaIds: { 'R1C1': AREA_ID, 'R2C1': AREA_ID }
      });

      const res = await request(app)
        .post('/cellar/execute-moves')
        .send({
          moves: [{
            wineId: 5,
            wineName: 'Chianti',
            from: 'R1C1',
            to: 'R2C1',
            from_storage_area_id: WRONG_AREA,
            to_storage_area_id: AREA_ID
          }]
        });

      // Should fail because the composite key doesn't match AND the actual wine differs
      expect(res.status).toBe(409);
    });
  });
});
