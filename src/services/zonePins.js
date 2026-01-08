/**
 * @fileoverview Zone pin constraints for holistic reconfiguration.
 * @module services/zonePins
 */

import db from '../db/index.js';
import { ensureReconfigurationTables } from './reconfigurationTables.js';

/**
 * Get all zone pins.
 * @returns {Promise<Array<{zone_id: string, pin_type: string, minimum_rows: number|null, notes: string|null}>>}
 */
export async function getZonePins() {
  await ensureReconfigurationTables();
  const rows = await db.prepare(
    'SELECT zone_id, pin_type, minimum_rows, notes FROM zone_pins'
  ).all();
  return rows || [];
}

/**
 * Convenience: return set of zones pinned as never_merge.
 * @returns {Promise<Set<string>>}
 */
export async function getNeverMergeZones() {
  const pins = await getZonePins();
  return new Set(pins.filter(p => p.pin_type === 'never_merge').map(p => p.zone_id));
}

/**
 * Convenience: return map of zoneId -> minimum_rows.
 * @returns {Promise<Map<string, number>>}
 */
export async function getMinimumRowsByZone() {
  const pins = await getZonePins();
  const map = new Map();
  for (const p of pins) {
    if (p.pin_type === 'minimum_rows') {
      const minRows = Number.isFinite(p.minimum_rows) ? p.minimum_rows : 1;
      map.set(p.zone_id, minRows);
    }
  }
  return map;
}
