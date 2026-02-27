/**
 * @fileoverview Tests for the arrival → cellar conversion pipeline.
 * Focuses on: wineData field mapping, post-conversion side effects
 * (enrichment queued, cache invalidated), placement graceful failure,
 * transactional invariant enforcement, and batch-arrive behaviour.
 *
 * The conversion logic lives in src/routes/buyingGuideItems.js.
 * These tests complement the broader route tests in
 * tests/unit/routes/buyingGuideItems.test.js with deeper coverage of
 * side-effect correctness and field-mapping contracts.
 * @module tests/unit/services/recipe/buyingGuideArrival
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('../../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    transaction: vi.fn(async (fn) => {
      const mockClient = { query: vi.fn(() => ({ rows: [], rowCount: 0 })) };
      return fn(mockClient);
    })
  },
  wrapClient: vi.fn((client) => ({
    prepare: vi.fn(() => ({
      get:  vi.fn(() => Promise.resolve(null)),
      all:  vi.fn(() => Promise.resolve([])),
      run:  vi.fn(() => Promise.resolve({ changes: 1 }))
    }))
  }))
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }
}));

vi.mock('../../../../src/services/recipe/styleInference.js', () => ({
  inferStyleForItem: vi.fn(() => ({
    styleId: 'red_full', confidence: 'high', label: 'Full Red', matchedOn: ['colour']
  }))
}));

vi.mock('../../../../src/services/acquisitionWorkflow.js', () => ({
  suggestPlacement: vi.fn(),
  saveAcquiredWine: vi.fn(),
  enrichWineData: vi.fn(() => Promise.resolve())
}));

vi.mock('../../../../src/services/recipe/buyingGuide.js', () => ({
  generateBuyingGuide: vi.fn(() => Promise.resolve({ gaps: [], coveragePct: 100 })),
  invalidateBuyingGuideCache: vi.fn(() => Promise.resolve())
}));

vi.mock('../../../../src/services/recipe/buyingGuideCart.js', () => ({
  getItem:            vi.fn(),
  updateItemStatus:   vi.fn(),
  batchUpdateStatus:  vi.fn(() => Promise.resolve({ updated: 0, skipped: 0 })),
  listItems:          vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  createItem:         vi.fn(),
  updateItem:         vi.fn(),
  deleteItem:         vi.fn(),
  getCartSummary:     vi.fn(() => Promise.resolve({ counts: {}, totals: {} })),
  getActiveItems:     vi.fn(() => Promise.resolve([]))
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import db, { wrapClient } from '../../../../src/db/index.js';
import {
  suggestPlacement,
  saveAcquiredWine,
  enrichWineData
} from '../../../../src/services/acquisitionWorkflow.js';
import { invalidateBuyingGuideCache } from '../../../../src/services/recipe/buyingGuide.js';
import * as cart from '../../../../src/services/recipe/buyingGuideCart.js';
import logger from '../../../../src/utils/logger.js';
import router from '../../../../src/routes/buyingGuideItems.js';

// ── App factory ───────────────────────────────────────────────────────────────

const CELLAR_ID = 'cellar-arrival-tests';

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

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** A cart item ready to be marked arrived. */
function makeOrderedItem(overrides = {}) {
  return {
    id: 1,
    cellar_id: CELLAR_ID,
    wine_name: 'Stellenbosch Pinotage',
    producer: 'Beyerskloof',
    vintage: 2020,
    colour: 'red',
    style_id: 'red_full',
    grapes: 'Pinotage',
    region: 'Stellenbosch',
    country: 'South Africa',
    quantity: 3,
    status: 'ordered',
    converted_wine_id: null,
    price: 320,
    currency: 'ZAR',
    source_gap_style: 'red_full',
    ...overrides
  };
}

/** A cart item already marked arrived, ready for cellar conversion. */
function makeArrivedItem(overrides = {}) {
  return makeOrderedItem({ status: 'arrived', ...overrides });
}

