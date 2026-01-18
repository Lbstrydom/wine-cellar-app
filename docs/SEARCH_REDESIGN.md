# Search Pipeline Redesign (End-to-End)

## Purpose
Improve real-world search effectiveness to match or exceed plain Google results while reducing false positives, missed sources, and brittle scraping. This redesign addresses both execution issues and strategy gaps.

## Goals
- Increase successful source discovery for reviews, awards, and ratings.
- Improve precision (fewer wrong wines/false positives).
- Reduce brittleness for Vivino/Decanter and other protected sites.
- Make results explainable and debuggable with clear provenance.
- Maintain cost and latency guardrails.

## Non-Goals
- Replace all existing providers (Bright Data, Gemini, Claude).
- Add new third-party APIs without explicit approval.

## Current Pain Points (Observed)
- SERP parsing errors can drop results entirely.
- Vivino/Decanter require special handling but are not first-class in the generic pipeline.
- Tier 1 AI Overview is treated as a source of truth, but it is best used for discovery.
- Locale hints exist but are not consistently applied to query shaping.
- Blocked/empty results can be cached too long, masking fixes.
- **Wine identity validation is weak** - ratings for wrong vintages or similar-named wines get attached.
- **No confidence gate** - low-quality single-source ratings are persisted without corroboration.
- **Producer website awards have <5% extraction success** despite being found in 30% of searches.

---

## High-Level Design

The pipeline uses a **single candidate pool** model: all discovery sources (SERP, AI Overview, Gemini) append URLs to one unified pool. Fetch is then ranked by score regardless of which tier discovered the URL.

```
Input Wine -> Normalization -> Identity Tokens -> Query Builder -> Discovery (unified pool) -> URL Scoring -> Domain Fetch -> Aggregate -> Confidence Gate -> Persist
```

**Key principle**: Tiers are discovery sources, not sequential stages. URLs compete on quality, not discovery order.

### Stage 1: Normalization
- Canonicalize wine identity: producer, range, grape, vintage.
- Generate strict and loose name variants.
- Record locale hints (country, market, language).
- Generate identity tokens for validation (see Stage 1b).

### Stage 1b: Identity Token Generation

Generate two distinct token sets for URL/rating validation:

#### Wine Identity Score (strict match)
Used to validate that a rating belongs to this specific wine:

| Token Type | Example | Weight |
|------------|---------|--------|
| Producer (required) | "kanonkop" | Must match |
| Vintage (required) | "2019" | Must match |
| Range/Cuvee | "paul sauer" | +2 if match |
| Grape | "cabernet" | +1 if match |

#### Generic Token Overlap (discovery ranking)
Used to rank URLs during discovery - looser matching:

| Token Type | Example | Notes |
|------------|---------|-------|
| All name tokens | ["kanonkop", "paul", "sauer", "2019"] | Count matches |
| Region tokens | ["stellenbosch", "south africa"] | Boost local sources |

**Key distinction**: Identity score determines if a rating is valid. Token overlap determines if a URL is worth fetching. Don't conflate them.

#### Negative tokens (reject if present):
- Competing producer names (e.g., "Margaux du Bord" when searching "Margaux")
- Wrong vintage years (any 4-digit year != target vintage)
- Wrong wine type (e.g., "rosé" when searching for red)

### Stage 2: Query Builder
- Build multiple query profiles:
  - Reviews: "producer range vintage review rating points"
  - Awards: "producer range vintage medal award gold silver"
  - Community: "site:vivino.com <query> stars rating"
- Apply locale hints to `hl`/`gl` for SERP calls.
- Limit operator-heavy queries; retry without operators on zero results.
- Include region-specific sources in query templates (e.g., Platters, Halliday).
- Add producer-specific query for award extraction: "site:producerdomain.com awards medals"

### Stage 3: Discovery + Fast Extraction

**Unified candidate pool**: All discovery sources append to one URL list.

