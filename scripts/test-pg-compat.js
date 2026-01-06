#!/usr/bin/env node
/**
 * PostgreSQL Compatibility Test Script
 *
 * Runs critical SQL queries against the database to verify PostgreSQL compatibility.
 * Use with DATABASE_URL set to test against PostgreSQL, or without to test SQLite.
 *
 * Usage:
 *   node scripts/test-pg-compat.js           # Test current DB (SQLite or PG based on DATABASE_URL)
 *   DATABASE_URL="..." node scripts/test-pg-compat.js  # Test against specific PostgreSQL
 */

import db from '../src/db/index.js';

const isPostgres = !!process.env.DATABASE_URL;
console.log(`\n🔍 Testing ${isPostgres ? 'PostgreSQL' : 'SQLite'} compatibility...\n`);

const tests = [];
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${err.message}`);
    failed++;
    tests.push({ name, error: err.message });
  }
}

async function runTests() {
  console.log('📋 Running SQL compatibility tests...\n');

  // Test 1: Basic SELECT with CURRENT_TIMESTAMP
  await test('CURRENT_TIMESTAMP works', async () => {
    const result = await db.prepare('SELECT CURRENT_TIMESTAMP as now').get();
    if (!result || !result.now) throw new Error('No timestamp returned');
  });

  // Test 2: STRING_AGG / GROUP_CONCAT
  await test('Aggregate string function works', async () => {
    const aggFunc = process.env.DATABASE_URL
      ? "STRING_AGG(DISTINCT location_code, ',')"
      : 'GROUP_CONCAT(DISTINCT location_code)';
    const result = await db.prepare(`
      SELECT ${aggFunc} as locations
      FROM slots
      WHERE wine_id IS NOT NULL
      LIMIT 1
    `).get();
    // Result can be null if no data, that's ok
  });

  // Test 3: GROUP BY with all columns (PostgreSQL strict mode)
  await test('GROUP BY with non-aggregated columns', async () => {
    const aggFunc = process.env.DATABASE_URL
      ? "STRING_AGG(DISTINCT s.location_code, ',')"
      : 'GROUP_CONCAT(DISTINCT s.location_code)';
    await db.prepare(`
      SELECT
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        ${aggFunc} as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      GROUP BY w.id, w.wine_name, w.vintage, w.style, w.colour
      HAVING COUNT(s.id) >= 0
      LIMIT 5
    `).all();
  });

  // Test 4: LEFT JOIN with aggregate functions
  await test('LEFT JOIN with MIN/MAX aggregates', async () => {
    await db.prepare(`
      SELECT
        w.id,
        w.wine_name,
        COALESCE(MIN(rn.priority), 99) as reduce_priority,
        MAX(rn.reduce_reason) as reduce_reason
      FROM wines w
      LEFT JOIN reduce_now rn ON w.id = rn.wine_id
      GROUP BY w.id, w.wine_name
      LIMIT 5
    `).all();
  });

  // Test 5: CASE expressions in ORDER BY
  await test('CASE in ORDER BY', async () => {
    await db.prepare(`
      SELECT id, wine_name
      FROM wines
      ORDER BY
        CASE colour
          WHEN 'Red' THEN 1
          WHEN 'White' THEN 2
          ELSE 3
        END
      LIMIT 5
    `).all();
  });

  // Test 6: ON CONFLICT (UPSERT)
  await test('ON CONFLICT upsert syntax', async () => {
    // Just verify the syntax parses - don't actually insert
    const query = process.env.DATABASE_URL
      ? `INSERT INTO user_settings (key, value) VALUES ('_test_key', 'test')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      : `INSERT OR REPLACE INTO user_settings (key, value) VALUES ('_test_key', 'test')`;

    await db.prepare(query).run();
    // Clean up
    await db.prepare("DELETE FROM user_settings WHERE key = '_test_key'").run();
  });

  // Test 7: Subquery in WHERE
  await test('Subquery in WHERE clause', async () => {
    await db.prepare(`
      SELECT id, wine_name
      FROM wines
      WHERE id IN (SELECT wine_id FROM slots WHERE wine_id IS NOT NULL)
      LIMIT 5
    `).all();
  });

  // Test 8: HAVING with expression (not alias)
  await test('HAVING with COUNT expression', async () => {
    await db.prepare(`
      SELECT w.id, COUNT(s.id) as cnt
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      GROUP BY w.id
      HAVING COUNT(s.id) > 0
      LIMIT 5
    `).all();
  });

  // Test 9: Multiple JOINs with GROUP BY
  await test('Multiple JOINs with GROUP BY', async () => {
    const aggFunc = process.env.DATABASE_URL
      ? "STRING_AGG(DISTINCT s.location_code, ',')"
      : 'GROUP_CONCAT(DISTINCT s.location_code)';
    await db.prepare(`
      SELECT
        w.id, w.wine_name,
        COUNT(s.id) as bottle_count,
        ${aggFunc} as locations,
        COALESCE(MIN(rn.priority), 99) as reduce_priority
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      LEFT JOIN reduce_now rn ON w.id = rn.wine_id
      GROUP BY w.id, w.wine_name
      LIMIT 5
    `).all();
  });

  // Test 10: Parameter binding
  await test('Parameter binding with multiple params', async () => {
    const result = await db.prepare(`
      SELECT id, wine_name
      FROM wines
      WHERE colour = ? OR style LIKE ?
      LIMIT ?
    `).all('Red', '%Shiraz%', 5);
  });

  // Test 11: Empty parameter list (no params when none needed)
  await test('Query with no parameters', async () => {
    await db.prepare('SELECT COUNT(*) as count FROM wines').get();
  });

  // Test 12: NULL handling
  await test('NULL handling in queries', async () => {
    await db.prepare(`
      SELECT id, wine_name, vintage
      FROM wines
      WHERE vintage IS NULL OR vintage > 2000
      LIMIT 5
    `).all();
  });

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('❌ Failed tests:');
    tests.forEach(t => {
      console.log(`   - ${t.name}: ${t.error}`);
    });
    console.log('\n');
    process.exit(1);
  } else {
    console.log('✅ All PostgreSQL compatibility tests passed!\n');
    process.exit(0);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
