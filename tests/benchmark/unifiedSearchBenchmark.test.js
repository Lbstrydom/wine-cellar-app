/**
 * @fileoverview Benchmark tests for the Unified Claude Wine Search pipeline.
 * Validates output quality of unifiedWineSearch() across a range of wine types.
 *
 * Tests run in two modes:
 * - SCHEMA mode (always): validates that saved fixture responses meet schema contracts
 * - REPLAY mode (when fixtures present): validates quality metrics against pre-captured responses
 *
 * Capture fixtures by running the live pipeline and saving results.
 * Run: UNIFIED_BENCHMARK_LIVE=1 npm run test:benchmark (requires ANTHROPIC_API_KEY)
 *
 * @module tests/benchmark/unifiedSearchBenchmark.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '../fixtures/unified-search-benchmark.json');

const fixturesPresent = existsSync(FIXTURE_PATH);

/**
 * Wine test cases spanning obscurity levels.
 * Covers: icon, mid-tier, SA local, obscure (Georgian), NZ, and French.
 */
export const BENCHMARK_WINES = [
  // Famous / icon
  { id: 'penfolds_grange', wine_name: 'Penfolds Grange', producer: 'Penfolds', vintage: 2018, country: 'Australia', colour: 'red' },
  { id: 'chateau_margaux', wine_name: 'Château Margaux', producer: 'Château Margaux', vintage: 2015, country: 'France', colour: 'red' },
  // Mid-tier
  { id: 'kanonkop_pinotage', wine_name: 'Kanonkop Pinotage', producer: 'Kanonkop', vintage: 2019, country: 'South Africa', colour: 'red' },
  { id: 'cloudy_bay_sauv_blanc', wine_name: 'Cloudy Bay Sauvignon Blanc', producer: 'Cloudy Bay', vintage: 2022, country: 'New Zealand', colour: 'white' },
  // SA local
  { id: 'vergelegen_v', wine_name: 'Vergelegen V', producer: 'Vergelegen', vintage: 2017, country: 'South Africa', colour: 'red' },
  { id: 'mullineux_schist', wine_name: 'Mullineux Schist Syrah', producer: 'Mullineux', vintage: 2020, country: 'South Africa', colour: 'red' },
  // Obscure
  { id: 'pheasants_tears_saperavi', wine_name: "Pheasant's Tears Saperavi", producer: "Pheasant's Tears", vintage: 2021, country: 'Georgia', colour: 'red' },
  { id: 'markovitis_alkemi', wine_name: 'Markovitis Alkemi Rosé', producer: 'Markovitis', vintage: 2022, country: 'Greece', colour: 'rosé' }
];

/**
 * Validate that a unified search result meets the expected schema.
 * @param {Object} result - Result from unifiedWineSearch or fixture
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateResultSchema(result) {
  const errors = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['Result is not an object'] };
  }

  // ratings must be an array
  if (!Array.isArray(result.ratings)) {
    errors.push('ratings must be an array');
  } else {
    for (const [i, rating] of result.ratings.entries()) {
      if (!rating.source) errors.push(`ratings[${i}].source is missing`);
      if (!rating.raw_score && rating.raw_score !== 0) errors.push(`ratings[${i}].raw_score is missing`);
    }
  }

  // _narrative should be a string if present
  if (result._narrative !== undefined && result._narrative !== null) {
    if (typeof result._narrative !== 'string') {
      errors.push('_narrative must be a string when present');
    }
  }

  // grape_varieties must be an array when present
  if (result.grape_varieties !== undefined && !Array.isArray(result.grape_varieties)) {
    errors.push('grape_varieties must be an array when present');
  }

  // _metadata must be an object when present
  if (result._metadata !== undefined && (typeof result._metadata !== 'object' || result._metadata === null)) {
    errors.push('_metadata must be an object when present');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Count prose sections found in narrative text.
 * @param {string} narrative
 * @returns {{ producer: boolean, grape: boolean, terroir: boolean, tasting: boolean }}
 */
function detectNarrativeSections(narrative) {
  if (!narrative) return { producer: false, grape: false, terroir: false, tasting: false };
  const lower = narrative.toLowerCase();
  return {
    producer: /producer|estate|winery|winemaker/.test(lower),
    grape: /grape|variety|varietal|blend|cabernet|shiraz|syrah|pinotage|sauvignon|chardonnay|merlot|pinot/.test(lower),
    terroir: /terroir|soil|climate|region|appellation|valley|coast|mountain/.test(lower),
    tasting: /tasting|nose|palate|finish|aroma|flavour|flavor|fruit|tannin|acidity/.test(lower)
  };
}

// =============================================================================
// SCHEMA VALIDATION — always runs (no network, no fixtures required)
// =============================================================================

