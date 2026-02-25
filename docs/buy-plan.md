# Recipe Integration & Buying Guide

## Context

The user manages cooking recipes and wants the wine cellar app to:
1. Import recipes from multiple sources (Paprika, Mealie, RecipeSage, CSV, URL, manual)
2. Build a cooking profile from recipe data (categories, ratings, frequencies)
3. Pair wines from the cellar against recipes/menus
4. Provide a **Buying Guide** that identifies which wines to stock more/less of based on cooking patterns

### Design Principles
- **Source-agnostic core**: All importers normalise to a common `RecipeInput` shape before storage
- **Progressive disclosure**: Default view is the Recipe Library; profile and gap analysis surface as inline summaries, not parallel sub-views
- **Minimal friction**: Auto-compute everything possible from recipe data; only ask the user to override, never to configure from scratch
- **Multi-tenant isolation**: All data scoped to `cellar_id` via `req.cellarId` from middleware

### Key Data from User's Paprika Export (368 recipes)
- Categories are **plain strings** (not UUIDs): Chicken(48), Fish(52), Beef(34), Braai(30), Asian(30), etc.
- Ratings: 51% unrated, 40% rated 5/5, 8% rated 4/5
- Ingredients: newline-delimited text with Unicode fractions
- Photos: **Strip entirely** (user decision)  no photo storage

### User Decisions
- **Tab label**: "Recipes" (not "Buying Guide"  see UX rationale in Review Responses)
- **Tab position**: After "Find Pairing" -> `Grid | Analysis | Find Pairing | Recipes | Wine List | History | Settings`
- **Season logic**: Global summer/winter bias (not per-category), stored on `cellars.settings` (cellar-level, not user-level)
- **Photos**: Strip base64 photo data; store only `image_url` if available (zero storage cost)

---

## Review Responses

This section addresses each point from the critical review, documenting the resolution.

### Critical: Season setting scope  cellar-level, not user-level

**Reviewer is correct.** Hemisphere is inherently cellar-scoped (a cellar in Cape Town is southern hemisphere regardless of who logs in). Both `profiles` and `cellars` tables have a `settings JSONB` column, but `cellars.settings` is the correct home. The original plan said "profiles.settings" which would leak across cellars for multi-cellar users.

**Resolution:** Store `{ hemisphere: 'southern' | 'northern' }` in `cellars.settings` JSONB. Read via `req.cellarId` -> `cellars.settings.hemisphere`. The existing `user_settings` key-value table (also cellar-scoped via migration 042) could work too, but JSONB on `cellars` is cleaner since it's a cellar property, not a user preference.

### Critical: Sync failures must not be silently hidden

**Reviewer is correct.** "Silently fall back" is dangerous for a buying-recommendation feature  stale recipes produce stale buying advice without the user knowing.

**Resolution:**
- Sync errors surface as a **non-blocking amber banner** at the top of Recipe Library: "Recipes last synced 3 days ago  sync failed (rate limited). [Retry] [Details]"
- The banner shows automatically when `last_sync_at` is >24h old AND `last_sync_error IS NOT NULL`
- Sync never blocks the main UI flow  recipes are still usable, just potentially stale
- Buying guide shows a caveat line when recipes are stale: "Based on recipes last synced 3 days ago"

### High: Sync schema is incomplete  missing hash/state tracking

**Reviewer is correct.** The `source_credentials` table has no `hash` column and there's no `recipe_sync_state` table.

**Resolution:** Add `recipe_sync_state` table (see Database section) with `cellar_id`, `source_provider`, `source_recipe_id`, `source_hash`, `last_seen_at`. Plus `recipe_sync_log` for sync run history. This enables:
- Hash-based differential sync (only fetch changed recipes)
- Soft-delete detection (recipes not seen for 3 consecutive syncs get `deleted_at` set)
- Re-import idempotency without resurrecting user-deleted recipes

### High: Buying target math produces impossible totals

**Reviewer is correct.** `max(2, round(demandPct * totalBottles))` with 13 style buckets produces a minimum floor of 26 bottles across all styles, which can exceed the cellar size.

**Resolution:**
- Remove the per-style floor: `target[style] = round(demandPct * totalBottles)`
- Styles with 0% demand get target 0  no gap reported
- Add separate **diversity recommendations** (advisory, not counted as a gap): "You don't cook much fish, but keeping 1-2 crisp whites for guests is a good idea"
- Targets are guaranteed to sum to <= totalBottles since demandPct sums to 1.0
- Deficit only reported when `have < target` AND `target >= 1`

### High: Adding credentials requires settings refactoring

**Reviewer is correct.** Credential source is hardcoded in three places:
1. `src/schemas/settings.js` -> `z.enum(['vivino', 'decanter'])`
2. `src/routes/settings.js` -> validates via `sourceParamSchema`
3. `public/js/settings.js` -> `const sources = ['vivino', 'decanter']`

