/**
 * @fileoverview Prompt building and response parsing for award extraction.
 * Handles Claude API prompt construction and JSON response parsing with fallback strategies.
 * @module services/awardParser
 */

import logger from '../utils/logger.js';

/**
 * Build prompt for award extraction from text content.
 * @param {string} content - Text content
 * @param {string} competitionId - Competition ID
 * @param {number} year - Year
 * @returns {string} Prompt
 */
export function buildExtractionPrompt(content, competitionId, year) {
  return `Extract wine awards from this content for the ${competitionId} ${year} competition.

IMPORTANT: This content may be in German, English, or another language. The content may also include
introductory text, forewords, or other preamble before the actual awards list. Focus ONLY on extracting
the actual wine awards list, ignoring all introductory sections.

CONTENT:
${content.substring(0, 60000)}

---

TASK: Extract all wine awards found in this content, skipping any preamble/introduction.

For each award entry, extract:
- producer: Winery/producer name (if separate from wine name)
- wine_name: Full wine name (may include producer)
- vintage: Year as integer (null if not specified)
- award: Award level (Gold, Silver, Bronze, Trophy, Double Gold, etc.)
- category: Wine category if specified (e.g., "Pinotage", "Cabernet Sauvignon", "Sparkling")
- region: Region if specified

Return ONLY valid JSON:
{
  "awards": [
    {
      "producer": "Example Estate",
      "wine_name": "Example Estate Reserve Pinotage",
      "vintage": 2022,
      "award": "Gold",
      "category": "Pinotage",
      "region": "Stellenbosch"
    }
  ],
  "extraction_notes": "Summary of extraction"
}

ADDITIONAL NOTES:
- Content may be in German or other languages - extract regardless of language
- Common German awards: "Grosses Gold" (Grand Gold), "Gold", "Silber" (Silver), "Bronze"
- Skip introductory pages, forewords, explanatory text, competition rules, etc.
- Look for structured lists or tables of wine names with award levels
- When in doubt about whether text is awards vs. introduction, prefer skipping it

RULES:
- Extract ALL awards visible in the content
- Be thorough - don't miss entries
- If wine name includes producer, that's fine
- Set vintage to null if not specified
- Use exact award names as shown (Gold, Silver, Bronze, Trophy, etc.)
- If content is a table, preserve the structure
- If no awards found: {"awards": [], "extraction_notes": "No awards found"}`;
}

/**
 * Build prompt for PDF award extraction.
 * @param {string} competitionId - Competition ID
 * @param {number} year - Year
 * @returns {string} Prompt
 */
export function buildPDFExtractionPrompt(competitionId, year) {
  return `This is a PDF from the ${competitionId} ${year} wine competition/guide.
IMPORTANT: This document may be in German, English, or another language. It may contain introductory
text, forewords, competition rules, or other preamble before the actual awards list. Focus ONLY on
extracting the actual wine awards, ignoring all introductory sections.


TASK: Extract all wine awards from this document.

For each award entry, extract:
- producer: Winery/producer name (if separate from wine name)
- wine_name: Full wine name (may include producer)
- vintage: Year as integer (null if not specified)
- award: Award level (Gold, Silver, Bronze, Trophy, Double Gold, 5 Stars, etc.)
ADDITIONAL NOTES:
- Content may be in German or other languages - extract regardless of language
- Common German awards: "Grosses Gold" (Grand Gold), "Gold", "Silber" (Silver), "Bronze"
- Skip introductory pages, forewords, explanatory text, competition rules, etc.
- Look for structured lists or tables of wine names with award levels
- When in doubt about whether section contains awards vs. introduction, prefer skipping it

- category: Wine category if specified
- region: Region if specified

Return ONLY valid JSON:
{
  "awards": [
    {
      "producer": "Example Estate",
      "wine_name": "Example Estate Reserve",
      "vintage": 2022,
      "award": "Gold",
      "category": "Red Blend",
      "region": "Western Cape"
    }
  ],
  "extraction_notes": "Summary of what was found"
}

RULES:
- Extract ALL awards visible in the document
- Read every page carefully
- Preserve the exact wine names as listed
- Set vintage to null if not specified
- Use exact award names as shown
- If document has multiple sections (Gold, Silver, Bronze), process all
- If no awards found: {"awards": [], "extraction_notes": "No awards found"}`;
}

/**
 * Salvage awards from truncated JSON response.
 * Extracts individual award objects even if the overall JSON is malformed.
 * @param {string} text - Truncated JSON text
 * @returns {Object[]} Salvaged awards
 */
export function salvagePartialJSON(text) {
  const awards = [];
  // Match individual award objects containing wine_name and award fields
  const awardPattern = /\{\s*"[^"]*":\s*"[^"]*"[^}]*?"wine_name"\s*:\s*"[^"]*"[^}]*?"award"\s*:\s*"[^"]*"[^}]*?\}/g;

  const matches = text.match(awardPattern) || [];

  for (const match of matches) {
    try {
      const award = JSON.parse(match);
      if (award.wine_name && award.award) {
        awards.push(award);
      }
    } catch {
      // Skip malformed individual awards - parse failures expected for partial JSON
      continue;
    }
  }

  return awards;
}

/**
 * Parse awards extraction response.
 * @param {string} text - Response text
 * @returns {Object} Parsed result
 */
export function parseAwardsResponse(text) {
  // Try direct parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.awards && Array.isArray(parsed.awards)) {
      return parsed;
    }
  } catch {
    // Direct parse failed - continue to fallback parsing methods
  }

  // Try code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.awards && Array.isArray(parsed.awards)) {
        return parsed;
      }
    } catch {
      // Code block parse failed - try other patterns
    }
  }

  // Try finding JSON object
  const objectMatch = text.match(/\{[\s\S]*?"awards"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed.awards && Array.isArray(parsed.awards)) {
        return parsed;
      }
    } catch {
      // JSON object parse failed - try salvage as last resort
    }
  }

  // Last resort: Salvage individual awards from truncated response
  const salvaged = salvagePartialJSON(text);
  if (salvaged.length > 0) {
    logger.info('Awards', `Salvaged ${salvaged.length} awards from truncated response`);
    return { awards: salvaged, extraction_notes: `Salvaged ${salvaged.length} awards from truncated response` };
  }

  logger.error('Awards', `Failed to parse response: ${text.substring(0, 300)}`);
  return { awards: [], extraction_notes: 'Failed to parse response' };
}
