import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockExtractText = vi.hoisted(() => vi.fn(() => ''));
const mockIsCircuitOpen = vi.hoisted(() => vi.fn(() => false));
const mockRecordSuccess = vi.hoisted(() => vi.fn());
const mockRecordFailure = vi.hoisted(() => vi.fn());

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
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
  isPairingAuditEnabled,
  auditPairingRecommendations
} from '../../../../src/services/pairing/pairingAuditor.js';

describe('pairingAuditor', () => {
  const originalEnv = process.env;
  const context = {
    wines: [
      { id: 1, name: 'Wine A', colour: 'red', price: 100, by_the_glass: false, currency: 'USD' },
      { id: 2, name: 'Wine B', colour: 'white', price: 80, by_the_glass: true, currency: 'USD' }
    ],
    dishes: [
      { id: 10, name: 'Steak' },
      { id: 11, name: 'Salmon' }
    ],
    constraints: {
      colour_preferences: [],
      budget_max: 120,
      prefer_by_glass: false
    }
  };

  const recommendation = {
    table_summary: 'Initial',
    pairings: [
      {
        rank: 1,
        dish_name: 'Steak',
        wine_id: 1,
        wine_name: 'Wine A',
        wine_colour: 'red',
        wine_price: 100,
        currency: 'USD',
        by_the_glass: false,
        why: 'Good',
        serving_tip: '',
        confidence: 'high'
      },
      {
        rank: 2,
        dish_name: 'Salmon',
        wine_id: 2,
        wine_name: 'Wine B',
        wine_colour: 'white',
        wine_price: 80,
        currency: 'USD',
        by_the_glass: true,
        why: 'Good',
        serving_tip: '',
        confidence: 'medium'
      }
    ],
    table_wine: null
  };

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

  it('honors feature flag', () => {
    delete process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS;
    expect(isPairingAuditEnabled()).toBe(false);
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    expect(isPairingAuditEnabled()).toBe(true);
  });

  it('skips when disabled', async () => {
    delete process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS;
    const result = await auditPairingRecommendations(recommendation, context);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('disabled');
  });

  it('returns approve on valid audit response', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"approve",
  "issues":[],
  "optimizedRecommendation":null,
  "reasoning":"Looks good",
  "confidence":"high"
}
\`\`\``);

    const result = await auditPairingRecommendations(recommendation, context);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('approve');
    expect(result.optimizedRecommendation).toBeNull();
    expect(mockRecordSuccess).toHaveBeenCalled();
  });

  it('normalizes optimized recommendation with authoritative wine metadata', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[{"type":"shape_issue","severity":"info","description":"reordered","affectedPairingIndices":[0,1]}],
  "optimizedRecommendation":{
    "table_summary":"Optimized",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":1,"why":"Better logic"},
      {"rank":2,"dish_name":"Salmon","wine_id":2,"why":"Balanced"}
    ],
    "table_wine":null
  },
  "reasoning":"Improved",
  "confidence":"medium"
}
\`\`\``);

    const result = await auditPairingRecommendations(recommendation, context);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('optimize');
    expect(result.optimizedRecommendation.table_summary).toBe('Optimized');
    expect(result.optimizedRecommendation.pairings[0].wine_name).toBe('Wine A');
    expect(result.optimizedRecommendation.pairings[1].by_the_glass).toBe(true);
  });

  it('downgrades to flag when optimized response fails integrity', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[],
  "optimizedRecommendation":{
    "table_summary":"Bad",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":999,"why":"Invalid wine"},
      {"rank":2,"dish_name":"Salmon","wine_id":2,"why":"Balanced"}
    ],
    "table_wine":null
  },
  "reasoning":"Try this",
  "confidence":"medium"
}
\`\`\``);

    const result = await auditPairingRecommendations(recommendation, context);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('flag');
    expect(result.optimizedRecommendation).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('returns skipped timeout for AbortError', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    mockCreate.mockRejectedValueOnce(abortErr);

    const result = await auditPairingRecommendations(recommendation, context);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('timed out');
    expect(mockRecordFailure).toHaveBeenCalled();
  });

  it('rejects optimize when wine exceeds budget_max constraint', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[],
  "optimizedRecommendation":{
    "table_summary":"Budget issue",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":1,"why":"Expensive but great"},
      {"rank":2,"dish_name":"Salmon","wine_id":2,"why":"Balanced"}
    ],
    "table_wine":null
  },
  "reasoning":"Better picks",
  "confidence":"high"
}
\`\`\``);

    const strictBudgetContext = {
      ...context,
      constraints: { ...context.constraints, budget_max: 50 }
    };

    const result = await auditPairingRecommendations(recommendation, strictBudgetContext);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('flag');
    expect(result.optimizedRecommendation).toBeNull();
  });

  it('rejects optimize when wine colour violates colour_preferences', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[],
  "optimizedRecommendation":{
    "table_summary":"Colour issue",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":1,"why":"Great red"},
      {"rank":2,"dish_name":"Salmon","wine_id":2,"why":"Nice white"}
    ],
    "table_wine":null
  },
  "reasoning":"Reordered",
  "confidence":"high"
}
\`\`\``);

    const whiteOnlyContext = {
      ...context,
      constraints: { ...context.constraints, colour_preferences: ['white'] }
    };

    const result = await auditPairingRecommendations(recommendation, whiteOnlyContext);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('flag');
    expect(result.optimizedRecommendation).toBeNull();
  });

  it('allows by-the-glass non-match when not all wines are by-the-glass (soft preference)', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[{"type":"shape_issue","severity":"info","description":"reorder"}],
  "optimizedRecommendation":{
    "table_summary":"Glass preference",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":1,"why":"Great choice"},
      {"rank":2,"dish_name":"Salmon","wine_id":2,"why":"Perfect"}
    ],
    "table_wine":null
  },
  "reasoning":"Kept non-glass wine since not all wines are available by glass",
  "confidence":"high"
}
\`\`\``);

    const glassContext = {
      ...context,
      constraints: { ...context.constraints, prefer_by_glass: true }
    };

    const result = await auditPairingRecommendations(recommendation, glassContext);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('optimize');
    expect(result.optimizedRecommendation).not.toBeNull();
    // Wine A (id=1) is NOT by_the_glass, but should still pass because Wine B (id=2) IS,
    // so not ALL wines are by-the-glass ⇒ soft preference doesn't reject
    expect(result.optimizedRecommendation.pairings[0].wine_name).toBe('Wine A');
  });

  it('flags optimize when prefer_by_glass is true and no by-the-glass pairing is selected', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[],
  "optimizedRecommendation":{
    "table_summary":"No glass picks",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":1,"why":"Great"},
      {"rank":2,"dish_name":"Salmon","wine_id":1,"why":"Still good"}
    ],
    "table_wine":null
  },
  "reasoning":"Kept bottle-only wines",
  "confidence":"high"
}
\`\`\``);

    const preferGlassContext = {
      ...context,
      constraints: { ...context.constraints, prefer_by_glass: true }
    };

    const result = await auditPairingRecommendations(recommendation, preferGlassContext);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('flag');
    expect(result.optimizedRecommendation).toBeNull();
  });

  it('matches table_wine via fuzzy substring when LLM paraphrases name', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[],
  "optimizedRecommendation":{
    "table_summary":"Table wine",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":1,"why":"Great"},
      {"rank":2,"dish_name":"Salmon","wine_id":2,"why":"Perfect"}
    ],
    "table_wine":{"wine_name":"wine b","why":"Versatile"}
  },
  "reasoning":"Added table wine",
  "confidence":"high"
}
\`\`\``);

    const result = await auditPairingRecommendations(recommendation, context);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('optimize');
    expect(result.optimizedRecommendation.table_wine).not.toBeNull();
    expect(result.optimizedRecommendation.table_wine.wine_name).toBe('Wine B');
  });

  it('flags when duplicate dish names appear in optimized pairings', async () => {
    process.env.CLAUDE_AUDIT_RESTAURANT_PAIRINGS = 'true';
    mockCreate.mockResolvedValueOnce({ id: 'resp' });
    mockExtractText.mockReturnValueOnce(`\`\`\`json
{
  "verdict":"optimize",
  "issues":[],
  "optimizedRecommendation":{
    "table_summary":"Duplicates",
    "pairings":[
      {"rank":1,"dish_name":"Steak","wine_id":1,"why":"Great"},
      {"rank":2,"dish_name":"Steak","wine_id":2,"why":"Also good"}
    ],
    "table_wine":null
  },
  "reasoning":"Duplicated dish",
  "confidence":"high"
}
\`\`\``);

    const result = await auditPairingRecommendations(recommendation, context);
    expect(result.audited).toBe(true);
    expect(result.verdict).toBe('flag');
    expect(result.optimizedRecommendation).toBeNull();
  });
});
