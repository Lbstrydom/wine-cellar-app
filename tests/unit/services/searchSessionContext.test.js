/**
 * @fileoverview Unit tests for SearchSessionContext service.
 * Tests Phase 3: Search Breadth Governance.
 */

import {
  SearchSessionContext,
  BUDGET_PRESETS,
  EXTRACTION_LADDER,
  ESCALATION_REASONS,
  CONFIDENCE_LEVELS
} from '../../../src/services/searchSessionContext.js';

describe('SearchSessionContext', () => {
  describe('Initialization', () => {
    it('should initialize with standard mode by default', () => {
      const ctx = new SearchSessionContext();

      expect(ctx.mode).toBe('standard');
      expect(ctx.budget).toEqual(BUDGET_PRESETS.standard);
      expect(ctx.spent).toEqual({
        serpCalls: 0,
        unlockerCalls: 0,
        claudeExtractions: 0
      });
    });

    it('should initialize with specified mode', () => {
      const ctx = new SearchSessionContext({ mode: 'important' });

      expect(ctx.mode).toBe('important');
      expect(ctx.budget).toEqual(BUDGET_PRESETS.important);
    });

    it('should initialize with custom budget', () => {
      const customBudget = {
        maxSerpCalls: 10,
        maxUnlockerCalls: 3,
        maxClaudeExtractions: 4,
        earlyStopThreshold: 5,
        allowEscalation: true
      };

      const ctx = new SearchSessionContext({ customBudget });

      expect(ctx.budget).toEqual(customBudget);
    });

    it('should store wine fingerprint and metadata', () => {
      const ctx = new SearchSessionContext({
        wineFingerprint: 'producer|cuvee|varietal|2019|fr:bordeaux',
        metadata: { userId: 123, importance: 'high' }
      });

      expect(ctx.wineFingerprint).toBe('producer|cuvee|varietal|2019|fr:bordeaux');
      expect(ctx.metadata).toEqual({ userId: 123, importance: 'high' });
    });

    it('should throw error for invalid mode', () => {
      expect(() => {
        new SearchSessionContext({ mode: 'invalid' });
      }).toThrow('Invalid budget mode: invalid');
    });
  });

  describe('Budget Checking', () => {
    let ctx;

    beforeEach(() => {
      ctx = new SearchSessionContext({ mode: 'standard' });
    });

    it('should allow SERP calls within budget', () => {
      expect(ctx.canMakeSerpCall()).toBe(true);

      // Make 6 calls (standard limit)
      for (let i = 0; i < 6; i++) {
        ctx.recordSerpCall('query', 5);
      }

      expect(ctx.canMakeSerpCall()).toBe(false);
    });

    it('should allow unlocker calls within budget', () => {
      expect(ctx.canUseUnlocker()).toBe(true);

      // Make 2 calls (standard limit)
      ctx.recordUnlockerCall('url1', true);
      ctx.recordUnlockerCall('url2', true);

      expect(ctx.canUseUnlocker()).toBe(false);
    });

    it('should allow Claude extractions within budget', () => {
      expect(ctx.canUseClaudeExtraction()).toBe(true);

      // Make 2 calls (standard limit)
      ctx.recordClaudeExtraction('vivino', 3);
      ctx.recordClaudeExtraction('decanter', 2);

      expect(ctx.canUseClaudeExtraction()).toBe(false);
    });
  });

  describe('Recording Operations', () => {
    let ctx;

    beforeEach(() => {
      ctx = new SearchSessionContext();
    });

    it('should record SERP calls', () => {
      ctx.recordSerpCall('bordeaux 2019', 10);

      expect(ctx.spent.serpCalls).toBe(1);
      expect(ctx.extractionHistory).toHaveLength(1);
      expect(ctx.extractionHistory[0]).toMatchObject({
        method: 'serp',
        query: 'bordeaux 2019',
        resultCount: 10
      });
    });

    it('should record unlocker calls', () => {
      ctx.recordUnlockerCall('https://example.com', true);

      expect(ctx.spent.unlockerCalls).toBe(1);
      expect(ctx.extractionHistory).toHaveLength(1);
      expect(ctx.extractionHistory[0]).toMatchObject({
        method: 'unlocker',
        url: 'https://example.com',
        success: true
      });
    });

    it('should record Claude extractions', () => {
      ctx.recordClaudeExtraction('vivino', 5);

      expect(ctx.spent.claudeExtractions).toBe(1);
      expect(ctx.extractionHistory).toHaveLength(1);
      expect(ctx.extractionHistory[0]).toMatchObject({
        method: 'claude',
        source: 'vivino',
        resultCount: 5
      });
    });

    it('should track multiple operations in history', () => {
      ctx.recordSerpCall('query1', 3);
      ctx.recordUnlockerCall('url1', true);
      ctx.recordClaudeExtraction('source1', 2);

      expect(ctx.extractionHistory).toHaveLength(3);
      expect(ctx.extractionHistory[0].method).toBe('serp');
      expect(ctx.extractionHistory[1].method).toBe('unlocker');
      expect(ctx.extractionHistory[2].method).toBe('claude');
    });
  });

  describe('Results Tracking', () => {
    let ctx;

    beforeEach(() => {
      ctx = new SearchSessionContext();
    });

    it('should validate confidence level on addResult', () => {
      expect(() => {
        ctx.addResult({
          confidence: 'invalid',
          source: 'test',
          data: {}
        });
      }).toThrow('Invalid confidence level');
    });

    it('should accept only valid confidence levels', () => {
      expect(() => {
        ctx.addResult({
          confidence: CONFIDENCE_LEVELS.HIGH,
          source: 'test',
          data: {}
        });
      }).not.toThrow();

      expect(() => {
        ctx.addResult({
          confidence: CONFIDENCE_LEVELS.MEDIUM,
          source: 'test',
          data: {}
        });
      }).not.toThrow();

      expect(() => {
        ctx.addResult({
          confidence: CONFIDENCE_LEVELS.LOW,
          source: 'test',
          data: {}
        });
      }).not.toThrow();
    });

    it('should track high confidence results', () => {
      ctx.addResult({
        confidence: CONFIDENCE_LEVELS.HIGH,
        source: 'vivino',
        data: { rating: 4.5 }
      });

      expect(ctx.results).toHaveLength(1);
      expect(ctx.highConfidenceCount).toBe(1);
      expect(ctx.mediumConfidenceCount).toBe(0);
      expect(ctx.lowConfidenceCount).toBe(0);
    });

    it('should track medium confidence results', () => {
      ctx.addResult({
        confidence: CONFIDENCE_LEVELS.MEDIUM,
        source: 'decanter',
        data: { rating: 90 }
      });

      expect(ctx.mediumConfidenceCount).toBe(1);
    });

    it('should track low confidence results', () => {
      ctx.addResult({
        confidence: CONFIDENCE_LEVELS.LOW,
        source: 'unknown',
        data: {}
      });

      expect(ctx.lowConfidenceCount).toBe(1);
    });

    it('should track mixed confidence results', () => {
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's1', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's2', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.MEDIUM, source: 's3', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.LOW, source: 's4', data: {} });

      expect(ctx.results).toHaveLength(4);
      expect(ctx.highConfidenceCount).toBe(2);
      expect(ctx.mediumConfidenceCount).toBe(1);
      expect(ctx.lowConfidenceCount).toBe(1);
    });

    it('should add timestamp to results', () => {
      const before = Date.now();
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 'test', data: {} });
      const after = Date.now();

      expect(ctx.results[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(ctx.results[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Early Stop Logic', () => {
    it('should not stop with insufficient results', () => {
      const ctx = new SearchSessionContext({ mode: 'standard' }); // threshold = 3

      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's1', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's2', data: {} });

      expect(ctx.shouldEarlyStop()).toBe(false);
      expect(ctx.stopped).toBe(false);
    });

    it('should stop when reaching high confidence threshold', () => {
      const ctx = new SearchSessionContext({ mode: 'standard' }); // threshold = 3

      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's1', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's2', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's3', data: {} });

      expect(ctx.shouldEarlyStop()).toBe(true);
      expect(ctx.stopped).toBe(true);
      expect(ctx.stopReason).toBe('sufficient_high_confidence_results');
    });

    it('should not count medium/low confidence toward early stop', () => {
      const ctx = new SearchSessionContext({ mode: 'standard' }); // threshold = 3

      ctx.addResult({ confidence: CONFIDENCE_LEVELS.MEDIUM, source: 's1', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.MEDIUM, source: 's2', data: {} });
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.LOW, source: 's3', data: {} });

      expect(ctx.shouldEarlyStop()).toBe(false);
    });

    it('should remain stopped once stopped', () => {
      const ctx = new SearchSessionContext({ mode: 'standard' });

      for (let i = 0; i < 3; i++) {
        ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: `s${i}`, data: {} });
      }

      expect(ctx.shouldEarlyStop()).toBe(true);
      expect(ctx.shouldEarlyStop()).toBe(true); // Still stopped
    });

    it('should use different thresholds per mode', () => {
      const standard = new SearchSessionContext({ mode: 'standard' });
      const important = new SearchSessionContext({ mode: 'important' });
      const deep = new SearchSessionContext({ mode: 'deep' });

      // Add 4 high confidence results to each
      for (let i = 0; i < 4; i++) {
        standard.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: `s${i}`, data: {} });
        important.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: `s${i}`, data: {} });
        deep.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: `s${i}`, data: {} });
      }

      expect(standard.shouldEarlyStop()).toBe(true); // threshold = 3
      expect(important.shouldEarlyStop()).toBe(false); // threshold = 5
      expect(deep.shouldEarlyStop()).toBe(false); // threshold = 8
    });
  });

  describe('Budget Escalation', () => {
    it('should not escalate when disallowed', () => {
      const ctx = new SearchSessionContext({ mode: 'standard' }); // allowEscalation = false

      const escalated = ctx.requestEscalation('scarce_sources');

      expect(escalated).toBe(false);
      expect(ctx.escalated).toBe(false);
      expect(ctx.mode).toBe('standard');
    });

    it('should escalate standard to important', () => {
      const ctx = new SearchSessionContext({ mode: 'important' }); // allowEscalation = true

      const before = { ...ctx.budget };
      const escalated = ctx.requestEscalation('scarce_sources');

      expect(escalated).toBe(true);
      expect(ctx.escalated).toBe(true);
      expect(ctx.escalationReason).toBe('scarce_sources');
      expect(ctx.mode).toBe('deep');
      expect(ctx.budget.maxSerpCalls).toBeGreaterThan(before.maxSerpCalls);
    });

    it('should escalate important to deep', () => {
      const ctx = new SearchSessionContext({ mode: 'important' });

      ctx.requestEscalation('high_fingerprint_confidence');

      expect(ctx.mode).toBe('deep');
      expect(ctx.budget).toEqual(BUDGET_PRESETS.deep);
    });

    it('should not escalate twice', () => {
      const ctx = new SearchSessionContext({ mode: 'important' });

      const first = ctx.requestEscalation('scarce_sources');
      const second = ctx.requestEscalation('user_important');

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(ctx.mode).toBe('deep');
    });

    it('should throw error for invalid escalation reason', () => {
      const ctx = new SearchSessionContext({ mode: 'important' });

      expect(() => {
        ctx.requestEscalation('invalid_reason');
      }).toThrow('Invalid escalation reason: invalid_reason');
    });

    it('should accept all valid escalation reasons', () => {
      const reasons = Object.keys(ESCALATION_REASONS);

      reasons.forEach(reason => {
        const ctx = new SearchSessionContext({ mode: 'important' });
        const escalated = ctx.requestEscalation(reason);
        expect(escalated).toBe(true);
      });
    });
  });

  describe('Extraction Ladder', () => {
    let ctx;

    beforeEach(() => {
      ctx = new SearchSessionContext({ mode: 'standard' });
    });

    it('should start with structured_parse', () => {
      const method = ctx.getNextExtractionMethod(0);

      expect(method.method).toBe('structured_parse');
      expect(method.costCents).toBe(0);
      expect(method.level).toBe(0);
    });

    it('should escalate through ladder', () => {
      const methods = [];
      for (let i = 0; i < EXTRACTION_LADDER.length; i++) {
        const method = ctx.getNextExtractionMethod(i);
        if (method) methods.push(method.method);
      }

      expect(methods).toContain('structured_parse');
      expect(methods).toContain('regex_extract');
      expect(methods).toContain('page_fetch');
      expect(methods).toContain('unlocker_fetch');
      expect(methods).toContain('claude_extract');
    });

    it('should skip methods when budget exhausted', () => {
      // Exhaust unlocker budget
      ctx.recordUnlockerCall('url1', true);
      ctx.recordUnlockerCall('url2', true);

      // Exhaust Claude budget
      ctx.recordClaudeExtraction('s1', 1);
      ctx.recordClaudeExtraction('s2', 1);

      const unlockerIndex = EXTRACTION_LADDER.findIndex(m => m.method === 'unlocker_fetch');
      const method = ctx.getNextExtractionMethod(unlockerIndex);

      // Should skip unlocker and claude, return null
      expect(method).toBeNull();
    });

    it('should return null when ladder exhausted', () => {
      const method = ctx.getNextExtractionMethod(100);
      expect(method).toBeNull();
    });
  });

  describe('Cost Calculation', () => {
    let ctx;

    beforeEach(() => {
      ctx = new SearchSessionContext();
    });

    it('should calculate cost correctly', () => {
      ctx.recordSerpCall('q1', 5); // 0.5 cents
      ctx.recordSerpCall('q2', 3); // 0.5 cents
      ctx.recordUnlockerCall('url1', true); // 2 cents
      ctx.recordClaudeExtraction('s1', 2); // 5 cents

      const cost = ctx.getTotalCostCents();

      expect(cost).toBe(8); // 0.5 + 0.5 + 2 + 5 = 8 cents
    });

    it('should return zero cost for new session', () => {
      expect(ctx.getTotalCostCents()).toBe(0);
    });

    it('should format cost correctly in summary', () => {
      ctx.recordSerpCall('q1', 5);
      ctx.recordUnlockerCall('url1', true);
      ctx.recordClaudeExtraction('s1', 2);

      const summary = ctx.getSummary();

      expect(summary.cost.totalCents).toBe(7.5); // 0.5 + 2 + 5 = 7.5
      expect(summary.cost.formatted).toBe('$0.075');
    });
  });

  describe('Budget Utilization', () => {
    it('should calculate utilization percentages', () => {
      const ctx = new SearchSessionContext({ mode: 'standard' });
      // Limits: 6 SERP, 2 unlocker, 2 Claude

      ctx.recordSerpCall('q1', 5); // 1/6 = 16.67%
      ctx.recordUnlockerCall('url1', true); // 1/2 = 50%
      ctx.recordClaudeExtraction('s1', 2); // 1/2 = 50%

      const util = ctx.getBudgetUtilization();

      expect(util.serpCalls).toBeCloseTo(16.67, 1);
      expect(util.unlockerCalls).toBe(50);
      expect(util.claudeExtractions).toBe(50);
    });

    it('should show 100% when budget exhausted', () => {
      const ctx = new SearchSessionContext({ mode: 'standard' });

      // Exhaust SERP budget (6 calls)
      for (let i = 0; i < 6; i++) {
        ctx.recordSerpCall(`q${i}`, 5);
      }

      const util = ctx.getBudgetUtilization();
      expect(util.serpCalls).toBe(100);
    });
  });

  describe('Session Summary', () => {
    it('should provide comprehensive summary', () => {
      const ctx = new SearchSessionContext({
        mode: 'standard',
        wineFingerprint: 'producer|cuvee|varietal|2019|fr'
      });

      ctx.recordSerpCall('query', 5);
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's1', data: {} });

      const summary = ctx.getSummary();

      expect(summary).toHaveProperty('mode', 'standard');
      expect(summary).toHaveProperty('wineFingerprint', 'producer|cuvee|varietal|2019|fr');
      expect(summary).toHaveProperty('budget');
      expect(summary).toHaveProperty('spent');
      expect(summary).toHaveProperty('utilization');
      expect(summary).toHaveProperty('results');
      expect(summary).toHaveProperty('cost');
      expect(summary).toHaveProperty('session');
      expect(summary).toHaveProperty('extractionHistory');
    });

    it('should track session duration', () => {
      const ctx = new SearchSessionContext();
      const before = Date.now();

      // Simulate some work
      ctx.recordSerpCall('query', 5);

      const after = Date.now();
      const duration = ctx.getDuration();

      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThanOrEqual(after - before);
    });
  });

  describe('JSON Serialization', () => {
    it('should serialize to JSON', () => {
      const ctx = new SearchSessionContext({
        mode: 'important',
        wineFingerprint: 'test|fingerprint|chardonnay|2020|fr'
      });

      ctx.recordSerpCall('query', 5);
      ctx.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's1', data: {} });

      const json = ctx.toJSON();

      expect(json.mode).toBe('important');
      expect(json.wineFingerprint).toBe('test|fingerprint|chardonnay|2020|fr');
      expect(json.spent.serpCalls).toBe(1);
    });

    it('should deserialize from JSON', () => {
      const original = new SearchSessionContext({ mode: 'deep' });
      original.recordSerpCall('query', 5);
      original.addResult({ confidence: CONFIDENCE_LEVELS.HIGH, source: 's1', data: {} });

      const json = original.toJSON();
      const restored = SearchSessionContext.fromJSON(json);

      expect(restored.mode).toBe(original.mode);
      expect(restored.spent).toEqual(original.spent);
      expect(restored.highConfidenceCount).toBe(original.highConfidenceCount);
    });
  });

  describe('BUDGET_PRESETS', () => {
    it('should define all required modes', () => {
      expect(BUDGET_PRESETS).toHaveProperty('standard');
      expect(BUDGET_PRESETS).toHaveProperty('important');
      expect(BUDGET_PRESETS).toHaveProperty('deep');
    });

    it('should have increasing limits from standard to deep', () => {
      expect(BUDGET_PRESETS.important.maxSerpCalls).toBeGreaterThan(
        BUDGET_PRESETS.standard.maxSerpCalls
      );
      expect(BUDGET_PRESETS.deep.maxSerpCalls).toBeGreaterThan(
        BUDGET_PRESETS.important.maxSerpCalls
      );
    });

    it('should only allow escalation for important and deep', () => {
      expect(BUDGET_PRESETS.standard.allowEscalation).toBe(false);
      expect(BUDGET_PRESETS.important.allowEscalation).toBe(true);
      expect(BUDGET_PRESETS.deep.allowEscalation).toBe(true);
    });
  });

  describe('EXTRACTION_LADDER', () => {
    it('should define all extraction methods', () => {
      const methods = EXTRACTION_LADDER.map(m => m.method);

      expect(methods).toContain('structured_parse');
      expect(methods).toContain('regex_extract');
      expect(methods).toContain('page_fetch');
      expect(methods).toContain('unlocker_fetch');
      expect(methods).toContain('claude_extract');
    });

    it('should have increasing costs', () => {
      for (let i = 1; i < EXTRACTION_LADDER.length; i++) {
        expect(EXTRACTION_LADDER[i].costCents).toBeGreaterThanOrEqual(
          EXTRACTION_LADDER[i - 1].costCents
        );
      }
    });
  });
});
