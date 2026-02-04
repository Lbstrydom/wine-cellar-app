#!/usr/bin/env node
/**
 * @fileoverview Script to record SERP fixtures for benchmark cases.
 * Run with: node tests/benchmark/recordFixtures.js [--case-id <id>] [--dry-run]
 *
 * Options:
 *   --case-id <id>   Record only specific case ID
 *   --dry-run        Show what would be recorded without calling API
 *   --force          Re-record even if fixture exists
 *   --verbose        Show detailed output
 *
 * @module tests/benchmark/recordFixtures
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import { loadBenchmarkCases, saveFixture, fixtureExists, getFixtureCoverage } from './serpFixtureManager.js';
import { BenchmarkSerpClient } from './serpClient.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    caseId: null,
    dryRun: false,
    force: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--case-id':
        options.caseId = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        console.log(`
Usage: node tests/benchmark/recordFixtures.js [options]

Options:
  --case-id <id>   Record only specific case ID
  --dry-run        Show what would be recorded without calling API
  --force          Re-record even if fixture exists
  --verbose        Show detailed output
  --help           Show this help message
`);
        process.exit(0);
    }
  }

  return options;
}

/**
 * Sleep for specified milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function to record fixtures.
 */
async function main() {
  const options = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           BENCHMARK FIXTURE RECORDER                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check configuration
  const client = new BenchmarkSerpClient({
    rateLimit: 1500,  // 1.5 seconds between requests for safety
    timeout: 20000,   // 20 second timeout
    retries: 2
  });

  if (!client.isConfigured()) {
    console.error('❌ Error: BRIGHTDATA_API_KEY and BRIGHTDATA_SERP_ZONE must be set');
    console.log('\nSet environment variables:');
    console.log('  export BRIGHTDATA_API_KEY="your-api-key"');
    console.log('  export BRIGHTDATA_SERP_ZONE="your-zone-name"');
    process.exit(1);
  }

  // Load benchmark cases
  console.log('Loading benchmark cases...');
  const allCases = await loadBenchmarkCases();

  // Filter cases if specific ID requested
  let cases = allCases;
  if (options.caseId) {
    cases = allCases.filter(c => c.id === options.caseId);
    if (cases.length === 0) {
      console.error(`❌ Case ID not found: ${options.caseId}`);
      console.log('Available case IDs:');
      allCases.slice(0, 10).forEach(c => console.log(`  - ${c.id}`));
      console.log('  ...');
      process.exit(1);
    }
  }

  // Show current coverage
  const coverage = await getFixtureCoverage();
  console.log(`Current coverage: ${coverage.present}/${coverage.total} (${(coverage.coverage * 100).toFixed(0)}%)\n`);

  // Filter out existing fixtures unless --force
  let toRecord = [];
  for (const c of cases) {
    const exists = await fixtureExists(c.id);
    if (exists && !options.force) {
      if (options.verbose) {
        console.log(`  ⏭️  ${c.id}: Fixture exists, skipping`);
      }
    } else {
      toRecord.push(c);
    }
  }

  if (toRecord.length === 0) {
    console.log('✅ All fixtures already exist. Use --force to re-record.');
    process.exit(0);
  }

  console.log(`Recording ${toRecord.length} fixtures...\n`);

  if (options.dryRun) {
    console.log('DRY RUN - Would record:');
    for (const c of toRecord) {
      console.log(`  - ${c.id}: "${c.query}"`);
    }
    process.exit(0);
  }

  // Record fixtures
  const results = {
    success: [],
    failed: []
  };

  for (let i = 0; i < toRecord.length; i++) {
    const c = toRecord[i];
    const progress = `[${i + 1}/${toRecord.length}]`;

    process.stdout.write(`${progress} ${c.id}: `);

    try {
      // Fetch SERP results
      const serpResponse = await client.search(c.query);

      // Save fixture
      await saveFixture(c.id, serpResponse);

      const resultCount = serpResponse.organic?.length || 0;
      console.log(`✓ ${resultCount} results`);

      results.success.push({
        caseId: c.id,
        resultCount
      });

    } catch (error) {
      console.log(`✗ ${error.message}`);
      results.failed.push({
        caseId: c.id,
        error: error.message
      });
    }

    // Progress indicator
    if (options.verbose && i < toRecord.length - 1) {
      process.stdout.write('  Waiting for rate limit...\r');
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`✅ Success: ${results.success.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed cases:');
    for (const f of results.failed) {
      console.log(`  - ${f.caseId}: ${f.error}`);
    }
  }

  // Final coverage
  const finalCoverage = await getFixtureCoverage();
  console.log(`\nFinal coverage: ${finalCoverage.present}/${finalCoverage.total} (${(finalCoverage.coverage * 100).toFixed(0)}%)`);

  // Client stats
  const stats = client.getStats();
  console.log(`API requests made: ${stats.requestCount}`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
