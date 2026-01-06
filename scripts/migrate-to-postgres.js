#!/usr/bin/env node
/**
 * @fileoverview Migrate data from SQLite to PostgreSQL (Supabase)
 *
 * Usage:
 *   1. Set DATABASE_URL env var to your Supabase connection string
 *   2. Ensure SQLite databases exist in ./data/
 *   3. Run: node scripts/migrate-to-postgres.js
 *
 * This script:
 *   - Connects to local SQLite databases (cellar.db, awards.db)
 *   - Creates PostgreSQL schema if needed
 *   - Migrates all data preserving IDs and relationships
 */

import pg from 'pg';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const DATA_DIR = path.join(__dirname, '..', 'data');
const CELLAR_DB = path.join(DATA_DIR, 'cellar.db');
const AWARDS_DB = path.join(DATA_DIR, 'awards.db');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is required');
  console.error('Set it to your Supabase connection string');
  process.exit(1);
}

// PostgreSQL connection
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// SQLite connections
let cellarDb, awardsDb;

async function main() {
  console.log('=== Wine Cellar SQLite to PostgreSQL Migration ===\n');

  // Check SQLite databases exist
  if (!fs.existsSync(CELLAR_DB)) {
    console.error(`Error: SQLite database not found at ${CELLAR_DB}`);
    console.error('Download it from Synology first using: .\\scripts\\sync-db.ps1 -Download');
    process.exit(1);
  }

  console.log(`SQLite source: ${CELLAR_DB}`);
  console.log(`PostgreSQL target: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  // Open SQLite databases
  cellarDb = new Database(CELLAR_DB, { readonly: true });
  if (fs.existsSync(AWARDS_DB)) {
    awardsDb = new Database(AWARDS_DB, { readonly: true });
  }

  try {
    // Test PostgreSQL connection
    const result = await pool.query('SELECT NOW() as now');
    console.log(`Connected to PostgreSQL at ${result.rows[0].now}\n`);

    // Run migration steps
    await createSchema();
    await migrateWines();
    await migrateSlots();
    await migrateReduceNow();
    await migrateConsumptionLog();
    await migrateWineRatings();
    await migrateDrinkingWindows();
    await migrateUserSettings();
    await migrateZoneAllocations();
    await migrateZoneMetadata();

    if (awardsDb) {
      await migrateAwardSources();
      await migrateCompetitionAwards();
      await migrateKnownCompetitions();
    }

    console.log('\n=== Migration Complete ===');

    // Show final counts
    const pgWineCount = await pool.query('SELECT COUNT(*) as count FROM wines');
    const pgSlotCount = await pool.query('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL');
    console.log(`\nPostgreSQL now has:`);
    console.log(`  - ${pgWineCount.rows[0].count} wines`);
    console.log(`  - ${pgSlotCount.rows[0].count} bottles in slots`);

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    cellarDb.close();
    if (awardsDb) awardsDb.close();
    await pool.end();
  }
}

async function createSchema() {
  console.log('Creating PostgreSQL schema...');

  const schemaPath = path.join(__dirname, '..', 'docs', 'POSTGRESQL_MIGRATION.md');

  // Extract SQL from migration doc (between ```sql and ```)
  // For now, we'll create tables inline

  const schemaSql = `
    -- Create tables if they don't exist
    CREATE TABLE IF NOT EXISTS wines (
        id SERIAL PRIMARY KEY,
        style TEXT NOT NULL,
        colour TEXT NOT NULL,
        wine_name TEXT NOT NULL,
        vintage INTEGER,
        vivino_rating REAL,
        price_eur REAL,
        notes TEXT,
        country TEXT,
        tasting_notes TEXT,
        competition_index REAL,
        critics_index REAL,
        community_index REAL,
        purchase_score REAL,
        purchase_stars REAL,
        confidence_level TEXT,
        ratings_updated_at TIMESTAMP,
        drink_from INTEGER,
        drink_peak INTEGER,
        drink_until INTEGER,
        grapes TEXT,
        region TEXT,
        appellation TEXT,
        winemaking TEXT,
        sweetness TEXT DEFAULT 'dry',
        zone_id TEXT,
        zone_confidence TEXT,
        producer TEXT,
        vivino_id INTEGER,
        vivino_url TEXT,
        vivino_confirmed BOOLEAN DEFAULT FALSE,
        vivino_confirmed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS style_mappings (
        id SERIAL PRIMARY KEY,
        style_original TEXT NOT NULL,
        style_norm TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slots (
        id SERIAL PRIMARY KEY,
        zone TEXT NOT NULL,
        location_code TEXT NOT NULL UNIQUE,
        row_num INTEGER NOT NULL,
        col_num INTEGER,
        wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
        UNIQUE(zone, row_num, col_num)
    );

    CREATE TABLE IF NOT EXISTS reduce_now (
        id SERIAL PRIMARY KEY,
        wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 3,
        reduce_reason TEXT,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS consumption_log (
        id SERIAL PRIMARY KEY,
        wine_id INTEGER NOT NULL REFERENCES wines(id),
        slot_location TEXT,
        consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        occasion TEXT,
        pairing_dish TEXT,
        rating INTEGER,
        notes TEXT
    );

    CREATE TABLE IF NOT EXISTS pairing_rules (
        id SERIAL PRIMARY KEY,
        food_signal TEXT NOT NULL,
        wine_style_bucket TEXT NOT NULL,
        match_level TEXT NOT NULL,
        UNIQUE(food_signal, wine_style_bucket)
    );

    CREATE TABLE IF NOT EXISTS wine_ratings (
        id SERIAL PRIMARY KEY,
        wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
        vintage INTEGER,
        source TEXT NOT NULL,
        source_lens TEXT NOT NULL,
        score_type TEXT NOT NULL,
        raw_score TEXT NOT NULL,
        raw_score_numeric REAL,
        normalized_min REAL NOT NULL,
        normalized_max REAL NOT NULL,
        normalized_mid REAL NOT NULL,
        award_name TEXT,
        competition_year INTEGER,
        reviewer_name TEXT,
        rating_count INTEGER,
        source_url TEXT,
        evidence_excerpt TEXT,
        matched_wine_label TEXT,
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        vintage_match TEXT DEFAULT 'exact',
        match_confidence TEXT DEFAULT 'high',
        is_user_override BOOLEAN DEFAULT FALSE,
        override_normalized_mid REAL,
        override_note TEXT,
        UNIQUE(wine_id, vintage, source, competition_year, award_name)
    );

    CREATE TABLE IF NOT EXISTS drinking_windows (
        id SERIAL PRIMARY KEY,
        wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        drink_from_year INTEGER,
        drink_by_year INTEGER,
        peak_year INTEGER,
        confidence TEXT DEFAULT 'medium',
        raw_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(wine_id, source)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zone_allocations (
        zone_id TEXT PRIMARY KEY,
        assigned_rows TEXT NOT NULL,
        first_wine_date TIMESTAMP,
        wine_count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zone_metadata (
        zone_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        purpose TEXT,
        style_range TEXT,
        serving_temp TEXT,
        aging_advice TEXT,
        pairing_hints TEXT,
        example_wines TEXT,
        family TEXT,
        seasonal_notes TEXT,
        ai_suggested_at TIMESTAMP,
        user_confirmed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS award_sources (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL,
        competition_name TEXT NOT NULL,
        year INTEGER NOT NULL,
        source_url TEXT,
        source_type TEXT NOT NULL,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        award_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        notes TEXT
    );

    CREATE TABLE IF NOT EXISTS competition_awards (
        id SERIAL PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES award_sources(id) ON DELETE CASCADE,
        producer TEXT,
        wine_name TEXT NOT NULL,
        wine_name_normalized TEXT,
        vintage INTEGER,
        award TEXT NOT NULL,
        award_normalized TEXT,
        category TEXT,
        region TEXT,
        matched_wine_id INTEGER,
        match_type TEXT,
        match_confidence REAL,
        extra_info TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_id, wine_name, vintage, award)
    );

    CREATE TABLE IF NOT EXISTS known_competitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT,
        country TEXT,
        scope TEXT DEFAULT 'regional',
        website TEXT,
        award_types TEXT,
        credibility REAL DEFAULT 0.85,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_slots_wine ON slots(wine_id);
    CREATE INDEX IF NOT EXISTS idx_slots_zone ON slots(zone);
    CREATE INDEX IF NOT EXISTS idx_reduce_now_priority ON reduce_now(priority);
    CREATE INDEX IF NOT EXISTS idx_wines_style ON wines(style);
    CREATE INDEX IF NOT EXISTS idx_wines_colour ON wines(colour);
    CREATE INDEX IF NOT EXISTS idx_wines_zone ON wines(zone_id);
    CREATE INDEX IF NOT EXISTS idx_wines_country ON wines(country);
    CREATE INDEX IF NOT EXISTS idx_ratings_wine ON wine_ratings(wine_id);
    CREATE INDEX IF NOT EXISTS idx_drinking_windows_wine_id ON drinking_windows(wine_id);
    CREATE INDEX IF NOT EXISTS idx_competition_awards_source ON competition_awards(source_id);
    CREATE INDEX IF NOT EXISTS idx_competition_awards_wine ON competition_awards(matched_wine_id);
  `;

  await pool.query(schemaSql);
  console.log('  Schema created successfully');
}

async function migrateWines() {
  console.log('Migrating wines...');

  const wines = cellarDb.prepare('SELECT * FROM wines').all();
  console.log(`  Found ${wines.length} wines in SQLite`);

  if (wines.length === 0) return;

  // Clear existing data
  await pool.query('DELETE FROM wines');

  // Reset sequence
  await pool.query("SELECT setval('wines_id_seq', 1, false)");

  for (const wine of wines) {
    await pool.query(`
      INSERT INTO wines (id, style, colour, wine_name, vintage, vivino_rating, price_eur, notes,
        country, tasting_notes, competition_index, critics_index, community_index,
        purchase_score, purchase_stars, confidence_level, ratings_updated_at,
        drink_from, drink_peak, drink_until, grapes, region, appellation, winemaking,
        sweetness, zone_id, zone_confidence, producer, vivino_id, vivino_url,
        vivino_confirmed, vivino_confirmed_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
      ON CONFLICT (id) DO NOTHING
    `, [
      wine.id, wine.style, wine.colour, wine.wine_name, wine.vintage,
      wine.vivino_rating, wine.price_eur, wine.notes, wine.country, wine.tasting_notes,
      wine.competition_index, wine.critics_index, wine.community_index,
      wine.purchase_score, wine.purchase_stars, wine.confidence_level, wine.ratings_updated_at,
      wine.drink_from, wine.drink_peak, wine.drink_until,
      wine.grapes, wine.region, wine.appellation, wine.winemaking,
      wine.sweetness || 'dry', wine.zone_id, wine.zone_confidence,
      wine.producer, wine.vivino_id, wine.vivino_url,
      Boolean(wine.vivino_confirmed), wine.vivino_confirmed_at,
      wine.created_at, wine.updated_at
    ]);
  }

  // Update sequence to max id
  await pool.query("SELECT setval('wines_id_seq', (SELECT COALESCE(MAX(id), 0) FROM wines))");

  console.log(`  Migrated ${wines.length} wines`);
}

async function migrateSlots() {
  console.log('Migrating slots...');

  const slots = cellarDb.prepare('SELECT * FROM slots').all();
  console.log(`  Found ${slots.length} slots in SQLite`);

  if (slots.length === 0) return;

  await pool.query('DELETE FROM slots');
  await pool.query("SELECT setval('slots_id_seq', 1, false)");

  for (const slot of slots) {
    await pool.query(`
      INSERT INTO slots (id, zone, location_code, row_num, col_num, wine_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
    `, [slot.id, slot.zone, slot.location_code, slot.row_num, slot.col_num, slot.wine_id]);
  }

  await pool.query("SELECT setval('slots_id_seq', (SELECT COALESCE(MAX(id), 0) FROM slots))");

  const occupied = slots.filter(s => s.wine_id).length;
  console.log(`  Migrated ${slots.length} slots (${occupied} occupied)`);
}

async function migrateReduceNow() {
  console.log('Migrating reduce_now...');

  try {
    const rows = cellarDb.prepare('SELECT * FROM reduce_now').all();
    if (rows.length === 0) {
      console.log('  No reduce_now entries');
      return;
    }

    await pool.query('DELETE FROM reduce_now');
    await pool.query("SELECT setval('reduce_now_id_seq', 1, false)");

    for (const row of rows) {
      await pool.query(`
        INSERT INTO reduce_now (id, wine_id, priority, reduce_reason, added_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.wine_id, row.priority, row.reduce_reason, row.added_at]);
    }

    await pool.query("SELECT setval('reduce_now_id_seq', (SELECT COALESCE(MAX(id), 0) FROM reduce_now))");
    console.log(`  Migrated ${rows.length} reduce_now entries`);
  } catch (err) {
    console.log(`  Table reduce_now not found or empty`);
  }
}

async function migrateConsumptionLog() {
  console.log('Migrating consumption_log...');

  try {
    const rows = cellarDb.prepare('SELECT * FROM consumption_log').all();
    if (rows.length === 0) {
      console.log('  No consumption log entries');
      return;
    }

    await pool.query('DELETE FROM consumption_log');
    await pool.query("SELECT setval('consumption_log_id_seq', 1, false)");

    for (const row of rows) {
      await pool.query(`
        INSERT INTO consumption_log (id, wine_id, slot_location, consumed_at, occasion, pairing_dish, rating, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.wine_id, row.slot_location, row.consumed_at, row.occasion, row.pairing_dish, row.rating, row.notes]);
    }

    await pool.query("SELECT setval('consumption_log_id_seq', (SELECT COALESCE(MAX(id), 0) FROM consumption_log))");
    console.log(`  Migrated ${rows.length} consumption log entries`);
  } catch (err) {
    console.log(`  Table consumption_log not found or empty`);
  }
}

async function migrateWineRatings() {
  console.log('Migrating wine_ratings...');

  try {
    const rows = cellarDb.prepare('SELECT * FROM wine_ratings').all();
    if (rows.length === 0) {
      console.log('  No wine ratings');
      return;
    }

    await pool.query('DELETE FROM wine_ratings');
    await pool.query("SELECT setval('wine_ratings_id_seq', 1, false)");

    for (const row of rows) {
      await pool.query(`
        INSERT INTO wine_ratings (id, wine_id, vintage, source, source_lens, score_type, raw_score,
          raw_score_numeric, normalized_min, normalized_max, normalized_mid, award_name,
          competition_year, reviewer_name, rating_count, source_url, evidence_excerpt,
          matched_wine_label, fetched_at, vintage_match, match_confidence, is_user_override,
          override_normalized_mid, override_note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT DO NOTHING
      `, [
        row.id, row.wine_id, row.vintage, row.source, row.source_lens, row.score_type, row.raw_score,
        row.raw_score_numeric, row.normalized_min, row.normalized_max, row.normalized_mid, row.award_name,
        row.competition_year, row.reviewer_name, row.rating_count, row.source_url, row.evidence_excerpt,
        row.matched_wine_label, row.fetched_at, row.vintage_match, row.match_confidence,
        Boolean(row.is_user_override), row.override_normalized_mid, row.override_note
      ]);
    }

    await pool.query("SELECT setval('wine_ratings_id_seq', (SELECT COALESCE(MAX(id), 0) FROM wine_ratings))");
    console.log(`  Migrated ${rows.length} wine ratings`);
  } catch (err) {
    console.log(`  Table wine_ratings not found or empty`);
  }
}

async function migrateDrinkingWindows() {
  console.log('Migrating drinking_windows...');

  try {
    const rows = cellarDb.prepare('SELECT * FROM drinking_windows').all();
    if (rows.length === 0) {
      console.log('  No drinking windows');
      return;
    }

    await pool.query('DELETE FROM drinking_windows');
    await pool.query("SELECT setval('drinking_windows_id_seq', 1, false)");

    for (const row of rows) {
      await pool.query(`
        INSERT INTO drinking_windows (id, wine_id, source, drink_from_year, drink_by_year, peak_year, confidence, raw_text, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT DO NOTHING
      `, [row.id, row.wine_id, row.source, row.drink_from_year, row.drink_by_year, row.peak_year, row.confidence, row.raw_text, row.created_at, row.updated_at]);
    }

    await pool.query("SELECT setval('drinking_windows_id_seq', (SELECT COALESCE(MAX(id), 0) FROM drinking_windows))");
    console.log(`  Migrated ${rows.length} drinking windows`);
  } catch (err) {
    console.log(`  Table drinking_windows not found or empty`);
  }
}

async function migrateUserSettings() {
  console.log('Migrating user_settings...');

  try {
    const rows = cellarDb.prepare('SELECT * FROM user_settings').all();
    if (rows.length === 0) {
      console.log('  No user settings');
      return;
    }

    await pool.query('DELETE FROM user_settings');

    for (const row of rows) {
      await pool.query(`
        INSERT INTO user_settings (key, value, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `, [row.key, row.value, row.updated_at]);
    }

    console.log(`  Migrated ${rows.length} user settings`);
  } catch (err) {
    console.log(`  Table user_settings not found or empty`);
  }
}

async function migrateZoneAllocations() {
  console.log('Migrating zone_allocations...');

  try {
    const rows = cellarDb.prepare('SELECT * FROM zone_allocations').all();
    if (rows.length === 0) {
      console.log('  No zone allocations');
      return;
    }

    await pool.query('DELETE FROM zone_allocations');

    for (const row of rows) {
      await pool.query(`
        INSERT INTO zone_allocations (zone_id, assigned_rows, first_wine_date, wine_count, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (zone_id) DO NOTHING
      `, [row.zone_id, row.assigned_rows, row.first_wine_date, row.wine_count, row.updated_at]);
    }

    console.log(`  Migrated ${rows.length} zone allocations`);
  } catch (err) {
    console.log(`  Table zone_allocations not found or empty`);
  }
}

async function migrateZoneMetadata() {
  console.log('Migrating zone_metadata...');

  try {
    const rows = cellarDb.prepare('SELECT * FROM zone_metadata').all();
    if (rows.length === 0) {
      console.log('  No zone metadata');
      return;
    }

    await pool.query('DELETE FROM zone_metadata');

    for (const row of rows) {
      await pool.query(`
        INSERT INTO zone_metadata (zone_id, display_name, purpose, style_range, serving_temp,
          aging_advice, pairing_hints, example_wines, family, seasonal_notes,
          ai_suggested_at, user_confirmed_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (zone_id) DO NOTHING
      `, [
        row.zone_id, row.display_name, row.purpose, row.style_range, row.serving_temp,
        row.aging_advice, row.pairing_hints, row.example_wines, row.family, row.seasonal_notes,
        row.ai_suggested_at, row.user_confirmed_at, row.updated_at
      ]);
    }

    console.log(`  Migrated ${rows.length} zone metadata entries`);
  } catch (err) {
    console.log(`  Table zone_metadata not found or empty`);
  }
}

async function migrateAwardSources() {
  console.log('Migrating award_sources...');

  try {
    const rows = awardsDb.prepare('SELECT * FROM award_sources').all();
    if (rows.length === 0) {
      console.log('  No award sources');
      return;
    }

    await pool.query('DELETE FROM award_sources');

    for (const row of rows) {
      await pool.query(`
        INSERT INTO award_sources (id, competition_id, competition_name, year, source_url, source_type, imported_at, award_count, status, error_message, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.competition_id, row.competition_name, row.year, row.source_url, row.source_type, row.imported_at, row.award_count, row.status, row.error_message, row.notes]);
    }

    console.log(`  Migrated ${rows.length} award sources`);
  } catch (err) {
    console.log(`  Table award_sources not found or empty`);
  }
}

async function migrateCompetitionAwards() {
  console.log('Migrating competition_awards...');

  try {
    const rows = awardsDb.prepare('SELECT * FROM competition_awards').all();
    if (rows.length === 0) {
      console.log('  No competition awards');
      return;
    }

    await pool.query('DELETE FROM competition_awards');
    await pool.query("SELECT setval('competition_awards_id_seq', 1, false)");

    for (const row of rows) {
      await pool.query(`
        INSERT INTO competition_awards (id, source_id, producer, wine_name, wine_name_normalized, vintage, award, award_normalized, category, region, matched_wine_id, match_type, match_confidence, extra_info, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT DO NOTHING
      `, [row.id, row.source_id, row.producer, row.wine_name, row.wine_name_normalized, row.vintage, row.award, row.award_normalized, row.category, row.region, row.matched_wine_id, row.match_type, row.match_confidence, row.extra_info, row.created_at]);
    }

    await pool.query("SELECT setval('competition_awards_id_seq', (SELECT COALESCE(MAX(id), 0) FROM competition_awards))");
    console.log(`  Migrated ${rows.length} competition awards`);
  } catch (err) {
    console.log(`  Table competition_awards not found or empty`);
  }
}

async function migrateKnownCompetitions() {
  console.log('Migrating known_competitions...');

  try {
    const rows = awardsDb.prepare('SELECT * FROM known_competitions').all();
    if (rows.length === 0) {
      console.log('  No known competitions');
      return;
    }

    // Don't delete - let schema seed them, just add any missing
    for (const row of rows) {
      await pool.query(`
        INSERT INTO known_competitions (id, name, short_name, country, scope, website, award_types, credibility, notes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.name, row.short_name, row.country, row.scope, row.website, row.award_types, row.credibility, row.notes, row.created_at]);
    }

    console.log(`  Migrated ${rows.length} known competitions`);
  } catch (err) {
    console.log(`  Table known_competitions not found or empty`);
  }
}

// Run migration
main();
