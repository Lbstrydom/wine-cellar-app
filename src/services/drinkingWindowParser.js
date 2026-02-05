/**
 * @fileoverview Drinking window extraction from wine review text.
 * Supports multiple formats including English, French, and Italian patterns.
 * @module services/drinkingWindowParser
 */

/**
 * Drinking window patterns for extraction from text.
 * Each pattern has a regex and an extract function.
 */
const DRINKING_WINDOW_PATTERNS = [
  // "Drink 2024-2030" or "Drink 2024 - 2030"
  {
    pattern: /drink\s*(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Best 2025-2035"
  {
    pattern: /best\s*(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Drink now through 2028" or "Drink now-2028"
  {
    pattern: /drink\s*now\s*(?:through|[-–—to]+)\s*(\d{4})/i,
    extract: (m) => ({ drink_from: new Date().getFullYear(), drink_by: parseInt(m[1]) })
  },
  // "Drink after 2026"
  {
    pattern: /drink\s*after\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: null })
  },
  // "Hold until 2025" or "Cellar until 2030"
  {
    pattern: /(?:hold|cellar)\s*(?:until|till|to)\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: null })
  },
  // "Drinking window: 2024-2030"
  {
    pattern: /drinking\s*window[:\s]+(\d{4})\s*[-–—to]+\s*(\d{4})/i,
    extract: (m) => ({ drink_from: parseInt(m[1]), drink_by: parseInt(m[2]) })
  },
  // "Ready now" or "Drink now" (not followed by "through" or range)
  {
    pattern: /(?:ready|drink)\s*now(?!\s*(?:through|[-–—to]))/i,
    extract: () => ({ drink_from: new Date().getFullYear(), drink_by: null })
  },
  // "Past its peak" or "Drink up" or "Drink soon"
  {
    pattern: /past\s*(?:its\s*)?peak|drink\s*up|drink\s*soon/i,
    extract: () => ({ drink_from: null, drink_by: new Date().getFullYear(), is_urgent: true })
  },
  // Relative: "Best in 3-7 years" (requires vintage)
  {
    pattern: /best\s*in\s*(\d+)\s*[-–—to]+\s*(\d+)\s*years?/i,
    extract: (m, vintage) => vintage ? {
      drink_from: vintage + parseInt(m[1]),
      drink_by: vintage + parseInt(m[2])
    } : null
  },
  // "Peak 2027" or "Peak: 2027"
  {
    pattern: /peak[:\s]+(\d{4})/i,
    extract: (m) => ({ peak: parseInt(m[1]) })
  },
  // Italian: "Bere entro il 2030" (drink by 2030)
  {
    pattern: /bere\s*entro\s*(?:il\s*)?(\d{4})/i,
    extract: (m) => ({ drink_from: null, drink_by: parseInt(m[1]) })
  },
  // French: "A boire jusqu'en 2028" (drink until 2028)
  {
    pattern: /[àa]\s*boire\s*jusqu[''u]?en\s*(\d{4})/i,
    extract: (m) => ({ drink_from: null, drink_by: parseInt(m[1]) })
  },
  // "Now - 2028" or "now-2030"
  {
    pattern: /now\s*[-–—]\s*(\d{4})/i,
    extract: (m) => ({ drink_from: new Date().getFullYear(), drink_by: parseInt(m[1]) })
  }
];

/**
 * Parse drinking window from text.
 * @param {string} text - Text to parse
 * @param {number|null} vintage - Wine vintage year for relative calculations
 * @returns {object|null} - { drink_from_year, drink_by_year, peak_year, raw_text, is_urgent } or null
 */
export function parseDrinkingWindow(text, vintage = null) {
  if (!text) return null;

  for (const { pattern, extract } of DRINKING_WINDOW_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const result = extract(match, vintage);
      if (result) {
        return {
          drink_from_year: result.drink_from || null,
          drink_by_year: result.drink_by || null,
          peak_year: result.peak || null,
          raw_text: match[0],
          is_urgent: result.is_urgent || false
        };
      }
    }
  }
  return null;
}

/**
 * Parse Vivino relative window format.
 * @param {string} text - Vivino maturity text
 * @param {number} vintage - Wine vintage
 * @returns {object|null} - { drink_from_year, drink_by_year, raw_text } or null
 */
export function parseVivinoWindow(text, vintage) {
  if (!text || !vintage) return null;

  // "Best in 3-7 years"
  const relativeMatch = text.match(/best\s*in\s*(\d+)\s*[-–—to]+\s*(\d+)\s*years?/i);
  if (relativeMatch) {
    return {
      drink_from_year: vintage + parseInt(relativeMatch[1]),
      drink_by_year: vintage + parseInt(relativeMatch[2]),
      raw_text: relativeMatch[0]
    };
  }

  // "Drink within 2 years"
  const withinMatch = text.match(/(?:drink|best)\s*within\s*(\d+)\s*years?/i);
  if (withinMatch) {
    const currentYear = new Date().getFullYear();
    return {
      drink_from_year: currentYear,
      drink_by_year: currentYear + parseInt(withinMatch[1]),
      raw_text: withinMatch[0]
    };
  }

  return null;
}
