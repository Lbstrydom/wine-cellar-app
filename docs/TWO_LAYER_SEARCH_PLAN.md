# Two-Layer Search + Layer 0 Knowledge Base Implementation Plan

## Executive Summary

This document outlines the implementation plan for improving wine search reliability, reducing API costs, and preventing resource exhaustion. The architecture follows a three-layer approach:

- **Layer 0**: Knowledge Lookup (shared memory) - "search once, remember forever"
- **Layer 1**: Discovery (high recall) - generate variations, broaden queries
- **Layer 2**: Precision Rerank (high precision) - rank by match quality including product-line qualifiers

---

## Review Feedback Integration (2026-01-14)

### Key Adjustments Based on Expert Review

| Original Plan | Reviewer Feedback | Action |
|---------------|-------------------|--------|
| Create new Layer 0 tables | Phase 6 already has `wine_search_cache` + `search_metrics` + fingerprint generation | **Evolve existing tables**, don't create parallel system |
| No HEAD-first check | Add HEAD request before GET to check Content-Length early | **Add to 1.1** - fail fast before body download |
| No search budget caps | Add per-search budget: max SERP calls, max docs, max bytes, max wall-clock time | **Add to Sprint 2** as Search Budget Governance |
| Hedged search uses flag | Use real `AbortController` for true cancellation of in-flight requests | **Update 1C implementation** |
| robots.txt 24h cache | Must follow RFC 9309 precisely: unreachable → use cached, permanently unreachable → assume disallow | **Update Phase 3** |
| RANGE_WEIGHTS hardcoded | Already in scraperConfig.js - confirmed configurable ✓ | No change needed |
| Brave fallback in Phase 4 | Move up conditionally after Sprint 2 if metrics show high zero-results rate | **Conditional promotion** |

### Critical: Don't Rebuild What Exists

Phase 6 already implemented:
- `wine_search_cache` table with TTL, hit tracking
- `search_metrics` table for cost/latency monitoring
- Fingerprint generation in search service
- Cache lookup before SERP calls

**Action**: Sprint 3 should **extend** existing tables, not create parallel `wine_identity` + `public_url_cache`. Rename migration to extend existing schema.

### Data Governance: Global vs Cellar-Private

| Data Type | Scope | Table Location | RLS |
|-----------|-------|----------------|-----|
| Canonical URLs | Global | `public_url_cache` | No RLS (shared) |
| ETags/Last-Modified | Global | `public_url_cache` | No RLS |
| Extracted facts (awards, ratings) | Global | `public_extraction_cache` | No RLS |
| Wine fingerprints | Global | `wine_search_cache` (existing) | No RLS |
| User-specific notes | Cellar-private | `wines.notes`, `user_wine_notes` | RLS by cellar_id |
| User-specific prices | Cellar-private | `wines.price`, `purchase_history` | RLS by cellar_id |
| Inventory (slots) | Cellar-private | `slots` | RLS by cellar_id |

**Note**: PostgreSQL RLS policies already exist for cellar-scoped tables. Global cache tables should be created WITHOUT RLS to allow sharing across cellars.

### Additional Improvements

1. **HEAD-First Check** (Phase 1A.1):
   ```javascript
   // Before GET, do HEAD to check Content-Length
   const headRes = await fetch(url, { method: 'HEAD' });
   const contentLength = parseInt(headRes.headers.get('Content-Length') || '0');
   if (contentLength > LIMITS.MAX_DOCUMENT_BYTES) {
     return { success: false, error: `Content-Length ${contentLength} exceeds limit` };
   }
   // Proceed with GET only if size acceptable
   ```

2. **Real AbortController** (Phase 1C):
   ```javascript
   const controller = new AbortController();
   const producerPromise = searchProducerWebsite(wineName, { signal: controller.signal });

   // If discovery returns high confidence, abort producer search
   if (calculateConfidence(discoveryResults) >= MIN_DISCOVERY_CONFIDENCE) {
     controller.abort();
   }
   ```

3. **Search Budget Governance** (Sprint 2):
   ```javascript
   const SEARCH_BUDGET = {
     MAX_SERP_CALLS: 3,           // Max SERP API calls per search
     MAX_DOCUMENT_FETCHES: 5,     // Max documents to download
     MAX_TOTAL_BYTES: 15_000_000, // 15MB total across all docs
     MAX_WALL_CLOCK_MS: 30_000    // 30s hard timeout
   };
   ```

4. **Request De-duplication** (Sprint 2):
   - Track in-flight requests by URL
   - If same URL requested twice, return same Promise
   - Prevents duplicate SERP calls for same wine variation

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Wine Search Request                      │
│                    (wine_name, vintage, metadata)                │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LAYER 0: Knowledge Lookup                    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │ wine_identity   │  │ wine_source_link │  │ url_cache      │ │
│  │ (fingerprint +  │──│ (wine → best     │──│ (etag, content,│ │
│  │  aliases)       │  │  URLs per source)│  │  extractions)  │ │
│  └─────────────────┘  └──────────────────┘  └────────────────┘ │
│                                                                  │
│  Cache HIT? → Return cached results (conditionally revalidate)   │
│  Cache MISS? → Proceed to Layer 1                                │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LAYER 1: Discovery                           │
│                     (High Recall)                                │
│                                                                  │
│  • Generate wine name variations (simplified for broader net)    │
│  • Run SERP searches (Google primary, Brave fallback)            │
│  • Hedged producer search (delayed start, cancel if not needed)  │
│  • Document fetching (PDF/DOCX with safety envelope)             │
│  • Query operator fallbacks (filetype: → plain text if 0 results)│
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LAYER 2: Precision Rerank                    │
│                     (High Precision)                             │
│                                                                  │
│  • Range qualifier matching (+8 boost / -2 penalty)              │
│  • Locale-aware ambiguity dampening                              │
│  • Source credibility weighting                                  │
│  • Vintage matching                                              │
│  • Corroboration gating (aggregators need second source)         │
│  • Feature contribution logging ("why did this rank #1?")        │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Store in Layer 0 Cache                       │
│                     (for future lookups)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1A: Safety Envelope (Must Ship First)

