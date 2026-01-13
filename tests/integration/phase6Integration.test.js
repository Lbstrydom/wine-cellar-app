/**
 * @fileoverview Phase 6 end-to-end integration test
 * Tests the full wine add orchestrator pipeline
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../src/db/index.js';
import { evaluateWineAdd } from '../../src/services/wineAddOrchestrator.js';

const TEST_CELLAR_ID = '00000000-0000-0000-0000-000000000001';

describe('Phase 6: Wine Add Orchestrator Integration', () => {
  let testWineId;

  afterAll(async () => {
    // Cleanup: delete test wine if created
    if (testWineId) {
      await db.prepare('DELETE FROM wine_source_ratings WHERE wine_id = $1').run(testWineId);
      await db.prepare('DELETE FROM wine_external_ids WHERE wine_id = $1').run(testWineId);
      await db.prepare('DELETE FROM wine_search_cache WHERE wine_id = $1').run(testWineId);
      await db.prepare('DELETE FROM wines WHERE id = $1').run(testWineId);
    }
  });

  it('generates fingerprint for new wine', async () => {
    const input = {
      wine_name: 'Test Cabernet Integration',
      vintage: 2020,
      country: 'South Africa',
      producer: 'Test Estate',
      style: 'Cabernet Sauvignon'
    };

    const result = await evaluateWineAdd({ cellarId: TEST_CELLAR_ID, input, forceRefresh: true });
    
    expect(result).toBeDefined();
    expect(result.wine).toBeDefined();
    expect(result.wine.fingerprint).toBeTruthy();
    expect(result.wine.fingerprint_version).toBe(1);
    
    testWineId = result.wine.id;
  });

  it('detects duplicates by fingerprint', async () => {
    // Try to add same wine again
    const input = {
      wine_name: 'Test Cabernet Integration',
      vintage: 2020,
      country: 'South Africa',
      producer: 'Test Estate',
      style: 'Cabernet Sauvignon'
    };

    const result = await evaluateWineAdd({ cellarId: TEST_CELLAR_ID, input, forceRefresh: true });
    
    expect(result.duplicate).toBe(true);
    expect(result.existingWine).toBeDefined();
    expect(result.existingWine.id).toBe(testWineId);
  });

  it('stores ratings with provenance when found', async () => {
    if (!testWineId) {
      // Create wine first if previous test skipped
      const input = {
        wine_name: 'Test Cabernet with Ratings',
        vintage: 2019,
        country: 'France',
        style: 'Cabernet Sauvignon'
      };
      const result = await evaluateWineAdd({ cellarId: TEST_CELLAR_ID, input, forceRefresh: true });
      testWineId = result.wine.id;
    }

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
    if (!testWineId) return;

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
    const DIFFERENT_CELLAR = '00000000-0000-0000-0000-000000000002';

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
    
    expect(result.duplicate).toBeFalsy();
    expect(result.wine).toBeDefined();
    
    // Cleanup
    if (result.wine?.id) {
      await db.prepare('DELETE FROM wines WHERE id = $1').run(result.wine.id);
    }
  });
});

describe('Phase 6: Cache Integration', () => {
  it('lookup returns null for cache miss', async () => {
    const { lookupWineSearchCache } = await import('../../src/services/searchCache.js');
    const result = await lookupWineSearchCache(
      TEST_CELLAR_ID,
      'nonexistent-fingerprint-xyz',
      1
    );
    expect(result).toBeNull();
  });

  it('store and retrieve from cache', async () => {
    const { storeWineSearchCache, lookupWineSearchCache } = await import('../../src/services/searchCache.js');
    
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

describe('Phase 6: Metrics', () => {
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

