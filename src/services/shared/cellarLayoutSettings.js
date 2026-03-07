/**
 * @fileoverview Cellar layout settings helper.
 * Reads user_settings for colour ordering and fill direction preferences.
 * Row allocation between whites and reds is computed dynamically from
 * current inventory counts — never hardcoded.
 * @module services/shared/cellarLayoutSettings
 */

import db from '../../db/index.js';
import { getCellarRowCount } from '../cellar/cellarLayout.js';

/** @typedef {'whites-top'|'reds-top'} ColourOrder */
/** @typedef {'left'|'right'} FillDirection */

/**
 * @typedef {Object} CellarLayoutSettings
 * @property {ColourOrder} colourOrder - Whether whites or reds go at the top
 * @property {FillDirection} fillDirection - Whether to fill rows from left or right
 */

/** Total cellar rows available for allocation */
export const TOTAL_ROWS = 19;

/** Minimum rows allocated to a colour family when at least one bottle of that colour exists */
const MIN_ROWS_WHEN_PRESENT = 2;

/** Default layout settings */
export const LAYOUT_DEFAULTS = {
  colourOrder: 'whites-top',
  fillDirection: 'left'
};

/**
 * Get cellar layout settings for a cellar.
 * @param {string} cellarId - Cellar ID
 * @returns {Promise<CellarLayoutSettings>}
 */
export async function getCellarLayoutSettings(cellarId) {
  if (!cellarId) return { ...LAYOUT_DEFAULTS };

  const rows = await db.prepare(
    `SELECT key, value FROM user_settings
     WHERE cellar_id = $1 AND key IN ('cellar_colour_order', 'cellar_fill_direction')`
  ).all(cellarId);

  const settings = { ...LAYOUT_DEFAULTS };
  for (const row of rows) {
    if (row.key === 'cellar_colour_order' && (row.value === 'whites-top' || row.value === 'reds-top')) {
      settings.colourOrder = row.value;
    }
    if (row.key === 'cellar_fill_direction' && (row.value === 'left' || row.value === 'right')) {
      settings.fillDirection = row.value;
    }
  }

  return settings;
}

/**
 * Compute how many rows to allocate to each colour family based on bottle counts.
 * Proportional split with a minimum of MIN_ROWS_WHEN_PRESENT per colour when present.
 * @param {number} whiteCount - Number of white-family bottles in cellar
 * @param {number} redCount - Number of red bottles in cellar
 * @param {number} [totalRows=19] - Total cellar rows available
 * @returns {{whiteRowCount: number, redRowCount: number}}
 */
export function computeDynamicRowSplit(whiteCount, redCount, totalRows = TOTAL_ROWS) {
  const total = whiteCount + redCount;

  // All same colour or empty → give all rows to reds (default) or whites
  if (total === 0) return { whiteRowCount: 0, redRowCount: totalRows };
  if (whiteCount === 0) return { whiteRowCount: 0, redRowCount: totalRows };
  if (redCount === 0) return { whiteRowCount: totalRows, redRowCount: 0 };

  // Proportional split
  let whiteRowCount = Math.round((whiteCount / total) * totalRows);

  // Enforce minimum
  whiteRowCount = Math.max(whiteRowCount, MIN_ROWS_WHEN_PRESENT);
  whiteRowCount = Math.min(whiteRowCount, totalRows - MIN_ROWS_WHEN_PRESENT);

  return {
    whiteRowCount,
    redRowCount: totalRows - whiteRowCount
  };
}

/**
 * Build row number arrays from a colour order and white row count.
 * @param {ColourOrder} colourOrder
 * @param {number} whiteRowCount - Number of rows for whites (0 = all rows to reds)
 * @returns {{whiteRows: number[], redRows: number[]}}
 */
/**
 * Build row number arrays from a colour order and white row count.
 * @param {ColourOrder} colourOrder
 * @param {number} whiteRowCount - Number of rows for whites (0 = all rows to reds)
 * @param {number} [totalRows] - Total rows in cellar (defaults to TOTAL_ROWS)
 * @returns {{whiteRows: number[], redRows: number[]}}
 */
export function getColourRowRanges(colourOrder, whiteRowCount, totalRows = TOTAL_ROWS) {
  const total = totalRows;
  // Default split if whiteRowCount not provided (backward compat)
  const wrc = typeof whiteRowCount === 'number' ? whiteRowCount : Math.round(total * 0.37);

  if (colourOrder === 'reds-top') {
    // Reds at top (rows 1..redRowCount), whites at bottom
    const redRowCount = total - wrc;
    const redRows = Array.from({ length: redRowCount }, (_, i) => i + 1);
    const whiteRows = Array.from({ length: wrc }, (_, i) => redRowCount + i + 1);
    return { whiteRows, redRows };
  }
  // Default: whites-top (rows 1..whiteRowCount), reds below
  const whiteRows = Array.from({ length: wrc }, (_, i) => i + 1);
  const redRows = Array.from({ length: total - wrc }, (_, i) => wrc + i + 1);
  return { whiteRows, redRows };
}

/**
 * Count white-family vs red bottles in a cellar from the database.
 * @param {string} cellarId
 * @param {string} [storageAreaId] - Optional: restrict count to a specific storage area
 * @returns {Promise<{whiteCount: number, redCount: number}>}
 */
