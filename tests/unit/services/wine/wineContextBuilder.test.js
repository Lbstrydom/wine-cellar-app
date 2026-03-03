/**
 * @fileoverview Unit tests for wineContextBuilder.
 * Covers: base context assembly, defensive JSON parsing, single-wine context,
 * batch variant (pairings distribution, awards distribution), N+1 avoidance,
 * formatWineContextForPrompt output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() },
  awardsDb: { prepare: vi.fn() }
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import {
  buildWineContext,
  buildWineContextBatch,
  formatWineContextForPrompt
} from '../../../../src/services/wine/wineContextBuilder.js';

import db, { awardsDb } from '../../../../src/db/index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CELLAR_ID = 'cellar-abc';

const BASE_WINE = {
  id: 10,
  wine_name: 'Kanonkop Paul Sauer',
  vintage: 2019,
  colour: 'red',
  style: 'Stellenbosch Blend',
  region: 'Stellenbosch',
  country: 'South Africa',
  producer: 'Kanonkop',
  grape_variety: 'Cabernet Sauvignon',
  style_summary: 'Bold, fruit-forward Stellenbosch blend',
  producer_description: 'Iconic Stellenbosch estate',
  tasting_notes: 'Blackcurrant and cedar',
  tasting_notes_structured: null,
  extracted_awards: null
};

/** Return a mock prepare().all() chain */
function mockAll(rows) {
  const allFn = vi.fn().mockResolvedValue(rows);
  return { all: allFn };
}

/** Return a mock prepare().all() chain that throws */
function mockAllThrows(msg = 'DB error') {
  const allFn = vi.fn().mockRejectedValue(new Error(msg));
  return { all: allFn };
}

// ─── buildWineContext ────────────────────────────────────────────────────────

describe('buildWineContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns base context fields without DB calls when no options set', async () => {
    const ctx = await buildWineContext(BASE_WINE, CELLAR_ID);

    expect(ctx.id).toBe(10);
    expect(ctx.wine_name).toBe('Kanonkop Paul Sauer');
    expect(ctx.vintage).toBe(2019);
    expect(ctx.colour).toBe('red');
    expect(ctx.style_summary).toBe('Bold, fruit-forward Stellenbosch blend');
    expect(ctx.food_pairings).toEqual([]);
    expect(ctx.awards).toEqual([]);
    expect(ctx.tasting_notes_structured).toBeNull();
    expect(db.prepare).not.toHaveBeenCalled();
    expect(awardsDb.prepare).not.toHaveBeenCalled();
  });

  it('fetches food pairings when includePairings=true', async () => {
    const rows = [
      { pairing: 'Lamb rack', source: 'search', user_rating: 5 },
      { pairing: 'Beef brisket', source: 'manual', user_rating: null }
    ];
    db.prepare.mockReturnValue(mockAll(rows));

    const ctx = await buildWineContext(BASE_WINE, CELLAR_ID, { includePairings: true });

    expect(db.prepare).toHaveBeenCalledOnce();
    expect(ctx.food_pairings).toHaveLength(2);
    expect(ctx.food_pairings[0].pairing).toBe('Lamb rack');
    expect(awardsDb.prepare).not.toHaveBeenCalled();
  });

  it('does not throw when pairings fetch fails — returns empty array', async () => {
    db.prepare.mockReturnValue(mockAllThrows('connection refused'));

    const ctx = await buildWineContext(BASE_WINE, CELLAR_ID, { includePairings: true });

    expect(ctx.food_pairings).toEqual([]);
  });

  it('parses tasting_notes_structured JSON string when includeTastingNotes=true', async () => {
    const structured = { nose: ['blackcurrant', 'cedar'], palate: ['tannic', 'long'] };
    const wine = { ...BASE_WINE, tasting_notes_structured: JSON.stringify(structured) };

    const ctx = await buildWineContext(wine, CELLAR_ID, { includeTastingNotes: true });

    expect(ctx.tasting_notes_structured).toEqual(structured);
  });

  it('returns null tasting_notes_structured for invalid JSON — does not throw', async () => {
    const wine = { ...BASE_WINE, tasting_notes_structured: 'not-valid-json{' };

    const ctx = await buildWineContext(wine, CELLAR_ID, { includeTastingNotes: true });

    expect(ctx.tasting_notes_structured).toBeNull();
  });

  it('parses extracted_awards JSONB from wine record', async () => {
    const awards = [{ competition: 'Michelangelo', year: 2023, award: 'Gold' }];
    const wine = { ...BASE_WINE, extracted_awards: JSON.stringify(awards) };

    const ctx = await buildWineContext(wine, CELLAR_ID);

    expect(ctx.extracted_awards).toEqual(awards);
  });

  it('handles extracted_awards already as object (Postgres JSONB auto-parse)', async () => {
    const awards = [{ competition: 'Veritas', year: 2022, award: 'Double Gold' }];
    const wine = { ...BASE_WINE, extracted_awards: awards }; // Already an object

    const ctx = await buildWineContext(wine, CELLAR_ID);

    expect(ctx.extracted_awards).toEqual(awards);
  });

  it('fetches competition awards when includeAwards=true', async () => {
    const awardRows = [{ competition: 'Michelangelo', year: 2022, award: 'Double Gold' }];
    awardsDb.prepare.mockReturnValue(mockAll(awardRows));

    const ctx = await buildWineContext(BASE_WINE, CELLAR_ID, { includeAwards: true });

    expect(awardsDb.prepare).toHaveBeenCalledOnce();
    expect(ctx.awards).toHaveLength(1);
    expect(ctx.awards[0].competition).toBe('Michelangelo');
  });

  it('silently skips awards when awardsDb throws', async () => {
    awardsDb.prepare.mockReturnValue(mockAllThrows('table not found'));

    const ctx = await buildWineContext(BASE_WINE, CELLAR_ID, { includeAwards: true });

    expect(ctx.awards).toEqual([]);
  });
});

