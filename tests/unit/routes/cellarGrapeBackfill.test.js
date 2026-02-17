/**
 * @fileoverview Tests for POST /api/cellar/grape-backfill endpoint.
 * Tests dry-run mode, commit mode, zone re-classification, and cache invalidation.
 */

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

// Mock cellar placement
vi.mock('../../../src/services/cellar/cellarPlacement.js', () => ({
  findBestZone: vi.fn(),
  findAvailableSlot: vi.fn()
}));

// Mock cellar allocation
vi.mock('../../../src/services/cellar/cellarAllocation.js', () => ({
  getActiveZoneMap: vi.fn().mockResolvedValue({}),
  getZoneStatuses: vi.fn().mockResolvedValue([]),
  getAllZoneAllocations: vi.fn().mockResolvedValue([]),
  allocateRowToZone: vi.fn(),
  updateZoneWineCount: vi.fn()
}));

// Mock cache service
vi.mock('../../../src/services/shared/cacheService.js', () => ({
  invalidateAnalysisCache: vi.fn()
}));

// Mock zone chat
vi.mock('../../../src/services/zone/zoneChat.js', () => ({
  reassignWineZone: vi.fn()
}));

// Mock grape enrichment with controllable results
vi.mock('../../../src/services/wine/grapeEnrichment.js', () => ({
  batchDetectGrapes: vi.fn()
}));

// Mock cellar zones config
vi.mock('../../../src/config/cellarZones.js', () => ({
  CELLAR_ZONES: [],
  getZoneById: vi.fn()
}));

