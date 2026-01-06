/**
 * @fileoverview PostgreSQL database connection and query helpers.
 * Provides async/await API for database operations.
 * @module db/postgres
 */

import pg from 'pg';
const { Pool } = pg;

// Create connection pool from DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Log connection status
pool.on('connect', () => {
  console.log('[DB] PostgreSQL client connected');
});

pool.on('error', (err) => {
  console.error('[DB] PostgreSQL pool error:', err.message);
});

/**
 * Test database connection on startup
 */
async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW() as now');
    console.log(`[DB] PostgreSQL connected at ${result.rows[0].now}`);

    // Check if wines table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'wines'
      ) as exists
    `);

    if (tableCheck.rows[0].exists) {
      const wineCount = await pool.query('SELECT COUNT(*) as count FROM wines');
      console.log(`[DB] Found ${wineCount.rows[0].count} wines in database`);
    } else {
      console.log('[DB] Warning: wines table does not exist - run schema migration');
    }
  } catch (err) {
    console.error('[DB] PostgreSQL connection failed:', err.message);
    throw err;
  }
}

// Test connection on module load
testConnection();

/**
 * Convert SQLite ? placeholders to PostgreSQL $1, $2 placeholders
 * @param {string} sql - SQL with ? placeholders
 * @returns {string} SQL with $1, $2 placeholders
 */
function convertPlaceholders(sql) {
  let paramIndex = 0;
  return sql.replace(/\?/g, () => `$${++paramIndex}`);
}

/**
 * PostgreSQL database wrapper with SQLite-compatible API.
 * All methods return promises that must be awaited.
 */
class PostgresDB {
  constructor(poolInstance) {
    this.pool = poolInstance;
  }

  /**
   * Create a prepared statement-like object.
   * @param {string} sql - SQL query
   * @returns {object} Object with async get/all/run methods
   */
  prepare(sql) {
    const pgSql = convertPlaceholders(sql);
    const self = this;

    return {
      sql: pgSql,

      async get(...params) {
        const result = await self.pool.query(pgSql, params);
        return result.rows[0] || null;
      },

      async all(...params) {
        const result = await self.pool.query(pgSql, params);
        return result.rows;
      },

      async run(...params) {
        const result = await self.pool.query(pgSql, params);
        return {
          changes: result.rowCount,
          lastInsertRowid: result.rows[0]?.id || null
        };
      }
    };
  }

  /**
   * Execute raw SQL
   */
  async exec(sql) {
    await this.pool.query(sql);
  }

  /**
   * Create a transaction wrapper.
   * Usage: await db.transaction(async (client) => { ... })
   * @param {Function} fn - Async function to run in transaction
   * @returns {Promise} Result of transaction
   */
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Direct query method for complex queries
   */
  async query(sql, params = []) {
    const pgSql = convertPlaceholders(sql);
    const result = await this.pool.query(pgSql, params);
    return result.rows;
  }

  /**
   * No-op for SQLite pragmas
   */
  pragma() {}
}

const db = new PostgresDB(pool);
const awardsDb = db; // Same pool for awards (same database)

/**
 * Prepared statements (all methods are async).
 * Uses ? placeholders which are auto-converted to $1, $2, etc.
 */
export const preparedStatements = {
  getWineById: db.prepare('SELECT * FROM wines WHERE id = ?'),
  getAllWines: db.prepare('SELECT * FROM wines ORDER BY colour, style, wine_name'),
  getWinesByColour: db.prepare('SELECT * FROM wines WHERE colour = ? ORDER BY style, wine_name'),
  getSlotByLocation: db.prepare('SELECT * FROM slots WHERE location_code = ?'),
  getAllSlots: db.prepare('SELECT * FROM slots ORDER BY zone, row_num, col_num'),
  getSlotsByWineId: db.prepare('SELECT * FROM slots WHERE wine_id = ? ORDER BY location_code'),
  getRatingsByWineId: db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ? ORDER BY fetched_at DESC'),
  getReduceNowByWineId: db.prepare('SELECT * FROM reduce_now WHERE wine_id = ?'),
  getBottleCount: db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id = ?'),
  getSetting: db.prepare('SELECT value FROM user_settings WHERE key = ?'),
  upsertSetting: db.prepare(`
    INSERT INTO user_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `)
};

/**
 * Direct pool access for complex queries
 */
export { pool };

export default db;
export { awardsDb };
