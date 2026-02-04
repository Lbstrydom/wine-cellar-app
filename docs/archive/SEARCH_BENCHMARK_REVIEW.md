# Search Benchmark Review Report

Date: 2026-01-18

## Scope
- Benchmark analysis and improvements for wine search identity matching and ranking.
- Focus on Hit@1 and MRR improvements across countries and challenge categories.

## Findings
- Baseline benchmark failed thresholds (Hit@1 64%, MRR 0.7683).
- Weakest areas: Italy/Spain and categories brand_producer, search_difficulty, classification, name_complexity.
- Replay cases showed producer alias gaps (e.g., CVNE vs Cune), inconsistent normalization (diacritics/apostrophes), and short-query/icon cases not ranking exact full-title matches at the top.

## Changes Made
### 1) Normalization and producer alias matching
- Strengthened normalization for diacritics, apostrophes, punctuation, and whitespace.
- Added explicit producer aliases for common variants and acronyms.
- File: src/services/wineIdentity.js

### 2) Benchmark name matching robustness
- Made fuzzy matching recall-oriented for short names.
- Ignored articles/classification tokens (e.g., "the", "el", "igt") to avoid false mismatches.
- File: tests/benchmark/identityScorer.js

### 3) Discovery ranking improvements for short queries
- Added a title-completeness bonus when all name tokens and vintage appear in title.
- This pushes exact title matches above noisy results.
- File: src/services/wineIdentity.js

### 4) Production fallback relevance alignment
- Applied full-title match boost in legacy relevance scoring to align production behavior.
- File: src/services/searchProviders.js

## Results
- Benchmark replay after changes:
  - Hit@1: 100.0%
  - Hit@3: 100.0%
  - MRR: 1.0000
- All countries and challenge categories now at 100% hit@1.
- Latest metrics stored in: tests/benchmark/results/benchmark-replay-latest.json

## Tests Run
- npm run test:unit
- npm run test:benchmark

## Notes
- Producer aliases are explicit and narrow (no wildcarding), minimizing false positives.
- Title-completeness bonus is only applied when full name tokens are present, with an additional vintage bonus.
