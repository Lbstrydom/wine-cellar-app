/**
 * @fileoverview Shared slot parsing and building utilities.
 * Consolidates duplicated slot logic from movePlanner.js and cellarMetrics.js
 * into a single source of truth.
 * @module services/cellar/slotUtils
 */

// ───────────────────────────────────────────────────────────
// Slot parsing
// ───────────────────────────────────────────────────────────

/**
 * Parse slot ID into row and column numbers.
 * Handles cellar slots (R3C5), fridge slots (F2), and null/invalid inputs.
 * @param {string} slotId - e.g. "R3C7", "F2", null
 * @returns {{row: number, col: number}|null}
 */
export function parseSlot(slotId) {
  if (!slotId) return null;

  // Fridge slot: F<col>
  if (slotId.startsWith('F')) {
    const col = parseInt(slotId.slice(1), 10);
    return isNaN(col) ? null : { row: 0, col };
  }

  // Cellar slot: R<row>C<col>
  const match = slotId.match(/^R(\d+)C(\d+)$/);
  if (match) {
    return { row: parseInt(match[1], 10), col: parseInt(match[2], 10) };
  }

  return null;
}

/**
 * Extract row ID from a slot ID.
 * @param {string} slotId - e.g. "R3C5"
 * @returns {string|null} e.g. "R3", or null for invalid/fridge slots
 */
export function slotToRowId(slotId) {
  if (!slotId) return null;
  const match = slotId.match(/^(R\d+)C\d+$/);
  return match ? match[1] : null;
}

/**
 * Build a slot ID from row and column numbers.
 * @param {number} row - Row number (1-based)
 * @param {number} col - Column number (1-based)
 * @returns {string} e.g. "R3C5"
 */
export function buildSlotId(row, col) {
  return `R${row}C${col}`;
}

/**
 * Extract row number from a slot ID.
 * @param {string} slotId - e.g. "R3C5", "F2"
 * @returns {number} Row number, or 0 for fridge/invalid slots
 */
export function extractRowNumber(slotId) {
  const match = slotId?.match(/^R(\d+)C/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Get the slot capacity for a given row ID.
 * Uses storage area row data when available, otherwise falls back to defaults.
 * @param {string} rowId - e.g. "R1", "R8"
 * @param {Array<{row_num: number, col_count: number}>} [storageAreaRows] - Dynamic row definitions
 * @returns {number} Number of slots in the row
 */
export function getRowCapacity(rowId, storageAreaRows) {
  const rowNum = parseInt(rowId?.replace('R', ''), 10);
  if (isNaN(rowNum)) return 0;

  // Dynamic: look up from storage area row definitions
  if (Array.isArray(storageAreaRows) && storageAreaRows.length > 0) {
    const rowDef = storageAreaRows.find(r => r.row_num === rowNum);
    if (rowDef) return rowDef.col_count;
  }

  // Legacy fallback: R1 has 7 slots, all others have 9
  return rowNum === 1 ? 7 : 9;
}

/**
 * Check whether a slot ID is a cellar slot (not fridge).
 * @param {string} slotId
 * @returns {boolean}
 */
export function isCellarSlot(slotId) {
  return /^R\d+C\d+$/.test(slotId || '');
}

/**
 * Check whether a slot ID is a fridge slot.
 * @param {string} slotId
 * @returns {boolean}
 */
export function isFridgeSlot(slotId) {
  return /^F\d+$/.test(slotId || '');
}

/**
 * Sort row IDs numerically (R1, R2, … R10, R19).
 * @param {string} a - Row ID
 * @param {string} b - Row ID
 * @returns {number}
 */
export function sortRowIds(a, b) {
  return (parseInt(a.replace('R', ''), 10) || 0) -
         (parseInt(b.replace('R', ''), 10) || 0);
}
