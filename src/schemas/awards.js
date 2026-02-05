/**
 * @fileoverview Zod schemas for awards routes.
 * @module schemas/awards
 */

import { z } from 'zod';

/**
 * POST /competitions body.
 */
export const addCompetitionSchema = z.object({
  name: z.string().min(1, 'Competition name is required').max(200),
  country: z.string().max(100).optional(),
  type: z.string().max(50).optional()
});

/**
 * POST /import/webpage body.
 */
export const importWebpageSchema = z.object({
  url: z.string().url('Valid URL is required'),
  competitionId: z.union([z.string().min(1), z.number()]),
  year: z.coerce.number().int().min(1900).max(2100)
});

/**
 * POST /import/text body.
 */
export const importTextSchema = z.object({
  text: z.string().min(1, 'Text content is required').max(100000),
  competitionId: z.union([z.string().min(1), z.number()]),
  year: z.coerce.number().int().min(1900).max(2100),
  sourceType: z.string().max(50).optional()
});

/**
 * POST /:awardId/link body.
 */
export const linkAwardSchema = z.object({
  wineId: z.coerce.number().int().positive('wineId is required')
});

/**
 * GET /search query.
 */
export const searchAwardsQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required').max(200),
  vintage: z.coerce.number().int().min(1900).max(2100).optional()
});

/**
 * Award ID param.
 */
export const awardIdSchema = z.object({
  awardId: z.string().regex(/^\d+$/, 'Invalid award ID').transform(Number)
});

/**
 * Source ID param.
 */
export const sourceIdSchema = z.object({
  sourceId: z.string().min(1)
});

/**
 * Wine ID param for awards lookup.
 */
export const awardWineIdSchema = z.object({
  wineId: z.string().regex(/^\d+$/, 'Invalid wine ID').transform(Number)
});
