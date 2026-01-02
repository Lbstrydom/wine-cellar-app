#!/usr/bin/env node
/**
 * Quick test of Web Unlocker for Decanter.
 */

import 'dotenv/config';

// Example Decanter review URL
const TEST_URL = 'https://www.decanter.com/wine-reviews/south-africa/western-cape/nederburg-private-bin-cabernet-sauvignon-2019-63254';

console.log('Testing Decanter via Web Unlocker...');
console.log(`URL: ${TEST_URL}\n`);

const apiKey = process.env.BRIGHTDATA_API_KEY;
const webZone = process.env.BRIGHTDATA_WEB_ZONE;

if (!apiKey || !webZone) {
  console.log('❌ BRIGHTDATA_API_KEY or BRIGHTDATA_WEB_ZONE not configured');
  process.exit(1);
}

try {
  const startTime = Date.now();

  const response = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
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

  const elapsed = Date.now() - startTime;
  console.log(`Response: ${response.status} in ${elapsed}ms`);

  if (!response.ok) {
    const text = await response.text();
    console.log(`❌ Error: ${text.substring(0, 300)}`);
    process.exit(1);
  }

  const html = await response.text();
  console.log(`HTML size: ${html.length} bytes\n`);

  // Try to extract score from JSON in scripts
  const scoreMatch = html.match(/"score"\s*:\s*(\d{2,3})/);
  const drinkFromMatch = html.match(/"drink_from"\s*:\s*(\d{4})/);
  const drinkToMatch = html.match(/"drink_to"\s*:\s*(\d{4})/);
  const reviewMatch = html.match(/"review"\s*:\s*"([^"]{0,200})/);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const h1Match = html.match(/<h1[^>]*>([^<]+)</);

  // Try structured data
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/g);

  console.log('Extraction results:');
  console.log(`  Title: ${titleMatch?.[1] || 'N/A'}`);
  console.log(`  H1: ${h1Match?.[1] || 'N/A'}`);
  console.log(`  Score: ${scoreMatch?.[1] || 'N/A'}`);
  console.log(`  Drink window: ${drinkFromMatch?.[1] || '?'}-${drinkToMatch?.[1] || '?'}`);
  console.log(`  Review snippet: ${reviewMatch?.[1]?.substring(0, 100) || 'N/A'}...`);
  console.log(`  JSON-LD blocks: ${jsonLdMatch?.length || 0}`);

  if (scoreMatch) {
    console.log('\n✅ SUCCESS - Decanter works with Web Unlocker!');
  } else {
    console.log('\n⚠️  Score not found - may need different extraction');
  }

} catch (err) {
  console.log(`❌ Error: ${err.message}`);
}
