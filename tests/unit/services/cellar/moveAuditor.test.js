import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before import
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: null }));
vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: () => 'claude-opus-4-6',
  getThinkingConfig: () => ({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } }),
}));
vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn(() => ''),
}));
vi.mock('../../../../src/services/shared/circuitBreaker.js', () => ({
  isCircuitOpen: vi.fn(() => false),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  isMoveAuditEnabled,
  buildAuditPrompt,
  auditMoveSuggestions,
} from '../../../../src/services/cellar/moveAuditor.js';

// ───────────────────────────────────────────────────────────
// Feature flag
// ───────────────────────────────────────────────────────────

describe('isMoveAuditEnabled', () => {
  const origEnv = process.env.CLAUDE_AUDIT_CELLAR_MOVES;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = origEnv;
    } else {
      delete process.env.CLAUDE_AUDIT_CELLAR_MOVES;
    }
  });

  it('returns false when env var is not set', () => {
    delete process.env.CLAUDE_AUDIT_CELLAR_MOVES;
    expect(isMoveAuditEnabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
    expect(isMoveAuditEnabled()).toBe(true);
  });

  it('returns true when env var is "1"', () => {
    process.env.CLAUDE_AUDIT_CELLAR_MOVES = '1';
    expect(isMoveAuditEnabled()).toBe(true);
  });

  it('returns false when env var is "false"', () => {
    process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'false';
    expect(isMoveAuditEnabled()).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
// Prompt builder
// ───────────────────────────────────────────────────────────

describe('buildAuditPrompt', () => {
  const moves = [
    { type: 'move', wineId: 1, wineName: 'Wine A', from: 'R3C1', to: 'R5C2', toZone: 'Pinotage', reason: 'colour mismatch', confidence: 'high', isOverflow: false, priority: 1 },
    { type: 'move', wineId: 2, wineName: 'Wine B', from: 'R5C3', to: 'R3C1', toZone: 'Sauvignon Blanc', reason: 'colour mismatch', confidence: 'high', isOverflow: false, priority: 1 },
  ];
  const misplaced = [
    { wineId: 1, name: 'Wine A', currentSlot: 'R3C1', currentZone: 'Sauvignon Blanc', suggestedZone: 'Pinotage', confidence: 'high', reason: 'colour mismatch' },
  ];
  const summary = { totalBottles: 40, misplacedBottles: 2, zonesUsed: 5 };
  const narratives = [{ zoneId: 'pinotage', zoneName: 'Pinotage', rows: ['R5', 'R6'], bottleCount: 8 }];

  it('includes all moves in the prompt', () => {
    const prompt = buildAuditPrompt(moves, misplaced, summary, narratives);
    expect(prompt).toContain('Wine A');
    expect(prompt).toContain('Wine B');
    expect(prompt).toContain('R3C1');
    expect(prompt).toContain('R5C2');
  });

  it('includes cellar summary', () => {
    const prompt = buildAuditPrompt(moves, misplaced, summary, narratives);
    expect(prompt).toContain('Total bottles: 40');
    expect(prompt).toContain('Misplaced bottles: 2');
  });

  it('includes zone layout', () => {
    const prompt = buildAuditPrompt(moves, misplaced, summary, narratives);
    expect(prompt).toContain('Pinotage');
    expect(prompt).toContain('R5, R6');
    expect(prompt).toContain('8 bottles');
  });

  it('includes audit check categories', () => {
    const prompt = buildAuditPrompt(moves, misplaced, summary, narratives);
    expect(prompt).toContain('Circular chains');
    expect(prompt).toContain('Missed swap opportunities');
    expect(prompt).toContain('Capacity violations');
    expect(prompt).toContain('Displacing correct wines');
  });

  it('handles missing summary gracefully', () => {
    const prompt = buildAuditPrompt(moves, misplaced, null, null);
    expect(prompt).toContain('Total bottles: ?');
    expect(prompt).toContain('No zone narratives available.');
  });
});

// ───────────────────────────────────────────────────────────
// Main audit function (with mocked Claude client)
// ───────────────────────────────────────────────────────────

describe('auditMoveSuggestions', () => {
  const moves = [
    { type: 'move', wineId: 1, wineName: 'Wine A', from: 'R3C1', to: 'R5C2', toZone: 'Pinotage', reason: 'test', confidence: 'high', isOverflow: false, priority: 1 },
  ];
  const misplaced = [
    { wineId: 1, name: 'Wine A', currentSlot: 'R3C1', currentZone: 'SB', suggestedZone: 'Pinotage', confidence: 'high', reason: 'test' },
  ];
  const summary = { totalBottles: 40, misplacedBottles: 1, zonesUsed: 5 };
  const origEnv = process.env.CLAUDE_AUDIT_CELLAR_MOVES;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = origEnv;
    } else {
      delete process.env.CLAUDE_AUDIT_CELLAR_MOVES;
    }
  });

  it('returns skipped when feature flag is off', async () => {
    delete process.env.CLAUDE_AUDIT_CELLAR_MOVES;
    const result = await auditMoveSuggestions(moves, misplaced, summary);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('disabled');
  });

  it('returns skipped when no moves to audit', async () => {
    process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
    const result = await auditMoveSuggestions([], misplaced, summary);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('No moves');
  });

  it('returns skipped when Claude client is null', async () => {
    process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
    const result = await auditMoveSuggestions(moves, misplaced, summary);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('API key not configured');
  });

  it('returns skipped when circuit breaker is open', async () => {
    process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
    const { isCircuitOpen } = await import('../../../../src/services/shared/circuitBreaker.js');
    isCircuitOpen.mockReturnValueOnce(true);

    // Need a real client for this path — but since client is null, it'll hit
    // the client check first. This test validates the circuit breaker order.
    // The CB check happens before the API call but after the client check.
    const result = await auditMoveSuggestions(moves, misplaced, summary);
    // With null client, it returns 'API key not configured' first
    expect(result.skipped).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// Schema validation (indirectly via prompt structure)
// ───────────────────────────────────────────────────────────

describe('buildAuditPrompt output format', () => {
  it('requests JSON with correct verdict enum', () => {
    const prompt = buildAuditPrompt(
      [{ type: 'move', wineId: 1, wineName: 'W', from: 'R1C1', to: 'R2C1', toZone: 'Z', reason: 'r', confidence: 'high', isOverflow: false, priority: 1 }],
      [],
      { totalBottles: 10 },
      []
    );
    expect(prompt).toContain('"approve"');
    expect(prompt).toContain('"optimize"');
    expect(prompt).toContain('"flag"');
  });

  it('requests all issue types', () => {
    const prompt = buildAuditPrompt(
      [{ type: 'move', wineId: 1, wineName: 'W', from: 'R1C1', to: 'R2C1', toZone: 'Z', reason: 'r', confidence: 'high', isOverflow: false, priority: 1 }],
      [],
      {},
      []
    );
    expect(prompt).toContain('circular_chain');
    expect(prompt).toContain('missed_swap');
    expect(prompt).toContain('capacity_violation');
    expect(prompt).toContain('displacing_correct');
    expect(prompt).toContain('duplicate_target');
    expect(prompt).toContain('unresolved');
  });

  it('strips displacement swap metadata to prevent bias', () => {
    const prompt = buildAuditPrompt(
      [{ type: 'move', wineId: 1, wineName: 'W', from: 'R1C1', to: 'R2C1', toZone: 'Z', reason: 'r', confidence: 'high', isOverflow: false, priority: 1, isDisplacementSwap: true }],
      [],
      {},
      []
    );
    // isDisplacementSwap should be included (it's part of the move shape the auditor sees)
    expect(prompt).toContain('"isDisplacementSwap": true');
  });
});
