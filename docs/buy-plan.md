# Paprika Recipe Integration & Buying Guide

## Context

The user manages cooking recipes in Paprika (paprikaapp.com) and wants the wine cellar app to:
1. Import recipes from Paprika's `.paprikarecipes` export format
2. Build a cooking profile from recipe data (categories, ratings, frequencies)
3. Pair wines from the cellar against recipes/menus
4. Provide a **Buying Guide** that identifies which wines to stock more/less of based on cooking patterns

Non-Paprika users must still be able to enter recipes manually and use the buying guide via category frequency self-assessment.

### Key Data from User's Paprika Export (368 recipes)
- Categories are **plain strings** (not UUIDs): Chicken(48), Fish(52), Beef(34), Braai(30), Asian(30), etc.
- Ratings: 51% unrated, 40% rated 5/5, 8% rated 4/5
- Ingredients: newline-delimited text with Unicode fractions
- Photos: **Strip entirely** (user decision) — no photo storage

### User Decisions
- **Tab position**: After "Find Pairing" → `Grid | Analysis | Find Pairing | Buying Guide | Wine List | History | Settings`
- **Season logic**: Configurable per cellar (hemisphere setting), not hardcoded
- **Photos**: Strip base64 photo data; store only `image_url` if available (zero storage cost)

---

## Phase 1: Recipe Import + Library + Single-Recipe Pairing

### 1. Database Tables

Create via `ensureTables()` pattern (like `palateProfile.js`):

**`recipes`** table:
- `id SERIAL PRIMARY KEY`
- `cellar_id UUID NOT NULL` — multi-tenant scope
- `paprika_uid TEXT` — dedup key for re-imports, `UNIQUE(cellar_id, paprika_uid)`
- `name TEXT NOT NULL`
- `ingredients TEXT` — newline-delimited (Paprika format)
- `directions TEXT`
- `categories TEXT DEFAULT '[]'` — JSON array of category strings
- `rating INTEGER DEFAULT 0` — 0-5 (0 = unrated)
- `cook_time, prep_time, total_time, servings TEXT` — free-text fields
- `source, source_url, notes TEXT`
- `image_url TEXT` — external URL reference only (no base64 storage)
- `food_signals TEXT DEFAULT '[]'` — JSON array of pre-extracted pairing signals (cached)
- `imported_from TEXT DEFAULT 'manual'` — `'paprika'` | `'manual'`
- `created_at, updated_at TIMESTAMP`

**`category_frequencies`** table:
- `id SERIAL PRIMARY KEY`
- `cellar_id UUID NOT NULL`
- `category TEXT NOT NULL`
- `frequency INTEGER DEFAULT 3` — 1-5 self-assessed
- `season TEXT DEFAULT 'all'` — `'all'` | `'summer'` | `'winter'` | `'spring'` | `'autumn'`
- `recipe_count INTEGER DEFAULT 0` — auto-computed from recipes
- `UNIQUE(cellar_id, category, season)`

### 2. New Backend Files

| File | Purpose |
|------|---------|
| `src/services/recipe/paprikaParser.js` | Parse `.paprikarecipes` (ZIP → gunzip → JSON). Uses `adm-zip` + `zlib`. Strips photo_data, maps fields to recipe schema, runs `extractSignals()` on ingredients+name+categories to pre-cache food_signals |
| `src/services/recipe/recipeService.js` | `ensureRecipeTables()`, `importPaprikaRecipes(buffer, cellarId)`, `createRecipe()`, `updateRecipe()`, `deleteRecipe()`, `getRecipes(cellarId, filters)`, `getRecipe()`, `getRecipeCategories()`, `getCategoryFrequencies()`, `setCategoryFrequency()`. Dedup on import via `ON CONFLICT(cellar_id, paprika_uid) DO UPDATE` |
| `src/services/recipe/paprikaSync.js` | Paprika cloud sync: `authenticate(email, pass)`, `fetchRecipeList()`, `fetchRecipe(uid)`, `syncRecipes(cellarId)`. Differential sync via hash comparison. Rate-limit aware. Returns `{added, updated, unchanged, errors}` |
| `src/services/recipe/categorySignalMap.js` | Maps Paprika categories to FOOD_SIGNALS: `Chicken→['chicken']`, `Braai→['grilled','smoky']`, `Asian→['spicy','umami']`, `Slow-cooker→['braised']`, etc. |
| `src/routes/recipes.js` | REST endpoints (see below). Uses multer `memoryStorage()` for file upload (pattern from `awards.js`) |
| `src/schemas/recipe.js` | Zod validation: `createRecipeSchema`, `recipePairSchema`, `categoryFrequencySchema` |

