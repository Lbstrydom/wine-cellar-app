/**
 * @fileoverview Tests for POST /api/cellar/execute-moves route.
 * Verifies swap execution, invariant checks, and error handling.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// ── Mocks (before any module imports) ───────────────────────────────

vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    transaction: vi.fn()
  }
}));

vi.mock('../../../src/services/cellar/movePlanner.js', () => ({
  validateMovePlan: vi.fn()
}));

vi.mock('../../../src/services/shared/cacheService.js', () => ({
  invalidateAnalysisCache: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../src/services/cellar/layoutProposer.js', () => ({
  proposeIdealLayout: vi.fn()
}));

vi.mock('../../../src/services/cellar/layoutSorter.js', () => ({
  computeSortPlan: vi.fn()
}));

vi.mock('../../../src/services/zone/reconfigurationTables.js', () => ({
  ensureReconfigurationTables: vi.fn()
}));

vi.mock('../../../src/services/zone/reconfigurationPlanStore.js', () => ({
  putPlan: vi.fn(),
  getPlan: vi.fn(),
  deletePlan: vi.fn()
}));

vi.mock('../../../src/services/zone/zoneReconfigurationPlanner.js', () => ({
  generateReconfigurationPlan: vi.fn()
}));

vi.mock('../../../src/services/cellar/cellarMetrics.js', () => ({
  detectColourOrderViolations: vi.fn(),
  getEffectiveZoneColor: vi.fn()
}));

vi.mock('../../../src/services/cellar/cellarSuggestions.js', () => ({
  getCurrentZoneAllocation: vi.fn()
}));

vi.mock('../../../src/config/cellarZones.js', () => ({
  getZoneById: vi.fn()
}));

vi.mock('../../../src/services/shared/cellarLayoutSettings.js', () => ({
  isWhiteFamily: vi.fn(),
  getCellarLayoutSettings: vi.fn(() => ({})),
  getDynamicColourRowRanges: vi.fn()
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../src/routes/cellar.js', () => ({
  getAllWinesWithSlots: vi.fn()
}));

vi.mock('../../../src/routes/cellarAnalysis.js', () => ({
  runAnalysis: vi.fn()
}));

// ── Imports ─────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import db from '../../../src/db/index.js';
import { validateMovePlan } from '../../../src/services/cellar/movePlanner.js';
import { invalidateAnalysisCache } from '../../../src/services/shared/cacheService.js';
import logger from '../../../src/utils/logger.js';

// Import route (must be after mocks)
import cellarReconfigurationRouter from '../../../src/routes/cellarReconfiguration.js';

// ── Helpers ─────────────────────────────────────────────────────────

const CELLAR_ID = 'test-cellar-uuid-123';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cellarId = CELLAR_ID;
    req.cellarRole = 'owner';
    next();
  });
  app.use('/', cellarReconfigurationRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

/**
 * Create a mock pg client for db.transaction().
 * Tracks all queries executed within the transaction.
 */
