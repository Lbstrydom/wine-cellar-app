/**
 * @fileoverview Tests for shadowed route fix (Phase 2.1).
 * Verifies that GET /wines/:id/ratings returns the RICH response (ratings.js)
 * and GET /wines/:id/source-ratings returns the simple raw rows (wineRatings.js).
 * Uses vitest globals (do NOT import from 'vitest').
 */

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

// Mock services used by ratings.js
vi.mock('../../../src/services/ratings.js', () => ({
  normalizeScore: vi.fn(),
  calculateWineRatings: vi.fn(() => ({
    confidence_level: 'high',
    aggregate_score: 92,
    index: 85
  }))
}));

vi.mock('../../../src/services/jobQueue.js', () => ({
  default: { enqueue: vi.fn(), getJobStatus: vi.fn(), cancelJob: vi.fn(), getStats: vi.fn() }
}));

vi.mock('../../../src/services/cacheService.js', () => ({
  getCacheStats: vi.fn(() => ({})),
  purgeExpiredCache: vi.fn()
}));

vi.mock('../../../src/services/awards.js', () => ({
  getWineAwards: vi.fn(() => [])
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), getLogPath: vi.fn(() => '/tmp/test.log') }
}));

// Mock services used by wineRatings.js
vi.mock('../../../src/services/vivinoSearch.js', () => ({
  searchVivinoWines: vi.fn(() => ({ matches: [] }))
}));

vi.mock('../../../src/routes/wines.js', () => ({
  calculateNextRetry: vi.fn(() => new Date()),
  extractVivinoId: vi.fn()
}));

import express from 'express';
import request from 'supertest';
import wineRatingsRoutes from '../../../src/routes/wineRatings.js';
import ratingsRoutes from '../../../src/routes/ratings.js';
import db from '../../../src/db/index.js';

/**
 * Create app with both routers mounted in the same order as index.js.
 * wineRatingsRoutes is mounted FIRST (same as production).
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cellarId = 1;
    req.validated = {};
    next();
  });
  app.use('/wines', wineRatingsRoutes);
  app.use('/wines', ratingsRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('Route shadowing fix (Phase 2.1)', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ id: 1, cellar_id: 1, wine_name: 'Test Wine', vintage: 2020 }),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    });
  });

  it('GET /wines/:id/ratings returns the RICH response (ratings.js handler)', async () => {
    const res = await request(app).get('/wines/1/ratings');

    expect(res.status).toBe(200);
    // Rich handler includes aggregated fields from calculateWineRatings
    expect(res.body).toHaveProperty('confidence_level');
    expect(res.body).toHaveProperty('aggregate_score');
    expect(res.body).toHaveProperty('index', 85);
    expect(res.body).toHaveProperty('local_awards');
    expect(res.body).toHaveProperty('wine_name');
  });

  it('GET /wines/:id/source-ratings returns raw rows (wineRatings.js handler)', async () => {
    const rawRows = [
      { id: 1, source: 'vivino', rating_value: 4.2, rating_scale: '5' },
      { id: 2, source: 'wine_spectator', rating_value: 92, rating_scale: '100' }
    ];
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ id: 1 }),
      all: vi.fn().mockResolvedValue(rawRows),
    });

    const res = await request(app).get('/wines/1/source-ratings');

    expect(res.status).toBe(200);
    // Simple handler returns { data: [...] } with raw rows
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toEqual(rawRows);
    // Should NOT have rich fields
    expect(res.body).not.toHaveProperty('confidence_level');
    expect(res.body).not.toHaveProperty('local_awards');
  });

  it('GET /wines/:id/ratings does NOT return raw source_ratings shape', async () => {
    const res = await request(app).get('/wines/1/ratings');

    // The rich response wraps ratings in a .ratings array with source_short etc.
    expect(res.body).toHaveProperty('ratings');
    expect(res.body).toHaveProperty('wine_id');
  });

  it('GET /wines/:id/ratings maps source_short on each rating entry', async () => {
    const ratingRow = { id: 10, source: 'wine_spectator', source_lens: 'critics', raw_score: '92' };
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ id: 1, cellar_id: 1, wine_name: 'Test Wine', vintage: 2020 }),
      all: vi.fn().mockResolvedValue([ratingRow]),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
    });

    const res = await request(app).get('/wines/1/ratings');

    expect(res.status).toBe(200);
    expect(res.body.ratings).toHaveLength(1);
    expect(res.body.ratings[0]).toHaveProperty('source_short');
    expect(res.body.ratings[0].source_short).toBeTruthy();
  });
});
