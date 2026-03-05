/**
 * @fileoverview Unit tests for batchFetchJob.
 * Verifies identity validation, no-delete-on-empty invariant,
 * vintage sensitivity filtering, and cellar scoping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('../../../src/services/search/claudeWineSearch.js', () => ({
  unifiedWineSearch: vi.fn()
}));

vi.mock('../../../src/services/ai/index.js', () => ({
  saveExtractedWindows: vi.fn().mockResolvedValue(0)
}));

vi.mock('../../../src/services/ratings/ratings.js', () => ({
  calculateWineRatings: vi.fn().mockReturnValue({
    competition_index: 0,
    critics_index: 88,
    community_index: 80,
    purchase_score: 88,
    purchase_stars: 4,
    confidence_level: 'high'
  }),
  saveRatings: vi.fn().mockResolvedValue(1),
  countSaveableRatings: vi.fn().mockReturnValue(1),
  buildIdentityTokensFromWine: vi.fn().mockReturnValue({ producer: ['kanonkop'], vintage: 2019 }),
  validateRatingsWithIdentity: vi.fn().mockImplementation((_wine, ratings) => ({
    ratings,
    rejected: []
  }))
}));

vi.mock('../../../src/services/awards/index.js', () => ({
  getWineAwards: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../src/config/vintageSensitivity.js', () => ({
  filterRatingsByVintageSensitivity: vi.fn().mockImplementation((_wine, ratings) => ratings),
  getVintageSensitivity: vi.fn().mockReturnValue('vintage')
}));

vi.mock('../../../src/db/helpers.js', () => ({
  nowFunc: vi.fn(() => 'CURRENT_TIMESTAMP')
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import handleBatchFetch from '../../../src/jobs/batchFetchJob.js';
import { unifiedWineSearch } from '../../../src/services/search/claudeWineSearch.js';
import { saveRatings, validateRatingsWithIdentity, countSaveableRatings, calculateWineRatings } from '../../../src/services/ratings/ratings.js';
import { getWineAwards } from '../../../src/services/awards/index.js';
import { filterRatingsByVintageSensitivity } from '../../../src/config/vintageSensitivity.js';
import db from '../../../src/db/index.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const MOCK_WINE = {
  id: 42,
  wine_name: 'Kanonkop Pinotage',
  vintage: 2019,
  cellar_id: 'cellar-xyz',
  grapes: null,
  country: 'South Africa',
  ratings_updated_at: null
};

const MOCK_RATING = {
  source: 'wine_spectator',
  raw_score: '92',
  score_type: 'points',
  source_lens: 'critics',
  vintage_match: 'exact'
};

const MOCK_SEARCH_RESULT = {
  ratings: [MOCK_RATING],
  _narrative: 'Rich dark fruit, spice.',
  _metadata: { method: 'unified_claude_search' }
};

function setupDbMock({ wine = MOCK_WINE } = {}) {
  db.prepare.mockImplementation((sql) => ({
    get: vi.fn().mockImplementation(() => {
      if (sql.includes('SELECT * FROM wines')) return wine;
      if (sql.includes('rating_preference')) return null;
      return null;
    }),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
    all: vi.fn().mockResolvedValue([MOCK_RATING])
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleBatchFetch() — batch rating fetch job', () => {
  let context;

  beforeEach(() => {
    vi.clearAllMocks();
    context = { updateProgress: vi.fn().mockResolvedValue(undefined) };
    setupDbMock();
    unifiedWineSearch.mockResolvedValue(MOCK_SEARCH_RESULT);
  });

  // ── 1. Identity validation applied ────────────────────────────────────────
  it('calls validateRatingsWithIdentity before saving', async () => {
    await handleBatchFetch({ wineIds: [42], options: {} }, context);
    expect(validateRatingsWithIdentity).toHaveBeenCalledWith(
      MOCK_WINE,
      MOCK_SEARCH_RESULT.ratings,
      expect.any(Object),
      expect.objectContaining({ searchContext: expect.any(String) })
    );
  });

  it('calls filterRatingsByVintageSensitivity after identity validation', async () => {
    await handleBatchFetch({ wineIds: [42], options: {} }, context);
    expect(filterRatingsByVintageSensitivity).toHaveBeenCalledWith(
      MOCK_WINE,
      expect.any(Array)
    );
  });

  it('does not save ratings rejected by identity validation', async () => {
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
      all: vi.fn().mockResolvedValue([])
    }));

    await handleBatchFetch({ wineIds: [42], options: {} }, context);

    expect(saveRatings).not.toHaveBeenCalled();
    expect(deletedSqls.some(s => s.includes('DELETE'))).toBe(false);
  });

  // ── 2. No-delete-on-empty (unknown source IDs) ────────────────────────────
  it('does not DELETE when countSaveableRatings returns 0', async () => {
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
      all: vi.fn().mockResolvedValue([])
    }));

    await handleBatchFetch({ wineIds: [42], options: {} }, context);

    expect(deletedSqls.some(s => s.includes('DELETE'))).toBe(false);
    expect(saveRatings).not.toHaveBeenCalled();
  });

  // ── 3. Cellar scoping ─────────────────────────────────────────────────────
  it('passes wine.cellar_id to saveRatings', async () => {
    await handleBatchFetch({ wineIds: [42], options: {} }, context);
    expect(saveRatings).toHaveBeenCalledWith(
      42,
      MOCK_WINE.vintage,
      expect.any(Array),
      MOCK_WINE.cellar_id
    );
  });

  it('loads local awards and passes them into calculateWineRatings', async () => {
    getWineAwards.mockResolvedValueOnce([{ id: 1, award: 'Gold', competition_name: 'Chardonnay du Monde', credibility: 0.9 }]);

    await handleBatchFetch({ wineIds: [42], options: {} }, context);

    expect(getWineAwards).toHaveBeenCalledWith(42);
    expect(calculateWineRatings).toHaveBeenCalledWith(
      expect.any(Array),
      MOCK_WINE,
      40,
      expect.any(Array)
    );
  });

  // ── 4. Skip recently-updated wines ────────────────────────────────────────
  it('skips wines updated within 24h', async () => {
    const recentWine = { ...MOCK_WINE, ratings_updated_at: new Date().toISOString() };
    setupDbMock({ wine: recentWine });

    const result = await handleBatchFetch({ wineIds: [42], options: {} }, context);

    expect(result.skipped).toBe(1);
    expect(unifiedWineSearch).not.toHaveBeenCalled();
  });

  it('does not skip recently-updated wines when forceRefresh is true', async () => {
    const recentWine = { ...MOCK_WINE, ratings_updated_at: new Date().toISOString() };
    setupDbMock({ wine: recentWine });

    const result = await handleBatchFetch({ wineIds: [42], options: { forceRefresh: true } }, context);

    expect(result.skipped).toBe(0);
    expect(unifiedWineSearch).toHaveBeenCalled();
  });

  // ── 5. Handles missing wine gracefully ────────────────────────────────────
  it('marks wine as skipped when not found in DB', async () => {
    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
      all: vi.fn().mockResolvedValue([])
    }));

    const result = await handleBatchFetch({ wineIds: [999], options: {} }, context);

    expect(result.skipped).toBe(1);
    expect(result.wines[0].reason).toBe('not_found');
  });

  // ── 6. Handles unifiedWineSearch error without stopping batch ─────────────
  it('continues batch when one wine search throws', async () => {
    const secondWine = { ...MOCK_WINE, id: 43 };

    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation((...args) => {
        const id = args[0];
        if (sql.includes('SELECT * FROM wines')) return id === 42 ? MOCK_WINE : secondWine;
        return null;
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([])
    }));

    unifiedWineSearch
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce(MOCK_SEARCH_RESULT);

    const result = await handleBatchFetch({ wineIds: [42, 43], options: {} }, context);

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(1);
    expect(result.total).toBe(2);
  });
});
