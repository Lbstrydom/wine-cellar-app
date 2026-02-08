/**
 * @fileoverview Zod schemas for restaurant pairing routes.
 * @module schemas/restaurantPairing
 */

import { z } from 'zod';

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Maximum decoded image size: 2MB */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Base64 length = 4 * ceil(bytes / 3) */
export const MAX_IMAGE_BASE64_CHARS = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);

/** Maximum text length for menu input */
const MAX_MENU_TEXT_CHARS = 5000;

/**
 * Valid menu parse types (discriminator).
 */
export const MENU_TYPES = ['wine_list', 'dish_menu'];

/**
 * Wine colour filter options for restaurant context.
 */
export const RESTAURANT_WINE_COLOURS = ['red', 'white', 'rose', 'sparkling'];

/**
 * Dish category options.
 */
export const DISH_CATEGORIES = ['Starter', 'Main', 'Dessert', 'Side', 'Sharing'];

/**
 * Confidence levels used across parse responses.
 */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

// ---------------------------------------------------------------------------
// POST /api/restaurant-pairing/parse-menu
// ---------------------------------------------------------------------------

/**
 * POST /parse-menu body — single image OR text per call.
 */
export const parseMenuSchema = z.object({
  type: z.enum(MENU_TYPES, {
    errorMap: () => ({ message: `type must be one of: ${MENU_TYPES.join(', ')}` })
  }),
  text: z.string().trim().max(MAX_MENU_TEXT_CHARS, `Text too long (max ${MAX_MENU_TEXT_CHARS} characters)`).nullable().default(null),
  image: z.string().max(MAX_IMAGE_BASE64_CHARS, 'Image too large (max 2MB decoded)').nullable().default(null),
  mediaType: z.enum(MEDIA_TYPES, {
    errorMap: () => ({ message: `mediaType must be one of: ${MEDIA_TYPES.join(', ')}` })
  }).nullable().default(null)
}).refine(data => (data.text && data.text.length > 0) || data.image, {
  message: 'Either text or image is required'
}).refine(data => !(data.text && data.image), {
  message: 'Provide text or image, not both'
}).refine(data => !data.image || data.mediaType, {
  message: 'mediaType is required when image is provided'
});

// ---------------------------------------------------------------------------
// POST /api/restaurant-pairing/recommend
// ---------------------------------------------------------------------------

/**
 * Wine item in recommend request.
 */
const recommendWineSchema = z.object({
  id: z.number().int().positive('Wine id must be a positive integer'),
  name: z.string().min(1, 'Wine name is required').max(300),
  colour: z.string().max(50).nullable().default(null),
  style: z.string().max(200).nullable().default(null),
  vintage: z.number().int().min(1900).max(2100).nullable().default(null),
  price: z.number().min(0).nullable().default(null),
  by_the_glass: z.boolean()
});

/**
 * Dish item in recommend request.
 */
const recommendDishSchema = z.object({
  id: z.number().int().positive('Dish id must be a positive integer'),
  name: z.string().min(1, 'Dish name is required').max(300),
  description: z.string().max(1000).nullable().default(null),
  category: z.enum(DISH_CATEGORIES, {
    errorMap: () => ({ message: `category must be one of: ${DISH_CATEGORIES.join(', ')}` })
  }).nullable().default(null)
});

/**
 * POST /recommend body.
 */
export const recommendSchema = z.object({
  wines: z.array(recommendWineSchema).min(1, 'At least one wine is required').max(80, 'Maximum 80 wines'),
  dishes: z.array(recommendDishSchema).min(1, 'At least one dish is required').max(20, 'Maximum 20 dishes'),
  colour_preferences: z.array(z.enum(RESTAURANT_WINE_COLOURS)).default([]),
  budget_max: z.number().min(0).nullable().default(null),
  party_size: z.number().int().min(1).max(20).nullable().default(null),
  max_bottles: z.number().int().min(1).max(10).nullable().default(null),
  prefer_by_glass: z.boolean().default(false)
});

// ---------------------------------------------------------------------------
// POST /api/restaurant-pairing/chat
// ---------------------------------------------------------------------------

/**
 * POST /chat body.
 */
export const restaurantChatSchema = z.object({
  chatId: z.string().uuid('Invalid chat ID'),
  message: z.string().trim().min(1, 'Message is required').max(2000)
});

// ---------------------------------------------------------------------------
// Response schemas (for documentation / service-layer validation)
// ---------------------------------------------------------------------------

/**
 * Parsed wine item from menu OCR.
 */
export const parsedWineItemSchema = z.object({
  type: z.literal('wine'),
  name: z.string(),
  colour: z.string().nullable().default(null),
  style: z.string().nullable().default(null),
  price: z.number().nullable().default(null),
  currency: z.string().nullable().default(null),
  vintage: z.number().int().nullable().default(null),
  by_the_glass: z.boolean().default(false),
  region: z.string().nullable().default(null),
  confidence: z.enum(CONFIDENCE_LEVELS)
});

/**
 * Parsed dish item from menu OCR.
 */
export const parsedDishItemSchema = z.object({
  type: z.literal('dish'),
  name: z.string(),
  description: z.string().nullable().default(null),
  price: z.number().nullable().default(null),
  currency: z.string().nullable().default(null),
  category: z.enum(DISH_CATEGORIES).nullable().default(null),
  confidence: z.enum(CONFIDENCE_LEVELS)
});

/**
 * Parse-menu response (wine_list type).
 */
export const wineListResponseSchema = z.object({
  items: z.array(parsedWineItemSchema),
  overall_confidence: z.enum(CONFIDENCE_LEVELS),
  parse_notes: z.string()
});

/**
 * Parse-menu response (dish_menu type).
 */
export const dishMenuResponseSchema = z.object({
  items: z.array(parsedDishItemSchema),
  overall_confidence: z.enum(CONFIDENCE_LEVELS),
  parse_notes: z.string()
});

/**
 * Single pairing in recommend response.
 */
export const pairingItemSchema = z.object({
  rank: z.number().int().positive(),
  dish_name: z.string(),
  wine_id: z.number().int().positive(),
  wine_name: z.string(),
  wine_colour: z.string(),
  wine_price: z.number().nullable().default(null),
  by_the_glass: z.boolean(),
  why: z.string(),
  serving_tip: z.string(),
  confidence: z.enum(CONFIDENCE_LEVELS)
});

/**
 * Table wine suggestion in recommend response.
 */
export const tableWineSchema = z.object({
  wine_name: z.string(),
  wine_price: z.number().nullable().default(null),
  why: z.string()
});

/**
 * Recommend response.
 */
export const recommendResponseSchema = z.object({
  table_summary: z.string(),
  pairings: z.array(pairingItemSchema),
  table_wine: tableWineSchema.nullable().default(null),
  chatId: z.string().uuid().nullable().default(null),
  fallback: z.boolean().default(false)
});
