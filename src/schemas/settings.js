/**
 * @fileoverview Zod schemas for settings routes.
 * @module schemas/settings
 */

import { z } from 'zod';

/**
 * Settings key param.
 */
export const settingsKeySchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid setting key format')
});

/**
 * PUT /:key body.
 */
export const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()])
});

/**
 * Source param for credentials.
 */
export const sourceParamSchema = z.object({
  source: z.enum(['vivino', 'decanter'], {
    errorMap: () => ({ message: 'Invalid source. Must be one of: vivino, decanter' })
  })
});

/**
 * PUT /credentials/:source body.
 */
export const saveCredentialSchema = z.object({
  username: z.string().min(1, 'Username is required').max(200),
  password: z.string().min(1, 'Password is required').max(200)
});
