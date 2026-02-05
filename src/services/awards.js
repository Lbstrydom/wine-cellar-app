/**
 * @fileoverview Barrel re-export for the awards service modules.
 * Preserves backward compatibility for existing consumers.
 * @module services/awards
 */

// String utilities
export { normalizeWineName, calculateSimilarity } from './awardStringUtils.js';

// Award-to-wine matching
export { findMatches, autoMatchAwards, linkAwardToWine, unlinkAward, searchAwards } from './awardMatcher.js';

// PDF extraction
export { extractFromPDF } from './awardExtractorPDF.js';

// Web / text extraction
export { extractFromWebpage, extractFromText } from './awardExtractorWeb.js';

// Source and competition management
export {
  getOrCreateSource,
  importAwards,
  getAwardSources,
  getSourceAwards,
  getWineAwards,
  deleteSource,
  getKnownCompetitions,
  addCompetition
} from './awardSourceManager.js';
