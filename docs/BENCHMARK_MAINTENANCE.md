# Wine Search Benchmark Maintenance Guide

This document covers the maintenance and operation of the wine search benchmark system.

## Overview

The benchmark system evaluates wine search identity matching using 50 curated test cases across 10 countries. It runs in three modes:

| Mode | Purpose | API Calls | When to Use |
|------|---------|-----------|-------------|
| **REPLAY** | Deterministic CI testing | None | Every PR, local dev |
| **RECORD** | Capture fresh fixtures | 50 | Fixture refresh |
| **LIVE** | Validate against real SERP | 50 | Nightly regression |

## Quick Commands

```bash
# Run benchmark (REPLAY mode - default)
npm run test:benchmark

# Validate benchmark schema
npm run test:benchmark:validate

# Check fixture staleness
npm run test:benchmark:staleness

# Record new fixtures (requires API keys)
npm run test:benchmark:record

# Run LIVE mode (requires API keys)
BENCHMARK_MODE=live npm run test:benchmark:live
```

## Fixture Management

### Fixture Location

Fixtures are stored in `tests/fixtures/serp-snapshots/` as gzip-compressed JSON files:

```
tests/fixtures/serp-snapshots/
├── 01_sa_nederburg_two_centuries_2019.json.gz
├── 02_sa_kleine_zalze_vineyard_selection_2023.json.gz
└── ... (50 files total)
```

### Fixture Staleness

Fixtures older than 30 days are considered stale. Check staleness with:

```bash
npm run test:benchmark:staleness
```

The nightly CI workflow automatically creates GitHub issues when fixtures become stale.

### Refreshing Fixtures

To refresh all fixtures:

```bash
# Ensure API keys are configured
export BRIGHTDATA_API_KEY="your-key"
export BRIGHTDATA_SERP_ZONE="your-zone"

# Record fresh fixtures
npm run test:benchmark:record
```

To refresh a single fixture:

```bash
npm run test:benchmark:record -- --case-id 01_sa_nederburg_two_centuries_2019 --force
```

### Fixture Options

| Flag | Description |
|------|-------------|
| `--case-id <id>` | Record only specific case |
| `--dry-run` | Show what would be recorded |
| `--force` | Re-record even if fixture exists |
| `--verbose` | Show detailed output |

## Benchmark Cases

### Case File Location

Cases are defined in `tests/fixtures/Search_Benchmark_v2_2.json`.

### Case Schema

Each case requires:

```json
{
  "id": "01_sa_nederburg_two_centuries_2019",
  "query": "Nederburg Private Bin Cabernet Sauvignon 2019",
  "country": "South Africa",
  "producer": "Nederburg",
  "vintage": 2019,
  "challenges": ["tier_name_hidden", "brand_vs_producer"],
  "gold_canonical_name": "Nederburg Private Bin Two Centuries Cabernet Sauvignon 2019",
  "expected": {
    "min_results": 3,
    "must_include_domains": ["wine-searcher.com", "vivino.com"]
  }
}
```

### Challenge Taxonomy

Challenges are grouped into categories:

| Category | Challenges |
|----------|------------|
| **brand_producer** | `brand_only`, `brand_line`, `brand_vs_producer`, `producer_acronym` |
| **classification** | `classification_reserva`, `classification_gran_reserva`, `premier_cru`, `pradikat_term` |
| **diacritics** | `diacritics_optional`, `umlaut_optional`, `accented_grape` |
| **disambiguation** | `tier_disambiguation`, `vintage_disambiguation` |
| **name_complexity** | `long_name`, `very_long_name`, `short_query`, `apostrophe` |
| **numeric** | `numeric_bin`, `numeric_cuvee` |
| **region** | `subregion_token`, `appellation_token` |
| **search_difficulty** | `retail_noise`, `icon_wine_short_query` |
| **special_types** | `non_vintage`, `super_tuscan`, `prestige_champagne` |
| **vineyard** | `single_vineyard`, `vineyard_name`, `finca_keyword` |

### Adding New Cases

1. Add case to `tests/fixtures/Search_Benchmark_v2_2.json`
2. Validate schema: `npm run test:benchmark:validate`
3. Record fixture: `npm run test:benchmark:record -- --case-id <new-id>`
4. Run benchmark to verify: `npm run test:benchmark`

## Metrics

### Primary Metrics

