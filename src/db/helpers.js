/**
 * @fileoverview Database compatibility helpers for PostgreSQL/SQLite dual support.
 * Provides centralized functions that return the correct SQL syntax based on database backend.
 * @module db/helpers
 */

/**
 * Check if PostgreSQL is being used.
 * @returns {boolean} True if using PostgreSQL
 */
export function isPostgres() {
  return !!process.env.DATABASE_URL;
}

/**
 * Get the string aggregation function for the current database.
 * PostgreSQL uses STRING_AGG, SQLite uses GROUP_CONCAT.
 *
 * @param {string} column - Column expression to aggregate
 * @param {string} [separator=','] - Separator string between values
 * @param {boolean} [distinct=false] - Whether to use DISTINCT
 * @returns {string} SQL function call
 *
 * @example
 * // Returns "STRING_AGG(DISTINCT s.location_code, ',')" for PostgreSQL
 * // Returns "GROUP_CONCAT(DISTINCT s.location_code)" for SQLite
 * stringAgg('s.location_code', ',', true)
 */
export function stringAgg(column, separator = ',', distinct = false) {
  const distinctKeyword = distinct ? 'DISTINCT ' : '';

  if (isPostgres()) {
    return `STRING_AGG(${distinctKeyword}${column}, '${separator}')`;
  }
  // SQLite GROUP_CONCAT doesn't support custom separator in standard syntax
  // but does support DISTINCT
  return `GROUP_CONCAT(${distinctKeyword}${column})`;
}

/**
 * Get the current timestamp function for the current database.
 * PostgreSQL uses CURRENT_TIMESTAMP, SQLite uses datetime('now').
 *
 * @returns {string} SQL function/expression for current timestamp
 *
 * @example
 * // Returns "CURRENT_TIMESTAMP" for PostgreSQL
 * // Returns "datetime('now')" for SQLite
 * nowFunc()
 */
export function nowFunc() {
  return isPostgres() ? 'CURRENT_TIMESTAMP' : "datetime('now')";
}

/**
 * Get the case-insensitive LIKE operator for the current database.
 * PostgreSQL uses ILIKE, SQLite LIKE is case-insensitive by default.
 *
 * @returns {string} LIKE or ILIKE operator
 *
 * @example
 * // Returns "ILIKE" for PostgreSQL
 * // Returns "LIKE" for SQLite
 * ilike()
 */
export function ilike() {
  return isPostgres() ? 'ILIKE' : 'LIKE';
}

/**
 * Build an upsert statement for the current database.
 * PostgreSQL uses ON CONFLICT ... DO UPDATE, SQLite uses INSERT OR REPLACE.
 *
 * @param {string} table - Table name
 * @param {string[]} columns - Column names
 * @param {string} conflictColumn - Column that defines uniqueness
 * @param {string[]} updateColumns - Columns to update on conflict
 * @returns {string} Complete INSERT statement
 *
 * @example
 * upsert('user_settings', ['key', 'value'], 'key', ['value'])
 * // PostgreSQL: INSERT INTO user_settings (key, value) VALUES ($1, $2)
 * //            ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
 * // SQLite: INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)
 */
export function upsert(table, columns, conflictColumn, updateColumns) {
  const placeholders = columns.map((_, i) =>
    isPostgres() ? `$${i + 1}` : '?'
  ).join(', ');

  if (isPostgres()) {
    const updates = updateColumns
      .map(col => `${col} = EXCLUDED.${col}`)
      .join(', ');
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
            ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updates}`;
  }

  return `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
}

/**
 * Get the auto-increment column type for the current database.
 * PostgreSQL uses SERIAL, SQLite uses INTEGER PRIMARY KEY AUTOINCREMENT.
 *
 * @returns {string} Column definition for auto-increment primary key
 */
export function autoIncrement() {
  return isPostgres()
    ? 'SERIAL PRIMARY KEY'
    : 'INTEGER PRIMARY KEY AUTOINCREMENT';
}

/**
 * Get the timestamp column type for the current database.
 * PostgreSQL uses TIMESTAMP, SQLite uses DATETIME.
 *
 * @returns {string} Column type for timestamps
 */
export function timestampType() {
  return isPostgres() ? 'TIMESTAMP' : 'DATETIME';
}

/**
 * Build an ORDER BY clause with NULLS LAST handling for both databases.
 * PostgreSQL supports NULLS LAST natively, SQLite requires a CASE workaround.
 *
 * @param {string} column - Column expression to order by
 * @param {string} [direction='ASC'] - Sort direction (ASC or DESC)
 * @returns {string} ORDER BY clause fragment with NULLS LAST handling
 *
 * @example
 * // Returns "drink_by_year ASC NULLS LAST" for PostgreSQL
 * // Returns "CASE WHEN drink_by_year IS NULL THEN 1 ELSE 0 END, drink_by_year ASC" for SQLite
 * nullsLast('drink_by_year', 'ASC')
 */
export function nullsLast(column, direction = 'ASC') {
  if (isPostgres()) {
    return `${column} ${direction} NULLS LAST`;
  }
  // SQLite workaround: sort nulls to end using CASE
  return `CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END, ${column} ${direction}`;
}

export default {
  isPostgres,
  stringAgg,
  nowFunc,
  ilike,
  upsert,
  autoIncrement,
  timestampType,
  nullsLast
};