/** Mock db.prepare().get() to return slotCount then item */
function mockDbForArrived(item, availableSlots = 10) {
  db.prepare.mockImplementation((sql) => ({
    get: vi.fn(() => {
      if (sql.includes('COUNT')) return Promise.resolve({ count: String(availableSlots) });
      if (sql.includes('buying_guide_items')) return Promise.resolve(item);
      return Promise.resolve(null);
    }),
    all: vi.fn(() => Promise.resolve([])),
    run: vi.fn(() => Promise.resolve({ changes: 1 }))
  }));
}

// ── POST /:id/arrive — wineObj field mapping ──────────────────────────────────

describe('POST /:id/arrive — wineObj sent to suggestPlacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes colour, style, grapes, region, country from item to suggestPlacement', async () => {
    const item = makeOrderedItem();
    cart.getItem.mockResolvedValue(item);
    cart.updateItemStatus.mockResolvedValue({ item: { ...item, status: 'arrived' }, error: null });
    suggestPlacement.mockResolvedValue({
      zone: { zoneId: 'z1', displayName: 'Red Zone', confidence: 0.9, alternatives: [] },
      suggestedSlot: 'R4C2'
    });

    await request(createApp()).post('/1/arrive');

    expect(suggestPlacement).toHaveBeenCalledOnce();
    const [wineObj, cellarId] = suggestPlacement.mock.calls[0];
    expect(wineObj.colour).toBe('red');
    expect(wineObj.style).toBe('red_full');
    expect(wineObj.grapes).toBe('Pinotage');
    expect(wineObj.region).toBe('Stellenbosch');
    expect(wineObj.country).toBe('South Africa');
    expect(cellarId).toBe(CELLAR_ID);
  });

  it('passes null for missing optional fields in wineObj', async () => {
    const item = makeOrderedItem({ colour: null, grapes: null, region: null, country: null });
    cart.getItem.mockResolvedValue(item);
    cart.updateItemStatus.mockResolvedValue({ item: { ...item, status: 'arrived' }, error: null });
    suggestPlacement.mockResolvedValue(null);

    await request(createApp()).post('/1/arrive');

    const [wineObj] = suggestPlacement.mock.calls[0];
    expect(wineObj.colour).toBeNull();
    expect(wineObj.grapes).toBeNull();
    expect(wineObj.region).toBeNull();
    expect(wineObj.country).toBeNull();
  });

  it('returns placement zoneId, zoneName, suggestedSlot in response', async () => {
    const item = makeOrderedItem();
    cart.getItem.mockResolvedValue(item);
    cart.updateItemStatus.mockResolvedValue({ item: { ...item, status: 'arrived' }, error: null });
    suggestPlacement.mockResolvedValue({
      zone: { zoneId: 'zone-red-1', displayName: 'Reds A', confidence: 0.85, alternatives: ['R5C1'] },
      suggestedSlot: 'R4C3'
    });

    const res = await request(createApp()).post('/1/arrive');

    expect(res.status).toBe(200);
    expect(res.body.data.placement).toMatchObject({
      zoneId: 'zone-red-1',
      zoneName: 'Reds A',
      suggestedSlot: 'R4C3',
      confidence: 0.85
    });
  });

  it('continues gracefully when suggestPlacement throws — placement is null', async () => {
    const item = makeOrderedItem();
    cart.getItem.mockResolvedValue(item);
    cart.updateItemStatus.mockResolvedValue({ item: { ...item, status: 'arrived' }, error: null });
    suggestPlacement.mockRejectedValue(new Error('Zone lookup failed'));

    const res = await request(createApp()).post('/1/arrive');

    expect(res.status).toBe(200);
    expect(res.body.data.placement).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('placement suggestion failed'),
      expect.any(String)
    );
  });

  it('returns 404 when item not found', async () => {
    cart.getItem.mockResolvedValue(null);
    const res = await request(createApp()).post('/1/arrive');
    expect(res.status).toBe(404);
  });

  it('returns 400 when state machine rejects the transition', async () => {
    const item = makeArrivedItem(); // already arrived
    cart.getItem.mockResolvedValue(item);
    cart.updateItemStatus.mockResolvedValue({ item: null, error: 'Invalid status transition' });

    const res = await request(createApp()).post('/1/arrive');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid status transition');
  });
});

