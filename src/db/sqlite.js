/**
 * @fileoverview Database connection and query helpers.
 * @module db
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use DATA_DIR env var for Fly.io, fallback to local data directory
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'cellar.db');
const AWARDS_DB_PATH = path.join(DATA_DIR, 'awards.db');

// Log database paths and check if files exist
console.log(`[DB] DATA_DIR: ${DATA_DIR}`);
console.log(`[DB] DB_PATH: ${DB_PATH}`);
console.log(`[DB] AWARDS_DB_PATH: ${AWARDS_DB_PATH}`);
console.log(`[DB] cellar.db exists: ${fs.existsSync(DB_PATH)}`);
console.log(`[DB] awards.db exists: ${fs.existsSync(AWARDS_DB_PATH)}`);

// Validate SQLite file header before opening
function isValidSqliteFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buffer = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);
  const header = buffer.toString('ascii', 0, 16);
  const isValid = header.startsWith('SQLite format 3');
  console.log(`[DB] ${path.basename(filePath)} header: "${header.substring(0, 15)}..." valid: ${isValid}`);
  return isValid;
}

// Check database header only - don't auto-delete, just warn
if (fs.existsSync(DB_PATH)) {
  const stats = fs.statSync(DB_PATH);
  console.log(`[DB] cellar.db size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  const valid = isValidSqliteFile(DB_PATH);
  if (!valid) {
    console.log(`[DB] WARNING: cellar.db has invalid header - will be replaced`);
    try { fs.unlinkSync(DB_PATH); } catch (_e) { /* ignore */ }
  }
}

