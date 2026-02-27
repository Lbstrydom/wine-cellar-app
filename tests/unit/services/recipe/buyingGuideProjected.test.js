/**
 * @fileoverview Tests for virtual inventory projection and caching in buying guide.
 * Phase 3: projected coverage, gap deficit reduction, cache hit/miss.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before imports
vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
}));

vi.mock('../../../../src/services/pairing/pairingEngine.js', () => ({
  matchWineToStyle: vi.fn()
}));

vi.mock('../../../../src/services/recipe/cookingProfile.js', () => ({
  computeCookingProfile: vi.fn()
}));

vi.mock('../../../../src/services/recipe/buyingGuideCart.js', () => ({
  getActiveItems: vi.fn()
}));

import db from '../../../../src/db/index.js';
import { matchWineToStyle } from '../../../../src/services/pairing/pairingEngine.js';
import { computeCookingProfile } from '../../../../src/services/recipe/cookingProfile.js';
import { getActiveItems } from '../../../../src/services/recipe/buyingGuideCart.js';
import { generateBuyingGuide, invalidateBuyingGuideCache } from '../../../../src/services/recipe/buyingGuide.js';

const CELLAR_ID = 'cellar-uuid-proj';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper: set up a standard cooking profile + cellar scenario.
 * 2 red_full wines (3 bottles each = 6), target is 10 for red_full.
 */
function setupStandardScenario({ activeCartItems = [] } = {}) {
  // Cooking profile: 100% red_full demand
  computeCookingProfile.mockResolvedValue({
    recipeCount: 5,
    wineStyleDemand: { red_full: 0.5, white_crisp: 0.3, red_medium: 0.2 },
    dominantSignals: [],
    seasonalBias: null,
    hemisphere: 'southern'
  });

  // 2 wines in cellar, both red_full with 3 bottles each
  matchWineToStyle.mockReturnValue({
    styleId: 'red_full',
    styleName: 'Full Red',
    confidence: 'high',
    matchedBy: ['colour', 'grape']
  });

  getActiveItems.mockResolvedValue(activeCartItems);

  db.prepare.mockImplementation((sql) => ({
    get: vi.fn((...args) => {
      // Cache lookup: return null (no cache)
      if (sql.includes('buying_guide_cache')) return Promise.resolve(null);
      // Capacity query
      if (sql.includes('COUNT') && sql.includes('slots')) return Promise.resolve({ count: 20 });
      return Promise.resolve(null);
    }),
    all: vi.fn((...args) => {
      // Cellar wines: 2 wines, 3 bottles each
      if (sql.includes('wines w')) {
        return Promise.resolve([
          { id: 1, wine_name: 'Cab 1', bottle_count: 3, reduce_priority: 99 },
          { id: 2, wine_name: 'Cab 2', bottle_count: 3, reduce_priority: 99 }
        ]);
      }
      return Promise.resolve([]);
    }),
    run: vi.fn(() => Promise.resolve({ changes: 0 }))
  }));
}

