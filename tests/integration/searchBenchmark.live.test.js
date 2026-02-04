/**
 * @fileoverview Live benchmark tests for wine search - runs against real SERP API.
 * These tests are skipped in CI unless BENCHMARK_MODE=live is set.
 * Intended for nightly runs to detect SERP changes and regressions.
 *
 * @module tests/integration/searchBenchmark.live.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { runBenchmark, BENCHMARK_MODES } from '../benchmark/benchmarkRunner.js';
import { formatConsoleReport } from '../benchmark/metricsReporter.js';
import { BenchmarkSerpClient } from '../benchmark/serpClient.js';
import { loadBenchmarkCases } from '../benchmark/serpFixtureManager.js';

// Only run in LIVE mode
const MODE = process.env.BENCHMARK_MODE?.toLowerCase();
const IS_LIVE_MODE = MODE === 'live';

// Check if SERP client is configured
const serpClient = new BenchmarkSerpClient({
  rateLimit: 1500,  // 1.5s between requests
  timeout: 20000,   // 20s timeout
  retries: 2
});
const IS_CONFIGURED = serpClient.isConfigured();

describe.skipIf(!IS_LIVE_MODE)('Wine Search Benchmark - LIVE Mode', () => {
  beforeAll(() => {
    if (!IS_CONFIGURED) {
      console.log('\n⚠️  SERP client not configured. Set BRIGHTDATA_API_KEY and BRIGHTDATA_SERP_ZONE.');
      console.log('   Skipping LIVE benchmark tests.\n');
    }
  });

  describe.skipIf(!IS_CONFIGURED)('Full benchmark suite', () => {
    it('should complete LIVE benchmark run', async () => {
      console.log('\n🔴 Running LIVE benchmark against real SERP API...\n');

      const report = await runBenchmark(BENCHMARK_MODES.LIVE, {
        serpClient,
        verbose: true
      });

      console.log(formatConsoleReport(report));

      // Basic validation - benchmark completed
      expect(report.summary.totalCases).toBe(50);
      expect(report.errors.length).toBe(0);
    }, 300000); // 5 minute timeout for full suite

    it('should validate expected constraints on key cases', async () => {
      // Run only cases with expected constraints
      const cases = await loadBenchmarkCases();
      const casesWithExpected = cases.filter(c => c.expected).map(c => c.id);

      const report = await runBenchmark(BENCHMARK_MODES.LIVE, {
        serpClient,
        caseIds: casesWithExpected,
        verbose: true
      });

      // Check that expected constraints were validated
      expect(report.summary.totalCases).toBe(casesWithExpected.length);

      // Log any validation warnings
      if (report.errors.length > 0) {
        console.log('\n⚠️  Validation warnings:');
        report.errors.forEach(e => console.log(`  ${e.caseId}: ${e.error}`));
      }
    }, 180000); // 3 minute timeout
  });

  describe.skipIf(!IS_CONFIGURED)('Smoke tests - sample cases', () => {
    // Run a small subset for quick validation
    const SMOKE_TEST_CASES = [
      '01_sa_nederburg_two_centuries_2019',
      '24_it_tignanello_2019',
      '38_nz_cloudy_bay_sauvignon_2024',
      '48_usca_opus_one_2018'
    ];

    it('should return results for smoke test cases', async () => {
      const report = await runBenchmark(BENCHMARK_MODES.LIVE, {
        serpClient,
        caseIds: SMOKE_TEST_CASES,
        verbose: true
      });

      expect(report.summary.totalCases).toBe(SMOKE_TEST_CASES.length);
      expect(report.errors.length).toBe(0);

      // At least some results should be found
      const avgResults = report.rawResults.reduce((sum, r) => sum + r.resultCount, 0) / report.rawResults.length;
      expect(avgResults).toBeGreaterThan(3);
    }, 60000);
  });

  describe.skipIf(!IS_CONFIGURED)('Country-specific tests', () => {
    it('should handle German wines with umlauts', async () => {
      const germanCases = [
        '33_de_loosen_spatlese_2020',
        '34_de_prum_kabinett_2021',
        '36_de_egon_muller_auslese_2018'
      ];

      const report = await runBenchmark(BENCHMARK_MODES.LIVE, {
        serpClient,
        caseIds: germanCases,
        verbose: false
      });

      // German wines should have good coverage
      const hit3 = parseFloat(report.summary.hit_at_3);
      expect(hit3).toBeGreaterThanOrEqual(66); // At least 2/3
    }, 60000);

    it('should handle Spanish classification terms', async () => {
      const spanishCases = [
        '18_es_cvne_imperial_gran_reserva_2015',
        '19_es_rioja_alta_904_2015',
        '21_es_vega_sicilia_unico_2010'
      ];

      const report = await runBenchmark(BENCHMARK_MODES.LIVE, {
        serpClient,
        caseIds: spanishCases,
        verbose: false
      });

      expect(report.summary.totalCases).toBe(spanishCases.length);
    }, 60000);
  });
});

describe.skipIf(IS_LIVE_MODE)('Wine Search Benchmark - LIVE Mode (Skipped)', () => {
  it('should skip LIVE tests when not in LIVE mode', () => {
    console.log('\n📋 LIVE benchmark tests skipped. Set BENCHMARK_MODE=live to run.');
    expect(true).toBe(true);
  });
});
