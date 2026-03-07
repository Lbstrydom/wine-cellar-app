/**
 * @fileoverview Unit tests for storage area Zod schemas.
 * Covers colour_zone field validation on create and update schemas.
 * @module tests/unit/schemas/storageArea.test
 */

import { describe, it, expect } from 'vitest';
import {
  createStorageAreaSchema,
  updateStorageAreaSchema,
  COLOUR_ZONES
} from '../../../src/schemas/storageArea.js';

const BASE_CREATE = {
  name: 'Test Area',
  storage_type: 'cellar',
  temp_zone: 'cellar',
  rows: [{ row_num: 1, col_count: 9 }]
};

// ─── COLOUR_ZONES export ─────────────────────────────────

describe('COLOUR_ZONES constant', () => {
  it('exports the three valid zones', () => {
    expect(COLOUR_ZONES).toEqual(['white', 'red', 'mixed']);
  });
});

// ─── createStorageAreaSchema ─────────────────────────────

describe('createStorageAreaSchema colour_zone', () => {
  it('defaults to mixed when colour_zone is omitted', () => {
    const result = createStorageAreaSchema.parse(BASE_CREATE);
    expect(result.colour_zone).toBe('mixed');
  });

  it.each(['white', 'red', 'mixed'])('accepts valid colour_zone "%s"', (zone) => {
    const result = createStorageAreaSchema.parse({ ...BASE_CREATE, colour_zone: zone });
    expect(result.colour_zone).toBe(zone);
  });

  it('rejects invalid colour_zone', () => {
    const parsed = createStorageAreaSchema.safeParse({ ...BASE_CREATE, colour_zone: 'pink' });
    expect(parsed.success).toBe(false);
  });
});

// ─── updateStorageAreaSchema ─────────────────────────────

describe('updateStorageAreaSchema colour_zone', () => {
  it('accepts update with colour_zone only', () => {
    const result = updateStorageAreaSchema.parse({ colour_zone: 'white' });
    expect(result.colour_zone).toBe('white');
  });

  it('allows colour_zone to be omitted', () => {
    const result = updateStorageAreaSchema.parse({ name: 'Updated' });
    expect(result.colour_zone).toBeUndefined();
  });

  it('rejects invalid colour_zone on update', () => {
    const parsed = updateStorageAreaSchema.safeParse({ colour_zone: 'blue' });
    expect(parsed.success).toBe(false);
  });
});