import express from 'express';
import request from 'supertest';
import cellarRouter from '../../../src/routes/cellar.js';
import db from '../../../src/db/index.js';
import { batchDetectGrapes } from '../../../src/services/wine/grapeEnrichment.js';
import { findBestZone } from '../../../src/services/cellar/cellarPlacement.js';
import { updateZoneWineCount } from '../../../src/services/cellar/cellarAllocation.js';
import { invalidateAnalysisCache } from '../../../src/services/shared/cacheService.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = 1; next(); });
  app.use('/cellar', cellarRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

// Reusable mock wine data
const MOCK_WINES = [
  { id: 10, wine_name: 'Kanonkop Pinotage 2019', grapes: null, zone_id: 'unclassified' },
  { id: 11, wine_name: 'Mystery Blend 2020', grapes: null, zone_id: 'red_buffer' },
  { id: 12, wine_name: 'Barolo Riserva 2016', grapes: null, zone_id: 'unclassified' }
];

describe('POST /cellar/grape-backfill', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();

    // Default db.prepare mock: returns chainable .all(), .get(), .run()
    db.prepare.mockImplementation((sql) => ({
      all: vi.fn().mockResolvedValue(MOCK_WINES),
      get: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    }));
  });

  describe('dry-run mode (default)', () => {
    it('returns suggestions without writing to DB', async () => {
      batchDetectGrapes.mockReturnValue([
        { wineId: 10, wine_name: 'Kanonkop Pinotage 2019', detection: { grapes: 'Pinotage', confidence: 'high', source: 'name' } },
        { wineId: 11, wine_name: 'Mystery Blend 2020', detection: { grapes: null, confidence: 'low', source: 'name' } },
        { wineId: 12, wine_name: 'Barolo Riserva 2016', detection: { grapes: 'Nebbiolo', confidence: 'high', source: 'appellation' } }
      ]);

      const res = await request(app)
        .post('/cellar/grape-backfill')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mode).toBe('dry-run');
      expect(res.body.totalMissing).toBe(3);
      expect(res.body.detectable).toBe(2);
      expect(res.body.suggestions).toHaveLength(2);
      expect(res.body.suggestions[0]).toEqual({
        wineId: 10,
        wine_name: 'Kanonkop Pinotage 2019',
        grapes: 'Pinotage',
        confidence: 'high',
        source: 'name'
      });
    });

    it('returns 0 detectable when no grapes found', async () => {
      batchDetectGrapes.mockReturnValue([
        { wineId: 11, wine_name: 'Mystery Blend 2020', detection: { grapes: null, confidence: 'low', source: 'name' } }
      ]);

      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockResolvedValue([MOCK_WINES[1]]),
        get: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ changes: 1 })
      }));

      const res = await request(app)
        .post('/cellar/grape-backfill')
        .send({ commit: false });

      expect(res.body.totalMissing).toBe(1);
      expect(res.body.detectable).toBe(0);
      expect(res.body.suggestions).toEqual([]);
    });

    it('does not call db UPDATE in dry-run mode', async () => {
      batchDetectGrapes.mockReturnValue([
        { wineId: 10, wine_name: 'Test', detection: { grapes: 'Pinotage', confidence: 'high', source: 'name' } }
      ]);

      await request(app)
        .post('/cellar/grape-backfill')
        .send({});

      // The first call is the SELECT for wines with missing grapes.
      // There should be NO UPDATE calls (which would be additional prepare calls).
      const prepareCalls = db.prepare.mock.calls;
      const hasUpdate = prepareCalls.some(([sql]) => sql.includes('UPDATE'));
      expect(hasUpdate).toBe(false);
    });
  });

  describe('commit mode', () => {
    it('writes grapes and re-classifies zones', async () => {
      batchDetectGrapes.mockReturnValue([
        { wineId: 10, wine_name: 'Kanonkop Pinotage 2019', detection: { grapes: 'Pinotage', confidence: 'high', source: 'name' } }
      ]);

      // After grapes UPDATE, SELECT returns the updated wine
      const updatedWine = { ...MOCK_WINES[0], grapes: 'Pinotage', zone_id: 'unclassified' };
      const runMock = vi.fn().mockResolvedValue({ changes: 1 });
      const getMock = vi.fn().mockResolvedValue(updatedWine);

      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockResolvedValue([MOCK_WINES[0]]),
        get: getMock,
        run: runMock
      }));

      findBestZone.mockReturnValue({
        zoneId: 'pinotage',
        displayName: 'Pinotage',
        confidence: 'high',
        score: 85
      });

      const res = await request(app)
        .post('/cellar/grape-backfill')
        .send({ commit: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mode).toBe('commit');
      expect(res.body.updated).toBe(1);
      expect(res.body.reclassified).toBe(1);
      expect(updateZoneWineCount).toHaveBeenCalledWith('unclassified', 1, -1);
      expect(updateZoneWineCount).toHaveBeenCalledWith('pinotage', 1, 1);
    });

    it('does not reclassify when zone confidence is low', async () => {
      batchDetectGrapes.mockReturnValue([
        { wineId: 10, wine_name: 'Test', detection: { grapes: 'Malbec', confidence: 'medium', source: 'region' } }
      ]);

      const updatedWine = { ...MOCK_WINES[0], grapes: 'Malbec', zone_id: 'red_buffer' };
      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockResolvedValue([MOCK_WINES[0]]),
        get: vi.fn().mockResolvedValue(updatedWine),
        run: vi.fn().mockResolvedValue({ changes: 1 })
      }));

      findBestZone.mockReturnValue({
        zoneId: 'malbec',
        displayName: 'Malbec',
        confidence: 'low',
        score: 30
      });

      const res = await request(app)
        .post('/cellar/grape-backfill')
        .send({ commit: true });

      expect(res.body.updated).toBe(1);
      expect(res.body.reclassified).toBe(0);
      expect(updateZoneWineCount).not.toHaveBeenCalled();
    });

    it('invalidates analysis cache after commit', async () => {
      batchDetectGrapes.mockReturnValue([
        { wineId: 10, wine_name: 'Test', detection: { grapes: 'Shiraz', confidence: 'high', source: 'name' } }
      ]);

      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockResolvedValue([MOCK_WINES[0]]),
        get: vi.fn().mockResolvedValue({ ...MOCK_WINES[0], zone_id: 'shiraz' }),
        run: vi.fn().mockResolvedValue({ changes: 1 })
      }));

      findBestZone.mockReturnValue({
        zoneId: 'shiraz',
        displayName: 'Shiraz',
        confidence: 'high',
        score: 90
      });

      await request(app)
        .post('/cellar/grape-backfill')
        .send({ commit: true });

      expect(invalidateAnalysisCache).toHaveBeenCalledWith(null, 1);
    });

    it('does not invalidate cache when nothing updated', async () => {
      batchDetectGrapes.mockReturnValue([]);
      db.prepare.mockImplementation(() => ({
        all: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ changes: 0 })
      }));

      await request(app)
        .post('/cellar/grape-backfill')
        .send({ commit: true });

      expect(invalidateAnalysisCache).not.toHaveBeenCalled();
    });
  });

  describe('wineIds filter', () => {
    it('only processes specified wine IDs', async () => {
      batchDetectGrapes.mockReturnValue([
        { wineId: 10, wine_name: 'Kanonkop Pinotage 2019', detection: { grapes: 'Pinotage', confidence: 'high', source: 'name' } }
      ]);

      db.prepare.mockImplementation((sql) => ({
        all: vi.fn().mockResolvedValue([MOCK_WINES[0]]),
        get: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ changes: 1 })
      }));

      const res = await request(app)
        .post('/cellar/grape-backfill')
        .send({ wineIds: [10] });

      expect(res.body.totalMissing).toBe(1);
      // Verify SQL includes IN clause
      const selectCall = db.prepare.mock.calls[0][0];
      expect(selectCall).toContain('IN');
    });

    it('returns 400 when wineIds is not an array', async () => {
      const res = await request(app)
        .post('/cellar/grape-backfill')
        .send({ wineIds: '10' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('wineIds');
    });

    it('returns 400 when wineIds contains invalid values', async () => {
      const res = await request(app)
        .post('/cellar/grape-backfill')
        .send({ wineIds: [10, 'abc'] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('positive integer');
    });
  });
});

