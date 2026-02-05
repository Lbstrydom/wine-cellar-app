/**
 * @fileoverview Zod schemas for storage area routes.
 * @module schemas/storageArea
 */

import { z } from 'zod';

const STORAGE_TYPES = ['wine_fridge', 'kitchen_fridge', 'cellar', 'rack', 'other'];
const TEMP_ZONES = ['cold', 'cool', 'cellar', 'ambient'];

/**
 * Row definition used in storage area layouts.
 */
const rowSchema = z.object({
  row_num: z.coerce.number().int().min(1).max(100),
  col_count: z.coerce.number().int().min(1).max(50),
  label: z.string().max(50).optional()
});

/**
 * POST / body - create storage area.
 */
export const createStorageAreaSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).trim(),
  storage_type: z.enum(STORAGE_TYPES, {
    errorMap: () => ({ message: `storage_type must be one of: ${STORAGE_TYPES.join(', ')}` })
  }),
  temp_zone: z.enum(TEMP_ZONES, {
    errorMap: () => ({ message: `temp_zone must be one of: ${TEMP_ZONES.join(', ')}` })
  }),
  rows: z.array(rowSchema).min(1, 'At least one row is required').max(100)
});

/**
 * PUT /:id body - update storage area metadata.
 */
export const updateStorageAreaSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  storage_type: z.enum(STORAGE_TYPES).optional(),
  temp_zone: z.enum(TEMP_ZONES).optional(),
  icon: z.string().max(20).nullable().optional(),
  notes: z.string().max(500).nullable().optional()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required'
});

/**
 * PUT /:id/layout body.
 */
export const updateLayoutSchema = z.object({
  rows: z.array(rowSchema).min(1, 'At least one row is required').max(100)
});

/**
 * POST /from-template body.
 */
export const fromTemplateSchema = z.object({
  template: z.string().min(1, 'Template name is required').max(50),
  name: z.string().max(100).trim().optional(),
  notes: z.string().max(500).optional()
});

/**
 * UUID param for storage area ID.
 */
export const storageAreaIdSchema = z.object({
  id: z.string().uuid('Invalid storage area ID')
});
