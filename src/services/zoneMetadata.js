/**
 * @fileoverview Service for zone metadata access and management.
 * Provides intent descriptions for cellar zones, merging DB with code defaults.
 * @module services/zoneMetadata
 */

import db from '../db/index.js';
import { getZoneById, CELLAR_ZONES } from '../config/cellarZones.js';

/**
 * Get zone metadata from database.
 * @param {string} zoneId - Zone identifier
 * @returns {Promise<Object|null>} Zone metadata or null if not found
 */
export async function getZoneMetadata(zoneId) {
  return await db.prepare('SELECT * FROM zone_metadata WHERE zone_id = ?').get(zoneId) || null;
}

/**
 * Get all zone metadata.
 * @returns {Promise<Array>} All zone metadata records
 */
export async function getAllZoneMetadata() {
  return await db.prepare('SELECT * FROM zone_metadata ORDER BY zone_id').all();
}

/**
 * Get zone with merged code config and database metadata.
 * @param {string} zoneId - Zone identifier
 * @returns {Promise<Object|null>} Zone with intent metadata
 */
export async function getZoneWithIntent(zoneId) {
  const codeZone = getZoneById(zoneId);
  if (!codeZone) return null;

  const dbMeta = await getZoneMetadata(zoneId);

  return {
    ...codeZone,
    intent: dbMeta ? {
      purpose: dbMeta.purpose,
      styleRange: dbMeta.style_range,
      servingTemp: dbMeta.serving_temp,
      agingAdvice: dbMeta.aging_advice,
      pairingHints: safeJsonParse(dbMeta.pairing_hints, []),
      exampleWines: safeJsonParse(dbMeta.example_wines, []),
      family: dbMeta.family,
      seasonalNotes: dbMeta.seasonal_notes,
      aiSuggestedAt: dbMeta.ai_suggested_at,
      userConfirmedAt: dbMeta.user_confirmed_at
    } : null
  };
}

/**
 * Get all zones with their intent metadata.
 * @returns {Promise<Array>} All zones with intent data
 */
export async function getAllZonesWithIntent() {
  const allMeta = await getAllZoneMetadata();
  const metaMap = new Map(allMeta.map(m => [m.zone_id, m]));

  return CELLAR_ZONES.zones.map(zone => {
    const dbMeta = metaMap.get(zone.id);
    return {
      ...zone,
      intent: dbMeta ? {
        purpose: dbMeta.purpose,
        styleRange: dbMeta.style_range,
        servingTemp: dbMeta.serving_temp,
        agingAdvice: dbMeta.aging_advice,
        pairingHints: safeJsonParse(dbMeta.pairing_hints, []),
        exampleWines: safeJsonParse(dbMeta.example_wines, []),
        family: dbMeta.family,
        seasonalNotes: dbMeta.seasonal_notes,
        aiSuggestedAt: dbMeta.ai_suggested_at,
        userConfirmedAt: dbMeta.user_confirmed_at
      } : null
    };
  });
}

/**
 * Update zone metadata (user edit or AI suggestion).
 * @param {string} zoneId - Zone identifier
 * @param {Object} updates - Metadata updates
 * @param {boolean} isAISuggestion - Whether this is from AI
 * @returns {Promise<Object>} Updated metadata
 */
export async function updateZoneMetadata(zoneId, updates, isAISuggestion = false) {
  const now = new Date().toISOString();

  // Build update statement dynamically
  const fields = [];
  const values = [];

  if (updates.purpose !== undefined) {
    fields.push('purpose = ?');
    values.push(updates.purpose);
  }
  if (updates.styleRange !== undefined) {
    fields.push('style_range = ?');
    values.push(updates.styleRange);
  }
  if (updates.servingTemp !== undefined) {
    fields.push('serving_temp = ?');
    values.push(updates.servingTemp);
  }
  if (updates.agingAdvice !== undefined) {
    fields.push('aging_advice = ?');
    values.push(updates.agingAdvice);
  }
  if (updates.pairingHints !== undefined) {
    fields.push('pairing_hints = ?');
    values.push(JSON.stringify(updates.pairingHints));
  }
  if (updates.exampleWines !== undefined) {
    fields.push('example_wines = ?');
    values.push(JSON.stringify(updates.exampleWines));
  }
  if (updates.family !== undefined) {
    fields.push('family = ?');
    values.push(updates.family);
  }
  if (updates.seasonalNotes !== undefined) {
    fields.push('seasonal_notes = ?');
    values.push(updates.seasonalNotes);
  }

  // Add timestamp based on source
  if (isAISuggestion) {
    fields.push('ai_suggested_at = ?');
    values.push(now);
  } else {
    fields.push('user_confirmed_at = ?');
    values.push(now);
  }

  fields.push('updated_at = ?');
  values.push(now);
  values.push(zoneId);

  if (fields.length > 2) { // At least one actual update + timestamps
    await db.prepare(
      `UPDATE zone_metadata SET ${fields.join(', ')} WHERE zone_id = ?`
    ).run(...values);
  }

  return await getZoneMetadata(zoneId);
}

/**
 * Batch update zone metadata from AI suggestions.
 * Note: PostgreSQL does not support db.transaction() like SQLite.
 * For PostgreSQL, we execute updates sequentially.
 * @param {Array} suggestions - Array of { zoneId, ...updates }
 * @returns {Promise<number>} Number of zones updated
 */
export async function batchUpdateFromAI(suggestions) {
  let updated = 0;

  for (const suggestion of suggestions) {
    const { zoneId, ...updates } = suggestion;
    if (zoneId && Object.keys(updates).length > 0) {
      await updateZoneMetadata(zoneId, updates, true);
      updated++;
    }
  }

  return updated;
}

/**
 * Mark zone metadata as user-confirmed (no changes, just timestamp).
 * @param {string} zoneId - Zone identifier
 * @returns {Promise<Object>} Updated metadata
 */
export async function confirmZoneMetadata(zoneId) {
  const now = new Date().toISOString();
  await db.prepare(
    'UPDATE zone_metadata SET user_confirmed_at = ?, updated_at = ? WHERE zone_id = ?'
  ).run(now, now, zoneId);
  return await getZoneMetadata(zoneId);
}

/**
 * Get zones that need user review (AI suggested but not confirmed).
 * @returns {Promise<Array>} Zones with pending AI suggestions
 */
export async function getZonesNeedingReview() {
  return await db.prepare(`
    SELECT * FROM zone_metadata
    WHERE ai_suggested_at IS NOT NULL
      AND (user_confirmed_at IS NULL OR ai_suggested_at > user_confirmed_at)
    ORDER BY ai_suggested_at DESC
  `).all();
}

/**
 * Safely parse JSON string with fallback.
 * @param {string} jsonStr - JSON string to parse
 * @param {*} fallback - Fallback value if parse fails
 * @returns {*} Parsed value or fallback
 */
function safeJsonParse(jsonStr, fallback) {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return fallback;
  }
}

/**
 * Get zone families for grouping.
 * @returns {Promise<Object>} Map of family to zone IDs
 */
export async function getZoneFamilies() {
  const zones = await db.prepare('SELECT zone_id, family FROM zone_metadata WHERE family IS NOT NULL').all();
  const families = {};

  for (const zone of zones) {
    if (!families[zone.family]) {
      families[zone.family] = [];
    }
    families[zone.family].push(zone.zone_id);
  }

  return families;
}
