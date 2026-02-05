/**
 * @fileoverview Zod schemas for rating routes.
 * @module schemas/rating
 */

import { z } from 'zod';

/**
 * Wine ID parameter (numeric string → integer).
 */
export const ratingWineIdSchema = z.object({
  wineId: z.coerce.number().int().positive('wineId must be a positive integer')
});

/**
 * Wine ID + Rating ID parameters.
 */
export const ratingParamsSchema = z.object({
  wineId: z.coerce.number().int().positive('wineId must be a positive integer'),
  ratingId: z.coerce.number().int().positive('ratingId must be a positive integer')
});

/**
 * GET /:wineId/ratings query.
 */
export const ratingsQuerySchema = z.object({
  vintage: z.coerce.number().int().min(1900).max(2100).optional()
});

/**
 * POST /:wineId/ratings body — manual rating.
 */
export const addRatingSchema = z.object({
  source: z.string().min(1, 'source is required').max(100),
  score_type: z.string().min(1, 'score_type is required').max(50),
  raw_score: z.union([z.string().min(1), z.number()]),
  competition_year: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
  award_name: z.string().max(200).optional().nullable(),
  source_url: z.string().url().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  custom_source_name: z.string().max(100).optional().nullable()
});

/**
 * PUT /:wineId/ratings/:ratingId body — override rating.
 */
export const overrideRatingSchema = z.object({
  override_normalized_mid: z.number().min(0).max(100),
  override_note: z.string().max(2000).optional().nullable()
});

/**
 * POST /:wineId/ratings/fetch-async body.
 */
export const fetchAsyncSchema = z.object({
  forceRefresh: z.boolean().optional().default(false)
});

/**
 * POST /batch-fetch body.
 */
export const batchFetchSchema = z.object({
  wineIds: z.array(z.coerce.number().int().positive()).min(1, 'wineIds array is empty').max(100, 'Maximum 100 wines per batch'),
  forceRefresh: z.boolean().optional().default(false)
});

/**
 * Job ID parameter.
 */
export const jobIdSchema = z.object({
  jobId: z.string().min(1, 'jobId is required').max(100)
});
