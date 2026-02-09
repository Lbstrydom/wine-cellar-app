# Fix Plan — Codebase Audit Remediation

**Created**: 2026-02-09
**Source**: Full codebase audit (99 services, 34 routes, ~30 frontend JS, 16 config)
**Estimated dead LOC**: ~4,300+

---

## Phasing Strategy

| Phase | Focus | Risk | Files touched |
|-------|-------|------|---------------|
| **1** | Security fixes | HIGH | 4 files |
| **2** | Bug fixes | MEDIUM | 4 files |
| **3** | Dead file removal | LOW-MED | ~16 files deleted |
| **4** | Dead export cleanup | LOW | ~15 files trimmed |
| **5** | Duplication & code quality | LOW | ~10 files |
| **6** | Directory structure (`src/services/`) | MEDIUM | ~70 files moved |

Phases 1–2 should be done ASAP (security + correctness). Phases 3–5 are housekeeping — lower risk, no behaviour change.

---

## Phase 1 — Security Fixes

### 1.1 Admin route missing authentication

**File**: `src/routes/index.js` (line 110)
**Problem**: `/api/admin` is the only data route mounted without `requireAuth` or `requireCellarContext`. Anyone can read and modify AI review telemetry.

```javascript
// CURRENT (broken)
router.use('/admin', adminRoutes);

// FIX
router.use('/admin', requireAuth, adminRoutes);
```

**Decision (locked)**: Add `requireAuth` only — no `requireCellarContext`. The `ai_review_telemetry` table has no `cellar_id` column; it stores cross-cellar metrics. Cellar scoping is not applicable. Role-based restriction (owner-only) is deferred — current consumers are internal debugging tools.

**Test**: Verify `GET /api/admin/ai-reviews` returns 401 without a token.

---

### 1.2 Bottles route missing `cellar_id` in queries

**File**: `src/routes/bottles.js` (lines 87, 108)
**Problem**: Two queries operate on `slots` without `cellar_id` filtering. Could read/write another cellar's slots if location codes overlap (e.g., "R1C1" exists in every cellar).

**Fix** (query 1, line 87):
```sql
-- CURRENT
SELECT location_code, wine_id FROM slots WHERE location_code IN (...)

-- FIX
SELECT location_code, wine_id FROM slots WHERE cellar_id = $1 AND location_code IN (...)
```

**Fix** (query 2, line 108):
```sql
-- CURRENT
UPDATE slots SET wine_id = $1 WHERE location_code = $2

-- FIX
UPDATE slots SET wine_id = $1 WHERE location_code = $2 AND cellar_id = $3
```

**Test**: Add unit test confirming cellar isolation (two cellars with same location codes).

---

### 1.3 Raw `fetch()` bypassing auth headers

**Files**: `public/js/recommendations.js` (line 148), `public/js/globalSearch.js` (line 222)
**Problem**: Both use raw `fetch()` with a local `API_BASE` constant instead of the `api.js` module. Calls have no Bearer token or X-Cellar-ID header → 401 in multi-user production.

**Fix**: Replace raw `fetch()` with imports from `api.js`:

```javascript
// recommendations.js — CURRENT
const API_BASE = '/api';
const response = await fetch(`${API_BASE}/reduce-now/ai-recommendations?${params}`);

// FIX: import { fetch } from './api.js' at the top, remove local API_BASE
import { fetch } from './api.js';
const response = await fetch(`/api/reduce-now/ai-recommendations?${params}`);
```

Same pattern for `globalSearch.js`.

**Test**: The existing regression test `tests/unit/utils/apiAuthHeaders.test.js` does **not** currently catch these. Its `RAW_FETCH_PATTERNS` (line 19) only match literal `fetch('/api/...')` — the `${API_BASE}/api/...` template pattern in `recommendations.js` and `globalSearch.js` evades the scanner.

