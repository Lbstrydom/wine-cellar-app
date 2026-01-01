# Wine Cellar App - Commercial Release Roadmap

> **Goal**: Transform from personal use to Google Play Store release with 1000+ bottle collection support

---

## Progress Tracking

### Phase 1 Status: ✅ Complete (80% - 1.2 deferred)

| Item | Status | Notes |
|------|--------|-------|
| 1.1 Unit Test Framework | ✅ Complete | Vitest configured, 249 tests passing, ~85% service coverage |
| 1.2 DB Abstraction | ⏸️ Deferred | P3 - defer until cloud migration needed |
| 1.3 Unify Configs | ✅ Complete | `src/config/unifiedSources.js` (900+ lines), 50+ sources consolidated |
| 1.4 Data Provenance | ✅ Complete | `src/services/provenance.js` + migration 013 |
| 1.5 Scraping Governance | ✅ Complete | Rate limiter, circuit breaker, governance wrapper |

### Phase 2 Status: 🟢 In Progress

| Item | Status | Notes |
|------|--------|-------|
| 2.1 FTS5 Full-Text Search | ✅ Complete | Migration 014, search routes with BM25 ranking, LIKE fallback |
| 2.2 Virtual List Rendering | ⏳ Pending | |
| 2.3 Refactor bottles.js | ⏳ Pending | |

**Files Created (Phase 1)**:
- `src/config/unifiedSources.js` - Single source of truth for all rating sources
- `src/services/provenance.js` - Data provenance tracking service
- `src/services/rateLimiter.js` - Per-source rate limiting with lens-based defaults
- `src/services/circuitBreaker.js` - Circuit breaker pattern for failure protection
- `src/services/scrapingGovernance.js` - Unified governance wrapper
- `data/migrations/013_data_provenance.sql` - Provenance table schema
- `tests/unit/**/*.test.js` - 249 unit tests covering services and config

**Files Created/Updated (Phase 2)**:
- `data/migrations/014_fts5_search.sql` - FTS5 virtual table with Porter stemming + sync triggers
- `src/routes/wines.js` - FTS5 search with BM25 ranking, global search endpoint for command palette

**Key Fixes Applied**:
- Wine name parser: Reordered `gran_reserva` before `reserva` pattern for correct matching
- Hash content: Handle empty strings correctly (not returning null)
- Exports: Added missing `export const` for DEFAULT_RATE_LIMITS

---

## Executive Summary

This roadmap outlines the architectural changes and feature additions needed to commercialize the Wine Cellar App. The plan is organized into 5 phases, prioritized by dependency order and impact.

### Current State
- **Architecture**: Node.js/Express backend, Vanilla JS frontend, SQLite database
- **Deployment**: Docker on Synology NAS (single-user)
- **Strengths**: Multi-source rating aggregation, AI-powered features, modular codebase
- **Gaps**: No tests, no auth, no mobile app, not optimized for scale

### Target State
- **Platform**: Progressive Web App (PWA) + optional native wrapper for Play Store
- **Scale**: 1000+ bottles, multi-user capable
- **Quality**: Full test coverage, CI/CD pipeline, monitoring

### Development Philosophy
- **Hobby-first**: Building for personal use, then alpha testing with friends
- **Server-side scraping**: Intentionally sticking with current approach for now
- **Partner-ready**: Data provenance and content policies enable future partnerships with Vivino, Decanter, etc.

---

## Phase 1: Foundation (Testing & Architecture)

**Objective**: Establish quality infrastructure, clean up technical debt, and build partner-ready foundations

### Phase 1 Priority Order (Revised)

| Item | Priority | Rationale |
|------|----------|-----------|
| 1.1 Unit tests | P1 | Enables confident refactoring |
| 1.3 Unify configs | P1 | Anchor for provenance, rate limits, caching |
| 1.4 Data provenance ledger | P1 | Cheap now, expensive to retrofit |
| 1.5 Scraping governance | P1 | Protects accounts, improves stability |
| 1.2 DB abstraction | P3 | Defer until cloud migration needed |

---

### 1.1 Unit Test Framework Setup

**Why**: Essential for confident refactoring and commercial-grade reliability

**Implementation**:
```
tests/
├── unit/
│   ├── services/
│   │   ├── ratings.test.js
│   │   ├── pairing.test.js
│   │   ├── wineNameParser.test.js
│   │   └── searchProviders.test.js
│   ├── routes/
│   │   ├── wines.test.js
│   │   ├── bottles.test.js
│   │   └── ratings.test.js
│   └── config/
│       ├── scoreFormats.test.js
│       └── vintageSensitivity.test.js
├── integration/
│   ├── api.test.js
│   └── database.test.js
└── e2e/
    └── workflows.test.js
```

**Technology Choice**:
- **Vitest** (faster than Jest, native ESM support, compatible with our ES modules)
- **Supertest** for API integration tests
- **Testing-library** for frontend component tests

**Package additions**:
```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "supertest": "^7.0.0",
    "@testing-library/dom": "^10.0.0"
  }
}
```

**Priority files to test first** (highest business logic density):
1. `src/services/ratings.js` - Score normalization, purchase score calculation
2. `src/services/wineNameParser.js` - Producer/vintage extraction
3. `src/config/scoreFormats.js` - Score conversion accuracy
4. `src/services/searchProviders.js` - Country inference, URL parsing

**Target**: 80% coverage on services/, 60% coverage on routes/

---

### 1.2 Database Abstraction Layer

**Why**: Enable future migration to PostgreSQL/cloud databases for multi-user scaling

**Current State**: Direct `libsql` (better-sqlite3) calls scattered throughout codebase

**Target Architecture**:
```
src/
├── db/
│   ├── index.js              # Connection factory (unchanged export signature)
│   ├── repository/
│   │   ├── BaseRepository.js # Abstract CRUD operations
│   │   ├── WineRepository.js
│   │   ├── SlotRepository.js
│   │   ├── RatingRepository.js
│   │   ├── SettingsRepository.js
│   │   └── AwardsRepository.js
│   ├── adapters/
│   │   ├── SqliteAdapter.js  # Current implementation
│   │   └── PostgresAdapter.js # Future: Supabase/Neon
│   └── migrations/
│       └── (existing .sql files)
```