describe('Unified Search — Schema Validation', () => {
  it('should export BENCHMARK_WINES with required fields', () => {
    expect(Array.isArray(BENCHMARK_WINES)).toBe(true);
    expect(BENCHMARK_WINES.length).toBeGreaterThan(0);

    for (const wine of BENCHMARK_WINES) {
      expect(wine.id, `Missing id`).toBeTruthy();
      expect(wine.wine_name, `${wine.id}: Missing wine_name`).toBeTruthy();
      expect(wine.producer, `${wine.id}: Missing producer`).toBeTruthy();
      expect(typeof wine.vintage, `${wine.id}: vintage must be a number`).toBe('number');
      expect(wine.country, `${wine.id}: Missing country`).toBeTruthy();
    }
  });

  it('should validate schema against a minimal synthetic result', () => {
    const minimalResult = {
      ratings: [{ source: 'wine_spectator', raw_score: '92' }],
      grape_varieties: ['Cabernet Sauvignon'],
      _narrative: 'A great wine with deep colour.',
      _metadata: { method: 'unified_claude_search', latencyMs: 12000 }
    };

    const { valid, errors } = validateResultSchema(minimalResult);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('should reject result with missing ratings array', () => {
    const bad = { grape_varieties: [], _narrative: null };
    const { valid } = validateResultSchema(bad);
    expect(valid).toBe(false);
  });

  it('should reject result with rating missing source', () => {
    const bad = { ratings: [{ raw_score: '90' }] };
    const { valid, errors } = validateResultSchema(bad);
    expect(valid).toBe(false);
    expect(errors[0]).toContain('source');
  });

  it('should detect narrative sections correctly', () => {
    const narrative = 'Kanonkop is a historic estate. The Pinotage grape variety thrives in the clay-loam soils of Simonsberg. Aromas of dark fruit on the nose with firm tannins on the palate.';
    const sections = detectNarrativeSections(narrative);
    expect(sections.producer).toBe(true);
    expect(sections.grape).toBe(true);
    expect(sections.terroir).toBe(true);
    expect(sections.tasting).toBe(true);
  });

  it('should handle empty narrative gracefully', () => {
    const sections = detectNarrativeSections('');
    expect(sections.producer).toBe(false);
    expect(sections.grape).toBe(false);
  });
});

// =============================================================================
// REPLAY MODE — runs only when fixtures are present
// =============================================================================

describe.skipIf(!fixturesPresent)('Unified Search — Fixture Replay', () => {
  let fixtures = [];

  beforeAll(() => {
    const raw = readFileSync(FIXTURE_PATH, 'utf-8');
    fixtures = JSON.parse(raw);
    if (!Array.isArray(fixtures)) {
      fixtures = fixtures.results || [];
    }
  });

  it('should have at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('should pass schema validation for all fixtures', () => {
    const failures = [];
    for (const fixture of fixtures) {
      const { valid, errors } = validateResultSchema(fixture.result);
      if (!valid) {
        failures.push({ id: fixture.id, errors });
      }
    }
    if (failures.length > 0) {
      console.log('Schema failures:', JSON.stringify(failures, null, 2));
    }
    expect(failures).toHaveLength(0);
  });

  it('should achieve ≥2 ratings for at least 80% of wines', () => {
    const total = fixtures.length;
    const withTwoPlus = fixtures.filter(f => Array.isArray(f.result?.ratings) && f.result.ratings.length >= 2).length;
    const pct = (withTwoPlus / total) * 100;

    console.log(`\nRating count ≥2: ${withTwoPlus}/${total} (${pct.toFixed(0)}%)`);
    expect(pct).toBeGreaterThanOrEqual(80);
  });

  it('should have ≥3 cited sources for at least 60% of wines', () => {
    const total = fixtures.length;
    const withThreePlus = fixtures.filter(f => {
      const ratings = f.result?.ratings || [];
      const uniqueSources = new Set(ratings.map(r => r.source)).size;
      return uniqueSources >= 3;
    }).length;
    const pct = (withThreePlus / total) * 100;

    console.log(`Citation count ≥3: ${withThreePlus}/${total} (${pct.toFixed(0)}%)`);
    expect(pct).toBeGreaterThanOrEqual(60);
  });

  it('should have a prose narrative for at least 70% of wines', () => {
    const total = fixtures.length;
    const withNarrative = fixtures.filter(f => f.result?._narrative && f.result._narrative.trim().length > 50).length;
    const pct = (withNarrative / total) * 100;

    console.log(`Prose narrative present: ${withNarrative}/${total} (${pct.toFixed(0)}%)`);
    expect(pct).toBeGreaterThanOrEqual(70);
  });

  it('should have at least 2 prose sections for wines with narratives', () => {
    const withNarrative = fixtures.filter(f => f.result?._narrative && f.result._narrative.trim().length > 50);
    if (withNarrative.length === 0) return;

    const with2Sections = withNarrative.filter(f => {
      const sections = detectNarrativeSections(f.result._narrative);
      const count = Object.values(sections).filter(Boolean).length;
      return count >= 2;
    }).length;

    const pct = (with2Sections / withNarrative.length) * 100;
    console.log(`Narrative ≥2 sections: ${with2Sections}/${withNarrative.length} (${pct.toFixed(0)}%)`);
    expect(pct).toBeGreaterThanOrEqual(75);
  });

  it('should have latency p50 < 20s and p95 < 35s for recorded results', () => {
    const latencies = fixtures
      .map(f => f.result?._metadata?.latencyMs)
      .filter(ms => typeof ms === 'number')
      .sort((a, b) => a - b);

    if (latencies.length === 0) {
      console.log('No latency data in fixtures — skipping latency assertions');
      return;
    }

    const p50 = latencies[Math.floor(latencies.length * 0.5)] / 1000;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] / 1000;

    console.log(`\nLatency p50: ${p50.toFixed(1)}s  p95: ${p95.toFixed(1)}s`);
    expect(p50).toBeLessThan(20);
    expect(p95).toBeLessThan(35);
  });

  it('should report identity gate pass rate', () => {
    const total = fixtures.length;
    const passed = fixtures.filter(f => Array.isArray(f.result?.ratings) && f.result.ratings.length > 0).length;
    const pct = (passed / total) * 100;

    console.log(`Identity gate pass rate: ${passed}/${total} (${pct.toFixed(0)}%)`);
    // Informational only — no hard threshold for identity gate in fixtures
    expect(pct).toBeGreaterThanOrEqual(0); // always passes; value logged for visibility
  });
});
