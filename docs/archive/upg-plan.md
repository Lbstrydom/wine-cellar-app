# Wire Extracted Data & Cross-Feature Integration

## Context

A codebase audit revealed that the two-phase search pipeline (Phase 1: Sonnet web search → narrative, Phase 2: Haiku → structured JSON) extracts rich wine data that is partially discarded at the persistence layer. Three extracted fields (`awards[]`, `producer_info`, `style_summary`) are dropped by both `ratingsTier.js` and `unifiedRatingFetchJob.js`. Meanwhile, recently added features (`wine_food_pairings` table, `tasting_notes_structured` column) are persisted but siloed — visible only in the ratings panel, never fed into AI prompts for restaurant pairing, drink recommendations, or cellar analysis. Several API response fields (`search_notes`, `food_pairings_count`, `method`) are returned but never consumed by the frontend.

Additionally, a **critical cross-tenant data leak** was discovered: `drinkNowAI.js` queries wines from ALL cellars (no `cellar_id` filter in `getUrgentWines()`). This must be fixed before enriching that feature.

**Goal**: Wire all extracted data end-to-end (extract → persist → serve → display), integrate cross-feature data for richer AI context, fix the cellar-scoping bug, and clean dead code paths — following DRY/SOLID principles and Gestalt UX guidelines.

---

## Phase 0: Fix drinkNowAI Cellar Scoping (Critical Bug)

**File**: `src/services/ai/drinkNowAI.js`

**Bug**: `getUrgentWines()`, `getRecentConsumption()`, and `getCollectionStats()` query without `WHERE cellar_id = ?`. All data from all cellars is mixed into AI recommendations.

**Fix**:
1. Add `cellarId` parameter to `generateDrinkRecommendations(options)` → `options.cellarId`
2. Add `cellarId` parameter to all three internal query functions
3. Add `WHERE w.cellar_id = $X` to `getUrgentWines()` SQL (line ~59)
4. Add `WHERE cl.cellar_id = $X` to `getRecentConsumption()` SQL
5. Add `WHERE w.cellar_id = $X` to `getCollectionStats()` SQL

**File**: `src/routes/reduceNow.js` (line ~409)

Pass `cellarId` from route handler:
```js
const recommendations = await generateDrinkRecommendations({
  limit,
  cellarId: req.cellarId,  // ADD THIS
  context: Object.keys(context).length > 0 ? context : null
});
```

**Tests**: Update `drinkNowAI.test.js` to verify cellarId flows through all queries.

---

## Phase 1: SQL Migration & Schema

**File**: `data/migrations/062_wire_extracted_fields.sql` (new — next after existing 061)

```sql
ALTER TABLE wines ADD COLUMN IF NOT EXISTS style_summary TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS producer_description TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS extracted_awards JSONB;
```

**Design decisions**:
- `style_summary` — concise style descriptor from search extraction (e.g., "Bold, fruit-forward Stellenbosch Cabernet")
- `producer_description` — producer background from `producer_info.description`
- `extracted_awards` — JSONB array of `{competition, year, award, wine_name}` from search extraction. Stored on wines table (inherently cellar-scoped via `wines.cellar_id`) rather than bridging into `competition_awards` table, which is a **global** table with no `cellar_id` column and a `UNIQUE(source_id, wine_name, vintage, award)` constraint that would cause cross-tenant collisions. The competition_awards table stays reserved for verified PDF/webpage-extracted awards via the existing `awardSourceManager.js` pipeline.

---

## Phase 2: Persist Discarded Extraction Data (Backend)

### 2a. Extract shared persistence helper (DRY)

**File**: `src/services/shared/wineUpdateService.js` (new)

Both `ratingsTier.js` (lines ~221-239) and `unifiedRatingFetchJob.js` (lines ~215-239) contain near-identical `UPDATE wines SET ...` blocks. Extract into a shared helper:

```js
/**
 * Persist search extraction results to wines table.
 * COALESCE guards ensure we never overwrite user-provided data.
 * Backfills producer/region/country only if wine has NULL or empty string.
 *
 * @param {number} wineId
 * @param {string} cellarId
 * @param {Object} wine - Existing wine record (for NULL checks)
 * @param {Object} aggregates - Calculated rating aggregates
 * @param {Object} extractionData - { narrative, tastingNotesStructured, styleSummary, producerInfo, awards, foodPairings }
 */
export async function persistSearchResults(wineId, cellarId, wine, aggregates, extractionData) {
  const { narrative, tastingNotesStructured, styleSummary, producerInfo, awards, foodPairings } = extractionData;

  // Build UPDATE with all extracted fields
  // COALESCE($X, column) for style_summary, producer_description, tasting_notes, tasting_notes_structured
  // COALESCE(column, $X) for backfill fields (producer, region, country) — only fills if NULL/empty
  // Backfill uses: COALESCE(NULLIF(producer, ''), $Z) pattern to handle both NULL and empty string

  // Persist food pairings (reuse existing saveFoodPairings)
  if (foodPairings.length > 0) {
    await saveFoodPairings(wineId, cellarId, foodPairings);
  }

  // Persist extracted awards as JSONB on wines table
  // (NOT into competition_awards — that's for verified PDF awards)
}
```

**Backfill safety** — use `COALESCE(NULLIF(column, ''), $X)` pattern to handle both NULL and empty string:
```sql
producer = COALESCE(NULLIF(producer, ''), $Z),
region = COALESCE(NULLIF(region, ''), $W),
country = COALESCE(NULLIF(country, ''), $V)
```

### 2b. Update both persistence flows to use shared helper

**Files**:
- `src/routes/ratingsTier.js` — replace inline UPDATE + food pairings block with `persistSearchResults()` call
- `src/jobs/unifiedRatingFetchJob.js` — same replacement

Both flows still handle their own pre-persistence logic (identity validation, deduplication, no-delete-on-empty invariant) but delegate the UPDATE + ancillary persistence to the shared helper.

### 2c. Clean dead API response fields

**File**: `src/routes/ratingsTier.js` (lines ~249-256)

Remove from response JSON:
- `search_notes: result.search_notes` — frontend never reads (verified: `ratings.js` line 422 only uses `message`)
- `food_pairings_count: foodPairings.length` — frontend never reads
- `method: usedMethod` — frontend never reads

Internal logging already captures this information. Update any related test assertions.

---

## Phase 3: Shared Wine Context Builder (DRY)

### Problem

Wine context is built separately in 4+ places with inconsistent fields:
- `restaurantPairing.js` — flat string from frontend params (no DB enrichment)
- `drinkNowAI.js` — SQL query, missing food pairings/structured tasting notes/awards
- `tastingExtractor.js` — minimal colour/style/grape string

### Solution

**File**: `src/services/wine/wineContextBuilder.js` (new)

```js
/**
 * Build enriched wine context for AI prompts.
 * Single source of truth for wine data assembly.
 *
 * @param {Object} wine - Wine DB record (from wines table)
 * @param {string} cellarId - Tenant scope
 * @param {Object} options - { includePairings, includeTastingNotes, includeAwards }
 * @returns {Promise<Object>} Enriched context object
 */
export async function buildWineContext(wine, cellarId, options = {}) { ... }

/**
 * Batch-build context for multiple wines (avoids N+1 queries).
 * Fetches all pairings/awards in single queries, then distributes.
 *
 * @param {Object[]} wines - Array of wine DB records
 * @param {string} cellarId
 * @param {Object} options
 * @returns {Promise<Map<number, Object>>} Map of wineId → enriched context
 */
export async function buildWineContextBatch(wines, cellarId, options = {}) {
  // Single query: SELECT * FROM wine_food_pairings WHERE wine_id IN ($1...$N) AND cellar_id = $X
  // Single query: SELECT * FROM competition_awards WHERE matched_wine_id IN ($1...$N)
  // Distribute results into per-wine context objects
}

/**
 * Format enriched context into a concise string for AI prompts.
 * @param {Object} context - From buildWineContext()
 * @returns {string}
 */
export function formatWineContextForPrompt(context) { ... }
```