**API Endpoints (Phase 1):**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/recipes/import` | Upload `.paprikarecipes` file |
| `GET` | `/api/recipes` | List recipes (pagination, category/search filters) |
| `GET` | `/api/recipes/:id` | Single recipe |
| `POST` | `/api/recipes` | Manual recipe entry |
| `PUT` | `/api/recipes/:id` | Update recipe |
| `DELETE` | `/api/recipes/:id` | Delete recipe |
| `GET` | `/api/recipes/categories` | Category list with counts |
| `GET` | `/api/recipes/categories/frequencies` | Get frequency settings |
| `PUT` | `/api/recipes/categories/frequencies` | Batch update frequencies |
| `POST` | `/api/recipes/:id/pair` | Pair single recipe → calls `getHybridPairing()` from existing `pairingEngine.js` |
| `POST` | `/api/recipes/sync` | Trigger Paprika cloud sync (requires stored credentials) |
| `GET` | `/api/recipes/sync/status` | Last sync time, recipe counts, errors |

### 3. New Frontend Files

| File | Purpose |
|------|---------|
| `public/js/api/recipes.js` | API module: `importPaprikaRecipes(file)`, `getRecipes()`, `createRecipe()`, `updateRecipe()`, `deleteRecipe()`, `getRecipeCategories()`, `getCategoryFrequencies()`, `updateCategoryFrequencies()`, `pairRecipe()` |
| `public/js/buyingGuide.js` | Entry point/orchestrator. Handles sub-view switching (Recipe Library / Cooking Profile / Gap Analysis). Lazy-loaded on tab switch |
| `public/js/buyingGuide/state.js` | Module state with `localStorage` persistence (pattern from `cellarAnalysis/state.js`) |
| `public/js/buyingGuide/recipeImport.js` | File upload UI with progress, import summary (X imported, Y updated, Z categories) |
| `public/js/buyingGuide/recipeLibrary.js` | Searchable/filterable recipe card grid, category filter dropdown, rating display, "Pair this recipe" button |
| `public/js/buyingGuide/recipeForm.js` | Manual entry/edit form: name, ingredients textarea, categories tag input, rating stars, cook/prep time, source |
| `public/js/buyingGuide/categoryFrequencies.js` | Slider UI (1-5) per category with labels ("Rarely" → "Very Often"), seasonal toggle per category, auto-populated from recipe counts |

### 4. Existing Files to Modify

| File | Change |
|------|--------|
| `public/index.html` | Add tab button `<button class="tab" data-view="buying-guide">Buying Guide</button>` after Find Pairing (line 76). Add view container `<div class="view" id="view-buying-guide" hidden>` with sub-view toggle and content areas |
| `public/js/app.js` | Import `initBuyingGuide`/`loadBuyingGuide`. Add to `switchView()` lazy-loader. Register init call |
| `src/routes/index.js` | Mount: `router.use('/recipes', requireAuth, requireCellarContext, recipesRoutes)` |
| `public/js/api/index.js` | Barrel re-export from `./recipes.js` |
| `public/sw.js` | Add all new JS files to `STATIC_ASSETS`; bump `CACHE_VERSION` |
| `public/css/styles.css` | Recipe cards, import UI, frequency sliders, buying guide layout |
| `public/js/settings.js` | Add Paprika Cloud Sync section to Integrations (email/password, test connection, sync now, auto-sync toggle, last-synced status) |
| `package.json` | Add `adm-zip` dependency (for ZIP extraction) |

### 5. Key Reuse Points

- **`extractSignals(dish)`** from `src/services/pairing/pairingEngine.js` — pre-cache food signals per recipe
- **`getHybridPairing(wines, dish, options)`** from `pairingEngine.js` — single-recipe pairing
- **`matchWineToStyle(wine)`** from `pairingEngine.js` — style classification for gap analysis
- **multer upload pattern** from `src/routes/awards.js` lines 17-28
- **`ensureTables()`** pattern from `src/services/palateProfile.js` lines 16-102
- **`apiFetch` wrapper** from `public/js/api/base.js` — all frontend calls

---

## Phase 2: Cooking Profile + Multi-Recipe Menu Pairing

### 1. Database

**`cooking_profiles`** table:
- `id SERIAL PRIMARY KEY`
- `cellar_id UUID NOT NULL UNIQUE`
- `profile_data JSONB NOT NULL` — full computed profile
- `generated_at TIMESTAMP`

### 2. New Backend Files

| File | Purpose |
|------|---------|
| `src/services/recipe/cookingProfile.js` | Core profile computation engine |

**Profile computation algorithm:**
1. For each recipe: extract food_signals, weight by `rating` (5★=2.0x, 4★=1.5x, unrated=1.0x) × `category_frequency` (normalized: freq/3)
2. Add category-derived signals from `categorySignalMap.js` at 0.5x weight
3. Convert weighted signals → wine style demand via `FOOD_SIGNALS[signal].wineAffinities` (primary=3pts, good=2pts, fallback=1pt)
4. Normalize to percentages
5. Apply seasonal adjustments from `category_frequencies` where `season != 'all'`

**Profile output structure:**
```json
{
  "dominantSignals": [{"signal": "chicken", "weight": 8.5}, ...],
  "wineStyleDemand": {"white_medium": 0.22, "red_full": 0.15, ...},
  "categoryBreakdown": {"Chicken": {"count": 48, "frequency": 5, "weightedScore": 240}},
  "recipeCount": 368, "ratedRecipeCount": 180
}
```

### 3. New Frontend Files

| File | Purpose |
|------|---------|
| `public/js/buyingGuide/cookingProfile.js` | Profile dashboard: dominant signals bar chart (CSS-only), wine style demand bars, top categories ranked list |
| `public/js/buyingGuide/menuBuilder.js` | Multi-recipe pairing wizard: select recipes → review signals → get group pairing (follows restaurant pairing pattern) |
| `public/js/buyingGuide/menuState.js` | Menu builder state (sessionStorage, like `restaurantPairing/state.js`) |

### 4. New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/recipes/profile` | Compute & return cooking profile |
| `POST` | `/api/recipes/profile/refresh` | Force recompute |
| `POST` | `/api/recipes/menu-pair` | Multi-recipe pairing: aggregate signals, call `getHybridPairing()` |