// ── POST /:id/to-cellar — wineData field mapping ──────────────────────────────

describe('POST /:id/to-cellar — wineData shape passed to saveAcquiredWine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSuccessfulConversion(item, qty = item.quantity, slots = null) {
    cart.getItem.mockResolvedValue(item);
    mockDbForArrived(item, qty + 5); // more than enough slots

    const assignedSlots = slots || Array.from({ length: qty }, (_, i) => `R${i + 1}C1`);
    saveAcquiredWine.mockResolvedValue({
      wineId: 100,
      slots: assignedSlots,
      warnings: [],
      message: 'Wine saved'
    });

    // wrapClient mock — for transaction-scoped queries
    wrapClient.mockReturnValue({
      prepare: vi.fn(() => ({
        get:  vi.fn(() => Promise.resolve({ count: String(qty + 5) })),
        all:  vi.fn(() => Promise.resolve([])),
        run:  vi.fn(() => Promise.resolve({ changes: 1 }))
      }))
    });
  }

  it('includes producer field in wineData sent to saveAcquiredWine', async () => {
    const item = makeArrivedItem({ producer: 'Beyerskloof', quantity: 1 });
    mockSuccessfulConversion(item, 1, ['R3C1']);

    await request(createApp()).post('/1/to-cellar').send({});

    expect(saveAcquiredWine).toHaveBeenCalledOnce();
    const [wineData] = saveAcquiredWine.mock.calls[0];
    expect(wineData.producer).toBe('Beyerskloof');
  });

  it('passes null producer when item has no producer', async () => {
    const item = makeArrivedItem({ producer: null, quantity: 1 });
    mockSuccessfulConversion(item, 1, ['R3C1']);

    await request(createApp()).post('/1/to-cellar').send({});

    const [wineData] = saveAcquiredWine.mock.calls[0];
    expect(wineData.producer).toBeNull();
  });

  it('passes correct wine_name, vintage, colour, style, grapes, region, country', async () => {
    const item = makeArrivedItem({ quantity: 1 });
    mockSuccessfulConversion(item, 1, ['R3C1']);

    await request(createApp()).post('/1/to-cellar').send({});

    const [wineData] = saveAcquiredWine.mock.calls[0];
    expect(wineData.wine_name).toBe('Stellenbosch Pinotage');
    expect(wineData.vintage).toBe(2020);
    expect(wineData.colour).toBe('red');
    expect(wineData.style).toBe('red_full');
    expect(wineData.grapes).toBe('Pinotage');
    expect(wineData.region).toBe('Stellenbosch');
    expect(wineData.country).toBe('South Africa');
  });

  it('passes skipEnrichment=true and the transaction client to saveAcquiredWine', async () => {
    const item = makeArrivedItem({ quantity: 1 });
    mockSuccessfulConversion(item, 1, ['R3C1']);

    await request(createApp()).post('/1/to-cellar').send({});

    const [, options] = saveAcquiredWine.mock.calls[0];
    expect(options.skipEnrichment).toBe(true);
    expect(options.cellarId).toBe(CELLAR_ID);
    expect(options.quantity).toBe(1);
    expect(options.transaction).toBeDefined(); // the wrapClient-wrapped txDb
  });

  it('defaults colour to "white" when item has no colour', async () => {
    const item = makeArrivedItem({ colour: null, quantity: 1 });
    mockSuccessfulConversion(item, 1, ['R3C1']);

    await request(createApp()).post('/1/to-cellar').send({});

    const [wineData] = saveAcquiredWine.mock.calls[0];
    expect(wineData.colour).toBe('white');
  });
});

