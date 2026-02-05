/**
 * @fileoverview Manual search test runner for 10 popular wines.
 * Tests Vivino and ratings search pipelines against known wines.
 *
 * Sources:
 *   - finewinedirect.co.uk/collections/top-20-wines-to-drink-now
 *   - thedrinksbusiness.com/2026/02/top-10-drinks-launches-from-february
 *   - nytimes.com/2026/01/02/dining/drinks/wines-to-drink-in-2026 (genres)
 *
 * Usage:
 *   node tests/manual/searchTestList.js
 *   node tests/manual/searchTestList.js --vivino-only
 *   node tests/manual/searchTestList.js --ratings-only
 *   node tests/manual/searchTestList.js --wine=3     (run single wine by index)
 */

import 'dotenv/config';
import { searchVivinoWines } from '../../src/services/vivinoSearch.js';
import { searchWineRatings } from '../../src/services/searchProviders.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 10 Test Wines ──────────────────────────────────────────────────────────────
const TEST_WINES = [
  {
    query: 'Tignanello',
    producer: 'Antinori',
    vintage: 2019,
    country: 'Italy',
    region: 'Tuscany',
    source: 'finewinedirect.co.uk Top 20'
  },
  {
    query: 'Bollinger Special Cuvée',
    producer: 'Bollinger',
    vintage: null,
    country: 'France',
    region: 'Champagne',
    source: 'finewinedirect.co.uk Top 20'
  },
  {
    query: 'Penfolds Bin 389 Cabernet Shiraz',
    producer: 'Penfolds',
    vintage: 2021,
    country: 'Australia',
    region: 'South Australia',
    source: 'finewinedirect.co.uk Top 20'
  },
  {
    query: 'Marqués de Riscal Rioja Reserva',
    producer: 'Marqués de Riscal',
    vintage: 2020,
    country: 'Spain',
    region: 'Rioja',
    source: 'finewinedirect.co.uk Top 20'
  },
  {
    query: 'Château Batailley',
    producer: 'Château Batailley',
    vintage: 2009,
    country: 'France',
    region: 'Pauillac',
    source: 'finewinedirect.co.uk Top 20'
  },
  {
    query: 'Dom Pérignon',
    producer: 'Moët & Chandon',
    vintage: 2012,
    country: 'France',
    region: 'Champagne',
    source: 'finewinedirect.co.uk Top 20'
  },
  {
    query: 'Clos du Val Cabernet Sauvignon',
    producer: 'Clos du Val',
    vintage: 2022,
    country: 'USA',
    region: 'Napa Valley',
    source: 'finewinedirect.co.uk Top 20 + NYT Napa Cab genre'
  },
  {
    query: 'Whispering Angel Rosé',
    producer: "Château d'Esclans",
    vintage: 2024,
    country: 'France',
    region: 'Provence',
    source: 'finewinedirect.co.uk Top 20'
  },
  {
    query: 'Terrazas de los Andes Grand Malbec',
    producer: 'Terrazas de los Andes',
    vintage: 2022,
    country: 'Argentina',
    region: 'Mendoza',
    source: 'thedrinksbusiness.com Feb 2026 launches'
  },
  {
    query: 'Rivetto Barolo Serralunga',
    producer: 'Rivetto',
    vintage: 2019,
    country: 'Italy',
    region: 'Piedmont',
    source: 'finewinedirect.co.uk Top 20'
  }
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatVivinoMatch(match, index) {
  const name = match.wineName || match.name || match.wine_name || 'unknown';
  const rating = match.rating ?? match.vivino_rating ?? '—';
  const vid = match.vivinoId || match.vivino_id || '—';
  const vintage = match.vintage || '—';
  return `  ${index + 1}. **${name}** (${vintage}) — ⭐ ${rating} — ID: ${vid}`;
}

function formatRatingsResult(result, index) {
  const src = result.sourceId || result.source || 'unknown';
  const lens = result.lens || '—';
  const title = result.title || '—';
  const idScore = result.identityScore ?? '—';
  const valid = result.identityValid != null ? (result.identityValid ? '✓' : '✗') : '—';
  const url = result.url || '—';
  return `  ${index + 1}. [${src}] (${lens}) — ID:${idScore} ${valid} — ${title}\n     ${url}`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function runTests() {
  const args = process.argv.slice(2);
  const vivinoOnly = args.includes('--vivino-only');
  const ratingsOnly = args.includes('--ratings-only');
  const singleWine = args.find(a => a.startsWith('--wine='));
  const singleIndex = singleWine ? parseInt(singleWine.split('=')[1]) - 1 : null;

  const wines = singleIndex !== null ? [TEST_WINES[singleIndex]] : TEST_WINES;
  const startIndices = singleIndex !== null ? [singleIndex] : TEST_WINES.map((_, i) => i);

  const runVivino = !ratingsOnly;
  const runRatings = !vivinoOnly;

  console.log(`\n🍷 Search Test Runner — ${wines.length} wines\n`);
  console.log(`  Vivino: ${runVivino ? 'YES' : 'SKIP'}`);
  console.log(`  Ratings: ${runRatings ? 'YES' : 'SKIP'}`);
  console.log(`  BrightData API: ${process.env.BRIGHTDATA_API_KEY ? '✓' : '✗'}`);
  console.log(`  SERP Zone: ${process.env.BRIGHTDATA_SERP_ZONE || '—'}`);
  console.log(`  Web Zone: ${process.env.BRIGHTDATA_WEB_ZONE || '—'}\n`);

  const results = [];
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

  for (let i = 0; i < wines.length; i++) {
    const wine = wines[i];
    const idx = startIndices[i];
    console.log(`─── [${idx + 1}/${TEST_WINES.length}] ${wine.query} ${wine.vintage || 'NV'} ───`);

    const result = {
      index: idx + 1,
      wine,
      vivino: null,
      vivinoError: null,
      vivinoTime: 0,
      ratings: null,
      ratingsError: null,
      ratingsTime: 0
    };

    // ── Vivino Search ──
    if (runVivino) {
      const t0 = Date.now();
      try {
        const vivinoResult = await searchVivinoWines({
          query: wine.query,
          producer: wine.producer,
          vintage: wine.vintage
        });
        result.vivinoTime = Date.now() - t0;
        result.vivino = vivinoResult;

        if (vivinoResult.error) {
          console.log(`  Vivino: ERROR — ${vivinoResult.error} (${result.vivinoTime}ms)`);
          result.vivinoError = vivinoResult.error;
        } else {
          const count = vivinoResult.matches?.length || 0;
          console.log(`  Vivino: ${count} match(es) (${result.vivinoTime}ms)`);
          if (count > 0) {
            const top = vivinoResult.matches[0];
            console.log(`    Top: ${top.wineName || top.name} — ⭐ ${top.rating ?? '—'}`);
          }
        }
      } catch (err) {
        result.vivinoTime = Date.now() - t0;
        result.vivinoError = err.message;
        console.log(`  Vivino: EXCEPTION — ${err.message} (${result.vivinoTime}ms)`);
      }

      if (runRatings) await delay(2000);
    }

    // ── Ratings Search (Decanter, critics, competitions) ──
    if (runRatings) {
      const t0 = Date.now();
      try {
        const ratingsResult = await searchWineRatings(
          wine.query,
          wine.vintage,
          wine.country,
          null // style
        );
        result.ratingsTime = Date.now() - t0;
        result.ratings = ratingsResult;

        const count = ratingsResult.results?.length || 0;
        const sources = [...new Set(ratingsResult.results?.map(r => r.sourceId) || [])];
        console.log(`  Ratings: ${count} result(s) from ${sources.length} source(s) (${result.ratingsTime}ms)`);
        console.log(`    Sources: ${sources.join(', ') || 'none'}`);
        console.log(`    SERP: targeted=${ratingsResult.targeted_hits}, broad=${ratingsResult.broad_hits}, variation=${ratingsResult.variation_hits}, producer=${ratingsResult.producer_hits}`);
        if (count > 0) {
          const top = ratingsResult.results[0];
          console.log(`    Top: [${top.sourceId}] ${top.title}`);
        }
      } catch (err) {
        result.ratingsTime = Date.now() - t0;
        result.ratingsError = err.message;
        console.log(`  Ratings: EXCEPTION — ${err.message} (${result.ratingsTime}ms)`);
      }
    }

    results.push(result);

    // Rate limit delay between wines
    if (i < wines.length - 1) {
      await delay(2000);
    }
  }

  // ── Generate Markdown Report ─────────────────────────────────────────────

  let md = `# Search Test Results\n\n`;
  md += `**Date**: ${timestamp}\n`;
  md += `**Wines tested**: ${results.length}\n`;
  md += `**Mode**: ${runVivino && runRatings ? 'Vivino + Ratings' : runVivino ? 'Vivino only' : 'Ratings only'}\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| # | Wine | Vintage | Vivino | Ratings | Sources | Total Time |\n`;
  md += `|---|------|---------|--------|---------|---------|------------|\n`;

  for (const r of results) {
    const vivinoCount = r.vivino?.matches?.length ?? 0;
    const vivinoTopRating = vivinoCount > 0 ? `${vivinoCount} (⭐${r.vivino.matches[0].rating ?? '—'})` : (r.vivinoError ? 'ERR' : '0');
    const ratingsCount = r.ratings?.results?.length ?? 0;
    const ratingsSources = [...new Set(r.ratings?.results?.map(x => x.sourceId) || [])];
    const ratingsCell = ratingsCount > 0 ? `${ratingsCount} results` : (r.ratingsError ? 'ERR' : '0');
    const sourcesCell = ratingsSources.length > 0 ? ratingsSources.join(', ') : (r.ratingsError ? 'ERR' : '—');
    const totalTime = `${r.vivinoTime + r.ratingsTime}ms`;

    md += `| ${r.index} | ${r.wine.query} | ${r.wine.vintage || 'NV'} | ${vivinoCell(r)} | ${ratingsCell} | ${sourcesCell} | ${totalTime} |\n`;
  }

  // Detailed results
  md += `\n## Detailed Results\n\n`;
  for (const r of results) {
    md += `### ${r.index}. ${r.wine.query} ${r.wine.vintage || 'NV'}\n\n`;
    md += `- **Producer**: ${r.wine.producer}\n`;
    md += `- **Region**: ${r.wine.region}, ${r.wine.country}\n`;
    md += `- **Source**: ${r.wine.source}\n\n`;

    // Vivino results
    if (runVivino) {
      if (r.vivinoError) {
        md += `**Vivino**: ERROR — ${r.vivinoError} (${r.vivinoTime}ms)\n\n`;
      } else if (r.vivino?.matches?.length > 0) {
        md += `**Vivino** (${r.vivinoTime}ms, ${r.vivino.matches.length} matches):\n\n`;
        for (let j = 0; j < r.vivino.matches.length; j++) {
          md += formatVivinoMatch(r.vivino.matches[j], j) + '\n';
        }
        md += '\n';
      } else {
        md += `**Vivino**: No matches (${r.vivinoTime}ms)\n\n`;
      }
    }

    // Ratings results
    if (runRatings) {
      if (r.ratingsError) {
        md += `**Ratings**: ERROR — ${r.ratingsError} (${r.ratingsTime}ms)\n\n`;
      } else if (r.ratings?.results?.length > 0) {
        const sources = [...new Set(r.ratings.results.map(x => x.sourceId))];
        md += `**Ratings** (${r.ratingsTime}ms, ${r.ratings.results.length} results from ${sources.length} sources):\n\n`;
        md += `- Targeted: ${r.ratings.targeted_hits}, Broad: ${r.ratings.broad_hits}, Variation: ${r.ratings.variation_hits}, Producer: ${r.ratings.producer_hits}\n\n`;
        for (let j = 0; j < r.ratings.results.length; j++) {
          md += formatRatingsResult(r.ratings.results[j], j) + '\n';
        }
        md += '\n';
      } else {
        md += `**Ratings**: No results (${r.ratingsTime}ms)\n\n`;
      }
    }

    md += `---\n\n`;
  }

  md += `## Test Wine Sources\n\n`;
  md += `1. [Fine Wine Direct — Top 20 Wines to Drink Now](https://www.finewinedirect.co.uk/collections/top-20-wines-to-drink-now)\n`;
  md += `2. [The Drinks Business — Top 10 Launches Feb 2026](https://www.thedrinksbusiness.com/2026/02/top-10-drinks-launches-from-february/)\n`;
  md += `3. [NYT — 10 Wines You Should Be Drinking in 2026](https://www.nytimes.com/2026/01/02/dining/drinks/wines-to-drink-in-2026.html) (genres: Napa Cab, Bordeaux, Ribera del Duero)\n`;

  // Write report
  const outPath = join(__dirname, '..', '..', 'docs', 'search-test-results.md');
  writeFileSync(outPath, md, 'utf8');
  console.log(`\n✅ Report written to ${outPath}`);

  // Quick pass/fail summary
  const vivinoHits = results.filter(r => r.vivino?.matches?.length > 0).length;
  const vivinoMisses = results.filter(r => !r.vivino?.matches?.length && !r.vivinoError).length;
  const vivinoErrors = results.filter(r => r.vivinoError).length;
  const ratingsHits = results.filter(r => r.ratings?.results?.length > 0).length;
  const ratingsMisses = results.filter(r => !r.ratings?.results?.length && !r.ratingsError).length;
  const ratingsErrors = results.filter(r => r.ratingsError).length;

  console.log(`\n📊 Summary:`);
  if (runVivino) console.log(`  Vivino: ${vivinoHits} hits, ${vivinoMisses} misses, ${vivinoErrors} errors out of ${results.length}`);
  if (runRatings) console.log(`  Ratings: ${ratingsHits} hits, ${ratingsMisses} misses, ${ratingsErrors} errors out of ${results.length}`);
}

// Helper for vivino summary cell
function vivinoCell(r) {
  const count = r.vivino?.matches?.length ?? 0;
  if (count > 0) return `${count} (⭐${r.vivino.matches[0].rating ?? '—'})`;
  if (r.vivinoError) return 'ERR';
  return '0';
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
