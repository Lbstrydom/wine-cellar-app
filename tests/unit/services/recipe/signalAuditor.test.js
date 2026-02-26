/**
 * @fileoverview Unit tests for signal auditor service.
 * Tests env flag checking, prompt building, schema validation,
 * and graceful degradation.
 * @module tests/unit/services/recipe/signalAuditor.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: {
    messages: {
      create: vi.fn()
    }
  }
}));

vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn()
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../../../src/services/shared/circuitBreaker.js', () => ({
  isCircuitOpen: vi.fn(() => false),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn()
}));

vi.mock('../../../../src/services/shared/fetchUtils.js', () => ({
  createTimeoutAbort: vi.fn(() => ({
    controller: new AbortController(),
    cleanup: vi.fn()
  }))
}));

vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: vi.fn(() => 'claude-haiku-4-5-20251001')
}));

import { isSignalAuditEnabled, auditSignals } from '../../../../src/services/recipe/signalAuditor.js';
import anthropic from '../../../../src/services/ai/claudeClient.js';
import { extractText } from '../../../../src/services/ai/claudeResponseUtils.js';
import { isCircuitOpen } from '../../../../src/services/shared/circuitBreaker.js';

const sampleSignals = [
  { signal: 'chicken', weight: 32.1 },
  { signal: 'grilled', weight: 28.4 },
  { signal: 'fish', weight: 20.2 },
  { signal: 'acid', weight: 15.3 },
  { signal: 'garlic_onion', weight: 4.5 }
];

describe('isSignalAuditEnabled', () => {
  const originalEnv = process.env.CLAUDE_AUDIT_COOKING_PROFILE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_AUDIT_COOKING_PROFILE = originalEnv;
    } else {
      delete process.env.CLAUDE_AUDIT_COOKING_PROFILE;
    }
  });

  it('returns false when env var is not set', () => {
    delete process.env.CLAUDE_AUDIT_COOKING_PROFILE;
    expect(isSignalAuditEnabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env.CLAUDE_AUDIT_COOKING_PROFILE = 'true';
    expect(isSignalAuditEnabled()).toBe(true);
  });

  it('returns true when env var is "1"', () => {
    process.env.CLAUDE_AUDIT_COOKING_PROFILE = '1';
    expect(isSignalAuditEnabled()).toBe(true);
  });

  it('returns false for other values', () => {
    process.env.CLAUDE_AUDIT_COOKING_PROFILE = 'yes';
    expect(isSignalAuditEnabled()).toBe(false);
  });
});

describe('auditSignals', () => {
  const originalEnv = process.env.CLAUDE_AUDIT_COOKING_PROFILE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAUDE_AUDIT_COOKING_PROFILE = 'true';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_AUDIT_COOKING_PROFILE = originalEnv;
    } else {
      delete process.env.CLAUDE_AUDIT_COOKING_PROFILE;
    }
  });

  it('skips when disabled', async () => {
    process.env.CLAUDE_AUDIT_COOKING_PROFILE = 'false';
    const result = await auditSignals(sampleSignals, 100);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/disabled/i);
  });

  it('skips when no signals provided', async () => {
    const result = await auditSignals([], 100);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/no signals/i);
  });

  it('skips when circuit breaker is open', async () => {
    isCircuitOpen.mockReturnValueOnce(true);
    const result = await auditSignals(sampleSignals, 100);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/circuit breaker/i);
  });

  it('returns audited result on successful LLM call', async () => {
    const auditResponse = {
      verdict: 'approve',
      confidence: 'high',
      reasoning: 'Signals look good for wine pairing.',
      issues: [],
      suggestedDemotion: []
    };

    extractText.mockReturnValue(JSON.stringify(auditResponse));
    anthropic.messages.create.mockResolvedValue({ content: [{ type: 'text', text: '' }] });

    const result = await auditSignals(sampleSignals, 100, { chicken: 40, grilled: 30, fish: 20, acid: 15, garlic_onion: 90 });

    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('approve');
    expect(result.confidence).toBe('high');
    expect(result.latencyMs).toBeDefined();
  });

  it('returns flagged result when LLM flags issues', async () => {
    const auditResponse = {
      verdict: 'flag',
      confidence: 'medium',
      reasoning: 'garlic_onion is still too prominent.',
      issues: [
        { signal: 'garlic_onion', severity: 'warning', description: 'Ubiquitous seasoning' }
      ],
      suggestedDemotion: ['garlic_onion']
    };

    extractText.mockReturnValue(JSON.stringify(auditResponse));
    anthropic.messages.create.mockResolvedValue({ content: [{ type: 'text', text: '' }] });

    const result = await auditSignals(sampleSignals, 100);

    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('flag');
    expect(result.issues).toHaveLength(1);
    expect(result.suggestedDemotion).toContain('garlic_onion');
  });

  it('gracefully handles LLM failure', async () => {
    anthropic.messages.create.mockRejectedValue(new Error('API timeout'));

    const result = await auditSignals(sampleSignals, 100);

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/API timeout/);
    expect(result.latencyMs).toBeDefined();
  });

  it('normalises invalid confidence to medium', async () => {
    const auditResponse = {
      verdict: 'approve',
      confidence: 'ultra-high',
      reasoning: 'All good',
      issues: [],
      suggestedDemotion: []
    };

    extractText.mockReturnValue(JSON.stringify(auditResponse));
    anthropic.messages.create.mockResolvedValue({ content: [{ type: 'text', text: '' }] });

    const result = await auditSignals(sampleSignals, 100);

    expect(result.confidence).toBe('medium');
  });

  it('downgrades optimize verdict to flag', async () => {
    const auditResponse = {
      verdict: 'optimize',
      confidence: 'high',
      reasoning: 'Some signals need work',
      issues: [],
      suggestedDemotion: []
    };

    extractText.mockReturnValue(JSON.stringify(auditResponse));
    anthropic.messages.create.mockResolvedValue({ content: [{ type: 'text', text: '' }] });

    const result = await auditSignals(sampleSignals, 100);

    expect(result.verdict).toBe('flag');
  });

  it('includes doc frequency percentages in prompt', async () => {
    const auditResponse = {
      verdict: 'approve',
      confidence: 'high',
      reasoning: 'OK',
      issues: [],
      suggestedDemotion: []
    };

    extractText.mockReturnValue(JSON.stringify(auditResponse));
    anthropic.messages.create.mockResolvedValue({ content: [{ type: 'text', text: '' }] });

    const docFreq = { chicken: 40, garlic_onion: 90 };
    await auditSignals(sampleSignals, 100, docFreq);

    // Check the prompt passed to Claude contains frequency info
    const callArgs = anthropic.messages.create.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toContain('40%'); // chicken in 40% of recipes
    expect(prompt).toContain('90%'); // garlic_onion in 90% of recipes
  });
});