**Pre-requisite**: Before relying on the scanner, extend `RAW_FETCH_PATTERNS` in `apiAuthHeaders.test.js` to also match `fetch(\`${...}/api/` template literal patterns. Then confirm both files fail the scan (before fix) and pass (after fix).

---

## Phase 2 — Bug Fixes

### 2.1 Shadowed route: `GET /api/wines/:id/ratings`

**Files**: `src/routes/wineRatings.js` (line 43), `src/routes/ratings.js` (line 34), `src/routes/index.js` (lines 85–87)
**Problem**: Both files define `GET /:id/ratings` and both are mounted on `/wines`. Since `wineRatingsRoutes` is mounted first, Express matches its simpler handler (returns raw `wine_source_ratings` rows). The richer handler in `ratings.js` (aggregated data with awards, preferences) can never execute.

**Contract (locked)**: The frontend **requires the rich response**. `public/js/ratings.js` consumes `source_short` (L172), `local_awards` (L209), `confidence_level` (L103), and `index` (L146) — all fields only present in the rich `ratings.js` handler (L72–90), not the simple `wineRatings.js` handler.

**Fix**: Rename the `wineRatings.js` endpoint from `GET /:id/ratings` to `GET /:id/source-ratings`. Add a matching `getWineSourceRatings(wineId)` function in `public/js/api/ratings.js` for any future direct consumer. No existing frontend code calls the simple endpoint, so no UI changes needed.

**Test**: After fix, verify `GET /api/wines/:id/ratings` returns the rich shape (includes `source_short`, `local_awards`). Add a test for &`GET /api/wines/:id/source-ratings` returning raw rows.

---

### 2.2 `const debounceTimer` bug in `recommendations.js`

**File**: `public/js/recommendations.js` (line 52)
**Problem**: `debounceTimer` is declared `const` (immutable). `clearTimeout(debounceTimer)` on line 58 always passes `null` — the debounce never actually cancels anything.

**Context check**: The debounce is only used inside an Enter keypress handler, and is immediately followed by `loadRecommendations()`. So `clearTimeout(null)` is a no-op but doesn't cause visible breakage because Enter triggers load directly. Still, the code is misleading.

**Fix**: Either change to `let debounceTimer = null` if debounce is intended, or remove the `clearTimeout` call if Enter-on-demand is the intended UX (current behaviour). Given the comment says "don't auto-load on every keystroke" and the handler only fires on Enter, the debounce is unnecessary — remove it:

```javascript
// CURRENT
const debounceTimer = null;
if (foodDetailInput) {
    foodDetailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        loadRecommendations();
      }
    });
}

// FIX: remove dead debounce since Enter fires directly
if (foodDetailInput) {
    foodDetailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadRecommendations();
      }
    });
}
```

---

### 2.3 Duplicate `normaliseScore` functions

**Files**: `src/config/unifiedSources.js` (line 1471), `src/services/scoreNormalization.js` (line 53)
**Problem**: Two different functions with the same name but different signatures and logic. Config version is test-only; service version is in production.

**Fix**: Remove the config version from `unifiedSources.js`. Update any tests that import it to use the service version instead, or remove those test cases if they duplicate tests already in `scoreNormalization.test.js`.

---

### 2.4 Dead aliases in `unifiedSources.js`

**File**: `src/config/unifiedSources.js` (lines 1520–1522)
**Problem**: `RATING_SOURCES`, `SOURCE_REGISTRY`, `getSourceConfig` are export aliases of `SOURCES`, `SOURCES`, and `getSource` respectively. Every consumer imports the **originals** and renames with `as` at the import site — they do NOT import these aliases:

```javascript
// What consumers actually write (importing SOURCES, renaming to RATING_SOURCES):
import { SOURCES as RATING_SOURCES } from '../config/unifiedSources.js';

// What would use the alias (nobody does this):
import { RATING_SOURCES } from '../config/unifiedSources.js';
```

