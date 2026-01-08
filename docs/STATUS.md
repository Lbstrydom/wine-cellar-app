# Wine Cellar App - Status Report
## 7 January 2026

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
- Dynamic cellar zone clustering with 40+ wine categories
- Automated award database with PDF import
- Secure HTTPS access via custom domain
- Comprehensive testing infrastructure (249 tests, 85% coverage)
- Full-text search with PostgreSQL
- Virtual list rendering for 1000+ bottle collections

---

## Technical Stack

| Component | Technology | Version |
|-----------|------------|---------|
| **Backend** | Node.js + Express | 5.2.1 |
| **Database** | PostgreSQL (Supabase) | 15+ |
| **AI** | Claude API (Anthropic SDK) | 0.71.2 |
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

### 2. Testing Infrastructure ✨ NEW

**Test Framework**: Vitest (native ESM support, fast execution)

**Coverage Stats**:
- **249 tests passing**
- **~85% coverage on services**
- **~60% coverage on routes**
- **~70% coverage on config**

**Test Categories**:
- **Service layer tests**: ratings, parsing, search providers, AI services
- **Configuration validation**: score formats, sources, vocabulary
- **API integration tests**: endpoint testing with mock DB
- **Database query tests**: SQL query validation

**Test Files**:
```
tests/unit/
├── services/
│   ├── ratings.test.js           # Score normalization & aggregation
│   ├── wineNameParser.test.js    # Producer/vintage extraction
│   ├── searchProviders.test.js   # Multi-provider search logic
│   ├── drinkNowAI.test.js        # AI recommendations
│   ├── tastingExtractor.test.js  # Structured tasting profiles
│   └── provenance.test.js        # Data provenance tracking
├── config/
│   ├── scoreFormats.test.js      # Score conversion accuracy
│   ├── unifiedSources.test.js    # Source configuration validation
│   └── tastingVocabulary.test.js # Controlled vocabulary
└── routes/
    ├── wines.test.js             # Wine CRUD endpoints
    └── ratings.test.js           # Rating fetch endpoints
```