### 1.1 Byte Limits with HEAD-First Check + Streaming Abort

**Problem**: Currently downloads entire file before truncating - could download 100MB PDF.

**Solution** (Updated per reviewer feedback):
1. **HEAD-first check**: Send HEAD request to get Content-Length before GET
2. **Fail fast**: Reject if Content-Length > MAX_DOCUMENT_BYTES
3. **Stream with abort**: If no Content-Length header, stream with byte counter and abort mid-download if exceeded

**Implementation**:
```javascript
async function fetchDocumentSafely(url) {
  // Step 1: HEAD request to check size
  const headRes = await fetch(url, { method: 'HEAD' });
  const contentLength = parseInt(headRes.headers.get('Content-Length') || '0');

  if (contentLength > LIMITS.MAX_DOCUMENT_BYTES) {
    return {
      success: false,
      error: `Content-Length ${contentLength} exceeds ${LIMITS.MAX_DOCUMENT_BYTES} limit`,
      skipped: true
    };
  }

  // Step 2: GET with streaming abort if no Content-Length
  // ... streaming implementation
}
```

**Config** (`src/config/scraperConfig.js`):
```javascript
export const LIMITS = {
  MAX_DOCUMENT_BYTES: 5 * 1024 * 1024,      // 5MB max download size
  MAX_CONTENT_CHARS: 8000,                   // Max chars to extract
};
```

**Implementation Location**: `src/services/searchProviders.js` → `fetchDocumentContent()`

### 1.2 Global Concurrency Semaphore

**Problem**: No limit on parallel fetches - producer search + targeted searches can spike uncontrollably.

**Solution**: Global semaphore for all external HTTP requests.

**Config**:
```javascript
LIMITS.MAX_CONCURRENT_FETCHES = 5;  // Global parallel fetch limit
```

**Implementation**: Create `src/utils/fetchSemaphore.js`
```javascript
class FetchSemaphore {
  constructor(maxConcurrent) { ... }
  async acquire() { ... }
  release() { ... }
  async withSemaphore(fn) { ... }
}
export const globalFetchSemaphore = new FetchSemaphore(LIMITS.MAX_CONCURRENT_FETCHES);
```

### 1.3 DOCX Zip-Bomb Protections (OWASP ASVS)

**Problem**: DOCX is a ZIP container - malicious files could exhaust memory.

**Solution**: Cap entries, uncompressed bytes, and compression ratio.

**Config**:
```javascript
LIMITS.DOCX_MAX_ENTRIES = 100;                     // Max files inside archive
LIMITS.DOCX_MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;  // 10MB uncompressed
LIMITS.DOCX_MAX_COMPRESSION_RATIO = 100;           // Max ratio
```

**Implementation Location**: `src/services/searchProviders.js` → `fetchDocumentContent()` DOCX handling

### 1.4 Configurable Rerank Weights + Feature Logging

**Problem**: Hardcoded +8/-2 weights are technical debt.

**Solution**: Move to config, add per-result feature logging.

**Config** (`src/config/scraperConfig.js`):
```javascript
export const RERANK_WEIGHTS = {
  RANGE_QUALIFIER_MATCH: 8,
  RANGE_QUALIFIER_MISS: -2,
  OFFICIAL_PRODUCER: 1.5,
  TOP_CRITIC: 1.3,
  COMPETITION: 1.2,
  AGGREGATOR: 0.8,
  EXACT_VINTAGE_MATCH: 5,
  VINTAGE_MISSING: -1,
  FULL_NAME_MATCH: 10,
  PRODUCER_ONLY_MATCH: 3
};
```

**Logging**: Add `rankingExplanation` field to results:
```javascript
{
  url: "...",
  score: 45,
  rankingExplanation: {
    base: 20,
    rangeQualifierMatch: "+8 (vineyard selection)",
    vintageMatch: "+5 (2019)",
    sourceCredibility: "+12 (producer website × 1.5)"
  }
}
```

### 1.5 Hard-Wines Regression Test Fixture

**Location**: `tests/fixtures/hard-wines-search.json`

**Structure**:
```json
{
  "version": "1.0",
  "description": "Wine search regression test cases",
  "cases": [
    {
      "id": "range-qualifier-vineyard-selection",
      "wine": "Kleine Zalze Vineyard Selection Chenin Blanc 2019",
      "difficulty": "high",
      "challenges": ["range_qualifier", "producer_pdf_awards"],
      "expected": {
        "range_qualifier_detected": "vineyard selection",
        "min_results": 3,
        "must_find_sources": ["producer_website"],
        "known_awards": ["Concours Mondial de Bruxelles Gold"]
      }
    },
    {
      "id": "spanish-gran-reserva",
      "wine": "Marqués de Riscal Gran Reserva 2015",
      "challenges": ["aging_classification", "accented_chars"],
      "expected": {
        "range_qualifier_detected": "gran reserva",
        "locale_hint": "es"
      }
    }
    // ... more cases
  ]
}
```

---

## Phase 1B: Range Qualifier Registry (Parallel with 1A)

### Current State (Hardcoded List)
```javascript
const RANGE_QUALIFIERS = [
  'vineyard selection', 'cellar selection', ...
];
```

### Target State (Metadata Registry)

**Location**: `src/config/rangeQualifiers.js`

