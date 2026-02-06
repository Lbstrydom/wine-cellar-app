#!/usr/bin/env node
/**
 * Create source_credentials table and run migration 051
 */

import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    console.log('=== Setting up source_credentials table ===\n');

    // Step 1: Create base table if it doesn't exist
    console.log('Step 1: Creating base table (if needed)...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS source_credentials (
        id SERIAL PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        username_encrypted TEXT,
        password_encrypted TEXT,
        auth_token_encrypted TEXT,
        token_expires_at TIMESTAMP,
        auth_status TEXT DEFAULT 'none' CHECK (auth_status IN ('none', 'valid', 'expired', 'failed')),
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_source_credentials_source ON source_credentials(source_id);
    `);
    console.log('✅ Base table ready\n');

    // Step 2: Run migration 051 to add cellar_id
    console.log('Step 2: Running migration 051 (add cellar_id)...');
    const migration051 = fs.readFileSync(
      path.join(__dirname, '..', 'data', 'migrations', '051_add_cellar_to_credentials.sql'),
      'utf8'
    );
    await pool.query(migration051);
    console.log('✅ Migration 051 completed\n');

    // Step 3: Verify final schema
    console.log('Step 3: Verifying schema...');
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'source_credentials'
      ORDER BY ordinal_position
    `);

    console.log('\nFinal schema:');
    columns.rows.forEach(col => {
      console.log(`  ✓ ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    // Check constraints
    const constraints = await pool.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'source_credentials'::regclass
    `);

    console.log('\nConstraints:');
    constraints.rows.forEach(con => {
      const type = con.contype === 'p' ? 'PRIMARY KEY' :
                   con.contype === 'u' ? 'UNIQUE' :
                   con.contype === 'c' ? 'CHECK' : con.contype;
      console.log(`  ✓ ${con.conname} (${type})`);
    });

    console.log('\n✅ All done! Credentials table ready for multi-user use.\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    if (err.hint) console.error('   Hint:', err.hint);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
