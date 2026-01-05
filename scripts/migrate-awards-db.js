#!/usr/bin/env node
/**
 * One-time migration script to move awards data from cellar.db to awards.db.
 * Run this once after updating to the separate awards database.
 *
 * Usage: node scripts/migrate-awards-db.js
 */

import Database from 'libsql';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const CELLAR_DB_PATH = path.join(DATA_DIR, 'cellar.db');
const AWARDS_DB_PATH = path.join(DATA_DIR, 'awards.db');

console.log('Awards Database Migration');
console.log('=========================\n');

// Check if cellar.db exists
if (!fs.existsSync(CELLAR_DB_PATH)) {
  console.log('No cellar.db found - nothing to migrate.');
  process.exit(0);
}

// Open both databases
const cellarDb = new Database(CELLAR_DB_PATH);
const awardsDb = new Database(AWARDS_DB_PATH);
awardsDb.pragma('journal_mode = WAL');

// Check if awards tables exist in cellar.db
const tables = cellarDb.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table' AND name IN ('award_sources', 'competition_awards', 'known_competitions')
`).all();

if (tables.length === 0) {
  console.log('No awards tables found in cellar.db - nothing to migrate.');
  process.exit(0);
}

console.log(`Found ${tables.length} awards tables in cellar.db: ${tables.map(t => t.name).join(', ')}\n`);

// Run migrations on awards.db first to ensure schema exists
const migrationsDir = path.join(DATA_DIR, 'migrations');
const awardsFile = path.join(migrationsDir, '011_awards_database.sql');

if (fs.existsSync(awardsFile)) {
  console.log('Applying awards schema to awards.db...');
  const sql = fs.readFileSync(awardsFile, 'utf-8');

  const cleanedSql = sql
    .split('\n')
    .map(line => {
      if (line.trim().startsWith('--')) return '';
      const commentIndex = line.indexOf('--');
      if (commentIndex > 0) return line.substring(0, commentIndex);
      return line;
    })
    .join('\n');

  const statements = cleanedSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    try {
      awardsDb.exec(stmt);
    } catch (err) {
      console.warn('Migration warning (likely already applied):', err.message);
    }
  }
  console.log('Schema applied.\n');
}

// Migrate known_competitions
try {
  const competitions = cellarDb.prepare('SELECT * FROM known_competitions').all();
  if (competitions.length > 0) {
    console.log(`Migrating ${competitions.length} known competitions...`);

    const insert = awardsDb.prepare(`
      INSERT OR REPLACE INTO known_competitions
      (id, name, short_name, country, scope, website, award_types, credibility, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const comp of competitions) {
      insert.run(
        comp.id, comp.name, comp.short_name, comp.country, comp.scope,
        comp.website, comp.award_types, comp.credibility, comp.notes, comp.created_at
      );
    }
    console.log(`  ✓ Migrated ${competitions.length} competitions`);
  }
} catch (err) {
  console.log('  No known_competitions to migrate or already migrated:', err.message);
}

// Migrate award_sources
try {
  const sources = cellarDb.prepare('SELECT * FROM award_sources').all();
  if (sources.length > 0) {
    console.log(`Migrating ${sources.length} award sources...`);

    // Check if already migrated
    const existing = awardsDb.prepare('SELECT COUNT(*) as count FROM award_sources').get().count;
    if (existing > 0) {
      console.log(`  Already have ${existing} sources in awards.db, skipping...`);
    } else {
      const insert = awardsDb.prepare(`
        INSERT INTO award_sources
        (id, competition_id, competition_name, year, source_url, source_type, imported_at, award_count, status, error_message, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const src of sources) {
        insert.run(
          src.id, src.competition_id, src.competition_name, src.year, src.source_url,
          src.source_type, src.imported_at, src.award_count, src.status, src.error_message, src.notes
        );
      }
      console.log(`  ✓ Migrated ${sources.length} sources`);
    }
  }
} catch (err) {
  console.log(`  Error migrating award_sources: ${err.message}`);
}

// Migrate competition_awards
try {
  const awards = cellarDb.prepare('SELECT * FROM competition_awards').all();
  if (awards.length > 0) {
    console.log(`Migrating ${awards.length} competition awards...`);

    // Check if already migrated
    const existing = awardsDb.prepare('SELECT COUNT(*) as count FROM competition_awards').get().count;
    if (existing > 0) {
      console.log(`  Already have ${existing} awards in awards.db, skipping...`);
    } else {
      const insert = awardsDb.prepare(`
        INSERT INTO competition_awards
        (id, source_id, producer, wine_name, wine_name_normalized, vintage, award, award_normalized,
         category, region, matched_wine_id, match_type, match_confidence, extra_info, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const award of awards) {
        insert.run(
          award.id, award.source_id, award.producer, award.wine_name, award.wine_name_normalized,
          award.vintage, award.award, award.award_normalized, award.category, award.region,
          award.matched_wine_id, award.match_type, award.match_confidence, award.extra_info, award.created_at
        );
      }
      console.log(`  ✓ Migrated ${awards.length} awards`);
    }
  }
} catch (err) {
  console.log(`  Error migrating competition_awards: ${err.message}`);
}

console.log('\n✓ Migration complete!');
console.log('\nYou can optionally clean up the old tables in cellar.db by running:');
console.log('  DROP TABLE IF EXISTS competition_awards;');
console.log('  DROP TABLE IF EXISTS award_sources;');
console.log('  DROP TABLE IF EXISTS known_competitions;');

cellarDb.close();
awardsDb.close();
