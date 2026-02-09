/**
 * @fileoverview Tests for bottles route cellar isolation (Phase 1.2 security fix).
 * Verifies that slot queries include cellar_id filtering to prevent cross-tenant access.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

import express from 'express';
import request from 'supertest';
import bottlesRouter from '../../../src/routes/bottles.js';
import db from '../../../src/db/index.js';

/**
 * Create app with a specific cellarId injected.
 * @param {number} cellarId - Cellar ID to inject via middleware
 */
function createApp(cellarId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = cellarId; next(); });
  app.use('/bottles', bottlesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('POST /bottles/add — cellar isolation (Phase 1.2)', () => {
  let app;
  let preparedQueries;

  beforeAll(() => { app = createApp(42); });

  beforeEach(() => {
    vi.clearAllMocks();
    preparedQueries = [];

    db.prepare.mockImplementation((sql) => {
      const entry = { sql, args: null };
      preparedQueries.push(entry);

      return {
        get: vi.fn((...args) => {
          entry.args = args;
          // Wine existence check — return a wine for cellar 42
          if (sql.includes('SELECT id FROM wines')) {
            return Promise.resolve({ id: 1 });
          }
          return Promise.resolve(null);
        }),
        all: vi.fn((...args) => {
          entry.args = args;
          // Slot query — return matching empty slots
          if (sql.includes('SELECT location_code')) {
            return Promise.resolve([
              { location_code: 'F1', wine_id: null },
              { location_code: 'F2', wine_id: null },
            ]);
          }
          return Promise.resolve([]);
        }),
        run: vi.fn((...args) => {
          entry.args = args;
          return Promise.resolve({ changes: 1 });
        }),
      };
    });
  });

  it('SELECT query includes cellar_id parameter', async () => {
    await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    const selectQuery = preparedQueries.find(q => q.sql.includes('SELECT location_code'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery.sql).toContain('cellar_id = $1');
    // cellar_id (42) should be the first argument
    expect(selectQuery.args[0]).toBe(42);
  });

  it('UPDATE query includes cellar_id parameter', async () => {
    await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    const updateQueries = preparedQueries.filter(q => q.sql.includes('UPDATE slots'));
    expect(updateQueries.length).toBeGreaterThan(0);

    for (const uq of updateQueries) {
      expect(uq.sql).toContain('cellar_id = $3');
      // cellar_id (42) should be the third argument
      expect(uq.args[2]).toBe(42);
    }
  });

  it('two cellars with the same location code are isolated', async () => {
    // Cellar A (42) has F1 empty
    const appA = createApp(42);
    // Cellar B (99) also has F1 empty
    const appB = createApp(99);

    await request(appA)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    await request(appB)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    // Collect all SELECT queries — each should have its own cellar_id
    const selectQueries = preparedQueries.filter(q =>
      q.sql.includes('SELECT location_code') && q.sql.includes('cellar_id')
    );

    const cellarIds = selectQueries.map(q => q.args[0]);
    expect(cellarIds).toContain(42);
    expect(cellarIds).toContain(99);

    // Collect all UPDATE queries — each should have its own cellar_id
    const updateQueries = preparedQueries.filter(q =>
      q.sql.includes('UPDATE slots') && q.sql.includes('cellar_id')
    );

    const updateCellarIds = updateQueries.map(q => q.args[2]);
    expect(updateCellarIds).toContain(42);
    expect(updateCellarIds).toContain(99);
  });
});

describe('POST /bottles/add — validation', () => {
  let app;

  beforeAll(() => { app = createApp(1); });

  beforeEach(() => {
    vi.clearAllMocks();
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ id: 1 }),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    });
  });

  it('rejects missing wine_id', async () => {
    const res = await request(app)
      .post('/bottles/add')
      .send({ start_location: 'F1', quantity: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects invalid location format', async () => {
    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'X99', quantity: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects quantity over 50', async () => {
    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 51 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when wine not found in cellar', async () => {
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 999, start_location: 'F1', quantity: 1 });
    expect(res.status).toBe(404);
  });
});
