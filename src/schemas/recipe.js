/**
 * @fileoverview Zod validation schemas for recipe routes.
 * @module schemas/recipe
 */

import { z } from 'zod';

/**
 * Manual recipe creation / update body.
 */
export const recipeBodySchema = z.object({
  name: z.string().min(1, 'Recipe name is required').max(500),
  ingredients: z.string().max(10000).optional().nullable(),
  directions: z.string().max(20000).optional().nullable(),
  categories: z.array(z.string().max(100)).max(50).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  cook_time: z.string().max(50).optional().nullable(),
  prep_time: z.string().max(50).optional().nullable(),
  total_time: z.string().max(50).optional().nullable(),
  servings: z.string().max(50).optional().nullable(),
  source: z.string().max(500).optional().nullable(),
  source_url: z.string().url().max(2000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  image_url: z.string().url().max(2000).optional().nullable()
});

/**
 * Recipe update body (all fields optional except name).
 */
export const recipeUpdateSchema = recipeBodySchema.partial();

/**
 * Recipe list query params.
 */
export const recipeListQuerySchema = z.object({
  search: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  source_provider: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

/**
 * Recipe ID param.
 */
export const recipeIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

/**
 * URL import body.
 */
export const urlImportSchema = z.object({
  url: z.string().url().max(2000)
});

/**
 * Sync provider param.
 */
export const syncProviderSchema = z.object({
  provider: z.enum(['paprika', 'mealie'])
});

/**
 * Category overrides body.
 */
export const categoryOverridesSchema = z.object({
  overrides: z.record(z.string().max(100), z.number().int().min(0).max(10))
});

/**
 * Menu-pair request body.
 */
export const menuPairSchema = z.object({
  recipe_ids: z.array(z.number().int().positive()).min(1).max(20),
  colour: z.string().max(20).optional()
});