describe('POST /cellar/update-wine-attributes (zone re-classify)', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('auto-reclassifies zone when grapes are updated and zone changes', async () => {
    const existingWine = { id: 5, wine_name: 'Test Wine', zone_id: 'unclassified', grapes: 'Shiraz' };
    const runMock = vi.fn().mockResolvedValue({ changes: 1 });

    db.prepare.mockImplementation(() => ({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(existingWine),
      run: runMock
    }));

    findBestZone.mockReturnValue({
      zoneId: 'shiraz',
      displayName: 'Shiraz',
      confidence: 'high',
      score: 85
    });

    const res = await request(app)
      .post('/cellar/update-wine-attributes')
      .send({ wineId: 5, attributes: { grapes: 'Shiraz' } });

    expect(res.status).toBe(200);
    expect(res.body.zoneReclassified).toBe(true);
    expect(updateZoneWineCount).toHaveBeenCalledWith('unclassified', 1, -1);
    expect(updateZoneWineCount).toHaveBeenCalledWith('shiraz', 1, 1);
    expect(invalidateAnalysisCache).toHaveBeenCalledWith(null, 1);
  });

  it('does not reclassify when zone confidence is low', async () => {
    const existingWine = { id: 5, wine_name: 'Test Wine', zone_id: 'red_buffer', grapes: 'Unknown' };

    db.prepare.mockImplementation(() => ({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(existingWine),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    }));

    findBestZone.mockReturnValue({
      zoneId: 'unclassified',
      displayName: 'Unclassified',
      confidence: 'low',
      score: 10
    });

    const res = await request(app)
      .post('/cellar/update-wine-attributes')
      .send({ wineId: 5, attributes: { grapes: 'Unknown' } });

    expect(res.body.zoneReclassified).toBe(false);
    expect(invalidateAnalysisCache).not.toHaveBeenCalled();
  });

  it('does not reclassify when zone stays the same', async () => {
    const existingWine = { id: 5, wine_name: 'Test', zone_id: 'shiraz' };

    db.prepare.mockImplementation(() => ({
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(existingWine),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    }));

    findBestZone.mockReturnValue({
      zoneId: 'shiraz',
      displayName: 'Shiraz',
      confidence: 'high',
      score: 90
    });

    const res = await request(app)
      .post('/cellar/update-wine-attributes')
      .send({ wineId: 5, attributes: { grapes: 'Shiraz' } });

    expect(res.body.zoneReclassified).toBe(false);
  });
});
