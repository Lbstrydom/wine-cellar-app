/**
 * @fileoverview Zod validation schemas for buying guide item routes.
 * @module schemas/buyingGuideItem
 */

import { z } from 'zod';
import { STYLE_IDS } from '../config/styleIds.js';

/** Valid statuses for buying guide items. */
const STATUSES = ['planned', 'ordered', 'arrived', 'cancelled'];

/** Valid confidence levels for inferred style. */
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

/**
 * Create a new buying guide item.
 */
export const createItemSchema = z.object({
  wine_name: z.string().min(1, 'Wine name is required').max(500),
  producer: z.string().max(500).optional().nullable(),
  quantity: z.number().int().min(1).max(100).optional().default(1),
  style_id: z.enum(STYLE_IDS).optional().nullable(),
  price: z.number().min(0).max(99999999.99).optional().nullable(),
  currency: z.string().max(10).optional().default('ZAR'),
  vendor_url: z.string().url().max(2000).optional().nullable(),
  vintage: z.number().int().min(1900).max(2100).optional().nullable(),
  colour: z.string().max(50).optional().nullable(),
  grapes: z.string().max(500).optional().nullable(),
  region: z.string().max(200).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  source: z.string().max(50).optional().default('manual'),
  source_gap_style: z.enum(STYLE_IDS).optional().nullable()
});

/**
 * Update a buying guide item (all fields optional).
 */
export const updateItemSchema = createItemSchema.partial();

/**
 * Update item status (state machine validated in service).
 */
export const updateStatusSchema = z.object({
  status: z.enum(STATUSES)
});

/**
 * Batch status update.
 */
export const batchStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  status: z.enum(STATUSES)
});

/**
 * List items query params.
 */
export const listItemsQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  style_id: z.enum(STYLE_IDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

/**
 * Item ID param.
 */
export const itemIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

/**
 * Style inference request body.
 */
export const inferStyleSchema = z.object({
  wine_name: z.string().min(1).max(500),
  producer: z.string().max(500).optional().nullable(),
  colour: z.string().max(50).optional().nullable(),
  grapes: z.string().max(500).optional().nullable(),
  region: z.string().max(200).optional().nullable(),
  country: z.string().max(100).optional().nullable()
});
