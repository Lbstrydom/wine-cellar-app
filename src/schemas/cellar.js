/**
 * @fileoverview Zod schemas for cellar routes.
 * @module schemas/cellar
 */

import { z } from 'zod';

/**
 * Create cellar body schema.
 */
export const createCellarSchema = z.object({
  name: z.string().min(1, 'Cellar name is required').max(100).trim(),
  description: z.string().max(500).nullable().optional()
});

/**
 * Update cellar body schema.
 */
export const updateCellarSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  description: z.string().max(500).nullable().optional(),
  settings: z.record(z.unknown()).optional()
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field is required'
});
