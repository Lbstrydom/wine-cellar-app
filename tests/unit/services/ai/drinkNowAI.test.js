/**
 * @fileoverview Unit tests for drinkNowAI — Phase 0 cellar scoping.
 * Verifies cellarId flows through all internal DB queries so recommendations
 * are never mixed across tenants.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: { messages: { create: vi.fn() } }
}));

vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: vi.fn().mockReturnValue('claude-haiku-4-5'),
  getThinkingConfig: vi.fn().mockReturnValue(null)
}));

vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: vi.fn().mockReturnValue(
    JSON.stringify({ recommendations: [], collection_insight: 'OK', drinking_tip: null })
  )
}));

vi.mock('../../../../src/db/helpers.js', () => ({
  stringAgg: vi.fn().mockReturnValue("STRING_AGG(s.location_code, ',')"),
  nullsLast: vi.fn((expr, dir) => `${expr} ${dir} NULLS LAST`)
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../../../src/services/wine/wineContextBuilder.js', () => ({
  buildWineContextBatch: vi.fn().mockResolvedValue(new Map()),
  buildWineContext: vi.fn()
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import db from '../../../../src/db/index.js';
import { generateDrinkRecommendations } from '../../../../src/services/ai/drinkNowAI.js';
import { buildWineContextBatch } from '../../../../src/services/wine/wineContextBuilder.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CELLAR_ID = 'cellar-abc-123';

/**
 * Capture all SQL strings passed to db.prepare(), returning the array and
 * a mock factory that returns empty results for all query patterns.
 */
function setupDbMock() {
  const capturedSqls = [];
  db.prepare.mockImplementation((sql) => {
    capturedSqls.push(sql);
    return {
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ count: 0 })
    };
  });
  return capturedSqls;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateDrinkRecommendations — cellar scoping (Phase 0)', () => {
  let originalApiKey;

  beforeEach(() => {
    vi.clearAllMocks();
    originalApiKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  // ── 1. cellarId in getUrgentWines ─────────────────────────────────────────
  it('includes cellar_id filter in getUrgentWines SQL', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const sqls = setupDbMock();

    await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    const urgentSql = sqls.find(s => s.includes('drink_until') && s.includes('drink_peak'));
    expect(urgentSql, 'getUrgentWines SQL not found').toBeDefined();
    expect(urgentSql).toContain('cellar_id');
    expect(urgentSql).toContain('WHERE w.cellar_id');
  });

  // ── 2. cellarId in getCollectionStats ─────────────────────────────────────
  it('includes cellar_id filter in getCollectionStats colour query', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const sqls = setupDbMock();

    await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    const colourSql = sqls.find(s => s.includes('w.colour') && s.includes('bottle_count') && s.includes('GROUP BY'));
    expect(colourSql, 'getCollectionStats colour SQL not found').toBeDefined();
    expect(colourSql).toContain('cellar_id');
  });

  it('includes cellar_id filter in getCollectionStats total query', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const sqls = setupDbMock();

    await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    const totalSql = sqls.find(s => s.includes('COUNT') && s.includes('slots') && s.includes('wines'));
    expect(totalSql, 'getCollectionStats total SQL not found').toBeDefined();
    expect(totalSql).toContain('cellar_id');
  });

  // ── 3. cellarId in getRecentConsumption ───────────────────────────────────
  it('includes cellar_id filter in getRecentConsumption SQL via JOIN', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const sqls = setupDbMock();

    await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    const consumptionSql = sqls.find(s => s.includes('consumption_log'));
    expect(consumptionSql, 'getRecentConsumption SQL not found').toBeDefined();
    expect(consumptionSql).toContain('cellar_id');
  });

  // ── 4. Returns empty when no urgent wines (no AI call) ────────────────────
  it('returns empty recommendations without calling AI when no urgent wines', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { default: anthropic } = await import('../../../../src/services/ai/claudeClient.js');
    setupDbMock();

    const result = await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    expect(result.recommendations).toEqual([]);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  // ── 5. Missing API key uses cellar-scoped fallback ────────────────────────
  it('returns error and cellar-scoped fallback when ANTHROPIC_API_KEY missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const sqls = setupDbMock();

    const result = await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    expect(result.error).toMatch(/API key/i);
    expect(result.recommendations).toBeInstanceOf(Array);
    // Fallback also calls getUrgentWines, which must include cellar_id
    const urgentSql = sqls.find(s => s.includes('drink_until'));
    expect(urgentSql).toContain('cellar_id');
  });

  // ── 6. cellarId is destructured from options ──────────────────────────────
  it('accepts cellarId nested in options object', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const sqls = setupDbMock();

    // Should not throw; cellarId passed via options
    await expect(
      generateDrinkRecommendations({ cellarId: 'tenant-xyz', limit: 3 })
    ).resolves.not.toThrow();

    // All cellar_id references use the passed value — verify SQL not empty
    expect(sqls.length).toBeGreaterThan(0);
  });
});