**Repository Pattern Example**:
```javascript
// src/db/repository/WineRepository.js
export class WineRepository {
  constructor(adapter) {
    this.adapter = adapter;
  }

  async findById(id) {
    return this.adapter.queryOne('SELECT * FROM wines WHERE id = ?', [id]);
  }

  async findAll(filters = {}) {
    const { colour, style, limit, offset } = filters;
    // Build query dynamically
  }

  async create(wine) {
    return this.adapter.insert('wines', wine);
  }

  async update(id, updates) {
    return this.adapter.update('wines', updates, { id });
  }

  async delete(id) {
    return this.adapter.delete('wines', { id });
  }
}
```

**Migration Strategy**:
1. Create adapter interface matching current db.prepare().get/all/run pattern
2. Wrap existing SQLite calls in SqliteAdapter
3. Gradually migrate routes to use repositories
4. Add PostgresAdapter when cloud deployment needed

**Breaking Change Mitigation**: Keep `export default db` working during transition

---

### 1.3 Unify Rating Source Configurations

**Why**: DRY violation between `ratingSources.js` (704 LOC) and `sourceRegistry.js` (919 LOC)

**Current Duplication**:
| Data Point | ratingSources.js | sourceRegistry.js |
|------------|------------------|-------------------|
| Source ID | ✅ | ✅ |
| Display name | ✅ | ✅ |
| Score format | ✅ | ✅ |
| URL pattern | ❌ | ✅ |
| Credibility weight | ✅ | ✅ |
| Lens category | ✅ | ✅ |
| Search query template | ❌ | ✅ |

**Unified Structure**:
```javascript
// src/config/ratingSourcesUnified.js
export const RATING_SOURCES = {
  'vivino': {
    // Identity
    id: 'vivino',
    name: 'Vivino',
    shortName: 'VIV',

    // Classification
    lens: 'community',
    credibility: 0.6,

    // Scoring
    scoreFormat: 'points_5',
    scoreRange: { min: 1.0, max: 5.0 },
    starsConversion: (score) => score, // Already 5-point scale

    // Fetching
    domain: 'vivino.com',
    searchUrl: 'https://www.vivino.com/search/wines?q={query}',
    requiresAuth: false,
    rateLimit: 2000, // ms between requests

    // Parsing
    scoreSelector: '.average__number',
    reviewCountSelector: '.text-micro',

    // Display
    icon: '🍷',
    color: '#A61A2E'
  },
  // ... other sources
};

// Derived views for backward compatibility
export const SOURCE_REGISTRY = Object.fromEntries(
  Object.entries(RATING_SOURCES).map(([id, source]) => [
    id,
    { domain: source.domain, query_template: source.searchUrl, ...}
  ])
);
```

**Migration Steps**:
1. Create unified config with all fields
2. Generate backward-compatible exports
3. Update imports one file at a time
4. Remove old files once all references updated
5. Add JSDoc types for IDE support

**New Fields for Governance** (added per reviewer feedback):
```javascript
// Additional fields in unified config
{
  // Provider tier classification
  tier: 'C',  // A=Partnered, B=User-provided, C=Automated retrieval

  // Scraping governance
  rateLimitMs: 2000,           // Min ms between requests
  cacheTtlDays: 7,             // How long to cache results
  requiresAuth: false,         // Needs login?
  authMode: null,              // 'cookieSession' | 'apiKey' | null

  // Content policy
  fieldsAllowed: ['score', 'award', 'drink_window'],  // What we store
  allowVerbatimNotes: false,   // Store full tasting notes? (true for personal use)

  // Display rules
  attributionRequired: true,   // Show source name in UI
  linkBackUrl: true            // Include source URL
}
```

---

### 1.4 Data Provenance Ledger

**Why**: Track where every piece of external data came from. Enables partner discussions and keeps data defensible.

**Database Table**:
```sql
-- New migration: 013_data_provenance.sql

CREATE TABLE IF NOT EXISTS data_provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- What was retrieved
  wine_id INTEGER,
  field_name TEXT NOT NULL,           -- 'rating_score', 'tasting_notes', 'drink_window', etc.

  -- Where it came from
  source_id TEXT NOT NULL,            -- 'decanter', 'vivino', etc.
  source_url TEXT,                    -- Full URL of the page

  -- When and how
  retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  retrieval_method TEXT NOT NULL,     -- 'scrape', 'api', 'user_upload', 'manual_link'

  -- Quality metadata
  confidence REAL,                    -- 0.0-1.0 match confidence
  raw_hash TEXT,                      -- SHA256 of raw HTML/response for audit

  -- Lifecycle
  storage_policy TEXT DEFAULT 'structured',  -- 'raw', 'structured', 'redacted'
  expires_at DATETIME,                -- When to refresh/purge

  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

CREATE INDEX idx_provenance_wine ON data_provenance(wine_id);
CREATE INDEX idx_provenance_source ON data_provenance(source_id);
CREATE INDEX idx_provenance_expires ON data_provenance(expires_at);
```

**Service Layer**:
```javascript
// src/services/provenance.js

import crypto from 'crypto';
import db from '../db/index.js';

/**
 * Record provenance for externally-derived data.
 * Call this whenever storing data from an external source.
 */
export function recordProvenance({
  wineId,
  fieldName,
  sourceId,
  sourceUrl,
  retrievalMethod,
  confidence = 1.0,
  rawContent = null,
  expiresInDays = 30
}) {
  const rawHash = rawContent
    ? crypto.createHash('sha256').update(rawContent).digest('hex')
    : null;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  return db.prepare(`
    INSERT INTO data_provenance
    (wine_id, field_name, source_id, source_url, retrieval_method, confidence, raw_hash, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wineId, fieldName, sourceId, sourceUrl,
    retrievalMethod, confidence, rawHash, expiresAt.toISOString()
  );
}

/**
 * Get provenance history for a wine field.
 */
export function getProvenance(wineId, fieldName = null) {
  if (fieldName) {
    return db.prepare(`
      SELECT * FROM data_provenance
      WHERE wine_id = ? AND field_name = ?
      ORDER BY retrieved_at DESC
    `).all(wineId, fieldName);
  }
  return db.prepare(`
    SELECT * FROM data_provenance
    WHERE wine_id = ?
    ORDER BY retrieved_at DESC
  `).all(wineId);
}

/**
 * Check if we have fresh data for a wine/source combo.
 */
export function hasFreshData(wineId, sourceId, fieldName) {
  const result = db.prepare(`
    SELECT 1 FROM data_provenance
    WHERE wine_id = ? AND source_id = ? AND field_name = ?
    AND expires_at > datetime('now')
    LIMIT 1
  `).get(wineId, sourceId, fieldName);
  return !!result;
}
```

**Usage in Search Providers**:
```javascript
// In fetchDecanterAuthenticated or similar
const rating = parseRating(html);
const notes = parseNotes(html);

