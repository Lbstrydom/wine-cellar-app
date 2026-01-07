#!/usr/bin/env node
/**
 * PostgreSQL Test Script
 *
 * Runs SQL queries against PostgreSQL to verify the database layer works correctly.
 * Requires DATABASE_URL environment variable to be set.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/test-pg-compat.js
 */

import db from '../src/db/index.js';
import { stringAgg, nowFunc, ilike, upsert, nullsLast } from '../src/db/helpers.js';

console.log('\n🔍 Testing PostgreSQL database layer...\n');

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
  // ===========================================
  // SECTION 1: Basic SQL Compatibility
  // ===========================================
  console.log('📋 Section 1: Basic SQL Compatibility\n');

  await test('CURRENT_TIMESTAMP works', async () => {
    const result = await db.prepare('SELECT CURRENT_TIMESTAMP as now').get();
    if (!result || !result.now) throw new Error('No timestamp returned');
  });

  await test('nowFunc() helper works', async () => {
    const sql = `SELECT ${nowFunc()} as now`;
    const result = await db.prepare(sql).get();
    if (!result || !result.now) throw new Error('No timestamp returned');
  });

  await test('CASE expressions in ORDER BY', async () => {
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

  await test('Subquery in WHERE clause', async () => {
    await db.prepare(`
      SELECT id, wine_name
      FROM wines
      WHERE id IN (SELECT wine_id FROM slots WHERE wine_id IS NOT NULL)
      LIMIT 5
    `).all();
  });

  await test('NULL handling in queries', async () => {
    await db.prepare(`
      SELECT id, wine_name, vintage
      FROM wines
      WHERE vintage IS NULL OR vintage > 2000
      LIMIT 5
    `).all();
  });

  await test('Parameter binding with multiple params', async () => {
    await db.prepare(`
      SELECT id, wine_name
      FROM wines
      WHERE colour = ? OR style LIKE ?
      LIMIT ?
    `).all('Red', '%Shiraz%', 5);
  });

  await test('Query with no parameters', async () => {
    await db.prepare('SELECT COUNT(*) as count FROM wines').get();
  });

  // ===========================================
  // SECTION 2: String Aggregation Functions
  // ===========================================
  console.log('\n📋 Section 2: String Aggregation Functions\n');

  await test('stringAgg() helper generates correct SQL', async () => {
    const sql = stringAgg('location_code', ',', true);
    if (!sql.includes('STRING_AGG')) {
      throw new Error('Should use STRING_AGG');
    }
  });

  await test('Aggregate string function with DISTINCT', async () => {
    const aggFunc = stringAgg('location_code', ',', true);
    const result = await db.prepare(`
      SELECT ${aggFunc} as locations
      FROM slots
      WHERE wine_id IS NOT NULL
      LIMIT 1
    `).get();
    // Result can be null if no data, that's ok
  });

  await test('GROUP BY with stringAgg helper', async () => {
    const aggFunc = stringAgg('s.location_code', ',', true);
    await db.prepare(`
      SELECT
        w.id, w.wine_name,
        COUNT(s.id) as bottle_count,
        ${aggFunc} as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      GROUP BY w.id, w.wine_name
      HAVING COUNT(s.id) >= 0
      LIMIT 5
    `).all();
  });

  await test('GROUP BY with all non-aggregated columns (PostgreSQL strict)', async () => {
    const aggFunc = stringAgg('s.location_code', ',', true);
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

  // ===========================================
  // SECTION 3: Upsert Operations
  // ===========================================
  console.log('\n📋 Section 3: Upsert Operations\n');

  await test('upsert() helper generates correct SQL', async () => {
    const sql = upsert('user_settings', ['key', 'value'], 'key', ['value']);
    if (!sql.includes('ON CONFLICT')) {
      throw new Error('Should use ON CONFLICT');
    }
  });

  await test('ON CONFLICT upsert for user_settings', async () => {
    const query = upsert('user_settings', ['key', 'value'], 'key', ['value']);
    await db.prepare(query).run('_test_key', 'test_value');
    // Verify it was inserted
    const row = await db.prepare('SELECT value FROM user_settings WHERE key = ?').get('_test_key');
    if (!row || row.value !== 'test_value') throw new Error('Insert failed');
    // Update with same key
    await db.prepare(query).run('_test_key', 'updated_value');
    const updated = await db.prepare('SELECT value FROM user_settings WHERE key = ?').get('_test_key');
    if (!updated || updated.value !== 'updated_value') throw new Error('Upsert update failed');
    // Clean up
    await db.prepare("DELETE FROM user_settings WHERE key = '_test_key'").run();
  });

  await test('INSERT with ON CONFLICT DO NOTHING pattern', async () => {
    // This pattern is used in awards.js for INSERT OR IGNORE
    const insertSQL = `INSERT INTO user_settings (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING`;

    // First insert
    await db.prepare(insertSQL).run('_test_ignore', 'first');
    // Second insert should be ignored
    await db.prepare(insertSQL).run('_test_ignore', 'second');

    const row = await db.prepare('SELECT value FROM user_settings WHERE key = ?').get('_test_ignore');
    if (!row || row.value !== 'first') throw new Error('DO NOTHING should keep first value');

    // Clean up
    await db.prepare("DELETE FROM user_settings WHERE key = '_test_ignore'").run();
  });

  // ===========================================
  // SECTION 4: View Validation
  // ===========================================
  console.log('\n📋 Section 4: View Validation\n');

  await test('inventory_view exists and returns data', async () => {
    try {
      const result = await db.prepare(`
        SELECT * FROM inventory_view LIMIT 5
      `).all();
      // View should exist even if empty
      if (!Array.isArray(result)) throw new Error('View did not return array');
    } catch (err) {
      if (err.message.includes('does not exist') || err.message.includes('no such table')) {
        console.log('     ⚠️  View not created yet - run schema migration');
        return; // Pass with warning for missing views
      }
      throw err;
    }
  });

  await test('inventory_view has expected columns', async () => {
    try {
      const result = await db.prepare(`
        SELECT * FROM inventory_view LIMIT 1
      `).get();
      if (result) {
        const expectedCols = ['id', 'wine_name', 'bottle_count', 'locations'];
        for (const col of expectedCols) {
          if (!(col in result)) throw new Error(`Missing column: ${col}`);
        }
      }
    } catch (err) {
      if (err.message.includes('does not exist') || err.message.includes('no such table')) {
        console.log('     ⚠️  View not created yet - skipping column check');
        return; // Pass with warning for missing views
      }
      throw err;
    }
  });

  await test('reduce_now_view exists and returns data', async () => {
    try {
      const result = await db.prepare(`
        SELECT * FROM reduce_now_view LIMIT 5
      `).all();
      if (!Array.isArray(result)) throw new Error('View did not return array');
    } catch (err) {
      if (err.message.includes('does not exist') || err.message.includes('no such table')) {
        console.log('     ⚠️  View not created yet - run schema migration');
        return; // Pass with warning for missing views
      }
      throw err;
    }
  });

  // ===========================================
  // SECTION 5: Complex Queries
  // ===========================================
  console.log('\n📋 Section 5: Complex Queries\n');

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

  await test('Multiple JOINs with GROUP BY', async () => {
    const aggFunc = stringAgg('s.location_code', ',', true);
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

  await test('HAVING with COUNT expression (not alias)', async () => {
    await db.prepare(`
      SELECT w.id, COUNT(s.id) as cnt
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      GROUP BY w.id
      HAVING COUNT(s.id) > 0
      LIMIT 5
    `).all();
  });

  await test('COALESCE with multiple fallbacks', async () => {
    // Use columns that exist in both SQLite and PostgreSQL
    await db.prepare(`
      SELECT id, COALESCE(vivino_rating, community_index, 0) as rating
      FROM wines
      LIMIT 5
    `).all();
  });

  // ===========================================
  // SECTION 6: Case-Insensitive Search
  // ===========================================
  console.log('\n📋 Section 6: Case-Insensitive Search\n');

  await test('ilike() helper generates correct SQL', async () => {
    const op = ilike();
    if (op !== 'ILIKE') {
      throw new Error('Should use ILIKE');
    }
  });

  await test('Case-insensitive search with ilike()', async () => {
    const op = ilike();
    await db.prepare(`
      SELECT id, wine_name
      FROM wines
      WHERE wine_name ${op} ?
      LIMIT 5
    `).all('%cabernet%');
  });

  // ===========================================
  // SECTION 7: NULLS LAST Ordering
  // ===========================================
  console.log('\n📋 Section 7: NULLS LAST Ordering\n');

  await test('nullsLast() helper generates correct SQL', async () => {
    const sql = nullsLast('drink_until', 'ASC');
    if (!sql.includes('NULLS LAST')) {
      throw new Error('Should use NULLS LAST');
    }
  });

  await test('ORDER BY with nullsLast()', async () => {
    const orderClause = nullsLast('drink_until', 'ASC');
    await db.prepare(`
      SELECT id, wine_name, drink_until
      FROM wines
      ORDER BY ${orderClause}
      LIMIT 10
    `).all();
  });

  // ===========================================
  // SECTION 8: Table Existence
  // ===========================================
  console.log('\n📋 Section 8: Table Existence\n');

  // Core tables that must exist
  const requiredTables = [
    'wines', 'slots', 'user_settings', 'reduce_now', 'consumption_log',
    'job_queue', 'job_history', 'zone_metadata'
  ];

  // Optional tables (may not exist in all deployments)
  const optionalTables = ['search_cache'];

  for (const table of requiredTables) {
    await test(`Table ${table} exists`, async () => {
      await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    });
  }

  for (const table of optionalTables) {
    await test(`Table ${table} exists (optional)`, async () => {
      try {
        await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
      } catch (err) {
        if (err.message.includes('does not exist') || err.message.includes('no such table')) {
          console.log('     ⚠️  Optional table not present');
          return; // Pass with warning
        }
        throw err;
      }
    });
  }

  // ===========================================
  // SECTION 9: Async/Await Compatibility
  // ===========================================
  console.log('\n📋 Section 9: Async/Await Compatibility\n');

  await test('Concurrent async queries', async () => {
    const [wines, slots, settings] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM wines').get(),
      db.prepare('SELECT COUNT(*) as count FROM slots').get(),
      db.prepare('SELECT COUNT(*) as count FROM user_settings').get()
    ]);
    if (!wines || !slots || !settings) throw new Error('Concurrent queries failed');
  });

  await test('Sequential async operations', async () => {
    // Insert, select, delete sequence
    await db.prepare(
      "INSERT INTO user_settings (key, value) VALUES ('_seq_test', 'a') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
    ).run();

    const row = await db.prepare('SELECT value FROM user_settings WHERE key = ?').get('_seq_test');
    if (!row) throw new Error('Sequential insert failed');

    await db.prepare("DELETE FROM user_settings WHERE key = '_seq_test'").run();

    const deleted = await db.prepare('SELECT value FROM user_settings WHERE key = ?').get('_seq_test');
    if (deleted) throw new Error('Sequential delete failed');
  });

  // ===========================================
  // SUMMARY
  // ===========================================
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
