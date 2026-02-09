/**
 * @fileoverview Phase 6 end-to-end integration test
 * Tests the full wine add orchestrator pipeline
 *
 * NOTE: These tests require DATABASE_URL to be set as they access the database directly.
 * They will be skipped if DATABASE_URL is not configured.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// Skip all tests if DATABASE_URL is not set
const hasDatabase = !!process.env.DATABASE_URL;

// Conditionally import db and orchestrator only when DATABASE_URL is available
let db;
let evaluateWineAdd;

if (hasDatabase) {
  db = (await import('../../src/db/index.js')).default;
  evaluateWineAdd = (await import('../../src/services/wine/wineAddOrchestrator.js')).evaluateWineAdd;
}

const TEST_CELLAR_ID = '00000000-0000-0000-0000-000000000001';
const DIFFERENT_CELLAR = '00000000-0000-0000-0000-000000000002';

describe.skipIf(!hasDatabase)('Phase 6: Wine Add Orchestrator Integration', () => {
  let testWineId;
  let testFingerprint;

  beforeAll(async () => {
    // Ensure test cellars exist (must reference a valid profile)
    // First create a test profile if it doesn't exist
    await db.prepare(`
      INSERT INTO profiles (id, email, display_name)
      VALUES ($1, 'test@example.com', 'Test User')
      ON CONFLICT (id) DO NOTHING
    `).run(TEST_CELLAR_ID);
    
    // Then create cellars
    await db.prepare(`
      INSERT INTO cellars (id, name, created_by)
      VALUES ($1, 'Test Cellar 1', $2)
      ON CONFLICT (id) DO NOTHING
    `).run(TEST_CELLAR_ID, TEST_CELLAR_ID);
    
    await db.prepare(`
      INSERT INTO cellars (id, name, created_by)
      VALUES ($1, 'Test Cellar 2', $2)
      ON CONFLICT (id) DO NOTHING
    `).run(DIFFERENT_CELLAR, TEST_CELLAR_ID);
  });

  afterEach(async () => {
    // Cleanup: delete test wine if created
    if (testWineId) {
      await db.prepare('DELETE FROM wine_source_ratings WHERE wine_id = $1').run(testWineId);
      await db.prepare('DELETE FROM wine_external_ids WHERE wine_id = $1').run(testWineId);
      await db.prepare('DELETE FROM wines WHERE id = $1').run(testWineId);
      testWineId = null;
    }
    // Cleanup cache by fingerprint + cellar_id
    if (testFingerprint && TEST_CELLAR_ID) {
      await db.prepare('DELETE FROM wine_search_cache WHERE cellar_id = $1 AND fingerprint = $2')
        .run(TEST_CELLAR_ID, testFingerprint);
      await db.prepare(`DELETE FROM wine_search_cache WHERE cellar_id IS NULL AND fingerprint = $1 AND cache_scope = 'global'`)
        .run(testFingerprint);
    }
  });

  it('generates fingerprint for new wine', async () => {
    const input = {
      wine_name: 'Test Estate Cabernet',
      producer: 'Test Estate',
      vintage: 2020,
      country: 'South Africa',
      region: 'Stellenbosch',
      style: 'Cabernet Sauvignon'
    };

    const result = await evaluateWineAdd({ cellarId: TEST_CELLAR_ID, input, forceRefresh: true });
    
    // Validate return structure
    expect(result.fingerprint).toBeTruthy();
    expect(result.fingerprint_version).toBe(1);
    expect(result.duplicates).toBeDefined();
    expect(Array.isArray(result.duplicates)).toBe(true);
    expect(result.duplicates.length).toBe(0); // No duplicates for new wine
    
    // Store fingerprint for next test
    testFingerprint = result.fingerprint;
  });

  it('detects duplicates by fingerprint', async () => {
    // First, create a wine in the database with known fingerprint
    const insertResult = await db.prepare(`
      INSERT INTO wines (cellar_id, wine_name, producer, vintage, country, region, style, colour, fingerprint, fingerprint_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `).get(TEST_CELLAR_ID, 'Test Estate Cabernet', 'Test Estate', 2020, 'South Africa', 'Stellenbosch', 'Cabernet Sauvignon', 'Red', testFingerprint, 1);

    testWineId = insertResult.id;

    // Now evaluate the same wine - should find duplicate
    const input = {
      wine_name: 'Test Estate Cabernet',
      producer: 'Test Estate',
      vintage: 2020,
      country: 'South Africa',
      region: 'Stellenbosch',
      style: 'Cabernet Sauvignon'
    };

    const result = await evaluateWineAdd({ cellarId: TEST_CELLAR_ID, input, forceRefresh: true });

    // Should detect duplicate
    expect(result.duplicates.length).toBeGreaterThan(0);
    expect(result.duplicates[0].id).toBe(testWineId);
    // Note: duplicates array doesn't include fingerprint field
    expect(result.duplicates[0].wine_name).toBeTruthy();
  });

  it('stores ratings with provenance when found', async () => {
    // Create wine first
    const insertResult = await db.prepare(`
      INSERT INTO wines (cellar_id, wine_name, vintage, country, style, colour, fingerprint, fingerprint_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `).get(TEST_CELLAR_ID, 'Test Cabernet with Ratings', 2019, 'France', 'Cabernet Sauvignon', 'Red', 'test-ratings-fp', 1);
    
    testWineId = insertResult.id;

    // Manually insert a rating to test retrieval
    await db.prepare(`
      INSERT INTO wine_source_ratings (wine_id, source, rating_value, rating_scale, extraction_method)
      VALUES ($1, 'vivino', 4.2, '5', 'structured')
      ON CONFLICT (wine_id, source) DO UPDATE SET rating_value = EXCLUDED.rating_value
    `).run(testWineId);

    const ratings = await db.prepare(`
      SELECT * FROM wine_source_ratings WHERE wine_id = $1
    `).all(testWineId);

    expect(ratings.length).toBeGreaterThan(0);
    expect(ratings[0].source).toBe('vivino');
    expect(ratings[0].extraction_method).toBe('structured');
  });

  it('stores external IDs with candidate status', async () => {
    // Create wine first
    const insertResult = await db.prepare(`
      INSERT INTO wines (cellar_id, wine_name, vintage, style, colour, fingerprint, fingerprint_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `).get(TEST_CELLAR_ID, 'Test External ID Wine', 2021, 'Cabernet Sauvignon', 'Red', 'test-ext-id-fp', 1);
    
    testWineId = insertResult.id;

    // Manually insert external ID to test
    await db.prepare(`
      INSERT INTO wine_external_ids (wine_id, source, external_id, match_confidence, status)
      VALUES ($1, 'vivino', '123456', 0.95, 'candidate')
      ON CONFLICT DO NOTHING
    `).run(testWineId);

    const externalIds = await db.prepare(`
      SELECT * FROM wine_external_ids WHERE wine_id = $1
    `).all(testWineId);

    expect(externalIds.length).toBeGreaterThan(0);
    expect(externalIds[0].status).toBe('candidate');
    expect(externalIds[0].match_confidence).toBeGreaterThan(0.9);
  });

  it('respects cellar isolation for fingerprints', async () => {
    // Use different cellar ID (ensured to exist in beforeAll)

    // Same wine details but different cellar
    const input = {
      wine_name: 'Test Cabernet Integration',
      vintage: 2020,
      country: 'South Africa',
      producer: 'Test Estate',
      style: 'Cabernet Sauvignon'
    };

    // Should NOT detect as duplicate because different cellar
    const result = await evaluateWineAdd({ cellarId: DIFFERENT_CELLAR, input, forceRefresh: true });
    
    expect(result.duplicates).toBeDefined();
    expect(Array.isArray(result.duplicates)).toBe(true);
    expect(result.duplicates.length).toBe(0); // No duplicates in different cellar
    expect(result.fingerprint).toBeTruthy();
    
    // No cleanup needed - we're not creating wines, just evaluating
  });
});

describe.skipIf(!hasDatabase)('Phase 6: Cache Integration', () => {
  it('lookup returns null for cache miss', async () => {
    const { lookupWineSearchCache } = await import('../../src/services/search/searchCache.js');
    const result = await lookupWineSearchCache(
      TEST_CELLAR_ID,
      'nonexistent-fingerprint-xyz',
      1
    );
    expect(result).toBeNull();
  });

  it('store and retrieve from cache', async () => {
    const { storeWineSearchCache, lookupWineSearchCache } = await import('../../src/services/search/searchCache.js');
    
    const fingerprint = 'test-cache-wine|cabernet|cabernet|2021|za';
    const queryHash = 'test-hash-123';
    const searchResult = {
      matches: [{ external_id: '999', confidence: 0.92 }],
      ratings: [{ source: 'vivino', value: 4.3 }]
    };

    await storeWineSearchCache(TEST_CELLAR_ID, fingerprint, queryHash, 1, searchResult);

    const cached = await lookupWineSearchCache(TEST_CELLAR_ID, fingerprint, 1);
    
    expect(cached).toBeDefined();
    expect(cached.matches).toHaveLength(1);
    expect(cached.matches[0].external_id).toBe('999');
  });
});

describe.skipIf(!hasDatabase)('Phase 6: Metrics', () => {
  it('search_metrics table exists and has correct schema', async () => {
    const columns = await db.prepare(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'search_metrics'
      ORDER BY column_name
    `).all();

    const columnNames = columns.map(c => c.column_name);
    
    expect(columnNames).toContain('cellar_id');
    expect(columnNames).toContain('fingerprint');
    expect(columnNames).toContain('latency_ms');
    expect(columnNames).toContain('total_cost_cents');
    expect(columnNames).toContain('stop_reason');
    expect(columnNames).toContain('extraction_method');
  });
});

