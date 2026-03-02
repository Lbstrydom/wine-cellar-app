# Wine Search Pipeline Simplification Plan

## Context

The current wine rating search uses a 4-tier waterfall (SERP AI → Claude Web Search → Gemini Hybrid → Legacy Deep Scraping) spanning 15+ files, 3 API vendors, credential storage, and direct site scraping via BrightData Web Unlocker and Puppeteer. Despite this complexity, it produces narrower results than a single Claude Web Search call in the SERT/ai-organiser app, which returned a rich multi-section wine profile (producer, terroir, grape, winemaking, tasting notes, food pairings, critical reception with scores) from one API call.

**Problem**: Over-engineered pipeline, poor result quality, legal risk from scraping/credentials, 3 vendor dependencies.

**Solution**: Replace the entire waterfall with a single unified Claude Web Search call that returns both structured JSON (ratings, entities, drinking windows) and rich prose narrative. Inject country-specific competition/critic names from `unifiedSources.js` to ensure local awards coverage. Model: Sonnet 4.6.

**Outcome**: ~3,800 lines removed, 1 API vendor (Anthropic only — BrightData fully removed), no scraping/credentials, richer results, lower latency, legally clean for commercial deployment.

---

## Architecture: Before and After

### Current State (4 tiers, 15+ files)

```
threeTierWaterfall.js ─┬─> serpAi.js ─────────── BrightData SERP AI
                       ├─> claudeWebSearch.js ─── Anthropic Web Search (narrow extraction)
                       ├─> geminiSearch.js ─────── Gemini + Haiku extraction
                       └─> ratingExtraction.js ─── searchProviders.js ─┬── searchGoogle.js
                                                                       ├── pageFetcher.js
                                                                       ├── documentFetcher.js
                                                                       ├── producerSearch.js
                                                                       ├── authenticatedScraping.js
                                                                       ├── vivinoSearch.js
                                                                       ├── decanterScraper.js
                                                                       └── puppeteerScraper.js
```

### Target State (1 file, 1 call)

```
claudeWineSearch.js ──> Anthropic Web Search (web_search_20260209)
                        + save_wine_profile tool (structured JSON)
                        + prose narrative (text blocks after last search result)

Supporting (kept):
  unifiedSources.js     → country-specific critic/competition injection
  wineIdentity.js       → identity validation gate
  ratings.js            → normalizeScore, calculateWineRatings, saveRatings
  vintageSensitivity.js → vintage filtering
  ratingExtraction.js   → saveExtractedWindows (gutted, only this function kept)
  awards/*              → separate feature, standard fetch() for pages, PDF for booklets
```

---

## Phase 1: Build Unified Search Module ✅ COMPLETE

> New files only. Existing pipeline untouched. Deployable with zero risk.

### 1.1 Create `src/services/search/claudeWineSearch.js`

Core unified search module. Single Claude Web Search API call with:

**System prompt** — asks for structured narrative sections (Producer, Grape, Terroir, Winemaking, Tasting Notes, Food Pairings, Critical Reception, Drinking Window) with inline citations.

**Dynamic country injection** — before the API call, look up `wine.country` in `unifiedSources.js` via `getSourcesForCountry()`. Filter for competitions (lens=competition, relevance≥0.3) and critics (lens=critic/panel_guide, relevance≥0.3). Inject their names + score formats into the prompt. Example for South Africa:
```
Priority local sources: Platter's Wine Guide (stars/5), Veritas Awards (medal),
Old Mutual Trophy Wine Show (medal), Tim Atkin SA Special Report (points/100)
International: Decanter World Wine Awards, IWC, IWSC, Concours Mondial, Mundus Vini
Community: Vivino, CellarTracker
```

**Tools provided**:
- `{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }`
- `{ type: 'web_fetch_20260209', name: 'web_fetch' }`
- `save_wine_profile` — custom tool for structured JSON output

**`save_wine_profile` tool schema** — expanded from current `save_wine_ratings`:
```
ratings[]        — source, source_lens, score_type, raw_score, raw_score_numeric,
                   reviewer_name, tasting_notes, vintage_match, confidence,
                   source_url, competition_year, rating_count
tasting_notes{}  — nose[], palate[], structure{body,tannins,acidity}, finish
drinking_window{}— drink_from, drink_by, peak, recommendation
food_pairings[]  — string array
grape_varieties[]— string array
producer_info{}  — name, region, country, description
style_summary    — string
awards[]         — competition, year, award, category
```

