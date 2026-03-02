/**
 * @fileoverview Unit tests for unifiedRatingFetchJob.
 * Verifies unified search wiring, no-delete-on-empty invariant,
 * cellar scoping, grape backfill, and null search result handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('../../../src/services/search/claudeWineSearch.js', () => ({
  unifiedWineSearch: vi.fn(),
  isUnifiedWineSearchAvailable: vi.fn(() => true)
}));

vi.mock('../../../src/services/ai/index.js', () => ({
  saveExtractedWindows: vi.fn().mockResolvedValue(0)
}));

vi.mock('../../../src/services/ratings/ratings.js', () => ({
  calculateWineRatings: vi.fn().mockReturnValue({
    competition_index: 0,
    critics_index: 85,
    community_index: 78,
    purchase_score: 85,
    purchase_stars: 3,
    confidence_level: 'medium'
  }),
  saveRatings: vi.fn().mockResolvedValue(1),
  countSaveableRatings: vi.fn().mockReturnValue(1),
  buildIdentityTokensFromWine: vi.fn().mockReturnValue({ producer: ['kanonkop'], vintage: 2019 }),
  validateRatingsWithIdentity: vi.fn().mockImplementation((_wine, ratings) => ({
    ratings,
    rejected: []
  }))
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

// DB mock — returns values based on the SQL string provided to prepare()
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import handleRatingFetch from '../../../src/jobs/unifiedRatingFetchJob.js';
import { unifiedWineSearch } from '../../../src/services/search/claudeWineSearch.js';
import { saveRatings } from '../../../src/services/ratings/ratings.js';
import { validateRatingsWithIdentity } from '../../../src/services/ratings/ratings.js';
import db from '../../../src/db/index.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const MOCK_WINE = {
  id: 1,
  wine_name: 'Kanonkop Pinotage',
  vintage: 2019,
  cellar_id: 'cellar-abc',
  grapes: null,
  country: 'South Africa'
};

const MOCK_RATING = {
  source: 'wine_spectator',
  raw_score: '92',
  score_type: 'points',
  source_lens: 'critics',
  vintage_match: 'exact',
  match_confidence: 'high'
};

const MOCK_SEARCH_RESULT = {
  ratings: [MOCK_RATING],
  tasting_notes: null,
  grape_varieties: ['Pinotage'],
  drinking_window: null,
  _narrative: 'A robust Pinotage from Kanonkop estate with dark fruit and spice.',
  _metadata: {
    method: 'unified_claude_search',
    model: 'claude-sonnet-4-6',
    sources_count: 4,
    citation_count: 6,
    duration_ms: 14000,
    extracted_at: '2026-01-01T00:00:00.000Z'
  },
  _sources: [],
  _citations: []
};

// ─── DB mock helper ──────────────────────────────────────────────────────────

/**
 * Set up db.prepare() mock to return contextual values based on SQL.
 */
