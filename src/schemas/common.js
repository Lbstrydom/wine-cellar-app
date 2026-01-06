/**
 * @fileoverview Common Zod schemas used across routes.
 * @module schemas/common
 */

import { z } from 'zod';

/**
 * Numeric ID parameter schema.
 */
export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Invalid ID format').transform(Number)
});

/**
 * Pagination query schema.
 */
export const paginationSchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(500)).default('50'),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(0)).default('0')
});

/**
 * Optional search with pagination.
 */
export const searchPaginationSchema = paginationSchema.extend({
  q: z.string().max(200).optional()
});

/**
 * Date range schema.
 */
export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
}).refine(data => {
  if (data.from && data.to) {
    return new Date(data.from) <= new Date(data.to);
  }
  return true;
}, {
  message: '"from" date must be before "to" date',
  path: ['to']
});

/**
 * Sort order schema.
 */
export const sortOrderSchema = z.enum(['asc', 'desc']).default('asc');

/**
 * Boolean query parameter (handles string 'true'/'false').
 */
export const booleanQueryParam = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0']).transform(v => v === 'true' || v === '1')
]).default(false);

/**
 * Generic API response schema (for documentation).
 */
export const apiResponseSchema = z.object({
  message: z.string().optional(),
  data: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.any()).optional()
  }).optional()
});
