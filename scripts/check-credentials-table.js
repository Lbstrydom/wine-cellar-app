#!/usr/bin/env node
/**
 * Check if source_credentials table exists and show its schema
 */

import 'dotenv/config';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkTable() {
  try {
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'source_credentials'
    `);

    if (tableCheck.rows.length === 0) {
      console.log('❌ source_credentials table does not exist');
      console.log('   Need to create it. Running migration 004 first...');
      await pool.end();
      return false;
    }

    console.log('✅ source_credentials table exists');

    // Check columns
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'source_credentials'
      ORDER BY ordinal_position
    `);

    console.log('\nCurrent schema:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    // Check if cellar_id exists
    const hasCellarId = columns.rows.some(col => col.column_name === 'cellar_id');
    if (hasCellarId) {
      console.log('\n✅ cellar_id column already exists - migration 051 may have been run');
    } else {
      console.log('\n⚠️  cellar_id column missing - need to run migration 051');
    }

    await pool.end();
    return true;
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    return false;
  }
}

checkTable();
