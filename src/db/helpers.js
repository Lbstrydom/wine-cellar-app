/**
 * @fileoverview Database helper functions for PostgreSQL.
 * All functions are PostgreSQL-specific (no SQLite fallbacks).
 * @module db/helpers
 */

/**
 * Get the string aggregation function (PostgreSQL: STRING_AGG).
 *
 * @param {string} column - Column expression to aggregate
 * @param {string} [separator=','] - Separator string between values
 * @param {boolean} [distinct=false] - Whether to use DISTINCT
 * @returns {string} SQL function call
 *
 * @example
 * stringAgg('s.location_code', ',', true)
 * // Returns: "STRING_AGG(DISTINCT s.location_code, ',')"
 */
export function stringAgg(column, separator = ',', distinct = false) {
  const distinctKeyword = distinct ? 'DISTINCT ' : '';
  return `STRING_AGG(${distinctKeyword}${column}, '${separator}')`;
}

/**
 * Get the current timestamp function (PostgreSQL: CURRENT_TIMESTAMP).
 *
 * @returns {string} SQL function/expression for current timestamp
 *
 * @example
 * nowFunc()
 * // Returns: "CURRENT_TIMESTAMP"
 */
export function nowFunc() {
  return 'CURRENT_TIMESTAMP';
}

/**
 * Get the case-insensitive LIKE operator (PostgreSQL: ILIKE).
 *
 * @returns {string} ILIKE operator
 *
 * @example
 * ilike()
 * // Returns: "ILIKE"
 */
export function ilike() {
  return 'ILIKE';
}

/**
 * Build an upsert statement (PostgreSQL: INSERT ... ON CONFLICT).
 *
 * @param {string} table - Table name
 * @param {string[]} columns - Column names
 * @param {string} conflictColumn - Column that defines uniqueness
 * @param {string[]} updateColumns - Columns to update on conflict
 * @returns {string} Complete INSERT statement
 *
 * @example
 * upsert('user_settings', ['key', 'value'], 'key', ['value'])
 * // Returns: "INSERT INTO user_settings (key, value) VALUES ($1, $2)
 * //           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value"
 */
export function upsert(table, columns, conflictColumn, updateColumns) {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updates = updateColumns
    .map(col => `${col} = EXCLUDED.${col}`)
    .join(', ');

  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
          ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updates}`;
}

/**
 * Build an ORDER BY clause with NULLS LAST (PostgreSQL native support).
 *
 * @param {string} column - Column expression to order by
 * @param {string} [direction='ASC'] - Sort direction (ASC or DESC)
 * @returns {string} ORDER BY clause fragment with NULLS LAST
 *
 * @example
 * nullsLast('drink_by_year', 'ASC')
 * // Returns: "drink_by_year ASC NULLS LAST"
 */
export function nullsLast(column, direction = 'ASC') {
  return `${column} ${direction} NULLS LAST`;
}

export default {
  stringAgg,
  nowFunc,
  ilike,
  upsert,
  nullsLast
};
