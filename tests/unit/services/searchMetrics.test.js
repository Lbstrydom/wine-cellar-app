import { describe, it, expect, beforeEach } from 'vitest';
import { SearchMetricsCollector } from '../../../src/services/searchMetrics.js';

describe('SearchMetricsCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new SearchMetricsCollector();
  });

  describe('SERP Call Recording', () => {
    it('should correctly count SERP calls', () => {
      collector.recordSerpCall('Chateau Margaux', 5);
      collector.recordSerpCall('Barossa Shiraz', 3);
      collector.recordSerpCall('Burgundy Pinot', 0);

      const current = collector.getCurrent();
      expect(current.serpCalls).toBe(3);
    });

    it('should track SERP calls by domain', () => {
      collector.recordSerpCall('wine1', 5, 'vivino.com');
      collector.recordSerpCall('wine2', 3, 'vivino.com');
      collector.recordSerpCall('wine3', -1, 'wine-searcher.com'); // -1 indicates blocked

      expect(collector.metrics.hitsByDomain['vivino.com']).toEqual({
        calls: 2,
        hits: 2,
        blocked: 0
      });

      expect(collector.metrics.hitsByDomain['wine-searcher.com']).toEqual({
        calls: 1,
        hits: 0,
        blocked: 1
      });
    });

    it('should accumulate cost correctly for SERP calls', () => {
      collector.recordSerpCall('wine1', 5, 'domain1.com', 0.5);
      collector.recordSerpCall('wine2', 3, 'domain2.com', 0.5);

      const current = collector.getCurrent();
      expect(current.costEstimate).toBe(1); // 0.5 + 0.5
    });
  });

  describe('Unlocker Call Recording', () => {
    it('should correctly count unlocker calls', () => {
      collector.recordUnlockerCall('blocked-site.com', true);
      collector.recordUnlockerCall('another-site.com', false);

      const current = collector.getCurrent();
      expect(current.unlockerCalls).toBe(2);
    });

    it('should track unlocker success/failure by domain', () => {
      collector.recordUnlockerCall('vivino.com', true);
      collector.recordUnlockerCall('vivino.com', false);

      expect(collector.metrics.hitsByDomain['vivino.com']).toEqual({
        calls: 0,
        hits: 1,
        blocked: 1
      });
    });

    it('should accumulate cost correctly for unlocker calls', () => {
      collector.recordUnlockerCall('site1.com', true, 2);
      collector.recordUnlockerCall('site2.com', true, 2);

      const current = collector.getCurrent();
      expect(current.costEstimate).toBe(4); // 2 + 2
    });
  });

  describe('Claude Extraction Recording', () => {
    it('should correctly count Claude extractions', () => {
      collector.recordClaudeExtraction('competition', 3, 450);
      collector.recordClaudeExtraction('panel', 2, 320);

      const current = collector.getCurrent();
      expect(current.claudeExtractions).toBe(2);
    });

    it('should track extractions by lens', () => {
      collector.recordClaudeExtraction('competition', 3, 450);
      collector.recordClaudeExtraction('competition', 2, 380);

      expect(collector.metrics.hitsByLens['competition']).toEqual({
        extractions: 2,
        totalTokens: 830
      });
    });

    it('should accumulate cost correctly for Claude calls', () => {
      collector.recordClaudeExtraction('competition', 3, 450, 5);
      collector.recordClaudeExtraction('critic', 2, 320, 5);

      const current = collector.getCurrent();
      expect(current.costEstimate).toBe(10); // 5 + 5
    });
  });

  describe('Cache Hit/Miss Recording', () => {
    it('should track cache hits and misses', () => {
      collector.recordCacheHit('ratings');
      collector.recordCacheHit('vivino');
      collector.recordCacheMiss('ratings');

      const current = collector.getCurrent();
      expect(current.cacheHits).toBe(2);
      expect(current.cacheMisses).toBe(1);
    });

    it('should calculate cache hit rate correctly in summary', () => {
      collector.recordCacheHit();
      collector.recordCacheHit();
      collector.recordCacheMiss();

      const summary = collector.getSummary();
      expect(parseFloat(summary.cache.hitRate)).toBeCloseTo(0.667, 2);
    });

    it('should return 0 hit rate when no cache checks', () => {
      const summary = collector.getSummary();
      expect(parseFloat(summary.cache.hitRate)).toBe(0);
    });
  });

  describe('Lens Result Tracking', () => {
    it('should track hits and misses by lens', () => {
      collector.recordLensResult('competition', true);
      collector.recordLensResult('competition', true);
      collector.recordLensResult('competition', false);
      collector.recordLensResult('critic', true);

      expect(collector.metrics.hitsByLens['competition']).toEqual({
        hits: 2,
        misses: 1
      });

      expect(collector.metrics.hitsByLens['critic']).toEqual({
        hits: 1,
        misses: 0
      });
    });

    it('should calculate hit rate per lens', () => {
      collector.recordLensResult('panel', true);
      collector.recordLensResult('panel', true);
      collector.recordLensResult('panel', false);

      const summary = collector.getSummary();
      expect(summary.byLens['panel'].hitRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('getSummary()', () => {
    it('should calculate cost breakdown correctly', () => {
      collector.recordSerpCall('wine1', 5, 'domain1.com', 0.5);
      collector.recordSerpCall('wine2', 3, 'domain2.com', 0.5);
      collector.recordUnlockerCall('site1.com', true, 2);
      collector.recordClaudeExtraction('competition', 3, 450, 5);

      const summary = collector.getSummary();
      expect(summary.costBreakdown.serp).toBe(1); // 2 SERP × 0.5
      expect(summary.costBreakdown.unlocker).toBe(2); // 1 unlocker × 2
      expect(summary.costBreakdown.claude).toBe(5); // 1 claude × 5
    });

    it('should format cost as currency string', () => {
      collector.recordSerpCall('wine1', 5, 'domain1.com', 0.5);
      collector.recordUnlockerCall('site1.com', true, 2);

      const summary = collector.getSummary();
      expect(summary.summary.totalCost).toBe('$0.03'); // 0.5 + 2 = 2.5 cents = $0.025
    });

    it('should set endTime when getSummary called', () => {
      const startMetrics = collector.getCurrent();
      expect(startMetrics.endTime).toBe(null);

      const summary = collector.getSummary();
      expect(collector.metrics.endTime).not.toBe(null);
      expect(summary.summary.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('should include all metrics in summary', () => {
      collector.recordSerpCall('wine1', 5);
      collector.recordUnlockerCall('site1.com', true);
      collector.recordClaudeExtraction('competition', 3, 450);
      collector.recordCacheHit();
      collector.recordLensResult('panel', true);

      const summary = collector.getSummary();

      expect(summary.apiCalls.serpCalls).toBe(1);
      expect(summary.apiCalls.unlockerCalls).toBe(1);
      expect(summary.apiCalls.claudeExtractions).toBe(1);
      expect(summary.cache.hits).toBe(1);
      expect(summary.byLens.panel).toBeDefined();
    });
  });

  describe('reset()', () => {
    it('should reset all metrics to initial state', () => {
      collector.recordSerpCall('wine1', 5);
      collector.recordUnlockerCall('site1.com', true);
      collector.recordCacheHit();

      collector.reset();

      const current = collector.getCurrent();
      expect(current.serpCalls).toBe(0);
      expect(current.unlockerCalls).toBe(0);
      expect(current.cacheHits).toBe(0);
      expect(current.costEstimate).toBe(0);
      expect(Object.keys(current.hitsByDomain).length).toBe(0);
      expect(Object.keys(current.hitsByLens).length).toBe(0);
    });

    it('should reset startTime on reset', () => {
      const firstStart = collector.metrics.startTime;
      collector.reset();
      const secondStart = collector.metrics.startTime;

      expect(secondStart).toBeGreaterThanOrEqual(firstStart);
    });
  });

  describe('toJSON()', () => {
    it('should return valid JSON string', () => {
      collector.recordSerpCall('wine1', 5);
      collector.recordCacheHit();

      const json = collector.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.summary).toBeDefined();
      expect(parsed.apiCalls).toBeDefined();
      expect(parsed.cache).toBeDefined();
    });
  });

  describe('toString()', () => {
    it('should return formatted string summary', () => {
      collector.recordSerpCall('wine1', 5, 'domain1.com', 0.5);
      collector.recordUnlockerCall('site1.com', true, 2);
      collector.recordCacheHit();

      const str = collector.toString();

      expect(str).toContain('Search Metrics Summary');
      expect(str).toContain('Duration');
      expect(str).toContain('Total Cost');
      expect(str).toContain('API Calls');
    });
  });

  describe('Integration: Combined operations', () => {
    it('should handle complete search workflow metrics', () => {
      // Simulate a complete search with cache, SERP, unlocker, and Claude
      collector.recordCacheHit('ratings'); // Cache hit first
      collector.recordSerpCall('Chateau Margaux 2015', 8, 'vivino.com', 0.5);
      collector.recordUnlockerCall('blocked-site.com', true, 2);
      collector.recordClaudeExtraction('competition', 2, 320, 5);
      collector.recordLensResult('competition', true);
      collector.recordLensResult('panel', false);

      const summary = collector.getSummary();

      expect(summary.apiCalls.serpCalls).toBe(1);
      expect(summary.apiCalls.unlockerCalls).toBe(1);
      expect(summary.apiCalls.claudeExtractions).toBe(1);
      expect(summary.cache.hits).toBe(1);
      expect(summary.byLens.competition.hits).toBe(1);
      expect(summary.byLens.panel.misses).toBe(1);
      expect(parseFloat(summary.summary.costCents)).toBeCloseTo(7.5);
    });

    it('should match cost estimate accuracy within margin', () => {
      // Record multiple operations with known costs
      for (let i = 0; i < 5; i++) {
        collector.recordSerpCall(`wine${i}`, 3, 'vivino.com', 0.5);
      }
      for (let i = 0; i < 2; i++) {
        collector.recordUnlockerCall('site.com', true, 2);
      }
      collector.recordClaudeExtraction('competition', 3, 450, 5);

      const summary = collector.getSummary();
      const expectedCost = (5 * 0.5) + (2 * 2) + (1 * 5); // 5.5 cents
      const actualCost = summary.summary.costCents;

      // Should be within ±10% margin
      expect(actualCost).toBeCloseTo(expectedCost, 0);
    });
  });
});