**Key design decisions** (from reviewer feedback):
- **Batch variant** (`buildWineContextBatch`) for drinkNowAI which processes ~30 wines — avoids N+1 queries
- **Defensive JSON parsing** for `tasting_notes_structured` — wrap in try/catch, fail open (return null, don't throw)
- **cellarId required** on all queries for tenant isolation

---

## Phase 4: Cross-Feature Integration (Backend)

### 4a. Enrich drinkNowAI with food pairings + structured tasting notes

**File**: `src/services/ai/drinkNowAI.js`

**Prerequisites**: Phase 0 (cellarId scoping) must be complete first.

**Changes**:
1. Import `buildWineContextBatch` from `wineContextBuilder.js`
2. After `getUrgentWines(cellarId)` returns wines, batch-enrich with food pairings:
   ```js
   const contextMap = await buildWineContextBatch(urgentWines, cellarId, { includePairings: true });
   for (const wine of urgentWines) {
     wine._context = contextMap.get(wine.id);
   }
   ```
3. In `buildPrompt()`, append food pairings to each wine's context line:
   ```
   Wine: Kanonkop Paul Sauer 2019 (red) - Stellenbosch Blend
   Pairs well with: Lamb rack (★★★★★), Beef brisket (★★★★)
   ```
4. This enables the AI to populate `pairing_suggestion` (already in output schema) with personalized recommendations.

### 4b. Enrich restaurant pairing with cellar wine data

**File**: `src/services/pairing/restaurantPairing.js`

**Critical context from review**: Wine IDs in the restaurant pairing payload are **local UI session IDs** (assigned by `state.js:nextWineId++`), NOT cellar database wine IDs. Direct DB lookup by `wine.id` would return wrong wines or nothing.

**Solution — add `cellar_wine_id` field**:

1. **Frontend** (`public/js/restaurantPairing/state.js`): When wines are added from the cellar wine picker, store the original cellar DB wine ID:
   ```js
   export function addWine(wine) {
     const entry = {
       ...wine,
       id: nextWineId++,           // Local session ID (for prompt/response matching)
       cellar_wine_id: wine.cellar_wine_id || null  // Original DB ID if from cellar
     };
   }
   ```

2. **Frontend** (`public/js/restaurantPairing/results.js`): Include `cellar_wine_id` in the request payload:
   ```js
   wines: wines.map(w => ({
     id: w.id,                        // Local session ID
     cellar_wine_id: w.cellar_wine_id, // DB ID for enrichment (nullable)
     name: w.name, colour: w.colour, ...
   }))
   ```

3. **Backend** (`restaurantPairing.js`): Enrich only wines with valid `cellar_wine_id`:
   ```js
   for (const wine of params.wines) {
     if (wine.cellar_wine_id) {
       const dbWine = await db.prepare(
         'SELECT * FROM wines WHERE id = $1 AND cellar_id = $2'
       ).get(wine.cellar_wine_id, cellarId);
       if (dbWine) {
         const ctx = await buildWineContext(dbWine, cellarId, { includePairings: true });
         wine._context = ctx;
       }
     }
   }
   ```

4. **Prompt enrichment**: Update `buildUserPrompt()` to append enrichment when `_context` is present:
   ```
   [id:3] Kanonkop Paul Sauer 2019 (red) - Stellenbosch Blend 450
     Pairs with: Lamb rack ★★★★★, Beef brisket ★★★★
   ```

### 4c. Awards display — already wired

**No changes needed for basic wiring.** Investigation confirmed that `src/routes/ratings.js` (lines 57-90) already:
- Calls `getWineAwards(wineId)` from `awardSourceManager.js`
- Returns `local_awards` in the ratings response
- Frontend `ratings.js` (lines 216-237) renders award badges with colour coding

The **new value** from Phase 1 is `extracted_awards` JSONB on wines table. This will be displayed alongside `local_awards` (Phase 5d).

---

## Phase 5: Frontend UI (Gestalt Principles)

### 5a. Style summary display

**File**: `public/js/ratings.js` (ratings panel header area)

**Reconciliation with `style_fingerprint`**: The existing `tastingService.js` renders `notes.style_fingerprint` within the structured tasting notes view. The new `style_summary` from search extraction is a different field — a broader description of the wine style from web research (e.g., "Bold, fruit-forward Stellenbosch Cabernet blend aged in French oak"), not the narrow tasting-profile fingerprint. Display `style_summary` in the ratings panel header as supplementary wine identity, NOT in the tasting notes section.

**Position**: Below wine name/vintage, above scores — uses **proximity** (Gestalt) to group with wine identity.

```css
.wine-style-summary {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
  margin-bottom: 0.5rem;
}
```

### 5b. Structured tasting notes — delegate to tastingService.js

**Status**: UNBLOCKED — `buildTastingNotesSection()` is now exported from `tastingService.js`.

**Verified**: All CSS classes used by the function (`tasting-section`, `nose-section`, `palate-section`, `finish-section`, `section-label`, `structure-line`, `sources-drawer`, etc.) are already defined in the globally-loaded `components.css`. All internal helpers (`groupByCategory`, `buildCategoryBullets`, `buildStructureLine`, `formatLength`, `toDisplayFormat`, `buildEvidenceIndicator`, `getSourceIcon`) remain private — only the entry-point function is exported.

**Implementation**: `tastingService.js` has `buildTastingNotesSection(notes)` which renders Nose, Palate, Finish with `all_descriptors`, structure badges, evidence sections, and source drawer. **Do NOT duplicate this in `ratings.js`.** Add a thin integration layer in `ratings.js` that:
1. Imports `buildTastingNotesSection` from `tastingService.js`
2. Checks if `tasting_notes_structured` is available on the wine data
3. Calls `buildTastingNotesSection()` to render it
4. Inserts the resulting HTML into the panel

### 5c. Enhanced food pairings with context indicators

**File**: `public/js/ratings.js` (food pairings section)

Enhance existing pairing rows with:
- **Source badge**: Extend existing `.pairing-source-badge` CSS (already in `components.css:13575`) for "AI" vs "manual"
- **Affordance**: Clear "Rate this pairing" hover tooltip on unrated items (empty stars)
- **Consistency**: Match star styling with existing `purchase_stars` display pattern

### 5d. Search-extracted awards display

**File**: `public/js/ratings.js` (after existing local_awards section)

Display `extracted_awards` from wines table alongside the existing `local_awards` from competition_awards:

```html
<!-- Existing section: Awards from competition_awards DB (verified) -->
<div class="local-awards-section">...</div>

<!-- New section: Awards from search extraction (web research) -->
<div class="extracted-awards-section" v-if="extractedAwards.length">
  <h4 class="extracted-awards-title">Awards (Web Research)</h4>
  <!-- Same badge styling as local_awards for consistency (Gestalt similarity) -->
</div>
```

**Design principles**:
- **Similarity**: Same badge styling regardless of source
- **Hierarchy**: Competition DB awards first (higher credibility), search-extracted second
- **Control**: Subtle source label gives users transparency about data provenance

### 5e. Service worker & cache updates

**Files**:
- `public/sw.js` — bump `CACHE_VERSION`. No new JS modules are being added (only modifying existing files), so `STATIC_ASSETS` likely unchanged. Verify with SW regression test.
- `public/index.html` — bump CSS `?v=` version string

---

## Phase 6: Tests

### Unit tests for new code

| New file | Test file | Coverage |
|----------|-----------|----------|
| `src/services/shared/wineUpdateService.js` | `tests/unit/services/shared/wineUpdateService.test.js` | All field persistence, COALESCE guards, NULL/empty backfill, JSONB awards |
| `src/services/wine/wineContextBuilder.js` | `tests/unit/services/wine/wineContextBuilder.test.js` | Single + batch, all option combos, defensive JSON parse, null safety |

### Updated tests for modified files

| Modified file | Test file | Changes |
|---------------|-----------|---------|
| `src/services/ai/drinkNowAI.js` | `tests/unit/services/ai/drinkNowAI.test.js` | Assert cellarId flows through all queries (Phase 0), food pairing context in prompt |
| `src/routes/ratingsTier.js` | `tests/unit/routes/ratingsTier.test.js` | Assert shared helper called, no dead fields in response |
| `src/jobs/unifiedRatingFetchJob.js` | Existing test file | Assert shared helper called |
| `src/services/pairing/restaurantPairing.js` | `tests/unit/services/pairing/restaurantPairing.test.js` | Assert enrichment via cellar_wine_id, skip when null |

### Regression

- `npm run test:unit` (~3000 tests) — no regressions
- `sqlInjectionPatterns.test.js` — verify no template literals in new SQL
- SW static assets test — verify no new modules missing

---

## Verification Plan

1. **Phase 0**: `npm run test:unit` — drinkNowAI tests pass with cellarId assertions
2. **Phase 1**: Run migration in Supabase SQL editor, verify columns with `\d wines`
3. **Phase 2**: Trigger "Research Wine" on a known wine → verify `style_summary`, `producer_description`, `extracted_awards` in DB
4. **Phase 3-4a**: Trigger drink recommendations → verify food pairing context in AI prompt (check logs), `pairing_suggestion` populated
5. **Phase 4b**: Start restaurant pairing with cellar wines → verify enriched context in Claude prompt (check logs)
6. **Phase 5**: Open wine detail modal → verify style summary, search-extracted awards section, food pairing source badges
7. **Dead fields**: Verify ratingsTier response no longer includes `search_notes`, `food_pairings_count`, `method`
8. **Full regression**: `npm run test:all` passes

---

## Files Modified Summary

| File | Type | Changes |
|------|------|---------|
| `data/migrations/062_wire_extracted_fields.sql` | New | Add `style_summary`, `producer_description`, `extracted_awards` columns |
| `src/services/shared/wineUpdateService.js` | New | Shared `persistSearchResults()` — DRY extraction of UPDATE logic |
| `src/services/wine/wineContextBuilder.js` | New | `buildWineContext()` + `buildWineContextBatch()` + `formatWineContextForPrompt()` |
| `src/services/ai/drinkNowAI.js` | Modified | **Fix cellarId scoping (Phase 0)**, enrich with food pairings |
| `src/routes/reduceNow.js` | Modified | Pass `cellarId` to `generateDrinkRecommendations()` |
| `src/routes/ratingsTier.js` | Modified | Use shared persistence helper, remove dead response fields |
| `src/jobs/unifiedRatingFetchJob.js` | Modified | Use shared persistence helper |
| `src/services/pairing/restaurantPairing.js` | Modified | Enrich wines via `cellar_wine_id` lookup |
| `public/js/restaurantPairing/state.js` | Modified | Preserve `cellar_wine_id` on wine entries |
| `public/js/restaurantPairing/results.js` | Modified | Include `cellar_wine_id` in request payload |
| `public/js/ratings.js` | Modified | Style summary, search-extracted awards, enhanced food pairings, tasting notes integration via tastingService |
| `public/css/components.css` | Modified | Styles for `.wine-style-summary`, `.extracted-awards-section` |
| `public/sw.js` | Modified | Bump cache version |
| `public/index.html` | Modified | Bump CSS version |
| Tests (5-7 files) | New/Modified | New unit tests + updated assertions |

---

## Implementation Order

1. **Phase 0** — Fix drinkNowAI cellar scoping (critical bug, independent, must go first)
2. **Phase 1** — SQL migration (schema foundation)
3. **Phase 2a** — Shared persistence helper (DRY foundation)
4. **Phase 2b** — Update both persistence flows to use shared helper
5. **Phase 2c** — Remove dead API fields
6. **Phase 3** — Shared wine context builder (DRY foundation for cross-features)
7. **Phase 4a** — drinkNowAI enrichment (depends on Phase 0 + 3)
8. **Phase 4b** — Restaurant pairing enrichment (depends on Phase 3)
9. **Phase 5** — Frontend UI changes (all at once for consistent cache bump)
10. **Phase 6** — Tests throughout each phase, final full regression at end

Each phase is independently deployable and testable.
