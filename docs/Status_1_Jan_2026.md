# Wine Cellar App - Status Report
## 1 January 2026

---

## Executive Summary

The Wine Cellar App is a personal wine collection management system built for deployment on Synology NAS. It combines traditional inventory management with AI-powered features including natural language pairing recommendations, automated rating aggregation from 40+ sources, and intelligent cellar organization suggestions.

**Current State**: Fully functional for personal use with production deployment on Synology NAS.

**Key Differentiators**:
- Multi-source rating aggregation (competitions, critics, community)
- Claude AI integration for pairing, parsing, and cellar advice
- Dynamic cellar zone clustering with 40+ wine categories
- Automated award database with PDF/OCR import

---

## Technical Stack

| Component | Technology | Version |
|-----------|------------|---------|
| **Backend** | Node.js + Express | 5.2.1 |
| **Database** | SQLite (libsql) | 0.5.22 |
| **AI** | Claude API (Anthropic SDK) | 0.71.2 |
| **Frontend** | Vanilla JavaScript (ES6 Modules) | - |
| **Deployment** | Docker on Synology NAS | - |

### Dependencies

```json
{
  "express": "^5.2.1",
  "@anthropic-ai/sdk": "^0.71.2",
  "libsql": "^0.5.22",
  "multer": "^2.0.2",
  "cors": "^2.8.5",
  "dotenv": "^17.2.3"
}
```

---

## Features Implemented

### 1. Cellar Grid Management

**Physical Layout**:
- 19-row cellar grid (7-9 columns per row, ~160 slots)
- 9-slot linear fridge section
- Dynamic zone labeling with color coding
- Row-based zone allocation with overflow handling

**Interactions**:
- Drag-and-drop bottle movement between slots
- 3-way swap when target slot is occupied
- Consecutive slot filling for bulk additions
- Visual zone allocation indicators
- Mobile-responsive horizontal scrolling

**Zone System** (40+ categories):
- Varietal-based: Sauvignon Blanc, Chardonnay, Riesling, Pinot Noir, etc.
- Region-based: Burgundy, Bordeaux, Tuscany, Rioja, etc.
- Style-based: Light whites, Full-bodied reds, Sparkling, Dessert
- Colour groupings: Red, White, Rosé, Sparkling

---

### 2. Wine Inventory Management

**Wine List View**:
- Filterable by: reduce-now status, colour, style
- Sortable by: name, colour, style, vintage, rating, price
- Search with autocomplete
- Bottle count per wine
- Location tracking across cellar/fridge

**Wine Detail Modal**:
- Basic info (name, vintage, producer, country, style, colour)
- Tasting notes from external sources
- Purchase score (0-100) and star rating (0-5)
- Drinking window (from/peak/until years)
- Individual ratings from multiple sources
- Local awards from awards database

**Wine Add/Edit**:
- Quantity selection with slot picker
- Text parsing via Claude (paste any wine description)
- Country/region inference from style
- Automatic drinking window defaults from vintage

---

### 3. Rating Aggregation System

**Multi-Source Architecture**:
- 40+ rating sources configured with metadata
- Three rating "lenses": Competition, Critics, Community
- Source credibility weighting (0.0-1.0)
- Aggregator discount for second-hand ratings

**Rating Sources by Category**:

| Category | Sources |
|----------|---------|
| **Competitions** | Decanter World Wine Awards, IWC, IWSC, Concours Mondial de Bruxelles, Mundus Vini, Veritas, Old Mutual Trophy, San Francisco Chronicle |
| **Critics** | Jancis Robinson, Robert Parker, Wine Spectator, Wine Enthusiast, Tim Atkin, James Halliday, Gambero Rosso, Falstaff, Guía Peñín |
| **Community** | Vivino, CellarTracker, Wine-Searcher |

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

### 4. AI Sommelier (Claude-Powered Pairing)

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

### 5. Reduce-Now Priority List

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

### 6. Cellar Analysis & Organization

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

### 7. Awards Database

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

### 8. Drinking Windows

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

### 9. Consumption History

