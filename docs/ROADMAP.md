# Wine Cellar App - Commercial Roadmap (Future Work)
## Updated: 3 January 2026

---

## Progress Summary

### Phases 1-6: ✅ COMPLETE | Phase 7: 🚧 IN PROGRESS

| Phase | Status | Completion Date |
|-------|--------|-----------------|
| **Phase 1**: Testing & Architecture | ✅ Complete | Jan 2026 |
| **Phase 2**: Performance & Scale | ✅ Complete | Jan 2026 |
| **Phase 3**: UX Polish | ✅ Complete | Jan 2026 |
| **Phase 4**: AI Enhancements | ✅ Complete | Jan 2026 |
| **Phase 5**: PWA & Deployment | ✅ Complete | Jan 2026 |
| **Phase 6**: MCP Integration | ✅ Complete | Jan 2026 |
| **Phase 7**: Sommelier-Grade Cellar Organisation | 🚧 In Progress | - |

**What Was Accomplished**:
- 249 unit tests with 85% service coverage
- Unified source configurations (900+ lines)
- Data provenance tracking system
- Scraping governance (rate limiting, circuit breaker)
- FTS5 full-text search with BM25 ranking
- Virtual list rendering for 1000+ bottles
- Modular bottles.js (1206 LOC → 8 modules)
- Global search (Cmd/Ctrl+K)
- Accessibility improvements (ARIA, keyboard nav)
- Backup/restore (JSON/CSV)
- AI drink recommendations
- Structured tasting profiles with controlled vocabulary
- Progressive Web App with service worker
- Tailscale HTTPS deployment
- **MCP Puppeteer** for Vivino/Decanter scraping
- **MCP PDF Reader** for awards import
- **MCP SQLite** for direct database queries
- **Award Extractor Skill** for structured PDF processing

---

## Phase 7: Sommelier-Grade Cellar Organisation

**Status**: 🚧 In Progress (Started: 3 January 2026)

**Goal**: Transform cellar organisation from "misplaced bottles" to proper sommelier advice with zone narratives, AI-suggested definitions, and proactive fridge stocking.

### Core Features (7.1-7.6)

#### 7.1 Fix Drinking Window Field Mismatch

**Problem**: `getFridgeCandidates()` uses `wine.drink_until` but reduce-now uses `drink_by_year` from drinking_windows table.

**Files**:
- `src/services/cellarAnalysis.js` (lines 339-380)
- `src/routes/cellar.js`

**Changes**:
- LEFT JOIN drinking_windows and return `drink_by_year`
- Check BOTH `drink_by_year` (preferred) and `drink_until` (fallback)
- Add helper `getEffectiveDrinkByYear(wine)`

---

#### 7.2 Zone Intent Metadata (Database)

**Problem**: Zones have matching rules but no human-readable "why" text.

**Key Workflow**:
1. **AI Suggests** - When cellar analysed or new wines added, AI suggests zone definitions
2. **User Confirms/Edits** - User reviews and can modify suggestions
3. **Stored in DB** - Persisted for future use
4. **Re-evaluated on Change** - When collection shifts, AI suggests updates

**New Migration**: `data/migrations/017_zone_metadata.sql`