```javascript
export const RANGE_QUALIFIER_REGISTRY = [
  // German VDP + Prädikat
  {
    term: 'grosses gewächs',
    aliases: ['gg', 'grosse lage'],
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'spätlese',
    locales: ['de', 'at'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },

  // Spanish
  {
    term: 'gran reserva',
    locales: ['es'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  },
  {
    term: 'reserva',
    locales: ['es', 'pt'],
    ambiguity: 'medium',  // Also used loosely in other markets
    type: 'regulated_classification',
    weight_base: 0.8
  },

  // Product lines (global, higher ambiguity)
  {
    term: 'vineyard selection',
    locales: ['global'],
    ambiguity: 'medium',
    type: 'product_line',
    weight_base: 0.9
  },
  {
    term: 'reserve',
    locales: ['global'],
    ambiguity: 'high',  // Often just marketing
    type: 'marketing',
    weight_base: 0.5
  },

  // Sparkling
  {
    term: 'blanc de blancs',
    locales: ['fr', 'global'],
    ambiguity: 'low',
    type: 'regulated_classification',
    weight_base: 1.0
  }
];

// Matching utilities
export function detectQualifiers(wineName) {
  // Returns array of { qualifier, ambiguity, locale_hint, weight }
}

export function getEffectiveWeight(qualifier, localeConfidence) {
  // Full weight for low-ambiguity terms
  // Dampened weight for high-ambiguity unless locale confirmed
}
```

### Locale Confidence (Lightweight, Opportunistic)

```javascript
export function detectLocaleHints(wineName) {
  // Returns { locale: confidence } map

  // High confidence triggers:
  // - "Spätlese" → de: 0.95
  // - "Gran Reserva" → es: 0.9
  // - "Château" → fr: 0.85
  // - "Weingut" → de: 0.9
  // - "Bodega" → es: 0.85

  // Medium confidence:
  // - "Reserve" alone → unknown (could be any market)
}
```

---

## Phase 1C: Hedged Producer Search

### Current State
Producer search runs in parallel with Strategy 1 (always).

### Target State
Delayed start with **real AbortController cancellation** (updated per reviewer feedback).

**Config**:
```javascript
LIMITS.PRODUCER_SEARCH_DELAY_MS = 300;
LIMITS.MIN_DISCOVERY_CONFIDENCE = 0.7;
```

**Implementation** (Updated with AbortController):
```javascript
async function searchWineWithHedging(wineName, vintage, options) {
  // Create AbortController for producer search cancellation
  const producerController = new AbortController();

  // Start main discovery immediately
  const discoveryPromise = runDiscoverySearch(wineName, vintage);

  // Schedule producer search after delay with abort signal
  const producerPromise = (async () => {
    await sleep(LIMITS.PRODUCER_SEARCH_DELAY_MS);

    // Check if already aborted before starting
    if (producerController.signal.aborted) {
      return { cancelled: true, results: [] };
    }

    try {
      return await searchProducerWebsite(wineName, {
        signal: producerController.signal
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        return { cancelled: true, results: [] };
      }
      throw err;
    }
  })();

  // Race: if discovery returns high confidence before delay, abort producer
  const discoveryResults = await discoveryPromise;
  if (calculateConfidence(discoveryResults) >= LIMITS.MIN_DISCOVERY_CONFIDENCE) {
    producerController.abort();  // True cancellation of in-flight request
  }

  const producerResults = await producerPromise;
  return mergeResults(discoveryResults, producerResults);
}
```

### "Hard Wine" Immediate Trigger (Optional Heuristic)

Skip delay and start producer search immediately if:
- Name contains low-ambiguity qualifier (Spätlese, GG, 1er Cru)
- Name token count >= 7
- Vintage missing or "NV"
- Contains producer-type tokens (domaine, weingut, château, bodega, tenuta)

---

## Phase 1D: TasteAtlas Corroboration Gate

### Current Config
```javascript
taste_atlas: {
  credibility: 0.75,
  is_aggregator: true
}
```

### Target Config
```javascript
taste_atlas: {
  credibility: 0.75,
  is_aggregator: true,
  requires_corroboration: true,
  claim_types: ['award_mention', 'rating_mention'],
  corroboration_sources: [
    'producer_website',
    'official_competition',
    'top_critic'
  ]
}
```

### UI/Aggregation Rule
TasteAtlas claims don't count toward medals/awards unless corroborated by:
1. Producer site page or producer PDF, OR
2. Official competition results page/PDF, OR
3. Top-trust critic/guide source

---

## Phase 2: Layer 0 Shared Memory

### Database Schema

**Migration**: `data/migrations/XXX_layer0_knowledge_base.sql`

```sql
-- Wine identity with canonical fingerprint
CREATE TABLE IF NOT EXISTS wine_identity (
  id BIGSERIAL PRIMARY KEY,

  -- Canonical fingerprint (exact, deterministic)
  primary_fingerprint TEXT NOT NULL UNIQUE,

  -- Weak fingerprint for fuzzy linking
  weak_fingerprint TEXT,

  -- Parsed components
  producer_slug TEXT NOT NULL,
  cuvee_slug TEXT,
  vintage TEXT,  -- Year or 'NV'
  qualifier_slugs TEXT[],  -- Array of detected qualifiers

  -- Original input that created this identity
  original_name TEXT NOT NULL,

  -- Metadata
  locale_hints JSONB,  -- { "de": 0.9, "fr": 0.3 }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wine_identity_weak_fp ON wine_identity (weak_fingerprint);
CREATE INDEX idx_wine_identity_producer ON wine_identity (producer_slug);

-- Alias mappings for fuzzy matching
CREATE TABLE IF NOT EXISTS wine_aliases (
  id BIGSERIAL PRIMARY KEY,
  wine_identity_id BIGINT REFERENCES wine_identity(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL,  -- 'producer', 'cuvee', 'full_name', 'misspelling'
  alias_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (alias_type, alias_value)
);

CREATE INDEX idx_wine_aliases_value ON wine_aliases (alias_value);

-- Known best URLs per source
CREATE TABLE IF NOT EXISTS wine_source_link (
  id BIGSERIAL PRIMARY KEY,
  wine_identity_id BIGINT REFERENCES wine_identity(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,  -- 'vivino', 'decanter', 'producer_website'
  canonical_url TEXT NOT NULL,
  quality_score DECIMAL(3,2),  -- How good is this URL for this wine?
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (wine_identity_id, source_key)
);

-- URL cache with conditional revalidation support
CREATE TABLE IF NOT EXISTS public_url_cache (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,

  -- HTTP caching headers
  etag TEXT,
  last_modified TEXT,

  -- Content metadata
  content_type TEXT,
  byte_size INTEGER,

  -- Fetch tracking
  fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  fetch_count INTEGER DEFAULT 1,

  -- Status
  status TEXT DEFAULT 'valid'  -- 'valid', 'stale', 'error', 'gone'
);

CREATE INDEX idx_url_cache_expires ON public_url_cache (expires_at) WHERE status = 'valid';

-- Extracted facts from URLs
CREATE TABLE IF NOT EXISTS public_extraction_cache (
  id BIGSERIAL PRIMARY KEY,
  url_cache_id BIGINT REFERENCES public_url_cache(id) ON DELETE CASCADE,

  -- Extraction metadata
  extraction_method TEXT,  -- 'html_parse', 'pdf_extract', 'docx_extract'
  extracted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Extracted content
  extracted_facts JSONB,  -- { awards: [...], ratings: [...], etc. }
  confidence DECIMAL(3,2),
  evidence_snippet TEXT,  -- Short excerpt proving the fact

  -- For debugging/auditing
  raw_content_hash TEXT
);
```

