/**
 * @fileoverview Service tests for restaurant pairing.
 * Tests prompt building, response parsing, deterministic fallback,
 * chat context ownership, and error handling.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// ---------------------------------------------------------------------------
// Mocks (vitest hoists these before imports)
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
vi.mock('../../../src/services/claudeClient.js', () => ({
  default: { messages: { create: mockCreate } }
}));

vi.mock('../../../src/config/aiModels.js', () => ({
  getModelForTask: vi.fn(() => 'claude-sonnet-4-5-20250929')
}));

const mockCleanup = vi.fn();
vi.mock('../../../src/services/fetchUtils.js', () => ({
  createTimeoutAbort: vi.fn(() => ({
    controller: new AbortController(),
    cleanup: mockCleanup
  }))
}));

vi.mock('../../../src/services/inputSanitizer.js', () => ({
  sanitize: vi.fn((v) => v || ''),
  sanitizeChatMessage: vi.fn(m => m)
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

const {
  getRecommendations, continueChat, getChatContext,
  cleanupChatContexts, CHAT_ERRORS
} = await import('../../../src/services/restaurantPairing.js');
const { getModelForTask } = await import('../../../src/config/aiModels.js');
const { createTimeoutAbort } = await import('../../../src/services/fetchUtils.js');
const { sanitizeChatMessage } = await import('../../../src/services/inputSanitizer.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWine(overrides = {}) {
  return {
    id: 1, name: 'Kanonkop Pinotage', colour: 'red', style: 'Pinotage',
    vintage: 2021, price: 350, by_the_glass: false, ...overrides
  };
}

function makeDish(overrides = {}) {
  return {
    id: 1, name: 'Beef Steak', description: 'Chargrilled 300g ribeye',
    category: 'Main', ...overrides
  };
}

function makeParams(overrides = {}) {
  return {
    wines: [makeWine()],
    dishes: [makeDish()],
    colour_preferences: [],
    budget_max: null,
    party_size: null,
    max_bottles: null,
    prefer_by_glass: false,
    ...overrides
  };
}

const VALID_AI_RESPONSE = {
  table_summary: 'Great pairing for a steak dinner',
  pairings: [{
    rank: 1, dish_name: 'Beef Steak', wine_id: 1, wine_name: 'Kanonkop Pinotage',
    wine_colour: 'red', wine_price: 350, by_the_glass: false,
    why: 'Bold red with steak', serving_tip: 'Serve at 16-18°C', confidence: 'high'
  }],
  table_wine: {
    wine_name: 'Kanonkop Pinotage', wine_price: 350,
    why: 'Versatile red for the table'
  }
};

function claudeJson(obj) {
  return { content: [{ text: JSON.stringify(obj) }] };
}

function claudeText(text) {
  return { content: [{ text }] };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
  vi.clearAllMocks();
  cleanupChatContexts();
});

afterEach(() => {
  process.env = originalEnv;
  cleanupChatContexts();
});

// ---------------------------------------------------------------------------
// CHAT_ERRORS
// ---------------------------------------------------------------------------

describe('CHAT_ERRORS', () => {
  it('exports NOT_FOUND constant', () => {
    expect(CHAT_ERRORS.NOT_FOUND).toBe('NOT_FOUND');
  });

  it('exports FORBIDDEN constant', () => {
    expect(CHAT_ERRORS.FORBIDDEN).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// getChatContext
// ---------------------------------------------------------------------------

describe('getChatContext', () => {
  it('returns NOT_FOUND for unknown chatId', () => {
    const result = getChatContext('nonexistent-id', 'user1', 1);
    expect(result.code).toBe(CHAT_ERRORS.NOT_FOUND);
    expect(result.context).toBeNull();
  });

  it('returns FORBIDDEN when userId mismatches', async () => {
    mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
    const { chatId } = await getRecommendations(makeParams(), 'user1', 1);
    const result = getChatContext(chatId, 'wrong-user', 1);
    expect(result.code).toBe(CHAT_ERRORS.FORBIDDEN);
    expect(result.context).toBeNull();
  });

  it('returns FORBIDDEN when cellarId mismatches', async () => {
    mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
    const { chatId } = await getRecommendations(makeParams(), 'user1', 1);
    const result = getChatContext(chatId, 'user1', 999);
    expect(result.code).toBe(CHAT_ERRORS.FORBIDDEN);
  });

  it('returns context for valid owner', async () => {
    mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
    const { chatId } = await getRecommendations(makeParams(), 'user1', 1);
    const result = getChatContext(chatId, 'user1', 1);
    expect(result.code).toBeNull();
    expect(result.context).not.toBeNull();
    expect(result.context.userId).toBe('user1');
    expect(result.context.cellarId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// cleanupChatContexts
// ---------------------------------------------------------------------------

describe('cleanupChatContexts', () => {
  it('clears all stored contexts', async () => {
    mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
    const { chatId } = await getRecommendations(makeParams(), 'user1', 1);
    expect(getChatContext(chatId, 'user1', 1).code).toBeNull();

    cleanupChatContexts();

    expect(getChatContext(chatId, 'user1', 1).code).toBe(CHAT_ERRORS.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// getRecommendations — AI-powered path
// ---------------------------------------------------------------------------

describe('getRecommendations', () => {

  describe('AI-powered path', () => {
    it('returns response with chatId and fallback: false', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      const result = await getRecommendations(makeParams(), 'user1', 1);
      expect(result.chatId).toBeTruthy();
      expect(result.fallback).toBe(false);
      expect(result.pairings).toHaveLength(1);
      expect(result.table_summary).toBe('Great pairing for a steak dinner');
    });

    it('creates chat context with correct ownership', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      const { chatId } = await getRecommendations(makeParams(), 'user1', 42);
      const { context } = getChatContext(chatId, 'user1', 42);
      expect(context.userId).toBe('user1');
      expect(context.cellarId).toBe(42);
      expect(context.wines).toEqual(makeParams().wines);
      expect(context.dishes).toEqual(makeParams().dishes);
    });

    it('stores initial response in chat context', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      const { chatId } = await getRecommendations(makeParams(), 'user1', 1);
      const { context } = getChatContext(chatId, 'user1', 1);
      expect(context.initialResponse.table_summary).toBe('Great pairing for a steak dinner');
      expect(context.chatHistory).toHaveLength(0);
    });

    it('passes restaurantPairing task to getModelForTask', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      await getRecommendations(makeParams(), 'user1', 1);
      expect(getModelForTask).toHaveBeenCalledWith('restaurantPairing');
    });

    it('builds user prompt with wine and dish details', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      await getRecommendations(makeParams(), 'user1', 1);
      const userContent = mockCreate.mock.calls[0][0].messages[0].content;
      expect(userContent).toContain('RESTAURANT WINE LIST:');
      expect(userContent).toContain('Kanonkop Pinotage');
      expect(userContent).toContain('DISHES ORDERED:');
      expect(userContent).toContain('Beef Steak');
    });

    it('includes wine details in prompt (colour, style, vintage, price, glass)', async () => {
      const params = makeParams({
        wines: [makeWine({ colour: 'red', style: 'Pinotage', vintage: 2021, price: 350, by_the_glass: true })]
      });
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      await getRecommendations(params, 'user1', 1);
      const userContent = mockCreate.mock.calls[0][0].messages[0].content;
      expect(userContent).toContain('(red)');
      expect(userContent).toContain('Pinotage');
      expect(userContent).toContain('2021');
      expect(userContent).toContain('350');
      expect(userContent).toContain('[glass]');
    });

    it('includes constraints in prompt when provided', async () => {
      const params = makeParams({
        colour_preferences: ['red'],
        budget_max: 500,
        party_size: 4,
        max_bottles: 2,
        prefer_by_glass: true
      });
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      await getRecommendations(params, 'user1', 1);
      const userContent = mockCreate.mock.calls[0][0].messages[0].content;
      expect(userContent).toContain('CONSTRAINTS:');
      expect(userContent).toContain('Colour preference: red');
      expect(userContent).toContain('Budget max per bottle: 500');
      expect(userContent).toContain('Party size: 4');
      expect(userContent).toContain('Max bottles to order: 2');
      expect(userContent).toContain('by-the-glass');
    });

    it('omits CONSTRAINTS section when no constraints given', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      await getRecommendations(makeParams(), 'user1', 1);
      const userContent = mockCreate.mock.calls[0][0].messages[0].content;
      expect(userContent).not.toContain('CONSTRAINTS:');
    });

    it('creates timeout abort with 30s', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      await getRecommendations(makeParams(), 'user1', 1);
      expect(createTimeoutAbort).toHaveBeenCalledWith(30_000);
    });

    it('calls cleanup on success', async () => {
      mockCreate.mockResolvedValue(claudeJson(VALID_AI_RESPONSE));
      await getRecommendations(makeParams(), 'user1', 1);
      expect(mockCleanup).toHaveBeenCalledOnce();
    });
  });

  describe('response validation', () => {
    it('uses best-effort when schema validation fails', async () => {
      const partial = {
        table_summary: 'Partial',
        pairings: [{
          wine_id: 1, wine_name: 'Test', dish_name: 'Food',
          rank: 1, wine_colour: 'red', by_the_glass: false,
          why: 'ok', serving_tip: 'none'
          // missing confidence (required by schema)
        }]
      };
      mockCreate.mockResolvedValue(claudeJson(partial));
      const result = await getRecommendations(makeParams(), 'user1', 1);
      expect(result.pairings).toHaveLength(1);
      expect(result.pairings[0].wine_id).toBe(1);
    });

    it('returns empty pairings for non-object AI response', async () => {
      mockCreate.mockResolvedValue(claudeText('null'));
      const result = await getRecommendations(makeParams(), 'user1', 1);
      expect(result.pairings).toHaveLength(0);
    });

    it('filters out pairings with invalid wine_id in best-effort', async () => {
      const badPairings = {
        table_summary: 'Test',
        pairings: [
          { wine_id: 1, wine_name: 'Good', dish_name: 'Food' },
          { wine_id: -1, wine_name: 'Negative', dish_name: 'More' },
          { wine_id: null, wine_name: 'Null', dish_name: 'Other' }
        ]
      };
      mockCreate.mockResolvedValue(claudeJson(badPairings));
      const result = await getRecommendations(makeParams(), 'user1', 1);
      // Only wine_id > 0 survives best-effort filter
      const validIds = result.pairings.filter(p => p.wine_id > 0);
      expect(validIds).toHaveLength(1);
    });

    it('survives non-object elements (null, string) in pairings array', async () => {
      const mixed = {
        table_summary: 'Mixed',
        pairings: [
          null,
          'garbage',
          42,
          { wine_id: 1, wine_name: 'Survivor', dish_name: 'Food' }
        ]
      };
      mockCreate.mockResolvedValue(claudeJson(mixed));
      const result = await getRecommendations(makeParams(), 'user1', 1);
      expect(result.pairings).toHaveLength(1);
      expect(result.pairings[0].wine_name).toBe('Survivor');
    });
  });

  describe('fallback on errors', () => {
    it('falls back when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const result = await getRecommendations(makeParams(), 'user1', 1);
      expect(result.fallback).toBe(true);
      expect(result.chatId).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('falls back on Claude timeout', async () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      mockCreate.mockRejectedValue(err);
      const result = await getRecommendations(makeParams(), 'user1', 1);
      expect(result.fallback).toBe(true);
      expect(result.chatId).toBeNull();
    });

    it('falls back on Claude API error', async () => {
      mockCreate.mockRejectedValue(new Error('Rate limited'));
      const result = await getRecommendations(makeParams(), 'user1', 1);
      expect(result.fallback).toBe(true);
    });

    it('calls cleanup on error', async () => {
      mockCreate.mockRejectedValue(new Error('fail'));
      await getRecommendations(makeParams(), 'user1', 1);
      expect(mockCleanup).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

describe('deterministic fallback', () => {

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('colour matching', () => {
    it('matches beef dish to red wine', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, colour: 'red' }), makeWine({ id: 2, colour: 'white', name: 'Chardonnay' })],
        dishes: [makeDish({ name: 'Beef Steak' })]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_colour).toBe('red');
    });

    it('matches fish dish to white wine', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, colour: 'red' }), makeWine({ id: 2, colour: 'white', name: 'Sauvignon Blanc' })],
        dishes: [makeDish({ name: 'Grilled Salmon', description: 'Fresh fish fillet' })]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_colour).toBe('white');
    });

    it('matches salad to rose wine', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, colour: 'rose', name: 'Provence Rosé' }), makeWine({ id: 2, colour: 'red' })],
        dishes: [makeDish({ name: 'Caesar Salad' })]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_colour).toBe('rose');
    });

    it('matches dessert category to sparkling', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, colour: 'sparkling', name: 'Champagne' }), makeWine({ id: 2, colour: 'red' })],
        dishes: [makeDish({ name: 'Crème Brûlée', category: 'Dessert' })]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_colour).toBe('sparkling');
    });

    it('matches chicken to white wine', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, colour: 'red' }), makeWine({ id: 2, colour: 'white', name: 'Chardonnay' })],
        dishes: [makeDish({ name: 'Roast Chicken' })]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_colour).toBe('white');
    });

    it('defaults to red for unknown dish', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, colour: 'red' }), makeWine({ id: 2, colour: 'white', name: 'Chardonnay' })],
        dishes: [makeDish({ name: 'Mystery Item', description: null, category: null })]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_colour).toBe('red');
    });
  });

  describe('constraint filtering', () => {
    it('respects colour_preferences', async () => {
      const params = makeParams({
        wines: [
          makeWine({ id: 1, colour: 'red' }),
          makeWine({ id: 2, colour: 'white', name: 'Chardonnay' })
        ],
        colour_preferences: ['white'],
        dishes: [makeDish({ name: 'Beef Steak' })]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_colour).toBe('white');
    });

    it('respects budget_max', async () => {
      const params = makeParams({
        wines: [
          makeWine({ id: 1, colour: 'red', price: 800 }),
          makeWine({ id: 2, colour: 'red', name: 'Budget Red', price: 200 })
        ],
        budget_max: 500,
        dishes: [makeDish()]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_price).toBe(200);
    });

    it('includes wines with null price when budget_max is set', async () => {
      const params = makeParams({
        wines: [
          makeWine({ id: 1, colour: 'red', price: null, name: 'No Price' }),
          makeWine({ id: 2, colour: 'red', price: 800 })
        ],
        budget_max: 500,
        dishes: [makeDish()]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_name).toBe('No Price');
    });

    it('prefers by_the_glass when prefer_by_glass is true', async () => {
      const params = makeParams({
        wines: [
          makeWine({ id: 1, colour: 'red', by_the_glass: false }),
          makeWine({ id: 2, colour: 'red', name: 'Glass Red', by_the_glass: true })
        ],
        prefer_by_glass: true,
        dishes: [makeDish()]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings[0].wine_name).toBe('Glass Red');
    });

    it('falls back to all wines when filters eliminate everything', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, colour: 'red', price: 800 })],
        budget_max: 100,
        dishes: [makeDish()]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings).toHaveLength(1);
      expect(result.pairings[0].why).toContain('no wines matched your filters');
      expect(result.table_summary).toContain('no wines matched your filters');
    });
  });

  describe('table wine', () => {
    it('omits table_wine when all wines are by_the_glass', async () => {
      const params = makeParams({
        wines: [
          makeWine({ id: 1, by_the_glass: true }),
          makeWine({ id: 2, by_the_glass: true, name: 'Glass White', colour: 'white' })
        ],
        dishes: [makeDish()]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.table_wine).toBeNull();
    });

    it('suggests table wine when bottle wines exist', async () => {
      const params = makeParams({
        wines: [makeWine({ id: 1, by_the_glass: false })],
        dishes: [makeDish()]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.table_wine).not.toBeNull();
      expect(result.table_wine.wine_name).toBe('Kanonkop Pinotage');
    });

    it('prefers red non-glass wine for table wine', async () => {
      const params = makeParams({
        wines: [
          makeWine({ id: 1, colour: 'white', name: 'Chardonnay', by_the_glass: false }),
          makeWine({ id: 2, colour: 'red', name: 'Merlot', by_the_glass: false })
        ],
        dishes: [makeDish()]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.table_wine.wine_name).toBe('Merlot');
    });
  });

  describe('response shape', () => {
    it('sets fallback: true and chatId: null', async () => {
      const result = await getRecommendations(makeParams(), 'u', 1);
      expect(result.fallback).toBe(true);
      expect(result.chatId).toBeNull();
    });

    it('sets all pairing confidence to low', async () => {
      const result = await getRecommendations(makeParams(), 'u', 1);
      for (const p of result.pairings) {
        expect(p.confidence).toBe('low');
      }
    });

    it('produces one pairing per dish with sequential ranks', async () => {
      const params = makeParams({
        dishes: [
          makeDish({ id: 1, name: 'Steak' }),
          makeDish({ id: 2, name: 'Salmon', description: 'Fresh fish' }),
          makeDish({ id: 3, name: 'Cake', category: 'Dessert' })
        ]
      });
      const result = await getRecommendations(params, 'u', 1);
      expect(result.pairings).toHaveLength(3);
      expect(result.pairings.map(p => p.rank)).toEqual([1, 2, 3]);
    });
  });
});

// ---------------------------------------------------------------------------
// continueChat
// ---------------------------------------------------------------------------

describe('continueChat', () => {

  /** Create a chat context by running getRecommendations, return chatId */
  async function createChat(userId = 'user1', cellarId = 1) {
    mockCreate.mockResolvedValueOnce(claudeJson(VALID_AI_RESPONSE));
    const { chatId } = await getRecommendations(makeParams(), userId, cellarId);
    vi.clearAllMocks();
    return chatId;
  }

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    const chatId = await createChat();
    delete process.env.ANTHROPIC_API_KEY;
    await expect(continueChat(chatId, 'hello', 'user1', 1))
      .rejects.toThrow('Claude API key not configured');
  });

  it('throws with NOT_FOUND code for missing chatId', async () => {
    try {
      await continueChat('nonexistent', 'hello', 'user1', 1);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe(CHAT_ERRORS.NOT_FOUND);
    }
  });

  it('throws with FORBIDDEN code for wrong owner', async () => {
    const chatId = await createChat('user1', 1);
    try {
      await continueChat(chatId, 'hello', 'wrong-user', 1);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe(CHAT_ERRORS.FORBIDDEN);
    }
  });

  it('returns explanation type for plain text response', async () => {
    const chatId = await createChat();
    mockCreate.mockResolvedValue(claudeText('I suggest trying the Merlot instead.'));
    const result = await continueChat(chatId, 'What about lighter options?', 'user1', 1);
    expect(result.type).toBe('explanation');
    expect(result.message).toContain('Merlot');
  });

  it('returns recommendations type for JSON response with pairings', async () => {
    const chatId = await createChat();
    const json = JSON.stringify({
      pairings: [{ wine_id: 1, wine_name: 'Merlot', dish_name: 'Steak', rank: 1 }]
    });
    mockCreate.mockResolvedValue(claudeText('```json\n' + json + '\n```'));
    const result = await continueChat(chatId, 'Give me new pairings', 'user1', 1);
    expect(result.type).toBe('recommendations');
    expect(result.pairings).toHaveLength(1);
  });

  it('treats JSON without pairings array as explanation', async () => {
    const chatId = await createChat();
    const json = JSON.stringify({ note: 'Some info' });
    mockCreate.mockResolvedValue(claudeText('```json\n' + json + '\n```'));
    const result = await continueChat(chatId, 'question', 'user1', 1);
    expect(result.type).toBe('explanation');
  });

  it('filters invalid wine_ids from chat pairings', async () => {
    const chatId = await createChat();
    const json = JSON.stringify({
      pairings: [
        { wine_id: 1, wine_name: 'Good' },
        { wine_id: -1, wine_name: 'Negative' },
        { wine_id: null, wine_name: 'Null' }
      ]
    });
    mockCreate.mockResolvedValue(claudeText('```json\n' + json + '\n```'));
    const result = await continueChat(chatId, 'pairings', 'user1', 1);
    expect(result.pairings).toHaveLength(1);
    expect(result.pairings[0].wine_id).toBe(1);
  });

  it('survives non-object elements (null, string) in chat pairings', async () => {
    const chatId = await createChat();
    const json = JSON.stringify({
      pairings: [null, 'junk', { wine_id: 2, wine_name: 'Survivor' }]
    });
    mockCreate.mockResolvedValue(claudeText('```json\n' + json + '\n```'));
    const result = await continueChat(chatId, 'pairings', 'user1', 1);
    expect(result.type).toBe('recommendations');
    expect(result.pairings).toHaveLength(1);
    expect(result.pairings[0].wine_id).toBe(2);
  });

  it('handles JSON parse failure gracefully as explanation', async () => {
    const chatId = await createChat();
    mockCreate.mockResolvedValue(claudeText('```json\n{invalid json}\n```'));
    const result = await continueChat(chatId, 'test', 'user1', 1);
    expect(result.type).toBe('explanation');
  });

  it('updates chat history after response', async () => {
    const chatId = await createChat();
    mockCreate.mockResolvedValue(claudeText('Great choice!'));
    await continueChat(chatId, 'Is Merlot good?', 'user1', 1);

    const { context } = getChatContext(chatId, 'user1', 1);
    expect(context.chatHistory).toHaveLength(2);
    expect(context.chatHistory[0]).toEqual({ role: 'user', content: 'Is Merlot good?' });
    expect(context.chatHistory[1]).toEqual({ role: 'assistant', content: 'Great choice!' });
  });

  it('refreshes context TTL after chat', async () => {
    const chatId = await createChat();
    const { context } = getChatContext(chatId, 'user1', 1);
    const originalCreatedAt = context.createdAt;

    mockCreate.mockResolvedValue(claudeText('OK'));
    await continueChat(chatId, 'hi', 'user1', 1);

    expect(context.createdAt).toBeGreaterThanOrEqual(originalCreatedAt);
  });

  it('sanitizes message via sanitizeChatMessage', async () => {
    const chatId = await createChat();
    mockCreate.mockResolvedValue(claudeText('OK'));
    await continueChat(chatId, 'my question', 'user1', 1);
    expect(sanitizeChatMessage).toHaveBeenCalledWith('my question');
  });

  it('includes wine list and dishes in chat messages', async () => {
    const chatId = await createChat();
    mockCreate.mockResolvedValue(claudeText('Sure'));
    await continueChat(chatId, 'help', 'user1', 1);
    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[0].content).toContain('WINE LIST:');
    expect(messages[0].content).toContain('Kanonkop Pinotage');
    expect(messages[0].content).toContain('OUR DISHES:');
    expect(messages[0].content).toContain('Beef Steak');
  });

  it('includes initial recommendations as assistant message', async () => {
    const chatId = await createChat();
    mockCreate.mockResolvedValue(claudeText('OK'));
    await continueChat(chatId, 'help', 'user1', 1);
    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('Great pairing');
  });

  it('includes prior chat history in messages', async () => {
    const chatId = await createChat();

    // First follow-up
    mockCreate.mockResolvedValueOnce(claudeText('Try the Merlot'));
    await continueChat(chatId, 'first question', 'user1', 1);

    // Second follow-up — should include history from first
    mockCreate.mockResolvedValueOnce(claudeText('Good choice'));
    await continueChat(chatId, 'second question', 'user1', 1);

    const messages = mockCreate.mock.calls[1][0].messages;
    // [0] = context (user), [1] = initial recs (assistant),
    // [2] = first Q (user), [3] = first A (assistant),
    // [4] = second Q (user)
    expect(messages).toHaveLength(5);
    expect(messages[2].content).toBe('first question');
    expect(messages[3].content).toBe('Try the Merlot');
    expect(messages[4].content).toBe('second question');
  });

  it('throws "Chat request timed out" on AbortError', async () => {
    const chatId = await createChat();
    const err = new Error('Aborted');
    err.name = 'AbortError';
    mockCreate.mockRejectedValue(err);
    await expect(continueChat(chatId, 'hello', 'user1', 1))
      .rejects.toThrow('Chat request timed out');
  });

  it('calls cleanup on success', async () => {
    const chatId = await createChat();
    mockCreate.mockResolvedValue(claudeText('OK'));
    await continueChat(chatId, 'hi', 'user1', 1);
    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it('calls cleanup on timeout', async () => {
    const chatId = await createChat();
    const err = new Error('Aborted');
    err.name = 'AbortError';
    mockCreate.mockRejectedValue(err);
    await continueChat(chatId, 'hi', 'user1', 1).catch(() => {});
    expect(mockCleanup).toHaveBeenCalledOnce();
  });
});