```sql
CREATE TABLE IF NOT EXISTS zone_metadata (
  zone_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  purpose TEXT,                    -- "Crisp whites for weeknight cooking"
  style_range TEXT,                -- "Light to medium body, high acid, minimal oak"
  serving_temp TEXT,               -- "Well chilled (7-10°C)"
  aging_advice TEXT,               -- "Drink within 2-3 years of vintage"
  pairing_hints TEXT,              -- JSON array: ["Seafood", "Salads", "Light pasta"]
  example_wines TEXT,              -- JSON array: ["Sancerre", "Marlborough Sauvignon"]
  family TEXT,                     -- "white_crisp", "red_mediterranean", etc.
  seasonal_notes TEXT,             -- "More popular in summer"
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**New Files**:
- `src/services/zoneMetadata.js` - Access layer for zone metadata
- `src/routes/cellar.js` - GET/PUT `/api/cellar/zone-metadata/:zoneId`

---

#### 7.3 Upgrade Analysis Reporting

**Problem**: Report is row-centric, excludes buffer zones, lacks "zone story".

**Changes**:
- Include buffer/fallback zones (mark as "overflow zone")
- Add zone narratives with composition and health status
- Add fridge status to report

**Zone Narrative Structure**:
```javascript
{
  zoneId, displayName, intent,
  rows: ["R5", "R6"],
  currentComposition: {
    topGrapes: ["Cabernet", "Merlot"],
    topCountries: ["France", "SA"],
    vintageRange: [2015, 2021],
    bottleCount: 14
  },
  health: {
    utilizationPercent: 78,
    fragmentationScore: 15,
    misplacedCount: 2,
    status: 'healthy' // or 'crowded', 'sparse', 'fragmented'
  },
  drift: { /* zone intent vs actual composition */ }
}
```

---

#### 7.4 Enhance AI Context

**Problem**: Claude only sees summary + limited wine lists, not zone definitions.

**Add to Prompt**:
- Zone definitions (purpose, style range, pairing hints)
- Current composition per zone (top grapes, countries, health)
- Fridge context (current mix, gaps, top candidates)

**New Output Fields**:
```javascript
{
  layoutNarrative: "Your cellar is organized into...",
  zoneHealth: [{ zone, status, recommendation }],
  fridgePlan: {
    toAdd: [{ wineId, reason, category }],
    toRemove: [{ wineId, reason }],
    coverageAfter: { sparkling: 1, crispWhite: 2, ... }
  }
}
```

---

#### 7.5 Fridge Par-Level System

**Problem**: No proactive fridge stocking or coverage-based selection.

**User Preferences**:
- Fridge mix: Balanced with 1 sparkling (not 2)
- Show gaps only, let user decide what to move

**New File**: `src/config/fridgeParLevels.js`

```javascript
export const FRIDGE_PAR_LEVELS = {
  sparkling:     { min: 1, max: 1, priority: 1, description: "Celebration-ready bubbles" },
  crispWhite:    { min: 2, max: 2, priority: 2, description: "High-acid whites for seafood" },
  aromaticWhite: { min: 1, max: 1, priority: 3, description: "Off-dry for spicy food" },
  textureWhite:  { min: 1, max: 1, priority: 4, description: "Fuller whites for creamy dishes" },
  rose:          { min: 1, max: 1, priority: 5, description: "Versatile weeknight option" },
  chillableRed:  { min: 1, max: 1, priority: 6, description: "Light red for charcuterie" },
  flex:          { min: 0, max: 1, priority: 7, description: "Any wine to drink soon" }
};
// Total: 1+2+1+1+1+1+1 = 8 slots, leaving 1 flex
```

**New File**: `src/services/fridgeStocking.js`
- `calculateParLevelGaps(fridgeWines)` - What's missing
- `selectFridgeFillCandidates(cellarWines, gaps)` - What to move

---

#### 7.6 Frontend Updates

**Files**:
- `public/js/cellarAnalysis.js`
- `public/css/styles.css`

**New UI Sections**:
- Zone narrative cards (purpose, health status, composition)
- Fridge status panel (current mix, gaps, candidates)

---

### Extended Features (7.7-7.12)

#### 7.7 AI Safety & Reliability

**Changes**:
- Sanitise all AI inputs (wine names can contain injection attacks)
- Schema validation for responses (not just JSON parse)
- Persist chat sessions to database (survive restarts)
- Configurable model selection via environment

**New Files**:
- `data/migrations/018_chat_sessions.sql`
- `src/config/aiModels.js`
- `src/services/responseValidator.js`

---

#### 7.8 Hybrid Pairing Engine

**Problem**: Pure AI can hallucinate; pure deterministic lacks explanation.

**Solution**: Deterministic shortlist → AI selects + explains from shortlist only.

```javascript
// 1. Deterministic: score all wines, apply diversity constraint
const shortlist = generatePairingShortlist(wines, dish, preferences);

// 2. AI: explain why each works (can't hallucinate wines not in list)
const prompt = `From the shortlist ONLY, select top 3 and explain why...`;
```

**User-Tunable House Style**:
- `acid_preference`, `oak_preference`, `tannin_preference`, `adventure_level`

---

#### 7.9 Personalisation Loop (Palate Profile)

**Goal**: Learn user preferences from behaviour.

**New Migration**: `data/migrations/019_palate_profile.sql`

```sql
CREATE TABLE consumption_feedback (
  wine_id INTEGER,
  would_buy_again BOOLEAN,
  paired_with TEXT,           -- JSON array of food tags
  rating INTEGER,             -- 1-5 personal rating
  finished_at DATETIME
);