function setupDbMock({ wine = MOCK_WINE, existingCount = 2, allRatings = [MOCK_RATING], grapeChanges = 0 } = {}) {
  db.prepare.mockImplementation((sql) => ({
    get: vi.fn().mockImplementation((..._args) => {
      if (sql.includes('SELECT * FROM wines')) return wine;
      if (sql.includes('COUNT(*)')) return { count: existingCount };
      if (sql.includes('rating_preference')) return null;
      return null;
    }),
    run: vi.fn().mockResolvedValue({ changes: grapeChanges }),
    all: vi.fn().mockResolvedValue(allRatings)
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('handleRatingFetch() — unified rating fetch job', () => {
  let context;

  beforeEach(() => {
    vi.clearAllMocks();
    context = { updateProgress: vi.fn().mockResolvedValue(undefined) };
    setupDbMock();
    unifiedWineSearch.mockResolvedValue(MOCK_SEARCH_RESULT);
  });

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  it('returns correct result shape when ratings are found', async () => {
    const result = await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);

    expect(result.wineId).toBe(1);
    expect(result.wineName).toBe('Kanonkop Pinotage');
    expect(result.vintage).toBe(2019);
    expect(result.ratingsFound).toBeGreaterThan(0);
    expect(result.method).toBe('unified_claude_search');
    expect(result.tastingNotes).toBe('captured');
  });

  it('calls unifiedWineSearch with the wine object', async () => {
    await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);
    expect(unifiedWineSearch).toHaveBeenCalledWith(MOCK_WINE);
  });

  // ── 2. No-delete-on-empty invariant ───────────────────────────────────────
  it('preserves existing ratings when search returns 0 valid ratings', async () => {
    // Override: validateRatingsWithIdentity returns empty ratings
    validateRatingsWithIdentity.mockReturnValueOnce({ ratings: [], rejected: [MOCK_RATING] });

    const deletedSqls = [];
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation(() => {
        if (sql.includes('SELECT * FROM wines')) return MOCK_WINE;
        if (sql.includes('COUNT(*)')) return { count: 3 };
        return null;
      }),
      run: vi.fn().mockImplementation(() => {
        deletedSqls.push(sql);
        return { changes: 0 };
      }),
      all: vi.fn().mockResolvedValue([])
    }));

    const result = await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);

    // Must NOT delete existing ratings
    const deleteWasCalled = deletedSqls.some(s => s.includes('DELETE FROM wine_ratings'));
    expect(deleteWasCalled).toBe(false);

    // Returns 0 ratings found
    expect(result.ratingsFound).toBe(0);
    expect(result.previousRatings).toBe(3);
  });

  // ── 3. Cellar scoping ─────────────────────────────────────────────────────
  it('queries wine with cellar_id when cellarId is in payload', async () => {
    const wineQueries = [];
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation((..._args) => {
        if (sql.includes('SELECT * FROM wines')) {
          wineQueries.push(sql);
          return MOCK_WINE;
        }
        if (sql.includes('COUNT(*)')) return { count: 0 };
        return null;
      }),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
      all: vi.fn().mockResolvedValue([])
    }));

    await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);

    const wineQuery = wineQueries[0];
    expect(wineQuery).toContain('cellar_id');
  });

  it('throws when cellarId is absent from payload', async () => {
    await expect(
      handleRatingFetch({ wineId: 1 }, context)
    ).rejects.toThrow('Missing cellarId in job payload');
  });

  // ── 4. Grape backfill ─────────────────────────────────────────────────────
  it('saves discovered grapes when wine has none', async () => {
    const runCalls = [];
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation(() => {
        if (sql.includes('SELECT * FROM wines')) return { ...MOCK_WINE, grapes: null };
        if (sql.includes('COUNT(*)')) return { count: 0 };
        return null;
      }),
      run: vi.fn().mockImplementation((...args) => {
        runCalls.push({ sql, args });
        return { changes: 1 };
      }),
      all: vi.fn().mockResolvedValue([])
    }));

    const result = await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);

    const grapeUpdate = runCalls.find(c => c.sql.includes('SET grapes'));
    expect(grapeUpdate).toBeDefined();
    expect(result.grapesDiscovered).toEqual(['Pinotage']);
  });

  it('skips grape backfill when wine already has grapes', async () => {
    setupDbMock({ wine: { ...MOCK_WINE, grapes: 'Pinotage' } });

    const result = await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);

    expect(result.grapesEnriched).toBe(false);
  });

  // ── 5. Null result handling ───────────────────────────────────────────────
  it('throws when unifiedWineSearch returns null', async () => {
    unifiedWineSearch.mockResolvedValue(null);

    await expect(
      handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context)
    ).rejects.toThrow('Unified wine search returned no result');
  });

  it('throws when wine is not found', async () => {
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockReturnValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
      all: vi.fn().mockResolvedValue([])
    }));

    await expect(
      handleRatingFetch({ wineId: 999, cellarId: 'cellar-abc' }, context)
    ).rejects.toThrow('Wine not found: 999');
  });

  // ── 6. Prose narrative stored ─────────────────────────────────────────────
  it('passes prose narrative (_narrative) to wines.tasting_notes update', async () => {
    const runCalls = [];
    db.prepare.mockImplementation((sql) => ({
      get: vi.fn().mockImplementation(() => {
        if (sql.includes('SELECT * FROM wines')) return MOCK_WINE;
        if (sql.includes('COUNT(*)')) return { count: 0 };
        return null;
      }),
      run: vi.fn().mockImplementation((...args) => {
        runCalls.push({ sql, args });
        return { changes: 1 };
      }),
      all: vi.fn().mockResolvedValue([])
    }));

    await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);

    // The aggregates UPDATE is identified by competition_index (not the grape UPDATE)
    const wineUpdate = runCalls.find(c => c.sql.includes('competition_index'));
    expect(wineUpdate).toBeDefined();
    // The narrative should be in the args (7th param after the 6 aggregate fields)
    const narrativeArg = wineUpdate.args.find(a => typeof a === 'string' && a.includes('robust'));
    expect(narrativeArg).toBe(MOCK_SEARCH_RESULT._narrative);
  });

  // ── 7. saveRatings called with cellar_id ──────────────────────────────────
  it('calls saveRatings with wine.cellar_id for tenant isolation', async () => {
    await handleRatingFetch({ wineId: 1, cellarId: 'cellar-abc' }, context);

    expect(saveRatings).toHaveBeenCalledWith(
      1,
      MOCK_WINE.vintage,
      expect.arrayContaining([expect.objectContaining({ source: 'wine_spectator' })]),
      MOCK_WINE.cellar_id
    );
  });
});
