/**
 * @fileoverview Unit tests for pending ratings route.
 * Covers enhanced GET (previous rating, pairing context) and enhanced PUT (pairing feedback).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db before imports
vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../../src/services/pairing/pairingSession.js', () => ({
  recordFeedback: vi.fn()
}));

import db from '../../../src/db/index.js';
import { recordFeedback } from '../../../src/services/pairing/pairingSession.js';
import router from '../../../src/routes/pendingRatings.js';

const CELLAR_ID = 'cellar-uuid-test';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cellarId = CELLAR_ID;
    req.cellarRole = 'owner';
    next();
  });
  app.use('/', router);
  return app;
}

function mockPrepare(results) {
  const chain = {
    get: vi.fn().mockResolvedValue(results.get ?? null),
    all: vi.fn().mockResolvedValue(results.all ?? []),
    run: vi.fn().mockResolvedValue({ changes: results.changes ?? 1 })
  };
  db.prepare.mockReturnValue(chain);
  return chain;
}

describe('GET /api/pending-ratings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns needsRating and alreadyRated buckets', async () => {
    const rows = [
      {
        id: 1, wine_id: 10, wine_name: 'Kanonkop Pinotage', vintage: 2019,
        colour: 'red', style: 'full_red', location_code: 'R3C1',
        consumed_at: '2026-01-01T12:00:00Z',
        pairing_session_id: null, existing_rating: null, existing_notes: null,
        previous_rating: 4.0, pairing_dish: null, pairing_already_rated: null
      },
      {
        id: 2, wine_id: 11, wine_name: 'Rustenberg Chardonnay', vintage: 2022,
        colour: 'white', style: 'full_white', location_code: 'F2',
        consumed_at: '2026-01-02T12:00:00Z',
        pairing_session_id: null, existing_rating: 4, existing_notes: 'Great',
        previous_rating: null, pairing_dish: null, pairing_already_rated: null
      }
    ];
    mockPrepare({ all: rows });

    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.needsRating).toHaveLength(1);
    expect(res.body.alreadyRated).toHaveLength(1);
    expect(res.body.needsRating[0].previous_rating).toBe(4.0);
  });

  it('returns pairing context fields when linked to a session', async () => {
    const rows = [
      {
        id: 3, wine_id: 20, wine_name: 'Meerlust Rubicon', vintage: 2018,
        colour: 'red', style: 'full_red', location_code: 'R5C2',
        consumed_at: '2026-01-03T12:00:00Z',
        pairing_session_id: 42, existing_rating: null, existing_notes: null,
        previous_rating: null, pairing_dish: 'grilled lamb', pairing_already_rated: null
      }
    ];
    mockPrepare({ all: rows });

    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    const item = res.body.needsRating[0];
    expect(item.pairing_session_id).toBe(42);
    expect(item.pairing_dish).toBe('grilled lamb');
    expect(item.pairing_already_rated).toBeNull();
  });

  it('returns empty arrays when no pending ratings', async () => {
    mockPrepare({ all: [] });
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.needsRating).toHaveLength(0);
    expect(res.body.alreadyRated).toHaveLength(0);
  });
});

describe('PUT /:id/resolve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a pending rating without pairing feedback', async () => {
    const pending = { consumption_log_id: 99, wine_id: 10, pairing_session_id: null };
    db.prepare
      .mockReturnValueOnce({ get: vi.fn().mockResolvedValue(pending) })   // SELECT pending
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })         // UPDATE consumption_log
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })         // UPDATE wines
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) });        // UPDATE pending_ratings

    const res = await request(createApp())
      .put('/5/resolve')
      .send({ status: 'rated', rating: 4, notes: 'Lovely' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('saves pairing feedback when provided with a session link', async () => {
    const pending = { consumption_log_id: 99, wine_id: 10, pairing_session_id: 42 };
    db.prepare
      .mockReturnValueOnce({ get: vi.fn().mockResolvedValue(pending) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) });
    recordFeedback.mockResolvedValue();

    const res = await request(createApp())
      .put('/5/resolve')
      .send({
        status: 'rated',
        rating: 4,
        notes: 'Good',
        pairingFeedback: { pairingFitRating: 5, wouldPairAgain: true }
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(recordFeedback).toHaveBeenCalledWith(42, {
      pairingFitRating: 5,
      wouldPairAgain: true,
      failureReasons: null,
      notes: null
    }, CELLAR_ID);
  });

  it('returns partial-success when pairing feedback save fails', async () => {
    const pending = { consumption_log_id: 99, wine_id: 10, pairing_session_id: 42 };
    db.prepare
      .mockReturnValueOnce({ get: vi.fn().mockResolvedValue(pending) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) });
    recordFeedback.mockRejectedValue(new Error('DB error'));

    const res = await request(createApp())
      .put('/5/resolve')
      .send({
        status: 'rated',
        rating: 3,
        pairingFeedback: { pairingFitRating: 3, wouldPairAgain: null }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pairingFeedbackError).toBeTruthy();
  });

  it('returns 404 for already-resolved (idempotency)', async () => {
    db.prepare.mockReturnValueOnce({ get: vi.fn().mockResolvedValue(null) });

    const res = await request(createApp())
      .put('/5/resolve')
      .send({ status: 'rated', rating: 4 });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status via Zod validation', async () => {
    const res = await request(createApp())
      .put('/5/resolve')
      .send({ status: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('dismisses without touching consumption_log', async () => {
    const pending = { consumption_log_id: 99, wine_id: 10, pairing_session_id: null };
    db.prepare
      .mockReturnValueOnce({ get: vi.fn().mockResolvedValue(pending) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) }); // UPDATE pending_ratings only

    const res = await request(createApp())
      .put('/5/resolve')
      .send({ status: 'dismissed' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // Should not call recordFeedback for dismissed
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('passes wouldPairAgain: null when not answered', async () => {
    const pending = { consumption_log_id: 99, wine_id: 10, pairing_session_id: 7 };
    db.prepare
      .mockReturnValueOnce({ get: vi.fn().mockResolvedValue(pending) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) })
      .mockReturnValueOnce({ run: vi.fn().mockResolvedValue({}) });
    recordFeedback.mockResolvedValue();

    await request(createApp())
      .put('/5/resolve')
      .send({
        status: 'rated',
        rating: 4,
        pairingFeedback: { pairingFitRating: 4, wouldPairAgain: null }
      });

    expect(recordFeedback).toHaveBeenCalledWith(7, expect.objectContaining({
      wouldPairAgain: null
    }), CELLAR_ID);
  });
});
