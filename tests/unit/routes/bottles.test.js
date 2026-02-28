/**
 * @fileoverview Tests for bottles route:
 * - Cellar isolation (Phase 1.2)
 * - Adjacency-aware placement (Phase 6.2)
 * - Transactional writes + conflict handling (Phase 6.2)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Hoist mock functions so they're available to vi.mock factories
const { mockTransaction, mockWrapClient, mockFindAdjacent } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockWrapClient: vi.fn(),
  mockFindAdjacent: vi.fn()
}));

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    transaction: mockTransaction
  },
  wrapClient: mockWrapClient
}));

vi.mock('../../../src/services/cellar/cellarPlacement.js', () => ({
  findAdjacentToSameWine: mockFindAdjacent
}));

vi.mock('../../../src/services/cellar/cellarAllocation.js', () => ({
  adjustZoneCountAfterBottleCrud: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/shared/cacheService.js', () => ({
  invalidateAnalysisCache: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/recipe/buyingGuide.js', () => ({
  invalidateBuyingGuideCache: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/services/zone/reconfigChangeTracker.js', () => ({
  incrementBottleChangeCount: vi.fn().mockResolvedValue()
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

/**
 * Setup default db.prepare mock that routes queries based on SQL content.
 * Returns helpers to customise specific query results.
 */