**Response parser** (SERT preamble-filtering pattern):
1. Find last `web_search_tool_result` block index
2. Collect text blocks AFTER that index → prose narrative
3. Extract `tool_use` block (name=`save_wine_profile`) → structured JSON
4. Extract source URLs from `web_search_tool_result` blocks → citation list
5. Extract `web_search_result_location` citations from text blocks → frequency scoring
6. Fallback: `extractJsonWithRepair()` on prose if no tool_use block

**Model**: `getModelForTask('webSearch')` → Sonnet 4.6 (env-overridable via `CLAUDE_MODEL_WEBSEARCH`).

**Key files to reuse**:
- `src/config/unifiedSources.js` — `getSourcesForCountry()`, `REGION_SOURCE_PRIORITY`
- `src/services/ai/claudeClient.js` — shared Anthropic client
- `src/config/aiModels.js` — `getModelForTask('webSearch')`
- `src/services/shared/jsonUtils.js` — `extractJsonWithRepair()`

### 1.2 Create `src/services/search/citationScoring.js`

Citation frequency scoring + domain trust overlay:
- Count how many times each URL appears in citations
- `score = citationCount / maxCitationCount` (uncited = 0.1)
- Overlay `credibility` from `unifiedSources.js` source matching by domain
- Export: `scoreByCitationFrequency(citations, sourceUrls, country)`

### 1.3 Create `tests/unit/services/search/claudeWineSearch.test.js`

Unit tests mocking Anthropic client. Test:
- Prompt construction with country-specific injection (SA, France, Greece, default)
- tool_use block extraction (happy path)
- Preamble filtering (text before last search result excluded)
- Text fallback when no tool_use block
- Source URL extraction from web_search_tool_result blocks
- Citation extraction and frequency scoring
- Error handling (API failure, empty response, missing tool_use)
- Beta header presence
- NV vintage handling
- Profile context injection (style, grapes, region)

### 1.4 Verification ✅
- `npm run test:unit` passes (2,901 tests: 40 claudeWineSearch + 13 citationScoring new)
- No existing code changed
- Deployable as-is (new files only)

---

## Phase 2: Wire Unified Search into Rating Fetch (core switch) ✅ COMPLETE

> Replace the waterfall call sites. Old files still exist but are no longer called. Reversible.

### 2.1 Create `src/jobs/unifiedRatingFetchJob.js`

New async job handler. Calls `unifiedWineSearch(wine)` then persists results using existing functions:
- `buildIdentityTokensFromWine(wine)` + `validateRatingsWithIdentity()` from `ratings.js`
- `filterRatingsByVintageSensitivity()` from `vintageSensitivity.js`
- `normalizeScore()` from `ratings.js`
- `saveRatings()` from `ratings.js`
- `saveExtractedWindows()` from `ratingExtraction.js`
- `calculateWineRatings()` from `ratings.js`
- Store prose narrative in `wines.tasting_notes`
- Grape backfill if wine had none

Output shape must match current job handler for frontend compatibility.

**CRITICAL: Multi-tenant scoping in job payload and queries.**
The current `ratingFetchJob.js` has a tenant-scoping bug: it queries `SELECT * FROM wines WHERE id = ?` without `cellar_id`. The new job handler MUST:
1. Accept `cellarId` in the job payload (passed from the route that enqueues)
2. Query with `WHERE id = ? AND cellar_id = ?` in all DB operations
3. Pass `cellarId` to all downstream persistence functions

Update `src/routes/ratings.js` (line 285) to include `cellarId: req.cellarId` in the job payload:
```javascript
const jobId = await jobQueue.enqueue('rating_fetch', {
  wineId: parseInt(wineId),
  cellarId: req.cellarId,  // ADD THIS
  forceRefresh
}, { priority: 3 });
```

**CRITICAL: Data-preservation invariant (no-delete-on-empty).**
The current `ratingsTier.js` (lines 70-88) preserves existing ratings when search returns zero valid replacements. This invariant MUST be replicated exactly:
```javascript
if (newRatings.length === 0) {
  // DO NOT delete existing ratings — return them unchanged
  return { message: 'No new ratings found, existing ratings preserved', ... };
}
```
This prevents data loss when search fails or identity gate rejects all results.

### 2.2 Update `src/server.js`

Change job handler import:
```javascript
// FROM: import handleRatingFetch from './jobs/ratingFetchJob.js';
// TO:   import handleRatingFetch from './jobs/unifiedRatingFetchJob.js';
```

