/**
 * @fileoverview Zod schemas for wine-related validations.
 * @module schemas/wine
 */

import { z } from 'zod';

/**
 * Valid wine colours.
 */
export const WINE_COLOURS = ['red', 'white', 'rose', 'sparkling', 'dessert', 'fortified'];

/**
 * Wine ID parameter schema.
 */
export const wineIdSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid wine ID').transform(Number)
});

/**
 * Create wine schema.
 */
export const createWineSchema = z.object({
  wine_name: z.string().min(1, 'Wine name is required').max(300, 'Wine name too long'),
  style: z.string().max(200).optional().nullable(),
  colour: z.enum(WINE_COLOURS, { errorMap: () => ({ message: `Colour must be one of: ${WINE_COLOURS.join(', ')}` }) }).optional().nullable(),
  vintage: z.union([
    z.number().int().min(1900).max(2100),
    z.string().regex(/^\d{4}$/).transform(Number),
    z.null()
  ]).optional().nullable(),
  vivino_rating: z.union([
    z.number().min(0).max(5),
    z.string().regex(/^\d+(\.\d+)?$/).transform(Number),
    z.null()
  ]).optional().nullable(),
  price_eur: z.union([
    z.number().min(0),
    z.string().regex(/^\d+(\.\d+)?$/).transform(Number),
    z.null()
  ]).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  vivino_id: z.string().max(100).optional().nullable(),
  vivino_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  vivino_confirmed: z.union([z.boolean(), z.number().transform(Boolean)]).optional()
});

/**
 * Update wine schema (same as create but all fields optional).
 */
export const updateWineSchema = createWineSchema.extend({
  wine_name: z.string().min(1).max(300).optional(),
  drink_from: z.union([z.number().int().min(1900).max(2100), z.null()]).optional().nullable(),
  drink_peak: z.union([z.number().int().min(1900).max(2100), z.null()]).optional().nullable(),
  drink_until: z.union([z.number().int().min(1900).max(2100), z.null()]).optional().nullable()
});

/**
 * Personal rating schema.
 */
export const personalRatingSchema = z.object({
  rating: z.union([
    z.number().min(0).max(5),
    z.null()
  ]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable()
});

/**
 * Tasting profile schema.
 */
export const tastingProfileSchema = z.object({
  profile: z.record(z.any())
});

/**
 * Tasting profile extraction schema.
 */
export const tastingExtractionSchema = z.object({
  tasting_note: z.string().min(1, 'Tasting note is required').max(5000),
  source_id: z.string().max(100).default('user')
});

/**
 * Wine text parsing schema.
 */
export const parseTextSchema = z.object({
  text: z.string().min(1, 'Text is required').max(5000, 'Text too long (max 5000 characters)')
});

/**
 * Wine image parsing schema.
 */
export const parseImageSchema = z.object({
  image: z.string().min(1, 'Image is required').max(10000000, 'Image too large'),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif'], {
    errorMap: () => ({ message: 'Invalid image type. Supported: jpeg, png, webp, gif' })
  })
});

/**
 * Wine search query schema.
 */
export const searchQuerySchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters').max(200).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).default('10')
});

/**
 * Global search query schema.
 */
export const globalSearchSchema = z.object({
  q: z.string().min(2).max(200).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(50)).default('5')
});

/**
 * Serving temperature query schema.
 */
export const servingTempQuerySchema = z.object({
  unit: z.enum(['celsius', 'fahrenheit']).default('celsius')
});
