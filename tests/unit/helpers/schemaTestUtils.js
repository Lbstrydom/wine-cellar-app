/**
 * @fileoverview Shared test utilities for schema and contract tests.
 * Uses vitest globals (do NOT import from 'vitest').
 * @module tests/unit/helpers/schemaTestUtils
 */

import { ZodError } from 'zod';

/**
 * Minimal valid wine payload matching HTML form output (strings for numerics).
 * @param {Object} overrides - Fields to override
 * @returns {Object} Valid createWineSchema-compatible payload
 */
export function validWinePayload(overrides = {}) {
  return {
    wine_name: 'Kanonkop Paul Sauer',
    vintage: '2019',
    colour: 'red',
    producer: 'Kanonkop',
    region: 'Stellenbosch',
    country: 'South Africa',
    price_eur: '25.50',
    drink_from: '2024',
    drink_peak: '2028',
    drink_until: '2035',
    ...overrides
  };
}

/**
 * Assert schema.parse(data) succeeds and return the parsed result.
 * @param {import('zod').ZodSchema} schema
 * @param {*} data
 * @returns {*} Parsed result
 */
export function expectSchemaPass(schema, data) {
  const result = schema.parse(data);
  return result;
}

/**
 * Assert schema.parse(data) throws ZodError, optionally on a specific field.
 * @param {import('zod').ZodSchema} schema
 * @param {*} data
 * @param {string} [expectedField] - Dot-joined path to expect in error
 */
export function expectSchemaFail(schema, data, expectedField) {
  try {
    schema.parse(data);
    expect.fail('Expected schema.parse to throw ZodError');
  } catch (e) {
    expect(e).toBeInstanceOf(ZodError);
    if (expectedField) {
      const fields = e.issues.map(i => i.path.join('.'));
      expect(fields).toContain(expectedField);
    }
  }
}
