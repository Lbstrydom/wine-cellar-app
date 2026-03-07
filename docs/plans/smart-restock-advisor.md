# Plan: Smart Restock Advisor

- **Date**: 2026-03-06
- **Status**: Draft
- **Author**: Claude + User

---

## 1. Context Summary

### What exists today

The buying guide already has a mature pipeline from **gap analysis → shopping cart → cellar conversion**:

| Component | File(s) | Status |
|---|---|---|
| Gap analysis (style deficits, food signals, targets) | `src/services/recipe/buyingGuide.js` | Production |
| Static suggestions per style (grape/appellation names) | `src/config/styleIds.js` → `SHOPPING_SUGGESTIONS` | Production |
| Shopping cart with full schema (wine_name, producer, price, vendor_url, qty, source) | `src/routes/buyingGuideItems.js`, `src/services/recipe/buyingGuideCart.js` | Production |
| Cart UI with status state machine (planned→ordered→arrived→cellar) | `public/js/recipes/cartPanel.js`, `cartState.js` | Production |
| Wine research modal (enriches cart items via Claude web search) | `public/js/recipes/wineResearch.js` | Production |
| Claude two-phase web search (Sonnet search → Haiku extraction) | `src/services/search/claudeWineSearch.js`, `wineDataExtractor.js` | Production |
| Settings key/value store (cellar-scoped, no schema changes needed) | `src/routes/settings.js`, `user_settings` table | Production |
| AI model registry with task→model mapping | `src/config/aiModels.js` | Production |
| Acquisition workflow (search→enrich→place) | `src/services/acquisitionWorkflow.js` | Production |

### The gap

Gap cards show **generic grape/appellation names** (e.g. "Try: Provence Rosé, Côtes de Provence, Tavel"). The user must manually find specific wines, producers, vintages, prices, and vendors. The Claude web conversation shows what the ideal output looks like: **specific wines with producers, vintages, estimated prices, awards, vendor attribution, and quantity recommendations** — all grouped by style and ready to add to cart.

### Patterns the codebase already uses

