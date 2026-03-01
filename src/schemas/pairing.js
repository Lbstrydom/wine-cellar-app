/**
 * @fileoverview Zod schemas for pairing routes.
 * @module schemas/pairing
 */

import { z } from 'zod';

/**
 * POST /suggest body.
 */
export const suggestPairingSchema = z.object({
  signals: z.array(z.string().min(1)).min(1, 'Provide at least one food signal'),
  prefer_reduce_now: z.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(20).default(5)
});

/**
 * POST /natural body.
 */
export const naturalPairingSchema = z.object({
  dish: z.string().min(1, 'Please describe a dish').max(500).trim(),
  source: z.string().max(50).default('all'),
  colour: z.string().max(20).default('any')
});

/**
 * POST /chat body.
 */
export const chatMessageSchema = z.object({
  chatId: z.string().uuid('Invalid chat ID'),
  message: z.string().min(1, 'Message is required').max(2000).trim()
});

/**
 * POST /extract-signals body.
 */
export const extractSignalsSchema = z.object({
  dish: z.string().min(1, 'Please provide a dish description').max(500).trim()
});

/**
 * POST /shortlist body.
 */
export const shortlistSchema = z.object({
  dish: z.string().min(1, 'Please describe a dish').max(500).trim(),
  source: z.string().max(50).default('all'),
  colour: z.string().max(20).default('any'),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  houseStyle: z.record(z.number()).optional()
});

/**
 * POST /hybrid body.
 */
export const hybridPairingSchema = z.object({
  dish: z.string().min(1, 'Please describe a dish').max(500).trim(),
  source: z.string().max(50).default('all'),
  colour: z.string().max(20).default('any'),
  topN: z.coerce.number().int().min(1).max(10).default(3),
  houseStyle: z.record(z.number()).optional()
});

/**
 * POST /sessions/:id/choose body.
 */
export const sessionChooseSchema = z.object({
  wineId: z.coerce.number().int().positive('wineId is required'),
  rank: z.coerce.number().int().positive('rank is required')
});

/**
 * POST /sessions/:id/feedback body.
 */
export const sessionFeedbackSchema = z.object({
  pairingFitRating: z.coerce.number().int().min(1).max(5),
  wouldPairAgain: z.boolean(),
  failureReasons: z.array(z.string()).optional(),
  notes: z.string().max(1000).optional()
});

/**
 * POST /sessions/manual body.
 */
export const manualPairingSchema = z.object({
  wineId: z.coerce.number().int().positive('wineId is required'),
  dish: z.string().min(1, 'Please describe a dish').max(500).trim(),
  recipeId: z.coerce.number().int().positive().optional()
});

/**
 * Session ID param schema.
 */
export const sessionIdSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid session ID').transform(Number)
});
