# Wine Search Benchmark - Analyst Guide

This guide helps analysts evaluate and improve wine search identity matching performance using our benchmark system.

---

## Quick Start

### 1. Run the Benchmark

```bash
# Install dependencies (first time only)
npm install

# Run benchmark with full report
npm run test:benchmark
```

This runs against 50 pre-captured search results and outputs performance metrics.

### 2. Understand the Output

```
╔══════════════════════════════════════════════════════════════╗
║           WINE SEARCH BENCHMARK RESULTS                      ║
╠══════════════════════════════════════════════════════════════╣
║ Mode: REPLAY                                                 ║
║ Total Cases: 50                                              ║
╠══════════════════════════════════════════════════════════════╣
║ Hit@1:  64.0%      (threshold: 80%)                         ✗║
║ Hit@3:  92.0%      (threshold: 90%)                         ✓║
║ MRR:    0.7683     (threshold: 0.85)                        ✗║
╠══════════════════════════════════════════════════════════════╣
║ Status: ❌ FAIL                                              ║
╚══════════════════════════════════════════════════════════════╝
```

**Key Metrics:**
- **Hit@1** (64%): Correct wine ranked first. *Target: 80%+*
- **Hit@3** (92%): Correct wine in top 3. *Target: 90%+*
- **MRR** (0.77): Mean Reciprocal Rank. *Target: 0.85+*

---

## Understanding the Data

### Benchmark Cases Location

All 50 test cases are defined in:
```
tests/fixtures/Search_Benchmark_v2_2.json
```

### Case Structure

Each case contains:

```json
{
  "id": "01_sa_nederburg_two_centuries_2019",
  "query": "Nederburg Private Bin Cabernet Sauvignon 2019",
  "country": "South Africa",
  "producer": "Nederburg",
  "vintage": 2019,
  "challenges": ["tier_name_hidden", "brand_vs_producer", "high_value"],
  "gold_canonical_name": "Nederburg Private Bin Two Centuries Cabernet Sauvignon 2019",
  "expected": {
    "min_results": 3,
    "must_include_domains": ["wine-searcher.com", "vivino.com"]
  }
}
```

| Field | Purpose |
|-------|---------|
| `query` | What users type to search |
| `gold_canonical_name` | The correct wine we should find |
| `challenges` | Why this case is difficult |
| `producer` | Winery name for identity matching |

### SERP Fixtures Location

Pre-captured search results are in:
```
tests/fixtures/serp-snapshots/
```

Each file contains the Google search results for that case's query.

---

## Analyzing Performance

### By Country

The benchmark output shows performance per country:

```
📍 Results by Country:
──────────────────────────────────────────────────
  Germany              ██████████ 100% hit@1 (n=5)
  Chile                ██████████ 100% hit@1 (n=4)
  New Zealand          ██████████ 100% hit@1 (n=4)
  France               ███████░░░  67% hit@1 (n=6)
  USA (California)     ██████░░░░  60% hit@1 (n=5)
  South Africa         █████░░░░░  50% hit@1 (n=4)
  Italy                ████░░░░░░  43% hit@1 (n=7)
  Spain                ████░░░░░░  43% hit@1 (n=7)
```

**Focus Areas:** Italy and Spain have the lowest performance (43%).

### By Challenge Category

```
🏷️  Results by Challenge Category:
──────────────────────────────────────────────────
  numeric              ██████████ 100% hit@1 (n=3)
  disambiguation       █████████░  87% hit@1 (n=15)
  diacritics           ████████░░  78% hit@1 (n=9)
  vineyard             ███████░░░  73% hit@1 (n=11)
  classification       ██████░░░░  62% hit@1 (n=13)
  brand_producer       █████░░░░░  53% hit@1 (n=17)
  search_difficulty    ████░░░░░░  38% hit@1 (n=13)
```

**Focus Areas:** `search_difficulty` (38%) and `brand_producer` (53%) need improvement.

### Failure Analysis

The report lists specific failures:

```
⚠️  Failures (not hit@1):
──────────────────────────────────────────────────
  03_it_doppio_passo_primitivo_2021:
    Query: "Doppio Passo Primitivo 2021"
    Result: not found
    Top: "Botter Doppio Passo Primitivo 2021 | Vivino"

  21_es_vega_sicilia_unico_2010:
    Query: "Vega Sicilia Unico 2010"
    Result: position 6
    Top: "2010 Vega Sicilia, Único, Ribera del Duero, Spa..."
```