### Fingerprinting Algorithm

```javascript
/**
 * Generate canonical wine fingerprint.
 *
 * Format: producer_slug|cuvee_slug|vintage|qualifier_set
 *
 * Normalization:
 * - lowercase
 * - ASCII fold (ü → u, é → e)
 * - remove punctuation
 * - collapse whitespace
 * - sort qualifiers alphabetically
 */
export function generateFingerprint(wineName, vintage) {
  const normalized = normalizeWineName(wineName);
  const { producer, cuvee, qualifiers } = parseWineComponents(normalized);

  const producerSlug = slugify(producer);
  const cuveeSlug = cuvee ? slugify(cuvee) : '';
  const vintageStr = vintage || 'NV';
  const qualifierSet = qualifiers.sort().join('+');

  return `${producerSlug}|${cuveeSlug}|${vintageStr}|${qualifierSet}`;
}

/**
 * Generate weak fingerprint for fuzzy linking.
 * Less specific - helps connect variations.
 */
export function generateWeakFingerprint(wineName, vintage) {
  const normalized = normalizeWineName(wineName);
  const { producer, cuveeOrGrape } = parseWineComponentsLoose(normalized);

  return `${slugify(producer)}|${slugify(cuveeOrGrape)}|${vintage || 'NV'}`;
}
```

### Knowledge Lookup Flow

```javascript
async function lookupWineKnowledge(wineName, vintage) {
  const primaryFp = generateFingerprint(wineName, vintage);

  // 1. Try exact match
  let identity = await db.prepare(`
    SELECT * FROM wine_identity WHERE primary_fingerprint = $1
  `).get(primaryFp);

  if (identity) {
    // Check if we have cached URLs
    const sources = await db.prepare(`
      SELECT wsl.*, puc.etag, puc.last_modified, puc.fetched_at
      FROM wine_source_link wsl
      JOIN public_url_cache puc ON puc.url = wsl.canonical_url
      WHERE wsl.wine_identity_id = $1
    `).all(identity.id);

    if (sources.length > 0) {
      // Conditionally revalidate stale entries
      return await revalidateAndReturn(identity, sources);
    }
  }

  // 2. Try alias lookup
  const alias = await db.prepare(`
    SELECT wi.* FROM wine_identity wi
    JOIN wine_aliases wa ON wa.wine_identity_id = wi.id
    WHERE wa.alias_value = $1
  `).get(normalizeForAlias(wineName));

  if (alias) {
    return await revalidateAndReturn(alias, await getSourcesForIdentity(alias.id));
  }

  // 3. Try weak fingerprint match
  const weakFp = generateWeakFingerprint(wineName, vintage);
  const candidates = await db.prepare(`
    SELECT * FROM wine_identity WHERE weak_fingerprint = $1
  `).all(weakFp);

  if (candidates.length === 1) {
    // Single match - likely correct
    return await revalidateAndReturn(candidates[0], await getSourcesForIdentity(candidates[0].id));
  }

  // 4. No match - proceed to Layer 1 search
  return null;
}
```

### Conditional Revalidation (ETag/Last-Modified)

```javascript
async function conditionalFetch(url, cachedEntry) {
  const headers = {};

  // Prefer ETag over Last-Modified (more accurate)
  if (cachedEntry.etag) {
    headers['If-None-Match'] = cachedEntry.etag;
  } else if (cachedEntry.last_modified) {
    headers['If-Modified-Since'] = cachedEntry.last_modified;
  }

  const response = await fetch(url, { headers });

  if (response.status === 304) {
    // Not modified - return cached content
    return { unchanged: true, cached: cachedEntry };
  }

  // Content changed - re-extract
  return { unchanged: false, response };
}
```

---

## Phase 3: Producer Micro-Crawler (Future)

### Scope
- Only after domain is verified as a legitimate producer
- Limited to allowlisted paths: `/wines`, `/range`, `/downloads`, `/awards`, `/press`
- Respects robots.txt per RFC 9309
- Scheduled weekly/monthly refresh with conditional requests

### robots.txt Handling (RFC 9309 Compliant)

Per reviewer feedback, must follow RFC 9309 precisely:

```javascript
const ROBOTS_TXT_CACHE_TTL = 24 * 60 * 60 * 1000;  // 24 hours max

async function getRobotsTxt(domain) {
  const cached = robotsTxtCache.get(domain);

  // If cached and not expired, use it
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TXT_CACHE_TTL) {
    return cached.rules;
  }

  try {
    const response = await fetch(`https://${domain}/robots.txt`, {
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const rules = parseRobotsTxt(await response.text());
      robotsTxtCache.set(domain, { rules, fetchedAt: Date.now(), status: 'valid' });
      return rules;
    }

    // 4xx errors: assume no restrictions (RFC 9309 §2.3)
    if (response.status >= 400 && response.status < 500) {
      robotsTxtCache.set(domain, { rules: ALLOW_ALL, fetchedAt: Date.now(), status: 'not_found' });
      return ALLOW_ALL;
    }

    // 5xx errors: temporarily unavailable, use cached if available
    throw new Error(`Server error: ${response.status}`);

  } catch (err) {
    // Network error or timeout: unreachable
    if (cached) {
      // Use stale cache but flag for retry (RFC 9309 §2.4)
      cached.status = 'stale_using_cached';
      return cached.rules;
    }

    // No cache and unreachable: assume DISALLOW ALL (conservative, RFC 9309 §2.4)
    return DISALLOW_ALL;
  }
}
```

Key RFC 9309 rules:
- **2xx**: Parse and cache rules
- **4xx (not found)**: Treat as "no restrictions" (ALLOW_ALL)
- **5xx (server error)**: Temporarily unavailable, use cached if available
- **Unreachable + no cache**: Assume DISALLOW ALL (conservative)
- **Crawl-delay**: Honor if present, otherwise use respectful default (1s)

---

## Phase 4: Search Fallback Provider (Future)

### Primary: Google SERP
- via Bright Data SERP API

### Fallback: Brave Search API
- Trigger only when Google fails or returns low confidence
- Independent index, explicit API with clear limits

### Query Operator Fallbacks
```javascript
// If filetype: returns 0 results, fall back
const queries = [
  `site:${domain} filetype:pdf awards`,           // Try first
  `site:${domain} (pdf OR awards OR concours)`,   // Fallback
  `"${producer}" awards medals`                    // Last resort
];
```

---

## Implementation Sequence

### Progress (2026-01-14)
- Search budget governance implemented: per-search caps on SERP calls, document fetches, total bytes, wall-clock, tracked in searchProviders.
- Request de-duplication added for SERP calls to share in-flight requests per key.

### Sprint 1 (Phase 1A): Safety Envelope
- [x] Add LIMITS config to scraperConfig.js ✓ (already done)
- [x] Add HEAD-first check before GET (fail fast on Content-Length)
- [x] Implement streaming byte abort in fetchDocumentContent()
- [x] Create fetchSemaphore.js with global semaphore
- [x] Add DOCX zip-bomb protections
- [x] Make rerank weights configurable ✓ (already in scraperConfig.js)
- [x] Add feature contribution logging
- [x] Create hard-wines regression fixture

### Sprint 2 (Phase 1B-D): Search Improvements + Budget Governance
- [x] Convert RANGE_QUALIFIERS to metadata registry (`src/config/rangeQualifiers.js`)
- [x] Implement locale hint detection (`detectLocaleHints()` function)
- [x] Implement hedged producer search with real AbortController
- [x] Add corroboration gate for TasteAtlas
- [x] Add query operator fallbacks
- [x] **NEW**: Add search budget governance (max SERP calls, docs, bytes, wall-clock)
- [x] **NEW**: Add request de-duplication (track in-flight by URL, return same Promise)
- [ ] **CONDITIONAL**: Add Brave fallback (see metrics criteria below)

### Sprint 3 (Phase 2): Layer 0 Knowledge Base (Extend Existing) ✅ COMPLETE
- [x] **REVISED**: Extend existing `wine_search_cache` table (don't create parallel system)
  - Migration 039: Added `cache_scope` column, dropped NOT NULL on `cellar_id`, added unique index for global entries
- [x] Add `public_url_cache` table (global, no RLS)
  - Migration 039: Created with ETag, Last-Modified, expires_at, status columns
- [x] Add `public_extraction_cache` table (global, no RLS)
  - Migration 039: Created with FK to url_cache, unique constraint on (url_cache_id, raw_content_hash)
- [x] Implement fingerprinting algorithm (verify against existing Phase 6 implementation)
  - `wineFingerprint.js`: v1 algorithm with normalization, alias support, version tracking
  - Verified compatible with Phase 6 `wineAddOrchestrator.js` integration
- [x] Implement conditional revalidation (ETag precedence over Last-Modified)
  - `searchProviders.js:71-73`: `buildConditionalHeaders()` checks ETag first
  - `searchProviders.js:1310-1338, 1773-1800`: HTTP 304 handling with TTL refresh
- [x] Wire into search orchestration
  - `wineAddOrchestrator.js`: Full integration with Layer 0 lookup before discovery
  - `cacheService.js`: CRUD operations for public_url_cache and public_extraction_cache

### Sprint 4 (Phase 3): Producer Micro-Crawler ✅ COMPLETE
- [x] Producer micro-crawler with path whitelisting
  - `producerCrawler.js`: Crawls verified domains on `/wines`, `/range`, `/downloads`, `/awards`, `/press`, `/accolades`, `/medals`, `/tasting-notes`
  - Global fetch semaphore integration (max 5 concurrent)
  - ETag/If-None-Match conditional revalidation support
  - Content extraction (awards, ratings, wine names)
- [x] robots.txt governance (RFC 9309 compliant)
  - `robotsParser.js`: Full RFC 9309 implementation
  - 4xx → ALLOW_ALL, 5xx → use stale cache or DISALLOW_ALL
  - Network error → use stale cache or DISALLOW_ALL (conservative)
  - 24-hour hard cache TTL, max 5 redirects
  - crawl-delay directive support
- [x] Producer domain discovery service
  - `producerDiscovery.js`: Auto-register domains found during search
  - Auto-verification heuristics (domain-to-producer matching)
  - Status tracking (pending/verified/rejected/unreachable)
- [x] Database migration 040
  - `producer_domains` table (verified producer websites)
  - `robots_txt_cache` table (RFC 9309 compliant cache)
  - `producer_crawl_queue` table (URLs pending crawl)
- [x] Configuration in `scraperConfig.js`
  - `PRODUCER_CRAWL` config section with feature flags and limits
- [x] Unit tests for robots.txt parsing

### Sprint 5+ (Phase 4): Future
- [ ] Brave Search fallback (if not promoted in Sprint 2)

---

## Brave Fallback Promotion Criteria

The Brave Search API fallback is **conditional** - it will only be promoted from Phase 4 to Sprint 2 if metrics indicate Google SERP is insufficient.

### Metrics Required for Decision

Query the `search_metrics` table to calculate:

```sql
-- Zero-results rate over last 30 days
SELECT
  COUNT(*) FILTER (WHERE stop_reason = 'no_results') AS zero_result_searches,
  COUNT(*) AS total_searches,
  ROUND(100.0 * COUNT(*) FILTER (WHERE stop_reason = 'no_results') / NULLIF(COUNT(*), 0), 2) AS zero_result_rate