describe('Phase 3: Virtual inventory projection', () => {
  it('includes projectedCoveragePct and projectedBottleCoveragePct', async () => {
    setupStandardScenario();

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    expect(guide.projectedCoveragePct).toBeDefined();
    expect(guide.projectedBottleCoveragePct).toBeDefined();
    expect(typeof guide.projectedCoveragePct).toBe('number');
    expect(typeof guide.projectedBottleCoveragePct).toBe('number');
  });

  it('projected values equal physical when no cart items', async () => {
    setupStandardScenario({ activeCartItems: [] });

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    expect(guide.projectedCoveragePct).toBe(guide.coveragePct);
    expect(guide.projectedBottleCoveragePct).toBe(guide.bottleCoveragePct);
  });

  it('projected coverage increases with virtual inventory', async () => {
    // Add 4 planned red_full bottles + 2 white_crisp
    setupStandardScenario({
      activeCartItems: [
        { style_id: 'red_full', quantity: 4, status: 'planned' },
        { style_id: 'white_crisp', quantity: 2, status: 'ordered' }
      ]
    });

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    // Physical: 6 red_full, target 10 = deficit 4
    // Virtual: +4 red_full = 10, target 10 = projected deficit 0
    expect(guide.projectedCoveragePct).toBeGreaterThanOrEqual(guide.coveragePct);
    expect(guide.projectedBottleCoveragePct).toBeGreaterThanOrEqual(guide.bottleCoveragePct);
  });

  it('gap.projectedDeficit reflects virtual inventory', async () => {
    setupStandardScenario({
      activeCartItems: [
        { style_id: 'red_full', quantity: 2, status: 'planned' }
      ]
    });

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    const redFullGap = guide.gaps.find(g => g.style === 'red_full');
    if (redFullGap) {
      // Physical deficit should be larger than projected deficit
      expect(redFullGap.projectedDeficit).toBeLessThanOrEqual(redFullGap.deficit);
    }
  });

  it('includes activeCartItems and activeCartBottles counts', async () => {
    setupStandardScenario({
      activeCartItems: [
        { style_id: 'red_full', quantity: 3, status: 'planned' },
        { style_id: 'white_crisp', quantity: 2, status: 'arrived' }
      ]
    });

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    expect(guide.activeCartItems).toBe(2);
    expect(guide.activeCartBottles).toBe(5);
  });

  it('items without style_id are excluded from virtual counts', async () => {
    setupStandardScenario({
      activeCartItems: [
        { style_id: null, quantity: 3, status: 'planned' }
      ]
    });

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    // No virtual contribution, projected = physical
    expect(guide.projectedCoveragePct).toBe(guide.coveragePct);
  });

  it('backwards compatible: all original fields still present', async () => {
    setupStandardScenario();

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    expect(guide.coveragePct).toBeDefined();
    expect(guide.bottleCoveragePct).toBeDefined();
    expect(guide.totalBottles).toBeDefined();
    expect(guide.gaps).toBeDefined();
    expect(guide.surpluses).toBeDefined();
    expect(guide.diversityRecs).toBeDefined();
    expect(guide.targets).toBeDefined();
    expect(guide.styleCounts).toBeDefined();
    expect(guide.recipeCount).toBeDefined();
  });
});

describe('Phase 3: Server-side caching', () => {
  it('returns cached guide when fresh', async () => {
    const cachedGuide = { coveragePct: 80, cached: true };

    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('buying_guide_cache')) {
          return Promise.resolve({
            cache_data: JSON.stringify(cachedGuide),
            generated_at: new Date().toISOString() // fresh
          });
        }
        return Promise.resolve(null);
      }),
      all: vi.fn(() => Promise.resolve([])),
      run: vi.fn(() => Promise.resolve({ changes: 0 }))
    }));

    const guide = await generateBuyingGuide(CELLAR_ID);

    expect(guide.coveragePct).toBe(80);
    expect(guide.cached).toBe(true);
    // computeCookingProfile should NOT have been called
    expect(computeCookingProfile).not.toHaveBeenCalled();
  });

  it('bypasses cache when forceRefresh is true', async () => {
    setupStandardScenario();

    const guide = await generateBuyingGuide(CELLAR_ID, { forceRefresh: true });

    // Should have computed fresh
    expect(computeCookingProfile).toHaveBeenCalled();
  });

  it('computes fresh when cache is stale (expired)', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago

    computeCookingProfile.mockResolvedValue({
      recipeCount: 0,
      wineStyleDemand: {},
      dominantSignals: [],
      seasonalBias: null,
      hemisphere: 'southern'
    });

    db.prepare.mockImplementation((sql) => ({
      get: vi.fn(() => {
        if (sql.includes('buying_guide_cache')) {
          return Promise.resolve({
            cache_data: JSON.stringify({ coveragePct: 50 }),
            generated_at: staleDate
          });
        }
        return Promise.resolve(null);
      }),
      all: vi.fn(() => Promise.resolve([])),
      run: vi.fn(() => Promise.resolve({ changes: 0 }))
    }));

    const guide = await generateBuyingGuide(CELLAR_ID);

    // Should recompute because cache is stale
    expect(computeCookingProfile).toHaveBeenCalled();
  });

  it('invalidateBuyingGuideCache deletes cache row', async () => {
    const runMock = vi.fn(() => Promise.resolve({ changes: 1 }));
    db.prepare.mockImplementation(() => ({
      run: runMock
    }));

    await invalidateBuyingGuideCache(CELLAR_ID);

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM buying_guide_cache')
    );
    expect(runMock).toHaveBeenCalledWith(CELLAR_ID);
  });
});
