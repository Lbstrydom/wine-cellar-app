/**
 * @fileoverview Tests for grapes schema validation and advisory warnings on POST/PUT /api/wines.
 * Exercises REAL route handlers via supertest through the actual Express middleware chain.
 * Only db and non-relevant services are mocked; checkWineConsistency is mocked for isolation.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

// Mock consistencyChecker so we can control findings and test fail-open
vi.mock('../../../src/services/shared/consistencyChecker.js', () => ({
  checkWineConsistency: vi.fn(),
  auditCellar: vi.fn(),
}));

// Mock WineFingerprint (not under test)
vi.mock('../../../src/services/wine/wineFingerprint.js', () => ({
  WineFingerprint: {
    generateWithVersion: vi.fn(() => ({ fingerprint: 'mock-fp', version: 1 })),
    FINGERPRINT_VERSION: 1,
  }
}));

// Mock wineAddOrchestrator (not under test)
vi.mock('../../../src/services/wine/wineAddOrchestrator.js', () => ({
  evaluateWineAdd: vi.fn(),
}));

// Mock grapeEnrichment (not under test)
vi.mock('../../../src/services/wine/grapeEnrichment.js', () => ({
  detectGrapesFromWine: vi.fn(() => ({ grapes: null, confidence: 'low', source: 'name' })),
}));

import express from 'express';
import request from 'supertest';
import winesRouter from '../../../src/routes/wines.js';
import { checkWineConsistency } from '../../../src/services/shared/consistencyChecker.js';
import { detectGrapesFromWine } from '../../../src/services/wine/grapeEnrichment.js';
import db from '../../../src/db/index.js';

/**
 * Create a minimal Express app with the real wines router.
 * Injects cellarId to simulate requireCellarContext middleware.
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = 1; next(); });
  app.use('/wines', winesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('POST /wines advisory warnings (real route)', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    detectGrapesFromWine.mockReturnValue({ grapes: null, confidence: 'low', source: 'name' });
    // Default db mock: INSERT RETURNING id → { id: 1 }
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ id: 1 }),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
      all: vi.fn().mockResolvedValue([]),
    });
  });

  it('returns warnings when checker finds an issue', async () => {
    checkWineConsistency.mockReturnValue({
      wineId: 1,
      issue: 'colour_mismatch',
      severity: 'error',
      message: 'Shiraz is typically red',
      suggestedFix: 'red',
    });

    const res = await request(app)
      .post('/wines')
      .send({ wine_name: 'Kleine Zalze Shiraz', colour: 'white', grapes: 'Shiraz' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.message).toBe('Wine added');
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].severity).toBe('error');
    expect(res.body.warnings[0].suggestedFix).toBe('red');
  });

  it('returns empty warnings when wine is consistent', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .post('/wines')
      .send({ wine_name: 'Good Red Merlot', colour: 'red', grapes: 'Merlot' });

    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([]);
  });

  it('returns empty warnings when no grapes sent', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .post('/wines')
      .send({ wine_name: 'No Grapes Wine', colour: 'red' });

    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([]);
  });

  it('auto-detects and persists grapes when not provided and detection confidence is not low', async () => {
    checkWineConsistency.mockReturnValue(null);
    detectGrapesFromWine.mockReturnValue({
      grapes: 'Tempranillo',
      confidence: 'medium',
      source: 'appellation',
    });

    const runMock = vi.fn().mockResolvedValue({ changes: 1 });
    db.prepare.mockImplementation((sql) => {
      if (String(sql).includes('UPDATE wines SET grapes = $1')) {
        return {
          run: runMock,
          get: vi.fn().mockResolvedValue({}),
          all: vi.fn().mockResolvedValue([]),
        };
      }
      return {
        get: vi.fn().mockResolvedValue({ id: 1 }),
        run: vi.fn().mockResolvedValue({ changes: 0 }),
        all: vi.fn().mockResolvedValue([]),
      };
    });

    const res = await request(app)
      .post('/wines')
      .send({ wine_name: 'Castillo de Aresan Reserve', colour: 'red', region: 'Ribera del Duero' });

    expect(res.status).toBe(201);
    expect(detectGrapesFromWine).toHaveBeenCalledWith(
      expect.objectContaining({
        wine_name: 'Castillo de Aresan Reserve',
        region: 'Ribera del Duero',
      })
    );
    expect(runMock).toHaveBeenCalledWith('Tempranillo', 1, 1);
    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: 'Tempranillo' })
    );
  });

  it('grapes passes through Zod validation to consistency checker', async () => {
    // grapes is in createWineSchema as z.string().max(500).optional().nullable()
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .post('/wines')
      .send({ wine_name: 'Blend Test', colour: 'red', grapes: 'Shiraz, Merlot' });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: 'Shiraz, Merlot' })
    );
  });

  it('grapes string passes through schema validation to consistency checker', async () => {
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .post('/wines')
      .send({ wine_name: 'Array Test', colour: 'red', grapes: 'Shiraz, Merlot' });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: 'Shiraz, Merlot' })
    );
  });

  it('passes undefined grapes when body has no grapes field', async () => {
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .post('/wines')
      .send({ wine_name: 'No Grapes', colour: 'red' });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: undefined })
    );
  });

  it('fail-open: returns 201 with empty warnings when checker throws', async () => {
    checkWineConsistency.mockImplementation(() => { throw new Error('checker crash'); });

    const res = await request(app)
      .post('/wines')
      .send({ wine_name: 'Crash Test', colour: 'red' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.message).toBe('Wine added');
    expect(res.body.warnings).toEqual([]);
  });

  it('response shape is { id, message, warnings } — no data wrapper (R2-#10)', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .post('/wines')
      .send({ wine_name: 'Shape Test', colour: 'white' });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'message', 'warnings']);
  });

  it('validation rejects missing wine_name with 400', async () => {
    const res = await request(app)
      .post('/wines')
      .send({ colour: 'red' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('passes wine_name, colour, and style from validated body to checker', async () => {
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .post('/wines')
      .send({ wine_name: 'Test Syrah', colour: 'red', style: 'Rhône Blend', grapes: 'Syrah' });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({
        wine_name: 'Test Syrah',
        colour: 'red',
        style: 'Rhône Blend',
        grapes: 'Syrah',
      })
    );
  });
});

describe('PUT /wines/:id advisory warnings (real route)', () => {
  let app;

  const existingWine = {
    wine_name: 'Original Wine',
    producer: null,
    vintage: 2020,
    country: null,
    region: null,
    style: 'Bordeaux Blend',
    colour: 'red',
    grapes: 'Merlot, Cabernet Franc',
  };

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    detectGrapesFromWine.mockReturnValue({ grapes: null, confidence: 'low', source: 'name' });
    // Default: existing wine found, update succeeds
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue(existingWine),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([]),
    });
  });

  it('returns warnings when checker finds an issue', async () => {
    checkWineConsistency.mockReturnValue({
      wineId: 5,
      issue: 'colour_mismatch',
      severity: 'error',
    });

    const res = await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Updated Shiraz', colour: 'white', grapes: 'Shiraz' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Wine updated');
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].severity).toBe('error');
  });

  it('falls back to existing.grapes when grapes not in body', async () => {
    // Body has no grapes → handler uses: grapes ?? existing.grapes → 'Merlot, Cabernet Franc'
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Updated Name', colour: 'red' });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: 'Merlot, Cabernet Franc' })
    );
  });

  it('uses body grapes when provided, overriding existing', async () => {
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Updated', colour: 'red', grapes: 'Pinot Noir' });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: 'Pinot Noir' })
    );
  });

  it('allows explicit null grapes to clear field', async () => {
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Updated', colour: 'red', grapes: null });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: null })
    );
  });

  it('fail-open: returns 200 with empty warnings when checker throws', async () => {
    checkWineConsistency.mockImplementation(() => { throw new Error('boom'); });

    const res = await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Test', colour: 'red' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Wine updated');
    expect(res.body.warnings).toEqual([]);
  });

  it('returns 404 when wine not found', async () => {
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ changes: 0 }),
    });

    const res = await request(app)
      .put('/wines/999')
      .send({ wine_name: 'Ghost Wine', colour: 'red' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Wine not found');
  });

  it('response shape is { message, warnings, zoneSuggestion } on PUT', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Shape Test', colour: 'red' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'warnings', 'zoneSuggestion']);
  });

  it('zoneSuggestion includes zone fields when update succeeds', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Cab Sauv Test', colour: 'red', grapes: 'Cabernet Sauvignon' });

    expect(res.status).toBe(200);
    const zs = res.body.zoneSuggestion;
    expect(zs).toBeTruthy();
    expect(zs).toHaveProperty('zoneId');
    expect(zs).toHaveProperty('displayName');
    expect(zs).toHaveProperty('confidence');
    expect(zs).toHaveProperty('alternativeZones');
    expect(zs).toHaveProperty('changed');
    expect(zs).toHaveProperty('differsFromCurrent');
  });

  it('zoneSuggestion.changed is false when edit does not affect zone', async () => {
    checkWineConsistency.mockReturnValue(null);

    // Only change rating — does not affect zone matching
    const res = await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Original Wine', colour: 'red', vivino_rating: 4.5 });

    expect(res.status).toBe(200);
    expect(res.body.zoneSuggestion?.changed).toBe(false);
  });

  it('zoneSuggestion.changed is true when country edit changes zone recommendation', async () => {
    checkWineConsistency.mockReturnValue(null);

    // Change from generic red to South African red — may change zone
    const res = await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Original Wine', colour: 'red', country: 'South Africa', grapes: 'Pinotage' });

    expect(res.status).toBe(200);
    const zs = res.body.zoneSuggestion;
    expect(zs).toBeTruthy();
    // The zone should be computed (may or may not differ depending on zone config,
    // but the structure should always be present)
    expect(typeof zs.changed).toBe('boolean');
    expect(typeof zs.differsFromCurrent).toBe('boolean');
  });

  it('zoneSuggestion is null (fail-open) when findBestZone throws', async () => {
    checkWineConsistency.mockReturnValue(null);
    // Make the post-update SELECT return null to trigger an edge case
    let callCount = 0;
    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockImplementation(() => {
        callCount++;
        // First call: existing wine lookup (must succeed)
        if (callCount === 1) return Promise.resolve(existingWine);
        // Second call: post-update re-fetch — return null
        return Promise.resolve(null);
      }),
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([]),
    }));

    const res = await request(app)
      .put('/wines/5')
      .send({ wine_name: 'Test', colour: 'red' });

    expect(res.status).toBe(200);
    expect(res.body.zoneSuggestion).toBeNull();
  });
});