// Store the rating
await saveWineRating(wineId, rating);

// Record provenance
recordProvenance({
  wineId,
  fieldName: 'rating_score',
  sourceId: 'decanter',
  sourceUrl: pageUrl,
  retrievalMethod: 'scrape',
  confidence: matchConfidence,
  rawContent: html,
  expiresInDays: 30
});
```

---

### 1.5 Scraping Governance Layer

**Why**: Protect accounts from rate limiting/blocking, improve stability, enable graceful degradation.

**Design Principle**: Wraps around existing scraping logic without changing it.

```
[User requests rating]
    → [Cache check] ← NEW: Return cached if fresh
    → [Rate limit gate] ← NEW: Queue if too fast
    → [Circuit breaker check] ← NEW: Fail gracefully if source is down
    → [Your existing scraping logic] ← UNCHANGED
    → [Parse results] ← UNCHANGED
    → [Write provenance record] ← NEW
    → [Return to UI]
```

**Rate Limiter**:
```javascript
// src/services/rateLimiter.js

const lastRequestTime = new Map();  // source -> timestamp

/**
 * Wait if needed to respect rate limit for a source.
 * Returns immediately if enough time has passed.
 */
export async function waitForRateLimit(sourceId, minDelayMs = 2000) {
  const lastTime = lastRequestTime.get(sourceId) || 0;
  const elapsed = Date.now() - lastTime;

  if (elapsed < minDelayMs) {
    const waitTime = minDelayMs - elapsed;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastRequestTime.set(sourceId, Date.now());
}
```

**Circuit Breaker**:
```javascript
// src/services/circuitBreaker.js

const circuitState = new Map();  // source -> { failures, openUntil }

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if circuit is open (source is failing).
 */
export function isCircuitOpen(sourceId) {
  const state = circuitState.get(sourceId);
  if (!state) return false;

  if (state.openUntil && Date.now() < state.openUntil) {
    return true;
  }

  // Reset if timeout passed
  if (state.openUntil && Date.now() >= state.openUntil) {
    circuitState.delete(sourceId);
    return false;
  }

  return false;
}

/**
 * Record a failure. Opens circuit after threshold.
 */
export function recordFailure(sourceId) {
  const state = circuitState.get(sourceId) || { failures: 0 };
  state.failures++;

  if (state.failures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + RESET_TIMEOUT_MS;
    console.warn(`Circuit opened for ${sourceId} until ${new Date(state.openUntil)}`);
  }

  circuitState.set(sourceId, state);
}

/**
 * Record a success. Resets failure count.
 */
export function recordSuccess(sourceId) {
  circuitState.delete(sourceId);
}

/**
 * Get human-readable status for UI.
 */
export function getCircuitStatus(sourceId) {
  const state = circuitState.get(sourceId);
  if (!state) return { status: 'healthy', message: null };

  if (state.openUntil && Date.now() < state.openUntil) {
    const hoursLeft = Math.ceil((state.openUntil - Date.now()) / (60 * 60 * 1000));
    return {
      status: 'unavailable',
      message: `Temporarily unavailable. Try again in ${hoursLeft}h.`
    };
  }

  return { status: 'degraded', message: `${state.failures} recent failures` };
}
```

**Cache-First Wrapper**:
```javascript
// src/services/scrapingGovernance.js

import { hasFreshData } from './provenance.js';
import { waitForRateLimit } from './rateLimiter.js';
import { isCircuitOpen, recordFailure, recordSuccess } from './circuitBreaker.js';
import { getSourceConfig } from '../config/ratingSourcesUnified.js';

/**
 * Wrap a scraping function with governance controls.
 * Does NOT change the scraping logic itself.
 */
export async function withGovernance(sourceId, wineId, fieldName, scrapeFn) {
  const config = getSourceConfig(sourceId);

  // 1. Cache check - skip scrape if we have fresh data
  if (hasFreshData(wineId, sourceId, fieldName)) {
    return { cached: true, data: null };
  }

  // 2. Circuit breaker - fail gracefully if source is down
  if (isCircuitOpen(sourceId)) {
    return {
      error: true,
      message: `${config.name} is temporarily unavailable. Please try again later.`
    };
  }

  // 3. Rate limit - wait if needed
  await waitForRateLimit(sourceId, config.rateLimitMs || 2000);

  // 4. Execute the actual scrape
  try {
    const result = await scrapeFn();
    recordSuccess(sourceId);
    return { cached: false, data: result };
  } catch (error) {
    recordFailure(sourceId);
    throw error;
  }
}
```

**Integration with Decanter** (example - does not change existing logic):
```javascript
// In searchProviders.js

async function fetchDecanterRating(wine, wineId) {
  return withGovernance('decanter', wineId, 'rating_score', async () => {
    // Your existing fetchDecanterAuthenticated logic - UNCHANGED
    const result = await fetchDecanterAuthenticated(wine);

    // Record provenance after successful fetch
    if (result) {
      recordProvenance({
        wineId,
        fieldName: 'rating_score',
        sourceId: 'decanter',
        sourceUrl: result.url,
        retrievalMethod: 'scrape',
        confidence: result.confidence,
        rawContent: result.rawHtml
      });
    }

    return result;
  });
}
```

**Decanter-Specific Config** (protects your login):
```javascript
// In unified config
'decanter': {
  // ... other fields
  requiresAuth: true,
  authMode: 'cookieSession',
  rateLimitMs: 5000,        // Very conservative for logged-in source
  cacheTtlDays: 14,         // Cache longer since content changes slowly
  fieldsAllowed: ['score', 'structured_descriptors', 'drink_window'],
  allowVerbatimNotes: true  // For personal use, store full notes
}
```

---

## Phase 2: Scale (Performance for 1000+ Bottles)

**Objective**: Ensure smooth performance with large collections

### 2.1 FTS5 Full-Text Search

**Why**: `LIKE '%query%'` becomes slow with 1000+ wines; FTS5 provides sub-millisecond search

**Implementation**:

```sql
-- New migration: 013_fts5_search.sql

-- Create FTS5 virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS wines_fts USING fts5(
  wine_name,
  producer,
  style,
  country,
  tasting_notes,
  content='wines',
  content_rowid='id'
);

-- Populate from existing data
INSERT INTO wines_fts(rowid, wine_name, producer, style, country, tasting_notes)
SELECT id, wine_name, producer, style, country, tasting_notes FROM wines;

-- Triggers to keep FTS in sync
CREATE TRIGGER wines_ai AFTER INSERT ON wines BEGIN
  INSERT INTO wines_fts(rowid, wine_name, producer, style, country, tasting_notes)
  VALUES (new.id, new.wine_name, new.producer, new.style, new.country, new.tasting_notes);
END;

CREATE TRIGGER wines_ad AFTER DELETE ON wines BEGIN
  INSERT INTO wines_fts(wines_fts, rowid, wine_name, producer, style, country, tasting_notes)
  VALUES ('delete', old.id, old.wine_name, old.producer, old.style, old.country, old.tasting_notes);
END;

CREATE TRIGGER wines_au AFTER UPDATE ON wines BEGIN
  INSERT INTO wines_fts(wines_fts, rowid, wine_name, producer, style, country, tasting_notes)
  VALUES ('delete', old.id, old.wine_name, old.producer, old.style, old.country, old.tasting_notes);
  INSERT INTO wines_fts(rowid, wine_name, producer, style, country, tasting_notes)
  VALUES (new.id, new.wine_name, new.producer, new.style, new.country, new.tasting_notes);
END;
```

**Search API Update**:
```javascript
// src/routes/wines.js
router.get('/search', (req, res) => {
  const { q, limit = 20 } = req.query;

  // FTS5 search with ranking
  const results = db.prepare(`
    SELECT w.*,
           bm25(wines_fts) as relevance
    FROM wines_fts
    JOIN wines w ON wines_fts.rowid = w.id
    WHERE wines_fts MATCH ?
    ORDER BY relevance
    LIMIT ?
  `).all(q, limit);

  res.json({ data: results });
});
```

**Benefits**:
- Sub-millisecond search across all text fields
- Ranking by relevance (BM25 algorithm)
- Phrase matching, prefix search support
- No external dependencies (built into SQLite)

---

### 2.2 Virtual List Rendering

**Why**: Rendering 1000+ DOM nodes causes jank; virtual lists render only visible items

**Technology Choice**: **Clusterize.js** (no dependencies, 4KB, works with Vanilla JS)

**Alternative considered**: Custom implementation using Intersection Observer

**Implementation**:

```javascript
// public/js/virtualList.js
import Clusterize from 'clusterize.js';

let wineListCluster = null;

export function initVirtualWineList(wines) {
  const container = document.getElementById('wine-list');
  const scrollArea = document.getElementById('wine-list-scroll');

  // Generate HTML for all wines (strings only, not DOM)
  const rows = wines.map(wine => createWineRowHTML(wine));

  // Initialize virtual scrolling
  wineListCluster = new Clusterize({
    rows: rows,
    scrollId: 'wine-list-scroll',
    contentId: 'wine-list',
    rows_in_block: 20,
    blocks_in_cluster: 4
  });
}

export function updateVirtualList(wines) {
  if (wineListCluster) {
    wineListCluster.update(wines.map(w => createWineRowHTML(w)));
  }
}

function createWineRowHTML(wine) {
  return `
    <div class="wine-row" data-id="${wine.id}">
      <span class="wine-name">${wine.wine_name}</span>
      <span class="wine-vintage">${wine.vintage || '-'}</span>
      <span class="wine-rating">${wine.purchase_stars?.toFixed(1) || '-'}</span>
    </div>
  `;
}
```

**HTML Structure**:
```html
<div id="wine-list-scroll" class="wine-list-container">
  <div id="wine-list" class="wine-list-content">
    <!-- Virtual rows injected here -->
  </div>
</div>
```

**CSS Requirements**:
```css
.wine-list-container {
  height: 600px; /* Fixed height required */
  overflow-y: auto;
}

.wine-row {
  height: 48px; /* Fixed row height for calculations */
}
```

**Performance Target**: Smooth 60fps scrolling with 5000+ items

---

### 2.3 Refactor bottles.js (1205 LOC)

**Why**: Single file handling too many responsibilities; harder to test and maintain

**Current Responsibilities** (identified via analysis):
1. Modal management (open/close/state)
2. Form validation
3. Image parsing (label OCR)
4. Text parsing (clipboard wine data)
5. Wine search/autocomplete
6. Slot selection
7. API calls for add/edit

**Proposed Split**:
```
public/js/
├── bottles/
│   ├── index.js           # Public API, re-exports
│   ├── modal.js           # Modal open/close, state management
│   ├── form.js            # Form validation, field handling
│   ├── imageParsing.js    # Label OCR, image upload
│   ├── textParsing.js     # Clipboard/text wine data extraction
│   ├── wineSearch.js      # Autocomplete, existing wine lookup
│   └── slotSelection.js   # Grid slot picker for placement
├── bottles.js             # Legacy: imports from bottles/, re-exports for compatibility
```

**Migration Strategy**:
1. Create `bottles/` directory
2. Extract one responsibility at a time (start with `imageParsing.js`)
3. Keep original `bottles.js` as facade importing from submodules
4. Update internal imports gradually
5. Write tests for each extracted module

---

## Phase 3: User Experience (Professional Polish)

**Objective**: Achieve commercial-grade UX standards

### 3.1 Global Unified Search Bar

**Why**: Single search entry point is standard UX; more intuitive than filtered searches

**Design**:
```
┌─────────────────────────────────────────────────────────────┐
│ 🔍 Search wines, producers, regions...          [⌘K]       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ WINES                                                        │
│ ├─ Château Margaux 2015                    ★★★★★  Bordeaux  │
│ ├─ Kanonkop Pinotage 2019                  ★★★★☆  SA        │
│                                                              │
│ PRODUCERS                                                    │
│ ├─ Kanonkop Estate (4 wines)                                │
│                                                              │
│ REGIONS                                                      │
│ ├─ Stellenbosch (12 wines)                                  │
│                                                              │
│ QUICK ACTIONS                                                │
│ ├─ 🍷 Add new wine                                          │
│ ├─ 🤖 Ask sommelier                                         │
└─────────────────────────────────────────────────────────────┘
```

**Implementation**:
```javascript
// public/js/globalSearch.js

class GlobalSearch {
  constructor() {
    this.overlay = null;
    this.input = null;
    this.results = null;
    this.debounceTimer = null;
  }

  init() {
    this.createOverlay();
    this.bindKeyboardShortcut(); // Cmd/Ctrl + K
    this.bindEvents();
  }

  async search(query) {
    if (query.length < 2) {
      this.showQuickActions();
      return;
    }

    const [wines, producers, regions] = await Promise.all([
      api.searchWines(query),
      api.searchProducers(query),
      api.searchRegions(query)
    ]);

    this.renderResults({ wines, producers, regions });
  }

  bindKeyboardShortcut() {
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.open();
      }
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }
}

