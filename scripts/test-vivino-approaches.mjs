#!/usr/bin/env node
/**
 * Test script to compare Puppeteer vs Web Unlocker for Vivino scraping.
 * Run: node scripts/test-vivino-approaches.mjs
 */

import 'dotenv/config';

const TEST_URL = 'https://www.vivino.com/en/nederburg-estate-private-bin-cabernet-sauvignon/w/1160367?year=2019';
const TEST_SEARCH = 'Nederburg Private Bin Cabernet Sauvignon 2019';

console.log('='.repeat(70));
console.log('VIVINO SCRAPING COMPARISON TEST');
console.log('='.repeat(70));
console.log(`Test URL: ${TEST_URL}`);
console.log(`Search Query: ${TEST_SEARCH}`);
console.log('');

// ============================================================================
// APPROACH 1: Puppeteer MCP (requires local Node.js + Puppeteer)
// ============================================================================
async function testPuppeteer() {
  console.log('\n' + '='.repeat(70));
  console.log('APPROACH 1: PUPPETEER MCP');
  console.log('='.repeat(70));

  try {
    const { scrapeVivinoPage } = await import('../src/services/scraping/puppeteerScraper.js');

    console.log('Starting Puppeteer scrape...');
    const startTime = Date.now();

    const result = await scrapeVivinoPage(TEST_URL);

    const elapsed = Date.now() - startTime;
    console.log(`\nCompleted in ${elapsed}ms`);

    if (result) {
      console.log('\n✅ SUCCESS - Data extracted:');
      console.log(`  Name: ${result.wineName || 'N/A'}`);
      console.log(`  Rating: ${result.rating || 'N/A'}★`);
      console.log(`  Rating Count: ${result.ratingCount || 'N/A'}`);
      console.log(`  Winery: ${result.winery || 'N/A'}`);
      console.log(`  Region: ${result.region || 'N/A'}`);
      console.log(`  Grape: ${result.grape || 'N/A'}`);
      console.log(`  Vivino ID: ${result.vivinoId || 'N/A'}`);
      return { success: true, data: result, time: elapsed };
    } else {
      console.log('\n❌ FAILED - No data returned');
      return { success: false, error: 'No data', time: elapsed };
    }
  } catch (err) {
    console.log(`\n❌ ERROR: ${err.message}`);
    return { success: false, error: err.message, time: 0 };
  }
}