**Fast Path (AI Overview has rating)**:
- If AI Overview contains score pattern (e.g., "94 points", "4.2 stars"):
  - Extract immediately with source attribution
  - Validate against **wine identity score** (not generic overlap)
  - If valid, add to results (don't wait for URL fetch)
- This handles the common case of well-known wines efficiently

**Thorough Path (collect URLs for unified pool)**:
- SERP organic results → append to candidate pool
- AI Overview citations → append to candidate pool
- Knowledge Graph links → append to candidate pool
- Gemini grounded search (conditional) → append to candidate pool
- Dedupe by URL, keep highest-scoring metadata

**Gemini Conditional Logic** (quality gate):

Skip Gemini if ANY of these conditions is true:
1. Fast path yielded >= 2 ratings with `confidence = high`
2. Candidate pool has >= 6 URLs AND top URL has identity score >= 4 (producer + vintage + 2 optional)
3. Candidate pool contains a producer OR competition URL with exact wine + vintage match

Force Gemini if ANY of these conditions is true:
1. Candidate pool has < 3 URLs
2. Wine is high-ambiguity (name < 3 tokens, missing producer, missing vintage)
3. No ratings found AND wine is from underrepresented region (not France/Italy/USA/Australia)

### Stage 4: URL Scoring and Filtering

**Two-tier scoring system:**

#### Tier A: Wine Identity Score (determines validity)
```
identity_score =
  (producer_match ? 2 : 0) +
  (vintage_match ? 2 : 0) +
  (range_match ? 1 : 0) +
  (grape_match ? 1 : 0) +
  (region_match ? 1 : 0) -
  (has_negative_token ? 10 : 0)

Minimum threshold: 4 (producer + vintage required)
```

#### Tier B: Fetch Priority Score (determines fetch order)
```
fetch_priority =
  (is_known_source ? 2 : 0) +
  (has_review_pattern ? 1 : 0) +
  (has_award_pattern ? 1 : 0) +
  (is_protected_domain ? -1 : 0)  # Prefer easy fetches
```

**Ranking algorithm**:
1. Reject URLs with `identity_score < 4` (missing producer or vintage)
2. Sort by `identity_score` descending (best wine matches first)
3. Within same identity score, sort by `fetch_priority` descending
4. Apply per-lens caps (market-aware, see below)

### Stage 4b: Market-Aware Per-Lens Caps

Different markets have different source landscapes. Caps should reflect this:

| Market | Competition | Panel/Critic | Community | Aggregator | Producer |
|--------|-------------|--------------|-----------|------------|----------|
| South Africa | 3 | 2 | 1 | 1 | 2 |
| Australia | 2 | 3 | 1 | 1 | 2 |
| France | 2 | 3 | 1 | 1 | 1 |
| USA | 2 | 2 | 2 | 1 | 1 |
| Default | 2 | 2 | 1 | 1 | 2 |

**Rationale**:
- South Africa: Strong competition culture (Michelangelo, SAGWA, Platters Trophy)
- Australia: Critic-heavy (Halliday, Campbell Mattinson)
- France: Dense critic coverage (RVF, Bettane+Desseauve)
- USA: Balanced with strong community (Vivino/CellarTracker)

**Total URLs**: 8 max (sum of caps for market)

### Stage 5: Domain-Specific Fetch

**Protected domains get dedicated flows:**

#### Vivino Flow
1. Always use Web Unlocker with JS rendering
2. Wait for `__NEXT_DATA__` script tag
3. Parse JSON for: `vintage.statistics.ratings_average`, `ratings_count`
4. **Validate**: Check `wine.name` in response against identity tokens
5. Fallback: Puppeteer (local dev only)
6. Cache: 24h success, 2h blocked/empty

#### Decanter Flow
1. Use Web Unlocker (JS not required)
2. Extract embedded JSON-LD or `<script type="application/ld+json">`
3. Parse for: score, drink window, tasting notes
4. **Validate**: Check vintage in response against identity tokens
5. Fallback: Puppeteer (local dev only)
6. Cache: 24h success, 4h blocked/empty

#### Wine-Searcher Flow
1. Check robots.txt compliance first
2. Use Web Unlocker if allowed
3. Extract critic scores from comparison table
4. Note: scores are aggregated, apply AGGREGATOR_CREDIBILITY_DISCOUNT
5. Cache: 48h (changes infrequently)

#### Producer Website Flow
1. Check robots.txt via `robotsParser.js`
2. Direct fetch (most producer sites don't block)
3. Look for: JSON-LD, Open Graph tags, award badge images
4. **Structured extraction patterns**:
   - `/awards/` pages: scan for medal images, competition names
   - `/press/` pages: scan for score mentions with source attribution
5. AI extraction only if structured fails
6. Cache: 7 days (rarely changes)

#### Generic Domain Flow
1. Direct fetch with 10s timeout
2. If blocked (403/429), retry with Web Unlocker
3. If still blocked, skip
4. Cache: 24h success, 2h blocked

### Stage 6: Extraction

**Extraction priority order:**
1. **Structured first**: JSON-LD, `__NEXT_DATA__`, embedded JSON
2. **DOM selectors**: Known patterns for specific domains
3. **AI extraction**: Only for unstructured content, with cleaned HTML

**Evidence capture** (required for all ratings):
- Source URL
- Extraction method (json_ld, dom, ai)
- Raw score text (e.g., "94 points", "Gold Medal")
- Surrounding context (50 chars before/after)
- Timestamp
- Wine identity score at extraction time

### Stage 7: Aggregation

- Normalize all scores to 0-100 scale using source-specific normalizers
- Weight by lens credibility (from `LENS_CREDIBILITY` config)
- Apply vintage match modifier:
  - Exact vintage match: 1.0x
  - Inferred vintage: 0.85x
  - No vintage info: 0.7x

### Stage 8: Confidence Gate

**Before persisting, validate rating quality:**

| Condition | Action |
|-----------|--------|
| `identity_score < 4` | Reject rating entirely |
| Single source + low credibility (community/aggregator) | Flag as `needs_corroboration`, don't include in purchase_score |
| Vintage mismatch + no exact match available | Flag as `vintage_inferred`, reduce weight |
| Score from aggregator without original source URL | Flag as `unattributed`, apply 0.7x discount |
| Producer name not found in source content | Reject rating entirely |
| Multiple sources agree (within 5 points) | Boost confidence to `high` |

**Persistence rules:**
- Always persist with full provenance metadata
- `confidence_level`: high (corroborated), medium (single credible source), low (single low-credibility)
- Ratings with `confidence_level = low` don't contribute to `purchase_score` unless user opts in

### Stage 9: Persistence and Provenance

Store ratings with:
- Source URL
- Retrieval method (serp_snippet, json_ld, dom, ai, unlocker)
- Evidence snippet (raw extracted text)
- Confidence level (high/medium/low)
- Vintage match type (exact/inferred/none)
- Identity validation result (identity_score, producer_match, vintage_match)
- Extraction timestamp

---

## Domain-Specific Flows

### Vivino
1. Discover URLs via SERP `site:vivino.com` query.
2. Fetch via Web Unlocker with JS rendering (must preserve `__NEXT_DATA__`).
3. Parse `__NEXT_DATA__` for rating, count, wine info.
4. **Validate**: Check `wine.name` in response contains producer + vintage tokens.
5. Fall back to Puppeteer locally only if unlocker fails or is not configured.

### Decanter
1. Discover review URLs via SERP `site:decanter.com/wine-reviews`.
2. Fetch via Web Unlocker.
3. Extract embedded JSON (score, drink window, review).
4. **Validate**: Check vintage in `datePublished` or review text.
5. Puppeteer fallback for local dev only if unlocker fails or is not configured.

### Producer Websites
1. Discover via hedged producer search (already implemented).
2. Check `robots.txt` compliance via `robotsParser.js`.
3. Fetch award/press pages with direct fetch.
4. **Structured extraction**:
   - Scan for competition names from `SOURCES` registry
   - Match medal keywords (gold, silver, bronze, double gold)
   - Extract year from surrounding context
5. **Validation**: Award year should be >= vintage year, <= current year.
6. Cache 7 days.

---

## Tier Skip Logic (Unified Pool Model)

**Tier 1 (SERP + AI extraction)** always runs:
- Extract ratings from AI Overview/Knowledge Graph immediately
- Append organic URLs to unified candidate pool

**Skip Tier 2 (Gemini)** if ANY quality gate passes:
1. Fast path yielded >= 2 ratings with `confidence = high`
2. Top URL in pool has `identity_score >= 4` AND pool has >= 6 URLs
3. Pool contains producer OR competition URL with exact wine match (`identity_score >= 5`)

**Force Tier 2** if ANY trigger fires:
1. Pool has < 3 URLs after Tier 1
2. Wine is high-ambiguity (name < 3 tokens, missing producer, missing vintage)
3. No fast-path ratings AND wine country not in [France, Italy, USA, Australia, Spain]

**Tier 3 (domain fetch)** always runs on the unified pool, ranked by score.

---

## Budget Allocation

Per search session budget:
- Discovery: 2 SERP calls baseline (1 review-focused, 1 awards-focused)
- Gemini: 1 call max, only if quality gates fail
- Fetch: **8 URLs max** (market-aware caps)
- Documents: 2 max (PDF/DOC), only if producer or competition domains
- **Retry budget**: 1 retry total across all domains (not per-domain)

**Retry budget rationale**: Prevents blow-ups when multiple protected domains are blocked. If one retry fails, skip remaining protected domains rather than cascading retries.

---

## URL Caps and Scoring Summary

**Market-aware per-lens caps** (see Stage 4b for full table):
- Default total: 8 URLs
- South Africa: Competition-heavy (3 competition, 2 panel)
- Australia: Critic-heavy (3 panel, 2 competition)

**Two-tier scoring**:
1. **Identity score**: Validates wine match (threshold: 4)
2. **Fetch priority**: Orders fetch queue (protected domains deprioritized)

**Feature-based identity score**:
```
identity_score =
  producer_match(2) + vintage_match(2) + range_match(1) + grape_match(1) + region_match(1)
  - negative_token(10)
```

---

## Fallback Ordering

- Vivino: Web Unlocker with JS → Puppeteer → skip (no rating)
- Decanter: Web Unlocker → Puppeteer → skip
- Wine-Searcher: Web Unlocker → skip (don't waste Puppeteer)
- Producer: Direct fetch → skip (usually works or site is down)
- Generic: Direct fetch → Web Unlocker → skip

**Retry budget**: Only 1 retry total. If Vivino unlocker fails and retries with Puppeteer, no more retries for other domains in this search.

---

## Caching and Retry Policy

| Content Type | Success TTL | Blocked/Empty TTL | Notes |
|--------------|-------------|-------------------|-------|
| SERP results | 7 days | N/A | Rarely stale |
| Vivino page | 24 hours | 2 hours | High block rate |
| Decanter page | 24 hours | 4 hours | Medium block rate |
| Producer page | 7 days | 24 hours | Rarely changes |
| Generic page | 24 hours | 2 hours | Variable |
| Extraction result | 30 days | N/A | Derived data |

**Blocked detection heuristics:**
- HTTP 403/429 → blocked
- HTTP 200 but content < 1KB → blocked (empty shell)
- HTTP 200 but no expected selectors found → blocked (JS not rendered)
- Captcha keywords in response → blocked

---

## Observability

- Log per stage with a single `search_id`
- Track source success rate and block rate
- Track by wine category (country, price tier, producer size)
- Provide a per-search summary in `search_metrics` for UI and debugging
- Log identity validation failures separately for debugging

**Metrics to track:**

| Metric | Target | Current (estimated) |
|--------|--------|---------------------|
| Searches with >= 2 sources | > 70% | ~50% |
| Vivino extraction success | > 60% | ~15% |
| Producer award extraction | > 30% | < 5% |
| Zero-result searches | < 10% | ~25% |
| False positive rate | < 5% | Unknown |
| Average latency | < 10s | 15-45s |
| **Vintage mismatch rate** | < 3% | Unknown |
| **User "wrong wine" corrections** | < 1% | Unknown |

**Accuracy metrics** (new):
- `vintage_mismatch_rate`: Ratings where vintage in source != wine vintage / total ratings
- `wrong_wine_corrections`: User-initiated rating deletions flagged as "wrong wine" / total ratings

---

## Rollout Plan

### Phase 1: Execution Fixes (Week 1)
1. Fix SERP response parsing edge cases
2. Implement short TTL for blocked/empty pages
3. Add Vivino direct flow (skip Tier 1/2 cascade)
4. Add blocked detection heuristics
5. **Implement retry budget (1 total)**

### Phase 2: Identity Validation (Week 2)
1. Implement identity token generation (separate from generic overlap)
2. Add identity score calculation
3. Add producer/vintage validation to extraction
4. Add negative token rejection
5. Add confidence gate before persistence

### Phase 3: Query Optimization (Week 3)
1. Add locale-aware query building
2. Add region-specific source queries (Platters, Halliday)
3. Add producer website award queries
4. Implement query retry without operators

### Phase 4: URL Scoring (Week 4)
1. Implement two-tier scoring (identity + fetch priority)
2. Implement market-aware per-lens caps
3. Add quality gates for Tier 2 skip
4. Add URL validation before fetch

### Phase 5: Domain Flows (Week 5)
1. Stabilize Vivino `__NEXT_DATA__` extraction
2. Add Decanter JSON-LD extraction
3. Add producer website structured extraction
4. Update Wine-Searcher handling

### Phase 6: Observability (Week 6)
1. Add search_id tracking across stages
2. Add per-category success metrics
3. Add identity validation failure logging
4. **Add accuracy metrics (vintage mismatch, wrong wine corrections)**
5. Build search diagnostics UI

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Searches with >= 2 sources | ~50% | > 70% | Count distinct sources per search |
| Vivino success rate | ~15% | > 60% | Vivino URLs fetched / Vivino URLs found |
| Producer award success | < 5% | > 30% | Awards extracted / producer URLs found |
| Zero-result searches | ~25% | < 10% | Searches with 0 ratings / total searches |
| False positives | Unknown | < 5% | Manual audit of 100 random ratings |
| Average latency | 15-45s | < 10s | P50 search duration |
| Tier 1 resolution rate | ~20% | > 40% | Searches resolved by Tier 1 alone |
| **Vintage mismatch rate** | Unknown | < 3% | Ratings with wrong vintage / total |
| **Wrong wine corrections** | Unknown | < 1% | User deletions flagged "wrong wine" |

---

## Open Questions

1. **Locales**: Confirm target markets/locales for default `hl`/`gl`.
   - Proposal: US English default, with country override from wine origin.

2. **Award prioritization**: Define which awards appear first in UI.
   - Proposal: Sort by competition tier (DWWA > IWC > regional), then by medal level.

3. **Brave fallback**: Add Brave Search API if SERP fails?
   - Recommendation: Not yet - focus on fixing SERP parsing first.

4. **User corroboration opt-in**: Should users be able to include low-confidence ratings in purchase_score?
   - Recommendation: Yes, as a setting with default OFF.

5. **Historical data**: Should we backfill identity validation on existing ratings?
   - Recommendation: Yes, flag but don't delete - let user review.

6. **Market cap tuning**: How do we validate the market-aware caps are optimal?
   - Proposal: A/B test with 10% traffic, measure source coverage by market.

---

## File Impact (Planned)

| File | Changes |
|------|---------|
| `src/services/searchProviders.js` | Query builder, SERP parsing, fetch routing, blocked detection, retry budget |
| `src/services/serpAi.js` | Unified pool model, identity validation |
| `src/services/vivinoSearch.js` | Direct flow, `__NEXT_DATA__` parsing, wine name validation |
| `src/services/puppeteerScraper.js` | Fallback flows only |
| `src/services/searchMetrics.js` | Stage visibility, category tracking, accuracy metrics |
| `src/services/ratings.js` | Confidence gate, vintage match modifier |
| `src/services/wineIdentity.js` | **NEW**: Identity token generation, identity score calculation |
| `src/services/urlScoring.js` | **NEW**: Two-tier scoring, market-aware caps |
| `src/config/unifiedSources.js` | Add `blocked_detection` patterns per source |
| `src/config/marketCaps.js` | **NEW**: Market-aware per-lens caps configuration |
| `src/jobs/ratingFetchJob.js` | Unified pool model, quality gates, retry budget |
| `src/routes/ratings.js` | Pass identity tokens through pipeline |
| `docs/SEARCH_STRATEGY.md` | Update to new flow |

---

## Appendix A: Wine Categories for Metric Tracking

Track success rates by these dimensions:

**By Country**:
- France, Italy, Spain, USA, Australia, South Africa, Argentina, Chile, New Zealand, Germany, Portugal, Other

**By Price Tier** (estimated from ratings/awards):
- Budget (< $15)
- Mid-range ($15-50)
- Premium ($50-150)
- Luxury (> $150)

**By Producer Size**:
- Major (appears in > 100 SERP results)
- Medium (10-100 results)
- Boutique (< 10 results)

This segmentation reveals whether the pipeline works for all wines or just famous ones.

---

## Appendix B: Identity Score Examples

| Wine | Tokens | URL Title/Snippet | Identity Score | Valid? |
|------|--------|-------------------|----------------|--------|
| Kanonkop Paul Sauer 2019 | producer=kanonkop, vintage=2019, range=paul sauer | "Kanonkop Paul Sauer 2019 - Wine Spectator" | 2+2+1 = 5 | Yes |
| Kanonkop Paul Sauer 2019 | producer=kanonkop, vintage=2019, range=paul sauer | "Kanonkop Kadette 2020 Review" | 2+0+0 = 2 | No (wrong vintage, wrong range) |
| Chateau Margaux 2015 | producer=margaux, vintage=2015 | "Chateau Margaux du Bord 2015" | 0+2-10 = -8 | No (negative: "du Bord") |
| Penfolds Grange 2018 | producer=penfolds, vintage=2018, range=grange | "Penfolds Grange Hermitage 2018 - 98 points" | 2+2+1 = 5 | Yes |

---

## Appendix C: Function Signatures (API Contract)

These are the key function signatures the coding team should implement:

### wineIdentity.js (NEW)

```javascript
/**
 * Generate identity tokens from wine data.
 * @param {Object} wine - Wine record from database
 * @returns {{
 *   producer: string|null,      // Normalized producer name
 *   vintage: string|null,       // 4-digit year or null
 *   range: string|null,         // Cuvee/range name
 *   grape: string|null,         // Primary grape variety
 *   region: string|null,        // Region or appellation
 *   negativeTokens: string[],   // Tokens that reject a match
 *   allTokens: string[]         // All name tokens for generic overlap
 * }}
 */
export function generateIdentityTokens(wine) {}

/**
 * Calculate identity score for a URL/content against wine tokens.
 * @param {string} text - URL title, snippet, or page content
 * @param {Object} tokens - Result from generateIdentityTokens()
 * @returns {{
 *   score: number,              // 0-7 (or negative if has negative token)
 *   producer_match: boolean,
 *   vintage_match: boolean,
 *   range_match: boolean,
 *   grape_match: boolean,
 *   region_match: boolean,
 *   has_negative: boolean,
 *   matched_tokens: string[]
 * }}
 */
export function calculateIdentityScore(text, tokens) {}
```

### urlScoring.js (NEW)

```javascript
/**
 * Score and rank URLs from candidate pool.
 * @param {Array<{url: string, title: string, snippet: string, source?: string}>} urls
 * @param {Object} tokens - From generateIdentityTokens()
 * @param {string} market - Wine country/market for caps
 * @returns {Array<{
 *   url: string,
 *   identity_score: number,
 *   fetch_priority: number,
 *   lens: string,              // competition|panel|community|aggregator|producer
 *   domain: string,
 *   rejected: boolean,
 *   reject_reason?: string
 * }>}
 */
export function scoreAndRankUrls(urls, tokens, market) {}

/**
 * Apply market-aware caps to ranked URLs.
 * @param {Array} rankedUrls - From scoreAndRankUrls()
 * @param {string} market - Wine country
 * @returns {Array} - Capped list (max 8 URLs)
 */
export function applyMarketCaps(rankedUrls, market) {}
```

### searchProviders.js (MODIFY)

```javascript
/**
 * Execute search with retry budget tracking.
 * @param {Object} wine
 * @param {Object} options
 * @param {number} options.retryBudget - Remaining retries (start at 1)
 * @returns {{
 *   urls: Array,
 *   ratings: Array,           // Fast-path ratings from AI Overview
 *   retryBudgetUsed: number,  // How many retries consumed
 *   serpForReuse: Object|null
 * }}
 */
export async function discoverySearch(wine, options = {}) {}
```

### ratings.js (MODIFY)

```javascript
/**
 * Apply confidence gate before persistence.
 * @param {Array} ratings - Raw extracted ratings
 * @param {Object} wine - Wine record
 * @returns {Array<{
 *   ...rating,
 *   confidence_level: 'high'|'medium'|'low',
 *   identity_score: number,
 *   rejected: boolean,
 *   reject_reason?: string
 * }>}
 */
export function applyConfidenceGate(ratings, wine) {}
```

---

## Appendix D: Retry Budget Flow

```
Search starts with retry_budget = 1

Vivino URL found:
  -> Attempt Web Unlocker
  -> Blocked!
  -> retry_budget > 0? Yes
  -> Attempt Puppeteer (retry_budget = 0)
  -> Success! Rating extracted.

Decanter URL found:
  -> Attempt Web Unlocker
  -> Blocked!
  -> retry_budget > 0? No (already used on Vivino)
  -> Skip Decanter, no retry

Wine-Searcher URL found:
  -> Attempt Web Unlocker
  -> Blocked!
  -> retry_budget > 0? No
  -> Skip, no retry

Result: 1 rating from Vivino, 0 from Decanter/Wine-Searcher
(Without retry budget: would have attempted 3 Puppeteer fallbacks = slow + expensive)
```

---

## Appendix E: Database Schema Changes

### New columns on `wine_ratings` table

```sql
ALTER TABLE wine_ratings ADD COLUMN IF NOT EXISTS identity_score INTEGER;
ALTER TABLE wine_ratings ADD COLUMN IF NOT EXISTS producer_match BOOLEAN DEFAULT FALSE;
ALTER TABLE wine_ratings ADD COLUMN IF NOT EXISTS vintage_match BOOLEAN DEFAULT FALSE;
ALTER TABLE wine_ratings ADD COLUMN IF NOT EXISTS evidence_snippet TEXT;
ALTER TABLE wine_ratings ADD COLUMN IF NOT EXISTS extraction_method VARCHAR(20);
-- extraction_method: 'serp_snippet', 'json_ld', 'dom', 'ai', 'unlocker'

-- Index for debugging identity validation failures
CREATE INDEX IF NOT EXISTS idx_wine_ratings_identity_score ON wine_ratings(identity_score);
```

### New table: `search_metrics`

```sql
CREATE TABLE IF NOT EXISTS search_metrics (
  id SERIAL PRIMARY KEY,
  search_id UUID NOT NULL,
  wine_id INTEGER REFERENCES wines(id),
  cellar_id INTEGER REFERENCES cellars(id),

  -- Discovery metrics
  tier_resolved VARCHAR(20),        -- tier1_serp_ai, tier2_gemini, tier3_legacy
  urls_discovered INTEGER DEFAULT 0,
  urls_fetched INTEGER DEFAULT 0,
  urls_blocked INTEGER DEFAULT 0,
  retry_budget_used INTEGER DEFAULT 0,

  -- Quality metrics
  ratings_found INTEGER DEFAULT 0,
  ratings_rejected INTEGER DEFAULT 0,
  avg_identity_score DECIMAL(3,1),

  -- Latency
  discovery_ms INTEGER,
  fetch_ms INTEGER,
  total_ms INTEGER,

  -- Category (for segmented analysis)
  wine_country VARCHAR(50),
  wine_price_tier VARCHAR(20),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_search_metrics_wine ON search_metrics(wine_id);
CREATE INDEX IF NOT EXISTS idx_search_metrics_tier ON search_metrics(tier_resolved);
CREATE INDEX IF NOT EXISTS idx_search_metrics_country ON search_metrics(wine_country);
```

---

## Appendix F: Test Scenarios

The coding team should create tests for these edge cases:

### Identity Validation Tests

| Test Case | Wine | Input Text | Expected Score | Expected Result |
|-----------|------|------------|----------------|-----------------|
| Exact match | Kanonkop Paul Sauer 2019 | "Kanonkop Paul Sauer 2019 94 points" | 5 | Valid |
| Wrong vintage | Kanonkop Paul Sauer 2019 | "Kanonkop Paul Sauer 2020 95 points" | 2 | Rejected |
| Wrong wine same producer | Kanonkop Paul Sauer 2019 | "Kanonkop Kadette 2019" | 4 | Valid but different wine - **edge case** |
| Negative token | Chateau Margaux 2015 | "Chateau Margaux du Tertre 2015" | -6 | Rejected |
| No vintage in text | Penfolds Grange 2018 | "Penfolds Grange - 98 points" | 3 | Rejected (missing vintage) |
| Multiple vintages | Opus One 2019 | "Opus One 2019 vs 2018 comparison" | 4 | Valid (has 2019) |

### Retry Budget Tests

| Test Case | Scenario | Expected Behavior |
|-----------|----------|-------------------|
| Single block | Vivino blocked, Decanter ok | Retry Vivino with Puppeteer, fetch Decanter direct |
| Multiple blocks | Vivino blocked, Decanter blocked | Retry Vivino only, skip Decanter |
| First succeeds | Vivino ok, Decanter blocked | No retry used, skip Decanter fallback |
| Budget exhausted | Already used on Vivino | Skip all subsequent fallbacks |

### Market Cap Tests

| Market | Wine | Expected Lens Distribution |
|--------|------|---------------------------|
| South Africa | Kanonkop 2019 | 3 competition, 2 panel, 1 community |
| Australia | Penfolds Grange 2018 | 2 competition, 3 panel, 1 community |
| Unknown market | Random wine | 2 competition, 2 panel, 1 community |

### Confidence Gate Tests

| Scenario | Input | Expected confidence_level |
|----------|-------|--------------------------|
| 2+ sources agree | WS 94, Vinous 93 | high |
| Single credible source | Wine Spectator 94 | medium |
| Single community source | Vivino 4.2 | low |
| Aggregator without attribution | Wine-Searcher "94 avg" | low (apply 0.7x) |

---

## Appendix G: Negative Token Dictionary

These tokens should reject a URL/rating when present alongside the wine name:

### Producer Confusion Tokens

```javascript
const PRODUCER_CONFUSION = {
  'margaux': ['du tertre', 'du bord', 'palmer', 'rauzan'],
  'latour': ['tour carnet', 'tour de by', 'leoville'],
  'mouton': ['clerc milon', 'petit mouton'],
  'penfolds': ['lindemans', 'wolf blass'],  // Same corporate parent
  'opus one': ['overture', 'opus two']       // Related but different
};
```

### Generic Negative Tokens

```javascript
const GENERIC_NEGATIVES = [
  'vertical tasting',    // Multiple vintages
  'library release',     // Old vintage
  'futures',             // Not released
  'en primeur',          // Not released
  'second wine',         // Different wine
  'alternative',         // Comparison article
  'vs',                  // Comparison
  'compared to'          // Comparison
];
```

---

## Appendix H: Bright Data Configuration

### Web Unlocker Zone Settings

For Vivino/Decanter, the Web Unlocker zone needs these settings:

| Setting | Value | Reason |
|---------|-------|--------|
| `render` | `true` | Vivino is a React SPA |
| `wait_for` | `__NEXT_DATA__` | Wait for Next.js hydration |
| `timeout` | `30000` | Allow time for JS render |
| `country` | `US` | Consistent locale |

### SERP Zone Settings

| Setting | Value | Reason |
|---------|-------|--------|
| `format` | `json` | Get structured response |
| `num` | `10` | Sufficient for discovery |
| `hl` | `en` | English results |
| `gl` | Dynamic | Match wine country for local sources |

---

## Appendix I: Error Handling Matrix

| Error Type | Detection | Action | Log Level |
|------------|-----------|--------|-----------|
| SERP API timeout | `AbortError` or > 15s | Return empty, proceed to Tier 2 | WARN |
| SERP API rate limit | HTTP 429 | Circuit breaker trips, skip SERP for 1h | ERROR |
| Gemini timeout | > 45s | Return empty, proceed to Tier 3 | WARN |
| Gemini quota exceeded | `RESOURCE_EXHAUSTED` | Circuit breaker trips, skip Gemini for 24h | ERROR |
| Web Unlocker blocked | HTTP 403 or < 1KB response | Decrement retry budget, try Puppeteer | INFO |
| Puppeteer crash | Process exit or timeout | Skip URL, log for investigation | ERROR |
| Identity validation fail | `identity_score < 4` | Reject rating, log details | DEBUG |
| JSON parse failure | `SyntaxError` | Try `repairJson()`, then skip | WARN |
| Network error | `ECONNREFUSED`, `ETIMEDOUT` | Retry once, then skip | WARN |

### Circuit Breaker Thresholds

| Service | Failure Threshold | Reset Timeout | Half-Open Limit |
|---------|-------------------|---------------|-----------------|
| `serp_ai` | 3 failures | 1 hour | 1 request |
| `gemini_hybrid` | 3 failures | 1 hour | 1 request |
| `vivino_unlocker` | 5 failures | 30 minutes | 2 requests |
| `decanter_unlocker` | 5 failures | 30 minutes | 2 requests |

---

## Appendix J: Sample Log Output

For debugging and cost analysis, logs should follow this format:

```
[INFO] CostTrack {"search_id":"abc-123","wine_id":456,"tier":"tier1_serp_ai","latencyMs":3200,"urls_discovered":8,"timestamp":"2026-01-17T10:00:00Z"}
[INFO] IdentityScore {"search_id":"abc-123","url":"vivino.com/wine/123","score":5,"producer_match":true,"vintage_match":true}
[WARN] BlockedDetected {"search_id":"abc-123","url":"decanter.com/wine/456","reason":"content_too_small","bytes":512}
[INFO] RetryBudget {"search_id":"abc-123","action":"consumed","remaining":0,"domain":"vivino.com"}
[DEBUG] RatingRejected {"search_id":"abc-123","source":"wine-searcher","reason":"identity_score_below_threshold","score":2}
```