### 2.3 Update `src/routes/ratingsTier.js`

Replace `threeTierWaterfall` import with `unifiedWineSearch` from `claudeWineSearch.js`. Same persistence logic, same response shape. The sync `POST /api/wines/:wineId/ratings/fetch` endpoint returns identical JSON.

### 2.4 Update `src/jobs/batchFetchJob.js`

Replace `threeTierWaterfall` import with `unifiedWineSearch`. Same loop pattern.

### 2.5 Verification

**Automated tests (add to `tests/unit/jobs/unifiedRatingFetchJob.test.js`):**
- API response shape: `GET /api/wines/:id/ratings` returns all required fields (`purchase_score`, `purchase_stars`, `confidence_level`, `lens_details{competition,critics,community}`, `ratings[]`, `local_awards[]`)
- No-delete-on-empty: when search returns zero valid ratings, existing ratings are preserved unchanged
- Cellar scoping: job handler queries include `cellar_id` filter; wine belonging to cellar B is not accessible from cellar A's job
- Identity gate: ratings with wrong producer/vintage are rejected before persistence
- Narrative storage: `wines.tasting_notes` is updated with prose when search succeeds

**Manual verification:**
- `npm run test:unit` passes
- `npm run test:integration` passes
- Deploy to Railway
- Test: `POST /api/wines/:id/ratings/fetch-async` → poll → ratings appear
- Verify: `GET /api/wines/:id/ratings` returns same shape as before
- Monitor Railway logs: expect `method: unified_claude_search`
- Manual test: 5+ wines across different countries, compare result richness

### Rollback (Phase 2 only — before Phase 3 deletions)
Revert `server.js` and `ratingsTier.js` imports back to old files. All old files still exist, so this is an instant rollback. **This rollback path is lost once Phase 3 deletions are executed.** Phase 3 must not proceed until Phase 2 quality is verified (see Phase 3 pre-deletion checklist).

---

## Phase 3: Remove Legacy Search Pipeline ✅ COMPLETE

> Delete ~3,800 lines. Point of no return — verify Phase 2 quality first.

### Pre-deletion checklist
1. Manual test 10 wines across 5+ countries
2. Compare rating count, score accuracy, prose quality vs old pipeline
3. Verify identity gate rejection rates are similar
4. Confirm no 500 errors in Railway logs over 24h

### 3.1 Delete tier-specific files (no remaining consumers)

```
src/services/search/threeTierWaterfall.js
src/services/search/serpAi.js
src/services/search/geminiSearch.js
src/services/search/claudeWebSearch.js        (replaced by claudeWineSearch.js)
src/services/search/searchGoogle.js
src/services/search/searchBudget.js
src/services/search/urlScoring.js
src/services/search/relevanceScoring.js
src/services/search/producerSearch.js
src/services/search/documentFetcher.js
src/jobs/ratingFetchJob.js                    (replaced by unifiedRatingFetchJob.js)
```

### 3.2 Delete scraping files

```
src/services/scraping/vivinoSearch.js
src/services/scraping/decanterScraper.js
src/services/scraping/authenticatedScraping.js
src/services/scraping/puppeteerScraper.js
src/services/scraping/pageFetcher.js
```

### 3.3 Delete test files for removed modules

```
tests/unit/services/search/serpAi.test.js
tests/unit/services/search/geminiSearch.test.js
tests/unit/services/search/claudeWebSearch.test.js
tests/unit/services/scraping/pageFetcherReadability.test.js
tests/integration/searchBenchmark.live.test.js
tests/manual/searchTestList.js
```

### 3.4 Frontend cleanup (MUST happen BEFORE or WITH backend deletions)

The following frontend files call endpoints being removed. Update them first to prevent broken UX on deploy.

**`public/js/bottles/wineConfirmation.js`** — Remove Vivino confirmation flow:
- Remove `import { searchVivinoWines } from '../api.js'` (line 7)
- Remove or stub `searchVivinoWines()` call (line 36)
- Remove Vivino-specific UI elements (vivinoId, vivinoUrl, "View on Vivino" link)
- The wine-add flow should work without Vivino confirmation (user enters data manually)

**`public/js/api/wines.js`** — Remove dead API functions:
- Remove `searchVivinoWines()` (line 330) — calls `POST /api/wine-search` being deleted
- Remove `getVivinoWineDetails()` (line 344) — calls `GET /api/wine-search/vivino/:id` being deleted
- Keep `setWineVivinoUrl()` (line 122) — this writes to wines table, no scraping dependency