**Resolution:** P0 prerequisite: refactor to data-driven source plumbing:
1. Replace `z.enum([...])` with `z.string().min(1).max(50).regex(/^[a-z_]+$/)`
2. Add `KNOWN_CREDENTIAL_SOURCES` constant array for UI rendering (not backend validation)
3. Backend accepts any source_id string  test-connection dispatches to provider-specific testers
4. This unblocks Paprika/Mealie/future sources without further refactoring

### High: SW-cache regression risk with lazy loading

**Reviewer is correct.** The SW test (`swStaticAssets.test.js`) only walks static `import ... from '...'` statements. Dynamic `import('./recipes.js')` in `app.js` won't be caught.

**Resolution:**
- All new modules go into `STATIC_ASSETS` in `sw.js` regardless of lazy loading
- Add `LAZY_ENTRYPOINTS` array in `swStaticAssets.test.js` that lists dynamic import entry points
- The test walks these trees too, using regex: `/import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g`
- P0 prerequisite, not a follow-up

### Medium: Non-Paprika path is too high-friction

**Reviewer is correct.** Manual one-by-one entry is unusable for building a cooking profile.

**Resolution:** Build source-agnostic import core in P1:
1. **CSV import**  name, ingredients, category columns (bulk manual)
2. **URL import**  paste URL -> scrape JSON-LD schema.org `Recipe` markup -> normalise
3. **Plain text paste**  via manual entry form with generous textarea
4. **Paprika file import**  `.paprikarecipes` ZIP
5. **Mealie API sync**  alongside Paprika sync
6. **RecipeSage file import**  JSON-LD export (API requires commercial license; file-only)

### Medium: Test plan is insufficient

**Reviewer is correct.** 2 test files for this feature size is inadequate.

**Resolution:** Expanded to 11+ test files covering: adapter parsing, service CRUD, route auth/scoping, sync correctness, idempotency, delete reconciliation, profile computation, gap analysis, and existing regression tests (SW assets, API auth headers).

### Medium: Source model not future-proof

**Reviewer is correct.** `imported_from` with `'paprika' | 'manual'` doesn't support multi-source dedup.

**Resolution:** Replace with:
- `source_provider TEXT DEFAULT 'manual'`  `'paprika'` | `'mealie'` | `'recipesage'` | `'url'` | `'csv'` | `'manual'`
- `source_recipe_id TEXT`  provider-specific unique ID
- Dedup: `UNIQUE(cellar_id, source_provider, source_recipe_id)`
- Sync state in separate `recipe_sync_state` table

### UX: Tab naming and flow

"Buying Guide" is misleading  the feature is 60% recipe management. Users expecting a shopping list won't look here for recipes.

**Resolution:** Rename tab to **"Recipes"**. Buying guide is an inline section within the recipe view. User mental model: "my recipes" -> "what wines match" -> "what to buy"  a natural funnel.

### On Mealie / RecipeSage integration order

