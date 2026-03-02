/**
 * @fileoverview Zod schemas for pending rating resolve endpoint.
 * @module schemas/pendingRating
 */

import { z } from 'zod';

/**
 * Pairing feedback schema — optional section when resolving a pairing-linked reminder.
 */
export const pairingFeedbackSchema = z.object({
  pairingFitRating: z.number().min(1).max(5),
  wouldPairAgain: z.boolean().nullable(),
  failureReasons: z.array(z.string().max(50)).max(5).optional().nullable(),
  notes: z.string().max(300).optional().nullable()
}).strict();

/**
 * Schema for PUT /api/pending-ratings/:id/resolve
 */
export const resolvePendingRatingSchema = z.object({
  status: z.enum(['rated', 'dismissed']),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  pairingFeedback: pairingFeedbackSchema.optional().nullable()
});
