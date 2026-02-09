/**
 * @fileoverview Tests for /api/consistency route handlers.
 * Exercises REAL route handlers via supertest through the actual Express middleware chain.
 * Tests real Zod schema validation (validateQuery/validateParams/validateBody),
 * real req.validated fallback logic, and real asyncHandler error wrapping.
 * Services are mocked to isolate route behavior from checker implementation.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

// Mock consistencyChecker — route behavior is under test, not checker logic
vi.mock('../../../src/services/shared/consistencyChecker.js', () => ({
  checkWineConsistency: vi.fn(),
  auditCellar: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import consistencyRouter from '../../../src/routes/consistency.js';
import { checkWineConsistency, auditCellar } from '../../../src/services/shared/consistencyChecker.js';
import db from '../../../src/db/index.js';

/**
 * Create a minimal Express app with the real consistency router.
 * Injects cellarId to simulate requireCellarContext middleware.
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = 42; next(); });
  app.use('/consistency', consistencyRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('GET /consistency/audit (real route)', () => {
  let app;

  beforeAll(() => { app = createApp(); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls auditCellar with cellarId and validated query options', async () => {
    const mockResult = {
      data: [{ wineId: 1, issue: 'colour_mismatch', severity: 'error' }],
      summary: { totalWines: 10, checked: 8, skippedNoGrapes: 2, issuesFound: 1, errors: 1, warnings: 0, infos: 0, unknownGrapeCount: 0 },
      pagination: { limit: 50, offset: 10, total: 1 },
    };
    auditCellar.mockResolvedValue(mockResult);

    const res = await request(app)
      .get('/consistency/audit?limit=50&offset=10&severity=error&includeUnknown=true');

    expect(res.status).toBe(200);
    expect(auditCellar).toHaveBeenCalledWith(42, {
      limit: 50,
      offset: 10,
      severity: 'error',
      includeUnknown: true,
    });
    expect(res.body).toEqual(mockResult);
  });

  it('applies defaults via real Zod schema when no query params provided', async () => {
    auditCellar.mockResolvedValue({ data: [], summary: {}, pagination: {} });

    const res = await request(app)
      .get('/consistency/audit');

    expect(res.status).toBe(200);
    // Validates req.validated?.query fallback — defaults come from schema coercion
    expect(auditCellar).toHaveBeenCalledWith(42, expect.objectContaining({
      limit: 100,
      offset: 0,
      includeUnknown: false,
    }));
  });

  it('coerces string query params to correct types via real middleware', async () => {
    auditCellar.mockResolvedValue({ data: [], summary: {}, pagination: {} });

    await request(app)
      .get('/consistency/audit?limit=25&offset=5&includeUnknown=1');

    expect(auditCellar).toHaveBeenCalledWith(42, expect.objectContaining({
      limit: 25,
      offset: 5,
      includeUnknown: true,
    }));
  });

  it('coerces includeUnknown "0" to false', async () => {
    auditCellar.mockResolvedValue({ data: [], summary: {}, pagination: {} });

    await request(app)
      .get('/consistency/audit?includeUnknown=0');

    expect(auditCellar).toHaveBeenCalledWith(42, expect.objectContaining({
      includeUnknown: false,
    }));
  });

  it('rejects invalid severity with 400 via real validateQuery', async () => {
    const res = await request(app)
      .get('/consistency/audit?severity=critical');

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(auditCellar).not.toHaveBeenCalled();
  });

  it('rejects limit > 500 with 400', async () => {
    const res = await request(app)
      .get('/consistency/audit?limit=501');

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects negative offset with 400', async () => {
    const res = await request(app)
      .get('/consistency/audit?offset=-1');

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns response shape with data, summary, pagination', async () => {
    const mockResult = {
      data: [],
      summary: { totalWines: 0, checked: 0, skippedNoGrapes: 0, issuesFound: 0, errors: 0, warnings: 0, infos: 0, unknownGrapeCount: 0 },
      pagination: { limit: 100, offset: 0, total: 0 },
    };
    auditCellar.mockResolvedValue(mockResult);

    const res = await request(app)
      .get('/consistency/audit');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.summary).toHaveProperty('totalWines', 0);
  });
});

describe('GET /consistency/check/:id (real route)', () => {
  let app;

  beforeAll(() => { app = createApp(); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns finding for wine with consistency issue', async () => {
    const mockWine = { id: 5, wine_name: 'Bad White Shiraz', vintage: 2020, colour: 'white', grapes: 'Shiraz', style: null };
    const mockFinding = { wineId: 5, issue: 'colour_mismatch', severity: 'error', suggestedFix: 'red' };

    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue(mockWine),
    });
    checkWineConsistency.mockReturnValue(mockFinding);

    const res = await request(app)
      .get('/consistency/check/5');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(mockFinding);
    // Verify cellar-scoped query was made
    expect(db.prepare).toHaveBeenCalled();
    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('cellar_id');
  });

  it('returns null data for consistent wine', async () => {
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ id: 2, wine_name: 'Good Red', vintage: 2020, colour: 'red', grapes: 'Merlot', style: null }),
    });
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .get('/consistency/check/2');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('returns 404 when wine not found', async () => {
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue(undefined),
    });

    const res = await request(app)
      .get('/consistency/check/999');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Wine not found');
    expect(checkWineConsistency).not.toHaveBeenCalled();
  });

  it('validates wine ID param — rejects non-numeric via real validateParams', async () => {
    const res = await request(app)
      .get('/consistency/check/abc');

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('passes cellarId and transformed ID to DB query for tenant isolation', async () => {
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ id: 123, wine_name: 'Test', colour: 'red', grapes: 'Merlot' }),
    });
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .get('/consistency/check/123');

    // Verify cellarId (42) and transformed ID (number 123) passed to query
    const getMock = db.prepare.mock.results[0].value.get;
    expect(getMock).toHaveBeenCalledWith(42, 123);
  });
});

describe('POST /consistency/validate (real route)', () => {
  let app;

  beforeAll(() => { app = createApp(); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns finding for mismatched wine body', async () => {
    const mockFinding = { issue: 'colour_mismatch', severity: 'error', suggestedFix: 'red' };
    checkWineConsistency.mockReturnValue(mockFinding);

    const res = await request(app)
      .post('/consistency/validate')
      .send({ wine_name: 'Test Shiraz', colour: 'white', grapes: 'Shiraz' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(mockFinding);
    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({
        wine_name: 'Test Shiraz',
        colour: 'white',
        grapes: 'Shiraz',
      })
    );
  });

  it('returns null data for consistent wine body', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .post('/consistency/validate')
      .send({ wine_name: 'Good Merlot', colour: 'red', grapes: 'Merlot' });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('fail-open: returns null when checker throws (no 500)', async () => {
    checkWineConsistency.mockImplementation(() => { throw new Error('boom'); });

    const res = await request(app)
      .post('/consistency/validate')
      .send({ wine_name: 'Broken', colour: 'red', grapes: 'Merlot' });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('accepts orange colour via real schema', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .post('/consistency/validate')
      .send({ colour: 'orange', grapes: 'Chardonnay' });

    expect(res.status).toBe(200);
  });

  it('accepts grapes as array', async () => {
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .post('/consistency/validate')
      .send({ grapes: ['Merlot', 'Cabernet'] });

    expect(checkWineConsistency).toHaveBeenCalledWith(
      expect.objectContaining({ grapes: ['Merlot', 'Cabernet'] })
    );
  });

  it('accepts null grapes', async () => {
    checkWineConsistency.mockReturnValue(null);

    const res = await request(app)
      .post('/consistency/validate')
      .send({ grapes: null });

    expect(res.status).toBe(200);
  });

  it('rejects invalid colour with 400 via real validateBody', async () => {
    const res = await request(app)
      .post('/consistency/validate')
      .send({ colour: 'purple' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(checkWineConsistency).not.toHaveBeenCalled();
  });

  it('rejects wine_name exceeding 300 chars', async () => {
    const res = await request(app)
      .post('/consistency/validate')
      .send({ wine_name: 'x'.repeat(301) });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('passes only validated body fields to checker (no cellarId or req extras)', async () => {
    checkWineConsistency.mockReturnValue(null);

    await request(app)
      .post('/consistency/validate')
      .send({ wine_name: 'Test', colour: 'red', grapes: 'Merlot' });

    // Handler does `checkWineConsistency(req.body)` — verified by checking
    // the actual argument keys match the schema fields, not req middleware fields.
    const arg = checkWineConsistency.mock.calls[0][0];
    const keys = Object.keys(arg);
    expect(keys).not.toContain('cellarId');
    expect(keys).not.toContain('cellarRole');
    expect(keys).toContain('wine_name');
  });
});
