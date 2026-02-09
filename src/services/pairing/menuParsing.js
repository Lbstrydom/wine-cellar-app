/**
 * @fileoverview Menu parsing service for restaurant pairing.
 * Extracts wine list and dish menu items from images or text using Claude Vision.
 * Single-image-per-request model with per-call timeout.
 * @module services/pairing/menuParsing
 */

import anthropic from '../ai/claudeClient.js';
import { getModelForTask } from '../../config/aiModels.js';
import { createTimeoutAbort } from '../shared/fetchUtils.js';
import { sanitizeMenuText, sanitizeMenuItems } from '../shared/inputSanitizer.js';
import { MENU_TYPES, wineListResponseSchema, dishMenuResponseSchema } from '../../schemas/restaurantPairing.js';
import logger from '../../utils/logger.js';

/** Per-call timeout for Claude API calls (ms) */
const PARSE_TIMEOUT_MS = 30_000;

/** Set of valid menu types for defensive validation */
const VALID_TYPES = new Set(MENU_TYPES);

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for menu parsing.
 * @param {string} type - 'wine_list' or 'dish_menu'
 * @returns {string} System prompt
 */
function buildSystemPrompt(type) {
  if (type === 'wine_list') {
    return `You are a restaurant wine list parser. Extract every wine from the input into structured data.

For each wine, extract:
- name: Full wine name (producer + wine name, exclude vintage)
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style if not explicit, null if truly unknown)
- style: Grape variety or wine style (e.g., "Sauvignon Blanc", "Chianti")
- price: Numeric price (null if not shown). Keep in original currency.
- currency: Currency symbol or code (e.g., "$", "€", "£", "R", "ZAR", null if no price)
- vintage: Year as integer (null if NV or not specified)
- by_the_glass: true if explicitly marked as by-the-glass, false otherwise
- region: Wine region if mentioned (null if not)
- confidence: "high" if clearly legible, "medium" if partially inferred, "low" if guessing

RULES:
- Every item MUST have type: "wine"
- Infer colour from grape variety if not stated (Merlot→red, Chardonnay→white, etc.)
- Do NOT convert currencies — preserve the original price and currency
- If a wine appears at two prices (glass/bottle), create TWO entries: one with by_the_glass: true, one with false
- Bin numbers are NOT prices — they are typically 3-digit codes without currency symbols
- Set overall_confidence based on worst individual item confidence`;
  }

  return `You are a restaurant menu parser. Extract every dish from the input into structured data.

For each dish, extract:
- name: Dish name as it appears on the menu
- description: Any description or ingredients listed (null if none)
- price: Numeric price (null if not shown). Keep in original currency.
- currency: Currency symbol or code (null if no price)
- category: One of "Starter", "Main", "Dessert", "Side", "Sharing" (infer from menu section or dish type, null if unclear)
- confidence: "high" if clearly legible, "medium" if partially inferred, "low" if guessing

RULES:
- Every item MUST have type: "dish"
- Infer category from menu section headers if present (Starters, Mains, etc.)
- If a dish has no clear category, use null rather than guessing
- Set overall_confidence based on worst individual item confidence`;
}

/**
 * Build the JSON schema instruction appended to every prompt.
 * @param {string} type - 'wine_list' or 'dish_menu'
 * @returns {string} JSON format instruction
 */
function buildFormatInstruction(type) {
  if (type === 'wine_list') {
    return `Respond ONLY with valid JSON matching this structure:
{
  "items": [
    {
      "type": "wine",
      "name": "Producer Wine Name",
      "colour": "red",
      "style": "Cabernet Sauvignon",
      "price": 45.00,
      "currency": "$",
      "vintage": 2021,
      "by_the_glass": false,
      "region": "Stellenbosch",
      "confidence": "high"
    }
  ],
  "overall_confidence": "high",
  "parse_notes": "Any notes about parsing quality or assumptions"
}`;
  }

  return `Respond ONLY with valid JSON matching this structure:
{
  "items": [
    {
      "type": "dish",
      "name": "Grilled Salmon",
      "description": "With seasonal vegetables and lemon butter sauce",
      "price": 28.00,
      "currency": "$",
      "category": "Main",
      "confidence": "high"
    }
  ],
  "overall_confidence": "high",
  "parse_notes": "Any notes about parsing quality or assumptions"
}`;
}

// ---------------------------------------------------------------------------
// Core parsing
// ---------------------------------------------------------------------------

/**
 * Extract JSON from a Claude response, handling markdown code fences.
 * @param {string} responseText - Raw Claude response text
 * @returns {Object} Parsed JSON object
 * @throws {Error} If JSON cannot be extracted
 */
