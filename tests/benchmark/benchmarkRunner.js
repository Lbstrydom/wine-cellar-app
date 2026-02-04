/**
 * @fileoverview Three-mode benchmark runner for wine search evaluation.
 *
 * Modes:
 * - REPLAY: Load SERP from fixtures, deterministic, fast CI
 * - RECORD: Fetch live SERP, save to fixtures, then score
 * - LIVE: Fetch live SERP, validate expected constraints
 *
 * @module tests/benchmark/benchmarkRunner
 */

import {
  loadBenchmarkCases,
  loadFixture,
  saveFixture,
  fixtureExists,
  validateLiveExpectations
} from './serpFixtureManager.js';

import {
  processCase,
  calculateMetrics,
  groupByCategory
} from './identityScorer.js';

import { generateReport, formatConsoleReport } from './metricsReporter.js';

export const BENCHMARK_MODES = {
  REPLAY: 'replay',
  RECORD: 'record',
  LIVE: 'live'
};

// Default pass thresholds
export const DEFAULT_THRESHOLDS = {
  hit_at_1: 0.80,  // 80% hit@1
  hit_at_3: 0.90,  // 90% hit@3
  mrr: 0.85        // 0.85 MRR
};

/**
 * Run benchmark suite in specified mode.
 * @param {string} mode - One of BENCHMARK_MODES
 * @param {Object} options
 * @param {string[]} [options.caseIds] - Specific cases to run (default: all)
 * @param {Object} [options.serpClient] - Injected SERP client (for DI in RECORD/LIVE modes)
 * @param {string} [options.fixtureDir] - Path to SERP snapshots
 * @param {string} [options.benchmarkPath] - Path to benchmark file
 * @param {Object} [options.thresholds] - Pass thresholds override
 * @param {boolean} [options.verbose] - Log verbose output
 * @returns {Promise<BenchmarkReport>}
 */
export async function runBenchmark(mode, options = {}) {
  const {
    caseIds = null,
    serpClient = null,
    fixtureDir = undefined,
    benchmarkPath = undefined,
    thresholds = DEFAULT_THRESHOLDS,
    verbose = false
  } = options;

  // Validate mode
  if (!Object.values(BENCHMARK_MODES).includes(mode)) {
    throw new Error(`Invalid benchmark mode: ${mode}. Use one of: ${Object.values(BENCHMARK_MODES).join(', ')}`);
  }

  // Check for SERP client in RECORD/LIVE modes
  if ((mode === BENCHMARK_MODES.RECORD || mode === BENCHMARK_MODES.LIVE) && !serpClient) {
    throw new Error(`SERP client required for ${mode} mode. Pass serpClient in options.`);
  }

  if (verbose) {
    console.log(`\nRunning benchmark in ${mode.toUpperCase()} mode...`);
  }

  // 1. Load benchmark cases
  const cases = await loadBenchmarkCases(benchmarkPath);
  const filtered = caseIds
    ? cases.filter(c => caseIds.includes(c.id))
    : cases;

  if (verbose) {
    console.log(`Loaded ${filtered.length} benchmark cases`);
  }

  // 2. Process each case based on mode
  const results = [];
  const errors = [];

  // REPLAY mode can use parallel processing (no API rate limits)
  // RECORD/LIVE modes must be sequential due to rate limiting
  if (mode === BENCHMARK_MODES.REPLAY && !verbose) {
    // Parallel processing for REPLAY mode
    const batchSize = 10;
    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize);
      const batchPromises = batch.map(async (testCase) => {
        try {
          return await processSingleCase(testCase, mode, { serpClient, fixtureDir, verbose });
        } catch (err) {
          errors.push({ caseId: testCase.id, error: err.message });
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(r => r !== null));
    }
  } else {
    // Sequential processing for RECORD/LIVE modes or verbose output
    for (const testCase of filtered) {
      try {
        const result = await processSingleCase(testCase, mode, {
          serpClient,
          fixtureDir,
          verbose
        });
        results.push(result);

        if (verbose) {
          const status = result.hit_at_1 ? '✓' : result.hit_at_3 ? '~' : '✗';
          console.log(`  ${status} ${testCase.id}: position=${result.score.position}`);
        }
      } catch (err) {
        errors.push({
          caseId: testCase.id,
          error: err.message
        });

        if (verbose) {
          console.log(`  ✗ ${testCase.id}: ERROR - ${err.message}`);
        }
      }
    }
  }

  // 3. Calculate aggregate metrics
  const metrics = calculateMetrics(results);
  const categoryMetrics = groupByCategory(metrics.by_challenge);

  // 4. Generate report
  const report = generateReport(results, metrics, categoryMetrics, {
    mode,
    thresholds,
    errors
  });

  return report;
}

/**
 * Process a single benchmark case.
 * @param {BenchmarkCase} testCase - Benchmark case
 * @param {string} mode - Benchmark mode
 * @param {Object} options
 * @returns {Promise<CaseResult>}
 */
