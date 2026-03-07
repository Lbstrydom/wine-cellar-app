/**
 * @fileoverview Cellar layout provider service.
 * Central service for storage area row definitions, abstracting hardcoded constants.
 * All services that need row capacities or cellar dimensions should use these helpers
 * instead of hardcoding TOTAL_ROWS=19, R1=7 or others=9.
 * @module services/cellar/cellarLayout
 */

import db from '../../db/index.js';
import { getRowCapacity } from './slotUtils.js';

// ───────────────────────────────────────────────────────────
// Storage area row queries
// ───────────────────────────────────────────────────────────

/**
 * Get storage area row definitions for a cellar's primary cellar-type storage area.
 * Returns rows sorted by row_num, or [] when no storage area rows are defined.
 * An empty result causes callers to fall back to legacy R1=7/others=9 defaults
 * via getRowCapacity() in slotUtils.js.
 *
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @param {string} [storageAreaId] - Optional: restrict to a specific storage area
 * @returns {Promise<Array<{row_num: number, col_count: number, label: string|null}>>}
 */
export async function getStorageAreaRows(cellarId, storageAreaId) {
  if (!cellarId) return [];

  if (storageAreaId) {
    const rows = await db.prepare(`
      SELECT sar.row_num, sar.col_count, sar.label
      FROM storage_area_rows sar
      JOIN storage_areas sa ON sa.id = sar.storage_area_id
      WHERE sa.cellar_id = $1
        AND sar.storage_area_id = $2
      ORDER BY sar.row_num
    `).all(cellarId, storageAreaId);
    return rows || [];
  }

  const rows = await db.prepare(`
    SELECT sar.row_num, sar.col_count, sar.label
    FROM storage_area_rows sar
    JOIN storage_areas sa ON sa.id = sar.storage_area_id
    WHERE sa.cellar_id = $1
      AND sa.storage_type = 'cellar'
    ORDER BY sa.display_order NULLS LAST, sa.created_at, sar.row_num
  `).all(cellarId);

  return rows || [];
}

/**
 * Get storage area row definitions for a specific storage area (by area ID).
 * Convenience wrapper — avoids passing cellarId when area ID is already known.
 *
 * @param {string} storageAreaId - Storage area UUID
 * @returns {Promise<Array<{row_num: number, col_count: number, label: string|null}>>}
 */
export async function getStorageAreaRowsForArea(storageAreaId) {
  if (!storageAreaId) return [];

  const rows = await db.prepare(`
    SELECT row_num, col_count, label
    FROM storage_area_rows
    WHERE storage_area_id = $1
    ORDER BY row_num
  `).all(storageAreaId);

  return rows || [];
}

/**
 * Get the total row count for a cellar's primary cellar-type storage area.
 * Falls back to the legacy default of 19 rows when no storage area rows are defined.
 *
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<number>}
 */
export async function getCellarRowCount(cellarId) {
  const rows = await getStorageAreaRows(cellarId);
  if (rows.length === 0) return 19; // legacy fallback
  return Math.max(...rows.map(r => r.row_num));
}

/**
 * Get all slot IDs for a given row, respecting dynamic column counts.
 *
 * @param {string} rowId - Row identifier, e.g. 'R3'
 * @param {Array<{row_num: number, col_count: number}>} storageAreaRows - Dynamic row definitions
 * @returns {string[]} Slot IDs for the row, e.g. ['R3C1', 'R3C2', ...]
 */
export function getRowSlotIds(rowId, storageAreaRows) {
  const maxCol = getRowCapacity(rowId, storageAreaRows);
  const rowNum = parseInt(rowId.slice(1), 10);
  if (isNaN(rowNum)) return [];
  const slots = [];
  for (let col = 1; col <= maxCol; col++) {
    slots.push(`R${rowNum}C${col}`);
  }
  return slots;
}

/**
 * Get storage areas for a cellar, grouped by storage_type.
 * Each area includes its row layout (from storage_area_rows).
 *
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<Object>} Object keyed by storage_type, e.g. { cellar: [...], wine_fridge: [...] }
 */
export async function getStorageAreasByType(cellarId) {
  if (!cellarId) return {};

  const areas = await db.prepare(`
    SELECT
      sa.id,
      sa.name,
      sa.storage_type,
      sa.temp_zone,
      sa.display_order,
      COALESCE(
        json_agg(
          json_build_object(
            'row_num', sar.row_num,
            'col_count', sar.col_count,
            'label', sar.label
          )
          ORDER BY sar.row_num
        ) FILTER (WHERE sar.row_num IS NOT NULL),
        '[]'
      ) AS rows
    FROM storage_areas sa
    LEFT JOIN storage_area_rows sar ON sar.storage_area_id = sa.id
    WHERE sa.cellar_id = $1
    GROUP BY sa.id, sa.name, sa.storage_type, sa.temp_zone, sa.display_order
    ORDER BY sa.display_order NULLS LAST, sa.created_at
  `).all(cellarId);

  const byType = {};
  for (const area of areas || []) {
    const type = area.storage_type || 'other';
    if (!byType[type]) byType[type] = [];
    const rows = typeof area.rows === 'string' ? JSON.parse(area.rows) : (area.rows || []);
    byType[type].push({ ...area, rows });
  }
  return byType;
}