function createMockClient(slotState = new Map()) {
  const queries = [];
  const state = new Map(slotState); // mutable copy

  return {
    queries,
    state,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });

      // COUNT query (invariant check)
      if (sql.includes('COUNT(*)')) {
        let count = 0;
        for (const wineId of state.values()) {
          if (wineId !== null) count++;
        }
        return { rows: [{ count: String(count) }], rowCount: 1 };
      }

      // UPDATE slots SET wine_id = $1
      if (sql.includes('UPDATE slots SET wine_id')) {
        const wineId = params[0];
        const locationCode = params[2];
        if (state.has(locationCode)) {
          state.set(locationCode, wineId);
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // UPDATE wines SET zone_id
      if (sql.includes('UPDATE wines SET zone_id')) {
        return { rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    })
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('POST /execute-moves', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Input Validation ──────────────────────────────────────────────

  describe('input validation', () => {
    it('rejects empty body', async () => {
      const res = await request(app)
        .post('/execute-moves')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Moves array required/i);
    });

    it('rejects non-array moves', async () => {
      const res = await request(app)
        .post('/execute-moves')
        .send({ moves: 'not-an-array' });

      expect(res.status).toBe(400);
    });

    it('rejects empty moves array', async () => {
      const res = await request(app)
        .post('/execute-moves')
        .send({ moves: [] });

      expect(res.status).toBe(400);
    });
  });

  // ── Validation Failures ───────────────────────────────────────────

  describe('validation failures', () => {
    it('returns 400 when validation finds errors', async () => {
      validateMovePlan.mockResolvedValue({
        valid: false,
        errors: [{ type: 'source_mismatch', message: 'Wine not found at R3C5' }],
        summary: { totalMoves: 1, errorCount: 1, sourceMismatches: 1, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      const res = await request(app)
        .post('/execute-moves')
        .send({ moves: [{ wineId: 1, from: 'R3C5', to: 'R7C2' }] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.validation.errors).toHaveLength(1);
    });

    it('returns 500 when validation throws', async () => {
      validateMovePlan.mockRejectedValue(new Error('DB connection lost'));

      const res = await request(app)
        .post('/execute-moves')
        .send({ moves: [{ wineId: 1, from: 'R3C5', to: 'R7C2' }] });

      expect(res.status).toBe(500);
      expect(res.body.phase).toBe('validation');
      expect(res.body.error).toMatch(/DB connection lost/);
    });
  });

  // ── Successful Swap ───────────────────────────────────────────────

  describe('swap execution', () => {
    it('executes a simple swap (A↔B) atomically', async () => {
      // Setup: Wine 10 at R3C5, Wine 20 at R7C2
      const slotState = new Map([
        ['R3C5', 10],
        ['R7C2', 20],
        ['R1C1', 5] // other wine not involved in swap
      ]);
      const mockClient = createMockClient(slotState);

      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 2, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockImplementation(async (fn) => {
        return await fn(mockClient);
      });

      const res = await request(app)
        .post('/execute-moves')
        .send({
          moves: [
            { wineId: 10, wineName: 'Wine A', from: 'R3C5', to: 'R7C2' },
            { wineId: 20, wineName: 'Wine B', from: 'R7C2', to: 'R3C5' }
          ]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.moved).toBe(2);

      // Verify swap completed: Wine 10 is now at R7C2, Wine 20 at R3C5
      expect(mockClient.state.get('R7C2')).toBe(10);
      expect(mockClient.state.get('R3C5')).toBe(20);

      // Invariant: unchanged wine at R1C1 is still there
      expect(mockClient.state.get('R1C1')).toBe(5);

      // Cache was invalidated
      expect(invalidateAnalysisCache).toHaveBeenCalledWith(null, CELLAR_ID);
    });

    it('executes a single move to empty slot', async () => {
      const slotState = new Map([
        ['R3C5', 10],
        ['R7C2', null]
      ]);
      const mockClient = createMockClient(slotState);

      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 1, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockImplementation(async (fn) => fn(mockClient));

      const res = await request(app)
        .post('/execute-moves')
        .send({
          moves: [{ wineId: 10, wineName: 'Wine A', from: 'R3C5', to: 'R7C2' }]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.moved).toBe(1);

      // Wine moved from R3C5 to R7C2
      expect(mockClient.state.get('R3C5')).toBeNull();
      expect(mockClient.state.get('R7C2')).toBe(10);
    });

    it('updates wine zone assignment when zoneId provided', async () => {
      const slotState = new Map([
        ['R3C5', 10],
        ['R7C2', null]
      ]);
      const mockClient = createMockClient(slotState);

      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 1, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockImplementation(async (fn) => fn(mockClient));

      await request(app)
        .post('/execute-moves')
        .send({
          moves: [{ wineId: 10, from: 'R3C5', to: 'R7C2', zoneId: 'red-bold', confidence: 'high' }]
        });

      // Find the zone update query
      const zoneQuery = mockClient.queries.find(q => q.sql.includes('UPDATE wines SET zone_id'));
      expect(zoneQuery).toBeDefined();
      expect(zoneQuery.params).toEqual(['red-bold', 'high', CELLAR_ID, 10]);
    });
  });

  // ── Invariant Check ───────────────────────────────────────────────

  describe('invariant check', () => {
    it('fails transaction when bottle count decreases (missing target slot)', async () => {
      // Simulate: target slot doesn't exist → wine is "lost"
      const slotState = new Map([
        ['R3C5', 10]
        // R7C2 does NOT exist in slots table
      ]);
      const mockClient = createMockClient(slotState);

      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 1, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockImplementation(async (fn) => fn(mockClient));

      const res = await request(app)
        .post('/execute-moves')
        .send({
          moves: [{ wineId: 10, wineName: 'Wine A', from: 'R3C5', to: 'R7C2' }]
        });

      // Should fail because after moves, bottle count changed
      expect(res.status).toBe(500);
      expect(res.body.phase).toBe('transaction');
      expect(res.body.error).toMatch(/Invariant violation/);
    });

    it('passes invariant for swap (counts remain equal)', async () => {
      const slotState = new Map([
        ['R3C5', 10],
        ['R7C2', 20]
      ]);
      const mockClient = createMockClient(slotState);

      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 2, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockImplementation(async (fn) => fn(mockClient));

      const res = await request(app)
        .post('/execute-moves')
        .send({
          moves: [
            { wineId: 10, from: 'R3C5', to: 'R7C2' },
            { wineId: 20, from: 'R7C2', to: 'R3C5' }
          ]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── Transaction Error Handling ────────────────────────────────────

  describe('transaction error handling', () => {
    it('returns 500 with transaction phase when DB error occurs', async () => {
      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 1, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockRejectedValue(new Error('connection terminated'));

      const res = await request(app)
        .post('/execute-moves')
        .send({
          moves: [{ wineId: 10, from: 'R3C5', to: 'R7C2' }]
        });

      expect(res.status).toBe(500);
      expect(res.body.phase).toBe('transaction');
      expect(res.body.error).toMatch(/connection terminated/);
      expect(res.body.moveCount).toBe(1);
    });

    it('logs error details to logger', async () => {
      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 1, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockRejectedValue(new Error('unique constraint violation'));

      await request(app)
        .post('/execute-moves')
        .send({
          moves: [{ wineId: 10, from: 'R3C5', to: 'R7C2' }]
        });

      expect(logger.error).toHaveBeenCalledWith(
        'execute-moves',
        expect.stringContaining('unique constraint violation')
      );
    });
  });

  // ── Two-Phase Approach Correctness ────────────────────────────────

  describe('two-phase approach', () => {
    it('clears all sources before placing any targets (prevents overwrite)', async () => {
      const slotState = new Map([
        ['R3C5', 10],
        ['R7C2', 20]
      ]);
      const mockClient = createMockClient(slotState);
      const queryOrder = [];

      // Track the order of operations
      mockClient.query.mockImplementation(async (sql, params) => {
        if (sql.includes('UPDATE slots SET wine_id') && !sql.includes('COUNT')) {
          const wineId = params[0];
          const loc = params[2];
          queryOrder.push({ wineId, loc, phase: wineId === null ? 'clear' : 'place' });

          if (slotState.has(loc)) {
            slotState.set(loc, wineId);
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        }

        // COUNT query
        if (sql.includes('COUNT(*)')) {
          let count = 0;
          for (const v of slotState.values()) {
            if (v !== null) count++;
          }
          return { rows: [{ count: String(count) }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      });

      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 2, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockImplementation(async (fn) => fn(mockClient));

      await request(app)
        .post('/execute-moves')
        .send({
          moves: [
            { wineId: 10, from: 'R3C5', to: 'R7C2' },
            { wineId: 20, from: 'R7C2', to: 'R3C5' }
          ]
        });

      // Verify: all clears happen before any places
      const clearOps = queryOrder.filter(q => q.phase === 'clear');
      const placeOps = queryOrder.filter(q => q.phase === 'place');

      expect(clearOps).toHaveLength(2);
      expect(placeOps).toHaveLength(2);

      // clearOps should all appear before placeOps
      const firstPlaceIndex = queryOrder.findIndex(q => q.phase === 'place');
      const lastClearIndex = queryOrder.length - 1 - [...queryOrder].reverse().findIndex(q => q.phase === 'clear');
      expect(lastClearIndex).toBeLessThan(firstPlaceIndex);
    });
  });

  // ── Cellar Isolation ──────────────────────────────────────────────

  describe('cellar isolation', () => {
    it('passes cellarId to all DB queries', async () => {
      const slotState = new Map([
        ['R3C5', 10],
        ['R7C2', null]
      ]);
      const mockClient = createMockClient(slotState);

      validateMovePlan.mockResolvedValue({
        valid: true,
        errors: [],
        summary: { totalMoves: 1, errorCount: 0, sourceMismatches: 0, duplicateTargets: 0, occupiedTargets: 0, duplicateInstances: 0, noopMoves: 0, zoneColourViolations: 0 }
      });

      db.transaction.mockImplementation(async (fn) => fn(mockClient));

      await request(app)
        .post('/execute-moves')
        .send({
          moves: [{ wineId: 10, from: 'R3C5', to: 'R7C2' }]
        });

      // All queries should include the cellarId
      for (const q of mockClient.queries) {
        expect(q.params).toContain(CELLAR_ID);
      }

      // validateMovePlan should receive cellarId
      expect(validateMovePlan).toHaveBeenCalledWith(
        expect.any(Array),
        CELLAR_ID
      );
    });
  });
});
