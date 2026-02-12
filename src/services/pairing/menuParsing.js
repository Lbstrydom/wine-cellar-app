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

LANGUAGE HANDLING:
- The menu may be in ANY language (Dutch, Finnish, German, French, Spanish, Italian, etc.)
- Auto-detect the menu language and parse all items regardless of language
- Always output wine names as they appear on the menu (original language)
- Translate descriptive info (e.g., tasting notes) into English for the style/region fields
- Country names in region field should be in English (e.g., "France" not "Frankrijk")

For each wine, extract:
- name: Full wine name (producer + wine name, exclude vintage) — keep in original language as shown on menu
- colour: One of "red", "white", "rose", "sparkling" (infer from grape/style if not explicit, null if truly unknown)
- style: Grape variety or wine style in English (e.g., "Sauvignon Blanc", "Chianti")
- price: Numeric price (null if not shown). Keep in original currency. If shown as "5,75" (European comma decimal), convert to 5.75.
- currency: Currency symbol or code (e.g., "$", "€", "£", "R", "ZAR", null if no price)
- vintage: Year as integer (null if NV or not specified)
- by_the_glass: true if explicitly marked as by-the-glass, false otherwise
- region: Wine region if mentioned, with country name in English (null if not)
- confidence: "high" if clearly legible, "medium" if partially inferred, "low" if guessing

RULES:
- Every item MUST have type: "wine"
- Infer colour from grape variety if not stated (Merlot→red, Chardonnay→white, Pinotage→red, etc.)
- Do NOT convert currencies — preserve the original price and currency
- If a wine appears at two prices (glass/bottle), create TWO entries: one with by_the_glass: true, one with false
- Bin numbers are NOT prices — they are typically 3-digit codes without currency symbols
- European price format uses comma as decimal separator (e.g., "5,75" = 5.75, "27.90" = 27.90)
- Set overall_confidence based on worst individual item confidence
- Include menu_language in parse_notes (e.g., "Menu language: Dutch")`;
  }

  return `You are a restaurant menu parser. Extract every dish from the input into structured data.

LANGUAGE HANDLING:
- The menu may be in ANY language (Dutch, Finnish, German, French, Spanish, Italian, etc.)
- Auto-detect the menu language and parse all items regardless of language
- Keep the original dish name as it appears on the menu
- Provide an English translation of the dish name and description in the description field
  - Format: "[English translation]. [Original description if any]"
  - Example: For Dutch "Ossenhaas" with description "met Roseval aardappelen", output:
    name: "Ossenhaas", description: "Beef tenderloin. With Roseval potatoes, red cabbage, stewed pears and pepper sauce"
- This ensures the pairing engine can understand non-English dishes

For each dish, extract:
- name: Dish name as it appears on the menu (original language)
- description: English translation + any listed ingredients/description (null if truly no info). Always translate to English.
- price: Numeric price (null if not shown). Keep in original currency. If shown as "13,90" (European comma decimal), convert to 13.90.
- currency: Currency symbol or code (null if no price)
- category: One of "Starter", "Main", "Dessert", "Side", "Sharing" (infer from menu section or dish type, null if unclear)
- confidence: "high" if clearly legible, "medium" if partially inferred, "low" if guessing

RULES:
- Every item MUST have type: "dish"
- Infer category from menu section headers if present (Starters, Mains, Entrées, Hauptgerichte, etc.) regardless of language
- Check for language-specific section headers: Voorgerechten/Starters, Hoofdgerechten/Mains, Nagerechten/Desserts, Vorspeisen, Entrées, etc.
- Look for markers like (V) = vegetarian, (VG) = vegan and note in description
- If a dish has no clear category, use null rather than guessing
- European price format uses comma as decimal separator (e.g., "13,90" = 13.90)
- Set overall_confidence based on worst individual item confidence
- Include menu_language in parse_notes (e.g., "Menu language: Dutch")`;
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

  // Ensure items have correct type discriminator and required defaults
  if (Array.isArray(parsed.items)) {
    parsed.items = parsed.items.map(item => {
      const patched = { ...item, type: item.type || expectedType };
      // Ensure by_the_glass has a boolean value for wine items
      if (expectedType === 'wine' && typeof patched.by_the_glass !== 'boolean') {
        patched.by_the_glass = false;
      }
      return patched;
    });
  }

  const result = schema.safeParse(parsed);

  if (result.success) {
    result.data.items = sanitizeMenuItems(result.data.items);
    return result.data;
  }

  // Best-effort: sanitize what we have and coerce to minimum required shape
  logger.warn('MenuParsing', `Schema validation failed, using best-effort: ${result.error.message}`);

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = sanitizeMenuItems(rawItems.map(item => {
    const patched = {
      ...item,
      type: item.type || expectedType,
      name: item.name || 'Unknown item',
      confidence: item.confidence || 'low'
    };
    // Ensure by_the_glass has a boolean value for wine items
    if (expectedType === 'wine' && typeof patched.by_the_glass !== 'boolean') {
      patched.by_the_glass = false;
    }
    return patched;
  }));

  return {
    items,
    overall_confidence: 'low',
    parse_notes: parsed.parse_notes || 'Response did not fully match expected schema'
  };
}
