/**
 * @fileoverview Unit tests for buying guide items route.
 * Tests endpoints, validation, and status codes.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db before imports
vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
}));

vi.mock('../../../src/services/recipe/styleInference.js', () => ({
  inferStyleForItem: vi.fn(() => ({
    styleId: 'red_full', confidence: 'high', label: 'Full Red', matchedOn: ['colour']
  }))
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

import db from '../../../src/db/index.js';
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
    it('returns 200 with items', async () => {
      mockDbDefault();
      const res = await request(app).get('/buying-guide-items');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.total).toBeDefined();
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
});
