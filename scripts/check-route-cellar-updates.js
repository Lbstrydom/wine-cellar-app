#!/usr/bin/env node

/**
 * Route cellar_id update checker
 * Identifies which routes still need cellar_id filtering updates
 * Usage: node scripts/check-route-cellar-updates.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(__dirname, '..', 'src', 'routes');

// Routes that should be updated (data routes, not profile/cellars management)
const DATA_ROUTES = [
  'wines.js',
  'slots.js',
  'bottles.js',
  'pairing.js',
  'reduceNow.js',
  'stats.js',
  'layout.js',
  'ratings.js',
  'settings.js',
  'drinkingWindows.js',
  'cellar.js',
  'awards.js',
  'backup.js',
  'wineSearch.js',
  'acquisition.js',
  'palateProfile.js',
  'cellarHealth.js',
  'tastingNotes.js',
  'searchMetrics.js'
];

async function checkRoutes() {
  console.log('🔍 Checking route cellar_id updates...\n');

  const results = [];

  for (const routeFile of DATA_ROUTES) {
    const routePath = path.join(routesDir, routeFile);

    if (!fs.existsSync(routePath)) {
      console.log(`⚠️  ${routeFile} - FILE NOT FOUND`);
      continue;
    }

    const content = fs.readFileSync(routePath, 'utf8');

    // Count db.prepare calls
    const dbPrepareMatches = content.match(/db\.prepare\s*\(/g) || [];
    const dbCallCount = dbPrepareMatches.length;

    // Count WHERE clauses that mention cellar_id
    const cellarIdMatches = content.match(/WHERE.*cellar_id\s*=/g) || [];
    const cellarIdFilterCount = cellarIdMatches.length;

    // Estimate completion percentage
    const percentComplete = dbCallCount > 0
      ? Math.round((cellarIdFilterCount / dbCallCount) * 100)
      : 0;

    const status = percentComplete === 100 ? '✅' : percentComplete > 0 ? '⏳' : '❌';

    console.log(`${status} ${routeFile.padEnd(25)} ${cellarIdFilterCount}/${dbCallCount} (${percentComplete}%)`);

    results.push({
      file: routeFile,
      total: dbCallCount,
      updated: cellarIdFilterCount,
      percentComplete
    });
  }

  console.log('\n📊 Summary:');
  const totalQueries = results.reduce((sum, r) => sum + r.total, 0);
  const updatedQueries = results.reduce((sum, r) => sum + r.updated, 0);
  const overallPercent = Math.round((updatedQueries / totalQueries) * 100);

  console.log(`Total queries: ${updatedQueries}/${totalQueries} (${overallPercent}%)`);
  console.log(`\n✅ = Complete | ⏳ = Partial | ❌ = Not started\n`);

  // Show priority order (most queries first)
  console.log('📋 Priority order (by query count):');
  results
    .filter(r => r.percentComplete < 100)
    .sort((a, b) => b.total - a.total)
    .forEach(r => {
      console.log(`  ${r.file.padEnd(25)} ${r.total} queries remaining`);
    });
}

checkRoutes().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