// ── POST /:id/to-cellar — post-transaction side effects ───────────────────────

describe('POST /:id/to-cellar — post-conversion side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSuccessfulConversionSideEffect(item) {
    cart.getItem.mockResolvedValue(item);
    mockDbForArrived(item, 10);
    saveAcquiredWine.mockResolvedValue({
      wineId: 200,
      slots: ['R2C1', 'R2C2'],
      warnings: [],
      message: 'Wine saved'
    });
    wrapClient.mockReturnValue({
      prepare: vi.fn(() => ({
        get:  vi.fn(() => Promise.resolve({ count: '10' })),
        all:  vi.fn(() => Promise.resolve([])),
        run:  vi.fn(() => Promise.resolve({ changes: 1 }))
      }))
    });
  }

  it('calls invalidateBuyingGuideCache after successful conversion', async () => {
    const item = makeArrivedItem({ quantity: 2 });
    mockSuccessfulConversionSideEffect(item);

    await request(createApp()).post('/1/to-cellar').send({});

    expect(invalidateBuyingGuideCache).toHaveBeenCalledWith(CELLAR_ID);
  });

  it('calls enrichWineData with the new wineId after conversion', async () => {
    const item = makeArrivedItem({ quantity: 2 });
    mockSuccessfulConversionSideEffect(item);

    await request(createApp()).post('/1/to-cellar').send({});

    expect(enrichWineData).toHaveBeenCalledOnce();
    const [enrichArg] = enrichWineData.mock.calls[0];
    expect(enrichArg.id).toBe(200);
    expect(enrichArg.wine_name).toBe('Stellenbosch Pinotage');
  });

  it('does NOT call enrichWineData when conversion fails (409 already converted)', async () => {
    const item = makeArrivedItem({ converted_wine_id: 99, quantity: 1 });
    cart.getItem.mockResolvedValue(item);

    await request(createApp()).post('/1/to-cellar');

    expect(enrichWineData).not.toHaveBeenCalled();
  });

  it('does NOT call enrichWineData when status is not arrived', async () => {
    const item = makeOrderedItem({ quantity: 1 }); // still ordered
    cart.getItem.mockResolvedValue(item);

    await request(createApp()).post('/1/to-cellar');

    expect(enrichWineData).not.toHaveBeenCalled();
  });

  it('returns the wineId and converted bottle count in response', async () => {
    const item = makeArrivedItem({ quantity: 2 });
    mockSuccessfulConversionSideEffect(item);

    const res = await request(createApp()).post('/1/to-cellar').send({});

    expect(res.status).toBe(200);
    expect(res.body.data.wineId).toBe(200);
    expect(res.body.data.converted).toBe(2);
    expect(res.body.data.partial).toBe(false);
  });
});

// ── POST /:id/to-cellar — transaction invariant check ────────────────────────

describe('POST /:id/to-cellar — invariant: slots assigned must match qty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transaction throws when saveAcquiredWine returns fewer slots than requested', async () => {
    const item = makeArrivedItem({ quantity: 3 });
    cart.getItem.mockResolvedValue(item);
    mockDbForArrived(item, 10);

    // saveAcquiredWine returns only 1 slot instead of 3 — invariant violation
    saveAcquiredWine.mockResolvedValue({
      wineId: 300,
      slots: ['R1C1'],   // only 1, but qty=3
      warnings: [],
      message: 'Wine saved'
    });

    wrapClient.mockReturnValue({
      prepare: vi.fn(() => ({
        get:  vi.fn(() => Promise.resolve({ count: '10' })),
        all:  vi.fn(() => Promise.resolve([])),
        run:  vi.fn(() => Promise.resolve({ changes: 1 }))
      }))
    });

    // db.transaction should propagate the invariant error
    db.transaction.mockImplementation(async (fn) => {
      const mockClient = { query: vi.fn() };
      return fn(mockClient); // fn will throw due to invariant check
    });

    const res = await request(createApp()).post('/1/to-cellar').send({});
    // Should be 500 (transaction error propagated)
    expect(res.status).toBe(500);
  });
});