export async function countColourFamilies(cellarId, storageAreaId = null) {
  if (!cellarId) return { whiteCount: 0, redCount: 0 };

  const query = storageAreaId
    ? `SELECT w.colour, COUNT(s.id) AS cnt
       FROM slots s
       JOIN wines w ON w.id = s.wine_id AND w.cellar_id = $1
       WHERE s.cellar_id = $1
         AND s.storage_area_id = $2
         AND s.wine_id IS NOT NULL
       GROUP BY w.colour`
    : `SELECT w.colour, COUNT(s.id) AS cnt
       FROM slots s
       JOIN wines w ON w.id = s.wine_id AND w.cellar_id = $1
       JOIN storage_areas sa ON sa.id = s.storage_area_id
         AND sa.storage_type IN ('cellar', 'rack', 'other')
       WHERE s.cellar_id = $1
         AND s.wine_id IS NOT NULL
       GROUP BY w.colour`;

  const rows = storageAreaId
    ? await db.prepare(query).all(cellarId, storageAreaId)
    : await db.prepare(query).all(cellarId);

  let whiteCount = 0;
  let redCount = 0;
  for (const r of rows) {
    const cnt = parseInt(r.cnt, 10) || 0;
    if (isWhiteFamily(r.colour)) {
      whiteCount += cnt;
    } else {
      redCount += cnt;
    }
  }
  return { whiteCount, redCount };
}

/**
 * Get dynamic colour row ranges for a cellar based on current inventory.
 * Respects each storage area's colour_zone designation:
 * - 'white' areas: all rows are white rows
 * - 'red' areas: all rows are red rows
 * - 'mixed' areas: proportional split within that area's row range
 * Falls back to single-area legacy behaviour when no storage areas exist.
 * @param {string} cellarId
 * @param {ColourOrder} colourOrder
 * @returns {Promise<{whiteRows: number[], redRows: number[], whiteRowCount: number, redRowCount: number, whiteCount: number, redCount: number}>}
 */
export async function getDynamicColourRowRanges(cellarId, colourOrder = 'whites-top') {
  // Fetch storage areas with colour_zone and their row ranges
  const areas = await db.prepare(`
    SELECT sa.id, sa.colour_zone, sa.storage_type,
           json_agg(json_build_object('row_num', sar.row_num) ORDER BY sar.row_num)
             FILTER (WHERE sar.row_num IS NOT NULL) AS area_rows
    FROM storage_areas sa
    LEFT JOIN storage_area_rows sar ON sar.storage_area_id = sa.id
    WHERE sa.cellar_id = $1
    GROUP BY sa.id, sa.colour_zone, sa.storage_type
    ORDER BY sa.display_order NULLS LAST, sa.created_at
  `).all(cellarId);

  // Filter to cellar-type areas (not fridges) — colour zones only apply to cellar/rack storage
  const cellarAreas = (areas || []).filter(a =>
    a.storage_type === 'cellar' || a.storage_type === 'rack' || a.storage_type === 'other'
  );

  // Legacy fallback: no storage areas defined
  if (cellarAreas.length === 0) {
    const [counts, totalRows] = await Promise.all([
      countColourFamilies(cellarId),
      getCellarRowCount(cellarId)
    ]);
    const split = computeDynamicRowSplit(counts.whiteCount, counts.redCount, totalRows);
    const ranges = getColourRowRanges(colourOrder, split.whiteRowCount, totalRows);
    return { ...ranges, ...split, whiteCount: counts.whiteCount, redCount: counts.redCount };
  }

  const whiteRowSet = new Set();
  const redRowSet = new Set();
  let totalWhiteCount = 0;
  let totalRedCount = 0;

  for (const area of cellarAreas) {
    const areaRows = (typeof area.area_rows === 'string' ? JSON.parse(area.area_rows) : area.area_rows) || [];
    const rowNums = areaRows.map(r => r.row_num).sort((a, b) => a - b);

    if (rowNums.length === 0) continue;

    const zone = area.colour_zone || 'mixed';

    // Count bottles for every area (needed for accurate totals)
    const counts = await countColourFamilies(cellarId, area.id);
    totalWhiteCount += counts.whiteCount;
    totalRedCount += counts.redCount;

    if (zone === 'white') {
      for (const rn of rowNums) whiteRowSet.add(rn);
    } else if (zone === 'red') {
      for (const rn of rowNums) redRowSet.add(rn);
    } else {
      // Mixed: proportional split within this area's rows

      const areaRowCount = rowNums.length;
      const split = computeDynamicRowSplit(counts.whiteCount, counts.redCount, areaRowCount);

      // Apply colour order within this area's contiguous rows
      if (colourOrder === 'reds-top') {
        // Reds at top of this area's range, whites at bottom
        for (let i = 0; i < areaRowCount - split.whiteRowCount; i++) redRowSet.add(rowNums[i]);
        for (let i = areaRowCount - split.whiteRowCount; i < areaRowCount; i++) whiteRowSet.add(rowNums[i]);
      } else {
        // Whites at top of this area's range, reds at bottom
        for (let i = 0; i < split.whiteRowCount; i++) whiteRowSet.add(rowNums[i]);
        for (let i = split.whiteRowCount; i < areaRowCount; i++) redRowSet.add(rowNums[i]);
      }
    }
  }

  const whiteRows = [...whiteRowSet].sort((a, b) => a - b);
  const redRows = [...redRowSet].sort((a, b) => a - b);

  return {
    whiteRows,
    redRows,
    whiteRowCount: whiteRows.length,
    redRowCount: redRows.length,
    whiteCount: totalWhiteCount,
    redCount: totalRedCount
  };
}

/**
 * Check if a wine colour is in the "white family" (white, rosé, orange, sparkling, dessert, fortified).
 * @param {string} colour
 * @returns {boolean}
 */
export function isWhiteFamily(colour) {
  const whiteFamilyColours = ['white', 'rose', 'rosé', 'orange', 'sparkling', 'dessert', 'fortified'];
  return whiteFamilyColours.includes((colour || '').toLowerCase());
}