function setupDbMock(opts = {}) {
  const {
    wineExists = true,
    emptySlots = [],
    sameWineSlots = [],
    rowOccupancy = [],
    transactionResult
  } = opts;

  db.prepare.mockImplementation((sql) => ({
    get: vi.fn((...args) => {
      if (sql.includes('SELECT id FROM wines')) {
        return Promise.resolve(wineExists ? { id: args[1] || 1 } : null);
      }
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve({ cnt: '0' });
      }
      return Promise.resolve(null);
    }),
    all: vi.fn((...args) => {
      // Slot occupancy for consecutive check
      if (sql.includes('SELECT location_code, wine_id FROM slots') && sql.includes('IN (')) {
        // If checking for same-wine bottles
        if (sql.includes('AND wine_id = $2')) {
          return Promise.resolve(sameWineSlots.map(loc => ({ location_code: loc })));
        }
        // Check if this is the zone band query (many slots) or the consecutive query
        if (args.length > 5) {
          // Zone band occupancy query
          return Promise.resolve(rowOccupancy);
        }
        // Consecutive empty slots query
        return Promise.resolve(emptySlots);
      }
      return Promise.resolve([]);
    }),
    run: vi.fn(() => Promise.resolve({ changes: 1 }))
  }));

  // Default transaction: execute the callback with a mock client
  mockTransaction.mockImplementation(async (fn) => {
    if (transactionResult !== undefined) return transactionResult;
    const mockClient = {};
    // Create a txDb mock from wrapClient
    const txDb = {
      prepare: vi.fn((sql) => ({
        get: vi.fn(() => Promise.resolve({ cnt: '0' })),
        run: vi.fn(() => Promise.resolve({ changes: 1 }))
      }))
    };
    mockWrapClient.mockReturnValue(txDb);
    return fn(mockClient);
  });
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
          if (sql.includes('SELECT id FROM wines')) {
            return Promise.resolve({ id: 1 });
          }
          return Promise.resolve(null);
        }),
        all: vi.fn((...args) => {
          entry.args = args;
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

    // Fridge uses consecutive fill, so transaction is called
    mockTransaction.mockImplementation(async (fn) => {
      let getCalls = 0;
      const txDb = {
        prepare: vi.fn((sql) => ({
          get: vi.fn(() => {
            getCalls++;
            // before=0, after=1 (added 1 bottle)
            return Promise.resolve({ cnt: getCalls === 1 ? '0' : '1' });
          }),
          run: vi.fn(() => Promise.resolve({ changes: 1 }))
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });
  });

  it('SELECT query includes cellar_id parameter', async () => {
    await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    const selectQuery = preparedQueries.find(q => q.sql.includes('SELECT location_code'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery.sql).toContain('cellar_id = $1');
    expect(selectQuery.args[0]).toBe(42);
  });

  it('two cellars with the same location code are isolated', async () => {
    const appA = createApp(42);
    const appB = createApp(99);

    await request(appA)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    await request(appB)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    const selectQueries = preparedQueries.filter(q =>
      q.sql.includes('SELECT location_code') && q.sql.includes('cellar_id')
    );

    const cellarIds = selectQueries.map(q => q.args[0]);
    expect(cellarIds).toContain(42);
    expect(cellarIds).toContain(99);
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
    mockTransaction.mockImplementation(async (fn) => {
      let getCalls = 0;
      const txDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => {
            getCalls++;
            return Promise.resolve({ cnt: getCalls === 1 ? '0' : '0' });
          }),
          run: vi.fn(() => Promise.resolve({ changes: 1 }))
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
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

// ───────────────────────────────────────────────────────────
// Phase 6.2: Adjacency-aware placement
// ───────────────────────────────────────────────────────────

describe('POST /bottles/add — adjacency placement (Phase 6.2)', () => {
  let app;

  beforeAll(() => { app = createApp(1); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAdjacent.mockReset();
  });

  it('uses adjacency when same wine already exists in cellar', async () => {
    let callCount = 0;
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn((...args) => {
        if (sql.includes('SELECT id FROM wines')) return Promise.resolve({ id: 5 });
        return Promise.resolve(null);
      }),
      all: vi.fn((...args) => {
        if (sql.includes('AND wine_id = $2')) {
          // Same wine query: wine_id=5 already has bottles at R3C1
          return Promise.resolve([{ location_code: 'R3C1' }]);
        }
        if (sql.includes('SELECT location_code, wine_id FROM slots') && sql.includes('IN (')) {
          if (args.length > 5) {
            // Zone band occupancy — R3C1 occupied, rest empty
            return Promise.resolve([
              { location_code: 'R3C1', wine_id: 5 },
              { location_code: 'R3C2', wine_id: null }
            ]);
          }
          // Consecutive empty slots at R3C5
          return Promise.resolve([
            { location_code: 'R3C5', wine_id: null }
          ]);
        }
        return Promise.resolve([]);
      }),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    // findAdjacentToSameWine returns R3C2 (adjacent to existing R3C1)
    mockFindAdjacent.mockReturnValue('R3C2');

    // Transaction mock: track what slots get filled
    const filledSlots = [];
    mockTransaction.mockImplementation(async (fn) => {
      let getCalls = 0;
      const txDb = {
        prepare: vi.fn((sql) => ({
          get: vi.fn(() => {
            getCalls++;
            // before=5, after=6 (added 1 bottle)
            return Promise.resolve({ cnt: getCalls === 1 ? '5' : '6' });
          }),
          run: vi.fn((...args) => {
            if (sql.includes('UPDATE slots SET wine_id')) filledSlots.push(args[1]);
            return Promise.resolve({ changes: 1 });
          })
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 5, start_location: 'R3C5', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockFindAdjacent).toHaveBeenCalled();
    // The response should indicate the adjacent slot was used
    expect(res.body.locations).toContain('R3C2');
  });

  it('falls back to consecutive fill for fridge locations', async () => {
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('SELECT id FROM wines')) return Promise.resolve({ id: 1 });
        return Promise.resolve(null);
      }),
      all: vi.fn(() => {
        if (sql.includes('SELECT location_code, wine_id FROM slots') && sql.includes('IN (')) {
          return Promise.resolve([
            { location_code: 'F1', wine_id: null },
            { location_code: 'F2', wine_id: null }
          ]);
        }
        return Promise.resolve([]);
      }),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    mockTransaction.mockImplementation(async (fn) => {
      let getCalls = 0;
      const txDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => {
            getCalls++;
            // before=10, after=12 (added 2 bottles)
            return Promise.resolve({ cnt: getCalls === 1 ? '10' : '12' });
          }),
          run: vi.fn(() => Promise.resolve({ changes: 1 }))
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 2 });

    expect(res.status).toBe(200);
    // findAdjacentToSameWine should NOT be called for fridge
    expect(mockFindAdjacent).not.toHaveBeenCalled();
    expect(res.body.locations).toEqual(['F1', 'F2']);
  });

  it('falls back to consecutive fill when no existing same-wine bottles', async () => {
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('SELECT id FROM wines')) return Promise.resolve({ id: 1 });
        return Promise.resolve(null);
      }),
      all: vi.fn(() => {
        if (sql.includes('AND wine_id = $2')) {
          // No existing bottles of this wine
          return Promise.resolve([]);
        }
        if (sql.includes('SELECT location_code, wine_id FROM slots') && sql.includes('IN (')) {
          return Promise.resolve([
            { location_code: 'R5C1', wine_id: null },
            { location_code: 'R5C2', wine_id: null }
          ]);
        }
        return Promise.resolve([]);
      }),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    mockTransaction.mockImplementation(async (fn) => {
      let getCalls = 0;
      const txDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => {
            getCalls++;
            // before=10, after=12 (added 2 bottles)
            return Promise.resolve({ cnt: getCalls === 1 ? '10' : '12' });
          }),
          run: vi.fn(() => Promise.resolve({ changes: 1 }))
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'R5C1', quantity: 2 });

    expect(res.status).toBe(200);
    expect(mockFindAdjacent).not.toHaveBeenCalled();
    expect(res.body.locations).toEqual(['R5C1', 'R5C2']);
  });

  it('falls back to consecutive fill when start_location row exceeds CELLAR_MAX_ROW (zoneRows guard)', async () => {
    // R25C1 is beyond CELLAR_MAX_ROW (19) → getZoneRowsForLocation returns []
    // Without the if (zoneRows.length > 0) guard, an empty IN () would produce invalid SQL → 500
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('SELECT id FROM wines')) return Promise.resolve({ id: 1 });
        return Promise.resolve(null);
      }),
      all: vi.fn(() => {
        if (sql.includes('AND wine_id = $2')) {
          // Existing same-wine bottle — triggers adjacency code path
          return Promise.resolve([{ location_code: 'R5C1' }]);
        }
        if (sql.includes('IN (')) {
          // Consecutive slot check for R25C1 — report it as empty
          return Promise.resolve([{ location_code: 'R25C1', wine_id: null }]);
        }
        return Promise.resolve([]);
      }),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    mockTransaction.mockImplementation(async (fn) => {
      let getCalls = 0;
      const txDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => {
            getCalls++;
            return Promise.resolve({ cnt: getCalls === 1 ? '5' : '6' });
          }),
          run: vi.fn(() => Promise.resolve({ changes: 1 }))
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'R25C1', quantity: 1 });

    expect(res.status).toBe(200);
    // findAdjacentToSameWine must NOT be called — zoneRows was [] (row 25 > CELLAR_MAX_ROW)
    expect(mockFindAdjacent).not.toHaveBeenCalled();
    expect(res.body.locations).toEqual(['R25C1']);
  });
});

// ───────────────────────────────────────────────────────────
// Phase 6.2: Transactional writes + conflict handling
// ───────────────────────────────────────────────────────────

describe('POST /bottles/add — transactional writes (Phase 6.2)', () => {
  let app;

  beforeAll(() => { app = createApp(1); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAdjacent.mockReset();
  });

  it('uses db.transaction() for slot fills', async () => {
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('SELECT id FROM wines')) return Promise.resolve({ id: 1 });
        return Promise.resolve(null);
      }),
      all: vi.fn(() => {
        if (sql.includes('SELECT location_code, wine_id FROM slots') && sql.includes('IN (')) {
          return Promise.resolve([
            { location_code: 'F1', wine_id: null }
          ]);
        }
        return Promise.resolve([]);
      }),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    mockTransaction.mockImplementation(async (fn) => {
      let getCalls = 0;
      const txDb = {
        prepare: vi.fn(() => ({
          get: vi.fn(() => {
            getCalls++;
            // before=5, after=6 (added 1 bottle)
            return Promise.resolve({ cnt: getCalls === 1 ? '5' : '6' });
          }),
          run: vi.fn(() => Promise.resolve({ changes: 1 }))
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('returns 409 when slot filled by concurrent request', async () => {
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('SELECT id FROM wines')) return Promise.resolve({ id: 1 });
        return Promise.resolve(null);
      }),
      all: vi.fn(() => {
        if (sql.includes('SELECT location_code, wine_id FROM slots') && sql.includes('IN (')) {
          return Promise.resolve([
            { location_code: 'F1', wine_id: null }
          ]);
        }
        return Promise.resolve([]);
      }),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    // Transaction fails because concurrent request filled the slot
    mockTransaction.mockImplementation(async (fn) => {
      const txDb = {
        prepare: vi.fn((sql) => ({
          get: vi.fn(() => Promise.resolve({ cnt: '5' })),
          run: vi.fn(() => {
            // Simulate: wine_id IS NULL guard fails — slot already filled
            return Promise.resolve({ changes: 0 });
          })
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('concurrent');
  });

  it('returns 409 on data integrity violation', async () => {
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('SELECT id FROM wines')) return Promise.resolve({ id: 1 });
        return Promise.resolve(null);
      }),
      all: vi.fn(() => {
        if (sql.includes('SELECT location_code, wine_id FROM slots') && sql.includes('IN (')) {
          return Promise.resolve([
            { location_code: 'F1', wine_id: null }
          ]);
        }
        return Promise.resolve([]);
      }),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    // Transaction: before count=5, fill 1 slot, but after count=7 (mismatch!)
    mockTransaction.mockImplementation(async (fn) => {
      let callCount = 0;
      const txDb = {
        prepare: vi.fn((sql) => ({
          get: vi.fn(() => {
            callCount++;
            // First call: before count=5, Second call: after count=7
            return Promise.resolve({ cnt: callCount === 1 ? '5' : '7' });
          }),
          run: vi.fn(() => Promise.resolve({ changes: 1 }))
        }))
      };
      mockWrapClient.mockReturnValue(txDb);
      return fn({});
    });

    const res = await request(app)
      .post('/bottles/add')
      .send({ wine_id: 1, start_location: 'F1', quantity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('integrity');
  });
});