CREATE TABLE palate_profile (
  preference_key TEXT UNIQUE, -- e.g., "grape:cabernet", "country:france"
  preference_value REAL,      -- weighted score
  confidence REAL
);
```

**Post-Bottle Feedback**: Quick modal after marking "finished":
- "Would you buy this again?"
- "What did you eat with it?" (quick tags)

---

#### 7.10 Move Optimisation

**Problem**: Current moves are greedy (high-confidence first), not effort-minimised.

**Optimisation Goals**:
1. Minimise total number of moves
2. Prefer single-step moves over swaps
3. Batch moves by row for efficiency

**New File**: `src/services/movePlanner.js`

---

#### 7.11 Acquisition Workflow

**Goal**: Scan → Confirm → Place in one smooth flow.

**Workflow**:
1. **Scan** - Camera capture label/receipt
2. **Extract** - Claude Vision with confidence per field
3. **Confirm** - User only edits uncertain fields (highlighted)
4. **Enrich** - Auto-fetch drinking windows, Vivino rating
5. **Place** - Auto-suggest zone + fridge (if fits par-level gaps)
6. **Zone Review** - If wine doesn't fit zones, suggest zone update

---

#### 7.12 Cellar Health Dashboard

**Metrics**:
1. Drinking Window Risk (bottles near/past drink-by)
2. Style Coverage (do you have needed whites/sparkling?)
3. Duplication Risk (too many similar wines)
4. Event Readiness (can you host 6 people with variety?)
5. Fridge Gaps (missing par-level categories)

**One-Click Actions**:
- "Fill Fridge" - Move suitable wines to fill gaps
- "Build Weeknight Shortlist" - Quick-drink options
- "Generate Shopping List" - Missing roles/styles
- "Review At-Risk Wines" - Focus on drink-soon bottles

---

### Implementation Order

| Sub-Phase | Priority | Complexity | Dependencies |
|-----------|----------|------------|--------------|
| 7.1 Fix drink_until bug | HIGH | Low | None |
| 7.2 Zone intent metadata (DB) | HIGH | Medium | None |
| 7.3 Upgrade analysis | MEDIUM | Medium | 7.2 |
| 7.4 Enhance AI context | MEDIUM | Medium | 7.2, 7.3 |
| 7.5 Fridge par-levels | MEDIUM | Medium | 7.1 |
| 7.6 Frontend updates | LOW | Low | 7.3, 7.4, 7.5 |
| 7.7 AI safety & reliability | HIGH | Medium | None |
| 7.8 Hybrid pairing engine | MEDIUM | Medium | 7.7 |
| 7.9 Personalisation loop | LOW | Medium | 7.8 |
| 7.10 Move optimisation | LOW | Medium | 7.3 |
| 7.11 Acquisition workflow | MEDIUM | High | 7.2, 7.7 |
| 7.12 Cellar health dashboard | LOW | Medium | 7.5, 7.10 |

---

### Files to Create

**Core (7.1-7.6)**:
- `data/migrations/017_zone_metadata.sql`
- `src/config/fridgeParLevels.js`
- `src/services/fridgeStocking.js`
- `src/services/zoneMetadata.js`

**Extended (7.7-7.12)**:
- `data/migrations/018_chat_sessions.sql`
- `data/migrations/019_palate_profile.sql`
- `src/config/aiModels.js`
- `src/services/responseValidator.js`
- `src/services/pairingEngine.js`
- `src/services/palateProfile.js`
- `src/services/movePlanner.js`

### Files to Modify

**Core (7.1-7.6)**:
- `src/services/cellarAnalysis.js` - Fix drink_until, add narratives, include buffer zones
- `src/services/cellarAI.js` - Expand prompt context
- `src/routes/cellar.js` - Update queries, add zone-metadata endpoints
- `src/db/index.js` - Add zone metadata queries
- `public/js/cellarAnalysis.js` - New UI sections
- `public/css/styles.css` - Zone cards, fridge status styling

**Extended (7.7-7.12)**:
- `src/services/claude.js` - Sanitise inputs, configurable models
- `src/services/pairing.js` - Integrate hybrid engine
- `src/routes/pairing.js` - Persist chat sessions
- `public/js/bottles/form.js` - Acquisition workflow
- `public/js/app.js` - Health dashboard integration

---

## Remaining Features

### Feature 1: Wine Confirmation Modal

**Status**: Planned (from WINE_CONFIRMATION_PLAN.md)

**Why**: Prevent incorrect wine matches when adding bottles. Show Vivino-style confirmation with alternatives before saving.

**User Flow**:
```
1. User uploads image/pastes text
2. Claude parses wine details
3. Search Vivino for matching wines → NEW
4. Show confirmation modal with alternatives → NEW
5. User selects correct match
6. Save with Vivino ID for accurate ratings
```

**Key Components**:
- `src/services/vivinoSearch.js` - Vivino API search integration
- `public/js/bottles/confirmation.js` - Confirmation modal UI
- Bright Data Web Unlocker for Vivino API access

**Benefits**:
- Prevents mismatched ratings
- User confidence in wine identification
- Better data quality

**Priority**: P2 (nice-to-have, not blocking)

---

### Feature 2: Claude MCP Puppeteer Automation

**Status**: ✅ INTEGRATED - Vivino scraping works, hybrid search implemented

**Why**: Automate rating fetch from sources that require JavaScript rendering or complex authentication flows.

**Problem**:
- Some sources (Vivino, Decanter reviews) require browser rendering
- Current scraping struggles with dynamic content
- Authentication flows are fragile

**Solution**: Use Claude Model Context Protocol (MCP) with Puppeteer server to:
1. Control headless browser via MCP
2. Navigate to wine pages with full JS rendering
3. Extract ratings, notes, windows with DOM access
4. Handle authentication flows automatically

**Architecture**:
```
┌─────────────────────────────────────────────┐
│  Wine Cellar App (Node.js)                  │
├─────────────────────────────────────────────┤
│  src/services/puppeteerScraper.js           │
│    ├─ MCPPuppeteerClient class              │
│    ├─ JSON-RPC over stdio communication     │
│    └─ Wine scraping functions               │
└─────────────┬───────────────────────────────┘
              │ MCP Protocol (stdio)
