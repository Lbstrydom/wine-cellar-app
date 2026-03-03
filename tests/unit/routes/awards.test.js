/**
 * @fileoverview Tests for awards route match-all behavior.
 * Focuses on AI-assisted re-match response shape and graceful fallback.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('../../../src/services/awards/index.js', () => ({
  getAwardSources: vi.fn(),
  autoMatchAwards: vi.fn(),
  getSourceAwards: vi.fn(),
  deleteSource: vi.fn(),
  getKnownCompetitions: vi.fn(),
  addCompetition: vi.fn(),
  extractFromWebpage: vi.fn(),
  getOrCreateSource: vi.fn(),
  importAwards: vi.fn(),
  extractFromPDF: vi.fn(),
  extractFromText: vi.fn(),
  searchAwards: vi.fn(),
  getWineAwards: vi.fn(),
  linkAwardToWine: vi.fn(),
  unlinkAward: vi.fn(),
  findMatches: vi.fn()
}));

vi.mock('../../../src/services/awards/ocrService.js', () => ({
  getOCRStatus: vi.fn().mockResolvedValue({ available: true, method: 'local' })
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import express from 'express';
import request from 'supertest';
import awardsRouter from '../../../src/routes/awards.js';
import * as awardsService from '../../../src/services/awards/index.js';

function createApp(cellarId = 'cellar-test') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cellarId = cellarId;
    next();
  });
  app.use('/', awardsRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('awards route match-all', () => {
  const originalEnv = process.env;
  let app;

  beforeAll(() => {
    app = createApp('cellar-42');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('runs deterministic matching only — does not pass aiVerify', async () => {
    awardsService.getAwardSources.mockResolvedValue([
      { id: 'chardonnay_du_monde_2024' },
      { id: 'veritas_2024' }
    ]);

    awardsService.autoMatchAwards
      .mockResolvedValueOnce({ exactMatches: 2, fuzzyMatches: 1, noMatches: 3 })
      .mockResolvedValueOnce({ exactMatches: 1, fuzzyMatches: 0, noMatches: 2 });

    const res = await request(app).post('/match-all');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'Matching completed',
      sourcesProcessed: 2,
      exactMatches: 3,
      fuzzyMatches: 1,
      noMatches: 5
    });
    // AI counts must NOT appear in match-all response
    expect(res.body).not.toHaveProperty('aiVerifiedMatches');
    expect(res.body).not.toHaveProperty('aiEnabled');

    expect(awardsService.autoMatchAwards).toHaveBeenCalledTimes(2);
    expect(awardsService.autoMatchAwards).toHaveBeenNthCalledWith(1, 'chardonnay_du_monde_2024', {
      cellarId: 'cellar-42'
    });
    expect(awardsService.autoMatchAwards).toHaveBeenNthCalledWith(2, 'veritas_2024', {
      cellarId: 'cellar-42'
    });
  });

  it('passes cellar scope through single-source rematch endpoint', async () => {
    awardsService.autoMatchAwards.mockResolvedValue({
      exactMatches: 1,
      fuzzyMatches: 0,
      noMatches: 0
    });

    const res = await request(app).post('/sources/source_1/match');

    expect(res.status).toBe(200);
    expect(awardsService.autoMatchAwards).toHaveBeenCalledWith('source_1', { cellarId: 'cellar-42' });
  });
});

describe('awards route deep-match', () => {
  const originalEnv = process.env;
  let app;

  beforeAll(() => {
    app = createApp('cellar-42');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('passes aiVerify:true and returns aggregated AI counters with aiEnabled=true', async () => {
    awardsService.getAwardSources.mockResolvedValue([
      { id: 'chardonnay_du_monde_2024' },
      { id: 'veritas_2024' }
    ]);

    awardsService.autoMatchAwards
      .mockResolvedValueOnce({
        exactMatches: 0,
        fuzzyMatches: 0,
        noMatches: 2,
        aiVerifiedMatches: 1,
        aiReviewed: 3
      })
      .mockResolvedValueOnce({
        exactMatches: 0,
        fuzzyMatches: 1,
        noMatches: 1,
        aiVerifiedMatches: 0,
        aiReviewed: 2
      });

    const res = await request(app).post('/deep-match');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'AI deep match completed',
      sourcesProcessed: 2,
      aiVerifiedMatches: 1,
      aiReviewed: 5,
      aiEnabled: true
    });

    expect(awardsService.autoMatchAwards).toHaveBeenCalledTimes(2);
    expect(awardsService.autoMatchAwards).toHaveBeenNthCalledWith(1, 'chardonnay_du_monde_2024', {
      cellarId: 'cellar-42',
      aiVerify: true
    });
    expect(awardsService.autoMatchAwards).toHaveBeenNthCalledWith(2, 'veritas_2024', {
      cellarId: 'cellar-42',
      aiVerify: true
    });
  });

  it('returns aiEnabled:false and zero AI counters when ANTHROPIC_API_KEY absent', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    awardsService.getAwardSources.mockResolvedValue([{ id: 'source_1' }]);
    awardsService.autoMatchAwards.mockResolvedValue({
      exactMatches: 1,
      fuzzyMatches: 2,
      noMatches: 4,
      aiVerifiedMatches: 0,
      aiReviewed: 0
    });

    const res = await request(app).post('/deep-match');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sourcesProcessed: 1,
      exactMatches: 1,
      fuzzyMatches: 2,
      noMatches: 4,
      aiVerifiedMatches: 0,
      aiReviewed: 0,
      aiEnabled: false
    });
  });

  it('passes cellar scope to each source call', async () => {
    awardsService.getAwardSources.mockResolvedValue([{ id: 'src_x' }]);
    awardsService.autoMatchAwards.mockResolvedValue({
      exactMatches: 0, fuzzyMatches: 0, noMatches: 0,
      aiVerifiedMatches: 0, aiReviewed: 0
    });

    await request(app).post('/deep-match');

    expect(awardsService.autoMatchAwards).toHaveBeenCalledWith('src_x', {
      cellarId: 'cellar-42',
      aiVerify: true
    });
  });
});