**`public/js/api/index.js`** — Remove `searchVivinoWines` from barrel re-export (line 66)

**`public/js/api/ratings.js`** — Remove or update `refreshRatings()` (line 151):
- This calls `POST /api/wines/:id/refresh-ratings` which is being removed
- Replace with a call to the standard `POST /api/wines/:id/ratings/fetch-async` endpoint
- Or remove entirely if refresh is handled by the existing "Refresh" button in ratings panel

**`public/js/bottles/form.js`** — Remove `vivino_confirmed`, `vivino_id`, `vivino_url` from form data construction (lines 270-274). Keep `vivino_rating` field as a manual input.

**`public/index.html`** — Remove Vivino and Decanter credential UI blocks:
- Remove the Vivino credential form (lines 795-812, `data-source="vivino"`)
- Remove the Decanter credential form (lines 815-832, `data-source="decanter"`)
- Keep Paprika and Mealie credential forms (lines 835-871)

### 3.5 Surgical edits on backend files with remaining consumers

**`src/services/ratings/ratingExtraction.js`** — gut the file:
- Keep: `saveExtractedWindows()`
- Remove: `fetchWineRatings()`, `buildExtractionPrompt()`, `parseRatingResponse()`, `mergeSnippetRatings()`, `mergeAuthenticatedRatings()`, `enrichRatingsWithMetadata()`, all helper functions
- Remove imports: `searchProviders.js`, `structuredParsers.js`, `unifiedSources.js`

**`src/services/awards/awardExtractorWeb.js`** — replace BrightData page-fetch with standard fetch:
```javascript
// FROM: import { fetchPageContent } from '../search/searchProviders.js';
// TO:   Use standard fetch() + Readability extraction (no BrightData)
```
The awards page-fetch previously used BrightData Web Unlocker via `pageFetcher.js` to bypass WAFs. This creates the same CFAA risk we're eliminating from search. Replace with:
1. Standard `fetch()` with proper User-Agent header (no spoofing)
2. If a page blocks standard fetch, skip it — Claude Web Search already covers online competition results
3. Keep PDF extraction path (`awardExtractorPdf.js`) for offline booklets

**`src/services/scraping/pageFetcher.js`** — DELETE entirely (moved to Phase 3.1 deletion list):
- All consumers removed: search pipeline deleted, awards uses standard fetch
- BrightData Web Unlocker was the primary reason this file existed
- The Readability extraction logic (if still needed for awards) can be inlined into `awardExtractorWeb.js` as a simple ~20-line helper

**`src/routes/ratings.js`** — remove `POST /:wineId/ratings/hybrid-search` endpoint (Gemini experimental endpoint)

**`src/routes/wineSearch.js`** — delete entire file (Vivino confirmation flow removed)

**`src/routes/wineRatings.js`** — remove `vivinoSearch` import and Vivino-dependent `refresh-ratings` path

**`src/routes/settings.js`** — remove Vivino/Decanter credential testers from `CREDENTIAL_TESTERS` registry. Keep Paprika/Mealie testers. The generic credential CRUD endpoints (`PUT/DELETE /credentials/:source`) stay — they serve Paprika/Mealie and future integrations. Optionally add a `VALID_SOURCES` allowlist (`['paprika', 'mealie']`) to the validation schema to prevent saving credentials for removed sources.

**`src/routes/index.js`** — remove:
- `wineSearchRoutes` import and registration
- Verify `ratingsTierRoutes` still registered (rewritten in Phase 2.3)

**`src/services/wine/wineAddOrchestrator.js`** — remove `vivinoSearch` import. Remove Vivino lookup path.

**`src/services/ai/index.js`** — remove `fetchWineRatings` re-export. Keep `saveExtractedWindows`.

### 3.6 Verification
- `npm run test:unit` passes (no broken imports)
- `npm run test:integration` passes
- Frontend: removed API calls (`searchVivinoWines`, `refreshRatings` Vivino path) no longer fire
- Frontend: wine add flow works without Vivino confirmation
- Frontend: settings page shows only Paprika/Mealie credentials
- Deploy to Railway
- Full end-to-end: add wine → fetch ratings → view in modal → ratings panel populated

---

## Phase 4: Prose Narrative Storage and Rendering ✅ COMPLETE

> Additive frontend work. Store and display the rich wine profile.

### 4.1 Backend: Serve narrative in ratings response