┌─────────────▼───────────────────────────────┐
│  puppeteer-mcp-server (npm package)         │
│  (Started as child process)                 │
├─────────────────────────────────────────────┤
│  Tools:                                     │
│  ├─ puppeteer_navigate  (go to URLs)        │
│  ├─ puppeteer_click     (click elements)    │
│  ├─ puppeteer_fill      (fill form fields)  │
│  ├─ puppeteer_screenshot (capture images)   │
│  └─ puppeteer_evaluate  (run JS in page)    │
└─────────────┬───────────────────────────────┘
              │
┌─────────────▼───────────────────────────────┐
│  Puppeteer (Headless Chrome)                │
│  ├─ Full JS rendering                       │
│  ├─ Cookie/session management               │
│  └─ DOM access for extraction               │
└─────────────────────────────────────────────┘
```

**Implementation Complete (2 Jan 2026)**:
- ✅ `src/services/puppeteerScraper.js` - Shared Puppeteer scraping service
- ✅ `src/services/vivinoSearch.js` - Hybrid approach: SERP search + Puppeteer scrape
- ✅ `src/services/searchProviders.js` - Decanter integration updated

**Key Files Created/Updated**:
- `src/services/puppeteerScraper.js` - MCPPuppeteerClient class, navigate/evaluate/click
- `scripts/test-puppeteer-providers.mjs` - Integration test script

**What Works** ✅:
- **Vivino individual page scraping**: Navigate to wine URL, extract rating/winery/region/grape
- **Cookie consent handling**: Auto-clicks "Agree" buttons
- **JavaScript evaluation**: Full DOM access with `return` statement requirement
- **Rating extraction**: 4.0★ (313 ratings) format

**Test Results**:
```
Scraping: https://www.vivino.com/en/nederburg-estate-private-bin-cabernet-sauvignon/w/1160367
  Name: Nederburg Private Bin Cabernet Sauvignon
  Rating: 4★
  Winery: Nederburg
  Region: Coastal Region
  Grape: Cabernet Sauvignon
