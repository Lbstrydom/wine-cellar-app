# Wine Cellar App - Commercial Roadmap (Future Work)
## Updated: 6 January 2026

---

## Progress Summary

### Phases 1-7: ✅ COMPLETE | Phase 8: 🚧 IN PROGRESS

| Phase | Status | Completion Date |
|-------|--------|-----------------|
| **Phase 1**: Testing & Architecture | ✅ Complete | Jan 2026 |
| **Phase 2**: Performance & Scale | ✅ Complete | Jan 2026 |
| **Phase 3**: UX Polish | ✅ Complete | Jan 2026 |
| **Phase 4**: AI Enhancements | ✅ Complete | Jan 2026 |
| **Phase 5**: PWA & Deployment | ✅ Complete | Jan 2026 |
| **Phase 6**: MCP Integration | ✅ Complete | Jan 2026 |
| **Phase 7**: Sommelier-Grade Cellar Organisation | ✅ Complete | Jan 2026 |
| **Phase 8**: Production Hardening | 🚧 In Progress | - |

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
- Railway + PostgreSQL cloud deployment
- **MCP Puppeteer** for Vivino/Decanter scraping
- **MCP PDF Reader** for awards import
- **MCP SQLite** for direct database queries
- **Award Extractor Skill** for structured PDF processing

---

## Phase 7: Sommelier-Grade Cellar Organisation

**Status**: ✅ COMPLETE (Finished: 6 January 2026)
**Completed**: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12

**Goal**: Transform cellar organisation from "misplaced bottles" to proper sommelier advice with zone narratives, AI-suggested definitions, and proactive fridge stocking.

### Core Features (7.1-7.6)

#### 7.1 Fix Drinking Window Field Mismatch ✅

**Status**: COMPLETE (6 January 2026)

**Problem**: `getFridgeCandidates()` uses `wine.drink_until` but reduce-now uses `drink_by_year` from drinking_windows table.

**Implemented**:
- `src/services/cellarAnalysis.js`: Added `getEffectiveDrinkByYear(wine)` helper (lines 593-599)
- `src/routes/cellar.js`: Already included LEFT JOIN drinking_windows and returns `drink_by_year`
- Function checks BOTH `drink_by_year` (preferred) and `drink_until` (fallback)

---

#### 7.2 Zone Intent Metadata (Database) ✅

**Status**: COMPLETE (pre-existing implementation discovered)

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

#### 7.3 Upgrade Analysis Reporting ✅

**Status**: COMPLETE (pre-existing implementation discovered 6 January 2026)

**Implemented**:
- ✅ Buffer/fallback zones included in `overflowAnalysis` array (marks as buffer/fallback zone)
- ✅ Zone narratives generated via `generateZoneNarratives()` in `cellarAnalysis.js`
- ✅ Fridge status added to analysis report via `analyseFridge()`

