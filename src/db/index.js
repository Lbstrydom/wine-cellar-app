/**
 * @fileoverview Database connection module (PostgreSQL only).
 * Connects to PostgreSQL via DATABASE_URL environment variable.
 * @module db
 */

// Require DATABASE_URL for PostgreSQL connection
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is required. ' +
    'Set it to your PostgreSQL connection string (e.g., postgresql://user:pass@host/db)'
  );
}

console.log('[DB] Backend: PostgreSQL (production)');

// PostgreSQL mode
const postgres = await import('./postgres.js');
const db = postgres.default;
const awardsDb = postgres.awardsDb;
const preparedStatements = postgres.preparedStatements;
const pool = postgres.pool;

export default db;
export { awardsDb, preparedStatements, pool };
