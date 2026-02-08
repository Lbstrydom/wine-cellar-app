/**
 * @fileoverview Input sanitization for AI prompts.
 * Prevents prompt injection attacks and cleans user input.
 * @module services/inputSanitizer
 */

import logger from '../utils/logger.js';

/**
 * Characters and patterns that could be used for prompt injection.
 * @type {Object}
 */
const INJECTION_PATTERNS = {
  // System prompt manipulation attempts
  systemPrompt: /(?:system\s*(?:prompt|message|instruction)|<\/?system>|<<SYS>>|<<\/SYS>>)/gi,

  // Role manipulation
  roleSwitch: /(?:(?:^|\n)\s*(?:assistant|user|human|ai|claude):|<\/?(?:assistant|user|human|ai)>)/gi,

  // Instruction override attempts
  instructionOverride: /(?:ignore\s+(?:previous|above|all)|forget\s+(?:previous|above|everything)|disregard\s+(?:instructions|rules)|new\s+instructions?:)/gi,

  // XML/HTML injection
  xmlInjection: /<(?:script|style|iframe|object|embed|form|input|button|meta|link|base)[^>]*>/gi,

  // Markdown heading that could be mistaken for structure
  markdownHeading: /^#{1,6}\s+(?:system|instructions?|rules?|context):/gim,

  // JSON structure manipulation
  jsonManipulation: /(?:"role"\s*:\s*"(?:system|assistant)"|"content"\s*:\s*")/gi
};

/**
 * Maximum lengths for different input types.
 * @type {Object}
 */
const MAX_LENGTHS = {
  wineName: 200,
  dishDescription: 500,
  chatMessage: 2000,
  tastingNote: 3000,
  menuText: 5000,
  menuItemName: 300,
  menuItemField: 200,
  menuItemDescription: 1000,
  generalInput: 5000
};

/**
 * Sanitize a string by removing potential injection patterns.
 * @param {string} input - User input to sanitize
 * @param {Object} options - Sanitization options
 * @param {number} options.maxLength - Maximum allowed length
 * @param {boolean} options.allowMarkdown - Whether to allow markdown
 * @param {boolean} options.preserveNewlines - Whether to keep newlines
 * @returns {string} Sanitized string
 */
export function sanitize(input, options = {}) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const {
    maxLength = MAX_LENGTHS.generalInput,
    allowMarkdown = false,
    preserveNewlines = true
  } = options;

  let result = input;

  // Truncate to max length
  if (result.length > maxLength) {
    result = result.substring(0, maxLength);
  }

  // Remove null bytes and control characters (except newline, tab)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Check and warn about injection patterns (don't remove, but log)
  for (const [patternName, pattern] of Object.entries(INJECTION_PATTERNS)) {
    if (pattern.test(result)) {
      logger.warn('Sanitizer', `Potential ${patternName} pattern detected in input`);
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
    }
  }

  // Remove role manipulation patterns
  result = result.replace(INJECTION_PATTERNS.roleSwitch, '');

  // Remove instruction override attempts
  result = result.replace(INJECTION_PATTERNS.instructionOverride, '[filtered]');

  // Remove XML/HTML injection
  result = result.replace(INJECTION_PATTERNS.xmlInjection, '');

  // Handle newlines based on option
  if (!preserveNewlines) {
    result = result.replace(/\n+/g, ' ');
  }

  // Escape special characters if not allowing markdown
  if (!allowMarkdown) {
    result = escapeSpecialChars(result);
  }

  // Trim whitespace
  result = result.trim();

  return result;
}

/**
 * Escape special characters that could affect prompt parsing.
 * @param {string} input - String to escape
 * @returns {string} Escaped string
 */