// ── POST /:id/to-cellar — partial conversion ──────────────────────────────────

describe('POST /:id/to-cellar — partial conversion flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns requiresConfirmation when available < quantity and not confirmed', async () => {
    const item = makeArrivedItem({ quantity: 4 });
    cart.getItem.mockResolvedValue(item);

    db.prepare.mockImplementation(() => ({
      get:  vi.fn(() => Promise.resolve({ count: '1' })), // only 1 slot
      all:  vi.fn(() => Promise.resolve([])),
      run:  vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    const res = await request(createApp()).post('/1/to-cellar').send({});

    expect(res.status).toBe(200);
    expect(res.body.data.requiresConfirmation).toBe(true);
    expect(res.body.data.available).toBe(1);
    expect(res.body.data.total).toBe(4);
    expect(saveAcquiredWine).not.toHaveBeenCalled();
  });

  it('proceeds with partial qty when confirmed=true + convertQuantity provided', async () => {
    const item = makeArrivedItem({ quantity: 4 });
    cart.getItem.mockResolvedValue(item);
    mockDbForArrived(item, 1); // only 1 slot available

    saveAcquiredWine.mockResolvedValue({
      wineId: 400,
      slots: ['R1C1'],
      warnings: [],
      message: 'Wine saved'
    });

    wrapClient.mockReturnValue({
      prepare: vi.fn(() => ({
        get:  vi.fn(() => Promise.resolve({ count: '1' })),
        all:  vi.fn(() => Promise.resolve([])),
        run:  vi.fn(() => Promise.resolve({ changes: 1 }))
      }))
    });

    const res = await request(createApp())
      .post('/1/to-cellar')
      .send({ confirmed: true, convertQuantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.converted).toBe(1);
    expect(res.body.data.remaining).toBe(3);
    expect(res.body.data.partial).toBe(true);
  });

  it('returns 400 when no slots available at all', async () => {
    const item = makeArrivedItem({ quantity: 2 });
    cart.getItem.mockResolvedValue(item);

    db.prepare.mockImplementation(() => ({
      get: vi.fn(() => Promise.resolve({ count: '0' })),
      all: vi.fn(() => Promise.resolve([])),
      run: vi.fn(() => Promise.resolve({ changes: 1 }))
    }));

    const res = await request(createApp())
      .post('/1/to-cellar')
      .send({ confirmed: true, convertQuantity: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No empty slots');
  });
});

// ── POST /batch-arrive ────────────────────────────────────────────────────────

describe('POST /batch-arrive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls batchUpdateStatus with cellarId and ids and returns updated/skipped counts', async () => {
    cart.batchUpdateStatus.mockResolvedValue({ updated: 2, skipped: 0 });

    const res = await request(createApp())
      .post('/batch-arrive')
      .send({ ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(cart.batchUpdateStatus).toHaveBeenCalledWith(CELLAR_ID, [1, 2], 'arrived');
    expect(res.body.data.updated).toBe(2);
    expect(res.body.data.skipped).toBe(0);
  });

  it('returns skipped count when some items cannot transition', async () => {
    cart.batchUpdateStatus.mockResolvedValue({ updated: 1, skipped: 1 });

    const res = await request(createApp())
      .post('/batch-arrive')
      .send({ ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.skipped).toBe(1);
    expect(res.body.message).toContain('1 item(s)');
  });

  it('returns 400 for empty ids array', async () => {
    const res = await request(createApp())
      .post('/batch-arrive')
      .send({ ids: [] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when ids field missing from body', async () => {
    const res = await request(createApp())
      .post('/batch-arrive')
      .send({});

    expect(res.status).toBe(400);
  });
});
