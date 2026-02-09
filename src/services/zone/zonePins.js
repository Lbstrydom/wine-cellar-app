/**
 * @fileoverview Zone pin constraints for holistic reconfiguration.
 * @module services/zone/zonePins
 */

import db from '../../db/index.js';
import { ensureReconfigurationTables } from './reconfigurationTables.js';

/**
 * Get all zone pins.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Array<{zone_id: string, pin_type: string, minimum_rows: number|null, notes: string|null}>>}
 */
export async function getZonePins(cellarId) {
  await ensureReconfigurationTables();
  const rows = await db.prepare(
    'SELECT zone_id, pin_type, minimum_rows, notes FROM zone_pins WHERE cellar_id = ?'
  ).all(cellarId);
  return rows || [];
}

/**
 * Convenience: return set of zones pinned as never_merge.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Set<string>>}
 */
export async function getNeverMergeZones(cellarId) {
  const pins = await getZonePins(cellarId);
  return new Set(pins.filter(p => p.pin_type === 'never_merge').map(p => p.zone_id));
}

/**
 * Convenience: return map of zoneId -> minimum_rows.
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Map<string, number>>}
 */
export async function getMinimumRowsByZone(cellarId) {
  const pins = await getZonePins(cellarId);
  const map = new Map();
  for (const p of pins) {
    if (p.pin_type === 'minimum_rows') {
      const minRows = Number.isFinite(p.minimum_rows) ? p.minimum_rows : 1;
      map.set(p.zone_id, minRows);
    }
  }
  return map;
}