```

**Limitations Found**:
- ❌ **Vivino search pages blocked** (HTTP 405) - Vivino detects headless browsers
- ❌ **Google search rate-limited** (HTTP 429) - Can't use Puppeteer for Google SERP
- ⚠️ **Decanter search complex** - Site structure makes reliable search difficult

**Hybrid Approach**:
Since Vivino blocks search pages but allows individual wine pages:
1. **Use Bright Data SERP** to find Vivino wine URLs via Google search
2. **Use Puppeteer** to scrape individual wine pages (faster, free, reliable)

**Technical Notes**:
- `puppeteer_evaluate` requires explicit `return` statement (wrapped automatically)
- Cookie consent clicked via `document.querySelectorAll('button')` text match
- Client instance managed with timeout-based reuse (60s)

**Future Work**:
- ⏳ Docker deployment (requires Chromium in container)
- ⏳ Better Decanter search integration
- ⏳ Handle more edge cases in Vivino scraping

**Priority**: ✅ DONE (P1 - high impact, enables reliable Vivino fetch)

---

### Feature 3: MCP Servers & Skills Integration

**Status**: ✅ COMPLETE (2 Jan 2026)

**Why**: Extend Claude Code capabilities with specialized MCP servers for PDF processing, database queries, and structured task guidance via Skills.

**MCP Servers Configured**:

| Server | Package | Purpose |
|--------|---------|---------|
| **puppeteer** | `puppeteer-mcp-server` | Headless browser for JS-rendered sites |
| **pdf-reader** | `@sylphx/pdf-reader-mcp` | Fast PDF text extraction (5-10x faster than OCR) |
| **sqlite** | `mcp-sqlite` | Direct database queries for analytics |

**Configuration File**: `.mcp.json`
```json
{
  "mcpServers": {
    "pdf-reader": {
      "type": "stdio",
      "command": "npx -y @sylphx/pdf-reader-mcp"
    },
    "sqlite": {
      "type": "stdio",
      "command": "npx -y mcp-sqlite --db-path data/cellar.db"
    }
  }
}
```

**Skills Created**:

| Skill | Location | Purpose |
|-------|----------|---------|
| **award-extractor** | `.claude/skills/award-extractor/SKILL.md` | Structured extraction of wine awards from PDFs |

**Award Extractor Skill Features**:
- Recognizes competition formats (IWSC, Decanter, Tim Atkin, Platter's)
- Extracts: wine_name, producer, vintage, medal, score, category
- Validates data and checks for duplicates
- Imports directly to awards.db via SQLite MCP

**Benefits**:
- **PDF Processing**: Replace complex OCR pipeline with direct text extraction
- **Database Access**: Claude can query cellar for analytics without custom routes
- **Structured Tasks**: Skills teach Claude domain-specific extraction patterns
- **Faster Awards Import**: PDF → structured data → database in one workflow

**Use Cases**:
```
User: "Extract awards from IWSC-2024.pdf"
Claude: Uses pdf-reader MCP → parses tables → inserts via sqlite MCP
        → "Extracted 147 awards, 3 duplicates skipped"

User: "Which wines in my cellar won gold medals?"
Claude: Uses sqlite MCP → SELECT w.* FROM wines w
        JOIN awards a ON w.wine_name LIKE '%' || a.wine_name || '%'
        WHERE a.medal = 'Gold'
