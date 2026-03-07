/**
 * @fileoverview Unit tests for slot operation Zod schemas.
 * Verifies that area ID fields are correctly defined as optional/nullable
 * and that refine rules still work as expected.
 * @module tests/unit/routes/slot.test
 */

import { describe, it, expect } from 'vitest';
import {
  locationCodeSchema,
  storageAreaIdSchema,
  moveBottleSchema,
  swapBottleSchema,
  directSwapSchema,
  addToSlotSchema,
  drinkBottleSchema
} from '../../../src/schemas/slot.js';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// ─── locationCodeSchema ─────────────────────────────────────────────────────

describe('locationCodeSchema', () => {
  it.each(['R1C1', 'R12C9', 'R5C3', 'F1', 'F12'])('accepts valid code %s', (code) => {
    expect(locationCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(['', 'A1C1', 'R1', 'C1', 'R100C1', 'f1', 'r1c1'])('rejects invalid code %s', (code) => {
    expect(locationCodeSchema.safeParse(code).success).toBe(false);
  });
});

// ─── storageAreaIdSchema ─────────────────────────────────────────────────────

describe('storageAreaIdSchema', () => {
  it('accepts a valid UUID', () => {
    expect(storageAreaIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it('accepts null', () => {
    expect(storageAreaIdSchema.safeParse(null).success).toBe(true);
  });

  it('accepts undefined (optional)', () => {
    expect(storageAreaIdSchema.safeParse(undefined).success).toBe(true);
  });

  it('rejects non-UUID string', () => {
    expect(storageAreaIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });

  it('rejects plain integer', () => {
    expect(storageAreaIdSchema.safeParse(42).success).toBe(false);
  });
});

// ─── moveBottleSchema ────────────────────────────────────────────────────────

describe('moveBottleSchema', () => {
  const base = { from_location: 'R1C1', to_location: 'R2C1' };

  it('accepts minimal body without area IDs', () => {
    expect(moveBottleSchema.safeParse(base).success).toBe(true);
  });

  it('accepts body with both area IDs', () => {
    const body = { ...base, from_storage_area_id: VALID_UUID, to_storage_area_id: VALID_UUID };
    expect(moveBottleSchema.safeParse(body).success).toBe(true);
  });

  it('accepts body with null area IDs', () => {
    const body = { ...base, from_storage_area_id: null, to_storage_area_id: null };
    expect(moveBottleSchema.safeParse(body).success).toBe(true);
  });

  it('accepts body with only from_storage_area_id', () => {
    const body = { ...base, from_storage_area_id: VALID_UUID };
    expect(moveBottleSchema.safeParse(body).success).toBe(true);
  });

  it('rejects same from and to location', () => {
    const body = { from_location: 'R1C1', to_location: 'R1C1' };
    const result = moveBottleSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toContain('to_location');
  });

  it('rejects invalid area UUID', () => {
    const body = { ...base, from_storage_area_id: 'bad-uuid' };
    expect(moveBottleSchema.safeParse(body).success).toBe(false);
  });
});

// ─── swapBottleSchema ────────────────────────────────────────────────────────

describe('swapBottleSchema', () => {
  const base = { slot_a: 'R1C1', slot_b: 'R2C1', displaced_to: 'R3C1' };

  it('accepts minimal body without area IDs', () => {
    expect(swapBottleSchema.safeParse(base).success).toBe(true);
  });

  it('accepts body with all three area IDs', () => {
    const body = {
      ...base,
      slot_a_storage_area_id: VALID_UUID,
      slot_b_storage_area_id: VALID_UUID,
      displaced_to_storage_area_id: VALID_UUID
    };
    expect(swapBottleSchema.safeParse(body).success).toBe(true);
  });

  it('accepts body with null area IDs', () => {
    const body = {
      ...base,
      slot_a_storage_area_id: null,
      slot_b_storage_area_id: null,
      displaced_to_storage_area_id: null
    };
    expect(swapBottleSchema.safeParse(body).success).toBe(true);
  });

  it('rejects when any two slots are the same', () => {
    const body = { slot_a: 'R1C1', slot_b: 'R1C1', displaced_to: 'R3C1' };
    expect(swapBottleSchema.safeParse(body).success).toBe(false);
  });

  it('rejects when displaced_to equals slot_a', () => {
    const body = { slot_a: 'R1C1', slot_b: 'R2C1', displaced_to: 'R1C1' };
    expect(swapBottleSchema.safeParse(body).success).toBe(false);
  });
});

// ─── directSwapSchema ────────────────────────────────────────────────────────

describe('directSwapSchema', () => {
  const base = { slot_a: 'R1C1', slot_b: 'R2C1' };

  it('accepts minimal body without area IDs', () => {
    expect(directSwapSchema.safeParse(base).success).toBe(true);
  });

  it('accepts body with both area IDs', () => {
    const body = { ...base, slot_a_storage_area_id: VALID_UUID, slot_b_storage_area_id: VALID_UUID };
    expect(directSwapSchema.safeParse(body).success).toBe(true);
  });

  it('accepts body with null area IDs', () => {
    const body = { ...base, slot_a_storage_area_id: null, slot_b_storage_area_id: null };
    expect(directSwapSchema.safeParse(body).success).toBe(true);
  });

  it('rejects same slot_a and slot_b', () => {
    const body = { slot_a: 'R1C1', slot_b: 'R1C1' };
    const result = directSwapSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toContain('slot_b');
  });
});

// ─── addToSlotSchema ─────────────────────────────────────────────────────────

describe('addToSlotSchema', () => {
  it('accepts wine_id without storage_area_id', () => {
    expect(addToSlotSchema.safeParse({ wine_id: 1 }).success).toBe(true);
  });

  it('accepts wine_id with a valid storage_area_id', () => {
    expect(addToSlotSchema.safeParse({ wine_id: 1, storage_area_id: VALID_UUID }).success).toBe(true);
  });

  it('accepts wine_id with null storage_area_id', () => {
    expect(addToSlotSchema.safeParse({ wine_id: 1, storage_area_id: null }).success).toBe(true);
  });

  it('accepts string wine_id and coerces to number', () => {
    const result = addToSlotSchema.safeParse({ wine_id: '42' });
    expect(result.success).toBe(true);
    expect(result.data.wine_id).toBe(42);
  });

  it('rejects missing wine_id', () => {
    expect(addToSlotSchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid storage_area_id format', () => {
    expect(addToSlotSchema.safeParse({ wine_id: 1, storage_area_id: 'bad' }).success).toBe(false);
  });
});

// ─── drinkBottleSchema ───────────────────────────────────────────────────────

describe('drinkBottleSchema', () => {
  it('accepts empty body', () => {
    expect(drinkBottleSchema.safeParse({}).success).toBe(true);
  });

  it('accepts storage_area_id as a valid UUID', () => {
    expect(drinkBottleSchema.safeParse({ storage_area_id: VALID_UUID }).success).toBe(true);
  });

  it('accepts storage_area_id as null', () => {
    expect(drinkBottleSchema.safeParse({ storage_area_id: null }).success).toBe(true);
  });

  it('accepts full drink body with storage_area_id', () => {
    const body = {
      occasion: 'Dinner',
      pairing_dish: 'Steak',
      rating: 4.5,
      notes: 'Excellent',
      pairing_session_id: 7,
      storage_area_id: VALID_UUID
    };
    expect(drinkBottleSchema.safeParse(body).success).toBe(true);
  });

  it('rejects invalid storage_area_id format', () => {
    expect(drinkBottleSchema.safeParse({ storage_area_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects rating above 5', () => {
    expect(drinkBottleSchema.safeParse({ rating: 6 }).success).toBe(false);
  });
});
