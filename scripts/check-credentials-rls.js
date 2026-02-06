#!/usr/bin/env node
/**
 * Verify RLS policies on source_credentials
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

async function checkRLS() {
  try {
    // Check if RLS is enabled
    const rlsEnabled = await pool.query(`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname = 'source_credentials'
    `);

    console.log('=== Row Level Security Status ===\n');
    if (rlsEnabled.rows[0]?.relrowsecurity) {
      console.log('✅ RLS is ENABLED on source_credentials');
    } else {
      console.log('❌ RLS is DISABLED on source_credentials');
    }

    // Check policies
    const policies = await pool.query(`
      SELECT 
        polname as policy_name,
        polcmd as command
      FROM pg_policy
      WHERE polrelid = 'source_credentials'::regclass
    `);

    if (policies.rows.length === 0) {
      console.log('⚠️  No RLS policies defined\n');
    } else {
      console.log('\nPolicies:');
      policies.rows.forEach(pol => {
        console.log(`  ✓ ${pol.policy_name} (${pol.command || 'ALL'})`);
      });
      console.log('');
    }

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

checkRLS();
