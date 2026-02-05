/**
 * @fileoverview Zod schemas for palate profile routes.
 * @module schemas/palateProfile
 */

import { z } from 'zod';

/**
 * POST /feedback body.
 */
export const feedbackSchema = z.object({
  wineId: z.coerce.number().int().positive('wineId is required'),
  consumptionId: z.coerce.number().int().positive().optional(),
  wouldBuyAgain: z.boolean().optional(),
  personalRating: z.coerce.number().min(1).max(5).optional(),
  pairedWith: z.array(z.string().max(50)).max(20).optional(),
  occasion: z.string().max(100).optional(),
  notes: z.string().max(2000).optional()
});

/**
 * Wine ID param.
 */
export const palateWineIdSchema = z.object({
  wineId: z.string().regex(/^\d+$/, 'Invalid wine ID').transform(Number)
});

/**
 * GET /recommendations query.
 */
export const recommendationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10)
});
