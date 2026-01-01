/**
 * @fileoverview Unit tests for rate limiter service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  waitForRateLimit,
  checkRateLimit,
  recordRequest,
  getTimeSinceLastRequest,
  resetRateLimit,
  getRateLimitStats,
  getRateLimit,
  DEFAULT_RATE_LIMITS
} from '../../../src/services/rateLimiter.js';

// Mock the logger
vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('DEFAULT_RATE_LIMITS', () => {
  it('should have rate limits for all lens types', () => {
    expect(DEFAULT_RATE_LIMITS.competition).toBeDefined();
    expect(DEFAULT_RATE_LIMITS.panel_guide).toBeDefined();
    expect(DEFAULT_RATE_LIMITS.critic).toBeDefined();
    expect(DEFAULT_RATE_LIMITS.community).toBeDefined();
    expect(DEFAULT_RATE_LIMITS.aggregator).toBeDefined();
    expect(DEFAULT_RATE_LIMITS.producer).toBeDefined();
    expect(DEFAULT_RATE_LIMITS.default).toBeDefined();
  });

  it('should have reasonable rate limits (1-10 seconds)', () => {
    for (const [key, value] of Object.entries(DEFAULT_RATE_LIMITS)) {
      expect(value, `${key} rate limit`).toBeGreaterThanOrEqual(1000);
      expect(value, `${key} rate limit`).toBeLessThanOrEqual(10000);
    }
  });
});

describe('getRateLimit', () => {
  it('should return custom rate limit from config', () => {
    const config = { rateLimitMs: 5000 };
    expect(getRateLimit('test', config)).toBe(5000);
  });

  it('should return lens-based rate limit when no custom', () => {
    const config = { lens: 'competition' };
    expect(getRateLimit('test', config)).toBe(DEFAULT_RATE_LIMITS.competition);
  });

  it('should return default when no config provided', () => {
    expect(getRateLimit('test')).toBe(DEFAULT_RATE_LIMITS.default);
  });

  it('should return default for unknown lens', () => {
    const config = { lens: 'unknown_lens' };
    expect(getRateLimit('test', config)).toBe(DEFAULT_RATE_LIMITS.default);
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('should return needsWait false for new source', () => {
    const result = checkRateLimit('new_source', 1000);
    expect(result.needsWait).toBe(false);
    expect(result.waitTimeMs).toBe(0);
  });

  it('should return needsWait true immediately after request', () => {
    recordRequest('test_source');
    const result = checkRateLimit('test_source', 1000);
    expect(result.needsWait).toBe(true);
    expect(result.waitTimeMs).toBeGreaterThan(0);
  });
});

describe('recordRequest', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('should record the request time', () => {
    const before = Date.now();
    recordRequest('test_source');
    const elapsed = getTimeSinceLastRequest('test_source');
    expect(elapsed).toBeDefined();
    expect(elapsed).toBeLessThan(100); // Should be nearly instant
  });
});

describe('getTimeSinceLastRequest', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('should return null for never-requested source', () => {
    expect(getTimeSinceLastRequest('never_used')).toBeNull();
  });

  it('should return elapsed time after request', () => {
    recordRequest('test_source');
    const elapsed = getTimeSinceLastRequest('test_source');
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('resetRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('should reset specific source', () => {
    recordRequest('source1');
    recordRequest('source2');
    resetRateLimit('source1');
    expect(getTimeSinceLastRequest('source1')).toBeNull();
    expect(getTimeSinceLastRequest('source2')).not.toBeNull();
  });

  it('should reset all sources when called with null', () => {
    recordRequest('source1');
    recordRequest('source2');
    resetRateLimit();
    expect(getTimeSinceLastRequest('source1')).toBeNull();
    expect(getTimeSinceLastRequest('source2')).toBeNull();
  });
});

describe('getRateLimitStats', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('should return empty stats initially', () => {
    const stats = getRateLimitStats();
    expect(stats.trackedSources).toBe(0);
    expect(stats.pendingWaits).toBe(0);
    expect(Object.keys(stats.sources)).toHaveLength(0);
  });

  it('should track recorded sources', () => {
    recordRequest('source1');
    recordRequest('source2');
    const stats = getRateLimitStats();
    expect(stats.trackedSources).toBe(2);
    expect(stats.sources.source1).toBeDefined();
    expect(stats.sources.source2).toBeDefined();
  });

  it('should include timestamps in stats', () => {
    recordRequest('source1');
    const stats = getRateLimitStats();
    expect(stats.sources.source1.lastRequestAt).toBeDefined();
    expect(stats.sources.source1.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('waitForRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('should not wait for first request', async () => {
    const start = Date.now();
    await waitForRateLimit('new_source', 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // Should be nearly instant
  });

  it('should wait for subsequent requests', async () => {
    await waitForRateLimit('test_source', 100);
    const start = Date.now();
    await waitForRateLimit('test_source', 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // Should wait ~100ms
  });
});
