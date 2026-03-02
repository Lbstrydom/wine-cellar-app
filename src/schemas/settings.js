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
 * Allowlisted to known active integrations only.
 */
export const sourceParamSchema = z.object({
  source: z.enum(['paprika', 'mealie'])
});

/**
 * Known credential sources for UI rendering and test-connection dispatching.
 */
export const KNOWN_CREDENTIAL_SOURCES = [
  {
    id: 'paprika',
    label: 'Paprika',
    note: 'Paprika cloud sync imports your recipes automatically. Requires Paprika 3 account.',
    fields: [
      { name: 'username', type: 'email', placeholder: 'Email' },
      { name: 'password', type: 'password', placeholder: 'Password' }
    ]
  },
  {
    id: 'mealie',
    label: 'Mealie',
    note: 'Connect to your self-hosted Mealie instance for automatic recipe sync.',
    fields: [
      { name: 'username', type: 'url', placeholder: 'Instance URL (e.g. https://mealie.local)' },
      { name: 'password', type: 'password', placeholder: 'API Token' }
    ]
  }
];

/**
 * PUT /credentials/:source body.
 */
export const saveCredentialSchema = z.object({
  username: z.string().min(1, 'Username is required').max(200),
  password: z.string().min(1, 'Password is required').max(200)
});