// ============================================================================
// APPROACH 2: Bright Data Web Unlocker
// ============================================================================
async function testWebUnlocker() {
  console.log('\n' + '='.repeat(70));
  console.log('APPROACH 2: BRIGHT DATA WEB UNLOCKER');
  console.log('='.repeat(70));

  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const webZone = process.env.BRIGHTDATA_WEB_ZONE;

  if (!apiKey || !webZone) {
    console.log('❌ BRIGHTDATA_API_KEY or BRIGHTDATA_WEB_ZONE not configured');
    return { success: false, error: 'Not configured', time: 0 };
  }

  console.log(`Using zone: ${webZone}`);
  console.log('Fetching via Web Unlocker...');

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        zone: webZone,
        url: TEST_URL,
        format: 'raw'
      })
    });

    clearTimeout(timeout);

    const elapsed = Date.now() - startTime;
    console.log(`\nResponse received in ${elapsed}ms (Status: ${response.status})`);

    if (!response.ok) {
      const text = await response.text();
      console.log(`❌ HTTP ${response.status}: ${text.substring(0, 200)}`);
      return { success: false, error: `HTTP ${response.status}`, time: elapsed };
    }

    const html = await response.text();
    console.log(`HTML size: ${html.length} bytes`);

    // Try to extract __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);

    if (nextDataMatch) {
      console.log('\n✅ Found __NEXT_DATA__ JSON');

      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const pageProps = nextData?.props?.pageProps;

        // Look for wine data in various locations
        let wineData = null;

        // Try vintage data
        if (pageProps?.vintage) {
          wineData = pageProps.vintage;
        } else if (pageProps?.wine) {
          wineData = pageProps.wine;
        }

        if (wineData) {
          const result = {
            wineName: wineData.wine?.name || wineData.name,
            rating: wineData.statistics?.ratings_average || wineData.statistics?.wine_ratings_average,
            ratingCount: wineData.statistics?.ratings_count || wineData.statistics?.wine_ratings_count,
            winery: wineData.wine?.winery?.name || wineData.winery?.name,
            region: wineData.wine?.region?.name || wineData.region?.name,
            country: wineData.wine?.region?.country?.name || wineData.region?.country?.name,
            grape: wineData.wine?.grapes?.map(g => g.name).join(', ') || '',
            vivinoId: wineData.wine?.id || wineData.id,
            imageUrl: wineData.image?.location
          };

          console.log('\n✅ SUCCESS - Data extracted:');
          console.log(`  Name: ${result.wineName || 'N/A'}`);
          console.log(`  Rating: ${result.rating || 'N/A'}★`);
          console.log(`  Rating Count: ${result.ratingCount || 'N/A'}`);
          console.log(`  Winery: ${result.winery || 'N/A'}`);
          console.log(`  Region: ${result.region || 'N/A'}`);
          console.log(`  Country: ${result.country || 'N/A'}`);
          console.log(`  Grape: ${result.grape || 'N/A'}`);
          console.log(`  Vivino ID: ${result.vivinoId || 'N/A'}`);
          console.log(`  Image: ${result.imageUrl ? 'Yes' : 'No'}`);

          return { success: true, data: result, time: elapsed };
        } else {
          console.log('⚠️  __NEXT_DATA__ found but no wine data in expected location');
          console.log('   pageProps keys:', Object.keys(pageProps || {}));
        }
      } catch (parseErr) {
        console.log(`❌ Failed to parse __NEXT_DATA__: ${parseErr.message}`);
      }
    } else {
      console.log('⚠️  No __NEXT_DATA__ found in HTML');

      // Check if it's a different page structure
      console.log('   Looking for alternative data sources...');

      // Try regex fallback for rating
      const ratingMatch = html.match(/averageValue[^>]*>([0-9.]+)</);
      const ratingCountMatch = html.match(/(\d[\d,]*)\s*ratings/i);

      // Try multiple winery patterns
      const wineryMatch = html.match(/wineries\/[^"]*"[^>]*>([^<]+)</i) ||
                          html.match(/"winery"[^}]*"name"\s*:\s*"([^"]+)"/);

      // Try multiple region patterns
      const regionMatch = html.match(/wine-regions\/[^"]*"[^>]*>([^<]+)</i) ||
                          html.match(/"region"[^}]*"name"\s*:\s*"([^"]+)"/);

      // Try multiple grape patterns
      const grapeMatch = html.match(/grapes\/[^"]*"[^>]*>([^<]+)</i) ||
                         html.match(/"grape[^"]*"[^}]*"name"\s*:\s*"([^"]+)"/);

      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      const h1Match = html.match(/<h1[^>]*>([^<]+)</);

      // Look for rating count in various formats
      const countMatch2 = html.match(/caption[^>]*>([0-9,]+)\s*ratings/i);
      const ratingCount = ratingCountMatch?.[1] || countMatch2?.[1];

      // Check for JSON-LD structured data
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);

      const result = {
        wineName: h1Match?.[1]?.trim() || titleMatch?.[1]?.split('|')[0]?.trim(),
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        ratingCount: ratingCount ? parseInt(ratingCount.replace(/,/g, '')) : null,
        winery: wineryMatch?.[1]?.trim(),
        region: regionMatch?.[1]?.trim(),
        grape: grapeMatch?.[1]?.trim(),
        vivinoId: 1160367 // From URL
      };

      if (jsonLdMatch) {
        try {
          const jsonLd = JSON.parse(jsonLdMatch[1]);
          console.log('   Found JSON-LD:', jsonLd['@type']);
          if (jsonLd.aggregateRating) {
            result.rating = parseFloat(jsonLd.aggregateRating.ratingValue);
            result.ratingCount = parseInt(jsonLd.aggregateRating.ratingCount);
          }
          if (jsonLd.brand?.name) result.winery = jsonLd.brand.name;
          if (jsonLd.name) result.wineName = jsonLd.name;
        } catch {}
      }

      console.log(`   Rating via regex: ${result.rating || 'N/A'}`);
      console.log(`   Rating count: ${result.ratingCount || 'N/A'}`);
      console.log(`   Winery: ${result.winery || 'N/A'}`);
      console.log(`   Title/H1: ${result.wineName || 'N/A'}`);

      if (result.rating) {
        console.log('\n✅ SUCCESS (via regex fallback):');
        console.log(`  Name: ${result.wineName || 'N/A'}`);
        console.log(`  Rating: ${result.rating}★`);
        console.log(`  Rating Count: ${result.ratingCount || 'N/A'}`);
        console.log(`  Winery: ${result.winery || 'N/A'}`);
        console.log(`  Region: ${result.region || 'N/A'}`);
        console.log(`  Grape: ${result.grape || 'N/A'}`);
        return { success: true, data: result, time: elapsed };
      }
    }

    return { success: false, error: 'Could not extract data', time: elapsed };

  } catch (err) {
    const elapsed = Date.now() - startTime;
    if (err.name === 'AbortError') {
      console.log(`\n❌ TIMEOUT after ${elapsed}ms`);
      return { success: false, error: 'Timeout', time: elapsed };
    }
    console.log(`\n❌ ERROR: ${err.message}`);
    return { success: false, error: err.message, time: elapsed };
  }
}

// ============================================================================
// RUN TESTS
// ============================================================================
async function main() {
  const results = {};

  // Test Web Unlocker first (doesn't require local Puppeteer)
  results.webUnlocker = await testWebUnlocker();

  // Test Puppeteer
  results.puppeteer = await testPuppeteer();

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  console.log('\n| Approach       | Success | Time    | Rating | Notes |');
  console.log('|----------------|---------|---------|--------|-------|');

  const p = results.puppeteer;
  const w = results.webUnlocker;

  console.log(`| Puppeteer      | ${p.success ? '✅' : '❌'}      | ${p.time}ms | ${p.data?.rating || 'N/A'} | ${p.error || 'OK'} |`);
  console.log(`| Web Unlocker   | ${w.success ? '✅' : '❌'}      | ${w.time}ms | ${w.data?.rating || 'N/A'} | ${w.error || 'OK'} |`);

  console.log('\n');

  if (p.success && w.success) {
    console.log('Both approaches work! Web Unlocker is recommended for Docker deployment.');
  } else if (w.success) {
    console.log('Web Unlocker works - good choice for Docker without Chromium.');
  } else if (p.success) {
    console.log('Only Puppeteer works - would need Chromium in Docker image.');
  } else {
    console.log('Neither approach worked - check API keys and network.');
  }

  // Cleanup
  try {
    const { closePuppeteerClient } = await import('../src/services/scraping/puppeteerScraper.js');
    await closePuppeteerClient();
  } catch {
    // Ignore
  }

  process.exit(0);
}

main().catch(console.error);
