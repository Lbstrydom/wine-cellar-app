/**
 * @fileoverview Database helper functions for PostgreSQL.
 * All functions are PostgreSQL-specific.
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