async function processSingleCase(testCase, mode, options) {
  const { serpClient, fixtureDir, verbose } = options;

  let serpResponse;

  switch (mode) {
    case BENCHMARK_MODES.REPLAY:
      serpResponse = await loadFixtureWithFallback(testCase.id, fixtureDir);
      break;

    case BENCHMARK_MODES.RECORD:
      serpResponse = await fetchAndSaveFixture(testCase, serpClient, fixtureDir);
      break;

    case BENCHMARK_MODES.LIVE:
      serpResponse = await fetchLiveSerp(testCase, serpClient);
      const validation = validateLiveExpectations(serpResponse, testCase.expected);
      if (!validation.valid && verbose) {
        console.log(`    Live validation warnings: ${validation.errors.join(', ')}`);
      }
      break;

    default:
      throw new Error(`Unknown mode: ${mode}`);
  }

  // Score the case
  const result = processCase(testCase, serpResponse);

  return result;
}

/**
 * Load fixture with helpful error message if missing.
 * @param {string} caseId - Case ID
 * @param {string} [fixtureDir] - Fixture directory
 * @returns {Promise<SerpResponse>}
 */
async function loadFixtureWithFallback(caseId, fixtureDir) {
  try {
    return await loadFixture(caseId, fixtureDir);
  } catch (err) {
    if (err.message.includes('Missing fixture')) {
      throw new Error(
        `Missing fixture for ${caseId}. ` +
        `Run 'BENCHMARK_MODE=record npm run test:benchmark' to capture fixtures.`
      );
    }
    throw err;
  }
}

/**
 * Fetch live SERP and save as fixture.
 * @param {BenchmarkCase} testCase - Benchmark case
 * @param {Object} serpClient - SERP client
 * @param {string} [fixtureDir] - Fixture directory
 * @returns {Promise<SerpResponse>}
 */
async function fetchAndSaveFixture(testCase, serpClient, fixtureDir) {
  const serpResponse = await fetchLiveSerp(testCase, serpClient);
  await saveFixture(testCase.id, serpResponse, fixtureDir);
  return serpResponse;
}

/**
 * Fetch live SERP results.
 * @param {BenchmarkCase} testCase - Benchmark case
 * @param {Object} serpClient - SERP client
 * @returns {Promise<SerpResponse>}
 */
async function fetchLiveSerp(testCase, serpClient) {
  if (!serpClient || typeof serpClient.search !== 'function') {
    throw new Error('Invalid SERP client: must have search() method');
  }

  return await serpClient.search(testCase.query);
}

/**
 * Run benchmark in REPLAY mode (default for CI).
 * Convenience wrapper.
 * @param {Object} [options] - Options (same as runBenchmark)
 * @returns {Promise<BenchmarkReport>}
 */
export async function runReplayBenchmark(options = {}) {
  return runBenchmark(BENCHMARK_MODES.REPLAY, options);
}

/**
 * Run benchmark in RECORD mode.
 * Convenience wrapper.
 * @param {Object} serpClient - SERP client (required)
 * @param {Object} [options] - Options (same as runBenchmark)
 * @returns {Promise<BenchmarkReport>}
 */
export async function runRecordBenchmark(serpClient, options = {}) {
  return runBenchmark(BENCHMARK_MODES.RECORD, { ...options, serpClient });
}

/**
 * Run benchmark in LIVE mode.
 * Convenience wrapper.
 * @param {Object} serpClient - SERP client (required)
 * @param {Object} [options] - Options (same as runBenchmark)
 * @returns {Promise<BenchmarkReport>}
 */
export async function runLiveBenchmark(serpClient, options = {}) {
  return runBenchmark(BENCHMARK_MODES.LIVE, { ...options, serpClient });
}

/**
 * Check if pass thresholds are met.
 * @param {BenchmarkMetrics} metrics - Calculated metrics
 * @param {Object} [thresholds] - Thresholds to check against
 * @returns {Object} Pass status with details
 */
export function checkPassThresholds(metrics, thresholds = DEFAULT_THRESHOLDS) {
  const checks = {
    hit_at_1: {
      value: metrics.hit_at_1,
      threshold: thresholds.hit_at_1,
      passed: metrics.hit_at_1 >= thresholds.hit_at_1
    },
    hit_at_3: {
      value: metrics.hit_at_3,
      threshold: thresholds.hit_at_3,
      passed: metrics.hit_at_3 >= thresholds.hit_at_3
    },
    mrr: {
      value: metrics.mrr,
      threshold: thresholds.mrr,
      passed: metrics.mrr >= thresholds.mrr
    }
  };

  const allPassed = Object.values(checks).every(c => c.passed);

  return {
    passed: allPassed,
    checks
  };
}

/**
 * Get benchmark mode from environment.
 * @returns {string} Mode (defaults to REPLAY)
 */
export function getModeFromEnv() {
  const envMode = process.env.BENCHMARK_MODE?.toLowerCase();

  switch (envMode) {
    case 'record':
      return BENCHMARK_MODES.RECORD;
    case 'live':
      return BENCHMARK_MODES.LIVE;
    default:
      return BENCHMARK_MODES.REPLAY;
  }
}

export default {
  BENCHMARK_MODES,
  DEFAULT_THRESHOLDS,
  runBenchmark,
  runReplayBenchmark,
  runRecordBenchmark,
  runLiveBenchmark,
  checkPassThresholds,
  getModeFromEnv
};