// ─── buildWineContextBatch ───────────────────────────────────────────────────

describe('buildWineContextBatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty Map for empty wines array', async () => {
    const result = await buildWineContextBatch([], CELLAR_ID);
    expect(result.size).toBe(0);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('builds base contexts for all wines without DB calls when no options', async () => {
    const wines = [BASE_WINE, { ...BASE_WINE, id: 11, wine_name: 'Test Red 2' }];

    const result = await buildWineContextBatch(wines, CELLAR_ID);

    expect(result.size).toBe(2);
    expect(result.get(10)?.wine_name).toBe('Kanonkop Paul Sauer');
    expect(result.get(11)?.wine_name).toBe('Test Red 2');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('distributes batch pairings to correct wines — single DB query', async () => {
    const wines = [BASE_WINE, { ...BASE_WINE, id: 11, wine_name: 'Wine B' }];
    const pairingRows = [
      { wine_id: 10, pairing: 'Lamb', source: 'search', user_rating: null },
      { wine_id: 11, pairing: 'Beef', source: 'manual', user_rating: 4 },
      { wine_id: 10, pairing: 'Duck', source: 'search', user_rating: 5 }
    ];
    db.prepare.mockReturnValue(mockAll(pairingRows));

    const result = await buildWineContextBatch(wines, CELLAR_ID, { includePairings: true });

    // Only one DB query issued (no N+1)
    expect(db.prepare).toHaveBeenCalledOnce();

    const ctx10 = result.get(10);
    const ctx11 = result.get(11);
    expect(ctx10.food_pairings).toHaveLength(2);
    expect(ctx10.food_pairings[0].pairing).toBe('Lamb');
    expect(ctx11.food_pairings).toHaveLength(1);
    expect(ctx11.food_pairings[0].pairing).toBe('Beef');
  });

  it('includes cellarId as last positional param in batch pairings query', async () => {
    db.prepare.mockReturnValue(mockAll([]));
    const wines = [BASE_WINE];

    await buildWineContextBatch(wines, CELLAR_ID, { includePairings: true });

    const { all } = db.prepare.mock.results[0].value;
    const callArgs = all.mock.calls[0];
    // Args: wineId(s)..., cellarId
    expect(callArgs[callArgs.length - 1]).toBe(CELLAR_ID);
  });

  it('distributes batch awards to correct wines — single awardsDb query', async () => {
    const wines = [BASE_WINE, { ...BASE_WINE, id: 11 }];
    const awardRows = [
      { matched_wine_id: 10, competition: 'Veritas', year: 2022, award: 'Gold' },
      { matched_wine_id: 11, competition: 'CMB', year: 2021, award: 'Silver' }
    ];
    awardsDb.prepare.mockReturnValue(mockAll(awardRows));

    const result = await buildWineContextBatch(wines, CELLAR_ID, { includeAwards: true });

    expect(awardsDb.prepare).toHaveBeenCalledOnce();
    expect(result.get(10).awards[0].competition).toBe('Veritas');
    expect(result.get(11).awards[0].competition).toBe('CMB');
  });

  it('continues gracefully when batch pairings fetch fails', async () => {
    db.prepare.mockReturnValue(mockAllThrows());
    const wines = [BASE_WINE];

    const result = await buildWineContextBatch(wines, CELLAR_ID, { includePairings: true });

    expect(result.get(10).food_pairings).toEqual([]);
  });

  it('parses tasting_notes_structured in batch mode', async () => {
    const structured = { nose: ['black cherry'] };
    const wines = [{ ...BASE_WINE, tasting_notes_structured: JSON.stringify(structured) }];

    const result = await buildWineContextBatch(wines, CELLAR_ID, { includeTastingNotes: true });

    expect(result.get(10).tasting_notes_structured).toEqual(structured);
  });
});

// ─── formatWineContextForPrompt ──────────────────────────────────────────────

describe('formatWineContextForPrompt', () => {
  it('includes wine name, vintage, colour, style', () => {
    const ctx = { ...BASE_WINE, food_pairings: [], awards: [] };
    const out = formatWineContextForPrompt(ctx);
    expect(out).toContain('"Kanonkop Paul Sauer"');
    expect(out).toContain('2019');
    expect(out).toContain('red');
  });

  it('includes region and country when present', () => {
    const ctx = { ...BASE_WINE, food_pairings: [], awards: [] };
    const out = formatWineContextForPrompt(ctx);
    expect(out).toContain('Stellenbosch');
    expect(out).toContain('South Africa');
  });

  it('includes style_summary', () => {
    const ctx = { ...BASE_WINE, food_pairings: [], awards: [] };
    const out = formatWineContextForPrompt(ctx);
    expect(out).toContain('Bold, fruit-forward Stellenbosch blend');
  });

  it('appends Pairs with: section when food_pairings present', () => {
    const ctx = {
      ...BASE_WINE,
      food_pairings: [
        { pairing: 'Lamb rack', user_rating: 5 },
        { pairing: 'Beef', user_rating: null }
      ],
      awards: []
    };
    const out = formatWineContextForPrompt(ctx);
    expect(out).toContain('Pairs with:');
    expect(out).toContain('Lamb rack (★★★★★)');
    expect(out).toContain('Beef');
  });

  it('skips Pairs with: when food_pairings is empty', () => {
    const ctx = { ...BASE_WINE, food_pairings: [], awards: [] };
    const out = formatWineContextForPrompt(ctx);
    expect(out).not.toContain('Pairs with:');
  });

  it('limits food pairings to 5 in prompt output', () => {
    const ctx = {
      ...BASE_WINE,
      food_pairings: Array.from({ length: 8 }, (_, i) => ({ pairing: `Dish ${i}`, user_rating: null })),
      awards: []
    };
    const out = formatWineContextForPrompt(ctx);
    // Should only have Dish 0 through Dish 4 (5 items)
    expect(out).toContain('Dish 4');
    expect(out).not.toContain('Dish 5');
  });

  it('omits region/country pair section when not present', () => {
    // Use a wine without region, country, or style_summary to isolate the region segment
    const ctx = {
      id: 99, wine_name: 'Unnamed Wine', vintage: 2020, colour: 'red', style: null,
      region: null, country: null,
      style_summary: null, producer_description: null, tasting_notes: null,
      tasting_notes_structured: null, extracted_awards: null,
      food_pairings: [], awards: []
    };
    const out = formatWineContextForPrompt(ctx);
    // No region block separator should trail the identity segment
    expect(out).toBe('"Unnamed Wine" 2020 red');
  });
});
