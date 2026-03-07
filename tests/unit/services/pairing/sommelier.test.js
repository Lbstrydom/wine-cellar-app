/**
 * @fileoverview Unit tests for sommelier service.
 * Focuses on cellar scoping, effectiveDish fallback, and vision block construction.
 */

// --- Mocks ---

const mockDb = { prepare: vi.fn() };
vi.mock('../../../../src/db/index.js', () => ({ default: mockDb }));

const mockAnthropicCreate = vi.fn();
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({
  default: { messages: { create: mockAnthropicCreate } }
}));

vi.mock('../../../../src/services/pairing/pairingSession.js', () => ({
  getRelevantPairingHistory: vi.fn().mockResolvedValue([]),
  createPairingSession: vi.fn().mockResolvedValue(42)
}));

vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: vi.fn().mockReturnValue('claude-sonnet-4-6'),
  getMaxTokens: vi.fn().mockReturnValue(8192)
}));

// --- Helpers ---

function makePrepare(rows) {
  return vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue(rows) });
}

function makeClaudeResponse(json) {
  return {
    content: [{
      text: JSON.stringify({
        signals: [],
        dish_analysis: 'Test analysis',
        colour_suggestion: null,
        recommendations: json,
        no_match_reason: null
      })
    }]
  };
}

// --- Tests ---

const { getSommelierRecommendation } = await import('../../../../src/services/pairing/sommelier.js');

const TEST_CELLAR = 'cellar-uuid-test';

describe('getSommelierRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cellar scoping', () => {
    it('includes cellar_id in the wine query for source=all', async () => {
      const wines = [{ id: 1, wine_name: 'Test Wine', vintage: 2020, style: 'Bordeaux', colour: 'red', bottle_count: 2, locations: 'R1C1' }];
      mockDb.prepare = makePrepare(wines);
      mockAnthropicCreate.mockResolvedValue(makeClaudeResponse([]));

      await getSommelierRecommendation(mockDb, 'steak', 'all', 'any', TEST_CELLAR);

      const firstCall = mockDb.prepare.mock.calls[0][0];
      expect(firstCall).toMatch(/w\.cellar_id\s*=\s*\?/i);
    });

    it('includes cellar_id in the wine query for source=reduce_now', async () => {
      mockDb.prepare = makePrepare([]);
      mockAnthropicCreate.mockResolvedValue(makeClaudeResponse([]));

      await getSommelierRecommendation(mockDb, 'pasta', 'reduce_now', 'any', TEST_CELLAR);

      const firstCall = mockDb.prepare.mock.calls[0][0];
      expect(firstCall).toMatch(/w\.cellar_id\s*=\s*\?/i);
    });

    it('includes cellar_id in the priority wines query', async () => {
      const wines = [{ id: 1, wine_name: 'Cab Sauv', vintage: 2019, style: 'Bordeaux', colour: 'red', bottle_count: 1, locations: 'R1C1' }];
      // First call = wine list, second = priority wines
      mockDb.prepare = vi.fn()
        .mockReturnValueOnce({ all: vi.fn().mockResolvedValue(wines) })
        .mockReturnValueOnce({ all: vi.fn().mockResolvedValue([]) });
      mockAnthropicCreate.mockResolvedValue(makeClaudeResponse([]));

      await getSommelierRecommendation(mockDb, 'steak', 'all', 'any', TEST_CELLAR);

      const secondCall = mockDb.prepare.mock.calls[1]?.[0] ?? '';
      expect(secondCall).toMatch(/w\.cellar_id\s*=\s*\?/i);
    });
  });

  describe('effectiveDish fallback', () => {
    it('uses dish text when provided', async () => {
      const wines = [{ id: 1, wine_name: 'Chardonnay', vintage: 2021, style: 'White', colour: 'white', bottle_count: 1, locations: 'F1' }];
      mockDb.prepare = makePrepare(wines);
      mockAnthropicCreate.mockResolvedValue(makeClaudeResponse([]));
      const { createPairingSession } = await import('../../../../src/services/pairing/pairingSession.js');

      await getSommelierRecommendation(mockDb, 'roast chicken', 'all', 'any', TEST_CELLAR);

      expect(createPairingSession).toHaveBeenCalledWith(
        expect.objectContaining({ dish: 'roast chicken' })
      );
    });

    it('uses AI dish_analysis for image-only sessions (empty dish)', async () => {
      const wines = [{ id: 1, wine_name: 'Pinot Noir', vintage: 2020, style: 'Red', colour: 'red', bottle_count: 1, locations: 'R1C1' }];
      mockDb.prepare = makePrepare(wines);
      // makeClaudeResponse returns dish_analysis: 'Test analysis'
      mockAnthropicCreate.mockResolvedValue(makeClaudeResponse([]));
      const { createPairingSession } = await import('../../../../src/services/pairing/pairingSession.js');

      await getSommelierRecommendation(mockDb, '', 'all', 'any', TEST_CELLAR, { base64: 'abc', mediaType: 'image/jpeg' });

      // sessionDish must be the AI's analysis, not the prompt placeholder
      expect(createPairingSession).toHaveBeenCalledWith(
        expect.objectContaining({ dish: 'Test analysis' })
      );
    });
  });

  describe('vision block construction', () => {
    it('sends text-only content when no image provided', async () => {
      const wines = [{ id: 1, wine_name: 'Merlot', vintage: 2018, style: 'Red', colour: 'red', bottle_count: 2, locations: 'R2C1' }];
      mockDb.prepare = makePrepare(wines);
      mockAnthropicCreate.mockResolvedValue(makeClaudeResponse([]));

      await getSommelierRecommendation(mockDb, 'pasta', 'all', 'any', TEST_CELLAR);

      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(typeof userContent).toBe('string');
    });

    it('sends image block + text when image provided', async () => {
      const wines = [{ id: 1, wine_name: 'Sauvignon Blanc', vintage: 2022, style: 'White', colour: 'white', bottle_count: 1, locations: 'F1' }];
      mockDb.prepare = makePrepare(wines);
      mockAnthropicCreate.mockResolvedValue(makeClaudeResponse([]));

      await getSommelierRecommendation(mockDb, 'fish tacos', 'all', 'any', TEST_CELLAR, {
        base64: 'imagebase64data',
        mediaType: 'image/jpeg'
      });

      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(Array.isArray(userContent)).toBe(true);
      expect(userContent[0].type).toBe('image');
      expect(userContent[0].source.data).toBe('imagebase64data');
      expect(userContent[0].source.media_type).toBe('image/jpeg');
      expect(userContent[1].type).toBe('text');
    });
  });

  describe('returns early with no-match when no wines', () => {
    it('returns no_match_reason when wine list is empty', async () => {
      mockDb.prepare = makePrepare([]);

      const result = await getSommelierRecommendation(mockDb, 'steak', 'all', 'any', TEST_CELLAR);

      expect(result.recommendations).toEqual([]);
      expect(result.no_match_reason).toBeTruthy();
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });
  });
});
