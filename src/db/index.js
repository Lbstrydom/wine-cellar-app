/**
 * @fileoverview Database connection module.
 * Automatically selects PostgreSQL or SQLite based on DATABASE_URL env var.
 * @module db
 */

// Choose database backend based on environment
console.log(`[DB] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);
console.log(`[DB] DATABASE_URL value: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + '...' : 'undefined'}`);
const usePostgres = !!process.env.DATABASE_URL;

console.log(`[DB] Backend: ${usePostgres ? 'PostgreSQL' : 'SQLite'}`);

let db, awardsDb, preparedStatements, pool;

if (usePostgres) {
  // PostgreSQL mode (Railway/Supabase)
  const postgres = await import('./postgres.js');
  db = postgres.default;
  awardsDb = postgres.awardsDb;
  preparedStatements = postgres.preparedStatements;
  pool = postgres.pool;
} else {
  // SQLite mode (local dev, Synology)
  const sqlite = await import('./sqlite.js');
  db = sqlite.default;
  awardsDb = sqlite.awardsDb;
  preparedStatements = sqlite.preparedStatements;
  pool = null;
}

export default db;
export { awardsDb, preparedStatements, pool };
