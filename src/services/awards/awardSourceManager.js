/**
 * @fileoverview Database CRUD operations for award sources, competitions, and wine-award lookups.
 * Manages award_sources, known_competitions, and competition_awards tables.
 * @module services/awards/awardSourceManager
 */

import db, { awardsDb } from '../../db/index.js';
import { normalizeWineName, normalizeAward } from './awardStringUtils.js';

/**
 * Get or create an award source.
 * @param {string} competitionId - Competition identifier
 * @param {number} year - Competition year
 * @param {string} sourceUrl - Source URL or file path
 * @param {string} sourceType - 'pdf', 'webpage', 'magazine', 'csv', 'manual'
 * @returns {Promise<string>} Source ID
 */
export async function getOrCreateSource(competitionId, year, sourceUrl, sourceType) {
  const sourceId = `${competitionId}_${year}`;

  // Check if source exists
  const existing = await awardsDb.prepare('SELECT id FROM award_sources WHERE id = ?').get(sourceId);

  if (existing) {
    return sourceId;
  }

  // Get competition name
  const competition = await awardsDb.prepare('SELECT name FROM known_competitions WHERE id = ?').get(competitionId);
  const competitionName = competition?.name || competitionId;

  await awardsDb.prepare(`
    INSERT INTO award_sources (id, competition_id, competition_name, year, source_url, source_type, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(sourceId, competitionId, competitionName, year, sourceUrl, sourceType);

  return sourceId;
}

/**
 * Import awards from extracted text.
 * @param {string} sourceId - Award source ID
 * @param {Object[]} awards - Array of award objects
 * @returns {Promise<Object>} Import result
 */
export async function importAwards(sourceId, awards) {
  if (!awards || awards.length === 0) {
    return { imported: 0, skipped: 0, errors: [] };
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];

  // PostgreSQL ON CONFLICT DO NOTHING for duplicate entries
  const insertSQL = `INSERT INTO competition_awards (
    source_id, producer, wine_name, wine_name_normalized, vintage,
    award, award_normalized, category, region, extra_info
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT DO NOTHING`;

  for (const award of awards) {
    try {
      const result = await awardsDb.prepare(insertSQL).run(
        sourceId,
        award.producer || null,
        award.wine_name,
        normalizeWineName(award.wine_name),
        award.vintage || null,
        award.award,
        normalizeAward(award.award),
        award.category || null,
        award.region || null,
        award.extra_info ? JSON.stringify(award.extra_info) : null
      );

      if (result.changes > 0) {
        imported++;
      } else {
        skipped++; // Duplicate
      }
    } catch (err) {
      errors.push({ award: award.wine_name, error: err.message });
    }
  }

  // Update source stats
  await awardsDb.prepare(`
    UPDATE award_sources
    SET award_count = (SELECT COUNT(*) FROM competition_awards WHERE source_id = ?),
        status = 'completed'
    WHERE id = ?
  `).run(sourceId, sourceId);

  return { imported, skipped, errors };
}

/**
 * Get all award sources.
 * @returns {Promise<Object[]>} Award sources
 */
export async function getAwardSources() {
  return await awardsDb.prepare(`
    SELECT
      aws.*,
      kc.name as competition_display_name,
      kc.scope,
      kc.credibility
    FROM award_sources aws
    LEFT JOIN known_competitions kc ON kc.id = aws.competition_id
    ORDER BY aws.year DESC, aws.competition_name
  `).all();
}

/**
 * Get awards for a source.
 * @param {string} sourceId - Source ID
 * @returns {Promise<Object[]>} Awards
 */
export async function getSourceAwards(sourceId) {
  // Get awards from awards database
  const awards = await awardsDb.prepare(`
    SELECT ca.*
    FROM competition_awards ca
    WHERE ca.source_id = ?
    ORDER BY ca.award_normalized DESC, ca.wine_name
  `).all(sourceId);

  // Optimized: Batch load all matched wines in a single query instead of N+1
  const matchedWineIds = [...new Set(
    awards
      .filter(a => a.matched_wine_id)
      .map(a => a.matched_wine_id)
  )];

  // Build wine lookup map with single query
  const wineMap = new Map();
  if (matchedWineIds.length > 0) {
    const placeholders = matchedWineIds.map(() => '?').join(',');
    const sql = 'SELECT id, wine_name, vintage FROM wines WHERE id IN (' + placeholders + ')';
    const wines = await db.prepare(sql).all(...matchedWineIds);
    wines.forEach(w => wineMap.set(w.id, w));
  }

  return awards.map(award => {
    if (award.matched_wine_id) {
      const wine = wineMap.get(award.matched_wine_id);
      return {
        ...award,
        matched_wine_name: wine?.wine_name || null,
        matched_vintage: wine?.vintage || null
      };
    }
    return { ...award, matched_wine_name: null, matched_vintage: null };
  });
}

/**
 * Get awards for a wine from the local database.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object[]>} Matching awards
 */
export async function getWineAwards(wineId) {
  return await awardsDb.prepare(`
    SELECT
      ca.*,
      aws.competition_name,
      aws.year as competition_year,
      kc.credibility
    FROM competition_awards ca
    JOIN award_sources aws ON aws.id = ca.source_id
    LEFT JOIN known_competitions kc ON kc.id = aws.competition_id
    WHERE ca.matched_wine_id = ?
    ORDER BY aws.year DESC, ca.award_normalized DESC
  `).all(wineId);
}

/**
 * Delete an award source and its awards.
 * @param {string} sourceId - Source ID
 * @returns {Promise<boolean>} Success
 */
export async function deleteSource(sourceId) {
  await awardsDb.prepare('DELETE FROM competition_awards WHERE source_id = ?').run(sourceId);
  const result = await awardsDb.prepare('DELETE FROM award_sources WHERE id = ?').run(sourceId);
  return result.changes > 0;
}

/**
 * Get all known competitions.
 * @returns {Promise<Object[]>} Competitions
 */
export async function getKnownCompetitions() {
  return await awardsDb.prepare(`
    SELECT * FROM known_competitions ORDER BY name
  `).all();
}

/**
 * Add a custom competition.
 * @param {Object} competition - Competition data
 * @returns {Promise<string>} Competition ID
 */
export async function addCompetition(competition) {
  const id = competition.id || competition.name.toLowerCase().replaceAll(/\s+/g, '_');

  await awardsDb.prepare(`
    INSERT INTO known_competitions (id, name, short_name, country, scope, website, award_types, credibility, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      country = EXCLUDED.country,
      scope = EXCLUDED.scope,
      website = EXCLUDED.website,
      award_types = EXCLUDED.award_types,
      credibility = EXCLUDED.credibility,
      notes = EXCLUDED.notes
  `).run(
    id,
    competition.name,
    competition.short_name || null,
    competition.country || null,
    competition.scope || 'regional',
    competition.website || null,
    competition.award_types ? JSON.stringify(competition.award_types) : null,
    competition.credibility || 0.85,
    competition.notes || null
  );

  return id;
}
