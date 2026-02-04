#!/usr/bin/env node
/**
 * @fileoverview Check SERP fixture staleness for CI.
 * Exits with code 1 if fixtures are older than MAX_AGE_DAYS.
 *
 * @module tests/benchmark/checkStaleness
 */

import { getFixtureCoverage, checkFixtureStaleness } from './serpFixtureManager.js';

const MAX_AGE_DAYS = 30;

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           BENCHMARK FIXTURE STALENESS CHECK                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const coverage = await getFixtureCoverage();

  console.log(`Coverage: ${coverage.present}/${coverage.total} fixtures (${(coverage.coverage * 100).toFixed(0)}%)\n`);

  if (coverage.present === 0) {
    console.log('⚠️  No fixtures found. Run RECORD mode to capture fixtures.');
    process.exit(1);
  }

  // Check staleness of all fixtures
  const staleness = await checkFixtureStaleness(MAX_AGE_DAYS);

  console.log(`Staleness threshold: ${MAX_AGE_DAYS} days\n`);

  if (staleness.staleCount === 0) {
    console.log('✅ All fixtures are fresh.');
    console.log(`   Oldest fixture: ${staleness.oldestAge} days old`);
    console.log(`   Newest fixture: ${staleness.newestAge} days old`);
    process.exit(0);
  }

  console.log(`❌ ${staleness.staleCount} fixture(s) are stale (>${MAX_AGE_DAYS} days old):\n`);

  for (const stale of staleness.staleFixtures.slice(0, 10)) {
    console.log(`  - ${stale.caseId}: ${stale.ageDays} days old (captured: ${stale.capturedAt})`);
  }

  if (staleness.staleFixtures.length > 10) {
    console.log(`  ... and ${staleness.staleFixtures.length - 10} more`);
  }

  console.log('\nTo refresh fixtures, run:');
  console.log('  npm run test:benchmark:record\n');

  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