**Logged Data**:
- Date consumed
- Occasion notes
- Food pairing
- Personal rating
- Tasting notes

**History View**:
- Paginated list
- Date filtering
- Wine linking for reference
- Export capability (planned)

---

### 10. User Settings

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
| POST | `/api/slots/swap` | Swap bottles |
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
| POST | `/api/cellar/analyse` | Analyze placements |
| POST | `/api/cellar/execute-moves` | Execute moves |

### Awards
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/awards/sources` | List import sources |
| POST | `/api/awards/import/pdf` | Import from PDF |
| POST | `/api/awards/import/text` | Import from text |
| POST | `/api/awards/match` | Match to wines |

---

## Database Schema

### Main Database (`cellar.db`)

**Core Tables**:
- `wines` - Master wine inventory
- `slots` - Physical storage locations
- `wine_ratings` - Individual ratings from sources
- `drinking_windows` - Drinking window data
- `reduce_now` - Priority list entries
- `consumption_log` - Consumption history
- `user_settings` - User preferences
- `pairing_rules` - Food-to-wine mappings

**Indexes** (15+ for performance):
- Wine lookups by ID, name, style, vintage
- Rating lookups by wine, source, lens
- Slot lookups by zone and wine

### Awards Database (`awards.db`)

- `award_sources` - Import source metadata
- `competition_awards` - Individual award records
- `known_competitions` - Competition registry

---

## Frontend Architecture

**Module Structure**:
```
public/js/
├── app.js           # State management, initialization
├── api.js           # Backend API wrapper
├── grid.js          # Cellar/fridge rendering
├── dragdrop.js      # Drag-and-drop interactions
├── modals.js        # Modal dialog management
├── bottles.js       # Add/edit bottle workflow
├── sommelier.js     # AI pairing interface
├── ratings.js       # Rating display/fetch
├── settings.js      # User preferences UI
├── cellarAnalysis.js # Organization advice
└── utils.js         # Shared utilities
```

**CSS Architecture**:
- CSS variables for theming
- Dark mode by default
- Responsive breakpoints (mobile-friendly)
- Zone color coding system
- Priority indicator styling

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
| `cacheService.js` | Search result caching |
| `jobQueue.js` | Async job processing |

**Configuration Layer** (`src/config/`):

| Config | Purpose |
|--------|---------|
| `ratingSources.js` | 50+ source definitions |
| `sourceRegistry.js` | Search templates, credibility |
| `cellarZones.js` | 40+ zone definitions |
| `scoreFormats.js` | Score normalization rules |

---

## Deployment

### Docker Configuration

```dockerfile
# Multi-stage build, Node.js 20 Alpine
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --only=production
EXPOSE 3000
CMD ["node", "src/server.js"]
```

### Synology NAS

**Target**: `192.168.86.31:3000`

**Deployment Scripts**:
- `scripts/deploy.ps1` - Full deployment
- `scripts/sync-db.ps1` - Database sync
- `scripts/setup-ssh-key.ps1` - SSH key setup

**Key Paths**:
- App: `~/Apps/wine-cellar-app/`
- Database: `~/Apps/wine-cellar-app/data/cellar.db`
- Awards: `~/Apps/wine-cellar-app/data/awards.db`

---

## Recent Development (December 2024 - January 2025)

### Awards Database System
- Separate SQLite database for shareable award data
- PDF import with OCR (local RolmOCR + Claude Vision fallback)
- Chunked extraction with retry logic
- Partial JSON salvaging for robustness

### Decanter Integration Enhancement
- Correct authenticated search URL format
- Tasting notes extraction from reviews
- Score and drink window extraction
- JSON-based data parsing from embedded page data

### Database Performance
- 15+ strategic indexes added
- N+1 query optimizations
- Composite indexes for common queries
- WAL mode for concurrent access

### Dynamic Cellar Clustering
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

### Documentation
- JSDoc for exported functions
- File headers with @fileoverview
- Inline comments for complex logic
- Comprehensive CLAUDE.md coding standards

### Code Metrics
- ~38 backend JavaScript modules
- ~11 frontend JavaScript modules
- ~2,000 lines route/service logic
- 12 database migrations

---

## Known Limitations

### Not Yet Implemented
- Automated test suite
- Image/label recognition (placeholder exists)
- Mobile native app (web-only)
- Cloud sync/multi-user
- Real-time collaboration
- Barcode scanning

### Technical Debt
- `bottles.js` is 1,205 lines (needs refactoring)
- Rating source configs duplicated across 2 files
- No data provenance tracking
- No rate limiting on API endpoints
- No circuit breaker for external APIs

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
│  app.js → api.js → {grid,modals,bottles,ratings,pairing}.js │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────────────┐
│                  EXPRESS.JS SERVER                           │
├──────────────────────────────────────────────────────────────┤
│  routes/           services/           config/               │
│  ├─ wines.js       ├─ claude.js        ├─ ratingSources.js  │
│  ├─ ratings.js     ├─ ratings.js       ├─ sourceRegistry.js │
│  ├─ cellar.js      ├─ awards.js        ├─ cellarZones.js    │
│  ├─ pairing.js     ├─ searchProviders  ├─ scoreFormats.js   │
│  ├─ awards.js      ├─ cacheService.js  └─ vintageSensitivity│
│  └─ settings.js    └─ jobQueue.js                           │
└──────────────────────┬──────────────────────────────────────┘
                       │ SQL
┌──────────────────────▼──────────────────────────────────────┐
│               SQLite (libsql) WAL Mode                       │
│  ┌────────────────────┐    ┌────────────────────┐           │
│  │  cellar.db         │    │  awards.db         │           │
│  │  ├─ wines          │    │  ├─ award_sources  │           │
│  │  ├─ slots          │    │  ├─ competition_   │           │
│  │  ├─ wine_ratings   │    │  │  awards         │           │
│  │  ├─ drinking_      │    │  └─ known_         │           │
│  │  │  windows        │    │     competitions   │           │
│  │  └─ user_settings  │    │                    │           │
│  └────────────────────┘    └────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ Claude API   │ │ Google   │ │ BrightData   │
│ (Anthropic)  │ │ Search   │ │ (Scraping)   │
└──────────────┘ └──────────┘ └──────────────┘
```