1. **Progressive disclosure** — Gap cards show summary, expand into detail on action (Gestalt, Hick's Law)
2. **Style-by-style rendering** — Gap cards already iterate per style bucket
3. **Settings as key/value** — New preferences just need `updateSetting(key, value)` calls
4. **Cart item schema** — Already supports `vendor_url`, `price`, `currency`, `source`, `source_gap_style`
5. **Claude web search** — Two-phase pipeline (search → extract) with country-specific source injection
6. **Streaming UX** — Restaurant pairing and cellar analysis use progressive rendering

### What we can reuse vs. what is new

| Reuse | New |
|---|---|
| Gap analysis engine (deficits, targets, food signals) | Restock search service (builds vendor-aware prompts) |
| Cart item creation pipeline + state machine | Restock advisor API endpoint |
| `unifiedWineSearch` pattern (two-phase architecture) | Restock-specific Claude prompt with vendor targeting |
| Settings key/value store | Vendor preferences settings section |
| Style colour classes, gap card CSS patterns | Restock panel UI (progressive style-by-style results) |
| `aiModels.js` task registry | New `restockAdvisor` task type |
| Cart `source` field (`'ai_restock'`) | Result cards with "Add to Cart" action |

---

## 2. Proposed Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend                                                    │
│                                                             │
│  ┌─────────────────┐    ┌────────────────────────────────┐  │
│  │ settings.js      │    │ buyingGuide.js                 │  │
│  │ + vendor prefs   │    │ (existing gap cards)           │  │
│  │   section        │    │ + "🔍 Find Wines" button       │  │
│  └─────────────────┘    │   per gap card                  │  │
│                          └──────────┬─────────────────────┘  │
│                                     │ click                  │
│                          ┌──────────▼─────────────────────┐  │
│                          │ restockAdvisor.js (NEW)         │  │
│                          │ - Progressive style-by-style UI │  │
│                          │ - Recommendation cards          │  │
│                          │ - "Add to Cart" per wine        │  │
│                          │ - Vendor summary table          │  │
│                          └──────────┬─────────────────────┘  │
│                                     │ api calls              │
│                          ┌──────────▼─────────────────────┐  │
│                          │ api/restockAdvisor.js (NEW)     │  │
│                          │ - searchRestockForStyle()       │  │
│                          │ - getVendorPreferences()        │  │
│                          └──────────┬─────────────────────┘  │
│                                     │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      │ HTTP
┌─────────────────────────────────────┼────────────────────────┐
│ Backend                             │                        │
│                          ┌──────────▼─────────────────────┐  │
│                          │ routes/restockAdvisor.js (NEW)  │  │
│                          │ POST /api/restock-advisor/search │  │
│                          │ GET  /api/restock-advisor/prefs │  │
│                          └──────────┬─────────────────────┘  │
│                                     │                        │
│                          ┌──────────▼─────────────────────┐  │
│                          │ services/recipe/                │  │
│                          │   restockSearch.js (NEW)        │  │
│                          │ - searchStyleRestock()          │  │
│                          │ - buildRestockPrompt()          │  │
│                          │ - extractRecommendations()      │  │
│                          └──────────┬─────────────────────┘  │
│                                     │                        │
│              ┌──────────────────────┼───────────────┐        │
│              │                      │               │        │
│  ┌───────────▼──────┐  ┌───────────▼──┐  ┌─────────▼─────┐  │
│  │ claudeClient.js  │  │ aiModels.js  │  │ styleIds.js   │  │
│  │ (shared)         │  │ +restockAdv  │  │ (suggestions) │  │
│  └──────────────────┘  └──────────────┘  └───────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ user_settings (existing table)                       │    │
│  │ + restock_vendor_names (JSON array)                  │    │
│  │ + restock_vendor_urls (JSON array)                   │    │
│  │ + restock_budget_per_bottle (number)                 │    │
│  │ + restock_currency (string)                          │    │
│  │ + restock_min_qty (number)                           │    │
│  │ + restock_max_qty (number)                           │    │
│  │ + restock_allow_other_vendors (boolean)              │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

**User journey — one style at a time (Progressive Disclosure, Hick's Law)**:

```
1. User sees gap card: "Dry Rosé +23 bottles"
   └─ Existing gap card with "Try: Provence Rosé, Tavel..." suggestions
   └─ NEW: "🔍 Find Wines" button alongside existing "+ Add to Plan"

2. User clicks "🔍 Find Wines" on Dry Rosé gap card
   └─ Restock panel opens BELOW the gap card (in-context, not modal)
   └─ Shows: "Searching for Dry Rosé recommendations..." with spinner
   └─ Sends: POST /api/restock-advisor/search
       body: { styleId: 'rose_dry', deficit: 23, budget: 15, currency: 'EUR',
               vendors: [{name:'Vivino', url:'vivino.com'}, ...],
               allowOtherVendors: true,
               minQty: 2, maxQty: 6,
               foodSignals: ['pork','chicken','spicy'],
               suggestions: ['Provence Rosé','Côtes de Provence','Tavel','Grenache Rosé'] }

3. Backend: restockSearch.js
   └─ Builds a single Claude Sonnet search prompt per style
   └─ Uses web_search tool to find specific wines at the price point
   └─ Extracts structured JSON: array of wine recommendations
   └─ Each recommendation: { wine_name, producer, vintage, est_price, currency,
       vendor, vendor_url, qty, awards, food_pairing, notes, confidence }

4. Results stream back / return to frontend
   └─ Renders recommendation cards grouped by vendor
   └─ Each card has "🛒 Add to Cart" button
   └─ Summary row shows: "8 wines, ~€270, across 3 vendors"

5. User clicks "🛒 Add to Cart" on a specific wine
   └─ Creates cart item via existing POST /api/buying-guide-items
   └─ Pre-fills: wine_name, producer, qty, price, currency, vendor_url,
       style_id: 'rose_dry', source: 'ai_restock', source_gap_style: 'rose_dry'
   └─ Cart panel updates reactively (existing subscribe pattern)

6. User can click "🔍 Find Wines" on next gap card (Medium Red, etc.)
   └─ Each style is independent — no overwhelming all-at-once load
```

### Key Design Decisions

| Decision | Principle(s) | Rationale |
|---|---|---|
| **One style at a time** (not all gaps simultaneously) | Hick's Law (#15), Progressive Disclosure (#13) | The Claude conversation produced 82 wines across 7 categories — overwhelming as a single dump. Style-by-style lets user focus, decide, then move on. Each search is ~15-30s so doing all 7 sequentially would be 2-3 min wait. |
| **Inline panel below gap card** (not modal) | Figure-Ground (#5), Common Region (#6), Context Preservation | User can see the gap info (deficit, food signals) while reviewing recommendations. Modals break context. |
| **Settings for vendor preferences** (not hardcoded) | No Hardcoding (#8), Single Source of Truth (#10) | Different users have different local vendors. User's preference (Vivino, Grandcruwijnen, UpperWine) is personal. Settings are cellar-scoped — different cellars could have different vendors. |
| **Reuse existing cart pipeline** for "Add to Cart" | DRY (#1), Single Responsibility (#2) | Cart already has the exact schema needed (wine_name, price, vendor_url, source). No new tables, no parallel data model. |
| **New service file** `restockSearch.js` (not extending `claudeWineSearch.js`) | Single Responsibility (#2), Open/Closed (#3) | `claudeWineSearch.js` is for rating lookups of specific wines. Restock search has fundamentally different prompt (find wines to buy, specific budget, vendor targeting). Sharing a file would create a god module. |
| **`source: 'ai_restock'`** on cart items | Observability (#19) | Allows tracking which cart items came from AI restock vs manual adds. |
| **Allow "other vendors"** setting | Flexibility (#20), User Control (Nielsen #3) | User sets preferred vendors but can opt-in to AI suggesting alternatives. Defaults to `true`. |
| **Single Claude call per style** (not per vendor) | Performance (#17), N+1 Prevention | One well-crafted prompt with all vendor preferences yields 5-8 recommendations. Separate vendor calls would be slower and more expensive. |
| **No caching of restock results** | Freshness | Wine availability/pricing changes frequently. Results are action-oriented (add to cart), not reference data. User re-runs intentionally. |
| **Sonnet 4.6 with low thinking** for search task | Cost/quality balance | Sonnet handles web search well. Low thinking is sufficient for structured recommendation extraction. Opus would be overkill. |

---

## 3. Sustainability Notes

### Assumptions that could change

| Assumption | Impact if changed | Mitigation |
|---|---|---|
| Claude web search can find accurate vendor prices | Prices are estimates, not live | UI labels as "Est. €12.00", notes field captures caveats |
| 3 vendors is typical | Prompt handles 1-10 vendors equally | Vendor list is dynamic from settings, prompt loops over them |
| EUR is the main currency | User in SA or US has different currency | `restock_currency` setting; cart already supports `currency` field |
| Style buckets are stable (11 types) | New styles would need new suggestions | Style data is data-driven via `STYLE_IDS`/`STYLE_LABELS` — adding a style automatically enables restock for it |
| Web search finds relevant results | Some styles/regions may have poor coverage | Graceful degradation: if search returns <2 results, show message "Limited results — try adjusting budget or vendors" |

### How the design accommodates future change

1. **Vendor system is data-driven** — stored in settings, not code. Adding a new vendor is a UI action.
2. **Prompt is parameterised** — style, budget, vendors, qty constraints, food signals all injected. No hardcoded wine knowledge in the prompt template.
3. **Results schema is extensible** — JSON extraction can add fields (e.g. `sustainability_rating`, `delivery_estimate`) without breaking existing rendering.
4. **Cart integration is via existing API** — if cart evolves (e.g. add `expected_delivery_date`), restock just passes the new field.
5. **"Find Wines" button can later become "Auto-fill all gaps"** — the per-style architecture allows sequential orchestration without redesign.

### Extension points

- **"Fill All Gaps" button** on the buying guide header — iterates gaps, calls search for each style sequentially, animates results appearing one section at a time
- **Vendor price comparison** — if a wine appears on multiple vendors, show price comparison
- **Follow-up research** — after adding to cart, the existing 🔍 research button enriches with ratings/drinking windows
- **Budget optimizer** — "I have €500 total, allocate across all gaps" — wrapper that distributes budget proportionally to deficit

---

## 4. File-Level Plan

### New Files

#### 4.1 `src/services/recipe/restockSearch.js` — Restock search service

**Purpose**: Builds Claude prompts for vendor-aware wine recommendations per style, calls web search, extracts structured results.

**Key functions**:
- `searchStyleRestock(params)` — Main entry. Accepts `{ styleId, styleLabel, deficit, budget, currency, vendors, allowOtherVendors, minQty, maxQty, foodSignals, suggestions }`. Returns `{ recommendations: [...], searchDuration, sourceCount }`.
- `buildRestockPrompt(params)` — Constructs the system + user prompt for Claude. Includes vendor names/URLs, budget constraint, quantity rules, food signal context, and style suggestions.
- `extractRecommendations(response)` — Parses Claude response into structured `Recommendation[]` objects. Uses `extractJsonWithRepair()` from `shared/jsonUtils.js`.

**Dependencies**: `ai/claudeClient.js` (shared client), `config/aiModels.js` (task model), `shared/jsonUtils.js` (JSON parsing)

**Why this file** (SRP #2): Restock search is a distinct concern from rating search (`claudeWineSearch.js`) and buying guide gap analysis (`buyingGuide.js`). Different prompt, different output schema, different consumer.

**Recommendation schema**:
```javascript
{
  wine_name: string,       // "Château Cavalier Cuvée Marafiance, Côtes de Provence 2024"
  producer: string|null,   // "Château Cavalier"
  vintage: number|null,    // 2024
  est_price: number,       // 12.00
  currency: string,        // "EUR"
  vendor: string,          // "Vivino"
  vendor_url: string|null, // "https://www.vivino.com/..."
  qty: number,             // 6
  awards: string|null,     // "DWWA 2025 Best in Show 97pts"
  food_pairing: string[],  // ["pork", "chicken", "spicy"]
  notes: string|null,      // "Vivino NL top 25 under €15"
  colour: string|null,     // "Rosé"
  grapes: string|null,     // "Grenache, Cinsault, Syrah"
  region: string|null,     // "Côtes de Provence"
  country: string|null     // "France"
}
```

#### 4.2 `src/routes/restockAdvisor.js` — API routes

**Purpose**: Express router for restock advisor endpoints.

**Endpoints**:
| Method | Path | Description |
|---|---|---|
| `POST` | `/search` | Search for wine recommendations for one style. Body: `{ styleId, deficit, budget, currency, vendors, allowOtherVendors, minQty, maxQty, foodSignals, suggestions }`. Returns `{ data: { recommendations, summary } }` |
| `GET` | `/preferences` | Get restock preferences from user_settings. Returns `{ data: { vendors, budget, currency, minQty, maxQty, allowOtherVendors } }` |
| `PUT` | `/preferences` | Save restock preferences. Body: vendor + budget settings. Upserts multiple settings keys. |

**Middleware**: `requireAuth`, `requireCellarContext` (all routes modify/read cellar-scoped settings)

**Dependencies**: `services/recipe/restockSearch.js`, `db/index.js` (for settings read/write)

**Why this file** (SRP #2): Restock is a distinct domain from recipes (`routes/recipes.js`) and cart items (`routes/buyingGuideItems.js`). Separate router keeps routes focused.

#### 4.3 `public/js/restockAdvisor.js` — Frontend restock panel UI

**Purpose**: Renders the restock recommendation panel below gap cards, handles user interactions.

**Key functions**:
- `openRestockForGap(gapCard, gap)` — Creates/toggles the restock panel below a gap card. Fetches vendor prefs from settings, then calls search API.
- `renderRestockPanel(container, gap)` — Renders loading → results → error states.
- `renderRecommendationCards(recommendations, gap)` — Builds HTML for wine recommendation cards grouped by vendor.
- `renderVendorSummary(recommendations)` — Summary table: vendor, bottles, estimated spend.
- `handleAddToCart(recommendation, gap)` — Creates cart item via `createCartItem()` with all fields pre-filled. Shows toast. Disables button to prevent double-add.
- `handleAddAllToCart(recommendations, gap)` — Batch-adds all recommendations for the style.

**Dependencies**: `api/restockAdvisor.js` (API calls), `api/buyingGuideItems.js` (`createCartItem`), `recipes/cartState.js` (`refreshSummary`), `utils.js` (`escapeHtml`, `showToast`)

**Why this file** (SRP #2): Keeps restock UI separate from existing `buyingGuide.js` (gap rendering) and `cartPanel.js` (cart management). Each module has one job.

#### 4.4 `public/js/api/restockAdvisor.js` — Frontend API module

**Purpose**: Authenticated API calls for restock advisor endpoints.

**Key functions**:
- `searchRestockForStyle(params)` — `POST /api/restock-advisor/search`
- `getRestockPreferences()` — `GET /api/restock-advisor/preferences`
- `saveRestockPreferences(prefs)` — `PUT /api/restock-advisor/preferences`

**Dependencies**: `api/base.js` (`apiFetch`)

**Why this file** (SRP #2): Follows the existing pattern where each domain has its own API module (wines.js, ratings.js, buyingGuideItems.js, etc.).

### Modified Files

#### 4.5 `public/js/recipes/buyingGuide.js` — Add "Find Wines" button to gap cards

**Changes**:
- Import `openRestockForGap` from `restockAdvisor.js`
- Add `<button class="gap-restock-btn">🔍 Find Wines</button>` next to existing `gap-add-btn`
- Wire click handler in `wireGapAddButtons()` (rename to `wireGapButtons()`)
- Each gap card gets a `data-style` and `data-deficit` attribute for the restock action

**Principle**: Open/Closed (#3) — extending gap cards without modifying their rendering logic.

#### 4.6 `public/index.html` — Add "Restock Preferences" settings section

**Changes**: Add a new `<div class="settings-section">` block for vendor preferences:
- Vendor list (dynamic rows: name + URL, add/remove buttons)
- Budget per bottle (number input + currency select)
- Min/max quantity per wine (number inputs)
- "Allow AI to suggest other vendors" checkbox

**Principle**: Consistency (#10) — follows exact same `settings-section` / `settings-section-toggle` / `settings-section-body` pattern as all other settings sections.

#### 4.7 `public/js/settings.js` — Initialize restock preferences section

**Changes**:
- Add `initRestockPreferences()` function
- Call it from `initSettings()`
- Wire event listeners for vendor list add/remove, budget, qty, checkbox
- Load existing values from `getSettings()` on page load
- Save on change via `updateSetting(key, value)`

#### 4.8 `src/config/aiModels.js` — Add `restockAdvisor` task

**Changes**: Add entry to `TASK_MODELS` and `TASK_THINKING`:
```javascript
restockAdvisor: 'claude-sonnet-4-6',  // in TASK_MODELS
restockAdvisor: 'low',                 // in TASK_THINKING
```

#### 4.9 `src/routes/index.js` — Mount restock advisor router

**Changes**: Add route registration:
```javascript
import restockAdvisorRouter from './restockAdvisor.js';
router.use('/api/restock-advisor', requireAuth, requireCellarContext, restockAdvisorRouter);
```

#### 4.10 `public/sw.js` — Add new JS files to STATIC_ASSETS

**Changes**: Add `js/restockAdvisor.js` and `js/api/restockAdvisor.js` to the `STATIC_ASSETS` array. Bump `CACHE_VERSION`.

#### 4.11 `public/css/components.css` — Restock panel styles

**Changes**: Add CSS for:
- `.restock-panel` — container below gap card, same border/radius as `.cart-quick-add`
- `.restock-loading` — spinner state
- `.restock-cards` — grid of recommendation cards
- `.restock-card` — individual wine recommendation (similar to `.gap-card` pattern)
- `.restock-card-awards` — awards badge/text
- `.restock-vendor-summary` — summary table
- `.restock-add-btn` — "Add to Cart" button (reuses `.gap-add-btn` sizing)
- `.restock-add-all-btn` — "Add All to Cart" button
- `.gap-restock-btn` — "Find Wines" button on gap cards

---

## 5. User Flow & Wireframes

### Flow 1: First-time setup (vendor preferences)

```
Settings page → "Restock Preferences" section (collapsed by default)
User expands → sees:

┌─────────────────────────────────────────────────────────┐
│ 🛒 Restock Preferences                           ▾     │
├─────────────────────────────────────────────────────────┤
│ Configure preferred vendors and budget for AI wine      │
│ recommendations.                                        │
│                                                         │
│ Preferred Vendors                                       │
│ ┌────────────────────┬──────────────────────┬───┐       │
│ │ Vivino             │ vivino.com           │ ✕ │       │
│ │ Grandcruwijnen     │ grandcruwijnen.nl    │ ✕ │       │
│ │ UpperWine          │ upperwine.com        │ ✕ │       │
│ └────────────────────┴──────────────────────┴───┘       │
│ [+ Add vendor]                                          │
│                                                         │
│ ☑ Also suggest wines from other vendors                 │
│                                                         │
│ Budget     [15] EUR ▾  per bottle                       │
│ Quantity   [2] min  [6] max per wine                    │
└─────────────────────────────────────────────────────────┘
```

**State map**:
- **Empty**: No vendors configured → shows hint "Add at least one vendor to get started"
- **Populated**: Vendor rows rendered, values loaded from settings
- **Saving**: Brief "Saved ✓" toast on each change (debounced)

### Flow 2: Finding wines for a gap (main flow)

```
Buying Guide → Gap card for Dry Rosé:

┌─────────────────────────────────────────────────────────┐
│ Dry Rosé                                    +23 bottles │
│ 1 of 24 needed (14% demand)                            │
│ Because you cook: pork  chicken  spicy                  │
│ Try: Provence Rosé, Côtes de Provence, Tavel            │
│ [+ Add to Plan] [🔍 Find Wines]                         │
└─────────────────────────────────────────────────────────┘

User clicks "🔍 Find Wines" →

┌─────────────────────────────────────────────────────────┐
│ Dry Rosé                                    +23 bottles │
│ ... (gap card content) ...                              │
│ [+ Add to Plan] [🔍 Find Wines ▾]                       │
├─────────────────────────────────────────────────────────┤
│ 🔍 Searching for Dry Rosé wines...                      │
│ [━━━━━━━━━━━━━━━                   ] ~30 seconds        │
│ Checking Vivino, Grandcruwijnen, UpperWine              │
└─────────────────────────────────────────────────────────┘

Results arrive →

┌─────────────────────────────────────────────────────────┐
│ Dry Rosé                                    +23 bottles │
│ ... (gap card content) ...                              │
│ [+ Add to Plan] [🔍 Hide Results ▴]                     │
├─────────────────────────────────────────────────────────┤
│ Found 5 wines · ~€270 · 23 bottles  [🛒 Add All]       │
│                                                         │
│ ┌─── Vivino ──────────────────────────────────────────┐ │
│ │ 🍷 Château Cavalier Marafiance 2024          ×6     │ │
│ │    Côtes de Provence · Est. €12.00                  │ │
│ │    🏆 DWWA 2025 Best in Show 97pts                  │ │
│ │    Pairs: pork, chicken, spicy                      │ │
│ │                                     [🛒 Add to Cart]│ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🍷 Domaine Houchart Côtes de Provence 2023/24 ×6   │ │
│ │    Côtes de Provence · Est. €10.00                  │ │
│ │    🏆 DWWA Silver multiple vintages                  │ │
│ │                                     [🛒 Add to Cart]│ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🍷 Château la Mascaronne Rosé 2024            ×4   │ │
│ │    Côtes de Provence · Est. €14.00                  │ │
│ │                                     [🛒 Add to Cart]│ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─── Grandcruwijnen ──────────────────────────────────┐ │
│ │ 🍷 Grenache Rosé, Pays d'Oc                  ×4    │ │
│ │    Southern France · Est. €10.00                    │ │
│ │    🏆 Multiple DWWA Gold/Silver                      │ │
│ │                                     [🛒 Add to Cart]│ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─── UpperWine ───────────────────────────────────────┐ │
│ │ 🍷 Tavel Rosé (Mordorée)                     ×3    │ │
│ │    Tavel AOC · Est. €14.00                          │ │
│ │    🏆 Decanter 90+ pts                               │ │
│ │                                     [🛒 Add to Cart]│ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Vendor Summary                                          │
│ ┌──────────────┬──────┬──────────┐                      │
│ │ Vendor       │ Btls │ Est.     │                      │
│ │ Vivino       │  16  │ ~€188    │                      │
│ │ Grandcruwijnen│  4  │ ~€40     │                      │
│ │ UpperWine    │  3   │ ~€42     │                      │
│ │ TOTAL        │ 23   │ ~€270    │                      │
│ └──────────────┴──────┴──────────┘                      │
└─────────────────────────────────────────────────────────┘
```

### Flow 3: Adding to cart

```
User clicks "🛒 Add to Cart" on Château Cavalier →
  Button changes to "✓ Added" (disabled, green)
  Toast: "Château Cavalier Marafiance added to cart (6 bottles)"
  Cart panel below updates with new item count
  Gap card's projected deficit recalculates

User clicks "🛒 Add All" →
  All recommendation buttons change to "✓ Added"
  Toast: "5 wines (23 bottles) added to cart"
  Cart updates
```

### State Map — Restock Panel

| State | What user sees |
|---|---|
| **Collapsed** | Gap card only, "🔍 Find Wines" button |
| **Loading** | Panel expands below card with spinner + vendor list being checked |
| **Success** | Recommendation cards grouped by vendor, summary table, Add to Cart buttons |
| **Partial** | Some results found but fewer than deficit (e.g. "Found 15 of 23 needed") |
| **Empty** | "No wines found at this price point. Try adjusting budget in settings." |
| **Error** | "Search failed: {message}. Try again." with retry button |
| **No vendors** | "Set up your preferred vendors in Settings → Restock Preferences first." with link |
| **Added** | Individual "✓ Added" badges per wine, or all disabled after "Add All" |

### UX Principles Applied

| Principle | Application |
|---|---|
| **Progressive Disclosure (#13)** | One style at a time. Results hidden until requested. Vendor summary at the bottom (detail after overview). |
| **Hick's Law (#15)** | Max 5-8 recommendations per style. Grouped by vendor reduces visual choice paralysis. |
| **Proximity (#1)** | Results panel directly below its gap card — spatial relationship is clear. |
| **Common Region (#6)** | Vendor groups enclosed in bordered sections. Summary table enclosed in its own container. |
| **Feedback & System Status (#11)** | Loading spinner with estimated time. "Checking Vivino, Grandcruwijnen..." shows what's happening. "✓ Added" confirms the action. |
| **Error Prevention (#12)** | Button disables after add (no double-add). "Add All" requires zero confirmation because it's easily undoable (delete from cart). |
| **Recognition Over Recall (#14)** | Awards shown inline. Food pairing chips match the gap card's "Because you cook" signals. |
| **Visual Hierarchy (#17)** | Wine name is bold, price is prominent, awards get icon treatment (🏆), vendor name is section header. |
| **Consistency (#10)** | Cards reuse `.gap-card` border/radius/padding pattern. Buttons match `.gap-add-btn` style. Colour badges match existing `STYLE_COLOURS`. |
| **Fitts's Law (#16)** | "Add to Cart" buttons are right-aligned and full-width within cards on mobile. "Add All" is large and top-right. |
| **Whitespace (#18)** | 0.5rem gap between cards (matches existing gap-cards grid). Vendor groups separated by expanded margin. |

---

## 6. Technical Architecture Details

### Claude Prompt Design (Backend)

The prompt for `restockSearch.js` must produce structured JSON. Key prompt elements:

```
System: You are a wine purchasing advisor. Search the web for specific wines
available from the given vendors at the given price point. Return ONLY a JSON
array of recommendations.

User: I need to restock {deficit} bottles of {styleLabel} wine.

Budget: ~{budget} {currency} per bottle
Vendors (preferred): {vendors[].name} ({vendors[].url})
{allowOtherVendors ? "You may also suggest wines from other reputable vendors." : "Only suggest wines from the listed vendors."}
Quantity per wine: minimum {minQty}, maximum {maxQty}
My cooking drives demand for: {foodSignals.join(', ')}
Wine styles to consider: {suggestions.join(', ')}

Search each vendor for well-rated wines in this style. Prioritise:
1. Wines with competition awards (Decanter, IWC, Mundus Vini, etc.)
2. High Vivino/community ratings (3.8+)
3. Good value at the price point
4. Variety of sub-styles within the category

Return a JSON array of objects with these fields:
{ wine_name, producer, vintage, est_price, currency, vendor, vendor_url,
  qty, awards, food_pairing (array), notes, colour, grapes, region, country }

The total quantity across all recommendations should equal approximately {deficit}.
```

This uses Claude's `web_search_20250305` tool (same as `claudeWineSearch.js`) to search vendor sites, wine databases, and competition results.

### State Management (Frontend)

The restock panel does **not** need global state — it's ephemeral per gap card interaction:

- **Panel state** lives in DOM data attributes and closure variables
- **Results** are rendered once and not re-fetched on cart state changes
- **"Added" state** is tracked per-button via `disabled` attribute + CSS class
- **Cart integration** uses existing `cartState.refreshSummary()` after adds (triggers buying guide coverage bar re-render)

This follows **State Locality (#32)** — state is owned by the narrowest scope.

### Event Handling

- **Event delegation (#36)** on `.restock-panel` container for all "Add to Cart" clicks
- **CSP compliance (#37)** — zero inline handlers, all wired in JS
- **Debounce** on settings vendor name/URL inputs (350ms) to avoid excessive saves

### CSS Architecture

New classes follow existing naming convention (kebab-case, `.restock-*` prefix):
- Reuse CSS variables: `--bg-slot`, `--border`, `--accent`, `--text-muted`, `--text`
- Reuse existing patterns: `.gap-card` border/radius, `.gap-style-badge` colour classes
- Responsive: same `minmax(240px, 1fr)` grid as `.gap-cards` on mobile

---

## 7. Risk & Trade-off Register

| Risk | Severity | Mitigation |
|---|---|---|
| **Claude web search returns inaccurate prices** | Medium | Label as "Est." everywhere. Notes field captures caveats. User verifies on vendor site before ordering. |
| **Vendor sites may not be indexed by Claude's search** | Medium | Include vendor name in search prompt. `allowOtherVendors: true` default ensures fallback. Show generic "wine merchant" suggestions if vendor-specific results are sparse. |
| **Search takes 30-60 seconds** | Low | Loading state with progress text. Style-by-style means user isn't blocked waiting for all gaps. Can browse other gap results while one loads. |
| **API cost per search** | Low | One Claude Sonnet call per style (~$0.01-0.03). 7 gaps = ~$0.10-0.20. No auto-refresh or background polling. |
| **Duplicate wines across styles** | Low | Each style search is independent — a wine shouldn't appear in both "Light Red" and "Medium Red" because the prompt constrains to the specific style. |
| **Cart items from restock have estimated prices** | Low | Cart `price` field is already optional/advisory. Not used for billing. |
| **Settings migration needed for vendor data** | None | `user_settings` is key/value — no schema changes. Vendor list stored as JSON string in value column. |

### Trade-offs

| Choice | Alternative considered | Why this choice |
|---|---|---|
| **One search per style** | Batch all gaps in one mega-prompt | Single prompt would exceed context limits for 7 gaps × 3 vendors. Style-by-style gives better results and progressive UX. |
| **Inline panel (not modal)** | Full-page or modal overlay | Inline preserves gap card context. User can still see deficit and signals. Modal would break flow. |
| **No result caching** | Cache for 24h | Wine availability changes. Caching stale data leads to user frustration ("that wine isn't available"). Small API cost doesn't justify caching complexity. |
| **Sonnet (not Opus)** | Opus for better reasoning | Cost per search would 5x. Sonnet's web search capability is the same tool. Recommendation quality is adequate — it's surfacing wines, not doing complex analysis. |

### Deliberately deferred

| Feature | Why deferred |
|---|---|
| **"Fill all gaps" automation** | Can be built as a sequential wrapper over per-style search. Not MVP. |
| **Live price fetching** | Would need web scraping (Puppeteer/BrightData). Claude web search provides estimates. Live pricing is a Phase 2 enhancement. |
| **Vendor account integration** | Vivino API, direct ordering — significant scope. Current approach is advisory. |
| **Budget optimizer** ("€500 across all gaps") | Requires constraint-solving across styles. Per-style budget is simpler and sufficient. |
| **Result persistence** | Storing past restock searches for comparison. Cart items already persist the decision. |

---

## 8. Testing Strategy

### Unit Tests

| Test file | Covers |
|---|---|
| `tests/unit/services/recipe/restockSearch.test.js` | Prompt building, JSON extraction, recommendation schema validation, error handling |
| `tests/unit/routes/restockAdvisor.test.js` | Route validation (Zod schemas), auth middleware checks, settings CRUD |
| `tests/unit/utils/swStaticAssets.test.js` | (Existing) — Will auto-catch missing STATIC_ASSETS entries |

### Key edge cases

- **No vendors configured** → Returns 400 with helpful message
- **Budget = 0 or negative** → Validation rejects
- **Deficit = 0** → Should not be reachable (gap cards only show for deficit > 0)
- **Claude returns malformed JSON** → `extractJsonWithRepair()` handles; fallback to error state
- **Claude returns 0 recommendations** → Empty state with suggestions to adjust parameters
- **Claude returns wines over budget** → Filter/flag in extraction, include in results with "over budget" note
- **Vendor URL validation** → Zod schema validates URL format in preferences
- **XSS in wine names** → All rendering uses `escapeHtml()` (existing pattern)
- **Cellar scoping** → All settings queries include `cellar_id = req.cellarId`

### Integration tests

- **Settings round-trip** — Save vendor prefs → read back → verify structure
- **Search → cart flow** — Execute search → add item to cart → verify cart item has correct `source: 'ai_restock'` and `source_gap_style`

### Manual testing checklist

- [ ] Settings: Add/remove vendors, verify save persistence across page reload
- [ ] Gap card: "Find Wines" button appears only when ANTHROPIC_API_KEY is configured
- [ ] Loading: Spinner shows, vendor names listed during search
- [ ] Results: Cards render with correct grouping, awards, prices
- [ ] Add to Cart: Button disables, toast shows, cart updates
- [ ] Add All: All buttons disable, total bottles match deficit
- [ ] Empty results: Helpful message when no wines found
- [ ] Error: Retry button works after transient failure
- [ ] No vendors: Shows settings link prompt
- [ ] Mobile: Cards stack single-column, buttons remain tappable (44px touch target)
- [ ] Keyboard: Tab through results, Enter to add to cart
- [ ] Multiple styles: Can have two restock panels open simultaneously

---

## 9. Implementation Sequence

Suggested build order (each step is independently testable):

1. **Settings** — `user_settings` keys, `index.html` section, `settings.js` init, preferences API routes
2. **Backend service** — `restockSearch.js` + `aiModels.js` task entry
3. **Backend routes** — `restockAdvisor.js` + mount in `routes/index.js`
4. **Frontend API** — `api/restockAdvisor.js`
5. **Frontend UI** — `restockAdvisor.js` panel + CSS
6. **Gap card integration** — Modify `buyingGuide.js` to add "Find Wines" button
7. **Service worker** — Add to `STATIC_ASSETS`, bump cache version
8. **Tests** — Unit + integration tests