---

## Phase 3: Buying Guide (Full Gap Analysis)

### 1. New Backend Files

| File | Purpose |
|------|---------|
| `src/services/recipe/buyingGuide.js` | Core gap analysis engine |
| `src/routes/buyingGuide.js` | Buying guide API endpoints |

**Gap analysis algorithm:**
1. Map cellar wines to style buckets via `matchWineToStyle()` → `cellarStyleCounts`
2. Calculate **demand-proportional targets**: `target[style] = max(2, round(demandPct × totalBottles))`
   (Unlike `cellarHealth.js` static targets, these scale with cooking profile)
3. Compute gaps (deficit > 1) and surpluses (surplus > 2)
4. For gaps: include top food signals driving demand, shopping suggestions
5. For surpluses: cross-reference with reduce-now wines
6. Apply seasonal adjustment based on current season + hemisphere setting
7. Priority sort: `demandPct × deficit` (highest cooking need × biggest gap first)

**Season helper** (configurable):
```javascript
function getCurrentSeason(hemisphere = 'northern') {
  const month = new Date().getMonth();
  // hemisphere from cellar settings (profiles.settings.hemisphere)
  if (hemisphere === 'southern') { /* Dec-Feb=summer */ }
  else { /* Jun-Aug=summer */ }
}
```

**Hemisphere setting**: Stored in `profiles.settings` JSONB as `{ hemisphere: 'northern' | 'southern' }`, configurable in Settings view.

### 2. New API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/buying-guide` | Full buying guide report |
| `GET` | `/api/buying-guide/gaps` | Gaps only (lighter) |
| `GET` | `/api/buying-guide/surpluses` | Surpluses only |

### 3. New Frontend Files

