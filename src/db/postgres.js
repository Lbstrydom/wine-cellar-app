/**
 * @fileoverview PostgreSQL database connection and query helpers.
 * Provides async/await API for database operations.
 * @module db/postgres
 */

import pg from 'pg';
import logger from '../utils/logger.js';
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
  logger.error('DB', 'PostgreSQL pool error: ' + err.message);
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
    logger.error('DB', 'PostgreSQL connection failed: ' + err.message);
    throw err;
  }
}

// Test connection on module load
testConnection();

/**
 * Convert legacy ? placeholders to PostgreSQL $1, $2 placeholders
 * @param {string} sql - SQL with ? placeholders
 * @returns {string} SQL with $1, $2 placeholders
 */
function convertPlaceholders(sql) {
  let paramIndex = 0;
  return sql.replace(/\?/g, () => `$${++paramIndex}`);
}

/**
 * PostgreSQL database wrapper with prepare/get/all/run API.
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
   * No-op for legacy pragma calls
   */
  pragma() {}
}

/**
 * Wrap a raw pg.Client (from transaction) with the same .prepare() API
 * as PostgresDB, so services like saveAcquiredWine can use either.
 * @param {pg.Client} client - Raw PostgreSQL client from pool.connect()
 * @returns {{ prepare: Function }} Object with .prepare() matching PostgresDB API
 */
export function wrapClient(client) {
  return {
    prepare(sql) {
      const pgSql = convertPlaceholders(sql);
      return {
        async get(...params) {
          const r = await client.query(pgSql, params);
          return r.rows[0] || null;
        },
        async all(...params) {
          const r = await client.query(pgSql, params);
          return r.rows;
        },
        async run(...params) {
          const r = await client.query(pgSql, params);
          return {
            changes: r.rowCount,
            lastInsertRowid: r.rows[0]?.id || null
          };
        }
      };
    }
  };
}

const db = new PostgresDB(pool);
const awardsDb = db; // Same pool for awards (same database)

/**
 * Direct pool access for complex queries
 */
export { pool };

export default db;
export { awardsDb };
