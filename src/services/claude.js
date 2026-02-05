/**
 * @fileoverview Barrel re-export for Claude API integrations.
 * This file preserves backward compatibility for existing consumers.
 * Actual implementations have been split into:
 * - claudeClient.js  (shared Anthropic client)
 * - sommelier.js     (pairing recommendations and chat)
 * - wineParsing.js   (wine label/text parsing)
 * - ratingExtraction.js (rating search and extraction)
 * @module services/claude
 */

export { getSommelierRecommendation, continueSommelierChat } from './sommelier.js';
export { parseWineFromText, parseWineFromImage } from './wineParsing.js';
export { fetchWineRatings, saveExtractedWindows } from './ratingExtraction.js';
