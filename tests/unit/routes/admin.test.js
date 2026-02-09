/**
 * @fileoverview Tests for admin route authentication (Phase 1.1 security fix).
 * Verifies that /api/admin endpoints require authentication.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

// Mock logger to suppress output
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

import express from 'express';
import request from 'supertest';
import { requireAuth } from '../../../src/middleware/auth.js';
import adminRoutes from '../../../src/routes/admin.js';
import db from '../../../src/db/index.js';

/**
 * Create app with real requireAuth middleware (no auth bypass).
 * This tests that unauthenticated requests are rejected.
 */
function createAuthApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', requireAuth, adminRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

/**
 * Create app with mocked auth (for testing handler logic).
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', email: 'test@example.com' };
    next();
  });
  app.use('/admin', adminRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('Admin routes — authentication (Phase 1.1)', () => {
  it('GET /admin/ai-reviews returns 401 without a token', async () => {
    const app = createAuthApp();
    const res = await request(app).get('/admin/ai-reviews');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('PATCH /admin/ai-reviews/:id/rating returns 401 without a token', async () => {
    const app = createAuthApp();
    const res = await request(app)
      .patch('/admin/ai-reviews/1/rating')
      .send({ rating: 4 });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });
});

describe('Admin routes — handler logic', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([]),
    });
  });

  it('GET /admin/ai-reviews returns data array', async () => {
    const mockReviews = [{ id: 1, prompt: 'test', created_at: '2026-01-01' }];
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue(mockReviews),
    });

    const res = await request(app).get('/admin/ai-reviews');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(mockReviews);
    expect(res.body.count).toBe(1);
  });

  it('PATCH /admin/ai-reviews/:id/rating rejects invalid rating', async () => {
    const res = await request(app)
      .patch('/admin/ai-reviews/1/rating')
      .send({ rating: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rating/i);
  });

  it('PATCH /admin/ai-reviews/:id/rating accepts valid rating', async () => {
    const res = await request(app)
      .patch('/admin/ai-reviews/1/rating')
      .send({ rating: 4, notes: 'Good pairing' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Rating saved');
  });
});
