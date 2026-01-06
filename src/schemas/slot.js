/**
 * @fileoverview Zod schemas for slot operations.
 * @module schemas/slot
 */

import { z } from 'zod';

/**
 * Slot location code pattern.
 * - Cellar: R{row}C{col} (e.g., R5C3, R12C9)
 * - Fridge: F{slot} (e.g., F1, F12)
 */
const locationPattern = /^(R\d{1,2}C\d{1,2}|F\d{1,2})$/;

/**
 * Location code schema.
 */
export const locationCodeSchema = z.string()
  .regex(locationPattern, 'Invalid location format. Use R{row}C{col} for cellar or F{num} for fridge');

/**
 * Location parameter schema.
 */
export const locationParamSchema = z.object({
  location: locationCodeSchema
});

/**
 * Move bottle schema.
 */
export const moveBottleSchema = z.object({
  from_location: locationCodeSchema,
  to_location: locationCodeSchema
}).refine(data => data.from_location !== data.to_location, {
  message: 'Source and target locations must be different',
  path: ['to_location']
});

/**
 * 3-way swap schema.
 */
export const swapBottleSchema = z.object({
  slot_a: locationCodeSchema,
  slot_b: locationCodeSchema,
  displaced_to: locationCodeSchema
}).refine(data => {
  const slots = [data.slot_a, data.slot_b, data.displaced_to];
  return new Set(slots).size === slots.length;
}, {
  message: 'All slot locations must be different',
  path: ['displaced_to']
});

/**
 * Direct swap schema.
 */
export const directSwapSchema = z.object({
  slot_a: locationCodeSchema,
  slot_b: locationCodeSchema
}).refine(data => data.slot_a !== data.slot_b, {
  message: 'Slots must be different',
  path: ['slot_b']
});

/**
 * Add bottle to slot schema.
 */
export const addToSlotSchema = z.object({
  wine_id: z.union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/).transform(Number)
  ])
});

/**
 * Drink bottle schema.
 */
export const drinkBottleSchema = z.object({
  occasion: z.string().max(200).optional().nullable(),
  pairing_dish: z.string().max(200).optional().nullable(),
  rating: z.union([
    z.number().min(0).max(5),
    z.null()
  ]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable()
});