export const globalSearch = new GlobalSearch();
```

**Backend Support**:
```javascript
// src/routes/search.js
router.get('/global', async (req, res) => {
  const { q } = req.query;

  // Parallel FTS5 searches
  const [wines, producers, regions] = await Promise.all([
    wineRepo.searchFTS(q, { limit: 5 }),
    wineRepo.searchProducers(q, { limit: 3 }),
    wineRepo.searchRegions(q, { limit: 3 })
  ]);

  res.json({ wines, producers, regions });
});
```

---

### 3.2 Accessibility Improvements

**Why**: Required for app store compliance; improves usability for all users

**WCAG 2.1 AA Compliance Checklist**:

| Area | Current | Required | Fix |
|------|---------|----------|-----|
| Tab navigation | Partial | Full | Add tabindex, focus styles |
| Screen readers | Poor | Good | Add ARIA labels/roles |
| Color contrast | Good | Good | Already passes |
| Keyboard shortcuts | None | Some | Add Cmd+K, Escape handlers |
| Focus management | Poor | Good | Trap focus in modals |

**Implementation**:

```html
<!-- Tab navigation with ARIA -->
<div role="tablist" aria-label="Wine views">
  <button role="tab"
          aria-selected="true"
          aria-controls="cellar-panel"
          id="cellar-tab">
    Cellar
  </button>
  <button role="tab"
          aria-selected="false"
          aria-controls="list-panel"
          id="list-tab">
    Wine List
  </button>
