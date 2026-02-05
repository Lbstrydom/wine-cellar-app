/**
 * @fileoverview API response shape contract tests.
 * Validates that backend response structures match frontend expectations.
 * Pure unit tests — no server, no DB.
 * Uses vitest globals (do NOT import from 'vitest').
 */

import { z } from 'zod';

// ---------- Response shape contracts ----------

/** GET /api/wines — paginated wine list (wines.js:229-236) */
const paginatedResponse = z.object({
  data: z.array(z.object({
    id: z.number(),
    wine_name: z.string()
  }).passthrough()),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean()
  })
});

/** GET /api/wines/search — raw array (wines.js:93) */
const rawArrayResponse = z.array(z.object({
  id: z.number(),
  wine_name: z.string()
}).passthrough());

/** POST /api/wines — creation response (wines.js:463) */
const createResponse = z.object({
  id: z.number(),
  message: z.string()
});

/** GET /api/wines/global-search — grouped (wines.js:185) */
const globalSearchResponse = z.object({
  wines: z.array(z.any()),
  producers: z.array(z.any()),
  countries: z.array(z.any()),
  styles: z.array(z.any())
});

/** Error response — string format */
const stringErrorResponse = z.object({ error: z.string() });

/** Error response — structured format (validation middleware) */
const structuredErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({
      field: z.string(),
      message: z.string(),
      code: z.string()
    })).optional()
  })
});

// ---------- Fixtures ----------

const fixtures = {
  wineList: {
    data: [
      { id: 1, wine_name: 'Kanonkop Paul Sauer', vintage: 2019, bottle_count: 3, locations: 'R3C1,R3C2,R3C3' }
    ],
    pagination: { total: 42, limit: 50, offset: 0, hasMore: false }
  },
  wineSearch: [
    { id: 1, wine_name: 'Kanonkop Paul Sauer', vintage: 2019, style: 'Bordeaux Blend', colour: 'red' }
  ],
  wineSearchEmpty: [],
  createSuccess: { id: 85, message: 'Wine added' },
  globalSearch: {
    wines: [{ id: 1, wine_name: 'Test' }],
    producers: [{ producer: 'Kanonkop', wine_count: 5 }],
    countries: [{ country: 'South Africa', wine_count: 10 }],
    styles: [{ style: 'Bordeaux Blend', wine_count: 3 }]
  },
  validationError: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: [{ field: 'wine_name', message: 'Wine name is required', code: 'too_small' }]
    }
  },
  genericError: { error: 'Wine not found' }
};

// ---------- Tests ----------

describe('API Response Shape Contracts', () => {

  describe('GET /api/wines (paginated)', () => {
    it('fixture matches paginated response shape', () => {
      paginatedResponse.parse(fixtures.wineList);
    });

    it('data field is an array', () => {
      expect(Array.isArray(fixtures.wineList.data)).toBe(true);
    });

    it('pagination is nested object with hasMore', () => {
      expect(fixtures.wineList.pagination).toHaveProperty('hasMore');
      expect(fixtures.wineList.pagination).toHaveProperty('total');
      expect(fixtures.wineList.pagination).toHaveProperty('limit');
      expect(fixtures.wineList.pagination).toHaveProperty('offset');
    });
  });

  describe('GET /api/wines/search (raw array)', () => {
    it('results fixture matches raw array shape', () => {
      rawArrayResponse.parse(fixtures.wineSearch);
    });

    it('empty results is still an array', () => {
      expect(Array.isArray(fixtures.wineSearchEmpty)).toBe(true);
      rawArrayResponse.parse(fixtures.wineSearchEmpty);
    });

    it('error object does NOT match array shape', () => {
      // Bug #2 prevention: if backend returns error object, .map() would fail
      const errorObj = { error: 'Database error' };
      expect(Array.isArray(errorObj)).toBe(false);
      expect(() => rawArrayResponse.parse(errorObj)).toThrow();
    });
  });

  describe('POST /api/wines (create response)', () => {
    it('fixture matches create response shape', () => {
      createResponse.parse(fixtures.createSuccess);
    });

    it('includes numeric id', () => {
      expect(typeof fixtures.createSuccess.id).toBe('number');
    });
  });

  describe('GET /api/wines/global-search (grouped)', () => {
    it('fixture matches grouped response shape', () => {
      globalSearchResponse.parse(fixtures.globalSearch);
    });

    it('empty search returns empty arrays not null', () => {
      const empty = { wines: [], producers: [], countries: [], styles: [] };
      globalSearchResponse.parse(empty);
    });
  });

  describe('Error responses', () => {
    it('validation error matches structured format', () => {
      structuredErrorResponse.parse(fixtures.validationError);
    });

    it('generic error matches string format', () => {
      stringErrorResponse.parse(fixtures.genericError);
    });

    it('error responses have "error" key at top level', () => {
      expect(fixtures.validationError).toHaveProperty('error');
      expect(fixtures.genericError).toHaveProperty('error');
    });

    it('success responses do NOT have "error" key', () => {
      expect(fixtures.wineList).not.toHaveProperty('error');
      expect(fixtures.createSuccess).not.toHaveProperty('error');
    });
  });

  describe('Frontend safety: array guard pattern', () => {
    it('Array.isArray distinguishes search results from error', () => {
      const successResult = fixtures.wineSearch;
      const errorResult = fixtures.genericError;

      // Frontend pattern: Array.isArray(result) ? result : (result?.data || [])
      const winesFromSuccess = Array.isArray(successResult) ? successResult : [];
      expect(winesFromSuccess.length).toBe(1);

      const winesFromError = Array.isArray(errorResult) ? errorResult : [];
      expect(winesFromError.length).toBe(0);
    });

    it('paginated response requires .data accessor', () => {
      const result = fixtures.wineList;
      // Frontend must access result.data, not call result.map() directly
      expect(Array.isArray(result)).toBe(false);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });
});