FROM search_metrics
WHERE created_at > NOW() - INTERVAL '30 days';

-- Breakdown by wine characteristics (to identify patterns)
SELECT
  CASE
    WHEN fingerprint LIKE '%spatlese%' OR fingerprint LIKE '%auslese%' THEN 'german_pradikat'
    WHEN fingerprint LIKE '%gran+reserva%' OR fingerprint LIKE '%crianza%' THEN 'spanish_classification'
    WHEN fingerprint LIKE '%premier+cru%' OR fingerprint LIKE '%grand+cru%' THEN 'french_classification'
    ELSE 'standard'
  END AS wine_category,
  COUNT(*) FILTER (WHERE stop_reason = 'no_results') AS zero_results,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE stop_reason = 'no_results') / NULLIF(COUNT(*), 0), 2) AS rate
FROM search_metrics
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY rate DESC;
```

### Promotion Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| Overall zero-results rate | > 10% | Promote Brave fallback |
| Category-specific zero-results | > 20% for any category | Consider category-specific fallback |
| Average latency with retries | > 8s P95 | Promote for latency reasons |
| SERP API error rate | > 5% | Promote for reliability |

### What "Promote" Means

1. Add Brave Search API key to environment variables
2. Implement fallback logic in `searchProviders.js`:
   ```javascript
   // After Google SERP returns zero/low-confidence results
   if (results.length === 0 || calculateConfidence(results) < 0.3) {
     const braveResults = await searchBraveAPI(query);
     results = mergeResults(results, braveResults);
   }
   ```
3. Track Brave API usage in `search_metrics` with `provider: 'brave'`
4. Monitor cost impact (Brave has different pricing)

### Current Status

**Not yet collecting sufficient data.** The `search_metrics` table is in place but needs:
- 30+ days of production search data
- At least 100 unique wine searches
- Representative mix of wine categories

**To check current data volume:**
```sql
SELECT
  COUNT(*) as total_searches,
  MIN(created_at) as first_search,
  MAX(created_at) as last_search,
  COUNT(DISTINCT fingerprint) as unique_wines