function extractJson(responseText) {
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                    responseText.match(/```\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
  return JSON.parse(jsonStr.trim());
}

/**
 * Parse a menu from text input.
 * @param {string} type - 'wine_list' or 'dish_menu'
 * @param {string} text - Raw menu text from user
 * @returns {Promise<Object>} Parsed menu response matching wineListResponseSchema or dishMenuResponseSchema
 * @throws {Error} If Claude API key missing, timeout, or unparseable response
 */
export async function parseMenuFromText(type, text) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid menu type: "${type}" (expected ${MENU_TYPES.join(' or ')})`);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const sanitizedText = sanitizeMenuText(text);
  const modelId = getModelForTask('menuParsing');
  const systemPrompt = buildSystemPrompt(type);
  const formatInstruction = buildFormatInstruction(type);

  const userPrompt = `${formatInstruction}

MENU TEXT:
${sanitizedText}`;

  const { controller, cleanup } = createTimeoutAbort(PARSE_TIMEOUT_MS);

  try {
    const message = await anthropic.messages.create(
      {
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      },
      { signal: controller.signal }
    );

    const responseText = message.content[0].text;
    const parsed = extractJson(responseText);
    return validateAndSanitize(type, parsed);
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('MenuParsing', `Text parse timed out after ${PARSE_TIMEOUT_MS}ms for type=${type}`);
      throw new Error('Menu parsing timed out');
    }
    logger.error('MenuParsing', `Text parse failed for type=${type}: ${error.message}`);
    throw error;
  } finally {
    cleanup();
  }
}

/**
 * Parse a menu from a single image.
 * @param {string} type - 'wine_list' or 'dish_menu'
 * @param {string} base64Image - Base64-encoded image data
 * @param {string} mediaType - Image MIME type (image/jpeg, image/png, image/webp, image/gif)
 * @returns {Promise<Object>} Parsed menu response matching wineListResponseSchema or dishMenuResponseSchema
 * @throws {Error} If Claude API key missing, timeout, or unparseable response
 */
export async function parseMenuFromImage(type, base64Image, mediaType) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid menu type: "${type}" (expected ${MENU_TYPES.join(' or ')})`);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const modelId = getModelForTask('menuParsing');
  const systemPrompt = buildSystemPrompt(type);
  const formatInstruction = buildFormatInstruction(type);

  const { controller, cleanup } = createTimeoutAbort(PARSE_TIMEOUT_MS);

  try {
    const message = await anthropic.messages.create(
      {
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Image
                }
              },
              {
                type: 'text',
                text: formatInstruction
              }
            ]
          }
        ]
      },
      { signal: controller.signal }
    );

    const responseText = message.content[0].text;
    const parsed = extractJson(responseText);
    return validateAndSanitize(type, parsed);
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('MenuParsing', `Image parse timed out after ${PARSE_TIMEOUT_MS}ms for type=${type}`);
      throw new Error('Menu parsing timed out');
    }
    logger.error('MenuParsing', `Image parse failed for type=${type}: ${error.message}`);
    throw error;
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// Validation + sanitization
// ---------------------------------------------------------------------------

/**
 * Validate parsed response against the appropriate schema and sanitize string fields.
 * Falls back to best-effort extraction if schema validation fails.
 * @param {string} type - 'wine_list' or 'dish_menu'
 * @param {Object} parsed - Raw parsed JSON from Claude
 * @returns {Object} Validated and sanitized response
 * @throws {Error} If response is completely unparseable
 */
function validateAndSanitize(type, parsed) {
  // Guard: Claude returned null, a primitive, or an array instead of an object
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('MenuParsing', `Claude returned non-object JSON (${typeof parsed}), returning empty result`);
    return {
      items: [],
      overall_confidence: 'low',
      parse_notes: 'Response was not a valid object'
    };
  }

  const schema = type === 'wine_list' ? wineListResponseSchema : dishMenuResponseSchema;
  const expectedType = type === 'wine_list' ? 'wine' : 'dish';

  // Ensure items have correct type discriminator
  if (Array.isArray(parsed.items)) {
    parsed.items = parsed.items.map(item => ({
      ...item,
      type: item.type || expectedType
    }));
  }

  const result = schema.safeParse(parsed);

  if (result.success) {
    result.data.items = sanitizeMenuItems(result.data.items);
    return result.data;
  }

  // Best-effort: sanitize what we have and coerce to minimum required shape
  logger.warn('MenuParsing', `Schema validation failed, using best-effort: ${result.error.message}`);

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = sanitizeMenuItems(rawItems.map(item => ({
    ...item,
    type: item.type || expectedType,
    name: item.name || 'Unknown item',
    confidence: item.confidence || 'low'
  })));

  return {
    items,
    overall_confidence: 'low',
    parse_notes: parsed.parse_notes || 'Response did not fully match expected schema'
  };
}
