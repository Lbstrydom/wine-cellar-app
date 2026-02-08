/**
 * @fileoverview Tests for /api/restaurant-pairing route handlers.
 * Exercises REAL route handlers via supertest through the Express middleware chain.
 * Tests real Zod schema validation, rejectOversizedImage, chat error mapping,
 * and rate limiter wiring.  Three app variants: mock-auth for route logic,
 * real requireAuth for 401, real requireCellarContext for 400/403,
 * server-mount for body-parser 413 normalizer contract.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// ---------------------------------------------------------------------------
// Mocks (vitest hoists these before imports)
// ---------------------------------------------------------------------------

vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../src/middleware/rateLimiter.js', () => ({
  strictRateLimiter: vi.fn(() => (_req, _res, next) => next()),
  createRateLimiter: vi.fn(() => (_req, _res, next) => next())
}));

vi.mock('../../../src/services/menuParsing.js', () => ({
  parseMenuFromText: vi.fn(),
  parseMenuFromImage: vi.fn()
}));

vi.mock('../../../src/services/restaurantPairing.js', () => ({
  getRecommendations: vi.fn(),
  continueChat: vi.fn(),
  CHAT_ERRORS: { NOT_FOUND: 'NOT_FOUND', FORBIDDEN: 'FORBIDDEN' }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import router from '../../../src/routes/restaurantPairing.js';
import { parseMenuFromText, parseMenuFromImage } from '../../../src/services/menuParsing.js';
import { getRecommendations, continueChat, CHAT_ERRORS } from '../../../src/services/restaurantPairing.js';
import { strictRateLimiter, createRateLimiter } from '../../../src/middleware/rateLimiter.js';
import { requireAuth } from '../../../src/middleware/auth.js';
import { requireCellarContext } from '../../../src/middleware/cellarContext.js';
import db from '../../../src/db/index.js';
import { MAX_IMAGE_BASE64_CHARS } from '../../../src/schemas/restaurantPairing.js';
import { errorHandler } from '../../../src/utils/errorResponse.js';

// ---------------------------------------------------------------------------
// Capture rate-limiter setup calls (before beforeEach clears mocks)
// ---------------------------------------------------------------------------

const rateLimiterSetup = {
  strictCallCount: strictRateLimiter.mock.calls.length,
  createCallCount: createRateLimiter.mock.calls.length,
  createArgs: createRateLimiter.mock.calls[0]?.[0]
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARSE_RESULT = {
  items: [{ type: 'wine', name: 'Kanonkop Pinotage', confidence: 'high' }],
  overall_confidence: 'high',
  parse_notes: 'Clear wine list'
};

const RECOMMEND_RESULT = {
  table_summary: 'Great pairing selection',
  pairings: [{
    rank: 1, dish_name: 'Steak', wine_id: 1, wine_name: 'Merlot',
    wine_colour: 'red', wine_price: null, by_the_glass: false,
    why: 'Classic pairing', serving_tip: 'Room temperature', confidence: 'high'
  }],
  table_wine: null,
  chatId: '550e8400-e29b-41d4-a716-446655440000',
  fallback: false
};

const CHAT_RESULT = {
  reply: 'White wines would pair well with the fish.',
  pairings: []
};

const VALID_PARSE_TEXT = {
  type: 'wine_list',
  text: 'Kanonkop Pinotage R350'
};

const VALID_PARSE_IMAGE = {
  type: 'wine_list',
  image: 'iVBORw0KGgo=',
  mediaType: 'image/jpeg'
};

const VALID_RECOMMEND = {
  wines: [{ id: 1, name: 'Kanonkop Pinotage', colour: 'red', by_the_glass: false }],
  dishes: [{ id: 1, name: 'Grilled Steak' }]
};

const VALID_CHAT = {
  chatId: '550e8400-e29b-41d4-a716-446655440000',
  message: 'What about white wines?'
};

// ---------------------------------------------------------------------------
// App factories
// ---------------------------------------------------------------------------

/** Mock-auth app: injects req.user and req.cellarId for route logic tests. */
function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 'user-1' };
    req.cellarId = 42;
    next();
  });
  app.use('/', router);
  app.use(errorHandler);
  return app;
}

/** Auth-wired app: uses real requireAuth for 401 rejection test. */
function createAuthApp() {
  const app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use((req, _res, next) => { req.cellarId = 42; next(); });
  app.use('/', router);
  app.use(errorHandler);
  return app;
}

