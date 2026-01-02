#!/usr/bin/env node
/**
 * @fileoverview Test script for Puppeteer-based Vivino and Decanter search.
 * Tests the hybrid approach:
 * - Vivino: Google SERP → Puppeteer scraping
 * - Decanter: Puppeteer search + scraping
 *
 * Usage: node scripts/test-puppeteer-providers.mjs
 */

import { searchVivinoWines, getVivinoWineDetails } from '../src/services/vivinoSearch.js';
import { fetchDecanterAuthenticated } from '../src/services/searchProviders.js';
import { scrapeVivinoPage, closePuppeteerClient } from '../src/services/puppeteerScraper.js';

async function testVivinoDirectScrape() {
  console.log('\n=== VIVINO DIRECT SCRAPE TEST ===\n');
  console.log('Testing Puppeteer scraping of known Vivino URLs...\n');

  const testUrls = [
    'https://www.vivino.com/en/nederburg-estate-private-bin-cabernet-sauvignon/w/1160367',
    'https://www.vivino.com/en/kanonkop-kadette-cape-blend/w/23428'
  ];

  for (const url of testUrls) {
    console.log(`Scraping: ${url}`);
    console.log('-'.repeat(60));

    try {
      const wine = await scrapeVivinoPage(url);

      if (!wine) {
        console.log('  No data extracted\n');
        continue;
      }

      console.log(`  Name: ${wine.wineName || 'N/A'}`);
      console.log(`  Rating: ${wine.rating || 'N/A'}★`);
      console.log(`  Winery: ${wine.winery || 'N/A'}`);
      console.log(`  Region: ${wine.region || 'N/A'}`);
      console.log(`  Grape: ${wine.grape || 'N/A'}`);
      console.log();

    } catch (err) {
      console.log(`  Error: ${err.message}\n`);
    }
  }
}

async function testVivinoSearch() {
  console.log('\n=== VIVINO SEARCH TEST (Google SERP + Puppeteer) ===\n');
  console.log('Note: Requires BRIGHTDATA_API_KEY and BRIGHTDATA_SERP_ZONE configured\n');

  const testCases = [
    { query: 'Nederburg Private Bin Cabernet Sauvignon', vintage: 2019 },
    { query: 'Kanonkop Pinotage', vintage: 2020 }
  ];

  for (const test of testCases) {
    console.log(`Searching: "${test.query}" ${test.vintage}`);
    console.log('-'.repeat(60));

    try {
      const result = await searchVivinoWines(test);

      if (result.error) {
        console.log(`  Error: ${result.error}\n`);
        continue;
      }

      console.log(`  Found ${result.matches.length} matches`);

      for (const match of result.matches.slice(0, 2)) {
        console.log(`\n  Match: ${match.name}`);
        console.log(`    Rating: ${match.rating || 'N/A'}★`);
        console.log(`    Rating Count: ${match.ratingCount || 'N/A'}`);
        console.log(`    Winery: ${match.winery?.name || 'N/A'}`);
        console.log(`    Region: ${match.region || 'N/A'}`);
        console.log(`    URL: ${match.vivinoUrl || 'N/A'}`);
      }

      console.log();

    } catch (err) {
      console.log(`  Exception: ${err.message}\n`);
    }
  }
}

async function testDecanter() {
  console.log('\n=== DECANTER SEARCH TEST (Puppeteer) ===\n');

  const testCases = [
    { name: 'Chateau Margaux', vintage: 2018 },
    { name: 'Penfolds Grange', vintage: 2017 }
  ];

  for (const test of testCases) {
    console.log(`Searching: "${test.name}" ${test.vintage}`);
    console.log('-'.repeat(60));

    try {
      const result = await fetchDecanterAuthenticated(test.name, test.vintage);

      if (!result) {
        console.log('  No result found\n');
        continue;
      }

      console.log(`  Score: ${result.raw_score} points`);
      console.log(`  Wine: ${result.wine_name}`);
      console.log(`  URL: ${result.source_url}`);

      if (result.drinking_window) {
        console.log(`  Drinking Window: ${result.drinking_window.raw_text}`);
      }

      if (result.tasting_notes) {
        console.log(`  Tasting Notes: ${result.tasting_notes.substring(0, 100)}...`);
      }

      console.log();

    } catch (err) {
      console.log(`  Exception: ${err.message}\n`);
    }
  }
}

async function main() {
  console.log('Testing Wine Search Providers');
  console.log('=============================\n');

  try {
    // Test 1: Direct Puppeteer scraping of Vivino pages (no SERP needed)
    await testVivinoDirectScrape();

    // Test 2: Full Vivino search (requires Bright Data SERP)
    await testVivinoSearch();

    // Test 3: Decanter search (Puppeteer only)
    await testDecanter();

    console.log('\n✓ All tests completed');

  } catch (error) {
    console.error('\n✗ Test suite failed:', error.message);
    process.exit(1);

  } finally {
    console.log('\nClosing Puppeteer client...');
    await closePuppeteerClient();
  }
}

main();
