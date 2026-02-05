/**
 * @fileoverview Zod schemas for acquisition routes.
 * @module schemas/acquisition
 */

import { z } from 'zod';

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * POST /parse-image body.
 */
export const parseImageSchema = z.object({
  image: z.string().min(1, 'image is required'),
  mediaType: z.enum(MEDIA_TYPES, {
    errorMap: () => ({ message: `mediaType must be one of: ${MEDIA_TYPES.join(', ')}` })
  })
});

/**
 * Wine object used in acquisition requests.
 */
const wineObjectSchema = z.object({
  wine_name: z.string().min(1, 'wine_name is required'),
  vintage: z.union([z.string(), z.number()]).optional(),
  colour: z.string().optional(),
  style: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  grapes: z.string().optional()
}).passthrough();

/**
 * POST /suggest-placement body.
 */
export const suggestPlacementSchema = z.object({
  wine: wineObjectSchema
});

/**
 * POST /enrich body.
 */
export const enrichSchema = z.object({
  wine: wineObjectSchema
});

/**
 * POST /workflow body.
 */
export const workflowSchema = z.object({
  image: z.string().optional(),
  mediaType: z.enum(MEDIA_TYPES).optional(),
  text: z.string().max(5000).optional(),
  confirmedData: z.record(z.unknown()).optional(),
  skipEnrichment: z.boolean().optional()
}).refine(data => data.image || data.text || data.confirmedData, {
  message: 'One of image, text, or confirmedData is required'
});

/**
 * POST /save body.
 */
export const saveAcquiredSchema = z.object({
  wine: wineObjectSchema,
  slot: z.string().max(20).optional(),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  addToFridge: z.boolean().optional()
});
