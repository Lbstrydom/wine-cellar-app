# Wine Cellar App - Commercial Roadmap (Future Work)
## Updated: 2 January 2026

---

## Progress Summary

### Phases 1-5: ✅ COMPLETE

| Phase | Status | Completion Date |
|-------|--------|-----------------|
| **Phase 1**: Testing & Architecture | ✅ Complete | Jan 2026 |
| **Phase 2**: Performance & Scale | ✅ Complete | Jan 2026 |
| **Phase 3**: UX Polish | ✅ Complete | Jan 2026 |
| **Phase 4**: AI Enhancements | ✅ Complete | Jan 2026 |
| **Phase 5**: PWA & Deployment | ✅ Complete | Jan 2026 |
| **Phase 6**: MCP Integration | ✅ Complete | Jan 2026 |

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

*Last updated: 2 January 2026*
*Status: Phases 1-6 complete, full MCP integration with PDF Reader, SQLite, and Skills*