</div>

<div role="tabpanel"
     id="cellar-panel"
     aria-labelledby="cellar-tab">
  <!-- Cellar grid -->
</div>
```

```javascript
// public/js/accessibility.js

export function initAccessibility() {
  // Focus trap for modals
  document.querySelectorAll('.modal').forEach(modal => {
    trapFocus(modal);
  });

  // Announce dynamic content changes
  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  announcer.className = 'sr-only';
  document.body.appendChild(announcer);

  window.announce = (message) => {
    announcer.textContent = message;
  };
}

function trapFocus(element) {
  const focusableElements = element.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  element.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey && document.activeElement === firstFocusable) {
      lastFocusable.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === lastFocusable) {
      firstFocusable.focus();
      e.preventDefault();
    }
  });
}
```

**Tooltips for Indicators**:
```javascript
// Add title attributes with explanations
document.querySelectorAll('.peak-indicator').forEach(el => {
  const status = el.dataset.status;
  const tooltips = {
    'peak': 'This wine is at its peak drinking window',
    'past-peak': 'This wine is past its optimal drinking window',
    'too-young': 'This wine needs more time to develop'
  };
  el.setAttribute('title', tooltips[status]);
  el.setAttribute('aria-label', tooltips[status]);
});
```

---

### 3.3 Export, Import & Backup

**Why**: Critical for any serious user. Prevents data loss and enables migration.

**Export Formats**:

| Format | Use Case | Contents |
|--------|----------|----------|
| JSON | Full backup/restore | All tables, settings, provenance |
| CSV | Spreadsheet analysis | Wines + ratings (flattened) |
| PDF | Printed cellar inventory | Visual grid + wine list |

**Backend API**:
```javascript
// src/routes/backup.js

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Full JSON backup - all data.
 */
router.get('/export/json', (req, res) => {
  const backup = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    data: {
      wines: db.prepare('SELECT * FROM wines').all(),
      slots: db.prepare('SELECT * FROM slots').all(),
      wine_ratings: db.prepare('SELECT * FROM wine_ratings').all(),
      wine_history: db.prepare('SELECT * FROM wine_history').all(),
      drinking_windows: db.prepare('SELECT * FROM drinking_windows').all(),
      user_settings: db.prepare('SELECT * FROM user_settings').all(),
      data_provenance: db.prepare('SELECT * FROM data_provenance').all()
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition',
    `attachment; filename="cellar-backup-${new Date().toISOString().split('T')[0]}.json"`);
  res.json(backup);
});

/**
 * CSV export - wines with ratings (flattened).
 */
