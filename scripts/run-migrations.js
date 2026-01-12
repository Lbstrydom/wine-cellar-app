#!/usr/bin/env node
/**
 * @fileoverview Run SQL migrations against PostgreSQL database
 *
 * Usage:
 *   node scripts/run-migrations.js [migration_numbers...]
 *
 * Examples:
 *   node scripts/run-migrations.js 027 028 029 030 031 032 033 034 035 036
 *   node scripts/run-migrations.js 027-036  (runs 027 through 036)
 */

import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'data', 'migrations');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration(filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    console.error(`  ❌ File not found: ${filename}`);
    return false;
  }

  const sql = fs.readFileSync(filepath, 'utf8');

  try {
    console.log(`  Running ${filename}...`);
    await pool.query(sql);
    console.log(`  ✅ ${filename} completed`);
    return true;
  } catch (err) {
    console.error(`  ❌ ${filename} failed: ${err.message}`);
    // Show more details for debugging
    if (err.detail) console.error(`     Detail: ${err.detail}`);
    if (err.hint) console.error(`     Hint: ${err.hint}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/run-migrations.js [migration_numbers...]');
    console.log('Example: node scripts/run-migrations.js 027 028 029');
    console.log('Example: node scripts/run-migrations.js 027-036');
    process.exit(1);
  }

  // Parse migration numbers
  let migrationNumbers = [];

  for (const arg of args) {
    if (arg.includes('-')) {
      // Range: 027-036
      const [start, end] = arg.split('-').map(n => parseInt(n, 10));
      for (let i = start; i <= end; i++) {
        migrationNumbers.push(String(i).padStart(3, '0'));
      }
    } else {
      migrationNumbers.push(arg.padStart(3, '0'));
    }
  }

  // Find matching migration files
  const allFiles = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  const migrations = [];

  for (const num of migrationNumbers) {
    const matching = allFiles.filter(f => f.startsWith(num + '_'));
    if (matching.length === 0) {
      console.warn(`Warning: No migration found for ${num}`);
    } else {
      migrations.push(...matching);
    }
  }

  // Sort by filename
  migrations.sort();

  console.log('\n=== Running Database Migrations ===\n');
  console.log(`Found ${migrations.length} migrations to run:\n`);
  migrations.forEach(m => console.log(`  - ${m}`));
  console.log('');

  let success = 0;
  let failed = 0;

  for (const migration of migrations) {
    const result = await runMigration(migration);
    if (result) {
      success++;
    } else {
      failed++;
      // Ask to continue or abort
      console.log('\n⚠️  Migration failed. Stopping to prevent cascade failures.\n');
      break;
    }
  }

  console.log('\n=== Migration Summary ===');
  console.log(`  ✅ Successful: ${success}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log('');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