function escapeSpecialChars(input) {
  return input
    .replace(/`/g, "'")  // Replace backticks
    .replace(/\$/g, 'S') // Replace dollar signs (could be template literals)
    .replace(/{/g, '(')  // Replace curly braces
    .replace(/}/g, ')');
}

/**
 * Sanitize a wine name for use in prompts.
 * @param {string} wineName - Wine name to sanitize
 * @returns {string} Sanitized wine name
 */
export function sanitizeWineName(wineName) {
  return sanitize(wineName, {
    maxLength: MAX_LENGTHS.wineName,
    allowMarkdown: false,
    preserveNewlines: false
  });
}

/**
 * Sanitize a dish description for sommelier prompts.
 * @param {string} dish - Dish description to sanitize
 * @returns {string} Sanitized dish description
 */
export function sanitizeDishDescription(dish) {
  return sanitize(dish, {
    maxLength: MAX_LENGTHS.dishDescription,
    allowMarkdown: false,
    preserveNewlines: false
  });
}

/**
 * Sanitize a chat message for zone chat or other AI conversations.
 * @param {string} message - Chat message to sanitize
 * @returns {string} Sanitized message
 */
export function sanitizeChatMessage(message) {
  return sanitize(message, {
    maxLength: MAX_LENGTHS.chatMessage,
    allowMarkdown: true,
    preserveNewlines: true
  });
}

/**
 * Sanitize a tasting note.
 * @param {string} note - Tasting note to sanitize
 * @returns {string} Sanitized note
 */
export function sanitizeTastingNote(note) {
  return sanitize(note, {
    maxLength: MAX_LENGTHS.tastingNote,
    allowMarkdown: true,
    preserveNewlines: true
  });
}

/**
 * Sanitize an array of wine objects for inclusion in prompts.
 * @param {Array} wines - Array of wine objects
 * @returns {Array} Wines with sanitized string fields
 */
export function sanitizeWineList(wines) {
  if (!Array.isArray(wines)) return [];

  return wines.map(wine => ({
    ...wine,
    wine_name: wine.wine_name ? sanitizeWineName(wine.wine_name) : '',
    style: wine.style ? sanitize(wine.style, { maxLength: 100 }) : '',
    region: wine.region ? sanitize(wine.region, { maxLength: 100 }) : '',
    country: wine.country ? sanitize(wine.country, { maxLength: 50 }) : '',
    grapes: wine.grapes ? sanitize(wine.grapes, { maxLength: 200 }) : '',
    reduce_reason: wine.reduce_reason ? sanitize(wine.reduce_reason, { maxLength: 200 }) : ''
  }));
}

/**
 * Sanitize free-text menu input (pasted/typed wine list or dish list).
 * Preserves newlines since each line may be a separate item.
 * Uses allowMarkdown to avoid escaping currency symbols ($25 → $25, not S25).
 * @param {string} text - Raw menu text from user
 * @returns {string} Sanitized menu text
 */
export function sanitizeMenuText(text) {
  return sanitize(text, {
    maxLength: MAX_LENGTHS.menuText,
    allowMarkdown: true,
    preserveNewlines: true
  });
}

/**
 * Sanitize a single string field from a parsed menu item.
 * Uses allowMarkdown to preserve currency symbols in OCR output.
 * @param {*} value - Field value (only strings are sanitized)
 * @param {number} maxLength - Maximum allowed length
 * @returns {*} Sanitized string, or original value if not a string
 */
function sanitizeMenuField(value, maxLength) {
  if (typeof value !== 'string') return value;
  return sanitize(value, {
    maxLength,
    allowMarkdown: true,
    preserveNewlines: false
  });
}

/**
 * Sanitize an array of parsed menu items (wine or dish) from OCR.
 * Cleans all string fields on each item while preserving non-string
 * fields (numbers, booleans) unchanged.
 * @param {Array<Object>} items - Parsed menu items from Claude Vision
 * @returns {Array<Object>} Items with sanitized string fields
 */
export function sanitizeMenuItems(items) {
  if (!Array.isArray(items)) return [];

  return items.map(item => {
    const cleaned = { ...item };

    // Shared fields
    cleaned.name = sanitizeMenuField(cleaned.name, MAX_LENGTHS.menuItemName);
    cleaned.currency = sanitizeMenuField(cleaned.currency, 10);

    // Wine-specific string fields
    cleaned.colour = sanitizeMenuField(cleaned.colour, MAX_LENGTHS.menuItemField);
    cleaned.style = sanitizeMenuField(cleaned.style, MAX_LENGTHS.menuItemField);
    cleaned.region = sanitizeMenuField(cleaned.region, MAX_LENGTHS.menuItemField);

    // Dish-specific string fields
    cleaned.description = sanitizeMenuField(cleaned.description, MAX_LENGTHS.menuItemDescription);
    cleaned.category = sanitizeMenuField(cleaned.category, MAX_LENGTHS.menuItemField);

    return cleaned;
  });
}

/**
 * Validate that input doesn't exceed safe thresholds.
 * @param {string} input - Input to validate
 * @param {string} inputType - Type of input for length checking
 * @returns {Object} Validation result { valid, errors }
 */
export function validateInput(input, inputType = 'generalInput') {
  const errors = [];
  const maxLength = MAX_LENGTHS[inputType] || MAX_LENGTHS.generalInput;

  if (!input) {
    errors.push('Input is required');
    return { valid: false, errors };
  }

  if (typeof input !== 'string') {
    errors.push('Input must be a string');
    return { valid: false, errors };
  }

  if (input.length > maxLength) {
    errors.push(`Input exceeds maximum length of ${maxLength} characters`);
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [];
  for (const [patternName, pattern] of Object.entries(INJECTION_PATTERNS)) {
    pattern.lastIndex = 0; // Reset for global patterns
    if (pattern.test(input)) {
      suspiciousPatterns.push(patternName);
    }
  }

  if (suspiciousPatterns.length > 0) {
    errors.push(`Suspicious patterns detected: ${suspiciousPatterns.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: suspiciousPatterns.length > 0 ? [`Contains patterns: ${suspiciousPatterns.join(', ')}`] : []
  };
}

/**
 * Create a safe context object for AI prompts.
 * Strips any potentially dangerous properties.
 * @param {Object} context - Context object
 * @returns {Object} Safe context object
 */
export function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};

  // Allow only specific safe keys
  const safeKeys = [
    'wineCount', 'zoneCount', 'fridgeCount', 'cellarCount',
    'totalBottles', 'topGrapes', 'topCountries', 'vintageRange',
    'zoneId', 'zoneName', 'occasion', 'preferences'
  ];

  const safe = {};
  for (const key of safeKeys) {
    if (context[key] !== undefined) {
      if (typeof context[key] === 'string') {
        safe[key] = sanitize(context[key], { maxLength: 200 });
      } else if (typeof context[key] === 'number') {
        safe[key] = context[key];
      } else if (Array.isArray(context[key])) {
        safe[key] = context[key].slice(0, 10).map(v =>
          typeof v === 'string' ? sanitize(v, { maxLength: 100 }) : v
        );
      }
    }
  }

  return safe;
}