Add `narrative` field to `GET /api/wines/:id/ratings` response. The prose is stored in `wines.tasting_notes` by Phase 2's persistence logic. No schema change needed — the column already exists.

### 4.2 Frontend: Wine Profile section

Add a collapsible "Wine Profile" section in the wine modal (in `public/js/modals.js` or a new `public/js/wineProfile.js` module). The existing ratings panel stays unchanged below it.

**CRITICAL: XSS prevention.** The prose narrative comes from an LLM processing web content — it MUST be sanitised before rendering as HTML. Requirements:
- Use an allowlist-based sanitiser (DOMPurify or equivalent)
- Allow only safe formatting tags: `h2`, `h3`, `p`, `strong`, `em`, `ul`, `ol`, `li`, `br`, `hr`
- Strip all attributes except `class` on allowed elements
- Strip `<script>`, `<iframe>`, `<style>`, `<img>`, event handlers, `javascript:` URLs
- Apply sanitisation on the client side before `innerHTML` assignment
- Implementation: either include DOMPurify as a dependency, or use a minimal allowlist renderer that converts markdown to safe HTML without passing through raw HTML at any point

The simplest safe approach: render via `textContent` for each section, or use a markdown→HTML converter that never passes through raw HTML (e.g., convert `## heading` to `<h3>` elements created via `document.createElement`, not via string concatenation + `innerHTML`).

### 4.3 Add new frontend module to `STATIC_ASSETS` in `public/sw.js`

If a new `wineProfile.js` module is created, add it to `STATIC_ASSETS` and bump `CACHE_VERSION`.

### 4.4 Verification
- Wine profile prose visible in modal
- Existing ratings panel unchanged
- `npm run test:unit` passes (swStaticAssets check)

### Implementation Notes (2026-03-02)

All four steps implemented and verified.

| Step | Status | Detail |
|------|--------|--------|
| Backend narrative field | ✅ | `narrative: wine.tasting_notes \|\| null` added to `GET /api/wines/:id/ratings` response |
| `wineProfile.js` renderer | ✅ | New module: 162 lines, DOM-only rendering, handles headings/bold/italic/lists/paragraphs. No `innerHTML` with LLM content. |
| Modal wiring | ✅ | Initial load + retry path both call `renderWineProfile()`. Container reset on each modal open. |
| SW + cache | ✅ | `/js/wineProfile.js` in `STATIC_ASSETS`, `CACHE_VERSION` bumped `v180` → `v181`. `swStaticAssets` test passes. |

---

## Phase 5: Cleanup and Documentation

### 5.1 Remove environment variables from Railway

No longer needed (all BrightData + Gemini removed):
- `GEMINI_API_KEY`
- `BRIGHTDATA_API_KEY`
- `BRIGHTDATA_SERP_ZONE`
- `BRIGHTDATA_WEB_ZONE`

After this change, the only external API keys are: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (reviewer), and `DATABASE_URL`/`SUPABASE_*`.

### 5.2 Remove npm dependencies

Check and remove if unused:
- `puppeteer` / `puppeteer-core` / `chromium`
- `@google/generative-ai` (Gemini SDK)

### 5.3 Update `CLAUDE.md`

- Rewrite "Search Pipeline Patterns" section for unified search
- Remove waterfall tier descriptions
- Update environment variables table
- Update backend file structure
- Update `aiModels.js` task table (remove ratingExtraction task)

### 5.4 Update `src/config/aiModels.js`

Remove unused task entries (e.g., `ratingExtraction` Haiku task).

### 5.5 Unify competition registries

