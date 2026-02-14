/**
 * @fileoverview Row capacity map for the physical cellar.
 * Row 1 has 7 slots; all other rows have 9 slots.
 * This module is the single source of truth for row capacities,
 * replacing hardcoded SLOTS_PER_ROW = 9 constants.
 * @module config/cellarCapacity
 */

const TOTAL_ROWS = 19;
const DEFAULT_SLOTS = 9;
const ROW_1_SLOTS = 7;

/**
 * Canonical row capacity map: rowId → slot count.
 * @type {Object.<string, number>}
 */
export const ROW_CAPACITY_MAP = Object.fromEntries(
  Array.from({ length: TOTAL_ROWS }, (_, i) => {
    const rowNum = i + 1;
    return [`R${rowNum}`, rowNum === 1 ? ROW_1_SLOTS : DEFAULT_SLOTS];
  })
);

/**
 * Get the slot capacity of a specific row.
 * @param {string|number} rowId - Row identifier (e.g. "R3" or 3)
 * @returns {number} Slot count for the row
 */
export function getRowCapacity(rowId) {
  const key = typeof rowId === 'number' ? `R${rowId}` : String(rowId);
  return ROW_CAPACITY_MAP[key] ?? DEFAULT_SLOTS;
}

/**
 * Compute total slot capacity across a set of rows.
 * @param {string[]} rowIds - Array of row identifiers (e.g. ["R1", "R3"])
 * @returns {number} Total slot capacity
 */
export function computeRowsCapacity(rowIds) {
  if (!rowIds || rowIds.length === 0) return 0;
  return rowIds.reduce((sum, rowId) => sum + getRowCapacity(rowId), 0);
}

/**
 * Get total cellar capacity (all rows combined).
 * @returns {number} Total slot count (169 for standard 19-row cellar)
 */
export function getTotalCapacity() {
  return Object.values(ROW_CAPACITY_MAP).reduce((a, b) => a + b, 0);
}

/**
 * Get the total number of physical rows.
 * @returns {number}
 */
export function getTotalRows() {
  return TOTAL_ROWS;
}

/**
 * Get all row IDs in physical order.
 * @returns {string[]}
 */
export function getAllRowIds() {
  return Array.from({ length: TOTAL_ROWS }, (_, i) => `R${i + 1}`);
}

/**
 * Parse row number from a row ID string.
 * @param {string|number} rowId - e.g. "R3" or 3
 * @returns {number}
 */
export function parseRowNumber(rowId) {
  if (typeof rowId === 'number') return rowId;
  return parseInt(String(rowId).replace(/^R/i, ''), 10);
}
