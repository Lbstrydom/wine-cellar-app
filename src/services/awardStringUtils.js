/**
 * @fileoverview Pure string utility functions for award name normalization and similarity.
 * No external dependencies - operates only on string inputs.
 * @module services/awardStringUtils
 */

/**
 * Normalize wine name for matching.
 * @param {string} name - Wine name
 * @returns {string} Normalized name
 */
export function normalizeWineName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replaceAll(/['\u2018\u2019]/g, "'")  // Normalize quotes (', ', ')
    .replaceAll(/["\u201C\u201D]/g, '"')  // Normalize quotes (", ", ")
    .replaceAll(/[\u2013\u2014]/g, '-')  // Normalize dashes
    .replaceAll(/\s+/g, ' ')  // Normalize whitespace
    .replaceAll(/[^\w\s'-]/g, '')  // Remove special chars except apostrophes and hyphens
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1).
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (1 = identical)
 */
export function calculateSimilarity(a, b) {
  const normA = normalizeWineName(a);
  const normB = normalizeWineName(b);

  if (normA === normB) return 1;
  if (!normA || !normB) return 0;

  const distance = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);

  return 1 - (distance / maxLen);
}

/**
 * Normalize award type to standard codes.
 * @param {string} award - Raw award text
 * @returns {string} Normalized award code
 */
export function normalizeAward(award) {
  if (!award) return 'unknown';

  const lower = award.toLowerCase().trim();

  // Trophy/Best in show
  if (lower.includes('trophy') || lower.includes('best in show') || lower.includes('best in class')) {
    return 'trophy';
  }
  // Double gold / Grand gold
  if (lower.includes('double gold') || lower.includes('grand gold')) {
    return 'double_gold';
  }
  // Gold
  if (lower.includes('gold') && !lower.includes('silver')) {
    return 'gold';
  }
  // Silver
  if (lower.includes('silver')) {
    return 'silver';
  }
  // Bronze
  if (lower.includes('bronze')) {
    return 'bronze';
  }
  // Platinum
  if (lower.includes('platinum')) {
    return 'platinum';
  }
  // Top 10
  if (lower.includes('top 10') || lower.includes('top ten')) {
    return 'top_10';
  }
  // Stars (Platter's style)
  const starMatch = lower.match(/(\d(?:\.\d)?)\s*star/);
  if (starMatch) {
    return `${starMatch[1]}_star`;
  }
  // Points
  const pointMatch = lower.match(/(\d{2,3})\s*(?:points?|pts?)/);
  if (pointMatch) {
    return `${pointMatch[1]}_points`;
  }

  return lower.replaceAll(/\s+/g, '_').substring(0, 30);
}
