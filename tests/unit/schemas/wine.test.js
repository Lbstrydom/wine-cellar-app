/**
 * @fileoverview Schema validation tests for wine schemas.
 * Tests the string→number transform boundary where HTML form inputs meet Zod validation.
 * Uses vitest globals (do NOT import from 'vitest').
 */

import {
  createWineSchema, updateWineSchema, personalRatingSchema,
  searchQuerySchema, globalSearchSchema, duplicateCheckSchema,
  servingTempQuerySchema, wineIdSchema, WINE_COLOURS
} from '../../../src/schemas/wine.js';
import { validWinePayload, expectSchemaPass, expectSchemaFail } from '../helpers/schemaTestUtils.js';

// ---------- createWineSchema ----------

describe('createWineSchema', () => {

  describe('wine_name (required string)', () => {
    it('accepts valid wine name', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload());
      expect(result.wine_name).toBe('Kanonkop Paul Sauer');
    });

    it('rejects empty string', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ wine_name: '' }), 'wine_name');
    });

    it('rejects name over 300 characters', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ wine_name: 'x'.repeat(301) }), 'wine_name');
    });
  });

  describe('vintage (string→number transform)', () => {
    it('accepts number 2019', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ vintage: 2019 }));
      expect(result.vintage).toBe(2019);
    });

    it('accepts string "2019" and transforms to number', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ vintage: '2019' }));
      expect(result.vintage).toBe(2019);
      expect(typeof result.vintage).toBe('number');
    });

    it('rejects non-year string', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ vintage: 'nineteen' }), 'vintage');
    });

    it('rejects year below 1900', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ vintage: 1800 }), 'vintage');
    });

    it('rejects year above 2100', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ vintage: 2200 }), 'vintage');
    });

    it('accepts null', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ vintage: null }));
      expect(result.vintage).toBeNull();
    });

    it('accepts undefined (field omitted)', () => {
      const payload = validWinePayload();
      delete payload.vintage;
      const result = expectSchemaPass(createWineSchema, payload);
      expect(result.vintage).toBeUndefined();
    });
  });

  // Bug #1 prevention: drink_from/drink_peak/drink_until must accept strings from HTML inputs
  describe.each(['drink_from', 'drink_peak', 'drink_until'])('%s (string→number transform)', (field) => {
    it('accepts string year and transforms to number', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ [field]: '2025' }));
      expect(result[field]).toBe(2025);
      expect(typeof result[field]).toBe('number');
    });

    it('accepts number year', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ [field]: 2025 }));
      expect(result[field]).toBe(2025);
    });

    it('accepts null', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ [field]: null }));
      expect(result[field]).toBeNull();
    });

    it('rejects non-year string', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ [field]: 'soon' }), field);
    });

    it('rejects year below 1900', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ [field]: 1800 }), field);
    });

    it('rejects year above 2100', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ [field]: 2200 }), field);
    });
  });

  describe('vivino_rating (string→number transform)', () => {
    it('accepts number 4.2', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ vivino_rating: 4.2 }));
      expect(result.vivino_rating).toBe(4.2);
    });

    it('accepts string "4.2" and transforms', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ vivino_rating: '4.2' }));
      expect(result.vivino_rating).toBe(4.2);
      expect(typeof result.vivino_rating).toBe('number');
    });

    it('rejects non-numeric string', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ vivino_rating: 'excellent' }));
    });

    it('rejects value above 5', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ vivino_rating: 5.1 }));
    });
  });

  describe('price_eur (string→number transform)', () => {
    it('accepts string "25.50" and transforms', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ price_eur: '25.50' }));
      expect(result.price_eur).toBe(25.5);
      expect(typeof result.price_eur).toBe('number');
    });

    it('accepts number 0', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ price_eur: 0 }));
      expect(result.price_eur).toBe(0);
    });

    it('rejects negative', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ price_eur: -10 }));
    });
  });

  describe('colour', () => {
    it.each(WINE_COLOURS)('accepts valid colour "%s"', (colour) => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ colour }));
      expect(result.colour).toBe(colour);
    });

    it('rejects invalid colour', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ colour: 'purple' }));
    });

    it('accepts null', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload({ colour: null }));
      expect(result.colour).toBeNull();
    });
  });

  describe('vivino_url', () => {
    it('accepts valid URL', () => {
      expectSchemaPass(createWineSchema, validWinePayload({ vivino_url: 'https://vivino.com/w/123' }));
    });

    it('accepts empty string (cleared field)', () => {
      expectSchemaPass(createWineSchema, validWinePayload({ vivino_url: '' }));
    });

    it('rejects invalid URL', () => {
      expectSchemaFail(createWineSchema, validWinePayload({ vivino_url: 'not-a-url' }));
    });
  });

  describe('external_match (nested object)', () => {
    it('accepts valid external_match', () => {
      const payload = validWinePayload({
        external_match: {
          source: 'vivino',
          external_id: '12345',
          rating: 4.2,
          match_confidence: 0.95
        }
      });
      expectSchemaPass(createWineSchema, payload);
    });

    it('accepts null external_match', () => {
      expectSchemaPass(createWineSchema, validWinePayload({ external_match: null }));
    });

    it('accepts omitted external_match', () => {
      const payload = validWinePayload();
      delete payload.external_match;
      expectSchemaPass(createWineSchema, payload);
    });
  });

  describe('full HTML form payload round-trip', () => {
    it('transforms all string numerics from form input', () => {
      const result = expectSchemaPass(createWineSchema, validWinePayload());
      expect(typeof result.vintage).toBe('number');
      expect(typeof result.price_eur).toBe('number');
      expect(typeof result.drink_from).toBe('number');
      expect(typeof result.drink_peak).toBe('number');
      expect(typeof result.drink_until).toBe('number');
    });

    it('accepts minimal payload (wine_name only)', () => {
      const result = expectSchemaPass(createWineSchema, { wine_name: 'Test Wine' });
      expect(result.wine_name).toBe('Test Wine');
    });
  });
});