Verified consumers: `sourceSelection.js` L7 (`SOURCES as SOURCE_REGISTRY`), `ratings.js` L6 (`SOURCES as RATING_SOURCES`), `ratingExtraction.js` L9 (`getSource as getSourceConfig`), `ratingsTier.js` L12 (`SOURCES as RATING_SOURCES`).

**Verification step**: Run `grep -rn "import.*{ RATING_SOURCES\|import.*{ SOURCE_REGISTRY\|import.*{ getSourceConfig" src/` — should return zero matches. If any match, that consumer uses the alias and must be updated.

**Fix**: Remove the 3 dead alias exports. No consumers reference them directly.

---

## Phase 3 — Dead File Removal

Low risk — these files have zero production imports. Remove the file and any dedicated test file.

### 3.1 Dead service files (4 files, ~1,100 lines)

| File | Lines | Reason dead | Test file to remove |
|------|-------|-------------|---------------------|
| `src/services/blockedDetection.js` | 273 | Zero imports anywhere | Check for test file |
| `src/services/chatSessions.js` | 327 | Superseded by `pairingSession.js` | Check for test file |
| `src/services/producerDiscovery.js` | 228 | Planned feature never integrated | Check for test file |
| `src/services/storagePlacement.js` | 272 | Superseded by `cellarPlacement.js` | Check for test file |

---

### 3.2 Dead subgraph chains (7 files, ~1,400 lines)

These files only reference each other — no live entry point reaches them.

**Accuracy alerting subgraph** (2 files):
- `src/services/accuracyAlerting.js`
- `src/services/accuracyMetrics.js`

**Scraping governance subgraph** (3 files):
- `src/services/scrapingGovernance.js`
- `src/services/provenance.js`
- `src/services/rateLimiter.js` (the service — NOT the middleware, which IS used)

**Producer crawler subgraph** (2 files):
- `src/services/producerCrawler.js`
- `src/services/robotsParser.js`

Remove each file and its corresponding test file (if any).

**Caution**: Confirm `src/services/rateLimiter.js` is distinct from `src/middleware/rateLimiter.js` before deleting. The middleware is actively used.

---

### 3.3 Dead config files (2 files, ~745 lines)

| File | Lines | Reason dead |
|------|-------|-------------|
| `src/config/languageConfig.js` | 242 | Only consumer is `marketPacks.js` (also dead) |
| `src/config/marketPacks.js` | 503 | Zero imports from `src/` |

Also remove their test files:
- `tests/unit/config/languageConfig.test.js`
- `tests/unit/config/marketPacks.test.js`

---

### 3.4 Test-only services (3 files, ~1,070 lines)

These have tests but zero production imports. Decisions locked:

| File | Lines | Decision |
|------|-------|----------|
| `src/services/searchMetrics.js` | 240 | **Remove** — route queries DB directly, this class is bypassed. Remove test file too. |
| `src/services/searchSessionContext.js` | 439 | **Remove** — superseded by `searchBudget.js`. Remove test file too. |
| `src/services/structuredParsers.js` | 393 | **Keep** — comprehensive JSON-LD/microdata parsers for ratings pipeline V2. Add `@planned` JSDoc tag. |

---

### 3.5 Dead / vestigial route files

| File | Endpoints | Action |
|------|-----------|--------|
| `src/routes/layout.js` | 1 | **Remove** — self-labelled "Legacy", superseded by `/api/stats/layout` |
| `src/routes/searchMetrics.js` | 6 | **Remove** — in-memory storage, no frontend, service class also dead |

Also remove their mounts from `src/routes/index.js`.

**Integration test impact**: `tests/integration/api.test.js` has tests for both routes — layout tests (L145–154) and searchMetrics tests (L308–454, ~10 tests). These tests must be removed in the same commit as the route deletion. Failing to do so will break CI.

**Note**: `src/routes/consistency.js` (3 endpoints, no frontend) and `src/routes/admin.js` (2 endpoints) may have CLI/debug value. Keep but add auth to admin (Phase 1.1). Revisit consistency removal later.

---

