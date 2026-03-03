/**
 * @fileoverview Unit tests for ratingsTier route (POST /ratings/fetch).
 * Focuses on: no-delete-on-empty invariant, countSaveableRatings guard,
 * cellar-scoped wine lookup, and identity gate behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('../../../src/services/search/claudeWineSearch.js', () => ({
  unifiedWineSearch: vi.fn()
}));

vi.mock('../../../src/services/ratings/ratings.js', () => ({
  normalizeScore: vi.fn().mockReturnValue({ min: 88, max: 92, mid: 90 }),
  calculateWineRatings: vi.fn().mockReturnValue({
    competition_index: 0, critics_index: 90, community_index: 80,
    purchase_score: 90, purchase_stars: 4, confidence_level: 'high'
  }),
  buildIdentityTokensFromWine: vi.fn().mockReturnValue({ producer: ['kanonkop'], vintage: 2019 }),
  validateRatingsWithIdentity: vi.fn().mockImplementation((_w, ratings) => ({ ratings, rejected: [] })),
  countSaveableRatings: vi.fn().mockReturnValue(1)
}));

vi.mock('../../../src/config/vintageSensitivity.js', () => ({
  filterRatingsByVintageSensitivity: vi.fn().mockImplementation((_w, r) => r),
  getVintageSensitivity: vi.fn().mockReturnValue('vintage')
}));

vi.mock('../../../src/config/unifiedSources.js', () => ({
  SOURCES: {
    wine_spectator: { lens: 'critics', score_scale: 100, score_type: 'points' }
  }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../../src/services/shared/wineUpdateService.js', () => ({
  persistSearchResults: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../src/utils/errorResponse.js', () => ({
  asyncHandler: vi.fn((fn) => fn)
}));

vi.mock('../../../src/middleware/validate.js', () => ({
  validateParams: vi.fn(() => (_req, _res, next) => next())
}));

vi.mock('../../../src/schemas/rating.js', () => ({
  ratingWineIdSchema: {}
}));

vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import ratingsTierRouter from '../../../src/routes/ratingsTier.js';
import { unifiedWineSearch } from '../../../src/services/search/claudeWineSearch.js';
import { countSaveableRatings, validateRatingsWithIdentity } from '../../../src/services/ratings/ratings.js';
import db from '../../../src/db/index.js';
import { persistSearchResults } from '../../../src/services/shared/wineUpdateService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createApp(cellarId = 'cellar-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = cellarId; next(); });
  app.use('/', ratingsTierRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

const MOCK_WINE = {
  id: 5,
  wine_name: 'Kanonkop Paul Sauer',
  vintage: 2019,
  cellar_id: 'cellar-1',
  grapes: null,
  country: 'South Africa'
};

const MOCK_RATING = {
  source: 'wine_spectator',
  raw_score: '93',
  score_type: 'points',
  source_lens: 'critics',
  vintage_match: 'exact'
};

const MOCK_RESULT = {
  ratings: [MOCK_RATING],
  grape_varieties: [],
  _narrative: 'Structured Bordeaux blend.',
  _metadata: { method: 'unified_claude_search' }
};

function setupDbMock({ wine = MOCK_WINE, existingRatings = [MOCK_RATING], postSaveRatings = [MOCK_RATING] } = {}) {
  db.prepare.mockImplementation((sql) => ({
    get: vi.fn().mockImplementation(() => {
      if (sql.includes('SELECT * FROM wines')) return wine;
      if (sql.includes('rating_preference')) return null;
      return null;
    }),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
    all: vi.fn().mockImplementation(() => {
      if (sql.includes('is_user_override')) return existingRatings;
      return postSaveRatings;
    })
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /:wineId/ratings/fetch — ratingsTier route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMock();
    unifiedWineSearch.mockResolvedValue(MOCK_RESULT);
  });

  // ── 1. Happy path ─────────────────────────────────────────────────────────
  it('returns 200 with rating count on success', async () => {
    const app = createApp();
    const res = await request(app).post('/5/ratings/fetch');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Found \d+ ratings/);
  });

  it('calls persistSearchResults with extracted data on success', async () => {
    const app = createApp();
    await request(app).post('/5/ratings/fetch');

    expect(persistSearchResults).toHaveBeenCalledOnce();
    const [wineId, cellarId, , , extractionData] = persistSearchResults.mock.calls[0];
    expect(wineId).toBe(5);
    expect(cellarId).toBe('cellar-1');
    expect(extractionData).toHaveProperty('narrative');
    expect(extractionData).toHaveProperty('foodPairings');
  });

  it('does not include dead fields (search_notes, food_pairings_count, method) in response', async () => {
    const app = createApp();
    const res = await request(app).post('/5/ratings/fetch');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('search_notes');
    expect(res.body).not.toHaveProperty('food_pairings_count');
    expect(res.body).not.toHaveProperty('method');
  });

  // ── 2. No-delete-on-empty (zero valid ratings) ────────────────────────────
  it('returns 200 preserving existing ratings when search returns 0 valid ratings', async () => {
    validateRatingsWithIdentity.mockReturnValueOnce({ ratings: [], rejected: [MOCK_RATING] });

    const deletedSqls = [];
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation(() => {
        if (sql.includes('SELECT * FROM wines')) return MOCK_WINE;
        return null;
      }),
      run: vi.fn().mockImplementation(() => {
        deletedSqls.push(sql);
        return { changes: 0 };
      }),
      all: vi.fn().mockResolvedValue([MOCK_RATING])
    }));

    const res = await request(createApp()).post('/5/ratings/fetch');

    expect(res.status).toBe(200);
    expect(res.body.ratings_kept).toBe(1);
    expect(deletedSqls.some(s => s.includes('DELETE'))).toBe(false);
  });

  // ── 3. countSaveableRatings guard ─────────────────────────────────────────
  it('does not DELETE when all ratings have unknown source IDs', async () => {
    countSaveableRatings.mockReturnValueOnce(0);

    const deletedSqls = [];
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation(() => {
        if (sql.includes('SELECT * FROM wines')) return MOCK_WINE;
        return null;
      }),
      run: vi.fn().mockImplementation(() => {
        deletedSqls.push(sql);
        return { changes: 0 };
      }),
      all: vi.fn().mockResolvedValue([MOCK_RATING])
    }));

    const res = await request(createApp()).post('/5/ratings/fetch');

    expect(res.status).toBe(200);
    expect(res.body.ratings_kept).toBe(1);
    expect(deletedSqls.some(s => s.includes('DELETE'))).toBe(false);
  });

  // ── 4. Wine not found → 404 ───────────────────────────────────────────────
  it('returns 404 when wine does not belong to cellar', async () => {
    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
      all: vi.fn().mockResolvedValue([])
    }));

    const res = await request(createApp()).post('/5/ratings/fetch');

    expect(res.status).toBe(404);
  });

  // ── 5. Search unavailable → 503 ───────────────────────────────────────────
  it('returns 503 when unifiedWineSearch returns null', async () => {
    unifiedWineSearch.mockResolvedValueOnce(null);

    const res = await request(createApp()).post('/5/ratings/fetch');

    expect(res.status).toBe(503);
  });
});