**Running Tests**:
```bash
npm test                    # Run all tests
npm run test:coverage       # Generate coverage report
npm run test:watch          # Watch mode for development
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
- Merged `ratingSources.js` and `sourceRegistry.js` → no duplication
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

### 9. Structured Tasting Profiles ✨ NEW

**Why**: Transform prose tasting notes into searchable, filterable structured data without storing verbatim text.

**Structured Profile Schema**:
```javascript
{
  "nose": {
    "primary_fruit": ["dark_berry", "black_cherry", "plum"],
    "secondary": ["vanilla", "oak", "toast"],
    "tertiary": ["leather", "tobacco", "earth"],
    "intensity": "pronounced"
  },
  "palate": {
    "sweetness": "dry",
    "body": "full",
    "acidity": "medium",
    "tannin": "high",
    "alcohol": "medium",
    "texture": ["velvety", "grippy"]
  },
  "finish": {
    "length": "long",
    "notes": ["spice", "dark_fruit", "mineral"]
  },
  "style_tags": ["full_bodied", "oaked", "age_worthy"],
  "summary_bullets": [
    "Full-bodied with ripe dark fruit",
    "Integrated oak and spice notes",
    "Firm tannins, long finish"
  ]
}
```

**Controlled Vocabulary**:
- 170+ standardized tasting terms
- Categories: fruit, oak, floral, herbal, spice, earthy, savory
- Consistent across all wines
- Enables filtering ("show me wines with black cherry notes")

**AI Extraction**:
- Claude extracts structured descriptors from prose notes
- Deterministic fallback using keyword matching
- No verbatim storage (copyright-friendly)
- Summary bullets provide human-readable highlights

**Database**:
- `tasting_profile_json` column in wines table
- `tasting_summary_bullets` for quick display
- FTS5 indexing for searchable descriptors

**Service**: `src/services/tastingExtractor.js`
**Config**: `src/config/tastingVocabulary.js`

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

### 13. MCP Integration ✨ NEW

**Model Context Protocol (MCP)** servers extend Claude Code's capabilities with specialized tools.

**Configured MCP Servers**:

| Server | Package | Purpose |
|--------|---------|---------|
| **puppeteer** | `puppeteer-mcp-server` | Headless browser for JS-rendered sites (Vivino, Decanter) |
| **pdf-reader** | `@sylphx/pdf-reader-mcp` | Fast PDF text extraction (5-10x faster than OCR) |
| **sqlite** | `mcp-sqlite` | Direct database queries for analytics |

**Configuration File**: `.mcp.json`

**Puppeteer MCP Features**:
- `puppeteer_navigate` - Navigate to URLs
- `puppeteer_click` - Click elements
- `puppeteer_evaluate` - Execute JavaScript in page context
- `puppeteer_screenshot` - Capture page screenshots
- Cookie consent auto-handling

**PDF Reader MCP Features**:
- Direct text extraction from PDFs
- Parallel processing for speed
- No OCR needed for text-based PDFs
- Page range selection

**SQLite MCP Features**:
- Execute arbitrary SQL queries
- Schema introspection
- Direct access to cellar.db and awards.db

**Skills Created**:

| Skill | Location | Purpose |
|-------|----------|---------|
| **award-extractor** | `.claude/skills/award-extractor/SKILL.md` | Structured extraction of wine awards from PDFs |

**Award Extractor Skill**:
- Recognizes IWSC, Decanter, Tim Atkin, Platter's formats
- Extracts: wine_name, producer, vintage, medal, score, category
- Validates data and checks for duplicates
- Imports directly to awards.db via SQLite MCP

**Files**:
- `.mcp.json` - MCP server configuration
- `src/services/puppeteerScraper.js` - Puppeteer MCP wrapper
- `src/config/scraperConfig.js` - Scraping constants
- `.claude/skills/award-extractor/SKILL.md` - Award extraction skill

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
| `sourceRegistry.js` | Derived from unified sources |
| `cellarZones.js` | 40+ zone definitions |
| `scoreFormats.js` | Score normalization rules |
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

### Move Integrity & Data Protection - 7-8 January 2026
Critical fix for bottle loss bug during cellar reorganization moves:

**Root Cause**: Two moves with the same wine name could target the same slot, causing one bottle to be overwritten and lost.

**Swap Detection & Protection** ✨ NEW (8 Jan):
- Detects when moves involve swaps (Wine A→B while B→A)
- Swap moves must be executed as a batch to prevent data loss
- `hasSwaps` / `mustExecuteAsBatch` flags communicate swap status to frontend
- Individual move buttons show 🔒 when swaps detected - forces batch execution
- Swap status re-calculated after each move/dismiss (if one swap completes, remaining may unlock)
- Applied to both cellar reorganization and fridge organization features
- **Individual swap marking**: Each swap move includes `isSwap`, `swapWith`, `swapPartnerWineName`
- **UI clarity**: Swap moves display bidirectional arrow (↔), SWAP badge, and swap partner info
- Warning shows count: "X swap(s) detected. Plus Y regular move(s)."

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
│  ├─ cellar.js      ├─ awards.js        ├─ scoreFormats.js   │
│  ├─ pairing.js     ├─ searchProviders  ├─ tastingVocabulary │
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
| **Database Migrations** | 25 |
| **Unit Tests** | 249 |
| **Browser Tests** | 46 |
| **Test Coverage** | ~85% services, ~60% routes |
| **Lines of Code** | ~15,000+ |
| **Tasting Vocabulary Terms** | 170+ |
| **Performance Indexes** | 15+ |
| **MCP Servers** | 3 (Puppeteer, PDF Reader, SQLite) |
| **Claude Code Skills** | 1 (Award Extractor) |
| **Service Worker Version** | v48 |

---

*Last updated: 8 January 2026*
*Version: 4.0 (All Phases Complete - Production Ready)*