**Zone Narrative Structure** (implemented in `cellarAnalysis.js:410-458`):
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
    bottleCount: 14,
    capacity: 18,
    status: 'healthy' // or 'crowded', 'sparse', 'fragmented'
  },
  drift: { hasDrift, issues, unexpectedItems }
}
```

---

#### 7.4 Enhance AI Context ✅

**Status**: COMPLETE (pre-existing implementation discovered 6 January 2026)

**Implemented** in `cellarAI.js:78-180`:
- ✅ Zone definitions in `<ZONE_DEFINITIONS>` block (purpose, rows, health, top grapes)
- ✅ Current composition per zone (from `zoneNarratives`)
- ✅ Fridge context in `<FRIDGE_STATUS>` block (currentMix, gaps, top candidates)

**Output Fields** (implemented in `validateAdviceSchema()`):
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

#### 7.5 Fridge Par-Level System ✅

**Status**: COMPLETE (pre-existing implementation discovered 6 January 2026)

**Implemented**:
- ✅ `src/config/fridgeParLevels.js` - Full category definitions with match rules
- ✅ `src/services/fridgeStocking.js` - Gap detection and candidate selection

**Par-Level Config** (from `fridgeParLevels.js`):
```javascript
export const FRIDGE_PAR_LEVELS = {
  sparkling:     { min: 1, max: 1, priority: 1, description: "Celebration-ready bubbles", matchRules: {...} },
  crispWhite:    { min: 2, max: 2, priority: 2, description: "High-acid whites for seafood", matchRules: {...} },
  aromaticWhite: { min: 1, max: 1, priority: 3, description: "Off-dry for spicy food", matchRules: {...} },
  textureWhite:  { min: 1, max: 1, priority: 4, description: "Fuller whites for creamy dishes", matchRules: {...} },
  rose:          { min: 1, max: 1, priority: 5, description: "Versatile weeknight option", matchRules: {...} },
  chillableRed:  { min: 1, max: 1, priority: 6, description: "Light red for charcuterie", matchRules: {...} },
  flex:          { min: 0, max: 1, priority: 7, optional: true, description: "Any wine to drink soon" }
};
// Total: 1+2+1+1+1+1 = 7 slots + 1 flex = 8 (capacity 9)
```

**Key Functions** (from `fridgeStocking.js`):
- `calculateParLevelGaps(fridgeWines)` - Returns gaps by category with need count
- `selectFridgeFillCandidates(cellarWines, gaps, emptySlots)` - Prioritized fill suggestions
- `analyseFridge(fridgeWines, cellarWines)` - Complete fridge analysis with candidates

---

#### 7.6 Frontend Updates ✅

**Status**: COMPLETE (pre-existing implementation discovered 6 January 2026)

**Files**:
- `public/js/cellarAnalysis.js`
- `public/css/styles.css`

**Implemented UI Sections**:
- Zone narrative cards (purpose, health status, composition) via `renderZoneNarratives()`
- Fridge status panel (current mix, gaps, candidates) via `renderFridgeStatus()`
- Zone setup wizard with proposal and consolidation moves
- Zone classification chat interface

---

### Extended Features (7.7-7.12)

#### 7.7 AI Safety & Reliability ✅

**Status**: COMPLETE (6 January 2026)

**Implemented**:
- ✅ Input sanitization: `src/services/inputSanitizer.js` - Prevents prompt injection attacks
  - `sanitizeDishDescription()` - For sommelier requests
  - `sanitizeWineList()` - For wine data in prompts
  - `sanitizeChatMessage()` - For zone chat and follow-up messages
  - `sanitizeTastingNote()` - For tasting profile extraction
  - Pattern detection for system prompt manipulation, role switching, instruction overrides
- ✅ Schema validation: `src/services/responseValidator.js` - Validates AI responses against schemas
  - Schemas for: sommelier, wineDetails, ratings, cellarAnalysis, zoneChat, drinkRecommendations, tastingProfile
  - `parseAndValidate()` - Parse JSON and validate against schema
  - `createFallback()` - Generate safe fallback responses
- ✅ Model configuration: `src/config/aiModels.js` - Environment-based model selection
  - `getModelForTask(task)` - Get model ID for a task (supports env override)
  - Task-to-model mapping: sommelier, parsing, ratings, cellarAnalysis, zoneChat, etc.
  - Support for CLAUDE_MODEL and CLAUDE_MODEL_<TASK> environment variables
- ✅ Chat sessions persistence: `data/migrations/019_chat_sessions.sql` + `src/services/chatSessions.js`
  - Session management: create, get, update status, cleanup
  - Message storage with token tracking
  - Session types: sommelier, zone_chat, cellar_analysis, drink_recommendations

**Files Created**:
- `src/config/aiModels.js`
- `src/services/responseValidator.js`
- `src/services/inputSanitizer.js`
- `src/services/chatSessions.js`
- `data/migrations/019_chat_sessions.sql`

**Files Updated** (to use new modules):
- `src/services/claude.js` - All API calls now use model config, sanitization, and validation
- `src/services/drinkNowAI.js` - Model config and sanitization
- `src/services/cellarAI.js` - Model config
- `src/services/zoneChat.js` - Model config and sanitization
- `src/services/tastingExtractor.js` - Model config and sanitization

---

#### 7.8 Hybrid Pairing Engine ✅

**Status**: COMPLETE (6 January 2026)

**Problem**: Pure AI can hallucinate; pure deterministic lacks explanation.

**Solution**: Deterministic shortlist → AI explains from shortlist only (can't hallucinate).

**Files Created**:
- `src/config/pairingRules.js` - Food signals → wine style mappings (25+ signals, 12 style buckets)
- `src/services/pairingEngine.js` - Deterministic scoring + AI explanation

**Key Functions**:
```javascript
// 1. Deterministic: score all wines against food signals
const shortlist = generateShortlist(wines, dish, { colour, source, houseStyle });