The `known_competitions` seed data (13 entries in migration 011) partially duplicates `unifiedSources.js` competition entries (10 entries). Add missing competitions to `unifiedSources.js`:
- `michelangelo` (South Africa — referenced in queryBuilder but missing)
- `san_francisco` (USA — San Francisco Chronicle Wine Competition)
- `texsom` (USA — TEXSOM International Wine Awards)
- `sakura` (Japan — Sakura Japan Women's Wine Awards)

### 5.6 Extend benchmark framework

Add `tests/benchmark/unifiedSearchBenchmark.test.js` testing:
- Rating count per wine (target: ≥2 ratings for 80% of wines)
- Section coverage in prose (producer, grape, terroir, tasting found?)
- Citation count (target: ≥3 cited sources)
- Latency distribution (target: p50 < 20s, p95 < 35s)
- Identity gate pass rate

Test wines across obscurity levels:
- Famous: Penfolds Grange, Chateau Margaux
- Mid-tier: Kanonkop Pinotage, Cloudy Bay Sauvignon Blanc
- Obscure: Markovitis Alkemi Rosé, Pheasant's Tears Saperavi (Georgia)
- SA local: Vergelegen V, Mullineux Schist

### 5.7 Verification
- `npm run test:all` passes
- CLAUDE.md accurately reflects new architecture
- Railway environment clean

---

## Files Summary

### New Files (4-5)
| File | Purpose |
|------|---------|
| `src/services/search/claudeWineSearch.js` | Unified search: prompt, tool schema, response parser |
| `src/services/search/citationScoring.js` | Citation frequency + domain trust scoring |
| `src/jobs/unifiedRatingFetchJob.js` | Async job handler using unified search |
| `tests/unit/services/search/claudeWineSearch.test.js` | Unit tests |
| `public/js/wineProfile.js` (optional) | Prose narrative rendering in modal |

### Files to Delete (19)
| File | Lines |
|------|-------|
| `src/services/search/threeTierWaterfall.js` | ~300 |
| `src/services/search/serpAi.js` | ~200 |
| `src/services/search/geminiSearch.js` | ~300 |
| `src/services/search/claudeWebSearch.js` | ~265 |
| `src/services/search/searchGoogle.js` | ~200 |
| `src/services/search/searchBudget.js` | ~100 |
| `src/services/search/urlScoring.js` | ~150 |
| `src/services/search/relevanceScoring.js` | ~100 |
| `src/services/search/producerSearch.js` | ~200 |
| `src/services/search/documentFetcher.js` | ~150 |
| `src/services/scraping/vivinoSearch.js` | ~720 |
| `src/services/scraping/decanterScraper.js` | ~360 |
| `src/services/scraping/authenticatedScraping.js` | ~200 |
| `src/services/scraping/puppeteerScraper.js` | ~200 |
| `src/services/scraping/pageFetcher.js` | ~300 |
| `src/routes/wineSearch.js` | ~150 |
| `src/jobs/ratingFetchJob.js` | ~200 |
| `tests/unit/services/search/serpAi.test.js` | — |
| `tests/unit/services/search/geminiSearch.test.js` | — |

**Total removed: ~4,100+ lines**

### Files to Modify (18)

**Backend:**
| File | Change |
|------|--------|
| `src/routes/ratingsTier.js` | Replace waterfall with `unifiedWineSearch` |
| `src/routes/ratings.js` | Remove hybrid-search endpoint, add `cellarId` to job payload, add narrative to GET response |
| `src/routes/index.js` | Remove wineSearchRoutes registration |
| `src/routes/wineRatings.js` | Remove Vivino refresh path |
| `src/routes/settings.js` | Remove Vivino/Decanter credential testers, add VALID_SOURCES allowlist |
| `src/services/ratings/ratingExtraction.js` | Gut: keep only `saveExtractedWindows` |
| `src/services/awards/awardExtractorWeb.js` | Replace BrightData page-fetch with standard `fetch()` + Readability |
| `src/services/wine/wineAddOrchestrator.js` | Remove vivinoSearch import |
| `src/services/ai/index.js` | Update barrel exports |
| `src/server.js` | Update job handler import |
| `src/jobs/batchFetchJob.js` | Replace waterfall with `unifiedWineSearch` |

**Frontend (must update BEFORE/WITH backend deletions):**
| File | Change |
|------|--------|
| `public/js/bottles/wineConfirmation.js` | Remove Vivino search/confirmation flow |
| `public/js/api/wines.js` | Remove `searchVivinoWines`, `getVivinoWineDetails` |
| `public/js/api/index.js` | Remove `searchVivinoWines` re-export |
| `public/js/api/ratings.js` | Remove/redirect `refreshRatings` Vivino path |
| `public/js/bottles/form.js` | Remove `vivino_confirmed`, `vivino_id`, `vivino_url` from form data |
| `public/index.html` | Remove Vivino/Decanter credential forms from settings |
| `public/js/api/settings.js` | Remove Vivino/Decanter references from settings UI JS (if any) |

### Files Kept Unchanged
| File | Why |
|------|-----|
| `src/config/unifiedSources.js` | Source registry for prompt injection |
| `src/services/wine/wineIdentity.js` | Identity validation gate |
| `src/services/ratings/ratings.js` | Score normalization, aggregation, persistence |
| `src/config/vintageSensitivity.js` | Vintage filtering |
| `src/services/shared/jsonUtils.js` | JSON repair fallback |
| `src/services/shared/circuitBreaker.js` | API resilience |
| `src/services/awards/*` | Awards database (separate feature) |
| `src/services/ratings/structuredParsers.js` | May be useful later; no cost to keep |
| `tests/benchmark/searchBenchmark.test.js` | SERP identity benchmark (tier-agnostic) |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **One search call, not two** | SERT result proves one call covers narrative + ratings. Claude's 5-search budget naturally covers multiple facets. |
| **Sonnet 4.6, not Opus** | SERT used Sonnet for excellent results. Bottleneck is web content, not model intelligence. 5-10x cheaper. Env-overridable. |
| **Country injection from unifiedSources.js** | Already has 50 sources across 15 countries. Dynamic, not hardcoded. Adding a competition auto-updates all prompts. |
| **Keep awards database** | Complementary: bulk PDF import catches results not yet indexed online. Zero API cost for matching. Separate feature. |
| **Keep identity validation** | Essential for preventing wrong-wine contamination. Applied to unified search output the same way. |
| **Remove ALL scraping + BrightData** | Eliminates CFAA/TOS legal risk entirely. No BrightData dependency remains — not even for awards. Claude Web Search uses public web through Anthropic's infrastructure. Awards page-fetch downgraded to standard `fetch()`. |
| **Remove credentials** | Eliminates privacy/security liability. Keep Paprika/Mealie (recipe sync, not search). |
| **Keep structuredParsers.js** | No cost to keep; may be useful if adding a "check cached pages first" fast path later. |

---

## Legal Impact

### Removed risk surface (all eliminated)
- BrightData Web Unlocker (bypassed CloudFlare WAFs — CFAA risk) — **REMOVED**
- BrightData SERP API — **REMOVED** (no BrightData dependency remains)
- Puppeteer with spoofed user-agent (TOS violation) — **REMOVED**
- Vivino/Decanter credential storage (TOS + privacy risk) — **REMOVED**
- Direct site scraping of protected domains — **REMOVED**
- `pageFetcher.js` BrightData integration for awards — **REMOVED** (awards uses standard fetch or Claude Web Search)

### Remaining (all safe for commercial deployment)
- **Claude Web Search** via Anthropic API — Anthropic handles web access through their infrastructure. You use their API under their Terms of Service. No circumvention, no scraping, no credential injection.
- **OpenAI reviewer** — standard API usage under OpenAI ToS
- **Awards PDF import** — user-initiated, offline, processes files the user already has. No scraping.
- **Standard `fetch()`** for awards pages — plain HTTP requests with honest User-Agent. If a site returns 403, the page is skipped (no bypass attempts).

### Commercial deployment readiness
- **Zero scraping**: No BrightData, no Puppeteer, no headless browsers, no proxy rotation
- **Zero credential storage** for third-party wine sites (Paprika/Mealie kept for recipe sync — unrelated)
- **Zero Terms-of-Service violations**: All wine data sourced via Claude Web Search (Anthropic's infrastructure)
- **Attribution**: Citations with source URLs provide credit to original reviewers/sites
- **GDPR**: No personal data collection from wine sites — structured ratings only
- **1 API vendor for all wine data**: Anthropic (search + extraction in one call)

---

## Rollback Strategy

**Phase 1**: Zero risk — new files only, nothing changed. Rollback = delete new files.

**Phase 2**: Reversible — revert `server.js` and `ratingsTier.js` imports back to old files. All legacy code still exists. Instant rollback via one-line import changes.

**Phase 3**: Point of no return — legacy files are deleted. Rollback requires `git revert` of the Phase 3 commit. Before executing Phase 3, ALL of the following must pass:
1. Manual test 10 wines across 5+ countries (including at least 2 obscure wines)
2. Compare rating count, score accuracy, prose quality vs old pipeline
3. Verify identity gate rejection rates are similar
4. Confirm no 500 errors in Railway logs over 24h
5. Verify no-delete-on-empty invariant works (search that returns 0 ratings preserves existing)
6. Verify cellar scoping in job handler (cross-tenant isolation)
7. Frontend: all removed endpoints return 404 gracefully, no JS console errors

**Phase 4-5**: Additive only — no rollback concern.

---

## Reviewer Feedback Incorporation

| Reviewer Finding | Severity | Resolution |
|---|---|---|
| **XSS in narrative rendering** | Critical | Added DOMPurify/allowlist requirement to Phase 4.2. No raw HTML from LLM output. |
| **Multi-tenant scoping in job payload** | Critical | Added `cellarId` to job payload and `WHERE cellar_id = ?` requirement to Phase 2.1. Fixes existing bug in `ratingFetchJob.js`. |
| **Frontend calls removed endpoints** | High | Added Phase 3.4 (frontend cleanup BEFORE/WITH backend deletions). Listed all 7 affected frontend files with specific changes. |
| **Rollback claim inconsistency** | High | Clarified: Phase 2 rollback = instant import revert. Phase 3 = point of no return with explicit 7-point pre-deletion checklist. |
| **"1 API vendor" claim** | Medium | Resolved: BrightData fully removed (including awards page-fetch). True 1 API vendor for all wine data (Anthropic). Awards page-fetch downgraded to standard `fetch()` with graceful 403 handling. |
| **Data-preservation invariant** | Medium | Added explicit no-delete-on-empty requirement to Phase 2.1 with code example. Added to Phase 2.5 test list. |
| **Credential cleanup incomplete** | Medium | Added `public/index.html` Vivino/Decanter form removal to Phase 3.4. Added `VALID_SOURCES` allowlist suggestion for settings endpoint. Credential CRUD endpoints kept for Paprika/Mealie. |
| **Test plan too broad** | Medium | Replaced Phase 2.5 bullet list with specific test requirements: API shape, no-delete-on-empty, cellar scoping, identity gate, narrative storage. |

### Reviewer questions resolved
- **Vivino-assisted add/confirmation UX**: Intentionally removed. Vivino data is still discoverable via the general Claude Web Search (public pages). The manual wine-add flow works without confirmation.
- **Credential storage scope**: Keep generic credential infrastructure for Paprika/Mealie and future integrations. Remove only Vivino/Decanter-specific testers and UI. Add `VALID_SOURCES` allowlist to prevent saving credentials for removed sources.

### Code Review Implementation Status (2026-03-02)

All 8 code review items implemented and verified (`npm run test:unit` passes, 117 files, 2881 tests).

| Finding | Severity | Status | Implementation |
|---------|----------|--------|----------------|
| No-delete-on-empty breakable by unknown source IDs | Critical | ✅ DONE | `countSaveableRatings()` added to `ratings.js`; gates DELETE in `unifiedRatingFetchJob`, `batchFetchJob`, and `ratingsTier` |
| Cellar scoping incomplete in job payload | Critical | ✅ DONE | `unifiedRatingFetchJob` throws if `cellarId` absent; wine query uses `WHERE id = ? AND cellar_id = ?`; batch passes `wine.cellar_id` |
| BrightData Web Unlocker in awards path (`pageFetcher.js`) | High | ✅ DONE | `pageFetcher.js` + `fetchClassifier.js` deleted; `awardExtractorWeb.js` inline `fetchAwardPage()` uses standard `fetch()` + Readability |
| Dead Vivino frontend functions (3 API fns, form confirmation, HTML blocks) | High | ✅ DONE | Removed `searchVivinoWines`, `getVivinoWineDetails`, `getWineSearchStatus`, `refreshWineRatings`, `saveWineWithConfirmation`, `shouldShowConfirmation`; deleted `wineConfirmation.js`; removed Vivino/Decanter credential HTML from `index.html` |
| Credential allowlist (vivino/decanter still accepted by schema) | Medium | ✅ DONE | `sourceParamSchema` changed to `z.enum(['paprika', 'mealie'])`; `KNOWN_CREDENTIAL_SOURCES` trimmed to 2 entries |
| `max_uses: 5` missing from `web_search` tool | Medium | ✅ DONE | Added to `SAVE_WINE_PROFILE_TOOL` array in `claudeWineSearch.js`; test updated |
| BrightData in `serviceAvailability.js` and `wines.js:128` | Low | ✅ DONE | `wineSearch` + `ratings` entries removed from `SERVICES`; `search_available` field removed from wines response |
| Missing regression tests for batch + tier paths | Medium | ✅ DONE | `tests/unit/jobs/batchFetchJob.test.js` (9 tests); `tests/unit/routes/ratingsTier.test.js` (5 tests). Writing tests revealed two additional bugs: `batchFetchJob` was skipping identity validation entirely (fixed: added `validateRatingsWithIdentity` + `filterRatingsByVintageSensitivity`); `ratingsTier` was missing `countSaveableRatings` guard (fixed). |
