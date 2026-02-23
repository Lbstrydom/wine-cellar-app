/**
 * @fileoverview Shared move analysis utilities.
 * Extracted from moveGuide.js (frontend) and cellarAnalysis.js (backend)
 * so both sides can use the same swap/dependency detection logic.
 * @module services/cellar/moveUtils
 */

/**
 * Detect swap pairs (A→B + B→A) in a list of moves.
 * @param {Array<{from: string, to: string, type?: string}>} moves - Move objects
 * @param {Object} [options]
 * @param {string} [options.typeFilter] - Only consider moves with this type (e.g., 'move')
 * @returns {Map<number, number>} Map of index → partner index
 */
export function detectSwapPairs(moves, { typeFilter = null } = {}) {
  const partners = new Map();
  for (let i = 0; i < moves.length; i++) {
    if (partners.has(i)) continue;
    if (typeFilter && moves[i]?.type !== typeFilter) continue;
    for (let j = i + 1; j < moves.length; j++) {
      if (partners.has(j)) continue;
      if (typeFilter && moves[j]?.type !== typeFilter) continue;
      if (moves[i].from === moves[j].to && moves[i].to === moves[j].from) {
        partners.set(i, j);
        partners.set(j, i);
        break;
      }
    }
  }
  return partners;
}

/**
 * Check whether any move targets overlap with move sources (dependency chain).
 * If true, moves cannot be executed in arbitrary order — they require
 * a 2-phase transaction (clear all sources, then set all targets).
 * @param {Array<{from: string, to: string, type?: string}>} suggestions - Move suggestions
 * @returns {boolean} True if moves have interdependencies
 */
export function hasMoveDependencies(suggestions) {
  const moveSuggestions = Array.isArray(suggestions)
    ? suggestions.filter(s => s?.type === 'move')
    : [];
  if (moveSuggestions.length === 0) return false;
  const sources = new Set(moveSuggestions.map(m => m.from));
  const targets = new Set(moveSuggestions.map(m => m.to));
  return [...sources].some(slot => targets.has(slot));
}
