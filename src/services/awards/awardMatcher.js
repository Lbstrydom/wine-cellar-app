/**
 * @fileoverview Award-to-wine matching logic.
 * Handles finding, auto-matching, linking, unlinking, and searching awards against cellar wines.
 * @module services/awards/awardMatcher
 */

import db, { awardsDb } from '../../db/index.js';
import { normalizeWineName, calculateSimilarity } from './awardStringUtils.js';

/**
 * Check if producer names match.
 * @param {string} awardProducer - Producer from award
 * @param {string} cellarWineName - Wine name from cellar
 * @returns {boolean} True if producer seems to match
 */
function producerMatches(awardProducer, cellarWineName) {
  if (!awardProducer) return true; // No producer to match

  const normProducer = normalizeWineName(awardProducer);
  const normWine = normalizeWineName(cellarWineName);

  // Check if producer name appears in wine name
  const producerWords = normProducer.split(' ');
  const wineWords = normWine.split(' ');

  // At least half the producer words should appear in wine name
  const matchCount = producerWords.filter(pw =>
    wineWords.some(ww => ww === pw || calculateSimilarity(pw, ww) > 0.8)
  ).length;

  return matchCount >= Math.ceil(producerWords.length / 2);
}

/**
 * Find matching wines in cellar for an award.
 * @param {Object} award - Award entry
 * @returns {Promise<Object[]>} Array of potential matches with scores
 */
export async function findMatches(award) {
  const wines = await db.prepare(`
    SELECT id, wine_name, vintage, country, region
    FROM wines
  `).all();

  const matches = [];
  const awardNorm = normalizeWineName(award.wine_name);

  for (const wine of wines) {
    // Check vintage if specified
    if (award.vintage && wine.vintage && award.vintage !== wine.vintage) {
      continue;
    }

    // Check producer match
    if (award.producer && !producerMatches(award.producer, wine.wine_name)) {
      continue;
    }

    // Calculate name similarity
    const wineNorm = normalizeWineName(wine.wine_name);
    const similarity = calculateSimilarity(awardNorm, wineNorm);

    // Also try matching just the wine portion (without producer)
    const awardWords = awardNorm.split(' ');
    const wineWords = wineNorm.split(' ');

    // Token overlap score
    const commonTokens = awardWords.filter(aw =>
      wineWords.some(ww => ww === aw || (aw.length > 3 && ww.includes(aw)))
    ).length;
    const tokenScore = commonTokens / Math.max(awardWords.length, wineWords.length);

    // Combined score
    const score = Math.max(similarity, tokenScore);

    if (score >= 0.4) {  // Threshold for potential match
      matches.push({
        wine,
        score,
        matchType: score >= 0.9 ? 'exact' : 'fuzzy'
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches.slice(0, 5);  // Top 5 matches
}

/**
 * Auto-match imported awards to cellar wines.
 * @param {string} sourceId - Award source ID
 * @returns {Promise<Object>} Match results
 */
export async function autoMatchAwards(sourceId) {
  const unmatched = await awardsDb.prepare(`
    SELECT id, producer, wine_name, wine_name_normalized, vintage
    FROM competition_awards
    WHERE source_id = ? AND matched_wine_id IS NULL
  `).all(sourceId);

  let exactMatches = 0;
  let fuzzyMatches = 0;
  let noMatches = 0;

  for (const award of unmatched) {
    const matches = await findMatches(award);

    if (matches.length === 0) {
      noMatches++;
      continue;
    }

    const best = matches[0];

    // Only auto-match high confidence exact matches
    if (best.matchType === 'exact' && best.score >= 0.9) {
      await awardsDb.prepare(`
        UPDATE competition_awards
        SET matched_wine_id = ?, match_type = ?, match_confidence = ?
        WHERE id = ?
      `).run(best.wine.id, 'exact', best.score, award.id);
      exactMatches++;
    } else if (best.score >= 0.7) {
      // Mark as fuzzy match but don't auto-link (needs review)
      await awardsDb.prepare(`
        UPDATE competition_awards
        SET matched_wine_id = ?, match_type = ?, match_confidence = ?
        WHERE id = ?
      `).run(null, 'fuzzy', best.score, award.id);
      fuzzyMatches++;
    } else {
      noMatches++;
    }
  }

  return { exactMatches, fuzzyMatches, noMatches, total: unmatched.length };
}

/**
 * Manually link an award to a wine.
 * @param {number} awardId - Award ID
 * @param {number} wineId - Wine ID
 * @returns {Promise<boolean>} Success
 */
export async function linkAwardToWine(awardId, wineId) {
  const result = await awardsDb.prepare(`
    UPDATE competition_awards
    SET matched_wine_id = ?, match_type = 'manual', match_confidence = 1.0
    WHERE id = ?
  `).run(wineId, awardId);

  return result.changes > 0;
}

/**
 * Unlink an award from a wine.
 * @param {number} awardId - Award ID
 * @returns {Promise<boolean>} Success
 */
export async function unlinkAward(awardId) {
  const result = await awardsDb.prepare(`
    UPDATE competition_awards
    SET matched_wine_id = NULL, match_type = NULL, match_confidence = NULL
    WHERE id = ?
  `).run(awardId);

  return result.changes > 0;
}

/**
 * Search for awards matching a wine name (for wines not yet matched).
 * @param {string} wineName - Wine name to search
 * @param {number|null} vintage - Optional vintage
 * @returns {Promise<Object[]>} Potential matching awards
 */
export async function searchAwards(wineName, vintage = null) {
  const normalized = normalizeWineName(wineName);

  // Get all unmatched awards
  const awards = await awardsDb.prepare(`
    SELECT
      ca.*,
      aws.competition_name,
      aws.year as competition_year
    FROM competition_awards ca
    JOIN award_sources aws ON aws.id = ca.source_id
    WHERE ca.matched_wine_id IS NULL
    ${vintage ? 'AND (ca.vintage IS NULL OR ca.vintage = ?)' : ''}
  `).all(vintage ? [vintage] : []);

  // Score and filter
  const matches = [];

  for (const award of awards) {
    const similarity = calculateSimilarity(normalized, award.wine_name_normalized);

    if (similarity >= 0.5) {
      matches.push({
        ...award,
        similarity
      });
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);

  return matches.slice(0, 10);
}