// 2. AI: explain why each pairing works (from shortlist ONLY)
const explained = await explainShortlist(dish, shortlistResult, topN);

// 3. Combined hybrid approach
const result = await getHybridPairing(wines, dish, options);
```

**API Endpoints** (added to `src/routes/pairing.js`):
- `GET /api/pairing/signals` - List available food signals
- `POST /api/pairing/extract-signals` - Extract signals from dish description
- `POST /api/pairing/shortlist` - Deterministic shortlist only (no AI)
- `POST /api/pairing/hybrid` - Full hybrid pairing with AI explanation
- `GET /api/pairing/house-style` - Get house style defaults

**User-Tunable House Style** (`DEFAULT_HOUSE_STYLE`):
- `acidPreference` - Prefer high-acid wines (1.0=neutral, >1=prefer)
- `oakPreference` - Prefer oaky wines
- `tanninPreference` - Prefer tannic wines
- `adventureLevel` - Prefer unusual vs classic pairings
- `reduceNowBonus` - Bonus for reduce-now wines (default 1.5x)
- `fridgeBonus` - Bonus for wines in fridge (default 1.2x)
- `diversityPenalty` - Penalty per duplicate style (default 0.5x)

**Food Signal Categories**:
- Proteins: chicken, pork, beef, lamb, fish, shellfish
- Preparations: roasted, grilled, fried, braised, raw
- Flavours: creamy, spicy, sweet, acid, umami, herbal, earthy, smoky
- Ingredients: tomato, cheese, mushroom, garlic_onion, cured_meat, pepper, salty

**Wine Style Buckets**:
- Whites: white_crisp, white_medium, white_oaked, white_aromatic
- Rosé: rose_dry
- Reds: red_light, red_medium, red_full
- Sparkling: sparkling_dry, sparkling_rose
- Dessert: dessert

---

#### 7.9 Personalisation Loop (Palate Profile) ✅

**Status**: COMPLETE (6 January 2026)

**Goal**: Learn user preferences from behaviour.

**Files Created**:
- `data/migrations/020_palate_profile.sql` - Database schema
- `src/services/palateProfile.js` - Profile service
- `src/routes/palateProfile.js` - API endpoints

**Database Tables**:
- `consumption_feedback` - Post-bottle feedback (rating, would buy again, pairings, occasion)
- `palate_profile` - Aggregated preferences (grape, country, style, price_range, pairing)
- `preference_weights` - Configurable weights per preference type

**Key Functions**:
```javascript
recordFeedback({ wineId, wouldBuyAgain, personalRating, pairedWith, occasion, notes })
getPalateProfile() // Returns likes, dislikes, byCategory
getPersonalizedScore(wine) // Returns score, factors, recommendation
getPersonalizedRecommendations(limit) // Wines ranked by personal preference
```

**API Endpoints**:
- `POST /api/palate/feedback` - Record post-bottle feedback
- `GET /api/palate/feedback/:wineId` - Get feedback for a wine
- `GET /api/palate/profile` - Get full palate profile
- `GET /api/palate/score/:wineId` - Get personalized score for a wine
- `GET /api/palate/recommendations` - Get personalized recommendations
- `GET /api/palate/food-tags` - Available food tags
- `GET /api/palate/occasions` - Available occasion types

**Preference Categories**:
- grape (weight 1.5) - Most predictive
- style (weight 1.2) - oaked, tannic, crisp, etc.
- country (weight 1.0) - Country/region preferences
- colour (weight 0.8) - Red/white/rosé preferences
- pairing (weight 0.6) - Food pairing correlations
- price_range (weight 0.5) - Budget to luxury preferences

---

#### 7.10 Move Optimisation ✅

**Status**: COMPLETE (6 January 2026)

**Problem**: Current moves are greedy (high-confidence first), not effort-minimised.

**Optimisation Goals**:
1. Minimise total number of moves
2. Prefer single-step moves over swaps
3. Batch moves by row for efficiency

**File Created**: `src/services/movePlanner.js`

**Key Functions**:
```javascript
planMoves(misplacedWines, zoneSlots, options) // Optimised move planning
batchMovesByZone(moves) // Group moves for efficient execution
calculateMoveStats(plan) // Statistics for UI display
generateMoveSummary(plan) // Human-readable summary
validatePlan(plan) // Pre-execution validation
```

**Move Effort Scores**:
- SINGLE (1) - Direct move to empty slot
- SWAP (2) - Two-way swap
- CHAIN (3) - Multi-step chain move
- MANUAL (5) - Requires manual intervention

**Optimisation Features**:
- Sorts wines by confidence, available slots, then row number
- Prefers adjacent slots when batching same wines together
- Finds swap opportunities when no slots available
- Validates plan for circular moves and duplicate targets

---

#### 7.11 Acquisition Workflow ✅

**Status**: COMPLETE (6 January 2026)

**Goal**: Scan → Confirm → Place in one smooth flow.

**Workflow**:
1. **Scan** - Camera capture label/receipt
2. **Extract** - Claude Vision with confidence per field
3. **Confirm** - User only edits uncertain fields (highlighted)
4. **Enrich** - Auto-fetch drinking windows, Vivino rating
5. **Place** - Auto-suggest zone + fridge (if fits par-level gaps)
6. **Zone Review** - If wine doesn't fit zones, suggest zone update

**Files Created**:
- `src/services/acquisitionWorkflow.js` - Orchestrates the full acquisition flow
- `src/routes/acquisition.js` - API endpoints for acquisition workflow

**Key Functions**:
```javascript
// Parse with per-field confidence
parseWineWithConfidence(base64Image, mediaType)