// ---------- updateWineSchema ----------

describe('updateWineSchema', () => {
  it('makes wine_name optional', () => {
    const result = expectSchemaPass(updateWineSchema, { colour: 'red' });
    expect(result.wine_name).toBeUndefined();
  });

  it('preserves string→number transforms from createWineSchema', () => {
    const result = expectSchemaPass(updateWineSchema, { vintage: '2020', drink_from: '2025' });
    expect(result.vintage).toBe(2020);
    expect(result.drink_from).toBe(2025);
  });
});

// ---------- wineIdSchema ----------

describe('wineIdSchema', () => {
  it('transforms string "42" to number', () => {
    const result = wineIdSchema.parse({ id: '42' });
    expect(result.id).toBe(42);
  });

  it('rejects non-numeric "abc"', () => {
    expectSchemaFail(wineIdSchema, { id: 'abc' }, 'id');
  });
});

// ---------- personalRatingSchema ----------

describe('personalRatingSchema', () => {
  it('accepts rating 0 (falsy but valid)', () => {
    const result = personalRatingSchema.parse({ rating: 0 });
    expect(result.rating).toBe(0);
  });

  it('accepts rating 5', () => {
    personalRatingSchema.parse({ rating: 5 });
  });

  it('rejects rating above 5', () => {
    expectSchemaFail(personalRatingSchema, { rating: 6 });
  });

  it('accepts null rating', () => {
    const result = personalRatingSchema.parse({ rating: null });
    expect(result.rating).toBeNull();
  });

  it('rejects notes over 2000 chars', () => {
    expectSchemaFail(personalRatingSchema, { notes: 'x'.repeat(2001) });
  });
});

// ---------- searchQuerySchema ----------

describe('searchQuerySchema', () => {
  it('transforms limit string to number', () => {
    const result = searchQuerySchema.parse({ q: 'merlot', limit: '20' });
    expect(result.limit).toBe(20);
  });

  it('rejects limit over 100', () => {
    expectSchemaFail(searchQuerySchema, { q: 'test', limit: '200' });
  });

  it('applies default limit of 10 (as string default, transformed on explicit input)', () => {
    const result = searchQuerySchema.parse({ q: 'test', limit: '10' });
    expect(result.limit).toBe(10);
  });

  it('rejects query under 2 characters', () => {
    expectSchemaFail(searchQuerySchema, { q: 'a' });
  });
});

// ---------- globalSearchSchema ----------

describe('globalSearchSchema', () => {
  it('applies default limit of 5 (as string default, transformed on explicit input)', () => {
    const result = globalSearchSchema.parse({ q: 'test', limit: '5' });
    expect(result.limit).toBe(5);
  });

  it('rejects limit over 50', () => {
    expectSchemaFail(globalSearchSchema, { q: 'test', limit: '100' });
  });
});

// ---------- duplicateCheckSchema ----------

describe('duplicateCheckSchema', () => {
  it('accepts valid payload with string vintage', () => {
    const result = duplicateCheckSchema.parse({
      wine_name: 'Test Wine',
      vintage: '2020',
      country: 'France'
    });
    expect(result.vintage).toBe(2020);
  });

  it('rejects missing wine_name', () => {
    expectSchemaFail(duplicateCheckSchema, { vintage: '2020' }, 'wine_name');
  });

  it('accepts force_refresh boolean', () => {
    const result = duplicateCheckSchema.parse({
      wine_name: 'Test',
      force_refresh: true
    });
    expect(result.force_refresh).toBe(true);
  });
});

// ---------- servingTempQuerySchema ----------

describe('servingTempQuerySchema', () => {
  it('defaults to celsius', () => {
    const result = servingTempQuerySchema.parse({});
    expect(result.unit).toBe('celsius');
  });

  it('accepts fahrenheit', () => {
    const result = servingTempQuerySchema.parse({ unit: 'fahrenheit' });
    expect(result.unit).toBe('fahrenheit');
  });

  it('rejects kelvin', () => {
    expectSchemaFail(servingTempQuerySchema, { unit: 'kelvin' });
  });
});