```

**Priority**: ✅ DONE (P1 - high impact for awards import workflow)

---

### Feature 4: Play Store Release (TWA)

**Status**: Ready when needed

**Prerequisites**:
- ✅ PWA passing Lighthouse audit (95+)
- ✅ HTTPS deployment
- ✅ Service worker for offline support
- ✅ Manifest with icons

**Steps**:
1. Use **Bubblewrap** CLI to generate TWA wrapper
2. Add `assetlinks.json` for domain verification
3. Generate signed APK
4. Submit to Google Play Console
5. Fill store listing (description, screenshots, etc.)

**Benefits**:
- Native app distribution
- Google Play discoverability
- In-app billing (future monetization)

**Priority**: P3 (when ready for public release)

---

### Feature 5: Cloud Backend (Future)

**Status**: Deferred until product-market fit

**Why Defer**:
- Current single-user deployment works well
- No need for multi-user yet
- Adds complexity and cost
- Database abstraction layer (Phase 1.2) was deferred as P3

**When to Implement**:
- After validating with alpha testers (friends/family)
- If planning commercial release
- When need for data sync across devices arises

**Options**:
- **Supabase**: PostgreSQL + Auth + Edge Functions ($25/mo)
- **PlanetScale**: MySQL + Branching ($29/mo)
- **Neon**: PostgreSQL + Serverless ($19/mo)
- **Firebase**: Firestore + Auth + Functions (pay-as-go)

**Migration Path** (when needed):
1. Implement database abstraction layer (Phase 1.2 of original roadmap)
2. Add user authentication (Supabase Auth or Auth0)
3. Implement data sync between local SQLite and cloud
4. Migrate to cloud-first with local cache

**Priority**: P4 (future consideration)

---

## Implementation Order

| Feature | Priority | Status |
|---------|----------|--------|
| **MCP Puppeteer Automation** | P1 | ✅ Complete |
| **MCP Servers & Skills** | P1 | ✅ Complete |
| **Phase 7: Sommelier-Grade Organisation** | P1 | 🚧 In Progress |
| **Wine Confirmation Modal** | P2 | Planned |
| **Play Store Release (TWA)** | P3 | Ready when needed |
| **Cloud Backend** | P4 | Deferred |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Test coverage | 85% services | Maintain 85%+ |
| Lighthouse PWA score | 95+ | Maintain 95+ |
| Search latency (1000 wines) | <50ms | <50ms maintained |
| List scroll FPS | 60fps | 60fps maintained |
| Accessibility score | 95+ | 95+ maintained |
| Rating fetch success rate | ~70% | 95%+ (with MCP) |

---

## Development Philosophy

**Current Approach**:
- ✅ Building for personal use first
- ✅ Alpha testing with friends/family
- ✅ Server-side scraping (no client-side automation needed)
- ✅ Partner-ready data practices (provenance, attribution)

**Future Vision**:
- Public Play Store release when ready
- Partnerships with rating providers (Vivino, Decanter)
- Freemium model (basic free, premium features)
- Cloud backend for multi-user support

---

## Files from Completed Phases

**Phase 1 (Testing & Architecture)**:
- ✅ `tests/unit/**/*.test.js` - 249 unit tests
- ✅ `src/config/unifiedSources.js` - Merged source configs (900+ lines)
- ✅ `src/services/provenance.js` - Data provenance tracking
- ✅ `src/services/rateLimiter.js` - Per-source rate limiting
- ✅ `src/services/circuitBreaker.js` - Circuit breaker pattern
- ✅ `src/services/scrapingGovernance.js` - Unified governance wrapper
- ✅ `data/migrations/013_data_provenance.sql` - Provenance table

**Phase 2 (Scale)**:
- ✅ `data/migrations/014_fts5_search.sql` - FTS5 virtual table
- ✅ `public/js/virtualList.js` - Virtual scrolling
- ✅ `public/js/bottles/` - 8 modular components (all <380 LOC)

**Phase 3 (UX)**:
- ✅ `public/js/globalSearch.js` - Cmd/Ctrl+K search palette
- ✅ `public/js/accessibility.js` - A11y utilities
- ✅ `src/routes/backup.js` - Export/import/backup endpoints

**Phase 4 (AI)**:
- ✅ `src/services/drinkNowAI.js` - AI-powered drink recommendations
- ✅ `src/services/tastingExtractor.js` - Tasting note → structured data
- ✅ `src/config/tastingVocabulary.js` - Controlled vocabulary (170+ terms)
- ✅ `data/migrations/015_tasting_profiles.sql` - Tasting profile columns

**Phase 5 (Mobile)**:
- ✅ `public/manifest.json` - PWA manifest
- ✅ `public/sw.js` - Service worker
- ✅ `public/images/icon-*.png` - App icons (72px - 512px + maskable)
- ✅ `scripts/generate-icons.js` - Icon generation script

**Phase 6 (MCP Integration)**:
- ✅ `.mcp.json` - MCP server configuration (pdf-reader, sqlite)
- ✅ `src/services/puppeteerScraper.js` - MCP Puppeteer client wrapper
- ✅ `src/config/scraperConfig.js` - Centralized scraping configuration
- ✅ `.claude/skills/award-extractor/SKILL.md` - Wine awards extraction skill

---

## Documentation

See also:
- **Status_2_Jan_2026.md** - Complete feature documentation
- **AGENTS.md** - Coding standards and conventions
- **HTTPS_SETUP.md** - Tailscale deployment guide
- **WINE_CONFIRMATION_PLAN.md** - Detailed wine confirmation feature spec

---

*Last updated: 3 January 2026*
*Status: Phases 1-6 complete, Phase 7 (Sommelier-Grade Organisation) in progress*