---

## Deep Dive Analysis

### View Full Benchmark Results

After running the benchmark, detailed results are saved to:
```
tests/benchmark/results/benchmark-replay-latest.json
```

This JSON file contains:
- All case results with rankings
- Per-case identity scores
- Which tokens matched/missed
- Full SERP result titles

### Examine a Specific Case

To analyze why a case failed:

```bash
# View the case definition
cat tests/fixtures/Search_Benchmark_v2_2.json | jq '.cases[] | select(.id == "21_es_vega_sicilia_unico_2010")'

# View the SERP fixture (what Google returned)
# Fixtures are gzip-compressed
gunzip -c tests/fixtures/serp-snapshots/21_es_vega_sicilia_unico_2012.json.gz | jq '.organic[:5]'
```

### Run a Single Case

```bash
# Run benchmark for just one case
node -e "
import('./tests/benchmark/benchmarkRunner.js').then(async ({ runBenchmark, BENCHMARK_MODES }) => {
  const report = await runBenchmark(BENCHMARK_MODES.REPLAY, {
    caseIds: ['21_es_vega_sicilia_unico_2010'],
    verbose: true
  });
  console.log(JSON.stringify(report.rawResults[0], null, 2));
});
"
```

---

## The Identity Matching Algorithm

### How It Works

The identity scorer is in `src/services/wineIdentity.js`. It:

1. **Generates identity tokens** from the wine:
   - Producer name tokens
   - Range/line name tokens
   - Vintage
   - Grape variety (if known)

2. **Scores each search result** by matching tokens against:
   - Result title
   - Result snippet

3. **Validates identity** based on:
   - Producer match (required)
   - Vintage match (required if specified)
   - Sufficient token overlap

### Key Functions to Review

| File | Function | Purpose |
|------|----------|---------|
| `src/services/wineIdentity.js` | `generateIdentityTokens()` | Creates tokens from wine data |
| `src/services/wineIdentity.js` | `calculateIdentityScore()` | Scores a result against tokens |
| `tests/benchmark/identityScorer.js` | `rankResults()` | Ranks SERP results by identity |
| `tests/benchmark/identityScorer.js` | `scoreIdentityMatch()` | Checks if gold name was found |

### Viewing Token Generation

```javascript
// In Node REPL or a test file
import { generateIdentityTokens } from './src/services/wineIdentity.js';

const tokens = generateIdentityTokens({
  winery: 'Vega Sicilia',
  wine_name: 'Unico',
  vintage: '2010'
});

console.log(tokens);
// {
//   identity: ['vega', 'sicilia', 'unico', '2010'],
//   discovery: ['vega sicilia', 'unico'],
//   ...
// }
```

---

## Challenge Categories Explained

### Why Cases Fail

| Category | Description | Common Issues |
|----------|-------------|---------------|
| **brand_producer** | Producer name confused with brand/range | "Cloudy Bay" is both producer and line name |
| **search_difficulty** | High noise in search results | Generic terms like "Reserve" return many wines |
| **classification** | Wine classification terms | "Gran Reserva" matches many Spanish wines |
| **name_complexity** | Long or unusual names | Apostrophes, hyphens, multiple words |
| **diacritics** | Accented characters | "Müller" vs "Muller", "Château" vs "Chateau" |
| **disambiguation** | Similar wines from same producer | Multiple vintages, tiers, or vineyards |
| **vineyard** | Vineyard-designated wines | "Adrianna Vineyard" specific matching |
| **numeric** | Numeric identifiers | "Bin 389", "Cuvée 128" |

### Challenge Distribution

```bash
# See all challenges and their frequency
cat tests/fixtures/Search_Benchmark_v2_2.json | jq '[.cases[].challenges[]] | group_by(.) | map({challenge: .[0], count: length}) | sort_by(.count) | reverse'
```

---

## Improving Search Effectiveness

### Hypothesis Testing Workflow

1. **Identify pattern** in failures (e.g., "Spanish wines with classification terms fail")

2. **Modify identity matching** in `src/services/wineIdentity.js`