// ─── Phase 4a: food pairing enrichment ──────────────────────────────────────

describe('generateDrinkRecommendations — food pairing enrichment (Phase 4a)', () => {
  const URGENT_WINE = { id: 99, wine_name: 'Test Red', colour: 'red', vintage: 2020 };

  /** Return a wine from getUrgentWines, empty arrays for everything else. */
  function setupDbMockWithWines() {
    db.prepare.mockImplementation((sql) => {
      if (sql.includes('drink_until') || sql.includes('drink_peak')) {
        return { all: vi.fn().mockResolvedValue([URGENT_WINE]) };
      }
      return {
        all: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({ count: 0 })
      };
    });
  }

  /** Default Claude response so the function completes normally. */
  async function mockClaudeOk() {
    const { default: anthropic } = await import('../../../../src/services/ai/claudeClient.js');
    anthropic.messages.create.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ recommendations: [], collection_insight: 'OK', drinking_tip: null }) }]
    });
    return anthropic;
  }

  let originalApiKey;
  beforeEach(() => {
    vi.clearAllMocks();
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  // ── 1. buildWineContextBatch is called when urgentWines is non-empty ─────
  it('calls buildWineContextBatch with urgentWines, cellarId, and includePairings option', async () => {
    setupDbMockWithWines();
    buildWineContextBatch.mockResolvedValue(new Map());
    await mockClaudeOk();

    await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    expect(buildWineContextBatch).toHaveBeenCalledOnce();
    expect(buildWineContextBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: URGENT_WINE.id })]),
      CELLAR_ID,
      { includePairings: true }
    );
  });

  // ── 2. "Pairs with:" appears in Claude prompt when _context has pairings ─
  it('includes "Pairs with:" in the Claude prompt when _context has food_pairings', async () => {
    setupDbMockWithWines();
    const contextMap = new Map([
      [URGENT_WINE.id, { food_pairings: [{ pairing: 'Grilled beef' }, { pairing: 'Lamb chops' }] }]
    ]);
    buildWineContextBatch.mockResolvedValue(contextMap);
    const anthropic = await mockClaudeOk();

    await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    const callArg = anthropic.messages.create.mock.calls[0][0];
    const prompt = callArg.messages.find(m => m.role === 'user')?.content ?? '';
    expect(prompt).toContain('Pairs with:');
    expect(prompt).toContain('Grilled beef');
  });

  // ── 3. Fail-open: enrichment failure does not break recommendations ───────
  it('is fail-open: still resolves when buildWineContextBatch throws', async () => {
    setupDbMockWithWines();
    buildWineContextBatch.mockRejectedValue(new Error('Context service unavailable'));
    await mockClaudeOk();

    const result = await generateDrinkRecommendations({ cellarId: CELLAR_ID });

    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
  });
});
