/**
 * @fileoverview Tests for GET/POST /api/cellar/suggest-placement flat response contract.
 * Verifies that the response includes top-level convenience fields (suggestedSlot,
 * zoneName, zoneId, confidence, alternativeZones) alongside the nested suggestion object.
 */

// Mock all dependencies BEFORE imports
vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../src/services/cellar/cellarPlacement.js', () => ({
  findBestZone: vi.fn(),
  findAvailableSlot: vi.fn(),
  inferColor: vi.fn(),
}));

vi.mock('../../../src/services/cellar/cellarAllocation.js', () => ({
  getActiveZoneMap: vi.fn().mockResolvedValue({}),
  getZoneStatuses: vi.fn().mockResolvedValue([]),
  getAllZoneAllocations: vi.fn().mockResolvedValue([]),
  allocateRowToZone: vi.fn(),
  updateZoneWineCount: vi.fn(),
}));

vi.mock('../../../src/config/cellarZones.js', () => ({
  CELLAR_ZONES: [],
  getZoneById: vi.fn(),
  ZONE_PRIORITY_ORDER: [],
}));

vi.mock('../../../src/services/shared/cacheService.js', () => ({
  invalidateAnalysisCache: vi.fn(),
}));

vi.mock('../../../src/services/zone/zoneChat.js', () => ({
  reassignWineZone: vi.fn(),
}));

vi.mock('../../../src/services/wine/grapeEnrichment.js', () => ({
  batchDetectGrapes: vi.fn(),
  detectGrapesFromWine: vi.fn(() => ({ grapes: null, confidence: 'low', source: 'name' })),
}));

vi.mock('../../../src/services/wine/grapeSearch.js', () => ({
  batchSearchGrapeVarieties: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import cellarRouter from '../../../src/routes/cellar.js';
import db from '../../../src/db/index.js';
import { findBestZone, findAvailableSlot } from '../../../src/services/cellar/cellarPlacement.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = 'test-cellar'; next(); });
  app.use('/cellar', cellarRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

const mockZoneMatch = {
  zoneId: 'cabernet_red',
  displayName: 'Cabernet & Blends',
  confidence: 'medium',
  score: 72,
  reason: 'Matched on: grape: cabernet sauvignon',
  alternativeZones: [
    { zoneId: 'sa_blends', displayName: 'SA Blends', score: 60, matchedOn: ['country: south africa'] },
    { zoneId: 'other_red', displayName: 'Other Reds', score: 45, matchedOn: ['color: red'] },
  ],
  requiresReview: false,
};

const mockSlot = { slotId: 'R5C3', zoneId: 'cabernet_red', isOverflow: false, requiresSwap: false };

describe('GET /cellar/suggest-placement/:wineId — flat response contract', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();

    // DB: occupied slots query returns empty, wine lookup returns a wine
    db.prepare.mockImplementation(() => ({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        id: 10, wine_name: 'Test Cabernet', vintage: 2020,
        colour: 'red', country: 'France', grapes: 'Cabernet Sauvignon',
      }),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
    }));

    findBestZone.mockReturnValue(mockZoneMatch);
    findAvailableSlot.mockResolvedValue(mockSlot);
  });

  it('returns flat suggestedSlot, zoneName, zoneId, confidence, alternativeZones', async () => {
    const res = await request(app).get('/cellar/suggest-placement/10');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.suggestedSlot).toBe('R5C3');
    expect(res.body.zoneName).toBe('Cabernet & Blends');
    expect(res.body.zoneId).toBe('cabernet_red');
    expect(res.body.confidence).toBe('medium');
    expect(res.body.alternativeZones).toHaveLength(2);
    expect(res.body.alternativeZones[0].zoneId).toBe('sa_blends');
  });

  it('returns suggestedSlot=null when no slot available', async () => {
    findAvailableSlot.mockResolvedValue(null);

    const res = await request(app).get('/cellar/suggest-placement/10');

    expect(res.status).toBe(200);
    expect(res.body.suggestedSlot).toBeNull();
    expect(res.body.zoneName).toBe('Cabernet & Blends');
  });

  it('returns wine metadata alongside flat fields', async () => {
    const res = await request(app).get('/cellar/suggest-placement/10');

    expect(res.body.wine).toEqual({
      id: 10,
      name: 'Test Cabernet',
      vintage: 2020,
    });
  });

  it('preserves nested suggestion object for backward compat', async () => {
    const res = await request(app).get('/cellar/suggest-placement/10');

    expect(res.body.suggestion).toBeDefined();
    expect(res.body.suggestion.zone.zoneId).toBe('cabernet_red');
    expect(res.body.suggestion.slot.slotId).toBe('R5C3');
  });

  it('returns 404 when wine not found', async () => {
    db.prepare.mockImplementation(() => ({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
    }));

    const res = await request(app).get('/cellar/suggest-placement/999');

    expect(res.status).toBe(404);
  });

  it('returns empty alternativeZones when confidence is high', async () => {
    findBestZone.mockReturnValue({
      ...mockZoneMatch,
      confidence: 'high',
      alternativeZones: [],
    });

    const res = await request(app).get('/cellar/suggest-placement/10');

    expect(res.body.confidence).toBe('high');
    expect(res.body.alternativeZones).toEqual([]);
  });
});

describe('POST /cellar/suggest-placement — flat response contract', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();

    db.prepare.mockImplementation(() => ({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
    }));

    findBestZone.mockReturnValue(mockZoneMatch);
    findAvailableSlot.mockResolvedValue(mockSlot);
  });

  it('returns flat fields for POST with wine object', async () => {
    const res = await request(app)
      .post('/cellar/suggest-placement')
      .send({ wine: { wine_name: 'Test Cab', colour: 'red', grapes: 'Cabernet Sauvignon' } });

    expect(res.status).toBe(200);
    expect(res.body.suggestedSlot).toBe('R5C3');
    expect(res.body.zoneName).toBe('Cabernet & Blends');
    expect(res.body.zoneId).toBe('cabernet_red');
    expect(res.body.confidence).toBe('medium');
    expect(res.body.alternativeZones).toHaveLength(2);
  });

  it('returns 400 when wine object is missing', async () => {
    const res = await request(app)
      .post('/cellar/suggest-placement')
      .send({});

    expect(res.status).toBe(400);
  });
});