router.get('/export/csv', (req, res) => {
  const wines = db.prepare(`
    SELECT
      w.wine_name, w.vintage, w.producer, w.country, w.style, w.colour,
      w.purchase_score, w.purchase_stars, w.drink_from, w.drink_peak, w.drink_until,
      GROUP_CONCAT(s.location_code) as locations
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    GROUP BY w.id
  `).all();

  const csv = generateCSV(wines);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition',
    `attachment; filename="cellar-export-${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
});

/**
 * Import from JSON backup.
 */
router.post('/import/json', async (req, res) => {
  const { data, options = {} } = req.body;
  const { merge = false } = options;

  try {
    db.exec('BEGIN TRANSACTION');

    if (!merge) {
      // Clear existing data
      db.exec('DELETE FROM wine_ratings');
      db.exec('DELETE FROM slots');
      db.exec('DELETE FROM wines');
    }

    // Import wines (with ID mapping for merge)
    const idMap = new Map();
    for (const wine of data.wines) {
      const oldId = wine.id;
      delete wine.id;  // Let SQLite assign new ID

      const result = db.prepare(`
        INSERT INTO wines (wine_name, vintage, producer, country, style, colour, ...)
        VALUES (?, ?, ?, ?, ?, ?, ...)
      `).run(...Object.values(wine));

      idMap.set(oldId, result.lastInsertRowid);
    }

    // Import slots with mapped wine IDs
    for (const slot of data.slots) {
      if (slot.wine_id) {
        slot.wine_id = idMap.get(slot.wine_id);
      }
      db.prepare(`
        INSERT OR REPLACE INTO slots (location_code, wine_id)
        VALUES (?, ?)
      `).run(slot.location_code, slot.wine_id);
    }

    // Continue for other tables...

    db.exec('COMMIT');
    res.json({ message: 'Import successful', winesImported: data.wines.length });

  } catch (error) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

**UI Components**:
```html
<!-- In settings panel -->
<section class="backup-section">
  <h3>Backup & Restore</h3>

  <div class="backup-actions">
    <button id="export-json" class="btn-secondary">
      Export Full Backup (JSON)
    </button>
    <button id="export-csv" class="btn-secondary">
      Export Wine List (CSV)
    </button>
  </div>

  <div class="restore-actions">
    <label for="import-file" class="btn-primary">
      Import Backup
      <input type="file" id="import-file" accept=".json" hidden>
    </label>
    <label>
      <input type="checkbox" id="merge-import">
      Merge with existing data (don't overwrite)
    </label>
  </div>
</section>
```

**Auto-Backup** (optional enhancement):
```javascript
// Scheduled daily backup to local storage or sync folder
function scheduleAutoBackup() {
  // Run at 3am daily
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      const backup = await fetch('/api/backup/export/json').then(r => r.json());
      localStorage.setItem('cellar-auto-backup', JSON.stringify(backup));
      console.log('Auto-backup completed');
    }
  }, 60000); // Check every minute
}
```

---

## Phase 4: AI Features (Differentiators)

**Objective**: Leverage AI capabilities as competitive advantage

### 4.1 Automated Drink-Now Recommendations

**Why**: Replace manual "Reduce Now" rules with intelligent AI-driven recommendations

**Current State**: Manual rules based on peak date, style, rating thresholds

**Target State**: AI agent that considers:
- Drinking window urgency
- Weather/season appropriateness
- Recent consumption patterns
- Collection balance (too much of one type aging out)
- Upcoming events (dinner parties in calendar)
- Price optimization (drink expensive wines at peak, everyday wines sooner)

**Architecture**:
```
┌─────────────────────────────────────────────────────────────┐
│                    DRINK-NOW AI ENGINE                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │   Urgency    │   │   Context    │   │  Collection  │    │
│  │   Analyzer   │   │   Engine     │   │   Optimizer  │    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘    │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Recommendation Ranker                   │   │
│  │  (Claude API with structured output)                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Personalized Recommendations               │   │
│  │  "Tonight: 2019 Kanonkop Pinotage - at peak,        │   │
│  │   pairs with your braai weather forecast"            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Implementation**:
```javascript
// src/services/drinkNowAI.js

export async function generateDrinkRecommendations(options = {}) {
  const { limit = 5, context = {} } = options;

  // Gather data
  const urgentWines = await getUrgentWines();
  const recentDrinks = await getRecentConsumption(30); // Last 30 days
  const collectionStats = await getCollectionBreakdown();

  // Build prompt
  const prompt = buildRecommendationPrompt({
    urgentWines,
    recentDrinks,
    collectionStats,
    context // Weather, events, preferences
  });

  // Get AI recommendations
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
    system: DRINK_NOW_SYSTEM_PROMPT
  });

  return parseRecommendations(response.content);
}

const DRINK_NOW_SYSTEM_PROMPT = `
You are a sommelier AI helping manage a wine cellar. Your task is to recommend
wines to drink soon based on:

1. URGENCY: Wines past or near peak drinking window
2. BALANCE: Avoid over-representation of any style in recommendations
3. CONTEXT: Consider weather, occasion, and recent consumption
4. VALUE: Prioritize drinking expensive wines at peak, everyday wines flexible

Return recommendations as JSON array with:
- wine_id: ID from provided list
- reason: Brief explanation (1-2 sentences)
- urgency: "critical" | "high" | "medium"
- pairing_suggestion: Optional food pairing if context provided
`;
```

**UI Component**:
```html
<section id="drink-tonight" class="recommendation-panel">
  <h2>🍷 Tonight's Recommendations</h2>
  <p class="subtitle">AI-curated based on your cellar and preferences</p>

  <div class="recommendation-cards">
    <!-- Dynamically populated -->
  </div>

  <button id="refresh-recommendations">
    🔄 Get new suggestions
  </button>
</section>
```

---

### 4.2 Tasting Note Structured Descriptors

**Why**: Transform prose tasting notes into searchable, filterable structured data. Enables better pairing logic and avoids storing long verbatim text.

**Design Philosophy**:
- Extract structured descriptors ONLY - no verbatim notes storage
- Structured descriptors enable filtering ("show me wines with black cherry notes")
- Summary bullets provide human-readable tasting info without copying source prose
- AI extraction produces consistent schema even from varied source prose
- This approach avoids copyright concerns and reduces storage requirements

**Structured Profile Schema**:
```javascript
// tasting_profile_json column in wines table
{
  // NOSE (Aroma)
  "nose": {
    "primary_fruit": ["dark_berry", "black_cherry", "plum"],
    "secondary": ["vanilla", "oak", "toast"],
    "tertiary": ["leather", "tobacco", "earth"],
    "intensity": "pronounced"  // light, medium, pronounced
  },

  // PALATE
  "palate": {
    "sweetness": "dry",         // dry, off-dry, medium, sweet
    "body": "full",             // light, medium, full
    "acidity": "medium",        // low, medium, high
    "tannin": "high",           // low, medium, high (reds only)
    "alcohol": "medium",        // low, medium, high
    "texture": ["velvety", "grippy"]
  },

  // FINISH
  "finish": {
    "length": "long",           // short, medium, long
    "notes": ["spice", "dark_fruit", "mineral"]
  },

  // STYLE TAGS
  "style_tags": ["full_bodied", "oaked", "age_worthy", "new_world"],

  // EXTRACTION METADATA
  "extraction": {
    "source_id": "decanter",
    "confidence": 0.85,
    "extracted_at": "2024-01-15T10:30:00Z"
  }
}
```

**Descriptor Vocabulary** (controlled vocabulary for consistency):

```javascript
// src/config/tastingVocabulary.js

export const FRUIT_DESCRIPTORS = {
  red_fruit: ['cherry', 'strawberry', 'raspberry', 'cranberry', 'red_currant'],
  dark_fruit: ['blackberry', 'black_cherry', 'plum', 'blackcurrant', 'mulberry'],
  stone_fruit: ['peach', 'apricot', 'nectarine'],
  tropical: ['pineapple', 'mango', 'passion_fruit', 'lychee'],
  citrus: ['lemon', 'lime', 'grapefruit', 'orange_zest'],
  dried_fruit: ['fig', 'raisin', 'prune', 'date']
};

export const SECONDARY_DESCRIPTORS = {
  oak: ['vanilla', 'toast', 'coconut', 'cedar', 'smoke'],
  floral: ['rose', 'violet', 'lavender', 'elderflower'],
  herbal: ['mint', 'eucalyptus', 'thyme', 'rosemary', 'sage'],
  spice: ['pepper', 'clove', 'cinnamon', 'nutmeg', 'licorice']
};

export const TERTIARY_DESCRIPTORS = {
  earthy: ['forest_floor', 'mushroom', 'truffle', 'wet_earth'],
  savory: ['leather', 'tobacco', 'meat', 'game'],
  oxidative: ['honey', 'caramel', 'toffee', 'coffee']
};
```