## Phase 4 — Dead Export Cleanup

Trim unused exports from files that are otherwise alive. No file deletions — just removing dead functions/constants.

### 4.1 High-value targets (most dead exports per file)

| File | Dead exports to remove | Keep |
|------|------------------------|------|
| `src/config/tastingVocabulary.js` | `INTENSITY_LEVELS`, `SWEETNESS_LEVELS`, `BODY_LEVELS`, `STRUCTURAL_LEVELS`, `FINISH_LEVELS`, `findTermCategory()`, `getDisplayName()` (7 exports) | `FRUIT_DESCRIPTORS`, `SECONDARY_DESCRIPTORS`, `TERTIARY_DESCRIPTORS`, `TEXTURE_DESCRIPTORS`, `STYLE_TAGS`, `getAllFruitTerms()`, `getAllSecondaryTerms()`, `getAllTertiaryTerms()` |
| `src/config/pairingRules.js` | `getStyleBuckets()`, `getSignalDetails()`, `getStyleDetails()` (3) | All scoring/signal data |
| `src/config/fridgeParLevels.js` | `getParLevelConfig()`, `getCategoriesInPriorityOrder()`, `getMinimumParLevelTotal()` (3) | Par level constants used by `fridgeStocking.js` |
| `src/config/noiseTerms.js` | `FOOD_PAIRING_NOISE`, `MARKETING_HYPERBOLE`, `PAIRING_CONTEXT_PHRASES`, `isMarketingNoise()`, `hasPairingContext()` (5) | `isNoiseTerm()` (the only production import) |
| `src/config/scraperConfig.js` | `VIVINO_SELECTORS` (1) | Everything else |
| `src/db/helpers.js` | `ilike()`, `upsert()` (2) | `stringAgg()`, `nowFunc()`, `nullsLast()` |

### 4.2 Config files with internal-only exports

These exports exist only for unit test access. Options:
1. **Leave as-is** — common pattern, tests need access.
2. **Mark with `@internal` JSDoc** — clarifies they're not public API.
3. **Remove export + test coverage** — only if the test duplicates coverage from higher-level tests.

**Recommendation**: Add `@internal` JSDoc to these rather than removing. They're tested and harmless.

Applies to: `vintageSensitivity.js` (3), `rangeQualifiers.js` (2), `grapeColourMap.js` (3), `aiModels.js` (6).

### 4.3 Backend service unused exports

| File | Dead exports |
|------|-------------|
| `src/services/cacheService.js` | `invalidateWineCache()`, `updateCacheConfig()`. Also un-export `generateCacheKey()` and `generateSlotHash()` (internal-only — keep the functions, just remove `export` keyword). |
| `src/services/cellarAllocation.js` | `getRowAllocation()` |
| `src/services/cellarPlacement.js` | `recommendPlacement()` |
| `src/services/windowDefaults.js` | `estimateQualityTier()`, `normaliseGrape()`, `normaliseRegion()`, `normaliseStyle()`, `normaliseColour()`, `getFallbackByColour()` — all internal-only. Un-export but keep functions. |

### 4.4 Frontend unused exports

| File | Dead exports |
|------|-------------|
| `public/js/grid.js` | `cleanupGrid()`, `getZoomLevel()` |
| `public/js/virtualList.js` | `scrollToIndex()`, `getScrollInfo()`, `isVirtualListActive()` |
| `public/js/errorBoundary.js` | `withErrorBoundary()`, `safeAsync()` |
| `public/js/eventManager.js` | `cleanupAll()` (keep `getListenerCount`/`getTotalListenerCount` for `browserTests.js`) |
| `public/js/storageBuilder.js` | `removeArea()`, `removeRow()`, `setColumns()`, `onChange()` |
| `public/js/restaurantPairing.js` | ~~`destroyRestaurantPairing()`~~ [VERIFIED LIVE — called internally at L307, exported at L285] |
| `public/js/cellarAnalysis.js` | `resetZoneChat` re-export |
| `public/js/cellarAnalysis/state.js` | `resetAnalysisState()` |
| `public/js/cellarAnalysis/moveGuide.js` | ~~`closeMoveGuide()`, `isMoveGuideActive()`~~ [VERIFIED TEST-ONLY — kept with @internal tag], `annotateGrid()` |
| `public/js/api/pairing.js` | ~~`clearSommelierChat()`~~ [VERIFIED LIVE — re-exported in api/index.js L99] |

