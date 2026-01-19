/**
 * @fileoverview Vitest benchmark tests for wine search identity matching.
 * Runs in REPLAY mode by default using pre-captured fixtures.
 *
 * @module tests/benchmark/searchBenchmark.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runBenchmark, BENCHMARK_MODES, getModeFromEnv } from './benchmarkRunner.js';
import { formatConsoleReport, formatCiSummary, saveLatestReport } from './metricsReporter.js';
import { getFixtureCoverage, loadBenchmarkCases } from './serpFixtureManager.js';

// Store report for saving after tests
let lastReport = null;

// Get mode from environment (default: REPLAY)
const MODE = getModeFromEnv();

// Check fixture coverage synchronously at module load time
// This is needed because describe.skipIf evaluates before beforeAll
const initialCoverage = await getFixtureCoverage();
const fixtureCount = initialCoverage.present;
const caseCount = initialCoverage.total;

if (MODE === BENCHMARK_MODES.REPLAY && fixtureCount === 0) {
  console.log('\n⚠️  No fixtures found. Skipping REPLAY benchmark tests.');
  console.log('   Run "BENCHMARK_MODE=record npm run test:benchmark" to capture fixtures.\n');
}

describe('Wine Search Benchmark', () => {
  describe.skipIf(MODE === BENCHMARK_MODES.REPLAY && fixtureCount === 0)('REPLAY mode', () => {
    it('should load all benchmark cases', async () => {
      const cases = await loadBenchmarkCases();

      expect(cases).toBeDefined();
      expect(cases.length).toBeGreaterThan(0);
      expect(cases[0]).toHaveProperty('id');
      expect(cases[0]).toHaveProperty('query');
      expect(cases[0]).toHaveProperty('producer');
      expect(cases[0]).toHaveProperty('gold_canonical_name');
    });

    it('should have fixture coverage report', async () => {
      const coverage = await getFixtureCoverage();

      expect(coverage).toHaveProperty('total');
      expect(coverage).toHaveProperty('present');
      expect(coverage).toHaveProperty('missing');
      expect(coverage).toHaveProperty('coverage');

      console.log(`\nFixture Coverage: ${coverage.present}/${coverage.total} (${(coverage.coverage * 100).toFixed(0)}%)`);

      if (coverage.missing > 0) {
        console.log(`Missing fixtures: ${coverage.missingIds.slice(0, 5).join(', ')}${coverage.missing > 5 ? '...' : ''}`);
      }
    });

    // Baseline thresholds - prevent regressions from current performance
    // Honest baseline after removing overfitting (19 Jan 2026): hit@1 82%, hit@3 96%, MRR 0.89
    // These are minimum acceptable values; set slightly below current to allow variance
    const BASELINE = {
      hit_at_1: 78,  // Current: 82%
      hit_at_3: 92,  // Current: 96%
      mrr: 0.85      // Current: 0.89
    };

    it.skipIf(fixtureCount === 0)('should run benchmark and report metrics', async () => {
      const report = await runBenchmark(BENCHMARK_MODES.REPLAY, { verbose: false });

      console.log(formatConsoleReport(report));

      // Save report for CI artifact upload
      lastReport = report;
      await saveLatestReport(report);

      // Verify benchmark completes and produces valid metrics
      expect(report.summary.totalCases).toBe(50);
      expect(parseFloat(report.summary.hit_at_1)).toBeGreaterThan(0);
      expect(parseFloat(report.summary.mrr)).toBeGreaterThan(0);
    }, 60000);

    it.skipIf(fixtureCount === 0)('should not regress below baseline hit@1', async () => {
      const report = await runBenchmark(BENCHMARK_MODES.REPLAY, { verbose: false });

      const hit1 = parseFloat(report.summary.hit_at_1);
      expect(hit1).toBeGreaterThanOrEqual(BASELINE.hit_at_1);
    }, 60000);

    it.skipIf(fixtureCount === 0)('should not regress below baseline hit@3', async () => {
      const report = await runBenchmark(BENCHMARK_MODES.REPLAY, { verbose: false });

      const hit3 = parseFloat(report.summary.hit_at_3);
      expect(hit3).toBeGreaterThanOrEqual(BASELINE.hit_at_3);
    }, 60000);

    it.skipIf(fixtureCount === 0)('should not regress below baseline MRR', async () => {
      const report = await runBenchmark(BENCHMARK_MODES.REPLAY, { verbose: false });

      const mrr = parseFloat(report.summary.mrr);
      expect(mrr).toBeGreaterThanOrEqual(BASELINE.mrr);
    }, 60000);
  });

  describe('Benchmark file structure', () => {
    it('should have valid benchmark cases', async () => {
      const cases = await loadBenchmarkCases();

      for (const c of cases) {
        // Required fields
        expect(c.id).toMatch(/^\d{2}_[a-z]{2,4}_/);
        expect(c.query.length).toBeGreaterThan(4);
        expect(c.country.length).toBeGreaterThan(1);
        expect(c.producer.length).toBeGreaterThan(1);
        expect(c.gold_canonical_name.length).toBeGreaterThan(4);
        expect(Array.isArray(c.challenges)).toBe(true);
        expect(c.challenges.length).toBeGreaterThan(0);

        // Challenge format
        for (const challenge of c.challenges) {
          expect(challenge).toMatch(/^[a-z][a-z0-9_]*$/);
        }
      }
    });

    it('should have 50 benchmark cases', async () => {
      const cases = await loadBenchmarkCases();
      expect(cases.length).toBe(50);
    });

    it('should cover multiple countries', async () => {
      const cases = await loadBenchmarkCases();
      const countries = new Set(cases.map(c => c.country));

      expect(countries.size).toBeGreaterThanOrEqual(10);
    });

    it('should have diverse challenge coverage', async () => {
      const cases = await loadBenchmarkCases();
      const challenges = new Set();

      for (const c of cases) {
        for (const ch of c.challenges) {
          challenges.add(ch);
        }
      }

      expect(challenges.size).toBeGreaterThanOrEqual(40);
    });

    it('should have expected constraints on key cases', async () => {
      const cases = await loadBenchmarkCases();
      const casesWithExpected = cases.filter(c => c.expected);

      expect(casesWithExpected.length).toBeGreaterThanOrEqual(10);

      for (const c of casesWithExpected) {
        if (c.expected.min_results) {
          expect(c.expected.min_results).toBeGreaterThan(0);
        }
        if (c.expected.must_include_domains) {
          expect(Array.isArray(c.expected.must_include_domains)).toBe(true);
        }
      }
    });
  });

  describe('Identity scorer', () => {
    it('should correctly extract range name from gold canonical name', async () => {
      const { extractRangeName } = await import('./identityScorer.js');

      expect(extractRangeName('Nederburg Private Bin Two Centuries Cabernet Sauvignon 2019', 'Nederburg'))
        .toBe('Private Bin Two Centuries Cabernet Sauvignon');

      expect(extractRangeName('Kanonkop Pinotage 2021', 'Kanonkop'))
        .toBe('Pinotage');

      expect(extractRangeName('Cloudy Bay Sauvignon Blanc 2023', 'Cloudy Bay'))
        .toBe('Sauvignon Blanc');
    });

    it('should normalize wine names correctly', async () => {
      const { normalizeWineName } = await import('./identityScorer.js');

      expect(normalizeWineName('Château Margaux 2015'))
        .toBe('chateau margaux 2015');

      expect(normalizeWineName('Müller-Thurgau'))
        .toBe('muller thurgau');

      expect(normalizeWineName("D'Arenberg The Dead Arm"))
        .toBe('d arenberg the dead arm');
    });

    it('should fuzzy match wine names', async () => {
      const { fuzzyMatch, normalizeWineName } = await import('./identityScorer.js');

      const a = normalizeWineName('Cloudy Bay Sauvignon Blanc 2023');
      const b = normalizeWineName('Cloudy Bay Sauvignon Blanc Marlborough 2023');

      expect(fuzzyMatch(a, b, 0.7)).toBe(true);
    });

    it('should rank results by identity score', async () => {
      const { rankResults } = await import('./identityScorer.js');

      const testCase = {
        id: 'test_01',
        producer: 'Cloudy Bay',
        vintage: 2023,
        gold_canonical_name: 'Cloudy Bay Sauvignon Blanc 2023',
        country: 'New Zealand'
      };

      const results = [
        { title: 'Some Random Wine 2020', snippet: 'Description' },
        { title: 'Cloudy Bay Sauvignon Blanc 2023 - Wine-Searcher', snippet: 'NZ Sauvignon' },
        { title: 'Another Sauvignon Blanc', snippet: '2023 vintage' }
      ];

      const ranked = rankResults(results, testCase);

      expect(ranked[0].title).toContain('Cloudy Bay');
      expect(ranked[0].identityValid).toBe(true);
    });

    it('should calculate metrics correctly', async () => {
      const { calculateMetrics } = await import('./identityScorer.js');

      const results = [
        { hit_at_1: true, hit_at_3: true, hit_at_5: true, reciprocal_rank: 1, country: 'NZ', challenges: ['a'] },
        { hit_at_1: false, hit_at_3: true, hit_at_5: true, reciprocal_rank: 0.5, country: 'NZ', challenges: ['a'] },
        { hit_at_1: false, hit_at_3: false, hit_at_5: true, reciprocal_rank: 0.25, country: 'AU', challenges: ['b'] }
      ];

      const metrics = calculateMetrics(results);

      expect(metrics.total).toBe(3);
      expect(metrics.hit_at_1).toBeCloseTo(0.333, 2);
      expect(metrics.hit_at_3).toBeCloseTo(0.666, 2);
      expect(metrics.mrr).toBeCloseTo(0.583, 2);
      expect(metrics.by_country).toHaveProperty('NZ');
      expect(metrics.by_country).toHaveProperty('AU');
    });
  });

  describe('Metrics reporter', () => {
    it('should generate valid report structure', () => {
      const { generateReport } = require('./metricsReporter.js');

      const results = [
        {
          caseId: 'test_01',
          query: 'Test Wine',
          goldName: 'Test Wine 2023',
          country: 'NZ',
          challenges: ['test'],
          hit_at_1: true,
          hit_at_3: true,
          hit_at_5: true,
          reciprocal_rank: 1,
          score: { position: 1 },
          ranking: [{ title: 'Test Wine 2023' }]
        }
      ];

      const metrics = {
        total: 1,
        hit_at_1: 1,
        hit_at_3: 1,
        hit_at_5: 1,
        mrr: 1,
        by_country: { NZ: { total: 1, hit_at_1: 1, hit_at_3: 1, mrr: 1 } },
        by_challenge: { test: { total: 1, hit_at_1: 1, hit_at_3: 1, mrr: 1 } }
      };

      const categoryMetrics = {
        other: { total: 1, hit_at_1: 1, hit_at_3: 1, mrr: 1, challenges: ['test'] }
      };

      const report = generateReport(results, metrics, categoryMetrics, {
        mode: 'replay',
        thresholds: { hit_at_1: 0.8, hit_at_3: 0.9, mrr: 0.85 }
      });

      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('byCountry');
      expect(report).toHaveProperty('byChallenge');
      expect(report).toHaveProperty('failures');
      expect(report.summary.passThreshold).toBe(true);
    });

    it('should format console report', () => {
      const { formatConsoleReport, generateReport } = require('./metricsReporter.js');

      const report = generateReport(
        [],
        { total: 0, hit_at_1: 0, hit_at_3: 0, hit_at_5: 0, mrr: 0, by_country: {}, by_challenge: {} },
        {},
        { mode: 'replay', thresholds: { hit_at_1: 0.8, hit_at_3: 0.9, mrr: 0.85 } }
      );

      const console = formatConsoleReport(report);

      expect(console).toContain('WINE SEARCH BENCHMARK');
      expect(console).toContain('Mode:');
      expect(console).toContain('Hit@1:');
    });

    it('should generate CI summary', () => {
      const { formatCiSummary, generateReport } = require('./metricsReporter.js');

      const report = generateReport(
        [],
        { total: 10, hit_at_1: 0.9, hit_at_3: 0.95, hit_at_5: 1, mrr: 0.92, by_country: {}, by_challenge: {} },
        {},
        { mode: 'replay', thresholds: { hit_at_1: 0.8, hit_at_3: 0.9, mrr: 0.85 } }
      );

      const summary = formatCiSummary(report);

      expect(summary).toContain('PASS');
      expect(summary).toContain('hit@1=');
      expect(summary).toContain('MRR=');
    });

    it('should generate country heatmap', () => {
      const { generateCountryHeatmap, generateReport } = require('./metricsReporter.js');

      const report = generateReport(
        [],
        {
          total: 10, hit_at_1: 0.8, hit_at_3: 0.9, hit_at_5: 1, mrr: 0.85,
          by_country: {
            Germany: { total: 5, hit_at_1: 1, hit_at_3: 1, mrr: 1 },
            Italy: { total: 3, hit_at_1: 0.4, hit_at_3: 0.8, mrr: 0.6 },
            France: { total: 2, hit_at_1: 0.75, hit_at_3: 0.9, mrr: 0.8 }
          },
          by_challenge: {}
        },
        {},
        { mode: 'replay', thresholds: { hit_at_1: 0.8, hit_at_3: 0.9, mrr: 0.85 } }
      );

      const heatmap = generateCountryHeatmap(report);

      expect(heatmap.countries).toHaveLength(3);
      expect(heatmap.tiers.excellent).toContain('Germany');
      expect(heatmap.tiers.poor).toContain('Italy');
      expect(heatmap.strongestCountries[0]).toBe('Germany');
      expect(heatmap.weakestCountries).toContain('Italy');
    });

    it('should analyze category regressions', () => {
      const { analyzeCategoryRegressions, generateReport } = require('./metricsReporter.js');

      const report = generateReport(
        [],
        { total: 10, hit_at_1: 0.8, hit_at_3: 0.9, hit_at_5: 1, mrr: 0.85, by_country: {}, by_challenge: {} },
        {
          diacritics: { total: 5, hit_at_1: 0.95, hit_at_3: 1, mrr: 0.97, challenges: ['diacritics_optional'] },
          brand_producer: { total: 10, hit_at_1: 0.50, hit_at_3: 0.8, mrr: 0.65, challenges: ['brand_only'] }
        },
        { mode: 'replay', thresholds: { hit_at_1: 0.8, hit_at_3: 0.9, mrr: 0.85 } }
      );

      const analysis = analyzeCategoryRegressions(report);

      expect(analysis.allPassed).toBe(false);
      expect(analysis.failures).toHaveLength(1);
      expect(analysis.failures[0].category).toBe('brand_producer');
    });
  });
});

describe.skip('Challenge-specific regression tests', () => {
  // These tests run against fixtures and check category-level performance

  it('should handle diacritics cases at ≥90% hit@1', async () => {
    const report = await runBenchmark(BENCHMARK_MODES.REPLAY);
    const diacriticsMetrics = report.byChallengeCategory['diacritics'];

    if (diacriticsMetrics) {
      expect(diacriticsMetrics.hit_at_1).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('should handle classification cases at ≥85% hit@1', async () => {
    const report = await runBenchmark(BENCHMARK_MODES.REPLAY);
    const classificationMetrics = report.byChallengeCategory['classification'];

    if (classificationMetrics) {
      expect(classificationMetrics.hit_at_1).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('should handle brand/producer cases at ≥80% hit@1', async () => {
    const report = await runBenchmark(BENCHMARK_MODES.REPLAY);
    const brandMetrics = report.byChallengeCategory['brand_producer'];

    if (brandMetrics) {
      expect(brandMetrics.hit_at_1).toBeGreaterThanOrEqual(0.80);
    }
  });

  it('should handle numeric cases at ≥90% hit@1', async () => {
    const report = await runBenchmark(BENCHMARK_MODES.REPLAY);
    const numericMetrics = report.byChallengeCategory['numeric'];

    if (numericMetrics) {
      expect(numericMetrics.hit_at_1).toBeGreaterThanOrEqual(0.90);
    }
  });
});