3. **Run benchmark** to measure impact:
   ```bash
   npm run test:benchmark
   ```

4. **Compare results** against baseline:
   ```bash
   # Results are saved automatically for comparison
   cat tests/benchmark/results/benchmark-replay-latest.json | jq '.summary'
   ```

### Common Improvements

| Issue | Potential Fix |
|-------|---------------|
| Producer not matching | Add producer aliases, handle "Château" prefix |
| Classification noise | Require classification term + producer together |
| Vintage mismatch | Fuzzy match ±1 year for recent vintages |
| Diacritics | Normalize accents before matching |
| Brand confusion | Distinguish producer-level vs range-level tokens |

### Testing a Hypothesis

Example: "Spanish Gran Reserva wines fail because 'Gran Reserva' matches too many results"

```bash
# 1. Find all Spanish classification cases
cat tests/fixtures/Search_Benchmark_v2_2.json | jq '[.cases[] | select(.country == "Spain" and (.challenges | contains(["classification_gran_reserva"])))]'

# 2. Run benchmark on just those cases
node -e "
import('./tests/benchmark/benchmarkRunner.js').then(async ({ runBenchmark, BENCHMARK_MODES }) => {
  const cases = ['18_es_cvne_imperial_gran_reserva_2015', '19_es_rioja_alta_904_2015'];
  const report = await runBenchmark(BENCHMARK_MODES.REPLAY, { caseIds: cases, verbose: true });
  console.log('Hit@1:', report.summary.hit_at_1);
});
"

# 3. Examine the failures
gunzip -c tests/fixtures/serp-snapshots/18_es_cvne_imperial_gran_reserva_2015.json.gz | jq '.organic[:5] | .[].title'
```

---

## Refreshing Test Data

### When to Refresh Fixtures

- SERP results change over time
- Fixtures older than 30 days may be stale
- After adding new test cases

### Check Staleness

```bash
npm run test:benchmark:staleness
```

### Record Fresh Fixtures

Requires BrightData API credentials in `.env`:

```bash
# Record all fixtures
npm run test:benchmark:record

# Record specific case
npm run test:benchmark:record -- --case-id 21_es_vega_sicilia_unico_2010 --force
```

---

## Adding New Test Cases

### 1. Add Case to Benchmark File

Edit `tests/fixtures/Search_Benchmark_v2_2.json`:

```json
{
  "id": "51_xx_new_wine_2023",
  "query": "Producer Wine Name 2023",
  "country": "Country",
  "producer": "Producer",
  "vintage": 2023,
  "challenges": ["relevant_challenges"],
  "gold_canonical_name": "Full Correct Wine Name 2023",
  "expected": {
    "min_results": 3,
    "must_include_domains": ["wine-searcher.com"]
  }
}
```

### 2. Validate Schema

```bash
npm run test:benchmark:validate
```

### 3. Record Fixture

```bash
npm run test:benchmark:record -- --case-id 51_xx_new_wine_2023
```

### 4. Run Benchmark

