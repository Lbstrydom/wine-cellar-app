/**
 * @fileoverview Database connection and query helpers.
 * @module db
 */

import Database from 'libsql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'cellar.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/**
 * Run database migrations.
 * @private
 */
function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', '..', 'data', 'migrations');

  // Check if migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  // Run migration SQL files
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
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
    { name: 'tasting_notes', type: 'TEXT' }
  ];

  for (const col of newColumns) {
    try {
      db.exec(`ALTER TABLE wines ADD COLUMN ${col.name} ${col.type}`);
    } catch (_err) {
      // Column already exists
    }
  }

  // Ensure competition_awards table has all columns (migration might have run on old schema)
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
      db.exec(`ALTER TABLE competition_awards ADD COLUMN ${col.name} ${col.type}`);
    } catch (_err) {
      // Column already exists
    }
  }
}

// Run migrations on startup
runMigrations();

export default db;
