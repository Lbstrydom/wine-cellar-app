/**
 * @fileoverview Unit tests for buying guide items route.
 * Tests endpoints, validation, and status codes.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db before imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    transaction: vi.fn(async (fn) => {
      // Simulate transaction by calling fn with a mock client
      const mockClient = { query: vi.fn(() => ({ rows: [], rowCount: 0 })) };
      return fn(mockClient);
    })
  },
  wrapClient: vi.fn((client) => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => Promise.resolve(null)),
      all: vi.fn(() => Promise.resolve([])),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }))
  }))
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
}));

vi.mock('../../../src/services/recipe/styleInference.js', () => ({
  inferStyleForItem: vi.fn(() => ({
    styleId: 'red_full', confidence: 'high', label: 'Full Red', matchedOn: ['colour']
  }))
}));

vi.mock('../../../src/services/acquisitionWorkflow.js', () => ({
  suggestPlacement: vi.fn(() => Promise.resolve({
    zone: { zoneId: 'zone-1', displayName: 'Red Zone', confidence: 0.9, alternatives: [] },
    suggestedSlot: 'R3C1'
  })),
  saveAcquiredWine: vi.fn(() => Promise.resolve({
    wineId: 42,
    slots: ['R3C1'],
    warnings: [],
    message: 'Wine saved'
  })),
  enrichWineData: vi.fn(() => Promise.resolve())
}));

vi.mock('../../../src/services/recipe/buyingGuide.js', () => ({
  generateBuyingGuide: vi.fn(() => Promise.resolve({
    gaps: [{ style: 'white_crisp', label: 'Crisp White', deficit: 3, projectedDeficit: 1, target: 5, have: 2, suggestions: ['Sauvignon Blanc'] }],
    coveragePct: 72,
    bottleCoveragePct: 65,
    projectedCoveragePct: 80,
    projectedBottleCoveragePct: 75,
    activeCartItems: 2,
    activeCartBottles: 4
  })),
  invalidateBuyingGuideCache: vi.fn(() => Promise.resolve())
}));

import db, { wrapClient } from '../../../src/db/index.js';
import { suggestPlacement, saveAcquiredWine, enrichWineData } from '../../../src/services/acquisitionWorkflow.js';
import { invalidateBuyingGuideCache } from '../../../src/services/recipe/buyingGuide.js';
import router from '../../../src/routes/buyingGuideItems.js';

const CELLAR_ID = 'cellar-uuid-route-test';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cellarId = CELLAR_ID;
    req.cellarRole = 'owner';
    next();
  });
  app.use('/buying-guide-items', router);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('buyingGuideItems routes', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockDbDefault() {
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn((...args) => {
        if (sql.includes('COUNT')) return Promise.resolve({ count: 0 });
        if (sql.includes('RETURNING')) return Promise.resolve({ id: 1, wine_name: 'Test', status: 'planned', cellar_id: CELLAR_ID });
        if (sql.includes('SELECT')) return Promise.resolve({ id: 1, wine_name: 'Test', status: 'planned', cellar_id: CELLAR_ID, converted_wine_id: null });
        return Promise.resolve(null);
      }),
      all: vi.fn(() => Promise.resolve([])),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));
  }

  describe('GET /buying-guide-items', () => {
    it('returns 200 with nested { items, total } shape', async () => {
      mockDbDefault();
      const res = await request(app).get('/buying-guide-items');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.items).toBeDefined();
      expect(res.body.data.total).toBeDefined();
      // Verify the shape matches what cartState.js expects
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
    });

    it('accepts valid query params', async () => {
      mockDbDefault();
      const res = await request(app)
        .get('/buying-guide-items?status=planned&limit=10&offset=0');
      expect(res.status).toBe(200);
    });

    it('rejects invalid status', async () => {
      const res = await request(app)
        .get('/buying-guide-items?status=invalid');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /buying-guide-items/summary', () => {
    it('returns 200 with summary', async () => {
      db.prepare.mockImplementation(() => ({
        all: vi.fn(() => Promise.resolve([]))
      }));
      const res = await request(app).get('/buying-guide-items/summary');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /buying-guide-items/:id', () => {
    it('returns 200 for existing item', async () => {
      mockDbDefault();
      const res = await request(app).get('/buying-guide-items/1');
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
    });

    it('returns 404 for missing item', async () => {
      db.prepare.mockImplementation(() => ({
        get: vi.fn(() => Promise.resolve(null))
      }));
      const res = await request(app).get('/buying-guide-items/999');
      expect(res.status).toBe(404);
    });

    it('rejects non-numeric id', async () => {
      const res = await request(app).get('/buying-guide-items/abc');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /buying-guide-items', () => {
    it('returns 201 for valid item', async () => {
      mockDbDefault();
      const res = await request(app)
        .post('/buying-guide-items')
        .send({ wine_name: 'Chenin Blanc 2023' });
      expect(res.status).toBe(201);
      expect(res.body.message).toContain('added');
    });

    it('rejects missing wine_name', async () => {
      const res = await request(app)
        .post('/buying-guide-items')
        .send({});
      expect(res.status).toBe(400);
    });

    it('accepts optional fields', async () => {
      mockDbDefault();
      const res = await request(app)
        .post('/buying-guide-items')
        .send({
          wine_name: 'Kanonkop Pinotage',
          producer: 'Kanonkop',
          quantity: 3,
          style_id: 'red_full',
          price: 350,
          currency: 'ZAR',
          vintage: 2021,
          colour: 'red',
          source_gap_style: 'red_full'
        });
      expect(res.status).toBe(201);
    });

    it('rejects invalid style_id', async () => {
      const res = await request(app)
        .post('/buying-guide-items')
        .send({ wine_name: 'Test', style_id: 'invalid_style' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /buying-guide-items/:id', () => {
    it('returns 200 for valid update', async () => {
      mockDbDefault();
      const res = await request(app)
        .put('/buying-guide-items/1')
        .send({ wine_name: 'Updated Name' });
      expect(res.status).toBe(200);
    });

    it('returns 404 for missing item', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => Promise.resolve(null)),
        all: vi.fn(() => Promise.resolve([]))
      }));
      const res = await request(app)
        .put('/buying-guide-items/999')
        .send({ wine_name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /buying-guide-items/:id/status', () => {
    it('returns 200 for valid transition', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'planned', cellar_id: CELLAR_ID });
          }
          return Promise.resolve({ id: 1, status: 'ordered' });
        })
      }));

      const res = await request(app)
        .patch('/buying-guide-items/1/status')
        .send({ status: 'ordered' });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ordered');
    });

    it('returns 400 for invalid transition', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, status: 'arrived', cellar_id: CELLAR_ID });
          }
          return Promise.resolve(null);
        })
      }));

      const res = await request(app)
        .patch('/buying-guide-items/1/status')
        .send({ status: 'ordered' });
      expect(res.status).toBe(400);
    });

    it('rejects invalid status value', async () => {
      const res = await request(app)
        .patch('/buying-guide-items/1/status')
        .send({ status: 'shipped' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /buying-guide-items/batch-status', () => {
    it('returns 200 with batch results', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: args[0], status: 'planned', cellar_id: CELLAR_ID });
          }
          return Promise.resolve({ id: args[1], status: args[0] });
        })
      }));

      const res = await request(app)
        .patch('/buying-guide-items/batch-status')
        .send({ ids: [1, 2], status: 'ordered' });
      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(2);
    });

    it('rejects empty ids array', async () => {
      const res = await request(app)
        .patch('/buying-guide-items/batch-status')
        .send({ ids: [], status: 'ordered' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /buying-guide-items/:id', () => {
    it('returns 200 for non-converted item', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, converted_wine_id: null, cellar_id: CELLAR_ID });
          }
          return Promise.resolve(null);
        }),
        run: vi.fn(() => Promise.resolve({ changes: 1 }))
      }));

      const res = await request(app).delete('/buying-guide-items/1');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });

    it('returns 400 for converted item', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({ id: 1, converted_wine_id: 42, cellar_id: CELLAR_ID });
          }
          return Promise.resolve(null);
        })
      }));

      const res = await request(app).delete('/buying-guide-items/1');
      expect(res.status).toBe(400);
    });

    it('returns 404 for missing item', async () => {
      db.prepare.mockImplementation(() => ({
        get: vi.fn(() => Promise.resolve(null))
      }));

      const res = await request(app).delete('/buying-guide-items/999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /buying-guide-items/infer-style', () => {
    it('returns 200 with inferred style', async () => {
      const res = await request(app)
        .post('/buying-guide-items/infer-style')
        .send({ wine_name: 'Cabernet Sauvignon 2020' });
      expect(res.status).toBe(200);
      expect(res.body.data.styleId).toBe('red_full');
      expect(res.body.data.confidence).toBe('high');
      expect(res.body.data.label).toBe('Full Red');
    });

    it('rejects missing wine_name', async () => {
      const res = await request(app)
        .post('/buying-guide-items/infer-style')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /buying-guide-items/gaps', () => {
    it('returns 200 with gap summary', async () => {
      const res = await request(app).get('/buying-guide-items/gaps');
      expect(res.status).toBe(200);
      expect(res.body.data.gaps).toHaveLength(1);
      expect(res.body.data.gaps[0].style).toBe('white_crisp');
      expect(res.body.data.coveragePct).toBe(72);
      expect(res.body.data.bottleCoveragePct).toBe(65);
    });
  });

  describe('POST /buying-guide-items/:id/arrive', () => {
    it('transitions item to arrived and returns placement', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({
              id: 1, wine_name: 'Shiraz 2020', status: 'ordered',
              cellar_id: CELLAR_ID, converted_wine_id: null,
              colour: 'red', style_id: 'red_full'
            });
          }
          // RETURNING from UPDATE
          return Promise.resolve({ id: 1, status: 'arrived' });
        })
      }));

      const res = await request(app).post('/buying-guide-items/1/arrive');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('arrived');
      expect(res.body.data.item).toBeDefined();
      expect(res.body.data.placement).toBeDefined();
      expect(res.body.data.placement.zoneName).toBe('Red Zone');
    });

    it('returns 404 if item not found', async () => {
      db.prepare.mockImplementation(() => ({
        get: vi.fn(() => Promise.resolve(null))
      }));

      const res = await request(app).post('/buying-guide-items/999/arrive');
      expect(res.status).toBe(404);
    });

    it('returns 400 if status transition invalid', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({
              id: 1, status: 'arrived', cellar_id: CELLAR_ID, converted_wine_id: null
            });
          }
          return Promise.resolve(null);
        })
      }));

      const res = await request(app).post('/buying-guide-items/1/arrive');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /buying-guide-items/:id/to-cellar', () => {
    const arrivedItem = {
      id: 1, wine_name: 'Merlot 2021', producer: 'Estate', status: 'arrived',
      cellar_id: CELLAR_ID, converted_wine_id: null, quantity: 3,
      style_id: 'red_medium', colour: 'red', vintage: 2021,
      grapes: 'Merlot', region: 'Stellenbosch', country: 'South Africa',
      notes: null, source: 'manual', source_gap_style: null,
      inferred_style_confidence: null, price: 200, currency: 'ZAR',
      vendor_url: null
    };

    it('converts full quantity and returns wineId + slots', async () => {
      // Mock getItem
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('COUNT')) return Promise.resolve({ count: 5 });
          return Promise.resolve(arrivedItem);
        }),
        all: vi.fn(() => Promise.resolve([])),
        run: vi.fn(() => Promise.resolve({ changes: 1 }))
      }));

      // Mock transaction — simulate success
      db.transaction.mockImplementation(async (fn) => {
        const mockClient = { query: vi.fn(() => ({ rows: [], rowCount: 0 })) };
        return fn(mockClient);
      });

      // Mock saveAcquiredWine returning 3 slots
      saveAcquiredWine.mockResolvedValueOnce({
        wineId: 42,
        slots: ['R3C1', 'R3C2', 'R3C3'],
        warnings: [],
        message: 'Wine saved'
      });

      const res = await request(app)
        .post('/buying-guide-items/1/to-cellar')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.wineId).toBe(42);
      expect(res.body.data.converted).toBe(3);
      expect(res.body.data.remaining).toBe(0);
      expect(res.body.data.partial).toBe(false);
    });

    it('returns requiresConfirmation when slots < quantity', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('COUNT')) return Promise.resolve({ count: 1 });
          return Promise.resolve(arrivedItem);
        }),
        all: vi.fn(() => Promise.resolve([])),
        run: vi.fn(() => Promise.resolve({ changes: 1 }))
      }));

      const res = await request(app)
        .post('/buying-guide-items/1/to-cellar')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.requiresConfirmation).toBe(true);
      expect(res.body.data.available).toBe(1);
      expect(res.body.data.total).toBe(3);
    });

    it('performs partial conversion when confirmed', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => {
          if (sql.includes('COUNT')) return Promise.resolve({ count: 1 });
          return Promise.resolve(arrivedItem);
        }),
        all: vi.fn(() => Promise.resolve([])),
        run: vi.fn(() => Promise.resolve({ changes: 1 }))
      }));

      db.transaction.mockImplementation(async (fn) => {
        const mockClient = { query: vi.fn(() => ({ rows: [], rowCount: 0 })) };
        return fn(mockClient);
      });

      saveAcquiredWine.mockResolvedValueOnce({
        wineId: 43,
        slots: ['R3C1'],
        warnings: [],
        message: 'Wine saved'
      });

      const res = await request(app)
        .post('/buying-guide-items/1/to-cellar')
        .send({ confirmed: true, convertQuantity: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.wineId).toBe(43);
      expect(res.body.data.converted).toBe(1);
      expect(res.body.data.remaining).toBe(2);
      expect(res.body.data.partial).toBe(true);
    });

    it('returns 400 if not arrived', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => Promise.resolve({
          ...arrivedItem, status: 'planned'
        }))
      }));

      const res = await request(app)
        .post('/buying-guide-items/1/to-cellar')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('arrived');
    });

    it('returns 409 if already converted', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn(() => Promise.resolve({
          ...arrivedItem, converted_wine_id: 99
        }))
      }));

      const res = await request(app)
        .post('/buying-guide-items/1/to-cellar')
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already converted');
    });

    it('rejects invalid convertQuantity', async () => {
      const res = await request(app)
        .post('/buying-guide-items/1/to-cellar')
        .send({ convertQuantity: -5 });
      expect(res.status).toBe(400);
    });

    it('returns 404 if item not found', async () => {
      db.prepare.mockImplementation(() => ({
        get: vi.fn(() => Promise.resolve(null))
      }));

      const res = await request(app)
        .post('/buying-guide-items/999/to-cellar')
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe('POST /buying-guide-items/batch-arrive', () => {
    it('marks multiple items as arrived', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({
              id: args[0], status: 'ordered', cellar_id: CELLAR_ID
            });
          }
          return Promise.resolve({ id: args[1], status: 'arrived' });
        })
      }));

      const res = await request(app)
        .post('/buying-guide-items/batch-arrive')
        .send({ ids: [1, 2] });
      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(2);
    });

    it('accepts body with just ids (no status field)', async () => {
      db.prepare.mockImplementation((sql) => ({
        get: vi.fn((...args) => {
          if (sql.includes('SELECT')) {
            return Promise.resolve({
              id: args[0], status: 'planned', cellar_id: CELLAR_ID
            });
          }
          return Promise.resolve({ id: args[1], status: 'arrived' });
        })
      }));

      // No status field in body — should be accepted
      const res = await request(app)
        .post('/buying-guide-items/batch-arrive')
        .send({ ids: [1] });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('arrived');
    });

    it('rejects empty ids array', async () => {
      const res = await request(app)
        .post('/buying-guide-items/batch-arrive')
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });
  });
});