if (fs.existsSync(AWARDS_DB_PATH)) {
  const stats = fs.statSync(AWARDS_DB_PATH);
  console.log(`[DB] awards.db size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  const valid = isValidSqliteFile(AWARDS_DB_PATH);
  if (!valid) {
    console.log(`[DB] WARNING: awards.db has invalid header - will be replaced`);
    try { fs.unlinkSync(AWARDS_DB_PATH); } catch (_e) { /* ignore */ }
  }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Separate database for awards (shared/public data)
const awardsDb = new Database(AWARDS_DB_PATH);
awardsDb.pragma('journal_mode = WAL');
awardsDb.pragma('foreign_keys = ON');

/**
 * Initialize database schema if tables don't exist.
 * @private
 */
function initSchema() {
  // Check if wines table exists
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='wines'"
  ).get();

  if (tableExists) {
    console.log('[DB] Schema already exists - skipping initialization');
    
    // Count wines to verify data
    const wineCount = db.prepare('SELECT COUNT(*) as count FROM wines').get();
    console.log(`[DB] Found ${wineCount.count} wines in database`);
    return; // Schema already initialized
  }

  console.log('[DB] No existing schema found - initializing database...');

  // Find schema.sql - try DATA_DIR first, then app bundled location
  let schemaPath = path.join(DATA_DIR, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(__dirname, '..', '..', 'data', 'schema.sql');
  }

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // Execute schema (split by semicolon, skip comments)
  const statements = schema
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    try {
      db.exec(stmt);
    } catch (err) {
      console.error(`[DB] Schema error: ${err.message}`);
    }
  }

  console.log('[DB] Schema initialized successfully');
}

// Initialize schema before anything else
initSchema();

/**
 * Run database migrations.
 * @private
 */
function runMigrations() {
  // Try DATA_DIR first (Fly.io), fallback to local
  let migrationsDir = path.join(DATA_DIR, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.join(__dirname, '..', '..', 'data', 'migrations');
  }

  // Check if migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  // Run migration SQL files (skip awards migrations - those go in awards.db)
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.includes('awards'))
    .sort();

  for (const file of migrationFiles) {
    const migrationPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Remove line comments but preserve inline content
    const cleanedSql = sql
      .split('\n')
      .map(line => {
        // Remove full-line comments
        if (line.trim().startsWith('--')) return '';
        // Remove inline comments (but not within strings)
        const commentIndex = line.indexOf('--');
        if (commentIndex > 0) {
          return line.substring(0, commentIndex);
        }
        return line;
      })
      .join('\n');

    // Split by semicolon and execute non-empty statements
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (_err) {
        // Ignore errors (table/index already exists, etc.)
      }
    }
  }

  // Add columns to wines table for rating aggregates (SQLite can't IF NOT EXISTS for columns)
  const newColumns = [
    { name: 'producer', type: 'TEXT' },
    { name: 'country', type: 'TEXT' },
    { name: 'competition_index', type: 'REAL' },
    { name: 'critics_index', type: 'REAL' },
    { name: 'community_index', type: 'REAL' },
    { name: 'purchase_score', type: 'REAL' },
    { name: 'purchase_stars', type: 'REAL' },
    { name: 'confidence_level', type: 'TEXT' },
    { name: 'ratings_updated_at', type: 'DATETIME' },
    { name: 'tasting_notes', type: 'TEXT' },
    { name: 'vivino_id', type: 'INTEGER' },
    { name: 'vivino_url', type: 'TEXT' },
    { name: 'vivino_confirmed', type: 'INTEGER DEFAULT 0' },
    { name: 'vivino_confirmed_at', type: 'DATETIME' }
  ];

  for (const col of newColumns) {
    try {
      db.exec(`ALTER TABLE wines ADD COLUMN ${col.name} ${col.type}`);
    } catch (_err) {
      // Column already exists
    }
  }

}

/**
 * Run awards database migrations.
 * @private
 */
function runAwardsMigrations() {
  // Run awards-specific migration (011_awards_database.sql)
  const migrationsDir = path.join(__dirname, '..', '..', 'data', 'migrations');
  const awardsFile = path.join(migrationsDir, '011_awards_database.sql');

  if (fs.existsSync(awardsFile)) {
    const sql = fs.readFileSync(awardsFile, 'utf-8');

    // Remove line comments
    const cleanedSql = sql
      .split('\n')
      .map(line => {
        if (line.trim().startsWith('--')) return '';
        const commentIndex = line.indexOf('--');
        if (commentIndex > 0) {
          return line.substring(0, commentIndex);
        }
        return line;
      })
      .join('\n');

    // Split by semicolon and execute
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      try {
        awardsDb.exec(stmt);
      } catch (_err) {
        // Ignore errors (table/index already exists, etc.)
      }
    }
  }

  // Ensure competition_awards table has all columns
  const awardsColumns = [
    { name: 'producer', type: 'TEXT' },
    { name: 'wine_name_normalized', type: 'TEXT' },
    { name: 'award_normalized', type: 'TEXT' },
    { name: 'category', type: 'TEXT' },
    { name: 'region', type: 'TEXT' },
    { name: 'match_type', type: 'TEXT' },
    { name: 'match_confidence', type: 'REAL' },
    { name: 'extra_info', type: 'TEXT' }
  ];

  for (const col of awardsColumns) {
    try {
      awardsDb.exec(`ALTER TABLE competition_awards ADD COLUMN ${col.name} ${col.type}`);
    } catch (_err) {
      // Column already exists
    }
  }
}

// Run migrations on startup
runMigrations();
runAwardsMigrations();

/**
 * Cached prepared statements for frequently used queries.
 * Better-sqlite3 already caches statements internally, but this provides
 * a convenient API and ensures statements are reused efficiently.
 */
export const preparedStatements = {
  // Wine queries
  getWineById: db.prepare('SELECT * FROM wines WHERE id = ?'),
  getAllWines: db.prepare('SELECT * FROM wines ORDER BY colour, style, wine_name'),
  getWinesByColour: db.prepare('SELECT * FROM wines WHERE colour = ? ORDER BY style, wine_name'),
  
  // Slot queries
  getSlotByLocation: db.prepare('SELECT * FROM slots WHERE location_code = ?'),
  getAllSlots: db.prepare('SELECT * FROM slots ORDER BY zone, row_num, col_num'),
  getSlotsByWineId: db.prepare('SELECT * FROM slots WHERE wine_id = ? ORDER BY location_code'),
  
  // Ratings queries
  getRatingsByWineId: db.prepare('SELECT * FROM wine_ratings WHERE wine_id = ? ORDER BY fetched_at DESC'),
  
  // Reduce now queries
  getReduceNowByWineId: db.prepare('SELECT * FROM reduce_now WHERE wine_id = ?'),
  
  // Bottle count queries
  getBottleCount: db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id = ?'),
  
  // Settings queries
  getSetting: db.prepare('SELECT value FROM user_settings WHERE key = ?'),
  upsertSetting: db.prepare(`
    INSERT INTO user_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `)
};

export default db;
export { awardsDb };