| Metric | Description | Baseline | Target |
|--------|-------------|----------|--------|
| **hit@1** | Correct wine in position 1 | ≥60% | ≥80% |
| **hit@3** | Correct wine in top 3 | ≥90% | ≥95% |
| **MRR** | Mean Reciprocal Rank | ≥0.75 | ≥0.85 |

### Category Thresholds

Each challenge category has a minimum hit@1 threshold:

| Category | Threshold |
|----------|-----------|
| diacritics | 90% |
| numeric | 90% |
| disambiguation | 85% |
| classification | 85% |
| brand_producer | 80% |
| vineyard | 80% |
| name_complexity | 75% |
| special_types | 75% |
| region | 75% |
| search_difficulty | 60% |

## CI Integration

### GitHub Actions Workflow

The benchmark runs automatically via `.github/workflows/benchmark.yml`:

- **On PR/Push**: REPLAY mode (fast, no API calls)
- **Nightly (3 AM UTC)**: LIVE mode + staleness check
- **Manual**: Trigger any job via workflow_dispatch

### Required Secrets

For LIVE mode, configure these in GitHub repository settings:

- `BRIGHTDATA_API_KEY` - BrightData API key
- `BRIGHTDATA_SERP_ZONE` - BrightData SERP zone name

### Artifacts

Benchmark results are uploaded as GitHub artifacts:

- `benchmark-replay-results` - REPLAY mode results (30-day retention)
- `benchmark-live-results-{run}` - LIVE mode results (90-day retention)

## Troubleshooting

### "Missing fixture" Errors

```bash
# Check which fixtures are missing
npm run test:benchmark:staleness

# Record missing fixtures
npm run test:benchmark:record
```

### Low hit@1 on Specific Cases

1. Check the case query matches wine databases
2. Review SERP results in fixture file
3. Verify gold_canonical_name is correct
4. Consider if identity matching needs tuning

### Fixture Decompression Errors

Fixtures have a 10MB decompression limit (CWE-409 protection). If a fixture fails:

```bash
# Delete and re-record the problematic fixture
rm tests/fixtures/serp-snapshots/<case-id>.json.gz
npm run test:benchmark:record -- --case-id <case-id>
```

### API Rate Limiting

The record script uses 1.5s delays between requests. If you hit rate limits:

1. Wait 5 minutes and retry
2. Use `--case-id` to record incrementally
3. Check BrightData dashboard for quota

## Performance Analysis

### Country Heatmap

The benchmark generates a performance heatmap by country:

```
🗺️  Country Performance Heatmap:
────────────────────────────────────────────────────────────────
  Legend: 🟢 ≥90%  🟡 ≥75%  🟠 ≥60%  🔴 <60%

  🟢 Germany            ███████████████ 100% (n=5)
  🟢 Chile              ███████████████ 100% (n=4)
  🟢 New Zealand        ███████████████ 100% (n=4)
  🟡 France             ██████████░░░░░  67% (n=6)
  🟠 USA (California)   █████████░░░░░░  60% (n=5)
  🔴 Italy              ██████░░░░░░░░░  43% (n=7)
  🔴 Spain              ██████░░░░░░░░░  43% (n=7)
```

### Regression Detection

The system compares against baseline reports:

```javascript
// In code
import { compareWithBaseline } from './metricsReporter.js';

const comparison = await compareWithBaseline(currentReport);
if (comparison?.regression.overallRegression) {
  console.log('Regression detected!');
}
```

## Files Reference

| File | Purpose |
|------|---------|
| `tests/benchmark/benchmarkRunner.js` | Main 3-mode benchmark runner |
| `tests/benchmark/identityScorer.js` | Wine identity matching wrapper |
| `tests/benchmark/metricsReporter.js` | Report generation and analysis |
| `tests/benchmark/serpClient.js` | BrightData SERP client |
| `tests/benchmark/serpFixtureManager.js` | Fixture CRUD and validation |
| `tests/benchmark/recordFixtures.js` | CLI for fixture capture |
| `tests/benchmark/checkStaleness.js` | CLI for staleness check |
| `tests/benchmark/validateSchema.js` | Schema validation CLI |
| `tests/benchmark/searchBenchmark.test.js` | Vitest test file |
| `tests/fixtures/Search_Benchmark_v2_2.json` | Benchmark cases |
| `tests/fixtures/serp-snapshots/*.json.gz` | SERP fixture files |