Also remove the dead `export default { ... }` objects from: `virtualList.js`, `recommendations.js`, `globalSearch.js`, `eventManager.js`.

**Note**: `runQuickPairFlow()` in `restaurantPairing.js` is **actively used** — called at L90, exported at L228, tested at `restaurantPairing.test.js` L338+L362. Not a dead export.

---

## Phase 5 — Code Quality

### 5.1 Deduplicate `escapeHtml()`

**3 copies**: `utils.js` (canonical), `tastingService.js` (private), `errorBoundary.js` (private).

**Fix**: Delete the private copies in `tastingService.js` and `errorBoundary.js`. Add `import { escapeHtml } from './utils.js'` to both.

---

### 5.2 Deduplicate `renderStars()`

**2 copies**: `ratings.js` (exported), `bottles/wineConfirmation.js` (private, different impl).

**Fix**: Import from `ratings.js` in `wineConfirmation.js`. Reconcile any implementation differences first.

---

### 5.3 Remove `console.log` from production frontend

~63 `console.*` statements across frontend JS. Categorise before removing:

| Category | Action |
|----------|--------|
| `console.error` in catch blocks | **Keep** — legitimate error reporting |
| `console.warn` for degraded state | **Keep** — useful diagnostics |
| `console.log` for auth/SW/PWA in `app.js` | **Wrap in `if (DEBUG)` check** or remove. These are noisy in production. |
| `console.log` debug messages in `ratings.js` | **Remove** — clearly dev leftovers (`[TastingNotes] Updated modal...`) |

---

### 5.4 Remove unused `_NAMESPACE` constant

**File**: `public/js/app.js` (line 39)
**Fix**: Delete `const _NAMESPACE = 'app';` — "Reserved for future" comment has been there since forever.

---

### 5.5 Standardise Claude client usage

**File**: `src/services/pairingEngine.js`
**Problem**: Creates its own `new Anthropic()` instead of importing from `claudeClient.js` like the other 5 Claude consumers.

**Guardrail**: `pairingEngine.js` (L15) uses a nullable client pattern: `process.env.ANTHROPIC_API_KEY ? new Anthropic() : null`. This allows deterministic-only pairing when no API key is set. `claudeClient.js` (L8) always instantiates `new Anthropic({...})` and will throw if no API key is present.

**Acceptance criterion**: Either (a) modify `claudeClient.js` to export a nullable client (check `ANTHROPIC_API_KEY` before instantiating), or (b) create an adapter wrapper. The fix **must** preserve `pairingEngine.js` behaviour where missing API key → null client → deterministic-only pairing. Do not replace the nullable pattern with a hard-fail import.

**Fix**: Modify `claudeClient.js` to support nullable mode, then import from it in `pairingEngine.js`.

---

### 5.6 File size review — apply judgment, not a blanket rule

The AGENTS.md guideline says ~500 lines. But file size alone isn't the metric — **coherence of purpose** matters. Assessment:

| File | Lines | Verdict | Rationale |
|------|-------|---------|-----------|
| `src/config/unifiedSources.js` | 1442 | **Keep as-is** | ~1300 lines are source definition data (70 entries). The utility functions at the bottom (score normalization, domain extraction) are tightly coupled to the data. Splitting would scatter related concerns. After Phase 4 cleanup (~10 dead exports removed) it'll be ~1350 lines — acceptable for a data registry. |
| `public/js/settings.js` | 1239 | **Split candidate** | Settings handles backup import/export, credential management, storage builder, theme, and display preferences. These are 5+ distinct responsibilities. Consider splitting: `settings-backup.js`, `settings-credentials.js`, and keeping the rest in `settings.js`. |
| `public/js/app.js` | 1014 | **Split candidate** | Main entry point handles auth flow, SW registration, PWA install, tab switching, modal management, and grid init. The auth/SW/PWA code (~300 lines) could move to a dedicated `auth.js` or `pwa.js` module. The rest is legitimate app bootstrap. |
| `public/js/ratings.js` | 698 | **Keep as-is** | All rating UI logic — display, modal, tasting notes tab, star rendering. Coherent single responsibility: "the ratings panel". |
| `src/services/cacheService.js` | 664 | **Keep as-is** | Unified cache for layouts, stats, and cellar data. Multiple cache stores but they share TTL, invalidation, and config logic. Cohesive module. After Phase 4 cleanup (~4 exports un-exported) it stays the same size but cleaner API surface. |
| `src/services/openaiReviewer.js` | 638 | **Keep as-is** | Single reviewer service with model fallback, schema validation, timeout management. All tightly integrated. |
| `public/js/tastingService.js` | 646 | **Marginal** | Rendering functions for tasting notes, temperature, drinking windows. After dedup of `escapeHtml` (Phase 5.1), drops to ~635. Could split temperature + drinking window rendering out, but they share HTML patterns. **Keep for now.** |
| `src/services/vivinoSearch.js` | 617 | **Keep as-is** | Vivino API integration — search, detailed fetch, image match, response parsing. Single external service integration. |
| `public/js/grid.js` | 551 | **Keep as-is** | Grid rendering — slots, zoom, scroll, colouring. Single responsibility. |
| All others 500–550 | — | **Keep as-is** | Marginal oversize, coherent purpose. |

**Action items** (only the clear wins):
- `public/js/settings.js` → Extract backup logic to `public/js/settings-backup.js` (~200 lines)
- `public/js/app.js` → Consider extracting PWA/SW code to `public/js/pwa.js` (~150 lines). Lower priority — `app.js` is the natural entry point.

---

## Phase 6 — Directory Structure (`src/services/`)

### Problem

`src/services/` contains **99 flat files** with zero subdirectories. This is the largest structural violation of best practice in the codebase. Finding a file requires knowing its exact name; related files (e.g., all search-related services) have no grouping.

Other directories are well-sized: `src/routes/` (34 files — flat is defensible for REST routes), `src/config/` (16), `src/middleware/` (6), `src/schemas/` (13), `src/utils/` (6). The frontend already follows subdirectory patterns: `public/js/api/` (14), `bottles/` (9), `cellarAnalysis/` (12), `restaurantPairing/` (6).

### Proposed domain groupings

Move files into subdirectories by domain. Each subdirectory gets an `index.js` barrel if needed for backward-compatible imports.