---

## Next Steps (Commercial Roadmap)

See [COMMERCIAL_ROADMAP.md](COMMERCIAL_ROADMAP.md) for detailed implementation plan.

### Phase 1: Foundation (P1 Priority)
1. Unit test framework (Vitest)
2. Unify rating source configs
3. Data provenance ledger
4. Scraping governance layer

### Phase 2: Scale
1. FTS5 full-text search
2. Virtual list rendering
3. Refactor bottles.js

### Phase 3: UX
1. Global unified search bar
2. Accessibility improvements
3. Export/import/backup

### Phase 4: AI Enhancements
1. Automated drink-now recommendations
2. Tasting note structured descriptors

### Phase 5: Mobile
1. Progressive Web App (PWA)
2. Google Play Store (TWA)

---

## Git History (Recent Commits)

```
3586587 feat: optimize chunked award extraction with reduced chunk size, retry logic, and partial JSON salvaging
03ab829 feat: separate awards database for sharing, fix streaming for Claude API
f4247a7 feat: add awards database with PDF/text import and local OCR support
f037287 fix: expand TLD list for wine-producing countries
7b3bf5d fix: improve producer name extraction and site detection
d42beb5 feat: improve producer website rating extraction
0b84515 feat: improve bottle adding UX with quantity selection and auto-fill
4a4e765 feat: implement dynamic cellar clustering system
249b028 feat: add sommelier chat follow-up and improve sync script
```

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| **Backend Modules** | 38 |
| **Frontend Modules** | 11 |
| **Database Tables** | 10 (across 2 DBs) |
| **API Endpoints** | 40+ |
| **Rating Sources** | 40+ |
| **Cellar Zones** | 40+ |
| **Database Migrations** | 12 |
| **Lines of Code** | ~10,000+ |

---

*Document generated: 1 January 2026*
*Version: 1.0*