```bash
npm run test:benchmark
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `tests/fixtures/Search_Benchmark_v2_2.json` | Test case definitions |
| `tests/fixtures/serp-snapshots/*.json.gz` | Captured search results |
| `src/services/wineIdentity.js` | **Identity matching algorithm** |
| `tests/benchmark/identityScorer.js` | Benchmark scoring wrapper |
| `tests/benchmark/benchmarkRunner.js` | Benchmark execution |
| `tests/benchmark/metricsReporter.js` | Report generation |
| `tests/benchmark/results/` | Saved benchmark results |

---

## Metrics Interpretation

### MRR (Mean Reciprocal Rank)

MRR rewards finding correct results earlier:
- Position 1 → score 1.0
- Position 2 → score 0.5
- Position 3 → score 0.33
- Not found → score 0

**Current MRR: 0.77** means on average, the correct wine is found around position 1.3.

### Hit@K

- **Hit@1 = 64%**: Correct wine is #1 result 64% of the time
- **Hit@3 = 92%**: Correct wine is in top 3 results 92% of the time

The gap (64% → 92%) shows we're often close but not quite right.

---

## Common Analysis Queries

### Find All Failures

```bash
cat tests/benchmark/results/benchmark-replay-latest.json | jq '[.failures[] | {id: .caseId, query: .query, position: .actualPosition}]'
```

### Find Cases by Challenge

```bash
cat tests/fixtures/Search_Benchmark_v2_2.json | jq '[.cases[] | select(.challenges | contains(["brand_only"]))] | .[].id'
```

### Compare Two Challenge Categories

```bash
cat tests/benchmark/results/benchmark-replay-latest.json | jq '.byChallengeCategory | {brand_producer, diacritics}'
```

### Export Failures to CSV

```bash
cat tests/benchmark/results/benchmark-replay-latest.json | jq -r '.failures[] | [.caseId, .query, .actualPosition, .topResult] | @csv' > failures.csv
```

---

## Next Steps

1. **Run the benchmark** and review the output
2. **Identify patterns** in the failure cases
3. **Form hypotheses** about why matching fails
4. **Test improvements** to `wineIdentity.js`
5. **Measure impact** with benchmark metrics
6. **Document findings** and successful changes

For questions about the benchmark system, see [BENCHMARK_MAINTENANCE.md](./BENCHMARK_MAINTENANCE.md).

---

## Appendix A: Gold Standard Reference Data

This appendix contains verified ratings and identity details for key benchmark wines. Use this as ground truth when investigating failures.

### A.1 Nederburg Private Bin Two Centuries (2019)
**Full Name**: Nederburg Private Bin Two Centuries Cabernet Sauvignon 2019
**Producer**: Nederburg Wines | **Origin**: Paarl, South Africa
| Source | Rating | Notes |
|--------|--------|-------|
| Decanter WWA | 95/100 | 2023 Awards |
| Platter's | 5 Stars | Premium tier |
| Tim Atkin | 92/100 | |
| Vivino | 4.4-4.5 | Community |

**Identity Note**: "Two Centuries" is the premium tier. Label says "Private Bin" with "Two Centuries" below.

### A.2 Kleine Zalze Vineyard Selection Chenin (2023)
**Full Name**: Kleine Zalze Vineyard Selection Chenin Blanc 2023
**Producer**: Kleine Zalze | **Origin**: Stellenbosch, South Africa
| Source | Rating |
|--------|--------|
| Platter's | 4.5 Stars |
| Tim Atkin | 91/100 |
| Mundus Vini | Gold |

**Identity Note**: "Vineyard Selection" is distinct from "Cellar Selection" or "Family Reserve".

### A.3 1865 Selected Vineyards Carmenere (2018)
**Full Name**: San Pedro 1865 Selected Vineyards Carmenère 2018
**Producer**: Viña San Pedro | **Origin**: Maule Valley, Chile
| Source | Rating |
|--------|--------|
| Wine Enthusiast | 91/100 |
| Tim Atkin | 92/100 |
| Descorchados | 91/100 |

**Identity Note**: "1865" is the brand, "San Pedro" is the producer.

### A.4 CVNE / Cune Rioja (Various)
**Producer**: Compañía Vinícola del Norte de España (CVNE)
**Aliases**: CVNE, Cune, C.V.N.E.

**Identity Note**: The acronym "CVNE" and trade name "Cune" refer to the same producer. Search must handle both.

### A.5 Louis Roederer Cristal (NV/Various)
**Full Name**: Louis Roederer Cristal Champagne
**Producer**: Louis Roederer | **Aliases**: Roederer, Maison Roederer

**Identity Note**: "Cristal" is the prestige cuvée. Don't confuse with standard "Brut Premier".

### A.6 Vega Sicilia Único (Various)
**Full Name**: Vega Sicilia Único
**Producer**: Bodegas Vega Sicilia | **Origin**: Ribera del Duero, Spain

**Identity Note**: Flagship wine. Often appears without "Bodegas" prefix in search results.

### A.7 Backsberg The Patriarch (2022)
**Full Name**: Backsberg The Patriarch Cabernet Franc 2022
**Producer**: Backsberg Family Wines | **Origin**: Stellenbosch, South Africa
| Source | Rating |
|--------|--------|
| Decanter WWA | 97/100 |
| IWSC | 95/100 |
| Tim Atkin | 91/100 |

**Identity Note**: Flagship wine. Note the definite article "The Patriarch".

---

*For the complete 50-case benchmark dataset, see `tests/fixtures/Search_Benchmark_v2_2.json`.*