**AI Extraction Service**:
```javascript
// src/services/tastingExtractor.js

import Anthropic from '@anthropic-ai/sdk';
import { FRUIT_DESCRIPTORS, SECONDARY_DESCRIPTORS, TERTIARY_DESCRIPTORS } from '../config/tastingVocabulary.js';

const client = new Anthropic();

const EXTRACTION_PROMPT = `
You are a wine tasting note analyzer. Extract structured descriptors from the tasting note.

VOCABULARY (use only these terms):
Fruits: ${JSON.stringify(FRUIT_DESCRIPTORS)}
Secondary: ${JSON.stringify(SECONDARY_DESCRIPTORS)}
Tertiary: ${JSON.stringify(TERTIARY_DESCRIPTORS)}

TASTING NOTE:
{note}

Return JSON matching this schema exactly:
{
  "nose": {
    "primary_fruit": ["term1", "term2"],
    "secondary": ["term1"],
    "tertiary": [],
    "intensity": "light|medium|pronounced"
  },
  "palate": {
    "sweetness": "dry|off-dry|medium|sweet",
    "body": "light|medium|full",
    "acidity": "low|medium|high",
    "tannin": "low|medium|high|null",
    "alcohol": "low|medium|high",
    "texture": ["term1"]
  },
  "finish": {
    "length": "short|medium|long",
    "notes": ["term1"]
  },
  "style_tags": ["tag1", "tag2"],
  "summary_bullets": ["Max 5 bullets", "Each under 10 words"]
}
`;

export async function extractTastingProfile(tastingNote, sourceId) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: EXTRACTION_PROMPT.replace('{note}', tastingNote)
    }]
  });

  const profile = JSON.parse(response.content[0].text);

  // Add metadata
  profile.extraction = {
    source_id: sourceId,
    confidence: 0.85,  // Could be refined based on note quality
    extracted_at: new Date().toISOString()
  };

  return profile;
}

/**
 * Deterministic fallback when AI is unavailable.
 * Uses keyword matching against vocabulary.
 */
export function extractTastingProfileDeterministic(tastingNote) {
  const note = tastingNote.toLowerCase();
  const profile = {
    nose: { primary_fruit: [], secondary: [], tertiary: [], intensity: 'medium' },
    palate: { sweetness: 'dry', body: 'medium', acidity: 'medium', tannin: null, alcohol: 'medium', texture: [] },
    finish: { length: 'medium', notes: [] },
    style_tags: [],
    summary_bullets: []
  };

  // Match fruits
  for (const [category, terms] of Object.entries(FRUIT_DESCRIPTORS)) {
    for (const term of terms) {
      if (note.includes(term.replace('_', ' '))) {
        profile.nose.primary_fruit.push(term);
      }
    }
  }

  // Match body
  if (note.includes('full-bodied') || note.includes('full bodied')) {
    profile.palate.body = 'full';
  } else if (note.includes('light-bodied') || note.includes('light bodied')) {
    profile.palate.body = 'light';
  }

  // Match tannin (for reds)
  if (note.includes('silky tannin') || note.includes('fine tannin')) {
    profile.palate.tannin = 'medium';
  } else if (note.includes('firm tannin') || note.includes('grippy')) {
    profile.palate.tannin = 'high';
  }

  // Match finish
  if (note.includes('long finish') || note.includes('lingering')) {
    profile.finish.length = 'long';
  }

  return profile;
}
```

**Database Migration**:
```sql
-- 014_tasting_profile.sql

ALTER TABLE wines ADD COLUMN tasting_profile_json TEXT;
ALTER TABLE wines ADD COLUMN tasting_summary_bullets TEXT;  -- JSON array of max 5 bullets

CREATE INDEX idx_wines_tasting_profile ON wines(tasting_profile_json);
```

**Integration with Decanter Fetcher**:
```javascript
// In searchProviders.js, after extracting tasting notes

const tastingNote = extractTastingNote(html);  // Existing logic - used for extraction only

// Extract structured profile (verbatim note is NOT stored)
const profile = await extractTastingProfile(tastingNote, 'decanter');

// Store structured data only - no verbatim notes
await db.prepare(`
  UPDATE wines
  SET tasting_profile_json = ?,
      tasting_summary_bullets = ?
  WHERE id = ?
`).run(
  JSON.stringify(profile),               // Structured profile
  JSON.stringify(profile.summary_bullets), // Quick summary bullets
  wineId
);
```

**UI Display** (shows structured, not verbatim):
```javascript
// public/js/ratings.js

function renderTastingProfile(profile) {
  if (!profile) return '';

  const bullets = profile.summary_bullets || [];
  const nose = profile.nose?.primary_fruit?.join(', ') || 'Not specified';
  const body = profile.palate?.body || 'Medium';
  const tannin = profile.palate?.tannin || '-';

  return `
    <div class="tasting-profile">
      <div class="profile-section">
        <span class="label">Nose:</span>
        <span class="value">${nose}</span>
      </div>
      <div class="profile-section">
        <span class="label">Body:</span>
        <span class="value">${body}</span>
      </div>
      ${tannin !== '-' ? `
        <div class="profile-section">
          <span class="label">Tannin:</span>
          <span class="value">${tannin}</span>
        </div>
      ` : ''}
      <ul class="summary-bullets">
        ${bullets.map(b => `<li>${b}</li>`).join('')}
      </ul>
    </div>
  `;
}
```

**Search Enhancement** (filter by profile):
```javascript
// Find wines with specific characteristics
router.get('/wines/search/profile', (req, res) => {
  const { fruit, body, tannin } = req.query;

  let query = 'SELECT * FROM wines WHERE 1=1';
  const params = [];

  if (fruit) {
    query += ` AND json_extract(tasting_profile_json, '$.nose.primary_fruit') LIKE ?`;
    params.push(`%${fruit}%`);
  }
  if (body) {
    query += ` AND json_extract(tasting_profile_json, '$.palate.body') = ?`;
    params.push(body);
  }
  if (tannin) {
    query += ` AND json_extract(tasting_profile_json, '$.palate.tannin') = ?`;
    params.push(tannin);
  }

  const wines = db.prepare(query).all(...params);
  res.json({ data: wines });
});
```

---

## Phase 5: Mobile & Distribution

**Objective**: Prepare for Google Play Store release

### 5.1 Progressive Web App (PWA)

**Why**: Single codebase for web + mobile; installable on Android without native app

**Implementation**:

