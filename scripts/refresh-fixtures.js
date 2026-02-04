#!/usr/bin/env node
/**
 * @fileoverview Automated fixture refresh script with intelligent scheduling.
 * Refreshes stale fixtures in batches with rate limiting.
 *
 * Usage:
 *   node scripts/refresh-fixtures.js [options]
 *
 * Options:
 *   --max-age <days>    Refresh fixtures older than N days (default: 30)
 *   --batch-size <n>    Number of fixtures to refresh per run (default: 10)
 *   --dry-run           Show what would be refreshed
 *   --all               Refresh all fixtures regardless of age
 *   --priority-first    Refresh fixtures for failed cases first
 *
 * @module scripts/refresh-fixtures
 */

import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import benchmark modules
import { loadBenchmarkCases, loadFixture, saveFixture, checkFixtureStaleness } from '../tests/benchmark/serpFixtureManager.js';
import { BenchmarkSerpClient } from '../tests/benchmark/serpClient.js';
import { loadBaselineReport } from '../tests/benchmark/metricsReporter.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    maxAge: 30,
    batchSize: 10,
    dryRun: false,
    all: false,
    priorityFirst: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--max-age':
        options.maxAge = parseInt(args[++i], 10);
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--all':
        options.all = true;
        break;
      case '--priority-first':
        options.priorityFirst = true;
        break;
      case '--help':
        console.log(`
Fixture Refresh Automation

Usage: node scripts/refresh-fixtures.js [options]

Options:
  --max-age <days>    Refresh fixtures older than N days (default: 30)
  --batch-size <n>    Number of fixtures to refresh per run (default: 10)
  --dry-run           Show what would be refreshed
  --all               Refresh all fixtures regardless of age
  --priority-first    Refresh fixtures for failed cases first
  --help              Show this help message
`);
        process.exit(0);
    }
  }

  return options;
}

/**
 * Get fixtures that need refresh, sorted by priority.
 */
async function getFixturesToRefresh(options) {
  const cases = await loadBenchmarkCases();
  const staleness = await checkFixtureStaleness(options.maxAge);

  let toRefresh = [];

  if (options.all) {
    // Refresh all fixtures
    toRefresh = cases.map(c => ({
      caseId: c.id,
      reason: 'all',
      priority: 0
    }));
  } else {
    // Only refresh stale fixtures
    const staleIds = new Set(staleness.staleFixtures.map(f => f.caseId));

    for (const testCase of cases) {
      if (staleIds.has(testCase.id)) {
        const fixture = staleness.staleFixtures.find(f => f.caseId === testCase.id);
        toRefresh.push({
          caseId: testCase.id,
          reason: fixture.ageDays ? `${fixture.ageDays} days old` : 'missing/invalid',
          priority: fixture.ageDays || 999
        });
      }
    }
  }

  // Prioritize failed cases if requested
  if (options.priorityFirst) {
    const baseline = await loadBaselineReport();
    if (baseline?.hardFailures?.length > 0) {
      const failedSet = new Set(baseline.hardFailures);

      toRefresh = toRefresh.map(item => ({
        ...item,
        priority: failedSet.has(item.caseId) ? -1 : item.priority
      }));
    }
  }

  // Sort by priority (lowest first)
  toRefresh.sort((a, b) => a.priority - b.priority);

  return toRefresh;
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           FIXTURE REFRESH AUTOMATION                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check configuration
  const client = new BenchmarkSerpClient({
    rateLimit: 1500,
    timeout: 20000,
    retries: 2
  });

  if (!client.isConfigured()) {
    console.error('❌ Error: BRIGHTDATA_API_KEY and BRIGHTDATA_SERP_ZONE must be set');
    process.exit(1);
  }

  // Get fixtures to refresh
  console.log('Analyzing fixtures...');
  const toRefresh = await getFixturesToRefresh(options);

  if (toRefresh.length === 0) {
    console.log('✅ All fixtures are fresh. Nothing to refresh.');
    process.exit(0);
  }

  console.log(`Found ${toRefresh.length} fixtures to refresh`);
  console.log(`Batch size: ${options.batchSize}`);

  // Apply batch limit
  const batch = toRefresh.slice(0, options.batchSize);

  console.log(`\nRefreshing ${batch.length} fixtures this run:\n`);

  if (options.dryRun) {
    console.log('DRY RUN - Would refresh:');
    for (const item of batch) {
      console.log(`  - ${item.caseId} (${item.reason})`);
    }
    process.exit(0);
  }

  // Load benchmark cases for queries
  const cases = await loadBenchmarkCases();
  const caseMap = new Map(cases.map(c => [c.id, c]));

  // Refresh fixtures
  const results = { success: [], failed: [] };

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const testCase = caseMap.get(item.caseId);

    if (!testCase) {
      console.log(`  ⚠️  ${item.caseId}: Case not found in benchmark file`);
      results.failed.push({ caseId: item.caseId, error: 'Case not found' });
      continue;
    }

    const progress = `[${i + 1}/${batch.length}]`;
    process.stdout.write(`${progress} ${item.caseId}: `);

    try {
      const serpResponse = await client.search(testCase.query);
      await saveFixture(item.caseId, serpResponse);

      const resultCount = serpResponse.organic?.length || 0;
      console.log(`✓ ${resultCount} results`);

      results.success.push({ caseId: item.caseId, resultCount });
    } catch (error) {
      console.log(`✗ ${error.message}`);
      results.failed.push({ caseId: item.caseId, error: error.message });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('REFRESH SUMMARY');
  console.log('═'.repeat(60));
  console.log(`✅ Success: ${results.success.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);
  console.log(`⏳ Remaining: ${toRefresh.length - batch.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed cases:');
    for (const f of results.failed) {
      console.log(`  - ${f.caseId}: ${f.error}`);
    }
  }

  if (toRefresh.length > batch.length) {
    console.log(`\n💡 Run again to refresh ${toRefresh.length - batch.length} more fixtures.`);
  }

  // Client stats
  const stats = client.getStats();
  console.log(`\nAPI requests made: ${stats.requestCount}`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
