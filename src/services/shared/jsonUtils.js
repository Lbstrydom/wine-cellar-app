/**
 * @fileoverview Shared JSON repair and extraction utilities for LLM responses.
 * Consolidates JSON extraction logic previously duplicated across search tiers.
 * @module services/shared/jsonUtils
 */

import { extractJsonFromText } from './auditUtils.js';

// Re-export for convenience (single import point for consumers)
export { extractJsonFromText };

/**
 * Repair truncated JSON from LLM max_tokens cutoff.
 * Closes unclosed brackets/braces and removes trailing incomplete values.
 * @param {string} jsonStr - Potentially malformed JSON
 * @returns {string} Repaired JSON string
 */
export function repairJson(jsonStr) {
  let repaired = jsonStr.trim();

  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  // Remove trailing incomplete values
  repaired = repaired.replace(/,\s*"[^"]*$/, '');
  repaired = repaired.replace(/:\s*"[^"]*$/, ': null');
  repaired = repaired.replace(/:\s*[\d.]+$/, ': null');
  repaired = repaired.replace(/,\s*$/, '');

  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  return repaired;
}

/**
 * Extract JSON from LLM response text with repair fallback.
 * Tries extractJsonFromText first (handles fences, balanced brace parsing),
 * then falls back to regex + repairJson for truncated output.
 * @param {string} text - Raw LLM response text
 * @returns {Object} Parsed JSON object
 * @throws {Error} If no valid JSON can be recovered
 */
export function extractJsonWithRepair(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('No JSON found: empty response text');
  }

  // Strategy 1: Use the robust balanced-brace parser from auditUtils
  try {
    return extractJsonFromText(text);
  } catch {
    // Fall through to repair strategy
  }

  // Strategy 2: Greedy regex match + brace repair for truncated JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Try repairing truncated JSON
      try {
        return JSON.parse(repairJson(jsonMatch[0]));
      } catch {
        // Fall through to final error
      }
    }
  }

  throw new Error('No JSON found in response text');
}