// Get placement suggestions (zone + fridge eligibility)
suggestPlacement(wine)

// Enrich wine with ratings and drinking windows
enrichWineData(wine)

// Run complete workflow
runAcquisitionWorkflow({ base64Image, mediaType, confirmedData, skipEnrichment })

// Save acquired wine with placement
saveAcquiredWine(wineData, { slot, quantity, addToFridge })
```

**API Endpoints** (in `src/routes/acquisition.js`):
- `POST /api/acquisition/parse-image` - Parse with confidence data
- `POST /api/acquisition/suggest-placement` - Get zone + fridge suggestion
- `POST /api/acquisition/enrich` - Fetch ratings and drinking windows
- `POST /api/acquisition/workflow` - Run complete workflow
- `POST /api/acquisition/save` - Save wine and add bottles
- `GET /api/acquisition/confidence-levels` - Get confidence level definitions

**Frontend Enhancements**:
- Field confidence highlighting (red for uncertain, yellow for review)
- "Please review" hint for uncertain fields
- "Suggest Placement" button shows zone and fridge eligibility
- Visual indicators for zone confidence and alternatives

---

#### 7.12 Cellar Health Dashboard ✅

**Status**: COMPLETE (6 January 2026)

**Goal**: Provide comprehensive cellar health metrics and one-click actions.

**Files Created**:
- `src/services/cellarHealth.js` - Health metrics and actions
- `src/routes/cellarHealth.js` - API endpoints

**Metrics**:
1. Drinking Window Risk (bottles near/past drink-by)
2. Style Coverage (do you have needed whites/sparkling?)
3. Duplication Risk (too many similar wines)
4. Event Readiness (can you host 6 people with variety?)
5. Fridge Gaps (missing par-level categories)

**Key Functions**:
```javascript
getCellarHealth() // Full health report with metrics, alerts, actions
executeFillFridge(maxMoves) // Move suitable wines to fill fridge gaps
getAtRiskWines(limit) // Get wines approaching/past drinking window
generateShoppingList() // Shopping suggestions based on gaps
```

**API Endpoints** (in `src/routes/cellarHealth.js`):
- `GET /api/health` - Full health report
- `GET /api/health/score` - Health score with breakdown
- `GET /api/health/alerts` - Active alerts only
- `GET /api/health/at-risk` - At-risk wines list
- `POST /api/health/fill-fridge` - Execute fridge fill action
- `GET /api/health/shopping-list` - Generate shopping suggestions

**Health Score Calculation** (weighted average):
- drinkingWindowRisk (25%) - % not at-risk
- styleCoverage (20%) - Covered styles
- diversityScore (20%) - Not over-concentrated
- eventReadiness (20%) - Can host 6 people
- fridgeStatus (15%) - Fridge par-level coverage

**Alert Severity Levels**:
- critical: Past drink-by date
- warning: Within 1 year of drink-by
- info: Within 2 years of drink-by

**One-Click Actions**:
- "Fill Fridge" - Move suitable wines to fill gaps
- "Build Weeknight Shortlist" - Quick-drink options
- "Generate Shopping List" - Missing roles/styles
- "Review At-Risk Wines" - Focus on drink-soon bottles

---

### Implementation Order

| Sub-Phase | Priority | Complexity | Status |
|-----------|----------|------------|--------|
| 7.1 Fix drink_until bug | HIGH | Low | ✅ COMPLETE |
| 7.2 Zone intent metadata (DB) | HIGH | Medium | ✅ COMPLETE |
| 7.3 Upgrade analysis | MEDIUM | Medium | ✅ COMPLETE |
| 7.4 Enhance AI context | MEDIUM | Medium | ✅ COMPLETE |
| 7.5 Fridge par-levels | MEDIUM | Medium | ✅ COMPLETE |
| 7.6 Frontend updates | LOW | Low | ✅ COMPLETE |
| 7.7 AI safety & reliability | HIGH | Medium | ✅ COMPLETE |
| 7.8 Hybrid pairing engine | MEDIUM | Medium | ✅ COMPLETE |
| 7.9 Personalisation loop | LOW | Medium | ✅ COMPLETE |
| 7.10 Move optimisation | LOW | Medium | ✅ COMPLETE |
| 7.11 Acquisition workflow | MEDIUM | High | ✅ COMPLETE |
| 7.12 Cellar health dashboard | LOW | Medium | ✅ COMPLETE |

---

### Files to Create

**Core (7.1-7.6)**:
- ✅ `data/migrations/017_zone_metadata.sql` - Created
- ✅ `src/config/fridgeParLevels.js` - Created (pre-existing)
- ✅ `src/services/fridgeStocking.js` - Created (pre-existing)
- ✅ `src/services/zoneMetadata.js` - Created (pre-existing)

**Extended (7.7-7.12)**:
- ✅ `data/migrations/019_chat_sessions.sql` - Created (6 Jan 2026)
- ✅ `data/migrations/020_palate_profile.sql` - Created (6 Jan 2026)
- ✅ `src/config/aiModels.js` - Created (6 Jan 2026)
- ✅ `src/config/pairingRules.js` - Created (6 Jan 2026) - Food signal mappings
- ✅ `src/services/responseValidator.js` - Created (6 Jan 2026)
- ✅ `src/services/inputSanitizer.js` - Created (6 Jan 2026)
- ✅ `src/services/chatSessions.js` - Created (6 Jan 2026)
- ✅ `src/services/pairingEngine.js` - Created (6 Jan 2026) - Hybrid pairing
- ✅ `src/services/palateProfile.js` - Created (6 Jan 2026)
- ✅ `src/services/movePlanner.js` - Created (6 Jan 2026)
- ✅ `src/services/cellarHealth.js` - Created (6 Jan 2026)
- ✅ `src/routes/cellarHealth.js` - Created (6 Jan 2026)

### Files Modified (6 Jan 2026)

**AI Safety (7.7)**:
- ✅ `src/services/claude.js` - Sanitise inputs, configurable models, response validation
- ✅ `src/services/drinkNowAI.js` - Model config and context sanitization
- ✅ `src/services/cellarAI.js` - Model config
- ✅ `src/services/zoneChat.js` - Model config and message sanitization
- ✅ `src/services/tastingExtractor.js` - Model config and note sanitization

**Core (7.1-7.6)** - Completed (pre-existing):
- ✅ `src/services/cellarAnalysis.js` - Zone narratives with composition/health, buffer zone analysis
- ✅ `src/services/cellarAI.js` - Zone definitions and fridge context in prompt
- ✅ `src/routes/cellar.js` - Zone-metadata endpoints, fridge status in /analyse
- `public/js/cellarAnalysis.js` - UI improvements (7.6 - LOW priority, pending)
- `public/css/styles.css` - Zone cards styling (7.6 - LOW priority, pending)

**Extended (7.8-7.12)** - Still Pending:
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
- **STATUS.md** - Complete feature documentation
- **AGENTS.md** - Coding standards and conventions
- **CLAUDE.md** - AI assistant guidelines
- **WINE_CONFIRMATION_PLAN.md** - Detailed wine confirmation feature spec

---

---

## Phase 8: Production Hardening

**Status**: 🚧 IN PROGRESS
**Goal**: Address commercial-grade quality gaps identified in comprehensive audit. Focus on data safety, security, reliability, and observability.

### Risk Assessment

| Category | Current Risk | Target | Priority |
|----------|--------------|--------|----------|
| Data Safety | HIGH (race conditions) | LOW | CRITICAL |
| Security | MEDIUM (no auth) | LOW | HIGH |
| Reliability | MEDIUM (no graceful shutdown) | LOW | HIGH |
| Observability | HIGH (console.log only) | LOW | MEDIUM |
| Testing | MEDIUM (85% services) | LOW | MEDIUM |

---

### 8.1 Transaction Safety (Data Integrity) - CRITICAL

**Problem**: Slot move/swap operations are NOT atomic. Race conditions can cause bottles to disappear or duplicate.

**Files to Fix**:
- `src/routes/slots.js` - Move and swap operations (lines 32-35, 73-77)
- `src/routes/cellar.js` - Execute moves endpoint

**Solution**: Implement PostgreSQL transactions for all multi-step operations.

```javascript
// Before (dangerous):
await db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(from);
await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(wineId, to);

