/**
 * @fileoverview Unit tests for wineAddOrchestrator.
 * Exercises the orchestration pipeline (fingerprinting, duplicate detection,
 * scoring, auto-select) without requiring DATABASE_URL.
 */

// --- Mocks (must come before imports) ---

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

vi.mock('../../../../src/config/featureFlags.js', () => ({
  default: {
    WINE_ADD_ORCHESTRATOR_ENABLED: false, // Disable external search by default
    SEARCH_CACHE_ENABLED: false
  },
  FEATURE_FLAGS: {
    WINE_ADD_ORCHESTRATOR_ENABLED: false,
    SEARCH_CACHE_ENABLED: false
  }
}));

vi.mock('../../../../src/services/scraping/vivinoSearch.js', () => ({
  searchVivinoWines: vi.fn().mockResolvedValue({ matches: [] })
}));

vi.mock('../../../../src/services/search/searchCache.js', () => ({
  lookupWineSearchCache: vi.fn().mockResolvedValue(null),
  storeWineSearchCache: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import db from '../../../../src/db/index.js';
import { evaluateWineAdd, PIPELINE_VERSION } from '../../../../src/services/wine/wineAddOrchestrator.js';

const TEST_CELLAR = 'cellar-unit-test-001';

describe('wineAddOrchestrator (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default DB mocks: no duplicates, metrics insert succeeds
    const mockAll = vi.fn().mockResolvedValue([]);
    const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
    db.prepare.mockReturnValue({ all: mockAll, run: mockRun, get: vi.fn().mockResolvedValue(null) });
  });

  describe('fingerprint generation', () => {
    it('generates fingerprint for valid wine input', async () => {
      const result = await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'Kanonkop Paul Sauer',
          producer: 'Kanonkop',
          vintage: 2019,
          country: 'South Africa',
          region: 'Stellenbosch'
        }
      });

      expect(result.fingerprint).toBeTruthy();
      expect(typeof result.fingerprint).toBe('string');
      expect(result.fingerprint_version).toBeGreaterThanOrEqual(1);
    });

    it('still generates a fallback fingerprint for minimal input', async () => {
      const result = await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {}
      });

      // WineFingerprint generates a fallback even with empty input
      expect(result.fingerprint).toBeTruthy();
      expect(result.fingerprint_version).toBeGreaterThanOrEqual(1);
      expect(result.matches).toEqual([]);
    });

    it('same wine produces same fingerprint', async () => {
      const input = {
        wine_name: 'Ridge Monte Bello',
        producer: 'Ridge Vineyards',
        vintage: 2018,
        country: 'USA'
      };

      const result1 = await evaluateWineAdd({ cellarId: TEST_CELLAR, input });
      const result2 = await evaluateWineAdd({ cellarId: TEST_CELLAR, input });

      expect(result1.fingerprint).toBe(result2.fingerprint);
    });
  });

  describe('duplicate detection', () => {
    it('returns empty duplicates when DB has no matches', async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([]),
        run: vi.fn().mockResolvedValue({ changes: 1 })
      });

      const result = await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'Unique Wine',
          vintage: 2022,
          country: 'France'
        }
      });

      expect(result.duplicates).toEqual([]);
    });

    it('returns duplicates when DB finds matching fingerprint', async () => {
      const mockDuplicate = {
        id: 42,
        wine_name: 'Existing Wine',
        vintage: 2022,
        colour: 'Red',
        style: 'Cabernet Sauvignon'
      };

      // First prepare call = findDuplicateWines, second = recordSearchMetrics
      let callCount = 0;
      db.prepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { all: vi.fn().mockResolvedValue([mockDuplicate]) };
        }
        return { run: vi.fn().mockResolvedValue({ changes: 1 }) };
      });

      const result = await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'Existing Wine',
          vintage: 2022,
          country: 'France'
        }
      });

      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].id).toBe(42);
      expect(result.duplicates[0].wine_name).toBe('Existing Wine');
    });

    it('queries duplicates with cellar_id scope', async () => {
      const mockAll = vi.fn().mockResolvedValue([]);
      const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
      db.prepare.mockReturnValue({ all: mockAll, run: mockRun });

      await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'Test Wine',
          vintage: 2020,
          country: 'Italy'
        }
      });

      // First db.prepare call should be the duplicate query
      const firstCall = db.prepare.mock.calls[0][0];
      expect(firstCall).toContain('cellar_id');
      expect(firstCall).toContain('fingerprint');
      expect(mockAll).toHaveBeenCalledWith(TEST_CELLAR, expect.any(String));
    });
  });

  describe('response structure', () => {
    it('includes all required fields', async () => {
      const result = await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'Penfolds Grange',
          producer: 'Penfolds',
          vintage: 2017,
          country: 'Australia'
        }
      });

      expect(result).toHaveProperty('fingerprint');
      expect(result).toHaveProperty('fingerprint_version');
      expect(result).toHaveProperty('pipeline_version', PIPELINE_VERSION);
      expect(result).toHaveProperty('query_hash');
      expect(result).toHaveProperty('duplicates');
      expect(result).toHaveProperty('matches');
      expect(result).toHaveProperty('auto_select');
      expect(result).toHaveProperty('cache_hit', false);
    });

    it('auto_select has correct shape when no matches', async () => {
      const result = await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'No Match Wine',
          vintage: 2020,
          country: 'Chile'
        }
      });

      expect(result.auto_select).toHaveProperty('autoSelect', false);
      expect(result.auto_select).toHaveProperty('reason', 'no_matches');
    });
  });

  describe('metrics recording', () => {
    it('records search metrics after evaluation', async () => {
      const mockRun = vi.fn().mockResolvedValue({ changes: 1 });
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([]),
        run: mockRun
      });

      await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'Metrics Test Wine',
          vintage: 2021,
          country: 'Spain'
        }
      });

      // Should have at least 2 prepare calls: findDuplicates + recordMetrics
      expect(db.prepare).toHaveBeenCalledTimes(2);
      const metricsSql = db.prepare.mock.calls[1][0];
      expect(metricsSql).toContain('search_metrics');
    });

    it('does not throw when metrics insert fails', async () => {
      let callCount = 0;
      db.prepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { all: vi.fn().mockResolvedValue([]) };
        }
        // Metrics insert fails
        return { run: vi.fn().mockRejectedValue(new Error('metrics table missing')) };
      });

      // Should not throw
      const result = await evaluateWineAdd({
        cellarId: TEST_CELLAR,
        input: {
          wine_name: 'Resilient Wine',
          vintage: 2020,
          country: 'Argentina'
        }
      });

      expect(result.fingerprint).toBeTruthy();
    });
  });

  describe('pipeline version', () => {
    it('exports PIPELINE_VERSION constant', () => {
      expect(typeof PIPELINE_VERSION).toBe('number');
      expect(PIPELINE_VERSION).toBeGreaterThanOrEqual(1);
    });
  });
});