```json
// public/manifest.json
{
  "name": "Wine Cellar",
  "short_name": "Cellar",
  "description": "Manage your wine collection with AI-powered recommendations",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#722F37",
  "icons": [
    {
      "src": "/images/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/images/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

```javascript
// public/sw.js (Service Worker)
const CACHE_NAME = 'wine-cellar-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  // ... other static assets
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  // Network-first for API calls, cache-first for static assets
  if (event.request.url.includes('/api/')) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});
```

### 5.2 Play Store Wrapper (TWA)

**Why**: Trusted Web Activity wraps PWA as native Android app

**Tools**:
- **Bubblewrap** (Google's CLI tool)
- **PWABuilder** (Microsoft's web-based tool)

**Steps**:
1. Ensure PWA passes Lighthouse audit (90+ score)
2. Add assetlinks.json for domain verification
3. Generate signed APK using Bubblewrap
4. Submit to Play Console

### 5.3 Cloud Backend (Future)

**When**: After validating product-market fit with PWA

**Options**:
| Provider | Database | Auth | Hosting | Monthly Cost |
|----------|----------|------|---------|--------------|
| Supabase | PostgreSQL | Built-in | Edge Functions | $25+ |
| PlanetScale | MySQL | External | Vercel/Railway | $29+ |
| Neon | PostgreSQL | External | Any | $19+ |
| Firebase | Firestore | Built-in | Cloud Functions | Pay-as-go |

**Migration Path**:
1. Database abstraction layer (Phase 1.2) enables easy switch
2. Add user authentication (Supabase Auth or Auth0)
3. Implement data sync between local SQLite and cloud
4. Migrate to cloud-first with local cache

---

## Implementation Priority Matrix (Revised)

### Phase 1: Foundation

| Item | Effort | Impact | Priority | Rationale |
|------|--------|--------|----------|-----------|
| 1.1 Unit tests | High | High | **P1** | Enables confident refactoring |
| 1.3 Unify configs | Medium | High | **P1** | Anchor for governance, provenance, rate limits |
| 1.4 Provenance ledger | Low | High | **P1** | Cheap now, expensive to retrofit |
| 1.5 Scraping governance | Medium | High | **P1** | Protects accounts, improves stability |
| 1.2 DB abstraction | High | Medium | P3 | Defer until cloud migration needed |

### Phase 2: Scale

| Item | Effort | Impact | Priority | Rationale |
|------|--------|--------|----------|-----------|
| 2.1 FTS5 search | Low | High | **P1** | Critical for 1000+ bottles |
| 2.2 Virtual lists | Medium | High | **P1** | Required for mobile performance |
| 2.3 Refactor bottles.js | Medium | Medium | P2 | Enables testing, not blocking |

### Phase 3: UX

| Item | Effort | Impact | Priority | Rationale |
|------|--------|--------|----------|-----------|
| 3.1 Global search | Medium | High | **P1** | Standard professional UX |
| 3.2 Accessibility | Low | Medium | P2 | Required for app store |
| 3.3 Export/Import | Medium | High | **P2** | Critical for data safety |

### Phase 4: AI

| Item | Effort | Impact | Priority | Rationale |
|------|--------|--------|----------|-----------|
| 4.1 AI drink-now | Medium | High | **P1** | Key differentiator |
| 4.2 Tasting descriptors | Medium | High | **P1** | Enables filtering, partner-ready |

### Phase 5: Mobile

| Item | Effort | Impact | Priority | Rationale |
|------|--------|--------|----------|-----------|
| 5.1 PWA | Medium | High | **P1** | Single codebase for mobile |
| 5.2 Play Store (TWA) | Low | High | **P1** | Wraps PWA as native app |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Test coverage | 0% | 80% services, 60% routes |
| Lighthouse PWA score | N/A | 95+ |
| Search latency (1000 wines) | ~500ms | <50ms |
| List scroll FPS | Untested | 60fps stable |
| Accessibility score | ~60 | 95+ |
| Play Store rating | N/A | 4.5+ |
| **Provenance coverage** | 0% | **100% of scraped data** |
| **Structured tasting profiles** | 0% | **100% of wines with ratings** |

---

## Timeline Recommendation

**Note**: No time estimates provided per project guidelines. Phases are ordered by dependency:

1. **Phase 1** must complete before Phase 2 (tests protect refactoring)
2. **Phase 2.1 (FTS5)** can run parallel to Phase 1
3. **Phase 3** depends on Phase 2 (search UI needs FTS backend)
4. **Phase 4** can start after Phase 1.1 (needs test coverage for AI features)
5. **Phase 5** requires all prior phases for production-ready app

---

## Appendix: File Impact Analysis

### High-Touch Files (will change significantly)
- `src/db/index.js` - Repository pattern integration (P3)
- `src/routes/wines.js` - FTS5 search, repository calls
- `src/services/searchProviders.js` - Governance wrapper, provenance recording
- `public/js/bottles.js` - Module split
- `public/js/app.js` - Global search, PWA registration
- `src/config/ratingSources.js` - Merge with sourceRegistry

### New Files to Create

**Phase 1 (Foundation)**:
- `tests/**/*.test.js` - Test suite
- `src/config/ratingSourcesUnified.js` - Unified source config
- `src/services/provenance.js` - Data provenance service
- `src/services/rateLimiter.js` - Rate limiting
- `src/services/circuitBreaker.js` - Circuit breaker pattern
- `src/services/scrapingGovernance.js` - Governance wrapper
- `data/migrations/013_data_provenance.sql` - Provenance table

**Phase 2 (Scale)**:
- `data/migrations/013_fts5_search.sql` - FTS5 virtual table
- `public/js/virtualList.js` - Virtual scrolling
- `public/js/bottles/` - Modular bottles components

**Phase 3 (UX)**:
- `public/js/globalSearch.js` - Search overlay
- `public/js/accessibility.js` - A11y utilities
- `src/routes/backup.js` - Export/import endpoints

**Phase 4 (AI)**:
- `src/services/drinkNowAI.js` - AI recommendations
- `src/services/tastingExtractor.js` - Tasting note → structured
- `src/config/tastingVocabulary.js` - Controlled vocabulary
- `data/migrations/014_tasting_profile.sql` - Profile columns

**Phase 5 (Mobile)**:
- `public/manifest.json` - PWA manifest
- `public/sw.js` - Service worker
- `public/images/icon-*.png` - App icons

### Files to Delete (after migration)
- `src/config/sourceRegistry.js` - Merged into unified config
- (Old bottles.js kept as facade initially)
