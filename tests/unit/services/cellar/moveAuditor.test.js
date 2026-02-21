import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockExtractText = vi.hoisted(() => vi.fn(() => ''));
const mockIsCircuitOpen = vi.hoisted(() => vi.fn(() => false));
const mockRecordSuccess = vi.hoisted(() => vi.fn());
const mockRecordFailure = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: {
    messages: {
      create: mockCreate
    }
  }
}));

vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: () => 'claude-opus-4-6',
  getThinkingConfig: () => ({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } })
}));

vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: mockExtractText
}));

vi.mock('../../../../src/services/shared/circuitBreaker.js', () => ({
  isCircuitOpen: mockIsCircuitOpen,
  recordSuccess: mockRecordSuccess,
  recordFailure: mockRecordFailure
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: mockLoggerWarn,
    info: mockLoggerInfo
  }
}));

import {
  isMoveAuditEnabled,
  buildAuditPrompt,
  auditMoveSuggestions
} from '../../../../src/services/cellar/moveAuditor.js';

describe('moveAuditor', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    mockIsCircuitOpen.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    vi.doUnmock('../../../../src/services/ai/claudeClient.js');
    vi.doUnmock('../../../../src/config/aiModels.js');
    vi.doUnmock('../../../../src/services/ai/claudeResponseUtils.js');
    vi.doUnmock('../../../../src/services/shared/circuitBreaker.js');
    vi.doUnmock('../../../../src/utils/logger.js');
    vi.resetModules();
  });

  describe('isMoveAuditEnabled', () => {
    it('returns false when env var is not set', () => {
      delete process.env.CLAUDE_AUDIT_CELLAR_MOVES;
      expect(isMoveAuditEnabled()).toBe(false);
    });

    it('returns true for true/1', () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      expect(isMoveAuditEnabled()).toBe(true);
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = '1';
      expect(isMoveAuditEnabled()).toBe(true);
    });
  });

  describe('buildAuditPrompt', () => {
    it('includes manual move shape and truncation notes', () => {
      const prompt = buildAuditPrompt(
        [{ type: 'manual', wineId: 5, wineName: 'W', currentSlot: 'R1C1', suggestedZone: 'Shiraz', suggestedZoneId: 'shiraz', reason: 'full', confidence: 'low', priority: 3 }],
        [{ wineId: 5, name: 'W', currentSlot: 'R1C1', currentZone: 'X', suggestedZone: 'Shiraz', confidence: 'low', reason: 'full' }],
        { totalBottles: 10, misplacedBottles: 1, zonesUsed: 2 },
        []
      );

      expect(prompt).toContain('"type": "manual"');
      expect(prompt).toContain('"currentSlot": "R1C1"');
      expect(prompt).toContain('Suggested moves included: 1/1');
      expect(prompt).toContain('Misplaced wines included: 1/1');
    });
  });

  describe('auditMoveSuggestions', () => {
    const moves = [
      { type: 'move', wineId: 1, wineName: 'Wine A', from: 'R3C1', to: 'R5C2', toZone: 'Pinotage', reason: 'fix', confidence: 'high', isOverflow: false, priority: 1 },
      { type: 'move', wineId: 2, wineName: 'Wine B', from: 'R5C3', to: 'R3C1', toZone: 'Shiraz', reason: 'fix', confidence: 'medium', isOverflow: false, priority: 2 }
    ];
    const misplaced = [
      { wineId: 1, name: 'Wine A', currentSlot: 'R3C1', currentZone: 'SB', suggestedZone: 'Pinotage', confidence: 'high', reason: 'fix' },
      { wineId: 2, name: 'Wine B', currentSlot: 'R5C3', currentZone: 'PN', suggestedZone: 'Shiraz', confidence: 'medium', reason: 'fix' }
    ];
    const summary = { totalBottles: 40, misplacedBottles: 2, zonesUsed: 5 };

    it('returns skipped when feature flag is off', async () => {
      delete process.env.CLAUDE_AUDIT_CELLAR_MOVES;
      const result = await auditMoveSuggestions(moves, misplaced, summary, []);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('disabled');
    });

    it('returns skipped when no moves are provided', async () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      const result = await auditMoveSuggestions([], misplaced, summary, []);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('No moves');
    });

    it('returns skipped when circuit breaker is open', async () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      mockIsCircuitOpen.mockReturnValueOnce(true);

      const result = await auditMoveSuggestions(moves, misplaced, summary, []);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('Circuit breaker open');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns approve result for valid reviewer JSON', async () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      mockCreate.mockResolvedValueOnce({ id: 'resp_1' });
      mockExtractText.mockReturnValueOnce(`\`\`\`json
{"verdict":"approve","issues":[],"optimizedMoves":null,"reasoning":"Looks good","confidence":"high"}
\`\`\``);

      const result = await auditMoveSuggestions(moves, misplaced, summary, []);
      expect(result.audited).toBe(true);
      expect(result.verdict).toBe('approve');
      expect(result.optimizedMoves).toBeNull();
      expect(mockRecordSuccess).toHaveBeenCalled();
    });

    it('normalizes optimize output to stable move shape', async () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      mockCreate.mockResolvedValueOnce({ id: 'resp_2' });
      mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[{"type":"ordering_issue","severity":"warning","description":"reorder","affectedMoveIndices":[0,1]}],
  "optimizedMoves":[
    {"wineId":1,"from":"R3C1","to":"R5C2","reason":"leg 1"},
    {"wineId":2,"from":"R5C3","to":"R3C1","reason":"leg 2"}
  ],
  "reasoning":"Reordered safely",
  "confidence":"medium"
}
\`\`\``);

      const result = await auditMoveSuggestions(moves, misplaced, summary, []);
      expect(result.audited).toBe(true);
      expect(result.verdict).toBe('optimize');
      expect(result.optimizedMoves).toHaveLength(2);
      expect(result.optimizedMoves[0].type).toBe('move');
      expect(result.optimizedMoves[0].wineName).toBe('Wine A');
      expect(result.optimizedMoves[0].toZone).toBe('Pinotage');
    });

    it('downgrades to flag when optimize output fails integrity checks', async () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      mockCreate.mockResolvedValueOnce({ id: 'resp_3' });
      mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[{"type":"duplicate_target","severity":"error","description":"dup","affectedMoveIndices":[0,1]}],
  "optimizedMoves":[
    {"wineId":1,"from":"R3C1","to":"R5C2"},
    {"wineId":2,"from":"R5C3","to":"R5C2"}
  ],
  "reasoning":"Try this",
  "confidence":"high"
}
\`\`\``);

      const result = await auditMoveSuggestions(moves, misplaced, summary, []);
      expect(result.audited).toBe(true);
      expect(result.verdict).toBe('flag');
      expect(result.optimizedMoves).toBeNull();
      expect(result.issues.length).toBeGreaterThan(1);
    });

    it('handles abort timeout as skipped with reason', async () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      process.env.CLAUDE_AUDIT_TIMEOUT_MS = '5000';
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      mockCreate.mockRejectedValueOnce(abortErr);

      const result = await auditMoveSuggestions(moves, misplaced, summary, []);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('timed out');
      expect(mockRecordFailure).toHaveBeenCalled();
    });

    it('returns skipped when LLM returns non-JSON text', async () => {
      process.env.CLAUDE_AUDIT_CELLAR_MOVES = 'true';
      mockCreate.mockResolvedValueOnce({ id: 'resp_bad' });
      mockExtractText.mockReturnValueOnce('I cannot process this request. Please try again later.');

      const result = await auditMoveSuggestions(moves, misplaced, summary, []);
      expect(result.skipped).toBe(true);
      expect(mockRecordFailure).toHaveBeenCalled();
    });
  });

  describe('buildAuditPrompt - truncation', () => {
    it('truncates moves to MAX_MOVES_IN_PROMPT (120)', () => {
      const largeMoves = Array.from({ length: 150 }, (_, i) => ({
        type: 'move',
        wineId: i,
        wineName: `Wine ${i}`,
        from: `R${i}C1`,
        to: `R${i}C2`,
        toZone: 'Pinotage',
        reason: 'test',
        confidence: 'high',
        isOverflow: false,
        priority: i
      }));
      const prompt = buildAuditPrompt(largeMoves, [], { totalBottles: 200, misplacedBottles: 150, zonesUsed: 5 }, []);
      expect(prompt).toContain('Suggested moves included: 120/150');
    });

    it('truncates misplaced wines to MAX_MISPLACED_IN_PROMPT (160)', () => {
      const largeMisplaced = Array.from({ length: 200 }, (_, i) => ({
        wineId: i,
        name: `Wine ${i}`,
        currentSlot: `R${i}C1`,
        currentZone: 'X',
        suggestedZone: 'Y',
        confidence: 'low',
        reason: 'test'
      }));
      const prompt = buildAuditPrompt([], largeMisplaced, { totalBottles: 300, misplacedBottles: 200, zonesUsed: 5 }, []);
      expect(prompt).toContain('Misplaced wines included: 160/200');
    });
  });
});
