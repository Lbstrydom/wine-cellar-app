/**
 * @fileoverview Unit tests for chat context ownership in pairing routes.
 * Verifies stampChatContext and validateChatOwnership helpers via route behaviour.
 */

import express from 'express';

// --- Mocks ---

vi.mock('../../../src/db/index.js', () => ({ default: { prepare: vi.fn() } }));
vi.mock('../../../src/middleware/rateLimiter.js', () => ({
  strictRateLimiter: () => (_req, _res, next) => next()
}));
const { mockGetSommelier, mockContinueChat } = vi.hoisted(() => ({
  mockGetSommelier: vi.fn(),
  mockContinueChat: vi.fn()
}));

vi.mock('../../../src/services/ai/index.js', () => ({
  getSommelierRecommendation: mockGetSommelier,
  continueSommelierChat: mockContinueChat
}));
vi.mock('../../../src/services/pairing/pairing.js', () => ({ scorePairing: vi.fn() }));
vi.mock('../../../src/services/pairing/pairingEngine.js', () => ({
  getHybridPairing: vi.fn(),
  generateShortlist: vi.fn(),
  extractSignals: vi.fn().mockReturnValue([])
}));
vi.mock('../../../src/services/pairing/pairingSession.js', () => ({
  createManualPairingSession: vi.fn(),
  recordWineChoice: vi.fn(),
  recordFeedback: vi.fn(),
  getPendingFeedbackSessions: vi.fn(),
  getPairingHistory: vi.fn(),
  getPairingStats: vi.fn(),
  FAILURE_REASONS: []
}));
vi.mock('../../../src/services/recipe/recipeService.js', () => ({}));

// --- Supertest-style helper ---

import request from 'supertest';

// Build a minimal Express app with the pairing router
async function buildApp(userA, userB) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Inject auth middleware that flips user based on header
  app.use((req, _res, next) => {
    req.user = req.headers['x-test-user'] === 'B' ? userB : userA;
    req.cellarId = req.user.cellarId;
    next();
  });

  const { default: pairingRouter } = await import('../../../src/routes/pairing.js');
  app.use('/api/pairing', pairingRouter);
  return app;
}

// --- Tests ---

const USER_A = { id: 'user-a-uuid', cellarId: 'cellar-a-uuid' };
const USER_B = { id: 'user-b-uuid', cellarId: 'cellar-b-uuid' };

describe('Pairing chat ownership', () => {
  let app;
  let chatId;

  beforeAll(async () => {
    // Ensure API key check passes in route handler
    process.env.ANTHROPIC_API_KEY = 'test-key-for-unit-tests';

    mockGetSommelier.mockResolvedValue({
      dish_analysis: 'Delicious',
      recommendations: [],
      _chatContext: {
        dish: 'steak',
        source: 'all',
        colour: 'any',
        wines: [],
        initialResponse: { dish_analysis: 'Delicious', recommendations: [] }
      }
    });

    app = await buildApp(USER_A, USER_B);

    // Create a chat session as User A
    const res = await request(app)
      .post('/api/pairing/natural')
      .set('x-test-user', 'A')
      .send({ dish: 'steak', source: 'all', colour: 'any' });

    expect(res.status).toBe(200);
    chatId = res.body.chatId;
    expect(chatId).toBeTruthy();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSommelier.mockResolvedValue({ dish_analysis: 'ok', recommendations: [] });
  });

  describe('POST /api/pairing/chat', () => {
    it('allows User A to chat in their own session', async () => {
      mockContinueChat.mockResolvedValue({ type: 'explanation', message: 'Great choice!' });

      const res = await request(app)
        .post('/api/pairing/chat')
        .set('x-test-user', 'A')
        .send({ chatId, message: 'Tell me more' });

      expect(res.status).toBe(200);
    });

    it('blocks User B from accessing User A session — returns 403', async () => {
      const res = await request(app)
        .post('/api/pairing/chat')
        .set('x-test-user', 'B')
        .send({ chatId, message: 'Tell me more' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/pairing/chat/:chatId', () => {
    it('blocks User B from deleting User A session — returns 403', async () => {
      const res = await request(app)
        .delete(`/api/pairing/chat/${chatId}`)
        .set('x-test-user', 'B');

      expect(res.status).toBe(403);
    });

    it('allows User A to delete their own session', async () => {
      const res = await request(app)
        .delete(`/api/pairing/chat/${chatId}`)
        .set('x-test-user', 'A');

      expect(res.status).toBe(200);
    });

    it('returns 200 for non-existent chatId (already deleted or expired)', async () => {
      const res = await request(app)
        .delete('/api/pairing/chat/00000000-0000-0000-0000-000000000000')
        .set('x-test-user', 'A');

      expect(res.status).toBe(200);
    });
  });
});
