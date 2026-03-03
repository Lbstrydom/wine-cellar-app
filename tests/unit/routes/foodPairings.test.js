/**
 * @fileoverview Unit tests for food pairings route.
 * Covers GET (list), PATCH (rate), POST (add manual) endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../../src/utils/errorResponse.js', () => ({
  asyncHandler: fn => fn
}));

import db from '../../../src/db/index.js';
import router from '../../../src/routes/foodPairings.js';

const CELLAR_ID = 'cellar-uuid-test';
const WINE_ID = 42;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cellarId = CELLAR_ID;
    req.cellarRole = 'owner';
    next();
  });
  app.use('/', router);
  return app;
}

/** Build a chain mock for db.prepare().get / .all / .run */
function mockSequence(calls) {
  // Each call to db.prepare() returns a fresh chain from `calls` in order
  let i = 0;
  db.prepare.mockImplementation(() => {
    const c = calls[i++] || {};
    return {
      get: vi.fn().mockResolvedValue(c.get ?? null),
      all: vi.fn().mockResolvedValue(c.all ?? []),
      run: vi.fn().mockResolvedValue({ changes: c.changes ?? 1 })
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /wines/:wineId/food-pairings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns pairings for an existing wine', async () => {
    const wine = { id: WINE_ID };
    const pairings = [
      { id: 1, pairing: 'Lamb rack', source: 'search', user_rating: null, notes: null, rated_at: null, created_at: '2026-01-01' },
      { id: 2, pairing: 'Beef brisket', source: 'search', user_rating: 4, notes: 'Lovely', rated_at: '2026-01-02', created_at: '2026-01-01' }
    ];
    mockSequence([{ get: wine }, { all: pairings }]);

    const res = await request(createApp()).get(`/${WINE_ID}/food-pairings`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.count).toBe(2);
    expect(res.body.data[0].pairing).toBe('Lamb rack');
  });

  it('returns 404 when wine not found', async () => {
    mockSequence([{ get: null }]);
    const res = await request(createApp()).get(`/${WINE_ID}/food-pairings`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Wine not found');
  });

  it('returns 400 for non-numeric wineId', async () => {
    const res = await request(createApp()).get('/abc/food-pairings');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid wineId');
  });

  it('returns empty array when no pairings exist', async () => {
    mockSequence([{ get: { id: WINE_ID } }, { all: [] }]);
    const res = await request(createApp()).get(`/${WINE_ID}/food-pairings`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /wines/:wineId/food-pairings/:pairingId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a valid star rating', async () => {
    const updated = { id: 1, pairing: 'Lamb rack', source: 'search', user_rating: 4, notes: null, rated_at: '2026-01-03' };
    mockSequence([{ get: updated }]);

    const res = await request(createApp())
      .patch(`/${WINE_ID}/food-pairings/1`)
      .send({ user_rating: 4 });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Rating saved');
    expect(res.body.data.user_rating).toBe(4);
  });

  it('saves a rating with notes', async () => {
    const updated = { id: 1, pairing: 'Lamb rack', source: 'search', user_rating: 5, notes: 'Perfect match', rated_at: '2026-01-04' };
    mockSequence([{ get: updated }]);

    const res = await request(createApp())
      .patch(`/${WINE_ID}/food-pairings/1`)
      .send({ user_rating: 5, notes: 'Perfect match' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Perfect match');
  });

  it('returns 400 for rating below 1', async () => {
    const res = await request(createApp())
      .patch(`/${WINE_ID}/food-pairings/1`)
      .send({ user_rating: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 5/);
  });

  it('returns 400 for rating above 5', async () => {
    const res = await request(createApp())
      .patch(`/${WINE_ID}/food-pairings/1`)
      .send({ user_rating: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 5/);
  });

  it('returns 400 for non-integer rating', async () => {
    const res = await request(createApp())
      .patch(`/${WINE_ID}/food-pairings/1`)
      .send({ user_rating: 'great' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when pairing not found', async () => {
    mockSequence([{ get: null }]);
    const res = await request(createApp())
      .patch(`/${WINE_ID}/food-pairings/999`)
      .send({ user_rating: 3 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Pairing not found');
  });

  it('returns 400 for non-numeric pairingId', async () => {
    const res = await request(createApp())
      .patch(`/${WINE_ID}/food-pairings/abc`)
      .send({ user_rating: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /wines/:wineId/food-pairings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a manual pairing without a rating', async () => {
    const wine = { id: WINE_ID };
    const created = { id: 10, pairing: 'Venison', source: 'manual', user_rating: null, notes: null, rated_at: null, created_at: '2026-01-05' };
    mockSequence([{ get: wine }, { get: created }]);

    const res = await request(createApp())
      .post(`/${WINE_ID}/food-pairings`)
      .send({ pairing: 'Venison' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Pairing added');
    expect(res.body.data.pairing).toBe('Venison');
    expect(res.body.data.source).toBe('manual');
  });

  it('adds a manual pairing with an immediate rating', async () => {
    const wine = { id: WINE_ID };
    const created = { id: 11, pairing: 'Mushroom risotto', source: 'manual', user_rating: 3, notes: null, rated_at: '2026-01-05', created_at: '2026-01-05' };
    mockSequence([{ get: wine }, { get: created }]);

    const res = await request(createApp())
      .post(`/${WINE_ID}/food-pairings`)
      .send({ pairing: 'Mushroom risotto', user_rating: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data.user_rating).toBe(3);
  });

  it('returns 400 when pairing text is missing', async () => {
    const res = await request(createApp())
      .post(`/${WINE_ID}/food-pairings`)
      .send({ user_rating: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pairing is required');
  });

  it('returns 400 when pairing is an empty string', async () => {
    const res = await request(createApp())
      .post(`/${WINE_ID}/food-pairings`)
      .send({ pairing: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pairing is required');
  });

  it('returns 400 for out-of-range user_rating', async () => {
    const res = await request(createApp())
      .post(`/${WINE_ID}/food-pairings`)
      .send({ pairing: 'Cheese', user_rating: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 1 and 5/);
  });

  it('returns 404 when wine not found', async () => {
    mockSequence([{ get: null }]);
    const res = await request(createApp())
      .post(`/${WINE_ID}/food-pairings`)
      .send({ pairing: 'Cheese' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Wine not found');
  });
});
