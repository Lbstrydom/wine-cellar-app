# Wine Cellar App - Status Report
## 10 January 2026

---

## Executive Summary

The Wine Cellar App is a production-ready Progressive Web App for wine collection management, deployed on **Railway** with **Supabase PostgreSQL** database. It combines traditional inventory management with AI-powered features including natural language pairing recommendations, automated rating aggregation from 50+ sources, intelligent cellar organization, and comprehensive test coverage.

**Current State**: Production PWA deployed on Railway with custom domain (https://cellar.creathyst.com), PostgreSQL database on Supabase, auto-deploy from GitHub.

**Key Differentiators**:
- Progressive Web App with offline support and cross-platform installation
- Multi-source rating aggregation with data provenance tracking
- Claude AI integration for pairing, drink recommendations, and tasting analysis
- **Cloud-native deployment**: Railway + Supabase PostgreSQL
- **Award Extractor Skill** for structured PDF processing
- **Consolidated Tasting & Service card** ✨ NEW: unified wine detail with evidence indicators
- Dynamic cellar zone clustering with 40+ wine categories
- Automated award database with PDF import
- Secure HTTPS access via custom domain
- Comprehensive testing infrastructure (333 tests, 85% coverage)
- Full-text search with PostgreSQL
- Virtual list rendering for 1000+ bottle collections

---

## Technical Stack

| Component | Technology | Version |
|-----------|------------|---------|
| **Backend** | Node.js + Express | 5.2.1 |
| **Database** | PostgreSQL (Supabase) | 15+ |
| **AI** | Claude API (Anthropic SDK) | 0.71.2 |
| **AI (Optional)** | OpenAI SDK | 4.x |
| **Frontend** | Vanilla JavaScript (ES6 Modules) | - |
| **Testing** | Vitest | 2.1.8 |
| **Deployment** | Railway (auto-deploy from GitHub) | - |
| **Domain** | Cloudflare DNS | - |

### Key Dependencies

```json
{
  "dependencies": {
    "express": "^5.2.1",
    "@anthropic-ai/sdk": "^0.71.2",
    "openai": "^4.x",
    "pg": "^8.11.3",
    "better-sqlite3": "^11.8.1",
    "multer": "^2.0.2",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3"
  },
  "devDependencies": {
    "vitest": "^2.1.8",
    "@vitest/coverage-v8": "^2.1.8",
    "eslint": "^9.18.0"
  }
}
```

---

## Features Implemented

### 1. Progressive Web App (PWA) ✨ NEW

**Installation**:
- Installable on any device (Android, iOS, Windows, Mac)
- Offline support with service worker caching
- Native app-like experience with standalone display
- Add to home screen on mobile devices

**Service Worker Features**:
- Cache-first strategy for static assets
- Network-first for API calls
- Automatic update detection and notification
- Offline-capable core functionality

**Manifest Configuration**:
- Standalone display mode (hides browser chrome)
- Custom theme colors (wine-inspired)
- App icons in all sizes (72px - 512px + maskable icons)
- Shortcuts for quick actions (Add Wine, Sommelier, Settings)

**Access Methods**:
- **Production**: https://cellar.creathyst.com (Railway + Cloudflare DNS)

**Files**:
- `public/manifest.json` - PWA manifest
- `public/sw.js` - Service worker
- `public/images/icon-*.png` - App icons
- `scripts/generate-icons.js` - Icon generation utility

---

### 2. Testing Infrastructure ✨ UPDATED

**Test Framework**: Vitest with self-contained integration tests that automatically manage server lifecycle.

**Coverage Stats**:
- **333+ tests passing** (312+ unit + 21 integration)
- **~85% coverage on services**
- **~60% coverage on routes**
- **~70% coverage on config**

**Test Commands**:

| Command | What it does | Server needed? |
|---------|--------------|----------------|
| `npm run test:unit` | Runs 312+ unit tests (~0.5s) | ❌ No |
| `npm run test:integration` | Runs 21 integration tests (~3s) | ✅ Auto-managed |
| `npm run test:all` | Runs unit then integration | ✅ Auto-managed |
| `npm run test:coverage` | Runs with coverage report | ❌ No |

**Self-Contained Integration Tests** (8 Jan 2026):
- Uses Vitest's `globalSetup` to automatically spawn/kill server
- No manual coordination required - just run `npm run test:integration`
- Falls back gracefully if server already running
- Debug mode: `DEBUG_INTEGRATION=1 npm run test:integration`

**Test Categories**:
- **Service layer tests**: ratings, parsing, search providers, AI services
- **Configuration validation**: score formats, sources, vocabulary
- **API integration tests**: endpoint testing against real server
- **Database query tests**: SQL query validation

**Test Files**:
```
tests/
├── integration/
│   ├── api.test.js           # API endpoint tests (21 tests)
│   ├── setup.js              # Auto-starts/stops server
│   └── vitest.config.js      # Integration-specific config
└── unit/
    ├── config/               # Config module tests
    ├── middleware/           # Middleware tests
    ├── services/             # Service tests (ratings, parsing, etc.)
    └── utils/                # Utility tests
```

**Recommended Workflow**:
```bash
# Day-to-day development (fast, no server needed)
npm run test:unit

# Before commit (full validation)
npm run test:all

# After Railway deploy (prod smoke check)
curl -s https://cellar.creathyst.com/health/ready | jq
```

---

### 3. Data Provenance & Governance ✨ NEW

**Provenance Tracking**:
- Records origin of all external data (source, URL, timestamp)
- SHA256 hashing of raw content for audit trail
- Expiration tracking for cache invalidation
- Confidence scores for match quality
- Retrieval method tracking (scrape, API, manual)

**Database Table**:
```sql
CREATE TABLE data_provenance (
  id INTEGER PRIMARY KEY,
  wine_id INTEGER,
  field_name TEXT,        -- 'rating_score', 'tasting_notes', etc.
  source_id TEXT,         -- 'decanter', 'vivino', etc.
  source_url TEXT,
  retrieved_at DATETIME,
  retrieval_method TEXT,  -- 'scrape', 'api', 'user_upload'
  confidence REAL,
  raw_hash TEXT,          -- SHA256 for audit
  expires_at DATETIME,
  FOREIGN KEY (wine_id) REFERENCES wines(id)
);
```

**Scraping Governance**:
- **Rate Limiting**: Per-source configurable delays (default 2000ms)
- **Circuit Breaker**: 3 failures → 24h cooldown, prevents account bans
- **Cache-First**: Respects TTL, avoids redundant requests
- **Graceful Degradation**: Continues when sources unavailable

**Content Policy**:
- Structured data extraction only (no verbatim copying)
- Source attribution displayed in UI
- Link-back URLs to original sources
- Partner-ready for future API agreements

**Service Files**:
- `src/services/provenance.js` - Provenance tracking
- `src/services/rateLimiter.js` - Per-source rate limiting
- `src/services/circuitBreaker.js` - Failure protection
- `src/services/scrapingGovernance.js` - Unified governance wrapper

---

### 4. Cellar Grid Management

**Physical Layout**:
- 19-row cellar grid (7-9 columns per row, ~160 slots)
- 9-slot linear fridge section
- Dynamic zone labeling with color coding
- Row-based zone allocation with overflow handling

**Interactions**:
- Drag-and-drop bottle movement between slots
- **Direct swap** ✨ NEW: Drop wine onto occupied slot → confirmation dialog → swap positions
- **Auto-scroll during drag** ✨ NEW: Page auto-scrolls when dragging near viewport edges
- Mobile touch drag support with ghost element feedback
- Consecutive slot filling for bulk additions
- Visual zone allocation indicators
- Mobile-responsive horizontal scrolling

**Zone System** (40+ categories):
- Varietal-based: Sauvignon Blanc, Chardonnay, Riesling, Pinot Noir, etc.
- Region-based: Burgundy, Bordeaux, Tuscany, Rioja, etc.
- Style-based: Light whites, Full-bodied reds, Sparkling, Dessert
- Colour groupings: Red, White, Rosé, Sparkling

---

### 5. Wine Inventory Management

**Wine List View**:
- **FTS5 Full-Text Search** ✨ NEW: Sub-millisecond search with BM25 ranking
- **Virtual List Rendering** ✨ NEW: Smooth 60fps scrolling for 1000+ bottles
- Filterable by: reduce-now status, colour, style
- Sortable by: name, colour, style, vintage, rating, price
- Autocomplete search
- Bottle count per wine
- Location tracking across cellar/fridge

**Wine Detail Modal**:
- Basic info (name, vintage, producer, country, style, colour)
- **Structured tasting profiles** ✨ NEW (see section below)
- Purchase score (0-100) and star rating (0-5)
- Drinking window (from/peak/until years)
- Individual ratings from multiple sources
- Local awards from awards database
- Data provenance information ✨ NEW

**Wine Add/Edit**:
- Quantity selection with slot picker
- Text parsing via Claude (paste any wine description)
- Country/region inference from style
- Automatic drinking window defaults from vintage
- **Modular bottles.js** ✨ NEW: Split into 8 focused modules (<380 LOC each)

---

### 6. Rating Aggregation System

**Multi-Source Architecture**:
- **50+ rating sources** configured with unified metadata
- Three rating "lenses": Competition, Critics, Community
- Source credibility weighting (0.0-1.0)
- Aggregator discount for second-hand ratings
- **Data provenance for all ratings** ✨ NEW

**Rating Sources by Category**:

| Category | Sources |
|----------|---------|
| **Competitions** | Decanter World Wine Awards, IWC, IWSC, Concours Mondial de Bruxelles, Mundus Vini, Veritas, Old Mutual Trophy, San Francisco Chronicle, AWC Vienna, Sommelier Wine Awards |
| **Critics** | Jancis Robinson, Robert Parker, Wine Spectator, Wine Enthusiast, Tim Atkin, James Halliday, Gambero Rosso, Falstaff, Guía Peñín, Platter's Guide |
| **Community** | Vivino, CellarTracker, Wine-Searcher |

**Unified Configuration** ✨ NEW:
- `src/config/unifiedSources.js` - Single source of truth (900+ lines)
- Merged legacy configs (`ratingSources.js`, `sourceRegistry.js`, `scoreFormats.js`) into unified sources
- Includes rate limits, cache TTL, auth requirements, content policies

**Score Normalization**:
- 100-point scales (Parker, Spectator)
- 20-point scales (Jancis Robinson, RVF)
- Medal systems (Gold/Silver/Bronze → points)
- Symbolic ratings (Tre Bicchieri → points)
- Confidence levels per rating

**Purchase Score Calculation**:
```
Purchase Score = (Competition × weight) + (Critics × (1-weight)) + Community bonus
```
- Weight configurable via user preference slider (40-60%)
- Community ratings add bonus points if aligned

---

### 7. AI Sommelier (Claude-Powered Pairing)

**Natural Language Interface**:
- Describe any dish in plain English
- Claude analyzes ingredients, cooking methods, flavors
- Ranks cellar wines by compatibility
- Provides detailed reasoning for each recommendation
- Suggests serving approach and food tips

**Pairing Features**:
- Source filter: entire cellar or reduce-now only
- Colour preference: any/red/white/rosé
- Follow-up chat for multi-turn conversations
- Direct link to wine details from recommendations

**Example Interaction**:
```
User: "What should I pair with grilled lamb chops with rosemary?"

Sommelier: "For grilled lamb with rosemary, I recommend:
1. Kanonkop Pinotage 2019 (★★★★☆) - The smoky,
   earthy notes complement the char while matching
   the herb intensity..."
```

---

### 8. AI Drink Recommendations ✨ NEW

**Intelligent Recommendations**:
- Claude-powered analysis of entire cellar
- Considers drinking window urgency, quality, style balance
- Context-aware: weather, occasion, recent consumption
- Priority levels: Critical, High, Medium, Low

**Recommendation Panel**:
- "Tonight's Recommendations" section
- Context filters (occasion, weather, meal type)
- Reasoning for each suggestion
- Pairing suggestions
- Direct actions (log consumption, view details)

**Service**: `src/services/drinkNowAI.js`
**UI**: `public/js/recommendations.js`

---

### 9. Structured Tasting Profiles & Tasting Service Card ✨ UPDATED (10 Jan 2026)

**Why**: Transform prose tasting notes into searchable, filterable structured data without storing verbatim text, and consolidate all tasting/service info into one unified card.

**Consolidated Tasting & Service Card** (Wine Detail Panel Spec v2):
The wine detail modal now features a single consolidated card combining:
- **Style Fingerprint**: One-line summary (max 120 chars) describing the wine's character
- **Tasting Notes**: Nose/palate/finish sections with categorised descriptors
- **Evidence Indicators**: Strength (strong/medium/weak), source count, agreement score
- **Serving Temperature**: Recommended temp with glass icon and range
- **Drinking Window**: Timeline with peak marker and urgency badges

**Schema Version 2.0**:
```javascript
{
  "schema_version": "2.0",
  "normaliser_version": "1.0.0",
  "wine_type": "still_red",
  "style_fingerprint": "Full-bodied, oaked red with dark fruit and firm tannins",
  "nose": {
    "descriptors": [
      { "term": "black_cherry", "category": "fruit", "confidence": 0.9 },
      { "term": "vanilla", "category": "oak", "confidence": 0.85 }
    ],
    "intensity": "pronounced"
  },
  "palate": {
    "structure": {
      "sweetness": "dry",
      "acidity": "medium-plus",
      "body": "full",
      "tannin": "high",
      "finish_length": "long"
    },
    "descriptors": [...],
    "texture": ["velvety", "grippy"]
  },
  "finish": {
    "length": "long",
    "descriptors": [...]
  },
  "evidence": {
    "source_count": 3,
    "agreement_score": 0.85,
    "strength": "strong",
    "sources": ["vivino", "wine_spectator", "decanter"]
  },
  "contradictions": [],
  "quality_flags": []
}
```

**Vocabulary Normaliser** (`vocabularyNormaliser.js`):
- 60+ synonym mappings (e.g., "citrus peel" → "citrus")
- 100+ category mappings (fruit, oak, floral, herbal, spice, earthy, mineral, autolytic, savoury)
- Structure value normalisation for sweetness (6 levels), acidity (6), body (5), tannin (7), finish (6)
- Version tracking (NORMALISER_VERSION 1.0.0) for reprocessing

**Noise Filtering** (`noiseTerms.js`):
- 30 food pairing noise terms (pairs well with, serve with, etc.)
- 30 marketing hyperbole terms (superb, excellent, outstanding, etc.)
- Pairing context phrases to filter from extraction

**Evidence System**:
- **Strong**: 3+ sources with 0.7+ agreement
- **Medium**: 2+ sources with 0.5+ agreement
- **Weak**: Single source or low agreement
- Contradiction detection for structural fields (e.g., "dry" vs "sweet")

**API Endpoints** (per spec section 8):
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wines/:id/tasting-notes` | Get structured tasting notes |
| GET | `/api/wines/:id/tasting-notes/sources` | Get source attribution |
| POST | `/api/wines/:id/tasting-notes/regenerate` | Regenerate from sources |
| POST | `/api/wines/:id/tasting-notes/report` | Flag quality issue |
| GET | `/api/wines/tasting-notes/reports` | List flagged wines |
| PUT | `/api/wines/tasting-notes/reports/:id` | Update report status |

**Frontend Module** (`tastingService.js`):
- `renderTastingServiceCard()` - Main consolidated card
- `StyleFingerprint` component with category-coloured term chips
- `NoseSection`, `PalateSection`, `FinishSection` components
- `EvidenceIndicator` with source count and agreement display
- `SourcesDrawer` (collapsible) showing data provenance
- `ServingTempCard` with temperature and glass icon
- `DrinkingWindowCard` with urgency badges

**Database Migration** (019):
- `tasting_notes_structured` - JSON column for v2 data
- `tasting_notes_version` - Schema version tracking
- `normaliser_version` - Vocabulary version tracking
- `tasting_notes_generated_at` - Timestamp for cache invalidation
- `tasting_note_sources` table - Source provenance
- `tasting_note_reports` table - Quality issue tracking

**Files**:
- `src/services/tastingNotesV2.js` - V2 schema conversion and storage
- `src/services/vocabularyNormaliser.js` - Synonym/category mapping
- `src/config/noiseTerms.js` - Noise term filtering
- `src/routes/tastingNotes.js` - API endpoints
- `public/js/tastingService.js` - Frontend card module

---

### 10. Reduce-Now Priority List

**5-Level Priority System**:
1. **Critical** - Past drinking window, drink immediately
2. **High** - At peak, should drink within weeks
3. **Medium** - Approaching peak, drink within months
4. **Low** - Early peak, can wait but worth tracking
5. **Watch** - Monitor for changes

**Reduce Reasons**:
- Drinking window urgency
- Age-based (wines over threshold years)
- Quality concerns
- Space requirements
- Duplicate management

**Auto-Evaluation Rules** (configurable):
- Drinking window urgency threshold (months)
- Wine age threshold (years)
- Minimum rating requirement
- Include/exclude wines without drinking data

---

### 11. Cellar Analysis & Organization

**Misplaced Wine Detection**:
- Analyzes current slot allocations
- Identifies wines in "wrong" zones
- Calculates confidence score for each suggestion
- Groups recommendations by urgency

**AI Organization Advice**:
- Claude reviews suggested moves
- Provides sommelier perspective
- Suggests alternative groupings
- Justifies recommendations with wine knowledge

**Batch Reorganization**:
- Execute single moves or batch
- Preview move outcomes
- Rollback capability via history

**Zone Capacity Management** ✨ NEW (8 Jan 2026):
- **Proactive Detection**: Alerts when zone reaches capacity and wines would fall back to unrelated zones
- **AI-Assisted Recommendations**: Claude Opus analyzes situation and suggests:
  - **Expand**: Allocate additional row to overflowing zone
  - **Merge**: Combine related zones (e.g., Appassimento + Amarone → "Italian Dried-Grape")
  - **Reorganize**: Move lower-priority wines to make room
- **Human-in-the-Loop**: User reviews AI reasoning and approves individual actions
- **Automatic Execution**: Apply buttons execute zone changes and refresh analysis
- **Fallback Option**: User can ignore alert and use fallback placement if preferred

**Holistic Zone Reconfiguration** ✨ NEW (8 Jan 2026):
- **Grouped Banner**: When ≥3 zones overflow OR ≥10% bottles misplaced, shows single grouped banner instead of multiple alerts
- **Two-Path UX**: "Quick Fix Individual Zones" for minor issues vs "Full Reconfiguration" for systemic issues
- **AI-Powered Plan**: Claude generates cellar-wide restructuring plan with expand/merge/retire actions
- **Skip Individual Actions**: User can uncheck specific actions before applying
- **Plan Preview Modal**: Shows summary (zones changed, bottles affected, misplaced reduction estimate)
- **Heuristic Fallback**: Conservative row expansion when Claude not configured
- **Zone Pins**: Protect zones from being merged (never_merge constraint)
- **15-minute Plan TTL**: Generated plans expire after 15 minutes for security

---

### 12. Awards Database

**Separate Database** (`awards.db`):
- Designed for sharing across environments
- 40+ pre-configured competitions
- Medal band definitions per competition

**Import Methods**:

| Method | Description |
|--------|-------------|
| **PDF Import** | OCR extraction from competition booklets (local RolmOCR or Claude Vision) |
| **Webpage Import** | Parse structured HTML award listings |
| **Text/Markdown** | Manual entry from formatted lists |

**Award Matching**:
- Fuzzy matching via Levenshtein distance
- Wine name normalization
- Vintage tolerance handling
- Manual match confirmation

**Extraction Features**:
- Chunked processing for large PDFs
- Partial JSON salvaging for corrupted responses
- Retry logic with exponential backoff
- ~250 awards per processing chunk

---

### 13. MCP Integration ✨ UPDATED (10 Jan 2026)

**Model Context Protocol (MCP)** servers extend Claude Code's capabilities with specialized tools for development workflows.

**Configured MCP Servers**:

| Server | Package | Purpose |
|--------|---------|---------|
| **pdf-reader** | `@sylphx/pdf-reader-mcp` | Fast PDF text extraction (5-10x faster than OCR) |
| **filesystem** | `@modelcontextprotocol/server-filesystem` | Secure file operations within project directory |
| **memory** | `@modelcontextprotocol/server-memory` | Persistent knowledge graph across sessions |
| **brightdata** | `@brightdata/mcp` | Web scraping, SERP, browser automation (60+ tools) |

**Configuration File**: `.mcp.json` (gitignored - contains API keys)

**PDF Reader MCP Features**:
- `read_pdf` - Extract text, metadata, images from PDFs
- Parallel processing for speed (5-10x faster than OCR)
- Page range selection (`pages: "1-5,10"`)
- Batch processing multiple PDFs

**Filesystem MCP Features**:
- `read_text_file`, `write_file`, `edit_file` - File operations
- `directory_tree` - Recursive JSON structure
- `search_files` - Pattern-based file finding
- `list_directory_with_sizes` - Directory listings with metadata

**Memory MCP Features**:
- `create_entities`, `create_relations` - Build knowledge graph
- `search_nodes`, `read_graph` - Query persistent memory
- `add_observations` - Append facts to entities
- Persists across Claude Code sessions

**Bright Data MCP Features** (PRO_MODE enabled):
- `search_engine` - AI-optimized web search (Google, Bing, Yandex)
- `scrape_as_markdown` - Convert any webpage to clean markdown
- `scrape_batch` - Batch scraping capability
- `web_data_*` - 50+ structured data APIs (Amazon, LinkedIn, etc.)
- `scraping_browser_*` - Full browser automation with screenshots

**Skills Created**:

| Skill | Location | Purpose |
|-------|----------|---------|
| **award-extractor** | `.claude/skills/award-extractor/SKILL.md` | Structured extraction of wine awards from PDFs |
| **wine-data-importer** | `.claude/skills/wine-data-importer/SKILL.md` | Import wines from CSV/spreadsheets |
| **cellar-health-analyzer** | `.claude/skills/cellar-health-analyzer/SKILL.md` | Analyze cellar health and drinking priorities |
| **database-migrator** | `.claude/skills/database-migrator/SKILL.md` | Generate SQLite/PostgreSQL migrations |

**Documentation**:
- `docs/MCP_USE_CASES.md` - Specific development use cases
- `scripts/test-mcp-servers.md` - MCP connectivity test guide
- `CLAUDE.md` / `AGENTS.md` - MCP section with configuration and tool decision matrix

**Files**:
- `.mcp.json` - MCP server configuration (gitignored)
- `.claude/settings.local.json` - Enabled MCP servers list
- `.claude/skills/` - Custom skill definitions

---

### 14. Drinking Windows

**Window Data**:
- Drink From (year)
- Peak Window (year)
- Drink Until (year)
- Source tracking (manual, Vivino, critic)
- Confidence level (high/medium/low)

**Default Generation**:
- Automatic calculation from vintage year
- Style-specific aging curves
- Regional adjustments

**Urgency Calculation**:
- Flags wines past "drink until" date
- Highlights wines at peak
- Configurable urgency threshold

---

### 14. User Experience Enhancements ✨ NEW

**Global Unified Search (Cmd/Ctrl+K)**:
- Single search entry point for entire app
- Searches wines, producers, countries, styles
- Keyboard navigation
- Quick actions (Add Wine, Ask Sommelier)
- File: `public/js/globalSearch.js`

**Accessibility Improvements**:
- ARIA labels and roles throughout
- Focus trapping in modals
- Keyboard navigation support
- Screen reader announcements
- Skip link for main content
- Reduced motion support
- File: `public/js/accessibility.js`

**Backup & Restore**:
- Full JSON backup export
- CSV export for spreadsheets
- Restore with merge or replace modes
- Preserves provenance data
- Routes: `src/routes/backup.js`

---

### 15. User Settings

**Configurable Options**:

| Setting | Default | Description |
|---------|---------|-------------|
| `rating_preference` | 40 | Competition vs critics weight (40-60) |
| `reduce_auto_rules_enabled` | true | Enable auto-evaluation |
| `reduce_window_urgency_months` | 12 | Urgency threshold |
| `reduce_age_threshold` | 10 | Age-based flagging (years) |
| `reduce_rating_minimum` | 3.0 | Minimum rating for auto-reduce |
| `pdf_ocr_method` | auto | PDF extraction method |

**Credential Storage**:
- Encrypted storage for external service logins
- AES-256 encryption at rest
- Used for authenticated searches (Decanter, Vivino)

---

### 16. Sommelier-Grade Cellar Organisation ✨ NEW (Phase 7)

**Zone Intent Metadata**:
- AI-suggested zone descriptions (purpose, style range, serving temps)
- User-editable with confirmation timestamps
- Pairing hints and example wines per zone
- Family groupings for related zones
- Service: `src/services/zoneMetadata.js`

**Zone Chat**:
- Discuss wine classifications with AI sommelier
- Challenge and reassign wines to different zones
- Context-aware responses based on cellar composition
- Reclassification suggestions with JSON payloads
- Service: `src/services/zoneChat.js`

**Hybrid Pairing Engine**:
- Deterministic shortlist based on food signals (no AI needed)
- AI explanation layer for top matches
- House style preferences (acid, oak, tannin, adventure level)
- Reduce-now and fridge bonuses
- Diversity penalty to avoid repetitive suggestions
- Config: `src/config/pairingRules.js`
- Service: `src/services/pairingEngine.js`

**Fridge Stocking Service**:
- Par-level targets for 8 wine categories
- Gap analysis (what's missing from fridge)
- AI-powered restocking suggestions from cellar
- Considers drinking windows and variety balance
- Service: `src/services/fridgeStocking.js`

**Storage-Aware Drinking Windows**:
- Different aging rates for cellar vs fridge storage
- Fridge wines age ~3x faster (constant temp vs optimal cellar)
- Auto-adjusts drink-by dates based on current storage location
- Service: `src/services/windowDefaults.js`

**Input Sanitization**:
- Prevents prompt injection in AI chat inputs
- Removes markdown formatting and code blocks
- Length limits and suspicious pattern detection
- Service: `src/services/inputSanitizer.js`

---

## API Endpoints

### Wine Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wines` | List all wines with counts |
| GET | `/api/wines/:id` | Get wine details |
| POST | `/api/wines` | Create wine |
| PUT | `/api/wines/:id` | Update wine |
| DELETE | `/api/wines/:id` | Delete wine |
| POST | `/api/wines/parse` | Parse text via Claude |
| GET | `/api/wines/search` | **FTS5 search** ✨ NEW |

### Ratings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wines/:id/ratings` | Get all ratings |
| POST | `/api/ratings/fetch` | Fetch ratings for wine |
| POST | `/api/ratings/batch-fetch` | Batch fetch |
| GET | `/api/ratings/sources` | List sources |

### Slots & Storage
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/slots/move` | Move bottle |
| POST | `/api/slots/swap` | 3-way swap bottles |
| POST | `/api/slots/direct-swap` | **✨ NEW** Direct swap two bottles |
| POST | `/api/slots/drink` | Log consumption |
| POST | `/api/bottles/add` | Add bottles |

### Pairing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pairing/natural` | AI pairing |
| POST | `/api/pairing/:id/continue` | Follow-up chat |

### Cellar Organization
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cellar/zones` | Get zone definitions |
| GET | `/api/cellar/zones/:zoneId/intent` | Get zone intent metadata |
| PUT | `/api/cellar/zones/:zoneId/intent` | Update zone intent |
| POST | `/api/cellar/zones/:zoneId/confirm` | Confirm AI suggestion |
| POST | `/api/cellar/analyse` | Analyze placements |
| POST | `/api/cellar/execute-moves` | Execute moves |
| POST | `/api/cellar/zone-capacity-advice` | **✨ NEW** Get AI recommendations for zone overflow |
| POST | `/api/cellar/zones/allocate-row` | **✨ NEW** Assign additional row to zone |
| POST | `/api/cellar/zones/merge` | **✨ NEW** Merge two zones together |
| POST | `/api/cellar/reconfiguration-plan` | **✨ NEW** Generate holistic reconfiguration plan |
| POST | `/api/cellar/reconfiguration-plan/apply` | **✨ NEW** Apply generated plan with optional skips |

### Zone Chat ✨ NEW (Phase 7)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/cellar/zone-chat` | Discuss classifications with AI |
| POST | `/api/cellar/reassign-zone` | Reassign wine to different zone |

### Hybrid Pairing ✨ NEW (Phase 7)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pairing/signals` | Get available food signals |
| POST | `/api/pairing/extract-signals` | Extract signals from dish |
| POST | `/api/pairing/shortlist` | Get deterministic shortlist (no AI) |
| POST | `/api/pairing/hybrid` | Shortlist + AI explanation |
| GET | `/api/pairing/house-style` | Get house style defaults |

### Fridge Stocking ✨ NEW (Phase 7)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cellar/fridge/status` | Get fridge gaps vs par levels |
| POST | `/api/cellar/fridge/suggestions` | AI suggestions to fill gaps |

### Drink Recommendations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reduce-now/ai-recommendations` | AI-powered drink suggestions |
| GET | `/api/reduce-now/context` | Get context for recommendations |

### Search ✨ NEW
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search/global` | Global unified search (wines, producers, countries) |

### Backup & Restore ✨ NEW
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/backup/export/json` | Full backup export |
| GET | `/api/backup/export/csv` | Wine list CSV export |
| POST | `/api/backup/import/json` | Restore from backup |

### Awards
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/awards/sources` | List import sources |
| POST | `/api/awards/import/pdf` | Import from PDF |
| POST | `/api/awards/import/text` | Import from text |
| POST | `/api/awards/match` | Match to wines |

---

## Database Schema

### PostgreSQL (Supabase) - Production

**Core Tables**:
- `wines` - Master wine inventory (includes zone_id, zone_confidence)
- `slots` - Physical storage locations
- `wine_ratings` - Individual ratings from sources
- `drinking_windows` - Drinking window data
- `reduce_now` - Priority list entries
- `consumption_log` - Consumption history
- `user_settings` - User preferences
- `pairing_rules` - Food-to-wine mappings
- `zone_metadata` - Zone intent descriptions (AI-suggested, user-confirmed)
- `data_provenance` - External data tracking
- `search_cache` - Search result caching
- `competition_awards` - Award records
- `award_sources` - Competition source definitions
- `known_competitions` - Competition metadata

**PostgreSQL Features**:
- Connection pooling via Supabase Transaction Pooler
- Full-text search with PostgreSQL built-in capabilities
- Auto-vacuum and concurrent access handling
- Strategic indexes for common queries

### SQLite - Local Development

For local development, the app can still use SQLite (`data/cellar.db`).
Set `DATABASE_URL` to switch to PostgreSQL.

---

## Frontend Architecture

**Module Structure**:
```
public/js/
├── app.js                # State management, initialization
├── api.js                # Backend API wrapper
├── grid.js               # Cellar/fridge rendering
├── dragdrop.js           # Drag-and-drop interactions
├── modals.js             # Modal dialog management
├── bottles.js            # Thin facade for bottle management
├── bottles/              # ✨ NEW Modular bottle components
│   ├── state.js          #   Shared module state (45 lines)
│   ├── modal.js          #   Modal show/hide/close (134 lines)
│   ├── form.js           #   Form handling (142 lines)
│   ├── wineSearch.js     #   Wine search (74 lines)
│   ├── textParsing.js    #   Text parsing UI (207 lines)
│   ├── imageParsing.js   #   Image upload/parsing (376 lines)
│   └── slotPicker.js     #   Slot picker mode (243 lines)
├── sommelier.js          # AI pairing interface
├── ratings.js            # Rating display/fetch
├── settings.js           # User preferences UI
├── cellarAnalysis.js     # Thin facade (99 lines)
├── cellarAnalysis/       # ✨ NEW Modular analysis components
│   ├── state.js          #   Shared module state (133 lines)
│   ├── analysis.js       #   Load/render analysis (157 lines)
│   ├── aiAdvice.js       #   AI organization advice (94 lines)
│   ├── moves.js          #   Move suggestions & execution (384 lines)
│   ├── fridge.js         #   Fridge organization (346 lines)
│   ├── zones.js          #   Zone narratives & setup (425 lines)
│   └── zoneChat.js       #   AI zone chat (342 lines)
├── recommendations.js    # ✨ NEW AI drink suggestions UI
├── globalSearch.js       # ✨ NEW Cmd+K search palette
├── accessibility.js      # ✨ NEW A11y utilities
├── virtualList.js        # ✨ NEW Efficient large-list rendering
└── utils.js              # Shared utilities
```

**CSS Architecture**:
- CSS variables for theming
- Dark mode by default
- Responsive breakpoints (mobile-friendly)
- Zone color coding system
- Priority indicator styling
- PWA safe-area support ✨ NEW

---

## Backend Architecture

**Route Layer** (`src/routes/`):
- RESTful endpoints by domain
- Consistent error handling
- JSON request/response format

**Service Layer** (`src/services/`):

| Service | Purpose |
|---------|---------|
| `claude.js` | Claude API integration |
| `ratings.js` | Score normalization/aggregation |
| `searchProviders.js` | Multi-provider search |
| `awards.js` | Award import/matching |
| `cellarAnalysis.js` | Misplacement detection |
| `drinkNowAI.js` | **✨ NEW** AI drink recommendations |
| `tastingExtractor.js` | **✨ NEW** Tasting note → structured |
| `provenance.js` | **✨ NEW** Data provenance tracking |
| `rateLimiter.js` | **✨ NEW** Per-source rate limiting |
| `circuitBreaker.js` | **✨ NEW** Failure protection |
| `scrapingGovernance.js` | **✨ NEW** Unified governance |
| `cacheService.js` | Search result caching |
| `jobQueue.js` | Async job processing |

**Configuration Layer** (`src/config/`):

| Config | Purpose |
|--------|---------|
| `unifiedSources.js` | **✨ NEW** 50+ source definitions (merged) |
| `cellarZones.js` | 40+ zone definitions |
| `tastingVocabulary.js` | **✨ NEW** Controlled vocabulary (170+ terms) |
| `vintageSensitivity.js` | Vintage importance by style |
| `cellarThresholds.js` | Auto-evaluation thresholds |

---

## Deployment

### Railway + Supabase

The app is deployed to **Railway** with auto-deploy from GitHub. Database is hosted on **Supabase** (PostgreSQL).

**How Deployment Works**:
1. Push to `main` branch on GitHub
2. Railway automatically detects the push and deploys
3. The app connects to Supabase PostgreSQL via `DATABASE_URL`

**Key URLs**:
| Item | URL |
|------|-----|
| Production | https://cellar.creathyst.com |
| Railway Dashboard | https://railway.app |
| Supabase Dashboard | https://supabase.com/dashboard |
| GitHub Repo | https://github.com/Lbstrydom/wine-cellar-app |

**Custom Domain**:
- Domain: `cellar.creathyst.com`
- DNS: Cloudflare CNAME → `qxi4wlbz.up.railway.app`

**PWA Installation**:
1. Visit https://cellar.creathyst.com on any device
2. Click browser "Install" or "Add to Home Screen"
3. App works offline with service worker
4. Updates automatically when new version deployed

---

## Recent Development (December 2024 - January 2026)

### Storage Areas Feature - Planning Complete - 13 January 2026

**Feature Overview**:
Replace hardcoded fridge/cellar layout with user-definable **Storage Areas** (up to 5 per cellar). Each area has custom layout (variable rows/columns), storage type, and temperature zone that affects wine recommendations and drinking window calculations.

**Problem Solved**:
- Current layout assumes all users have 9-slot wine fridge + 169-slot cellar
- No accommodation for different setups (apartment dweller with small fridge, collector with multiple locations)
- No distinction between wine fridge (10-14°C) and kitchen fridge (4-8°C chilling only)

**Database Migration Created** (`data/migrations/038_storage_areas.sql`):
- `storage_areas` table: name, storage_type, temp_zone, display_order, icon, notes
- `storage_area_rows` table: variable column counts per row (1-20 cols, 1-100 rows)
- `slots.storage_area_id` foreign key with migration from legacy `zone` column
- `slots.chilled_since` timestamp for kitchen fridge time warnings
- `manage_chilled_since()` trigger: auto-sets/clears timestamp on area changes
- `v_slots_with_zone` view: backward compatibility with `legacy_zone` and `chilling_days`
- Migration fails with EXCEPTION (not WARNING) if slots remain unmapped

**Key Design Decisions** (reviewed by independent developer):
- `is_for_chilling` derived from `storage_type = 'kitchen_fridge'` (no column)
- Kitchen fridge excluded from aging calculations (chilling state only)
- Sparkling wine: cellar OR wine fridge both ideal (corrected from original)
- Templates use canonical format: `rows: [{ row_num: 1, col_count: 6 }, ...]`
- `?lite=true` API parameter for layout-only responses (performance)

**Documentation**:
- `docs/STORAGE_AREAS_PLAN.md` - Full implementation plan with code examples
- `docs/STORAGE_AREAS_REVIEW.md` - Developer review document with Q&A
- `.claude/plans/zany-twirling-platypus.md` - Claude Code plan file

**Status**: Planning complete, migration created, ready for implementation (API routes, frontend)

---

### OAuth Authentication & Legacy Cellar Migration - 13 January 2026

**OAuth Flow Fix**:
- Fixed OAuth authentication not completing after Google login
- Root cause: Railway environment variable `SUPABASE_ANON_KEY` was incorrectly set to a Google OAuth Client Secret (`GOCSPX-...`) instead of the actual Supabase anon key
- Resolution: Corrected the environment variable in Railway dashboard

**INITIAL_SESSION Event Handling**:
- Fixed OAuth callbacks not triggering user context loading
- Root cause: Supabase OAuth triggers `INITIAL_SESSION` event, not `SIGNED_IN` as documented
- Resolution: Modified auth state handler to process both `INITIAL_SESSION` and `SIGNED_IN` events
- Location: `public/js/app.js` lines 520-530

**Legacy Cellar Data Migration**:
- Fixed existing wines not appearing for OAuth users
- Root cause: Pre-OAuth wines (101 bottles) existed in legacy cellar (`00000000-0000-0000-0000-000000000001`), but OAuth signup created a new empty cellar for the user
- Resolution: Added user membership to legacy cellar and set it as active cellar via database update
- User now has access to both cellars via cellar switcher

**Backup Endpoint Authentication Fix**:
- Fixed 401 error on `/api/backup/info` endpoint
- Root cause: `settings.js` was using raw `fetch()` instead of the authenticated API wrapper
- Resolution: Added authenticated functions to `api.js`:
  - `getBackupInfo()` - Get backup metadata
  - `exportBackupJSON()` - Export JSON backup with blob download
  - `exportBackupCSV()` - Export CSV with blob download
- Updated `settings.js` to use these authenticated functions

**Regression Test for API Auth Headers**:
- Created `tests/unit/utils/apiAuthHeaders.test.js` to prevent future raw fetch() regressions
- Scans frontend JS files for patterns like `fetch('/api/...`
- Maintains `LEGACY_FILES` allowlist for pre-existing violations (2 files tracked)
- Fails if NEW files use raw `fetch()` to API endpoints instead of `api.js` functions
- All API calls should use exported functions from `api.js` which automatically include Authorization and X-Cellar-ID headers

**API Auth Migration (13 January 2026)**:
- Migrated all remaining frontend data endpoints to `api.js` wrappers (ratings, tasting service, settings, pairing, sommelier, bottles form)
- Added new API wrappers for ratings jobs, tasting notes, pairing feedback, backup import, and wine search status
- Reduced legacy raw fetch files to: `app.js` (public-config) and `browserTests.js` (test-only)
- Added optional-auth error logging endpoint `POST /api/errors/log` and wired `errorBoundary.js` to use `api.js`

**Phase 6: Wine Search Integration (15 January 2026)**:
- Added Phase 6 database migration `037_phase6_integration.sql` with fingerprint fields, external IDs, provenance ratings, wine search cache, and search metrics
- Added fingerprint backfill script `src/db/scripts/backfill_fingerprints.js` for collision reporting and optional nullification
- Implemented Phase 6 services: feature flags, wine search cache, orchestrator pipeline, and structured confidence helper
- Extended wine routes with duplicate checks, external ID management, Vivino URL setting, and ratings refresh backoff
- Added add-wine disambiguation modal and updated bottle form flow to prefer duplicates/matches before creating

**Phase 6 Files Modified**:
- `data/migrations/037_phase6_integration.sql` - New Phase 6 schema migration
- `src/db/scripts/backfill_fingerprints.js` - Fingerprint backfill + collision report
- `src/services/wineAddOrchestrator.js` - Unified add-wine pipeline
- `src/services/searchCache.js` - Wine search cache service
- `src/config/featureFlags.js` - Phase 6 feature toggles
- `src/routes/wines.js`, `src/routes/index.js`, `src/routes/search.js`, `src/routes/searchMetrics.js` - New endpoints + metrics persistence
- `src/services/wineFingerprint.js`, `src/services/structuredParsers.js` - Versioned fingerprinting + confidence helper
- `public/js/bottles/disambiguationModal.js`, `public/js/bottles/form.js` - Disambiguation flow and UI integration
- `public/js/api.js` - Duplicate check + external ID endpoints
- `public/css/styles.css` - Disambiguation modal styling
- `data/schema.postgres.sql` - Updated schema reference
- `tests/unit/services/wineFingerprint.test.js` - Updated for new normalization

**Files Modified**:
- `public/js/api.js` - Added backup export functions with blob downloads
- `public/js/settings.js` - Updated to use authenticated API functions
- `public/sw.js` - Bumped cache version from v64 to v65
- `tests/unit/utils/apiAuthHeaders.test.js` - NEW regression test
- `public/js/ratings.js`, `public/js/tastingService.js`, `public/js/modals.js`, `public/js/pairing.js`, `public/js/sommelier.js`, `public/js/bottles/form.js` - Migrated to api.js wrappers
- `public/js/errorBoundary.js` - Uses optional-auth error logging wrapper
- `src/routes/index.js` - Added optional-auth client error logging endpoint

---

### Wine Detail Panel Spec v2 - Tasting & Service Card - 10 January 2026
Implemented the consolidated Wine Detail Panel per the v2 specification, combining tasting notes, serving temperature, and drinking window into a unified "Tasting & Service" card with structured data and evidence indicators.

**New Files Created**:
- `data/migrations/019_structured_tasting_notes.sql` - Database schema for v2 notes
- `src/config/noiseTerms.js` - Food pairing and marketing hyperbole filters
- `src/services/vocabularyNormaliser.js` - Synonym maps, category maps, normalisation functions
- `src/services/tastingNotesV2.js` - V2 schema conversion, extraction, storage
- `src/routes/tastingNotes.js` - API endpoints per spec section 8
- `public/js/tastingService.js` - Frontend Tasting & Service card module
- `docs/Wine_Detail_Panel_Spec.md` - Full specification document

**Files Modified**:
- `src/routes/index.js` - Added tastingNotesRoutes import and registration
- `public/js/modals.js` - Updated to use consolidated card
- `public/index.html` - Added card container, hid legacy sections
- `public/css/styles.css` - Added ~300 lines for new components

**Key Features**:
1. **Style Fingerprint**: One-line summary (max 120 chars) describing wine character
2. **Structured Schema v2.0**: JSON format with wine type, descriptors, structure, evidence
3. **Vocabulary Normaliser v1.0.0**: 60+ synonyms, 100+ category mappings, structure scales
4. **Evidence System**: Strong/medium/weak based on source count and agreement score
5. **Contradiction Detection**: Flags conflicting structural values from different sources
6. **Noise Filtering**: Removes food pairing terms and marketing hyperbole from extraction
7. **Source Provenance**: Tracks extraction source, timestamp, confidence per descriptor

**Commit**: `6c9c042`

---

### Zone Reconfiguration Robustness - 9 January 2026
Fixed critical issues with AI-generated zone reconfiguration plans and improved post-reconfiguration UX:

**Problem Solved**: AI was suggesting row reallocations for rows that zones didn't actually own (e.g., "R10 is not assigned to rioja"), causing crashes when applying plans.

**Fixes Implemented**:

1. **Graceful Stale Plan Handling** (`src/routes/cellar.js`):
   - `reallocateRowTransactional()` now returns status object instead of throwing
   - Returns `{ success: false, skipped: true, reason: "..." }` for invalid rows
   - Apply endpoint continues with remaining actions instead of aborting
   - Tracks `actionsAutoSkipped` count in response

2. **Post-Reconfiguration Success Banner** (`zoneReconfigurationBanner.js`):
   - New `renderPostReconfigBanner()` function
   - Shows "Zone Reconfiguration Complete" (green success style) instead of "Zone Configuration Issues Detected"
   - Lists bottles that need to physically move: wine name → target zone (current slot)
   - Shows first 8 items, summarizes remaining
   - Hint to use "Suggested Moves" section for actual bottle moves

3. **Clearer AI Zone ID Instructions** (`zoneReconfigurationPlanner.js`):
   - Enhanced prompt to clarify zone IDs are strings like "curiosities", not numbers like "4"
   - Explicit examples and warnings about zone ID format
   - Added `actualAssignedRows` validation at plan generation time

4. **Two-Phase Process Clarification**:
   - Phase 1: Zone reconfiguration changes row ownership (which zones own which rows)
   - Phase 2: Suggested Moves physically relocates bottles to match new zone boundaries
   - Users now understand the distinction via improved UX messaging

**Commits**: `211381b`, `5416e82`, `9661553`

---

### GPT-5.2 AI Reviewer - 9 January 2026
Implemented a GPT-5.2 review layer to validate and patch AI-generated plans from Claude across three domains:

**Architecture**: Planner (Claude Opus 4.5) → Reviewer (GPT-5.2) → Validator (deterministic)

**Coverage**:
1. **Zone Reconfiguration** - Reviews cellar-wide restructuring plans
2. **Cellar Analysis** - Reviews AI-generated cellar organization advice
3. **Zone Capacity Advice** - Reviews recommendations for zone overflow situations

**New Files**:
- `src/services/openaiReviewer.js` - GPT-5.2 review service with Structured Outputs
- `src/routes/admin.js` - Telemetry endpoints for sommelier review
- `data/migrations/026_ai_review_telemetry.sql` - Telemetry table
- `docs/AI_REVIEWER_TEST_LOG.md` - Sommelier feedback log template

**Features**:
- **Structured Outputs**: Uses Zod schema with `responses.parse()` for guaranteed JSON compliance
- **Diff-like Patches**: Targeted field-level fixes with `action_id` (not full plan replacement)
- **Circuit Breaker**: 3-failure threshold, 5-minute auto-reset
- **Telemetry**: Comprehensive tracking (plan hashes, token usage, latency, stability score)
- **Sommelier Feedback Loop**: Rating and notes storage for quality assessment
- **Stability Score**: 0-1 metric measuring plan disruption (higher = less churn)
- **Configurable Timeout**: 120s default for complex reviews (env: `OPENAI_REVIEW_TIMEOUT_MS`)
- **Reasoning Effort**: Medium by default for quality/speed balance (env: `OPENAI_REVIEW_REASONING_EFFORT`)

**Integration Points**:
- `zoneReconfigurationPlanner.js` - Reviews zone reconfiguration plans
- `cellarAI.js` - Reviews cellar analysis advice
- `zoneCapacityAdvisor.js` - Reviews zone capacity recommendations

**Admin Endpoints**:
- `GET /api/admin/ai-reviews` - List recent reviews (supports `?pending=true` filter)
- `PATCH /api/admin/ai-reviews/:id/rating` - Add sommelier rating (1-5)

**Feature Flags** (set in Railway environment):
- `OPENAI_REVIEW_ZONE_RECONFIG=true` - Enable zone reconfiguration review
- `OPENAI_REVIEW_CELLAR_ANALYSIS=true` - Enable cellar analysis review
- `OPENAI_REVIEW_ZONE_CAPACITY=true` - Enable zone capacity review

---

### OpenAI SDK Integration - 9 January 2026
Added OpenAI SDK support for optional GPT model access:

- Installed `openai` and `zod` npm packages
- Added `OPENAI_API_KEY` environment variable support
- Enables GPT-5.2 reviewer for zone reconfiguration plans

---

### Self-Contained Test Infrastructure - 8 January 2026
Refactored test suite to eliminate manual server coordination:

**Problem Solved**: Integration tests required manually starting the dev server, leading to ECONNREFUSED failures and fragile VS Code task orchestration.

**Solution**:
- Vitest `globalSetup` in `tests/integration/setup.js` auto-spawns server before tests
- Server waits for `/health/live` to respond before tests run
- Server killed automatically after tests complete
- Graceful fallback: reuses existing server if already running

**New npm Scripts**:
- `npm run test:unit` - Fast unit tests only (~0.5s, no server)
- `npm run test:integration` - Integration tests with auto-managed server (~3s)
- `npm run test:all` - Both in sequence (recommended before commits)

**New Files**:
- `tests/integration/setup.js` - Server lifecycle management
- `tests/integration/vitest.config.js` - Integration-specific Vitest config

**Updated Documentation**:
- `AGENTS.md` and `CLAUDE.md` updated with new test commands
- "Do" checklist now includes running `npm run test:all` before commits

### Holistic Zone Reconfiguration Audit - 8 January 2026
Comprehensive audit verified all physical constraint enforcement claims:

**Verified Implementations**:
1. **Physical Constraint Constant**: `TOTAL_CELLAR_ROWS = 19` enforced in planner (7 references throughout codebase)
2. **Zone Utilization Tracking**: `buildZoneUtilization()` and `findUnderutilizedZones()` functions calculate row usage per zone
3. **AI Prompt Prohibitions**: Claude prompts explicitly state "DO NOT suggest expand_zone" and enforce working within fixed row count
4. **Heuristic Fallback**: When AI unavailable, conservative `reallocate_row` actions from underutilized to overflowing zones
5. **Transactional Row Moves**: `reallocateRowTransactional()` safely moves rows between zones with atomic updates
6. **UI Action Rendering**: Modal correctly displays "Reallocate Row X from Zone A → Zone B" for `reallocate_row` actions
7. **Plan Apply Endpoint**: Handles `reallocate_row` action type alongside legacy `merge_zones` and `retire_zone`

**Test Validation**: All 333 tests passing (312 unit + 21 integration)

---

### Zone Capacity AI Management - 8 January 2026
Implemented proactive AI-assisted zone management to prevent illogical overflow suggestions:

**Problem Solved**: When a zone fills up (e.g., Appassimento), the system was silently falling back to unrelated zones (e.g., Rioja), creating confusing organization suggestions.

**Solution Architecture**:
- **Detection**: `cellarAnalysis.js` tracks `zoneCapacityIssues` when wines can't be placed in their target zone
- **Alert UI**: `zoneCapacityAlert.js` displays prominent warning with affected wines list
- **AI Advisor**: `zoneCapacityAdvisor.js` sends zone context to Claude Opus for analysis
- **Action Execution**: Three action types (allocate_row, merge_zones, move_wine) with Apply buttons

**New Files**:
- `src/services/zoneCapacityAdvisor.js` - Claude integration with JSON schema validation
- `public/js/cellarAnalysis/zoneCapacityAlert.js` - Alert UI and action handlers

**New API Endpoints**:
- `POST /api/cellar/zone-capacity-advice` - Get AI recommendations
- `POST /api/cellar/zones/allocate-row` - Assign row to zone
- `POST /api/cellar/zones/merge` - Merge source zone into target

**Frontend API Functions** (`api.js`):
- `getZoneCapacityAdvice(payload)` - Request AI analysis
- `allocateZoneRow(zoneId)` - Execute row allocation
- `mergeZones(sourceZoneId, targetZoneId)` - Execute zone merge

**CSS Styles**: `.zone-capacity-alert`, `.zone-capacity-advice-panel`, `.zone-capacity-action` classes

**Buffer Zone Fix** (8 Jan - follow-up):
- Fixed bug where buffer zones (like `red_buffer`) would place wines in rows allocated to other zones
- When `enforceAffinity` is true, buffer zones now skip rows that are allocated to specific zones
- This prevents Appassimento wines from being suggested into Rioja-allocated rows just because they're both "red"
- Fix location: `cellarPlacement.js` line 297-316

**Holistic Zone Reconfiguration** (8 Jan - follow-up):
- Addresses "alert spam" when multiple zones overflow simultaneously
- Single grouped banner replaces 6+ individual alerts
- Two-path UX: Quick Fix (per-zone) vs Full Reconfiguration (cellar-wide)
- **Physical Constraint Enforcement** (8 Jan - critical fix):
  - Cellar has fixed 19-row limit - planner now works WITHIN this constraint
  - New action type: `reallocate_row` - moves rows between zones (not expand beyond limit)
  - AI prompt explicitly forbids adding rows beyond physical limit
  - Heuristic fallback also works within constraints
  - Red/white row allocation can flex for seasonality (more whites in summer, more reds in winter)
  - AI can suggest zone restructuring (geographic → style-based or vice versa)
- New files:
  - `src/services/zoneReconfigurationPlanner.js` - Claude-powered plan generation with physical constraints
  - `src/services/reconfigurationPlanStore.js` - In-memory plan storage with 15min TTL
  - `src/services/reconfigurationTables.js` - PostgreSQL tables for zone_pins and history
  - `src/services/zonePins.js` - Zone pin constraints (never_merge)
  - `public/js/cellarAnalysis/zoneReconfigurationBanner.js` - Grouped banner UI
  - `public/js/cellarAnalysis/zoneReconfigurationModal.js` - Plan preview modal (supports reallocate_row action)
- Helper functions in `cellar.js`:
  - `reallocateRowTransactional()` - moves a row from one zone to another safely
  - `getAffectedZoneIdsFromPlan()` - extracts zone IDs including from reallocate_row actions
- New API endpoints:
  - `POST /api/cellar/reconfiguration-plan` - Generate holistic plan
  - `POST /api/cellar/reconfiguration-plan/apply` - Apply plan with optional skips (supports reallocate_row)
- Database tables: `zone_pins`, `zone_reconfigurations`
- Trigger logic: ≥3 capacity alerts OR ≥10% misplacement rate

---

### Move Integrity & Data Protection - 7-8 January 2026
Critical fix for bottle loss bug during cellar reorganization moves:

**Root Cause**: Two moves with the same wine name could target the same slot, causing one bottle to be overwritten and lost.

**Swap Detection & Protection** ✨ NEW (8 Jan):
- Detects when moves involve swaps (Wine A→B while B→A) or dependencies (move targets occupied slot)
- Frontend calculates swap pairs and dependent moves directly from move data
- **Three action types**:
  - **Swap button**: For swap pairs - executes both moves atomically
  - **Move button**: For independent moves - executes single move
  - **🔒 Lock icon**: For dependent moves (target occupied by bottle being moved elsewhere)
- **Individual swap execution**: `executeSwap()` lets users execute swap pairs one at a time safely
- **Smart warnings**: Different messages for swaps ("Use Swap buttons") vs dependencies ("Execute all together")
- Bidirectional arrow (↔), SWAP badge, and swap partner info for swap moves
- Swap status re-calculated after each action (if dependencies resolve, buttons unlock)
- Applied to both cellar reorganization and fridge organization features

**Modular cellarAnalysis.js Refactoring** ✨ NEW (8 Jan):
- Split 1,699-line monolith into 8 focused modules (all <425 LOC)
- Pattern matches `bottles/` folder refactoring
- Modules: state.js, analysis.js, aiAdvice.js, moves.js, fridge.js, zones.js, zoneChat.js
- Entry point (`cellarAnalysis.js`) reduced to 99-line thin facade
- All functionality preserved, CSP-compliant event handlers maintained

**Validation System (`movePlanner.js`)**:
- `validateMovePlan()` function with 5 validation rules:
  1. Each wine can only be moved once (no duplicate wine IDs)
  2. Each target slot can only be used once (prevents collisions)
  3. Target must be empty OR will be vacated by another move in the plan
  4. Source must contain the expected wine (DB verification)
  5. No-op moves detection (from === to)
- Returns detailed errors with type, message, and context for each failure

**Allocated Target Tracking (`cellarAnalysis.js`)**:
- Added `allocatedTargets` Set to track slots already assigned during batch suggestion generation
- Prevents same slot from being suggested multiple times
- Combines with existing `pendingMoves` tracking for comprehensive collision prevention

**Atomic Move Execution (`cellar.js`)**:
- All moves wrapped in database transaction (BEGIN/COMMIT/ROLLBACK)
- Pre-execution validation rejects invalid plans before any changes
- Invalidates analysis cache only after successful completion
- Returns validation details in API response

**Database Constraint (`025_slot_uniqueness.sql`)**:
- Unique partial index: `idx_slots_wine_unique ON slots(wine_id) WHERE wine_id IS NOT NULL`
- Database-level guarantee that one wine can't be in multiple slots
- Complements application-level validation

**Frontend Validation UI (`cellarAnalysis.js`)**:
- Preview modal shows all bottles to be moved before execution
- Validation error modal with categorized errors by type
- Clear explanations and "Refresh suggestions" guidance

**Placement Recommendations (`cellarPlacement.js`)**:
- `recommendPlacement()` function for new bottle additions
- Combines zone matching with slot suggestion
- Returns comprehensive recommendation with alternatives and confidence

**Unit Tests (`movePlanner.test.js`)**:
- 18 comprehensive tests covering all validation rules
- Edge cases: empty arrays, single moves, missing data
- Complex scenarios: swaps, chains, multiple errors

**Files Modified**:
- `src/services/movePlanner.js` - Added `validateMovePlan()` function
- `src/services/cellarAnalysis.js` - Added `allocatedTargets` tracking
- `src/routes/cellar.js` - Added validation and transaction support
- `src/services/cellarPlacement.js` - Added `recommendPlacement()` function
- `public/js/cellarAnalysis.js` - Added preview and validation error modals
- `public/css/styles.css` - Modal styles
- `data/migrations/025_slot_uniqueness.sql` - Database constraint
- `tests/unit/services/movePlanner.test.js` - Full test suite

---

### Phase 8: Production Hardening - 6-7 January 2026
Comprehensive fixes for Express 5 compatibility, PostgreSQL async patterns, and production stability:

**Express 5 Compatibility Fixes**:
- **Path pattern fix**: Changed `/api/*` wildcard to middleware wrapper (path-to-regexp v8 incompatibility)
- **Query parameter handling**: Express 5 makes `req.query` getter-only; validation middleware now stores coerced values in `req.validated.query`
- **Zod coercion**: Updated `paginationSchema` to use `z.coerce.number()` for proper string→number conversion

**PostgreSQL Async/Await**:
- **Awards routes**: Added `async/await` to all 15 route handlers (PostgreSQL returns Promises, SQLite is synchronous)
- **Cellar routes**: Converted zone metadata endpoints to async/await (`/api/cellar/zones/:zoneId/intent`, etc.)
- **Pairing routes**: Converted zone metadata access in pairing service to async/await
- **Ratings routes**: Fixed async patterns in rating fetch endpoints
- **JobQueue service**: Converted all methods to async with proper PostgreSQL SQL syntax (`RETURNING *` vs SQLite's `lastInsertRowid`)
- **Database abstraction**: All `db.prepare().get/all()` calls now properly awaited throughout codebase

**Mobile Accessibility (Phase 8.11)**:
- **Text size setting**: Small/Medium/Large options in Settings with localStorage persistence
- **Touch targets**: Buttons and tabs now min-height 44px (WCAG 2.5.5 compliance)
- **iOS zoom prevention**: Form inputs use 16px font-size on mobile to prevent auto-zoom
- **Reduced motion**: `prefers-reduced-motion` media query support
- **Keyboard hint**: Hidden on mobile/touch devices
- **Focus visible**: Improved keyboard navigation styles

**Browser Test Suite** (46 tests passing):
- Health endpoints (3 tests)
- Metrics endpoint (8 tests)
- Pagination with numeric types (8 tests)
- Input validation (6 tests)
- Security headers (6 tests)
- Service worker v29 (4 tests)
- Event listener cleanup (3 tests)
- Error boundary (2 tests)

**Cache Management**:
- Service worker cache version v29
- Asset versioning `?v=20260106f` for cache busting
- Global search duplicate overlay prevention

### Railway + PostgreSQL Migration - 6 January 2026
- **Migrated from Fly.io to Railway**: Auto-deploy from GitHub, simpler deployment model
- **Database moved to Supabase PostgreSQL**: Replaced SQLite with cloud-hosted PostgreSQL
- **Database abstraction layer**: Auto-selects SQLite (local) or PostgreSQL (production)
- **Route handler updates**: All handlers converted to async/await for PostgreSQL compatibility
- **SQL syntax updates**: STRING_AGG, ILIKE, CURRENT_TIMESTAMP, INTERVAL syntax
- **Custom domain**: `cellar.creathyst.com` via Cloudflare CNAME to Railway
- **Removed legacy files**: fly.toml, deploy.ps1, sync-db.ps1, Synology-specific configs
- **Documentation updates**: CLAUDE.md, AGENTS.md, STATUS.md updated for new deployment

### UX & Bug Fixes - 5 January 2026
- **Direct Wine Swap**: Drag wine onto occupied slot → confirmation dialog → swap positions
- **Auto-Scroll During Drag**: Page scrolls automatically when dragging near viewport edges
- **Zone Classification Fix**: Fixed Portuguese wines being misclassified as "Dessert & Fortified"
  - Bug: `/port/` regex matched "Portugal", "Portuguese", "Porto"
  - Fix: Word-boundary regex patterns (`\bport\b`) to match only "Port" wine style
  - Affected wines: Coutada Velha Signature, Baia de Troia Castelao, R de Romaneira

### Deploy Script Improvements - 5 January 2026
- **SSH Key + Sudo Fix**: Deploy script now pipes password for sudo commands even when using SSH key authentication
- **Warning Filter**: Suppresses irrelevant SSH warnings (post-quantum, password prompt noise)

### SonarQube Code Quality Review - 7 January 2026
Comprehensive code quality audit addressing security, maintainability, and best practices:

**Security Fixes**:
- **SQL Injection Prevention**: Fixed string interpolation in ratings.js DELETE query → parameterized placeholders
- **CSP Hardening**: Removed `unsafe-inline` from script-src directive (all JS now external modules)
- **Race Condition Fix**: Added promise lock pattern to JobQueue to prevent concurrent job processing
- **Input Validation**: Added Zod schema validation to bottles.js with regex patterns for location codes
- **Rate Limiting**: Added 5 requests/hour limit to backup export endpoints

**Code Quality Improvements**:
- **Optional Chaining**: Converted `!obj || !obj.prop` patterns to `!obj?.prop` in slots.js
- **Number.parseInt**: Added explicit radix parameter to all parseInt calls in wines.js
- **String.replaceAll**: Modernized regex replace to replaceAll in backup.js CSV escaping
- **Unused Imports Cleanup**: Removed 17 unused imports across 10 files (cellarHealth.js, awards.js, wines.js, acquisitionWorkflow.js, drinkNowAI.js, movePlanner.js, pairingEngine.js, health.js, app.js)
- **Dead Code Removal**: Removed useless `dbStatus = 'unknown'` assignment in health.js
- **Exception Handling**: Improved catch blocks in awards.js with descriptive comments

**Files Modified**:
- `src/routes/ratings.js` - SQL injection fix
- `src/routes/slots.js` - Optional chaining (4 locations)
- `src/routes/wines.js` - Number.parseInt, exception handling
- `src/routes/backup.js` - Rate limiting, replaceAll, logging
- `src/routes/bottles.js` - Zod validation, grid constants
- `src/routes/health.js` - Dead code removal, catch syntax
- `src/middleware/csp.js` - Removed unsafe-inline
- `src/services/jobQueue.js` - Race condition fix
- `src/services/awards.js` - Exception handling, unused import
- `src/services/cellarHealth.js` - Unused imports
- `src/services/acquisitionWorkflow.js` - Unused imports
- `src/services/drinkNowAI.js` - Unused imports
- `src/services/movePlanner.js` - Unused imports
- `src/services/pairingEngine.js` - Unused imports
- `public/js/app.js` - Unused imports

**ESLint Status**: 0 errors, 0 warnings (clean)

### User Test Issues - 7 January 2026
All 7 issues from user testing resolved:

**Phase 1 - Issue 7: Mobile Scroll vs Drag (DONE)**
- Added long-press (500ms) to initiate drag on mobile
- Normal touch allows scroll; only long-press starts drag
- Added `drag-pending` CSS animation for visual feedback

**Phase 2a - Issue 5: Cache Analysis Results (DONE)**
- Created `cellar_analysis_cache` table (migration 021)
- Cache-first strategy with slot hash invalidation
- "Cached Xm ago" status display in UI

**Phase 2b - Issue 2: Reduce-Now Prioritization (DONE)**
- Wines in reduce-now list get +150 score bonus for fridge suggestions
- Added `isReduceNow` flag to fridge candidates

**Phase 3a - Issue 4: Open Bottle Tracking (DONE)**
- Created migration 022 for `is_open`, `opened_at` columns
- API endpoints: PUT /api/slots/:location/open, /seal, GET /open
- Gold border visual indicator with 🍷 icon
- "Mark Open/Sealed" toggle in bottle modal

**Phase 3b - Issue 6: Fridge Zone Categorization (DONE)**
- "Organize Fridge" button groups wines by category (temperature order)
- API: GET /api/cellar/fridge-organize
- Execute individual moves or batch reorganization

**Phase 3c - Issue 3: Zoom/Pan Viewing Mode (DONE)**
- Pinch-to-zoom gesture support (50%-200%)
- Pan gestures when zoomed in
- Zoom controls (+, -, reset) in cellar header
- Ctrl+scroll wheel zoom for desktop
- Zoom level persisted in localStorage

### CSP Event Handler Audit - 7 January 2026
Discovered and fixed silent failures caused by CSP blocking inline event handlers.

**Root Cause**: CSP `script-src 'self'` blocks inline `onclick="..."` handlers without visible errors.

**Files Refactored**:
- `public/js/cellarAnalysis.js` - 12 inline onclick handlers → addEventListener
- `public/js/errorBoundary.js` - 1 inline onclick handler → addEventListener
- `public/js/recommendations.js` - 1 inline onclick handler → addEventListener
- `public/js/bottles/wineConfirmation.js` - 1 inline onerror handler → addEventListener
- `public/index.html` - 4 inline handlers in Zone Chat UI → wired in JS

**Prevention**:
- Added regression test: `tests/unit/utils/cspInlineHandlers.test.js`
- Test scans all `public/` files for `on*="..."` patterns and `javascript:` URLs
- Fails build if inline handlers are reintroduced
- Audit guide: `docs/EVENT_HANDLER_AUDIT.md`

### Pairing Feedback & User Profile - 7 January 2026
Implemented comprehensive feedback loop for wine pairing recommendations:

**Database Migrations**:
- `023_pairing_sessions.sql` - Tracks every pairing interaction (dish, recommendations, user choice, feedback)
- `024_user_taste_profile.sql` - Derived user preferences (colours, styles, regions, failure patterns)

**Backend**:
- `src/services/pairingSession.js` - Session persistence, choice recording, feedback collection
- API endpoints: `/api/pairing/sessions/:id/choose`, `/api/pairing/sessions/:id/feedback`
- `sessionId` returned from sommelier recommendations for tracking
- Failure reasons vocabulary (12 controlled terms)

**Frontend**:
- "Choose This Wine" button on recommendation cards
- Feedback modal with rating slider (1-5) and "would pair again" toggle
- Failure reasons checkboxes (shown when rating ≤ 2.5)
- Modal triggered after wine selection

**Data Flow**:
1. User requests pairing → session saved with dish, signals, recommendations
2. User clicks "Choose This Wine" → choice recorded with rank
3. Feedback modal → rating and failure reasons stored
4. Future: Profile recalculation from accumulated feedback

### Security & Code Quality - January 2026
- **CSP Headers**: Content Security Policy middleware with production/dev modes
- **Rate Limiting**: In-memory rate limiter (100 req/15min general, 10 req/1min for AI)
- **Error Boundary**: Global frontend error handling with user-friendly toasts
- **Database Transactions**: Atomic operations for slot moves, swaps, and bottle additions
- **Prepared Statement Cache**: Reusable queries for common database operations
- **ESLint Cleanup**: Fixed all 25 lint warnings (unused variables, prefer-const)
- **Integration Tests**: API endpoint tests for wines, slots, pairing, rate limiting

### Deployment Automation - January 2026
- **Deploy Script**: `.\scripts\deploy.ps1` with pre-flight checks
  - Runs ESLint before deployment
  - Runs tests if configured
  - Prompts for uncommitted changes
  - Git push → SSH pull → Docker build/up
  - Verifies container and tests API
- **Options**: `-Quick` (fast deploy), `-SkipTests`, `-Logs`

### Custom Domain Setup - January 2026
- **Custom Domain**: `https://cellar.creathyst.com` for PWA installation
- **Architecture**: Browser → Cloudflare DNS → Railway app
- **Setup**: CNAME record pointing to Railway app
- **Note**: Replaced previous Cloudflare Tunnel setup with direct Railway deployment

### MCP Integration - January 2026
- Puppeteer MCP for Vivino/Decanter scraping with full JS rendering
- PDF Reader MCP for fast text extraction (5-10x faster than OCR)
- SQLite MCP for direct database queries
- Award Extractor Skill for structured PDF processing
- Centralized scraper configuration (`src/config/scraperConfig.js`)
- DRY refactoring of timeout management and cookie consent handling

### Progressive Web App (PWA) - January 2025
- Service worker with offline support
- Manifest with app metadata and icons
- Icon generation script (72px - 512px + maskable)
- Installable on all platforms
- Railway cloud deployment with custom domain

### Testing Infrastructure - January 2025
- Vitest test framework with 270 passing tests
- 85% service coverage, 60% route coverage
- Unit tests for all core services
- Integration tests for API endpoints
- CSP compliance regression test (scans public/ for inline handlers)
- Continuous testing in development

### Data Provenance System - January 2025
- Track origin of all external data with timestamps
- SHA256 content hashing for audit trail
- Expiration and confidence tracking
- Scraping governance layer with rate limiting and circuit breaker

### AI Enhancements - January 2025
- Drink-now AI recommendations with Claude
- Structured tasting profiles extraction
- Controlled vocabulary (170+ terms)
- Deterministic fallback when AI unavailable
- Context-aware suggestions

### Performance Optimizations - January 2025
- FTS5 full-text search (sub-millisecond queries)
- Virtual list rendering for 1000+ items (60fps scrolling)
- Modular bottles.js (1206 LOC → 8 modules, all <380 LOC)
- 15+ strategic database indexes

### UX Improvements - January 2025
- Global search (Cmd/Ctrl+K shortcut)
- Accessibility enhancements (ARIA, focus trapping, keyboard nav)
- Backup/restore functionality (JSON/CSV export)
- Recommendations panel with AI suggestions

### Awards Database System - December 2024
- Separate SQLite database for shareable award data
- PDF import with OCR (local RolmOCR + Claude Vision fallback)
- Chunked extraction with retry logic
- Partial JSON salvaging for robustness

### Decanter Integration Enhancement - December 2024
- Correct authenticated search URL format
- Tasting notes extraction from reviews
- Score and drink window extraction
- JSON-based data parsing from embedded page data

### Database Performance - December 2024
- 15+ strategic indexes added
- N+1 query optimizations
- Composite indexes for common queries
- WAL mode for concurrent access

### Dynamic Cellar Clustering - December 2024
- 40+ wine zone definitions
- Intelligent zone-to-row allocation
- Overflow handling between zones
- AI-powered reorganization suggestions

### Foreign Key Enforcement
- Added `PRAGMA foreign_keys = ON` to both databases
- Improved referential integrity

---

## Code Quality

### Architecture Principles
- Single Responsibility per module
- Separation of concerns (routes → services → config → db)
- ES6 modules throughout
- Consistent naming conventions (camelCase functions, snake_case DB)
- SOLID principles adherence

### Documentation
- JSDoc for exported functions
- File headers with @fileoverview
- Inline comments for complex logic
- Comprehensive AGENTS.md coding standards
- Test coverage documentation

### Code Metrics
- ~45 backend JavaScript modules
- ~20 frontend JavaScript modules
- ~15,000 lines of code
- 270 unit tests (85% service coverage)
- 15 database migrations

---

## Known Limitations

### Not Yet Implemented
- Wine confirmation modal (Vivino search before save - P2)
- Barcode scanning (P4)
- Multi-user authentication (P4)
- Cloud sync/real-time collaboration

### Technical Debt (Low Priority)
- Frontend event listener cleanup functions (optional improvement)
- Some routes could benefit from additional error handling edge cases

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `OPENAI_API_KEY` | No | OpenAI API key (for GPT-5.2 reviewer) |
| `OPENAI_REVIEW_ZONE_RECONFIG` | No | Enable GPT-5.2 zone reconfig reviewer |
| `OPENAI_REVIEW_CELLAR_ANALYSIS` | No | Enable GPT-5.2 cellar analysis reviewer |
| `OPENAI_REVIEW_ZONE_CAPACITY` | No | Enable GPT-5.2 zone capacity reviewer |
| `OPENAI_REVIEW_MODEL` | No | Override default reviewer model (default: gpt-5.2) |
| `OPENAI_REVIEW_MAX_OUTPUT_TOKENS` | No | Max tokens for reviewer output (default: 1500) |
| `OPENAI_REVIEW_REASONING_EFFORT` | No | Reasoning effort: low/medium/high (default: medium) |
| `OPENAI_REVIEW_TIMEOUT_MS` | No | Reviewer timeout in ms (default: 120000) |
| `GOOGLE_SEARCH_API_KEY` | No | Google Custom Search |
| `GOOGLE_SEARCH_ENGINE_ID` | No | Search engine ID |
| `BRIGHTDATA_API_KEY` | No | BrightData scraping |
| `BRIGHTDATA_SERP_ZONE` | No | BrightData SERP zone |
| `BRIGHTDATA_WEB_ZONE` | No | Web Unlocker zone |
| `CREDENTIAL_ENCRYPTION_KEY` | No | Credential storage key |
| `PORT` | No | Server port (default: 3000) |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Vanilla JS)                     │
│  PWA with Service Worker + Offline Support                  │
│  app.js → api.js → {grid, modals, bottles, ratings,         │
│                     pairing, recommendations, search}.js     │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────────────┐
│                  EXPRESS.JS SERVER (Railway)                 │
├──────────────────────────────────────────────────────────────┤
│  routes/           services/           config/               │
│  ├─ wines.js       ├─ claude.js        ├─ unifiedSources.js │
│  ├─ ratings.js     ├─ ratings.js       ├─ cellarZones.js    │
│  ├─ cellar.js      ├─ awards.js        ├─ tastingVocabulary │
│  ├─ pairing.js     ├─ searchProviders                     │
│  ├─ awards.js      ├─ drinkNowAI.js    ├─ pairingRules.js   │
│  ├─ backup.js      ├─ tastingExtractor └─ vintageSensitivity│
│  └─ settings.js    ├─ provenance.js                         │
│                    ├─ zoneMetadata.js                       │
│                    ├─ zoneChat.js                           │
│                    ├─ pairingEngine.js                      │
│                    ├─ fridgeStocking.js                     │
│                    ├─ inputSanitizer.js                     │
│                    ├─ cacheService.js                       │
│                    └─ jobQueue.js                           │
└──────────────────────┬──────────────────────────────────────┘
                       │ SQL (async/await)
┌──────────────────────▼──────────────────────────────────────┐
│       PostgreSQL (Supabase) + Full-Text Search              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Production Database (Supabase)                      │    │
│  │  ├─ wines              ├─ zone_metadata             │    │
│  │  ├─ slots              ├─ pairing_rules             │    │
│  │  ├─ wine_ratings       ├─ competition_awards        │    │
│  │  ├─ drinking_windows   ├─ award_sources             │    │
│  │  ├─ data_provenance    ├─ known_competitions        │    │
│  │  ├─ search_cache       └─ job_queue                 │    │
│  │  └─ user_settings                                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Database Abstraction Layer: src/db/index.js                │
│  - Auto-selects SQLite (local) or PostgreSQL (production)   │
│  - Unified prepare().get/all/run() interface                │
└─────────────────────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ Claude API   │ │ Google   │ │ BrightData   │
│ (Anthropic)  │ │ Search   │ │ (Scraping)   │
└──────────────┘ └──────────┘ └──────────────┘
                       │
                       ▼
            ┌──────────────────┐
            │ Railway + HTTPS  │
            │ cellar.creathyst │
            │     .com         │
            └──────────────────┘
```

---

## Next Steps

See [ROADMAP.md](ROADMAP.md) for future features and improvements.

**Current Status**: All major development phases complete. Production-ready PWA deployed on Railway + Supabase PostgreSQL.

### Completed Phases:
- ✅ **Phase 1**: Testing infrastructure, unified configs, provenance, governance
- ✅ **Phase 2**: FTS5 search, virtual lists, modular bottles.js
- ✅ **Phase 3**: Global search, accessibility, backup/restore
- ✅ **Phase 4**: AI drink recommendations, structured tasting profiles
- ✅ **Phase 5**: PWA with Railway HTTPS deployment
- ✅ **Phase 6**: MCP Integration (Puppeteer, PDF Reader, SQLite, Skills)
- ✅ **Phase 7**: Sommelier-Grade Cellar Organisation
  - Zone intent metadata (DB) with AI-suggested, user-editable descriptions
  - Storage-aware drinking windows (cellar vs fridge aging rates)
  - Zone health analysis and chat
  - Hybrid pairing engine (deterministic shortlist + AI explanation)
  - Fridge stocking service with zone par-levels
  - Input sanitization for AI chat
- ✅ **Phase 8**: Production hardening
  - Express 5 compatibility fixes
  - PostgreSQL async/await conversion throughout codebase
  - Browser test suite (46 tests)
  - Mobile accessibility (touch targets, text sizing)
  - Validation middleware with Zod schemas

### Future Work (When Needed):
- Wine confirmation modal (Vivino search before save)
- Play Store wrapper (TWA) for public release
- Multi-user authentication
- Barcode scanning

---

## Git History (Recent Commits)

```
[Recent commits showing PWA, testing, provenance, and governance implementations]
```

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| **Backend Modules** | 45+ |
| **Frontend Modules** | 27+ |
| **Database Tables** | 12 (across 2 DBs) |
| **API Endpoints** | 50+ |
| **Rating Sources** | 50+ |
| **Cellar Zones** | 40+ |
| **Database Migrations** | 38 |
| **Unit Tests** | 333 |
| **Browser Tests** | 46 |
| **Test Coverage** | ~85% services, ~60% routes |
| **Lines of Code** | ~15,000+ |
| **Tasting Vocabulary Terms** | 170+ |
| **Performance Indexes** | 15+ |
| **MCP Servers** | 4 (PDF Reader, Filesystem, Memory, Bright Data) |
| **Claude Code Skills** | 4 (Award Extractor, Wine Importer, Cellar Health, DB Migrator) |
| **Service Worker Version** | v65 |

---

*Last updated: 13 January 2026*
*Version: 4.4 (MCP Integration - PDF Reader, Filesystem, Memory, Bright Data + 4 Skills)*