Follow this order:
1. Source-agnostic import core (generic JSON/CSV + manual + URL)
2. Paprika file + cloud sync (primary user's need)
3. Mealie API sync (documented API, token auth)
4. RecipeSage file import only (API requires commercial license)

**Sources:**
- Mealie API: https://docs.mealie.io/documentation/getting-started/api-usage/
- Mealie API reference: https://docs.mealie.io/api/redoc/
- RecipeSage importing: https://docs.recipesage.com/docs/importing-from-other-apps
- RecipeSage exporting: https://docs.recipesage.com/docs/exporting-your-data
- RecipeSage API access: https://api.recipesage.com/ (commercial license required)

---

## Architecture: Source-Agnostic Import

All recipe sources normalise to a common intermediate shape before storage:

`javascript
/** @typedef {Object} RecipeInput
 *  @property {string} name
 *  @property {string} [ingredients]  newline-delimited
 *  @property {string} [directions]
 *  @property {string[]} [categories]
 *  @property {number} [rating]  0-5
 *  @property {string} [cook_time]
 *  @property {string} [prep_time]
 *  @property {string} [total_time]
 *  @property {string} [servings]
 *  @property {string} [source]
 *  @property {string} [source_url]
 *  @property {string} [notes]
 *  @property {string} [image_url]
 *  @property {string} source_provider  'paprika'|'mealie'|'recipesage'|'url'|'csv'|'manual'
 *  @property {string} [source_recipe_id]  provider-specific dedup key
 *  @property {string} [source_hash]  content hash for diff sync
 */
`

### Adapter Pattern

`
src/services/recipe/
|-- adapters/
|   |-- adapterInterface.js   # JSDoc typedef + validation for RecipeInput
|   |-- paprikaAdapter.js     # .paprikarecipes file (ZIP -> gunzip -> JSON)
|   |-- mealieAdapter.js      # Mealie REST API (token auth)
|   |-- recipeSageAdapter.js  # RecipeSage JSON-LD file import
|   |-- jsonLdAdapter.js      # Schema.org Recipe from URL scrape
|   +-- csvAdapter.js         # CSV with column mapping
|-- recipeNormaliser.js        # Validates RecipeInput, extracts signals, normalises categories
|-- recipeService.js           # CRUD + import orchestration
|-- recipeSyncService.js       # Sync orchestration (Paprika, Mealie)
|-- cookingProfile.js          # Profile computation engine
|-- buyingGuide.js             # Gap analysis engine
+-- categorySignalMap.js       # Category -> signal boost map (fuzzy, enhancement only)
`

Each adapter exports:
`javascript
/** @param {Buffer|string|Object} input  file buffer, URL string, or API response
 *  @returns {RecipeInput[]} */
export function parseRecipes(input) { ... }
`

The `recipeNormaliser.js` runs on every `RecipeInput`:
1. Validates required fields (name is mandatory)
2. Runs `extractSignals(name + ' ' + ingredients + ' ' + categories.join(' '))`  primary signal source
3. Applies `categorySignalMap` as a boost (0.5x weight)  fuzzy-matched (e.g., "BBQ" -> "grilled")
4. Returns normalised recipe ready for DB insert

**Key design decision:** `extractSignals()` on actual recipe text is the primary signal source. `categorySignalMap` is a secondary boost. This avoids fragility with non-standard category names.

---

## P0: Prerequisites (before Phase 1)

### 0a. Refactor Credential Source Plumbing

| File | Change |
|------|--------|
| `src/schemas/settings.js` | Replace `z.enum(['vivino', 'decanter'])` with `z.string().min(1).max(50).regex(/^[a-z_]+$/)` |
| `src/routes/settings.js` | Add provider-specific test dispatching via registry pattern |
| `public/js/settings.js` | Generate credential UI dynamically from source list |

### 0b. Extend SW Test for Dynamic Imports

| File | Change |
|------|--------|
| `tests/unit/utils/swStaticAssets.test.js` | Add `LAZY_ENTRYPOINTS` array + dynamic import regex walking |

---

## Phase 1: Recipe Import + Library + Single-Recipe Pairing

### 1. Database Tables

Create via `ensureTables()` pattern (like `palateProfile.js`):

**`recipes`** table:
- `id SERIAL PRIMARY KEY`
- `cellar_id UUID NOT NULL`  multi-tenant scope
- `source_provider TEXT NOT NULL DEFAULT 'manual'`  `'paprika'|'mealie'|'recipesage'|'url'|'csv'|'manual'`
- `source_recipe_id TEXT`  provider-specific dedup key
- `name TEXT NOT NULL`
- `ingredients TEXT`  newline-delimited
- `directions TEXT`
- `categories TEXT DEFAULT '[]'`  JSON array of category strings
- `rating INTEGER DEFAULT 0`  0-5 (0 = unrated)
- `cook_time, prep_time, total_time, servings TEXT`
- `source, source_url, notes TEXT`
- `image_url TEXT`  external URL reference only (no base64 storage)
- `deleted_at TIMESTAMPTZ`  soft delete for sync reconciliation (NULL = active)
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`
- `UNIQUE(cellar_id, source_provider, source_recipe_id)`

**`recipe_sync_state`** table:
- `id SERIAL PRIMARY KEY`
- `cellar_id UUID NOT NULL`
- `source_provider TEXT NOT NULL`
- `source_recipe_id TEXT NOT NULL`
- `source_hash TEXT`  content hash for diff detection
- `last_seen_at TIMESTAMPTZ DEFAULT NOW()`
- `UNIQUE(cellar_id, source_provider, source_recipe_id)`

**`recipe_sync_log`** table:
- `id SERIAL PRIMARY KEY`
- `cellar_id UUID NOT NULL`
- `source_provider TEXT NOT NULL`
- `started_at TIMESTAMPTZ DEFAULT NOW()`
- `completed_at TIMESTAMPTZ`
- `status TEXT DEFAULT 'running'`  `'running'|'success'|'partial'|'failed'`
- `added INTEGER DEFAULT 0`
- `updated INTEGER DEFAULT 0`
- `deleted INTEGER DEFAULT 0`
- `unchanged INTEGER DEFAULT 0`
- `error_message TEXT`

**No `category_frequencies` table.** Auto-computed from recipe data. User overrides stored in `cellars.settings` JSONB as `{ categoryOverrides: { Chicken: 5, Fish: 2 } }`. Simpler schema.

**No `food_signals` column.** Signals computed on-the-fly via `extractSignals()`. Keyword matching on 400 recipes is <10ms. Avoids cache staleness.

### 2. New Backend Files

| File | Purpose |
|------|---------|
| `src/services/recipe/adapters/adapterInterface.js` | `RecipeInput` JSDoc typedef, `validateRecipeInput(input)` |
| `src/services/recipe/adapters/paprikaAdapter.js` | Parse `.paprikarecipes` (ZIP -> gunzip -> JSON). `adm-zip` + `zlib`. Strips `photo_data` |
| `src/services/recipe/adapters/mealieAdapter.js` | Mealie REST API client: `fetchRecipes(baseUrl, token)`, maps structured ingredients to text |
| `src/services/recipe/adapters/recipeSageAdapter.js` | Parse RecipeSage JSON-LD export file |
| `src/services/recipe/adapters/jsonLdAdapter.js` | Scrape URL -> extract `application/ld+json` -> parse `schema.org/Recipe` |
| `src/services/recipe/adapters/csvAdapter.js` | Parse CSV with column mapping |
| `src/services/recipe/recipeNormaliser.js` | Validates, extracts signals, applies category boost |
| `src/services/recipe/recipeService.js` | `ensureRecipeTables()`, `importRecipes(inputs[], cellarId)`, CRUD, `getRecipeCategories()`, `computeCategoryFrequencies()` |
| `src/services/recipe/recipeSyncService.js` | Sync orchestration: `syncPaprika(cellarId)`, `syncMealie(cellarId)`, `getSyncStatus()` |
| `src/services/recipe/categorySignalMap.js` | Fuzzy category -> signal boost map using Jaccard similarity |
| `src/routes/recipes.js` | REST endpoints. multer `memoryStorage()` for file upload |
| `src/schemas/recipe.js` | Zod validation schemas |

**API Endpoints (Phase 1):**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/recipes/import/paprika` | Upload `.paprikarecipes` file |
| `POST` | `/api/recipes/import/recipesage` | Upload RecipeSage JSON-LD export |
| `POST` | `/api/recipes/import/csv` | Upload CSV file |
| `POST` | `/api/recipes/import/url` | Import single recipe from URL |
| `GET` | `/api/recipes` | List recipes (pagination, search, category/rating/source filters) |
| `GET` | `/api/recipes/:id` | Single recipe detail |
| `POST` | `/api/recipes` | Manual recipe entry |
| `PUT` | `/api/recipes/:id` | Update recipe |
| `DELETE` | `/api/recipes/:id` | Soft-delete recipe |
| `GET` | `/api/recipes/categories` | Category list with auto-computed counts/frequencies |
| `PUT` | `/api/recipes/categories/overrides` | Save frequency overrides to `cellars.settings` |
| `POST` | `/api/recipes/:id/pair` | Pair single recipe -> `getHybridPairing()` |
| `POST` | `/api/recipes/sync/:provider` | Trigger sync (`paprika` or `mealie`) |
| `GET` | `/api/recipes/sync/:provider/status` | Last sync time, counts, errors |

### 3. New Frontend Files

| File | Purpose |
|------|---------|
| `public/js/api/recipes.js` | API module using `apiFetch` from `./base.js` |
| `public/js/recipes.js` | Entry point. Lazy-loaded on tab switch. Renders Recipe Library with inline profile/buying summary |
| `public/js/recipes/state.js` | `localStorage` persistence. Key: `wineapp.recipes.*` |
| `public/js/recipes/recipeImport.js` | Multi-source import UI: tab strip for Paprika/Mealie/RecipeSage/CSV/URL/Manual |
| `public/js/recipes/recipeLibrary.js` | Searchable/filterable recipe card grid |
| `public/js/recipes/recipeForm.js` | Manual entry/edit form |
| `public/js/recipes/recipeDetail.js` | Single recipe view with pairing results |

### 4. Existing Files to Modify

| File | Change |
|------|--------|
| `public/index.html` | Add `<button class="tab" data-view="recipes">Recipes</button>` after Find Pairing. Add `<div class="view" id="view-recipes" hidden>` |
| `public/js/app.js` | Import `initRecipes` / `loadRecipes`. Add `'recipes'` case to `switchView()` |
| `src/routes/index.js` | Mount: `router.use('/recipes', requireAuth, requireCellarContext, recipesRoutes)` |
| `src/schemas/settings.js` | Flexible source string (P0) |
| `src/routes/settings.js` | Add Paprika/Mealie test-connection dispatchers |
| `public/js/settings.js` | Paprika + Mealie credential sections |
| `public/js/api/index.js` | Barrel re-export `./recipes.js` |
| `public/sw.js` | `STATIC_ASSETS` + `CACHE_VERSION` bump |
| `public/css/styles.css` | Recipe cards, import UI, layout |
| `package.json` | Add `adm-zip` |

### 5. Key Reuse Points

- **`extractSignals(dish)`** from `src/services/pairing/pairingEngine.js`
- **`getHybridPairing(wines, dish, options)`** from `pairingEngine.js`
- **`matchWineToStyle(wine)`** from `pairingEngine.js`
- **multer upload pattern** from `src/routes/awards.js`
- **`ensureTables()`** pattern from `src/services/palateProfile.js`
- **`apiFetch`** from `public/js/api/base.js`
- **Credential CRUD** from `src/routes/settings.js` (after P0 refactor)

### 6. Empty States & Error States

| State | What the user sees |
|-------|-------------------|
| **Zero recipes** | Hero card: "Add your recipes to get personalised wine buying advice" with import buttons as large cards with icons |
| **Import in progress** | Progress bar: "Importing... 128 of 368 recipes" |
| **Import complete** | Summary overlay: "128 imported, 3 updated, 15 categories found. [View recipes]" |
| **Import partial fail** | Amber banner: "Imported 95 recipes. 5 failed (invalid format). [Show errors] [Dismiss]" |
| **Import total fail** | Red banner: "Import failed: format not recognised. Expected .paprikarecipes, .json, or .csv. [Try again]" |
| **Sync stale** | Amber banner: "Last synced 3 days ago  sync failed (rate limited). [Retry] [Details]" |
| **Sync in progress** | Spinner: "Syncing with Paprika..." |
| **Pair result empty** | "No wines match this recipe's profile. [See buying suggestions]" |
| **Offline (PWA)** | Recipe library from cache. Pairing disabled with tooltip: "Requires internet" |

### 7. First-Run Flow (Gestalt: Clear Path)

Guided funnel, not a blank canvas:

`
Step 1: IMPORT
  +---------------------------------------------+
  |  Add Your Recipes                            |
  |                                              |
  |  [Paprika]  [Mealie]  [CSV Upload]           |
  |  [Recipe URL]  [Manual Entry]                |
  |  [RecipeSage]                                |
  +---------------------------------------------+

Step 2: REVIEW (auto-shown after import)
  +---------------------------------------------+
  |  Your Cooking Profile                        |
  |                                              |
  |  Based on 368 recipes, you cook mostly:      |
  |  Chicken (48)  Fish (52)  Beef (34)          |
  |                                              |
  |  Adjust if needed:                           |
  |  Chicken  [========--] Often                 |
  |  Fish     [==========] Very Often            |
  |  [Continue to Buying Advice ->]              |
  +---------------------------------------------+

Step 3: BUY (shown inline)
  +---------------------------------------------+
  |  Your cellar covers 68% of cooking needs     |
  |  ================------------ 68%            |
  |                                              |
  |  Wines You Need:                             |
  |  +-- Crisp White (+3 bottles) -------------+ |
  |  | You cook fish & chicken often.           | |
  |  | Try: Sauvignon Blanc, Pinot Grigio      | |
  |  +-----------------------------------------+ |
  +---------------------------------------------+
`

After first run, default view = Recipe Library with profile + buying cards pinned at top.

---

## Phase 2: Cooking Profile Engine + Multi-Recipe Pairing

### 1. Database

**`cooking_profiles`** table:
- `id SERIAL PRIMARY KEY`
- `cellar_id UUID NOT NULL UNIQUE`
- `profile_data JSONB NOT NULL`
- `generated_at TIMESTAMPTZ DEFAULT NOW()`

### 2. New Backend Files

| File | Purpose |
|------|---------|
| `src/services/recipe/cookingProfile.js` | Core profile computation engine |

**Profile computation algorithm:**
1. For each active recipe (`deleted_at IS NULL`): compute signals via `extractSignals(name + ' ' + ingredients)`
2. Weight by rating: `5 stars=2.0x`, `4 stars=1.0x`, `3 stars=0.7x`, `unrated=0.3x`  rated recipes dominate
3. Apply category frequency boost from auto-computed counts (override-able): `categoryWeight = min(recipeCountInCategory / medianCategoryCount, 3.0)`
4. Apply `categorySignalMap` boost at 0.5x weight  fuzzy-matched
5. Convert weighted signals -> wine style demand via `FOOD_SIGNALS[signal].wineAffinities` (primary=3pts, good=2pts, fallback=1pt)
6. Normalise to percentages (demand sums to 1.0)
7. Apply seasonal bias if set: summer boosts `grilled`, `raw`, `fish`, `shellfish`; winter boosts `braised`, `roasted`, `umami`, `earthy`

**Rating weight rationale:** With 51% unrated recipes, the original 1.0x unrated weight meant unrated recipes dominated the profile. 0.3x ensures explicitly rated recipes (user preference signal) drive the profile.

**Profile output:**
`json
{
  "dominantSignals": [{"signal": "chicken", "weight": 8.5}],
  "wineStyleDemand": {"white_medium": 0.22, "red_full": 0.15},
  "categoryBreakdown": {"Chicken": {"count": 48, "autoFrequency": 4.2, "userOverride": null}},
  "seasonalBias": "summer",
  "recipeCount": 368,
  "ratedRecipeCount": 180,
  "demandTotal": 1.0
}
`

### 3. New Frontend Files

| File | Purpose |
|------|---------|
| `public/js/recipes/profileSummary.js` | Inline profile card (not a sub-view): signal bars, top 5 categories, style demand proportion bar. Shows at top of Recipe Library when >=5 recipes |
| `public/js/recipes/menuBuilder.js` | Multi-recipe pairing wizard: select recipes -> review signals -> group pairing |
| `public/js/recipes/menuState.js` | Menu builder state (`sessionStorage`) |
| `public/js/recipes/categoryOverrides.js` | Expandable override panel: auto-computed frequencies with slider overrides. "Rarely" -> "Very Often". Only shown on user request |

### 4. New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/recipes/profile` | Compute & return cooking profile |
| `POST` | `/api/recipes/profile/refresh` | Force recompute (cache-bust) |
| `POST` | `/api/recipes/menu-pair` | Multi-recipe pairing |

---

## Phase 3: Buying Guide (Gap Analysis)

### 1. New Backend Files

| File | Purpose |
|------|---------|
| `src/services/recipe/buyingGuide.js` | Core gap analysis engine |

**Gap analysis algorithm:**
1. Map cellar wines to style buckets via `matchWineToStyle()` -> `cellarStyleCounts`
2. Get cooking profile `wineStyleDemand` (percentages summing to 1.0)
3. Calculate demand-proportional targets: `target[style] = round(demandPct * totalBottles)`
   - No per-style floor  0% demand = target 0
   - Targets guaranteed to sum to <= totalBottles
4. Compute gaps: when `have < target` AND `target >= 1`
5. Compute surpluses: when `have > target + 2`
6. For gaps: include top signals driving demand, shopping suggestions via `getShoppingSuggestions()`
7. For surpluses: cross-reference with `getAtRiskWines()` for reduce-now links
8. **Diversity recommendations** (separate from gaps, advisory tone): for styles with 0% demand but 0 bottles, suggest keeping 1-2 for guests
9. Apply seasonal bias: adjust demand +-10% based on current season + hemisphere from `cellars.settings`
10. Priority sort: `demandPct * deficit` (highest need * biggest gap first)

**Season helper:**
`javascript
function getCurrentSeason(hemisphere = 'southern') {
  const month = new Date().getMonth(); // 0-indexed
  const seasons = hemisphere === 'southern'
    ? ['summer','summer','autumn','autumn','autumn','winter','winter','winter','spring','spring','spring','summer']
    : ['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'];
  return seasons[month];
}
`

**Hemisphere setting:** Stored in `cellars.settings` JSONB as `{ hemisphere: 'southern' }`. Cellar-scoped  a cellar's hemisphere is a property of the cellar's location, not the user.

### 2. New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/recipes/buying-guide` | Full buying guide report (under /api/recipes, same route file) |

### 3. New Frontend Files

| File | Purpose |
|------|---------|
| `public/js/recipes/buyingGuide.js` | Inline buying guide section: coverage bar, gap cards, surplus cards, diversity recs |
| `public/js/recipes/seasonToggle.js` | Global summer/winter toggle (not per-category) |
| `public/js/api/buyingGuide.js` | API module: `getBuyingGuide()` |

### 4. Existing Files to Modify (P3)

| File | Change |
|------|--------|
| `src/services/cellar/cellarHealth.js` | Export `getShoppingSuggestions()` |
| `public/js/api/index.js` | Re-export buying guide API |
| `public/js/settings.js` | Hemisphere toggle in Preferences |
| `public/index.html` | Hemisphere selector in settings |
| `public/css/styles.css` | Gap/surplus cards, coverage bar, season toggle |

---

## Sync Architecture

### Paprika Cloud Sync

**File import** is the foundation. Cloud sync is optional.

**Paprika v1 API** (reverse-engineered, community-documented):
- Base URL: `https://www.paprikaapp.com/api/v1/`
- Auth: HTTP Basic (email + password) -> token
- `GET /sync/recipes/` -> `[{uid, hash}, ...]`
- `GET /sync/recipe/{uid}/` -> full recipe JSON
- `GET /sync/categories/` -> category mappings
- `GET /sync/meals/` -> meal plan entries (future)

**Sync flow:**
1. Fetch recipe list with hashes from Paprika API
2. Compare against `recipe_sync_state`: identify new, changed, deleted
3. Fetch full data only for new/changed (typically 2-5 API calls)
4. Normalise via `paprikaAdapter.js` -> `recipeNormaliser.js`
5. Upsert recipes, update sync state hashes and `last_seen_at`
6. Recipes NOT seen for 3 consecutive syncs: set `recipes.deleted_at` (soft delete with recovery)
7. Log result to `recipe_sync_log`

**Error visibility:**
- Errors surface as non-blocking amber banner: "Last synced 3 days ago  failed. [Retry]"
- Buying guide shows staleness caveat when recipes are stale
- `recipe_sync_log` stores detailed error info

**Rate limit mitigation:**
- Paprika rate-limits at ~40 calls/hour
- Our approach: 1 list call + N changed-only calls
- Auto-sync max once per 24h (via `recipe_sync_log.completed_at`)
- Exponential backoff on 429 responses

### Mealie API Sync

**Mealie API** (docs.mealie.io):
- Base URL: user-provided (self-hosted)
- Auth: API token (`Authorization: Bearer <token>`)
- `GET /api/recipes` -> paginated list with slugs
- `GET /api/recipes/{slug}` -> full recipe with structured ingredients

**Sync flow:**
1. Fetch paginated recipe list
2. Hash content for diff via `recipe_sync_state`
3. Fetch full recipe for new/changed
4. Normalise: map structured ingredients (`{food, quantity, unit}`) to newline text
5. Upsert + log (same pattern as Paprika)

**Credentials in Settings:**
- Instance URL + API Token fields
- "Test Connection": `GET /api/recipes?page=1&perPage=1`
- Stored in `source_credentials` table

### RecipeSage File Import (No Sync)

RecipeSage API requires commercial licensing. File import only via JSON-LD export.

User flow: RecipeSage -> Settings -> Export -> Download JSON -> Upload in our import UI.

### Settings UI for Integrations

In Settings -> Integrations (alongside Vivino/Decanter):

**Paprika Cloud Sync:**
- Email + Password fields
- Test Connection / Sync Now / Delete buttons
- Auto-sync daily toggle
- Status: "Last synced: 2h ago  368 recipes, 0 changes" OR "Failed 3 days ago (rate limited)"

**Mealie:**
- Instance URL + API Token fields
- Test Connection / Sync Now / Delete buttons
- Auto-sync daily toggle
- Status line (same pattern)

---

## Full File Inventory

### New Files (28 total)

**Backend (14):**
1. `src/services/recipe/adapters/adapterInterface.js`
2. `src/services/recipe/adapters/paprikaAdapter.js`
3. `src/services/recipe/adapters/mealieAdapter.js`
4. `src/services/recipe/adapters/recipeSageAdapter.js`
5. `src/services/recipe/adapters/jsonLdAdapter.js`
6. `src/services/recipe/adapters/csvAdapter.js`
7. `src/services/recipe/recipeNormaliser.js`
8. `src/services/recipe/recipeService.js`
9. `src/services/recipe/recipeSyncService.js`
10. `src/services/recipe/categorySignalMap.js`
11. `src/services/recipe/cookingProfile.js`
12. `src/services/recipe/buyingGuide.js`
13. `src/routes/recipes.js`
14. `src/schemas/recipe.js`

**Frontend (14):**
1. `public/js/api/recipes.js`
2. `public/js/api/buyingGuide.js`
3. `public/js/recipes.js`
4. `public/js/recipes/state.js`
5. `public/js/recipes/recipeImport.js`
6. `public/js/recipes/recipeLibrary.js`
7. `public/js/recipes/recipeForm.js`
8. `public/js/recipes/recipeDetail.js`
9. `public/js/recipes/profileSummary.js`
10. `public/js/recipes/menuBuilder.js`
11. `public/js/recipes/menuState.js`
12. `public/js/recipes/categoryOverrides.js`
13. `public/js/recipes/buyingGuide.js`
14. `public/js/recipes/seasonToggle.js`

**Database (1):**
1. `data/migrations/055_recipes_and_sync.sql`

**Tests (11):**
1. `tests/unit/services/recipe/paprikaAdapter.test.js`
2. `tests/unit/services/recipe/mealieAdapter.test.js`
3. `tests/unit/services/recipe/recipeSageAdapter.test.js`
4. `tests/unit/services/recipe/csvAdapter.test.js`
5. `tests/unit/services/recipe/jsonLdAdapter.test.js`
6. `tests/unit/services/recipe/recipeNormaliser.test.js`
7. `tests/unit/services/recipe/recipeService.test.js`
8. `tests/unit/services/recipe/recipeSyncService.test.js`
9. `tests/unit/services/recipe/cookingProfile.test.js`
10. `tests/unit/services/recipe/buyingGuide.test.js`
11. `tests/unit/routes/recipes.test.js`

### Existing Files Modified (12)

1. `public/index.html`  tab + view container + hemisphere in settings
2. `public/js/app.js`  lazy-load `'recipes'` view
3. `src/routes/index.js`  mount recipe routes
4. `src/schemas/settings.js`  flexible source string (P0)
5. `src/routes/settings.js`  Paprika/Mealie test-connection dispatchers
6. `public/js/settings.js`  Paprika + Mealie credential sections
7. `public/js/api/index.js`  barrel re-exports
8. `public/sw.js`  `STATIC_ASSETS` + `CACHE_VERSION`
9. `public/css/styles.css`  all new component styles
10. `src/services/cellar/cellarHealth.js`  export `getShoppingSuggestions()`
11. `tests/unit/utils/swStaticAssets.test.js`  `LAZY_ENTRYPOINTS` (P0)
12. `package.json`  add `adm-zip`

---

## Testing Strategy

### Unit Tests (10 files)

| Test File | Covers |
|-----------|--------|
| `paprikaAdapter.test.js` | ZIP extraction, gunzip, field mapping, photo stripping, malformed files |
| `mealieAdapter.test.js` | Structured ingredient -> text, pagination, API error mocking |
| `recipeSageAdapter.test.js` | JSON-LD parsing, field mapping, missing fields |
| `csvAdapter.test.js` | Column mapping, encoding, empty rows, missing required fields |
| `jsonLdAdapter.test.js` | URL scrape mock, JSON-LD extraction, missing markup |
| `recipeNormaliser.test.js` | Signal extraction, category boost, validation, edge cases |
| `recipeService.test.js` | CRUD, dedup upsert, soft delete, cellar scoping, re-import of deleted blocked |
| `recipeSyncService.test.js` | Hash diff, delete detection (3-sync threshold), error logging, rate limit backoff, idempotency |
| `cookingProfile.test.js` | Rating weights, seasonal bias, overrides, edge: 0 recipes, 1 recipe |
| `buyingGuide.test.js` | Targets sum <= totalBottles, no impossible recs, diversity recs, seasonal shifts, surplus |

### Route Tests (1 file)

| Test File | Covers |
|-----------|--------|
| `recipes.test.js` | 401 without auth, cellar scoping, import validation, soft delete, sync status |

### Regression Tests (existing, enhanced)

| Test | Catches |
|------|---------|
| `swStaticAssets.test.js` (enhanced) | All new files in `STATIC_ASSETS`, lazy entrypoints walked |
| `apiAuthHeaders.test.js` | New `public/js/recipes/` files don't use raw `fetch('/api/...')` |

---

## Verification Checklist

### After P0:
- [ ] `src/schemas/settings.js` accepts `'paprika'` and `'mealie'` sources
- [ ] Settings UI renders Paprika + Mealie credential sections
- [ ] `swStaticAssets.test.js` walks dynamic imports
- [ ] `npm run test:unit` passes

### After Phase 1:
- [ ] Import `.paprikarecipes` -> recipes appear
- [ ] Re-import -> dedup (updates, no dupes)
- [ ] Import RecipeSage JSON-LD -> recipes with `source_provider='recipesage'`
- [ ] Import CSV -> mapped fields
- [ ] Import from URL -> JSON-LD extracted
- [ ] Manual entry -> correct `cellar_id`
- [ ] Delete -> soft delete (`deleted_at` set)
- [ ] Paprika sync: creds -> test -> sync -> log created
- [ ] Mealie sync: URL + token -> test -> sync -> imported
- [ ] Sync failure: amber banner, buying guide staleness caveat
- [ ] Zero recipes: hero import card
- [ ] `npm run test:all` passes

### After Phase 2:
- [ ] Profile summary shows dominant signals
- [ ] 5-star recipes dominate over unrated
- [ ] Override sliders change profile
- [ ] Menu builder: select 3 -> group pairing
- [ ] Profile recomputes on import/delete

### After Phase 3:
- [ ] Coverage bar shows percentage
- [ ] Gap cards with deficit + reasoning + suggestions
- [ ] Surplus cards link to reduce-now
- [ ] Diversity recs shown separately (advisory)
- [ ] Season toggle shifts recommendations
- [ ] Hemisphere in `cellars.settings` (not profiles)
- [ ] Targets sum <= total bottles
- [ ] Deploy to Railway + production smoke test

---

## Future Enhancements (Post-P3)

| Enhancement | Description | Effort |
|-------------|-------------|--------|
| **Meal plan integration** | Paprika `/sync/meals/`: "Tonight's dinner" auto-pairing | Low |
| **Recipe URL bookmarklet** | Browser bookmarklet sends URL to import endpoint | Low |
| **Mealie webhook sync** | Listen for Mealie events instead of polling | Medium |
| **RecipeSage API sync** | If commercial license obtained | Medium |
| **Smart shopping list** | Printable list from buying guide gaps | Medium |
| **Recipe wine history** | Track which wines paired with each recipe + user rating | Medium |
| **AI signal extraction** | Claude for nuanced signals from complex recipes | Low |