| File | Purpose |
|------|---------|
| `public/js/buyingGuide/gapAnalysis.js` | "Wines You Need" cards (deficit, demand reason, suggestions) + "Wines You Have Too Much Of" cards (surplus, reduce-now links). Summary bar: "Your cellar covers X% of your cooking needs" |
| `public/js/buyingGuide/seasonalView.js` | How targets shift by season. Toggle to preview summer/winter scenarios |
| `public/js/api/buyingGuide.js` | API module: `getBuyingGuide()`, `getBuyingGuideGaps()`, `getBuyingGuideSurpluses()` |

### 4. Existing Files to Modify (P3)

| File | Change |
|------|--------|
| `src/routes/index.js` | Mount: `router.use('/buying-guide', requireAuth, requireCellarContext, buyingGuideRoutes)` |
| `src/services/cellar/cellarHealth.js` | Export `getShoppingSuggestions()` for reuse in buying guide |
| `public/js/api/index.js` | Re-export buying guide API |
| `public/js/settings.js` | Add hemisphere toggle to Preferences section |
| `public/index.html` | Add hemisphere selector in settings |

---

## Paprika API Sync (Included in P1)

Rather than deferring sync, we include lightweight Paprika cloud sync in Phase 1 alongside file import. This ensures recipes stay current without the user needing to remember to re-export.

### Sync Strategy: Hybrid (File Import + Optional API Sync)

**File import** remains the foundation and always works. API sync is an optional enhancement the user can enable.

### How It Works

1. **Connect**: User enters Paprika Cloud Sync email/password in Settings → Integrations
2. **Credentials stored** in existing `source_credentials` table (encrypted, pattern from Vivino/Decanter credentials)
3. **Sync trigger**: On-demand "Sync Now" button + optional auto-sync on Buying Guide tab load (at most once per 24 hours)
4. **Differential sync**: Call `/api/v1/sync/recipes/` which returns recipe UIDs + hashes. Compare hashes against stored `paprika_uid` + local hash. Only fetch changed/new recipes via `/api/v1/sync/recipe/{uid}/`
5. **Normalisation**: Fetched recipes pass through the same `paprikaParser.js` pipeline as file imports (strip photos, extract signals, map categories)
6. **Dedup**: Same `ON CONFLICT(cellar_id, paprika_uid) DO UPDATE` logic — sync is idempotent

### Technical Details

**Paprika v1 API** (reverse-engineered, community-documented):
- Base URL: `https://www.paprikaapp.com/api/v1/`
- Auth: HTTP Basic (email + password) → returns token
- `GET /sync/recipes/` → `[{uid, hash}, ...]` (lightweight, ~2KB for 368 recipes)
- `GET /sync/recipe/{uid}/` → full recipe JSON (one call per changed recipe)
- `GET /sync/categories/` → category name/UID mappings
- `GET /sync/meals/` → meal plan entries (future: "tonight's pairing")

**Rate limit mitigation**:
- Paprika rate-limits aggressive API usage (40+ calls/hour can trigger IP bans)
- Our approach is lightweight: 1 call to list hashes + N calls only for changed recipes
- Typical sync for an active user: 2-5 API calls total
- Auto-sync capped at once per 24 hours, with manual override
- If API returns error/rate-limit, silently fall back — no user-facing error, just a "Last synced: X ago" indicator