/** Cellar-auth app: simplified auth + real requireCellarContext for 400/403 tests. */
function createCellarAuthApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    req.user = { id: 'user-1' }; // No active_cellar_id
    next();
  });
  app.use(requireCellarContext);
  app.use('/', router);
  app.use(errorHandler);
  return app;
}

/** Server-mount app: small body limit + 413 normalizer to test server.js contract. */
function createServerMountApp() {
  const app = express();
  // Mirror server.js mount: body parser + 413 normalizer before router.
  // Uses 100b limit to avoid huge allocations; tests same code path as 5mb.
  app.use(express.json({ limit: '100b' }));
  app.use((err, _req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request payload too large (max 5MB)' });
    }
    next(err);
  });
  app.use((req, _res, next) => {
    req.user = { id: 'user-1' };
    req.cellarId = 42;
    next();
  });
  app.use('/', router);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

// ---------------------------------------------------------------------------
// POST /parse-menu
// ---------------------------------------------------------------------------

describe('POST /parse-menu', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  describe('happy path', () => {
    it('parses text menu and returns result', async () => {
      parseMenuFromText.mockResolvedValue(PARSE_RESULT);

      const res = await request(app).post('/parse-menu').send(VALID_PARSE_TEXT);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(PARSE_RESULT);
    });

    it('passes type and text to parseMenuFromText', async () => {
      parseMenuFromText.mockResolvedValue(PARSE_RESULT);

      await request(app).post('/parse-menu').send(VALID_PARSE_TEXT);

      expect(parseMenuFromText).toHaveBeenCalledWith('wine_list', 'Kanonkop Pinotage R350');
      expect(parseMenuFromImage).not.toHaveBeenCalled();
    });

    it('parses image menu and returns result', async () => {
      parseMenuFromImage.mockResolvedValue(PARSE_RESULT);

      const res = await request(app).post('/parse-menu').send(VALID_PARSE_IMAGE);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(PARSE_RESULT);
    });

    it('passes type, image, mediaType to parseMenuFromImage', async () => {
      parseMenuFromImage.mockResolvedValue(PARSE_RESULT);

      await request(app).post('/parse-menu').send(VALID_PARSE_IMAGE);

      expect(parseMenuFromImage).toHaveBeenCalledWith('wine_list', 'iVBORw0KGgo=', 'image/jpeg');
      expect(parseMenuFromText).not.toHaveBeenCalled();
    });

    it('accepts dish_menu type', async () => {
      parseMenuFromText.mockResolvedValue(PARSE_RESULT);

      const res = await request(app)
        .post('/parse-menu')
        .send({ type: 'dish_menu', text: 'Grilled Salmon R185' });

      expect(res.status).toBe(200);
      expect(parseMenuFromText).toHaveBeenCalledWith('dish_menu', 'Grilled Salmon R185');
    });
  });

  describe('Zod validation', () => {
    it('rejects missing text and image with 400', async () => {
      const res = await request(app)
        .post('/parse-menu')
        .send({ type: 'wine_list' });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(parseMenuFromText).not.toHaveBeenCalled();
    });

    it('rejects both text and image with 400', async () => {
      const res = await request(app)
        .post('/parse-menu')
        .send({
          type: 'wine_list',
          text: 'some text',
          image: 'iVBORw0KGgo=',
          mediaType: 'image/jpeg'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects invalid menu type with 400', async () => {
      const res = await request(app)
        .post('/parse-menu')
        .send({ type: 'cocktail_list', text: 'text' });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects image without mediaType with 400', async () => {
      const res = await request(app)
        .post('/parse-menu')
        .send({ type: 'wine_list', image: 'iVBORw0KGgo=' });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects text exceeding max length with 400', async () => {
      const res = await request(app)
        .post('/parse-menu')
        .send({ type: 'wine_list', text: 'x'.repeat(5001) });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('rejectOversizedImage', () => {
    it('returns 413 for image exceeding MAX_IMAGE_BASE64_CHARS', async () => {
      const res = await request(app)
        .post('/parse-menu')
        .send({
          type: 'wine_list',
          image: 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 1),
          mediaType: 'image/jpeg'
        });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain('Image too large');
      expect(parseMenuFromImage).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns 500 with production error contract when service throws', async () => {
      parseMenuFromText.mockRejectedValue(new Error('Claude API failure'));

      const res = await request(app).post('/parse-menu').send(VALID_PARSE_TEXT);

      expect(res.status).toBe(500);
      expect(res.body.error).toHaveProperty('code', 'INTERNAL_ERROR');
      expect(res.body.error).toHaveProperty('message');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /recommend
// ---------------------------------------------------------------------------

describe('POST /recommend', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  describe('happy path', () => {
    it('returns recommendation result', async () => {
      getRecommendations.mockResolvedValue(RECOMMEND_RESULT);

      const res = await request(app).post('/recommend').send(VALID_RECOMMEND);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(RECOMMEND_RESULT);
    });

    it('passes body, user.id, cellarId to getRecommendations', async () => {
      getRecommendations.mockResolvedValue(RECOMMEND_RESULT);

      await request(app).post('/recommend').send(VALID_RECOMMEND);

      expect(getRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          wines: expect.any(Array),
          dishes: expect.any(Array)
        }),
        'user-1',
        42
      );
    });

    it('applies Zod defaults for optional fields', async () => {
      getRecommendations.mockResolvedValue(RECOMMEND_RESULT);

      await request(app).post('/recommend').send(VALID_RECOMMEND);

      const body = getRecommendations.mock.calls[0][0];
      expect(body.colour_preferences).toEqual([]);
      expect(body.prefer_by_glass).toBe(false);
      expect(body.budget_max).toBeNull();
      expect(body.party_size).toBeNull();
    });
  });

  describe('Zod validation', () => {
    it('rejects missing wines with 400', async () => {
      const res = await request(app)
        .post('/recommend')
        .send({ dishes: [{ id: 1, name: 'Steak' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(getRecommendations).not.toHaveBeenCalled();
    });

    it('rejects missing dishes with 400', async () => {
      const res = await request(app)
        .post('/recommend')
        .send({ wines: [{ id: 1, name: 'Wine', by_the_glass: false }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects empty wines array with 400', async () => {
      const res = await request(app)
        .post('/recommend')
        .send({ wines: [], dishes: [{ id: 1, name: 'Steak' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects wine without name with 400', async () => {
      const res = await request(app)
        .post('/recommend')
        .send({
          wines: [{ id: 1, by_the_glass: false }],
          dishes: [{ id: 1, name: 'Steak' }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects invalid colour_preferences value with 400', async () => {
      const res = await request(app)
        .post('/recommend')
        .send({
          ...VALID_RECOMMEND,
          colour_preferences: ['orange']
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('error handling', () => {
    it('returns 500 with production error contract when service throws', async () => {
      getRecommendations.mockRejectedValue(new Error('AI failure'));

      const res = await request(app).post('/recommend').send(VALID_RECOMMEND);

      expect(res.status).toBe(500);
      expect(res.body.error).toHaveProperty('code', 'INTERNAL_ERROR');
      expect(res.body.error).toHaveProperty('message');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /chat
// ---------------------------------------------------------------------------

describe('POST /chat', () => {
  let app;
  beforeAll(() => { app = createApp(); });

  describe('happy path', () => {
    it('returns chat result', async () => {
      continueChat.mockResolvedValue(CHAT_RESULT);

      const res = await request(app).post('/chat').send(VALID_CHAT);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(CHAT_RESULT);
    });

    it('passes chatId, message, user.id, cellarId to continueChat', async () => {
      continueChat.mockResolvedValue(CHAT_RESULT);

      await request(app).post('/chat').send(VALID_CHAT);

      expect(continueChat).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        'What about white wines?',
        'user-1',
        42
      );
    });
  });

  describe('API key check', () => {
    it('returns 503 when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const res = await request(app).post('/chat').send(VALID_CHAT);

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('API key configuration');
      expect(continueChat).not.toHaveBeenCalled();
    });
  });

  describe('chat ownership errors', () => {
    it('returns 404 for CHAT_ERRORS.NOT_FOUND', async () => {
      const err = new Error('Chat session not found');
      err.code = CHAT_ERRORS.NOT_FOUND;
      continueChat.mockRejectedValue(err);

      const res = await request(app).post('/chat').send(VALID_CHAT);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Chat session not found' });
    });

    it('returns 403 for CHAT_ERRORS.FORBIDDEN', async () => {
      const err = new Error('Not authorised for this chat');
      err.code = CHAT_ERRORS.FORBIDDEN;
      continueChat.mockRejectedValue(err);

      const res = await request(app).post('/chat').send(VALID_CHAT);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Not authorised for this chat' });
    });
  });

  describe('error handling', () => {
    it('re-throws non-chat errors to production errorHandler', async () => {
      continueChat.mockRejectedValue(new Error('Unexpected failure'));

      const res = await request(app).post('/chat').send(VALID_CHAT);

      expect(res.status).toBe(500);
      expect(res.body.error).toHaveProperty('code', 'INTERNAL_ERROR');
      expect(res.body.error).toHaveProperty('message');
    });
  });

  describe('Zod validation', () => {
    it('rejects invalid chatId (not UUID) with 400', async () => {
      const res = await request(app)
        .post('/chat')
        .send({ chatId: 'not-a-uuid', message: 'Hello' });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(continueChat).not.toHaveBeenCalled();
    });

    it('rejects empty message with 400', async () => {
      const res = await request(app)
        .post('/chat')
        .send({ chatId: '550e8400-e29b-41d4-a716-446655440000', message: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('rejects message exceeding 2000 chars with 400', async () => {
      const res = await request(app)
        .post('/chat')
        .send({
          chatId: '550e8400-e29b-41d4-a716-446655440000',
          message: 'x'.repeat(2001)
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });
});

// ---------------------------------------------------------------------------
// Rate limiter wiring
// ---------------------------------------------------------------------------

describe('rate limiter wiring', () => {
  it('wires strictRateLimiter on all three endpoints', () => {
    expect(rateLimiterSetup.strictCallCount).toBe(3);
  });

  it('wires parseRateLimiter via createRateLimiter with 10/15min config', () => {
    expect(rateLimiterSetup.createCallCount).toBe(1);
    expect(rateLimiterSetup.createArgs).toEqual(expect.objectContaining({
      maxRequests: 10,
      windowMs: 15 * 60 * 1000
    }));
  });

  it('parseRateLimiter message mentions menu parse', () => {
    expect(rateLimiterSetup.createArgs.message).toContain('menu parse');
  });

  it('parseRateLimiter keyGenerator produces user+cellar scoped key', () => {
    const key = rateLimiterSetup.createArgs.keyGenerator({
      user: { id: 'u1' },
      cellarId: 99
    });
    expect(key).toBe('rest-parse:u1:99');
  });

  it('parseRateLimiter keyGenerator falls back for missing user', () => {
    const key = rateLimiterSetup.createArgs.keyGenerator({ cellarId: 5 });
    expect(key).toBe('rest-parse:anon:5');
  });
});

// ---------------------------------------------------------------------------
// Middleware integration (real middleware, not mocked)
// ---------------------------------------------------------------------------

describe('middleware integration', () => {
  describe('auth rejection (real requireAuth)', () => {
    it('returns 401 when no Bearer token is provided', async () => {
      const authApp = createAuthApp();

      const res = await request(authApp).post('/parse-menu').send(VALID_PARSE_TEXT);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'No token provided');
    });
  });

  describe('cellar context rejection (real requireCellarContext)', () => {
    it('returns 400 when no cellar context is set', async () => {
      const cellarApp = createCellarAuthApp();

      const res = await request(cellarApp)
        .post('/parse-menu')
        .set('Authorization', 'Bearer test-token')
        .send(VALID_PARSE_TEXT);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No active cellar');
      expect(parseMenuFromText).not.toHaveBeenCalled();
    });

    it('returns 403 when user is not a member of requested cellar', async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(undefined) });
      const cellarApp = createCellarAuthApp();

      const res = await request(cellarApp)
        .post('/parse-menu')
        .set('Authorization', 'Bearer test-token')
        .set('X-Cellar-ID', '999')
        .send(VALID_PARSE_TEXT);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Not a member');
      expect(parseMenuFromText).not.toHaveBeenCalled();
    });
  });

  describe('server-mount 413 normalizer', () => {
    it('normalizes body-parser entity.too.large to JSON contract', async () => {
      const serverApp = createServerMountApp();

      const res = await request(serverApp)
        .post('/parse-menu')
        .send({ type: 'wine_list', text: 'x'.repeat(200) });

      expect(res.status).toBe(413);
      expect(res.body).toEqual({ error: 'Request payload too large (max 5MB)' });
    });
  });
});
