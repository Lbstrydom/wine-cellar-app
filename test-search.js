/**
 * @fileoverview Test script for multi-provider search.
 * Run with: node test-search.js
 */

import 'dotenv/config';
import { searchGoogle, searchBrave, searchWineRatings } from './src/services/search/searchProviders.js';

const testWine = 'Springfield Estate Special Cuvee Sauvignon Blanc';
const testVintage = '2024';
const testCountry = 'South Africa';

async function runTests() {
  console.log('='.repeat(60));
  console.log('Testing Multi-Provider Search');
  console.log('='.repeat(60));
  console.log(`Wine: ${testWine}`);
  console.log(`Vintage: ${testVintage}`);
  console.log(`Country: ${testCountry}`);
  console.log('');

  // Test BrightData SERP Search
  console.log('--- BrightData SERP Search ---');
  if (process.env.BRIGHTDATA_API_KEY && process.env.BRIGHTDATA_SERP_ZONE) {
    const serpResults = await searchGoogle(
      `"${testWine}" ${testVintage} rating`,
      ['timatkin.com', 'vivino.com', 'decanter.com']
    );
    console.log(`Results: ${serpResults.length}`);
    serpResults.forEach(r => console.log(`  - ${r.source}: ${r.title.substring(0, 50)}`));
  } else {
    console.log('  SKIPPED: BrightData SERP not configured');
  }
  console.log('');

  // Test Brave Search
  console.log('--- Brave Search ---');
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const braveResults = await searchBrave(`${testWine} ${testVintage} wine rating`);
    console.log(`Results: ${braveResults.length}`);
    braveResults.forEach(r => console.log(`  - ${r.source}: ${r.title.substring(0, 50)}`));
  } else {
    console.log('  SKIPPED: Brave API not configured');
  }
  console.log('');

  // Test Combined Search
  console.log('--- Combined Wine Search ---');
  const combined = await searchWineRatings(testWine, testVintage, testCountry);
  console.log(`Total results: ${combined.results.length}`);
  console.log(`Tier 1 (high credibility): ${combined.tier1_count}`);
  console.log(`Tier 2 (lower credibility): ${combined.tier2_count}`);
  console.log('');
  console.log('Results by source:');
  combined.results.forEach(r => {
    console.log(`  - [${r.lens}] ${r.sourceId}: ${r.title.substring(0, 40)}...`);
  });

  console.log('');
  console.log('='.repeat(60));
  console.log('Test complete');
  console.log('='.repeat(60));
}

runTests().catch(console.error);