FROM search_metrics;
```

Once sufficient data is collected, run the metrics queries above and update this section with findings.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/config/scraperConfig.js` | LIMITS, RERANK_WEIGHTS, SEARCH_BUDGET config |
| `src/config/rangeQualifiers.js` | NEW: Qualifier metadata registry |
| `src/services/searchProviders.js` | Main search orchestration |
| `src/config/unifiedSources.js` | Source definitions (TasteAtlas, etc.) |
| `src/utils/fetchSemaphore.js` | NEW: Global concurrency control |
| `src/utils/requestDedup.js` | NEW: In-flight request de-duplication |
| `tests/fixtures/hard-wines-search.json` | NEW: Regression test cases |
| `data/migrations/XXX_extend_search_cache.sql` | REVISED: Extend existing cache tables |
| **Existing Phase 6 files** | |
| `wine_search_cache` table | Existing fingerprint + cache (don't rebuild) |
| `search_metrics` table | Existing cost/latency tracking |

---

## Testing Strategy

### Test Categories

| Category | Type | Runs In | Purpose |
|----------|------|---------|---------|
| Unit Tests | Fast, isolated | CI (always) | Test individual functions |
| Integration Tests | With mocked SERP | CI (always) | Test orchestration logic |
| Regression Tests | With fixture data | CI (always) | Prevent ranking regressions |
| Live Tests | Real SERP calls | Manual/scheduled | Validate against real data |

### Unit Tests

**Location**: `tests/unit/services/searchProviders.test.js`

```javascript
describe('Range Qualifier Detection', () => {
  it('detects German Prädikat classifications', () => {
    const result = detectQualifiers('Weingut Müller Spätlese 2020');
    expect(result).toContainEqual({
      qualifier: 'spätlese',
      ambiguity: 'low',
      locale_hint: 'de',
      weight: 1.0
    });
  });

  it('dampens ambiguous qualifiers without locale context', () => {
    const result = detectQualifiers('Napa Valley Reserve 2019');
    expect(result).toContainEqual({
      qualifier: 'reserve',
      ambiguity: 'high',
      locale_hint: null,
      weight: 0.5  // Dampened due to ambiguity
    });
  });

  it('preserves range qualifiers in variations', () => {
    const variations = generateWineNameVariations('Kleine Zalze Vineyard Selection Chenin Blanc 2019');
    // Original should always be first
    expect(variations[0]).toBe('Kleine Zalze Vineyard Selection Chenin Blanc 2019');
    // Simplified variations should exist but qualifier preserved in scoring
  });
});

describe('Fingerprinting', () => {
  it('generates deterministic fingerprints', () => {
    const fp1 = generateFingerprint('Kleine Zalze Vineyard Selection Chenin Blanc', 2019);
    const fp2 = generateFingerprint('kleine zalze vineyard selection chenin blanc', 2019);
    expect(fp1).toBe(fp2);  // Case-insensitive
  });

  it('handles accented characters', () => {
    const fp1 = generateFingerprint('Château Margaux', 2015);
    const fp2 = generateFingerprint('Chateau Margaux', 2015);
    expect(fp1).toBe(fp2);  // ASCII folded
  });

  it('sorts qualifiers alphabetically', () => {
    const fp = generateFingerprint('Producer Gran Reserva Special Selection', 2018);
    expect(fp).toContain('gran+reserva|special+selection');  // Sorted
  });
});

describe('Safety Envelope', () => {
  it('rejects Content-Length exceeding limit', async () => {
    const mockResponse = {
      headers: { get: () => '10000000' },  // 10MB
      ok: true
    };
    const result = await fetchDocumentContent('http://example.com/big.pdf');
    expect(result.success).toBe(false);
    expect(result.error).toContain('too large');
  });

  it('enforces DOCX entry limit', async () => {
    // Mock DOCX with 200 entries
    const result = await extractDocxContent(mockZipBombDocx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('too many entries');
  });
});

describe('Rerank Scoring', () => {
  it('applies configurable weights', () => {
    const result = {
      title: 'Kleine Zalze Vineyard Selection Chenin Blanc 2019 - Awards',
      url: 'https://kleinezalze.co.za/awards'
    };
    const score = calculateResultRelevance(
      result,
      'Kleine Zalze Vineyard Selection Chenin Blanc 2019',
      { source: 'producer_website' }
    );

    expect(score.rankingExplanation.rangeQualifierMatch).toBe('+8 (vineyard selection)');
    expect(score.rankingExplanation.sourceCredibility).toContain('producer website');
  });
});
```

**Location**: `tests/unit/utils/fetchSemaphore.test.js`

```javascript
describe('FetchSemaphore', () => {
  it('limits concurrent operations', async () => {
    const semaphore = new FetchSemaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array(5).fill(null).map(() =>
      semaphore.withSemaphore(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(50);
        concurrent--;
      })
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBe(2);  // Never exceeded limit
  });
});
```

### Hard-Wines Regression Tests

**Fixture Location**: `tests/fixtures/hard-wines-search.json`

**Test Location**: `tests/unit/services/hardWinesRegression.test.js`

```javascript
import hardWines from '../../fixtures/hard-wines-search.json';

describe('Hard Wines Regression', () => {
  // These tests use mocked SERP responses to ensure consistent behavior

  hardWines.cases.forEach(testCase => {
    describe(`${testCase.id}: ${testCase.wine}`, () => {

      it('detects expected range qualifier', () => {
        const qualifiers = detectQualifiers(testCase.wine);
        if (testCase.expected.range_qualifier_detected) {
          const detected = qualifiers.map(q => q.qualifier);
          expect(detected).toContain(testCase.expected.range_qualifier_detected);
        }
      });

      it('generates correct locale hints', () => {
        if (testCase.expected.locale_hint) {
          const hints = detectLocaleHints(testCase.wine);
          expect(hints[testCase.expected.locale_hint]).toBeGreaterThan(0.5);
        }
      });

      it('ranks expected sources in top-3', async () => {
        // Uses mocked SERP responses from fixture
        const mockResults = testCase.mock_serp_results;
        const ranked = await rankResults(mockResults, testCase.wine);

        if (testCase.expected.must_find_sources) {
          const top3Sources = ranked.slice(0, 3).map(r => r.source_type);
          for (const expectedSource of testCase.expected.must_find_sources) {
            expect(top3Sources).toContain(expectedSource);
          }
        }
      });

      it('returns minimum expected results', async () => {
        if (testCase.expected.min_results) {
          const mockResults = testCase.mock_serp_results;
          const ranked = await rankResults(mockResults, testCase.wine);
          expect(ranked.length).toBeGreaterThanOrEqual(testCase.expected.min_results);
        }
      });
    });
  });
});
```

### Hard-Wines Fixture Structure

**Location**: `tests/fixtures/hard-wines-search.json`

```json
{
  "version": "1.0",
  "description": "Wine search regression test cases - difficult searches that have failed in the past",
  "updated": "2026-01-14",
  "cases": [
    {
      "id": "range-qualifier-vineyard-selection",
      "wine": "Kleine Zalze Vineyard Selection Chenin Blanc 2019",
      "vintage": 2019,
      "difficulty": "high",
      "challenges": ["range_qualifier", "producer_pdf_awards", "south_african"],
      "notes": "Original failure case - producer has awards in .doc file on website",
      "expected": {
        "range_qualifier_detected": "vineyard selection",
        "min_results": 3,
        "must_find_sources": ["producer_website"],
        "known_awards": ["Concours Mondial de Bruxelles Gold"],
        "fingerprint": "kleinezalze|vineyardselection+cheninblanc|2019|vineyard+selection"
      },
      "mock_serp_results": [
        {
          "title": "Kleine Zalze Vineyard Selection Chenin Blanc 2019",
          "url": "https://www.kleinezalze.co.za/wines/vineyard-selection/chenin-blanc",
          "snippet": "Gold medal Concours Mondial de Bruxelles..."
        },
        {
          "title": "Kleine Zalze Awards PDF",
          "url": "https://www.kleinezalze.co.za/downloads/awards.pdf",
          "snippet": "Complete list of awards and accolades..."
        }
      ]
    },
    {
      "id": "spanish-gran-reserva",
      "wine": "Marqués de Riscal Gran Reserva 2015",
      "vintage": 2015,
      "difficulty": "medium",
      "challenges": ["aging_classification", "accented_chars", "spanish"],
      "expected": {
        "range_qualifier_detected": "gran reserva",
        "locale_hint": "es",
        "fingerprint": "marquesderiscal||2015|gran+reserva"
      },
      "mock_serp_results": []
    },
    {
      "id": "german-pradikat-spatlese",
      "wine": "Dr. Loosen Wehlener Sonnenuhr Spätlese 2020",
      "vintage": 2020,
      "difficulty": "high",
      "challenges": ["german_classification", "special_chars", "vineyard_name"],
      "expected": {
        "range_qualifier_detected": "spätlese",
        "locale_hint": "de",
        "min_results": 2
      },
      "mock_serp_results": []
    },
    {
      "id": "french-premier-cru",
      "wine": "Domaine Leflaive Puligny-Montrachet 1er Cru Les Pucelles 2018",
      "vintage": 2018,
      "difficulty": "high",
      "challenges": ["french_classification", "vineyard_name", "long_name"],
      "expected": {
        "range_qualifier_detected": "premier cru",
        "locale_hint": "fr"
      },
      "mock_serp_results": []
    },
    {
      "id": "nv-champagne",
      "wine": "Krug Grande Cuvée NV",
      "vintage": null,
      "difficulty": "medium",
      "challenges": ["no_vintage", "luxury_champagne"],
      "expected": {
        "range_qualifier_detected": "grande cuvée",
        "fingerprint_contains": "|NV|"
      },
      "mock_serp_results": []
    },
    {
      "id": "ambiguous-reserve",
      "wine": "Robert Mondavi Reserve Cabernet Sauvignon 2018",
      "vintage": 2018,
      "difficulty": "low",
      "challenges": ["ambiguous_qualifier", "us_market"],
      "notes": "Reserve is marketing in US market - should be dampened",
      "expected": {
        "range_qualifier_detected": "reserve",
        "qualifier_weight_dampened": true
      },
      "mock_serp_results": []
    },
    {
      "id": "italian-riserva",
      "wine": "Biondi-Santi Brunello di Montalcino Riserva 2015",
      "vintage": 2015,
      "difficulty": "medium",
      "challenges": ["italian_classification", "premium_wine"],
      "expected": {
        "range_qualifier_detected": "riserva",
        "locale_hint": "it"
      },
      "mock_serp_results": []
    },
    {
      "id": "producer-name-collision",
      "wine": "Selection Massale Pinot Noir 2019",
      "vintage": 2019,
      "difficulty": "high",
      "challenges": ["selection_in_producer_name", "false_positive_risk"],
      "notes": "Selection is part of producer name, not a range qualifier",
      "expected": {
        "range_qualifier_detected": null,
        "no_false_positive": true
      },
      "mock_serp_results": []
    }
  ]
}
```

### Integration Tests

**Location**: `tests/integration/searchOrchestration.test.js`

```javascript
describe('Search Orchestration Integration', () => {
  describe('Layer 0 Knowledge Lookup', () => {
    it('returns cached results for known wines', async () => {
      // Seed test data
      await seedWineIdentity('kleinezalze|cheninblanc|2019|vineyard+selection');

      const result = await lookupWineKnowledge('Kleine Zalze Vineyard Selection Chenin Blanc', 2019);
      expect(result).not.toBeNull();
      expect(result.cached).toBe(true);
    });

    it('falls through to Layer 1 for unknown wines', async () => {
      const result = await lookupWineKnowledge('Totally Unknown Wine', 2020);
      expect(result).toBeNull();
    });
  });

  describe('Hedged Producer Search', () => {
    it('cancels producer search when discovery is confident', async () => {
      // Mock high-confidence discovery results
      const searchSpy = vi.spyOn(searchModule, 'searchProducerWebsite');

      await searchWineWithHedging('Well Known Wine 2020', { mockHighConfidence: true });

      // Producer search should have been cancelled
      expect(searchSpy).toHaveBeenCalled();
      // But results should not include producer search (cancelled)
    });

    it('includes producer search for hard wines', async () => {
      const result = await searchWineWithHedging('Obscure Spätlese 2020', {});
      // Should have triggered immediate producer search due to low-ambiguity qualifier
    });
  });

  describe('Corroboration Gate', () => {
    it('flags TasteAtlas awards as requiring corroboration', async () => {
      const result = await processSearchResult({
        source: 'taste_atlas',
        claims: [{ type: 'award', value: 'Gold Medal' }]
      });

      expect(result.claims[0].requires_corroboration).toBe(true);
      expect(result.claims[0].corroborated).toBe(false);
    });

    it('marks claims as corroborated when second source confirms', async () => {
      const results = [
        { source: 'taste_atlas', claims: [{ type: 'award', value: 'Concours Mondial Gold' }] },
        { source: 'producer_website', claims: [{ type: 'award', value: 'Concours Mondial Gold' }] }
      ];

      const processed = await processAndCorroborate(results);
      expect(processed.awards[0].corroborated).toBe(true);
    });
  });
});
```

### Live Tests (Manual/Scheduled)

**Location**: `tests/live/searchLive.test.js`

```javascript
/**
 * Live tests that make real SERP API calls.
 * Run manually or on schedule, not in CI.
 *
 * Usage: LIVE_TESTS=1 npm run test:live
 */

describe.skipIf(!process.env.LIVE_TESTS)('Live Search Tests', () => {
  it('finds Kleine Zalze Vineyard Selection via real search', async () => {
    const result = await searchWine('Kleine Zalze Vineyard Selection Chenin Blanc 2019');

    expect(result.results.length).toBeGreaterThan(0);
    // Log for manual review
    console.log('Live results:', result.results.map(r => ({
      title: r.title,
      url: r.url,
      score: r.score,
      explanation: r.rankingExplanation
    })));
  }, 60000);  // 60s timeout for real API calls
});
```

### Test Commands

Add to `package.json`:

```json
{
  "scripts": {
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:regression": "vitest run tests/unit/services/hardWinesRegression.test.js",
    "test:live": "LIVE_TESTS=1 vitest run tests/live",
    "test:search": "vitest run tests/unit/services/searchProviders.test.js tests/unit/services/hardWinesRegression.test.js"
  }
}
```

### CI Pipeline Integration

Add to `.github/workflows/test.yml` (if using GitHub Actions):

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:regression  # Always run hard-wines regression
      - run: npm run test:integration
```

### Test Coverage Requirements

| Area | Minimum Coverage | Critical Paths |
|------|------------------|----------------|
| Range Qualifier Detection | 90% | All qualifiers in registry |
| Fingerprinting | 95% | Normalization, edge cases |
| Safety Envelope | 100% | Byte limits, zip protection |
| Rerank Scoring | 85% | Weight application, explanation |
| Hard Wines Fixture | 100% pass | All cases must pass |

---

## Success Metrics

1. **Safety**: No document downloads > 5MB, no concurrent fetch spikes > 5
2. **Cost**: Layer 0 cache hit rate > 60% after 30 days
3. **Quality**: Hard-wines fixture passes 100% (top-3 accuracy)
4. **Latency**: P95 search latency < 5s (with hedged producer search)