| Subdirectory | Files (~count) | Examples |
|---|---|---|
| `services/search/` | ~12 | `searchGoogle`, `queryBuilder`, `searchBudget`, `searchCache`, `searchConstants`, `searchProviders`, `urlScoring`, `relevanceScoring`, `serpAi`, `geminiSearch`, `fetchClassifier`, `documentFetcher` |
| `services/ratings/` | ~5 | `ratings`, `ratingExtraction`, `scoreNormalization`, `sourceSelection`, `responseValidator` |
| `services/cellar/` | ~8 | `cellarAllocation`, `cellarPlacement`, `cellarSuggestions`, `cellarHealth`, `cellarMetrics`, `cellarNarratives`, `cellarAI`, `cellarAnalysis` |
| `services/pairing/` | ~6 | `pairing`, `pairingEngine`, `pairingSession`, `sommelier`, `restaurantPairing`, `menuParsing` |
| `services/scraping/` | ~6 | `pageFetcher`, `authenticatedScraping`, `decanterScraper`, `vivinoSearch`, `puppeteerScraper`, `documentHandlers` |
| `services/wine/` | ~6 | `wineIdentity`, `wineFingerprint`, `wineNameParser`, `wineParsing`, `wineAddOrchestrator`, `nameProcessing` |
| `services/ai/` | ~4 | `claudeClient`, `claude`, `openaiReviewer`, `drinkNowAI` |
| `services/zone/` | ~7 | `zoneChat`, `zoneMetadata`, `zonePins`, `zoneCapacityAdvisor`, `zoneReconfigurationPlanner`, `zoneLayoutProposal`, `reconfigurationPlanStore`, `reconfigurationTables` |
| `services/awards/` | ~6 | `awards`, `awardExtractorPDF`, `awardExtractorWeb`, `awardMatcher`, `awardParser`, `awardSourceManager`, `awardStringUtils` |
| `services/shared/` | ~10 | `cacheService`, `circuitBreaker`, `encryption`, `fetchUtils`, `inputSanitizer`, `jobQueue`, `rateLimiter`, `retryBudget`, `consistencyChecker` |
| (root — unmoved) | ~29 | Miscellaneous single-purpose files: `fridgeStocking`, `movePlanner`, `servingTemperature`, `drinkingStrategy`, etc. |

### Execution notes

- **Status**: COMPLETE (atomic approach — all moves + rewrites in a single pass)
- **Actual scope**: 81 files moved into 10 subdirectories, 5 root orchestrators unmoved
- **Import rewrites**: ~290 total — Category A (outbound `../db/` etc. → `../../`): ~120, Category B (internal service→service): 61, Category C (inbound static from routes/jobs/tests/scripts): 105, Category D (dynamic `import()`): ~24, plus 17 `vi.mock`/`vi.doMock` path rewrites in tests
- **Test files moved**: 12 test files into matching subdirectories under `tests/unit/services/`
- **Detailed plan**: See `curried-rolling-salamander.md` in `.claude/plans/`

---

## Execution Order

```
Phase 1 (security)  →  Phase 2 (bugs)  →  Phase 3 (dead files)  →  Phase 4 (dead exports)  →  Phase 5 (quality)  →  Phase 6 (structure)
     ASAP                  ASAP              Next sprint              Next sprint               Ongoing                   Low priority
```

### Pre-flight for each phase

1. `npm run test:unit` — baseline must pass
2. Apply changes
3. `npm run test:all` — verify no regressions
4. Commit with conventional prefix (`fix:`, `refactor:`, `chore:`)
5. Push and verify Railway deploy health

### Commit strategy

- **Phase 1**: One commit per fix (3 commits) — each security fix should be independently reviewable
- **Phase 2**: One commit per fix (4 commits)
- **Phase 3**: One commit per subgroup (3.1, 3.2, 3.3, etc.) — batch related deletions
- **Phase 4**: One commit per file cluster (4.1 config, 4.3 services, 4.4 frontend)
- **Phase 5**: One commit per task (5.1 escapeHtml dedup, 5.3 console cleanup, etc.)

---

## Not Addressed (Intentional)

| Item | Reason to defer |
|------|-----------------|
| ~60 dead backend endpoints (no frontend caller) | Many may be used by MCP tools, CLI scripts, or planned features. Audit each before removing. |
| In-memory `chatContexts` Map in `pairing.js` | Functional for single-instance Railway. Persistence would be Phase G+ scope. |
| `searchMetrics.js` in-memory storage | Entire route is being deleted in Phase 3.5. |
| `claude.js` barrel re-export | Adds indirection but is a clean pattern with 3 consumers. Not worth changing. |
| `searchProviders.js` mega-barrel | 2 production consumers, heavily tested. Refactoring the façade is high effort for low gain. |
| `FEATURE_FLAGS` underuse | Feature flags need a broader audit of which services should check them. Separate initiative. |
| `structuredParsers.js` (test-only) | Keeping for potential ratings pipeline V2. |