// After (safe):
await db.prepare('BEGIN').run();
try {
  await db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(from);
  await db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(wineId, to);
  await db.prepare('COMMIT').run();
} catch (err) {
  await db.prepare('ROLLBACK').run();
  throw err;
}
```

**Status**: ⏳ Pending

---

### 8.2 Health & Graceful Shutdown - CRITICAL

**Problem**: No health endpoint for load balancers; SIGTERM kills active requests.

**Files to Create/Modify**:
- `src/routes/health.js` - Health check endpoint
- `src/server.js` - Graceful shutdown handler

**Health Endpoint**:
```javascript
// GET /api/health
{
  status: "healthy",
  timestamp: "2026-01-06T...",
  uptime: 3600,
  database: "connected",
  version: "1.0.0"
}
```

**Graceful Shutdown**:
```javascript
process.on('SIGTERM', async () => {
  console.log('Shutdown signal received');
  await jobQueue.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

**Status**: ⏳ Pending

---

### 8.3 Chat Context Memory Leak Fix - CRITICAL

**Problem**: `pairing.js` stores chat contexts in-memory with flawed TTL logic.

**File**: `src/routes/pairing.js` (lines 17-29)

**Current Bug**:
```javascript
// Wrong: operator precedence issue
if (now - ctx.createdAt > CONTEXT_TTL) // Always true due to precedence
```

**Fix Options**:
1. Fix parentheses: `if ((now - ctx.createdAt) > CONTEXT_TTL)`
2. Move to database: Use `chat_sessions` table (already exists from 7.7)
3. Use Redis for production scalability

**Status**: ⏳ Pending

---

### 8.4 Input Validation - HIGH

**Problem**: No schema validation on POST/PUT requests. Invalid data reaches database.

**Solution**: Add Zod schema validation middleware.

**Files to Create**:
- `src/middleware/validate.js` - Validation middleware
- `src/schemas/` - Zod schemas for each entity

**Example Schema**:
```javascript
import { z } from 'zod';

export const moveBottleSchema = z.object({
  from: z.string().regex(/^[RF]\d+C?\d*$/),
  to: z.string().regex(/^[RF]\d+C?\d*$/),
});

export const createWineSchema = z.object({
  wine_name: z.string().min(1).max(200),
  vintage: z.number().int().min(1900).max(2100).nullable(),
  colour: z.enum(['red', 'white', 'rose', 'sparkling', 'dessert', 'fortified']),
  // ...
});
```

**Status**: ⏳ Pending

---

### 8.5 Error Response Standardization - HIGH

**Problem**: 362 different error response formats across routes.

**Solution**: Create error handler utility with consistent format.

**File to Create**: `src/utils/errorResponse.js`

```javascript
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
}
```

**Standard Error Codes**:
- `NOT_FOUND` - Resource doesn't exist (404)
- `VALIDATION_ERROR` - Invalid input (400)
- `CONFLICT` - Resource conflict (409)
- `UNAUTHORIZED` - Not authenticated (401)
- `FORBIDDEN` - Not authorized (403)
- `INTERNAL_ERROR` - Server error (500)
- `SERVICE_UNAVAILABLE` - Dependency down (503)

**Status**: ⏳ Pending

---

### 8.6 Frontend Event Listener Cleanup - HIGH

**Problem**: 153 event listeners never cleaned up, causing memory leaks.

**Files to Modify**:
- `public/js/app.js` - Add cleanup coordination
- `public/js/modals.js` - Cleanup on modal close
- `public/js/grid.js` - Cleanup on view change
- `public/js/dragdrop.js` - Cleanup handlers

**Solution**: Add `cleanup()` functions to each module.

```javascript
// Pattern for each module
const listeners = [];

export function init() {
  const handler = (e) => { /* ... */ };
  document.addEventListener('click', handler);
  listeners.push(['click', handler, document]);
}

export function cleanup() {
  listeners.forEach(([event, handler, target]) => {
    target.removeEventListener(event, handler);
  });
  listeners.length = 0;
}
```

**Status**: ⏳ Pending

---

### 8.7 Structured Logging - MEDIUM

**Problem**: 120+ console.log calls with no levels, filtering, or aggregation.

**Solution**: Create logger service with Winston.

**File to Create**: `src/utils/logger.js`

```javascript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

export default logger;
```

**Log Levels**:
- `error` - Errors requiring attention
- `warn` - Warnings (degraded service)
- `info` - Normal operations
- `debug` - Detailed debugging (disabled in prod)

**Status**: ⏳ Pending

---

### 8.8 API Pagination - MEDIUM

**Problem**: GET endpoints return all records; large cellars cause performance issues.

**Files to Modify**:
- `src/routes/wines.js` - Add pagination to GET /wines
- `src/routes/consumption.js` - Add pagination to history

**Standard Pagination Format**:
```javascript
// GET /api/wines?limit=50&offset=0
{
  data: [...],
  pagination: {
    total: 250,
    limit: 50,
    offset: 0,
    hasMore: true
  }
}
```

**Status**: ⏳ Pending

---

### 8.9 Security Headers - MEDIUM

**Problem**: Missing HSTS header; CSP unsafe-eval in dev mode risk.

**File to Modify**: `src/middleware/csp.js`

**Add**:
```javascript
res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
```

**Status**: ⏳ Pending

---

### 8.10 Application Metrics - MEDIUM

**Problem**: No metrics for response times, error rates, queue depth.

**Solution**: Add Prometheus metrics middleware.

**File to Create**: `src/middleware/metrics.js`

**Metrics to Track**:
- `http_requests_total` - Request count by endpoint/status
- `http_request_duration_seconds` - Response time histogram
- `db_query_duration_seconds` - Database query times
- `job_queue_depth` - Background job queue size
- `circuit_breaker_state` - Circuit breaker status

**Status**: ⏳ Pending

---

### Implementation Order

| Sub-Phase | Priority | Complexity | Status |
|-----------|----------|------------|--------|
| 8.1 Transaction safety | CRITICAL | Medium | ⏳ Pending |
| 8.2 Health & graceful shutdown | CRITICAL | Low | ⏳ Pending |
| 8.3 Memory leak fix | CRITICAL | Low | ⏳ Pending |
| 8.4 Input validation | HIGH | Medium | ⏳ Pending |
| 8.5 Error standardization | HIGH | Medium | ⏳ Pending |
| 8.6 Event listener cleanup | HIGH | Medium | ⏳ Pending |
| 8.7 Structured logging | MEDIUM | Low | ⏳ Pending |
| 8.8 API pagination | MEDIUM | Low | ⏳ Pending |
| 8.9 Security headers | MEDIUM | Low | ⏳ Pending |
| 8.10 Application metrics | MEDIUM | Medium | ⏳ Pending |

**Estimated Total Effort**: ~40-50 hours

---

### Files to Create

- `src/routes/health.js` - Health check endpoint
- `src/middleware/validate.js` - Zod validation middleware
- `src/schemas/*.js` - Entity validation schemas
- `src/utils/errorResponse.js` - Error handling utilities
- `src/utils/logger.js` - Winston logger
- `src/middleware/metrics.js` - Prometheus metrics

### Files to Modify

- `src/server.js` - Health routes, graceful shutdown, error handler
- `src/routes/slots.js` - Transaction wrapping
- `src/routes/pairing.js` - Fix TTL logic
- `src/middleware/csp.js` - HSTS header
- `src/routes/wines.js` - Pagination
- `public/js/*.js` - Event listener cleanup

---

*Last updated: 6 January 2026*
*Status: Phases 1-7 complete, Phase 8 in progress*