**Fallback**: If Paprika ever shuts down the v1 API (they've already tightened v2), the file import path continues to work. The sync simply stops updating and the UI shows "Sync unavailable — use file import instead."

### New Files for Sync

| File | Purpose |
|------|---------|
| `src/services/recipe/paprikaSync.js` | API client: `authenticate(email, password)`, `fetchRecipeList()`, `fetchRecipe(uid)`, `syncRecipes(cellarId)`. Uses node-fetch with Basic Auth. Respects rate limits. Returns `{added, updated, unchanged, errors}` |

### New API Endpoints for Sync

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/recipes/sync` | Trigger Paprika cloud sync (requires stored credentials) |
| `GET` | `/api/recipes/sync/status` | Last sync time, recipe counts, any errors |

### Settings UI Addition

In Settings → Integrations (alongside existing Vivino/Decanter credentials):
- "Paprika Cloud Sync" section
- Email + Password fields (stored encrypted via existing credential pattern)
- "Test Connection" button (calls Paprika login, verifies access)
- "Sync Now" button
- "Auto-sync" toggle (daily, on tab load)
- "Last synced: 2 hours ago — 368 recipes, 0 changes" status line

### Sync vs File Import Comparison

| Aspect | File Import | API Sync |
|--------|-------------|----------|
| Setup | None | Enter Paprika credentials once |
| Frequency | Manual (user remembers) | Automatic (daily or on-demand) |
| Reliability | 100% (file is local) | ~95% (API could be restricted) |
| Completeness | Full export | Differential (only changes) |
| New recipes | Requires new export | Auto-detected |
| Deleted recipes | Not detected | Can detect via hash comparison |
| Fallback | N/A | Falls back to file import |

### Future Enhancement (Post-P3): Meal Plan Integration

Once sync is established, a natural next step is pulling meal plan data (`/sync/meals/`) to enable:
- "Tonight's dinner" auto-pairing based on Paprika meal plan
- Weekly meal plan → weekly wine plan
- This is low additional effort once sync infrastructure exists

---

## Full File Inventory

### New Files (23 total)

**Backend (9):**
1. `src/services/recipe/paprikaParser.js`
2. `src/services/recipe/paprikaSync.js`
3. `src/services/recipe/recipeService.js`
4. `src/services/recipe/categorySignalMap.js`
5. `src/services/recipe/cookingProfile.js`
6. `src/services/recipe/buyingGuide.js`
7. `src/routes/recipes.js`
8. `src/routes/buyingGuide.js`
9. `src/schemas/recipe.js`

**Frontend (12):**
1. `public/js/api/recipes.js`
2. `public/js/api/buyingGuide.js`
3. `public/js/buyingGuide.js`
4. `public/js/buyingGuide/state.js`
5. `public/js/buyingGuide/recipeImport.js`
6. `public/js/buyingGuide/recipeLibrary.js`
7. `public/js/buyingGuide/recipeForm.js`
8. `public/js/buyingGuide/categoryFrequencies.js`
9. `public/js/buyingGuide/cookingProfile.js`
10. `public/js/buyingGuide/menuBuilder.js`
11. `public/js/buyingGuide/menuState.js`
12. `public/js/buyingGuide/gapAnalysis.js`
13. `public/js/buyingGuide/seasonalView.js`

**Tests (2):**
1. `tests/unit/services/recipe/paprikaParser.test.js`
2. `tests/unit/services/recipe/cookingProfile.test.js`

### Existing Files Modified (9)

1. `public/index.html` — tab + view container + hemisphere setting
2. `public/js/app.js` — lazy-load wiring
3. `src/routes/index.js` — mount recipe + buying guide routes
4. `public/js/api/index.js` — barrel re-exports
5. `public/sw.js` — STATIC_ASSETS + CACHE_VERSION bump
6. `public/css/styles.css` — all new component styles
7. `public/js/settings.js` — hemisphere toggle
8. `src/services/cellar/cellarHealth.js` — export helpers for reuse
9. `package.json` — add `adm-zip`

---

## Verification

### After Phase 1:
1. Run `npm run test:unit` — paprikaParser tests pass
2. Import the user's `.paprikarecipes` file via UI → 368 recipes appear
3. Re-import same file → dedup works (no duplicates)
4. Manual recipe entry → creates recipe with correct cellar_id
5. Category frequency sliders → persist and reload correctly
6. "Pair this recipe" → returns wine recommendations from cellar
7. Paprika Cloud Sync: enter credentials in Settings → test connection → sync now → recipes update
8. Auto-sync: revisit Buying Guide tab after 24h → sync triggers automatically
9. `npm run test:all` — all existing + new tests pass

### After Phase 2:
1. Cooking profile dashboard shows dominant signals matching recipe data
2. Menu builder: select 3 recipes → group pairing returns diverse wine recommendations
3. Profile updates when frequencies are adjusted

### After Phase 3:
1. Buying guide shows gaps ("You need more crisp whites") and surpluses
2. Seasonal toggle shifts recommendations appropriately
3. Hemisphere setting in preferences works (northern vs southern)
4. Coverage percentage reflects reality against cellar inventory
5. Full deploy to Railway + test on production
