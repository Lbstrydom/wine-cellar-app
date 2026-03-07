# Plan: Smart Restock Advisor

- **Date**: 2026-03-07
- **Status**: Draft
- **Author**: Claude + User
- **Supersedes**: Previous draft (2026-03-06)

---

## 1. Context Summary

### What exists today

The buying guide already has a mature pipeline from **gap analysis → shopping cart → cellar conversion**:

| Component | File(s) | Status |
|---|---|---|
| Gap analysis (style deficits, food signals, targets, projectedDeficit) | `src/services/recipe/buyingGuide.js` | Production |
| Static suggestions per style (grape/appellation names) | `src/config/styleIds.js` → `SHOPPING_SUGGESTIONS` | Production |
| Shopping cart with full schema (wine_name, producer, price, vendor_url, qty, source) | `src/routes/buyingGuideItems.js`, `src/services/recipe/buyingGuideCart.js` | Production |
| Cart UI with status state machine (planned→ordered→arrived→cellar) | `public/js/recipes/cartPanel.js`, `cartState.js` | Production |
| Cart reactive state (pub/sub, `addItem()`, `subscribe()`, `notify()`) | `public/js/recipes/cartState.js` | Production |
| Wine research modal (enriches cart items via Claude web search) | `public/js/recipes/wineResearch.js` | Production |
| Two-phase Claude web search (Sonnet search → Haiku extraction) | `src/services/search/claudeWineSearch.js`, `wineDataExtractor.js` | Production |
| Settings key/value store (cellar-scoped, no schema changes needed) | `src/routes/settings.js`, `user_settings` table | Production |
| AI model registry with task→model mapping | `src/config/aiModels.js` | Production |
| Zod validation middleware (`validateBody`, `validateQuery`, `validateParams`) | `src/middleware/validate.js`, `src/schemas/*.js` | Production |
| Acquisition workflow (search→enrich→place) | `src/services/acquisitionWorkflow.js` | Production |

### The gap

Gap cards show **generic grape/appellation names** (e.g. "Try: Provence Rosé, Côtes de Provence, Tavel"). The user must manually find specific wines, producers, vintages, prices, and vendors. The Claude web conversation shows what the ideal output looks like: **specific wines with producers, vintages, estimated prices, awards, vendor attribution, and quantity recommendations** — all grouped by style and ready to add to cart.

### Patterns the codebase already uses

1. **Two-phase search** — `claudeWineSearch.js` uses Phase 1 (Sonnet + `web_search_20250305` → prose narrative) then Phase 2 (Haiku → structured JSON). This split prevents `code_execution` loops that occurred when JSON schemas were embedded in search prompts. **The restock service must follow this same two-phase pattern.**
2. **Progressive disclosure** — Gap cards show summary, expand into detail on action (Gestalt Proximity, Hick's Law).
3. **Style-by-style rendering** — Gap cards already iterate per style bucket.
4. **Settings as key/value** — Preferences stored via `updateSetting(key, value)` with cellar scoping.
5. **Cart item schema** — Already supports `vendor_url`, `price`, `currency`, `source`, `source_gap_style`.
6. **Reactive cart state** — `cartState.addItem()` does optimistic insert + `notify()` to all subscribers.
7. **Long-running request UX** — `wineResearch.js` shows loading spinner → progress text → stale-guard pattern for 30s–2m fetches.
8. **Server-authoritative gap context** — `buyingGuide.js` computes deficits, projectedDeficits, foodSignals, and suggestions server-side. Clients should not send these as authoritative input.
9. **Zod validation** — All route bodies validated via `validateBody(schema)` middleware.
10. **Route mounting** — `server.js:93` mounts all routes at `/api` prefix; `routes/index.js` uses `router.use('/wines', ...)` — no `/api/` in the router mount.

### What we can reuse vs. what is new

| Reuse | New |
|---|---|
| Gap analysis engine (deficits, targets, food signals, projectedDeficit) | Restock search service (two-phase prompt for vendor-aware recommendations) |
| Two-phase search architecture (search → extract pattern) | Restock-specific search + extraction prompts |
| Cart item creation via `cartState.addItem()` | Restock panel UI under `public/js/recipes/` |
| Settings key/value store | Vendor preference settings section |
| Style colour classes, gap card CSS patterns | Restock result cards + CSS |
| `aiModels.js` task registry | New `restockAdvisor` task type |
| Cart `source` field (`'ai_restock'`) | Backend route + Zod schemas |
| Zod schema patterns from `buyingGuideItem.js` | `src/schemas/restockAdvisor.js` |
| `wineResearch.js` long-running request UX pattern | Adapted for inline panel (not modal) |
| `extractJsonWithRepair()` from `shared/jsonUtils.js` | — |
| `api/index.js` barrel export pattern | New exports added |
| Service worker STATIC_ASSETS pattern | New file paths added |

---

## 2. Proposed Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ Frontend                                                         │
│                                                                  │
│  ┌─────────────────┐    ┌──────────────────────────────────────┐ │
│  │ settings.js      │    │ buyingGuide.js (MODIFIED)            │ │
│  │ + vendor prefs   │    │ + "🔍 Find Wines" button per gap    │ │
│  │   section        │    │ + aiAvailable flag from guide resp   │ │
│  └─────────────────┘    └─────────────┬────────────────────────┘ │
│                                       │ click                    │
│                          ┌────────────▼────────────────────────┐ │
│                          │ recipes/restockPanel.js (NEW)        │ │
│                          │ - Inline panel below gap card        │ │
│                          │ - Loading → results → error states   │ │
│                          │ - Vendor-grouped recommendation cards│ │
│                          │ - "Add to Cart" via cartState.addItem│ │
│                          │ - Buying guide re-render on add      │ │
│                          └────────────┬────────────────────────┘ │
│                                       │                          │
│  ┌────────────────┐      ┌────────────▼────────────────────────┐ │
│  │ recipes/        │      │ api/restockAdvisor.js (NEW)         │ │
│  │ cartState.js    │◄─────│ - searchRestockForStyle(styleId)    │ │
│  │ addItem()       │      │ - getRestockPreferences()           │ │
│  │ subscribe()     │      │ - saveRestockPreferences(prefs)     │ │
│  └────────────────┘      └────────────┬────────────────────────┘ │
│                                       │ HTTP                     │
└───────────────────────────────────────┼──────────────────────────┘
                                        │
┌───────────────────────────────────────┼──────────────────────────┐
│ Backend                               │                          │
│                          ┌────────────▼────────────────────────┐ │
│                          │ routes/restockAdvisor.js (NEW)      │ │
│                          │ POST /search { styleId }            │ │
│                          │ GET  /preferences                   │ │
│                          │ PUT  /preferences                   │ │
│                          └────────────┬────────────────────────┘ │
│                                       │                          │
│                          ┌────────────▼────────────────────────┐ │
│                          │ services/recipe/                    │ │
│                          │   restockSearch.js (NEW)            │ │
│                          │ Phase 1: Sonnet + web_search → prose│ │
│                          │ Phase 2: Haiku → JSON extraction    │ │
│                          └──┬───────┬──────────┬───────────────┘ │
│                             │       │          │                 │
│  ┌──────────────────┐  ┌───▼───┐ ┌─▼────────┐ │                 │
│  │ buyingGuide.js   │  │claude │ │aiModels.js│ │                 │
│  │ generateBuying   │  │Client │ │+restock   │ │                 │
│  │ Guide(cellarId)  │  │(shared│ │Advisor    │ │                 │
│  │ → gap context    │  │)      │ │task       │ │                 │
│  └──────────────────┘  └───────┘ └──────────┘ │                 │
│                                                │                 │
│  ┌─────────────────────────────────────────────▼───────────────┐ │
│  │ user_settings (existing table, no schema change)            │ │
│  │ + restock_vendors: JSON "[{name,url},...]"                  │ │
│  │ + restock_budget_per_bottle: "15"                           │ │
│  │ + restock_currency: "EUR"                                   │ │
│  │ + restock_min_qty: "2"                                      │ │
│  │ + restock_max_qty: "6"                                      │ │
│  │ + restock_allow_other_vendors: "true"                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow — The Concrete Flow

**Client sends `styleId`, server derives everything else.**

```
1. User sees gap card: "Dry Rosé +23 bottles"
   └─ Existing gap card with "Try: Provence Rosé, Tavel..." suggestions
   └─ NEW: "🔍 Find Wines" button (hidden when aiAvailable === false)

2. User clicks "🔍 Find Wines" on Dry Rosé gap card
   └─ Restock panel opens BELOW the gap card (inline, not modal)
   └─ Shows: "Searching for Dry Rosé recommendations..." with spinner
   └─ Sends: POST /api/restock-advisor/search { styleId: 'rose_dry' }
   └─ (That's it — no deficit, no foodSignals, no suggestions from the client)

3. Backend: routes/restockAdvisor.js
   └─ POST /search handler receives { styleId }
   └─ Loads current buying guide via generateBuyingGuide(cellarId)
   └─ Finds the gap for styleId → gets projectedDeficit, drivingSignals, suggestions
   └─ Loads restock preferences from user_settings (vendors, budget, currency, qty)
   └─ Calls restockSearch.searchStyleRestock({ gap, preferences })

4. Backend: services/recipe/restockSearch.js
   └─ Phase 1 (Search): Sonnet + web_search_20250305 (SSE streaming)
       Builds research prompt: style, budget, vendors, food signals, suggestions
       NO JSON schema in prompt (prevents code_execution loops)
       Returns prose narrative + source URLs + citations
   └─ Phase 2 (Extract): Haiku (non-streaming)
       Narrative → structured JSON array of recommendations
       Uses extractJsonWithRepair() for robust parsing
       normalizeRecommendations() guarantees type safety

5. Response returns to frontend:
   { data: {
       recommendations: [...],
       gap: { style, label, projectedDeficit, target, have },
       summary: { totalBottles, estimatedSpend, vendorCount },
       aiModel: 'claude-sonnet-4-6'
   }}

6. Frontend: recipes/restockPanel.js renders recommendation cards
   └─ Cards grouped by vendor
   └─ Each card has "🛒 Add to Cart" button
   └─ Summary row shows: "8 wines, ~€270, across 3 vendors"

7. User clicks "🛒 Add to Cart" on a specific wine
   └─ Calls cartState.addItem({ ...recommendation fields... })
   └─ cartState notifies all subscribers → cart panel updates
   └─ Button changes to "✓ Added" (disabled)

8. User clicks "🛒 Add All"
   └─ Batch-adds via cartState.addItem() for each recommendation
   └─ After all adds complete: calls renderBuyingGuide() to refresh
       gap cards with updated projectedDeficits
   └─ All buttons change to "✓ Added"

9. User can click "🔍 Find Wines" on next gap card (independent)
```

### Key Design Decisions

| Decision | Principle(s) | Rationale |
|---|---|---|
| **Client sends only `styleId`, server derives gap context** | Server-Authoritative (#12 Defensive Validation), Single Source of Truth (#10) | Gap data (projectedDeficit, drivingSignals, suggestions) is computed server-side in `buyingGuide.js`. Sending it from the client creates a TOCTOU risk (stale data) and allows the client to fabricate context. The server re-derives the current gap from the same authoritative source. |
| **Use `projectedDeficit` not raw `deficit`** | Correctness, DRY (#1) | `buyingGuide.js` already computes virtual inventory from active cart items. Using raw `deficit` would overbuy wines that are already planned/ordered. The server uses `gap.projectedDeficit` as the quantity target. |
| **Two-phase search (NOT single-call JSON)** | Robustness (#16 Graceful Degradation), Proven Pattern | `claudeWineSearch.js` discovered that JSON schemas in web_search prompts cause `code_execution` tool loops consuming entire timeouts. The two-phase split (search → extract) is battle-tested. The restock service follows the identical architecture: Phase 1 (Sonnet + SSE streaming, no JSON), Phase 2 (Haiku extraction with prefill). |
| **One style at a time** (not all gaps simultaneously) | Hick's Law (#15), Progressive Disclosure (#13) | 7 gaps × 30s search = 3.5min wait for all. Style-by-style lets user focus, decide, then move on. Each search is independent. |
| **Inline panel below gap card** (not modal) | Figure-Ground (#5), Common Region (#6), Context Preservation | User can see gap info (deficit, food signals) while reviewing recommendations. `wineResearch.js`'s modal pattern works for single-wine enrichment but would break context for gap-scoped results. |
| **Use `cartState.addItem()` for all add-to-cart** | Single Source of Truth (#10), Consistency (#10) | `cartState.addItem()` does optimistic insert, notifies all subscribers, and refreshes summary. Calling `createCartItem()` directly would bypass reactive updates and leave the cart panel stale. |
| **Explicit buying guide re-render after batch adds** | State Synchronisation (#33) | `buyingGuide.js` renders once and does NOT subscribe to cart state today. After adding restock items, the projectedDeficit changes. The restock panel explicitly calls `renderBuyingGuide()` after batch adds complete, so the gap card reflects updated projections. |
| **Expose `aiAvailable` on buying guide response** | Progressive Disclosure (#13), No Dead Code (#9) | The "Find Wines" button should be hidden when `ANTHROPIC_API_KEY` is absent. Rather than a separate config endpoint, the existing `GET /recipes/buying-guide` response gains an `aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY)` field — same pattern as `awards.js`. |
| **Settings as single JSON blob `restock_vendors`** + scalar keys | Robustness (#12), No Hardcoding (#8) | Parallel arrays (`restock_vendor_names[]` + `restock_vendor_urls[]`) are brittle — index misalignment corrupts data. A single `restock_vendors` key holds `[{name, url}]` as a JSON string. Budget/currency/qty are scalar settings keys. |
| **New service file** `restockSearch.js` (not extending `claudeWineSearch.js`) | Single Responsibility (#2), Open/Closed (#3) | `claudeWineSearch.js` is for rating lookups of specific known wines. Restock search has fundamentally different prompts (find wines to buy at a budget/vendor). Sharing a file creates a god module. Both reuse `claudeClient.js` and `extractJsonWithRepair()`. |
| **UI file under `public/js/recipes/`** (not top-level) | Consistency (#10), Modularity (#7) | The buying guide, cart panel, cart state, and wine research all live under `recipes/`. The restock panel is a buying-guide extension — same ownership. |
| **Route mount as `router.use('/restock-advisor', ...)` in `routes/index.js`** | Consistency (#10) | `server.js` mounts all routes at `/api`. The draft's `router.use('/api/restock-advisor', ...)` would produce `/api/api/restock-advisor`. All other routes use bare paths. |
| **Zod schema in `src/schemas/restockAdvisor.js`** | Defensive Validation (#12), Consistency (#10) | All routes in this repo validate via `validateBody(schema)`. New endpoints follow the same pattern. |
| **Reuse long-running request UX from `wineResearch.js`** | DRY (#1), Consistency (#10) | The spinner + progress text + stale-guard pattern is proven for 30s–2m waits. No need for SSE streaming to the browser for MVP — the same async fetch + loading state works. |
| **`source: 'ai_restock'` on cart items** | Observability (#19) | Allows tracking which cart items came from AI restock vs manual adds or wine research. |

---

## 3. Sustainability Notes

### Assumptions that could change

| Assumption | Impact if changed | Mitigation |
|---|---|---|
| Claude web search can find accurate vendor prices | Prices are estimates, not live | UI labels as "Est. €12.00", notes field captures caveats |
| 3 vendors is typical | Prompt handles 1-10 vendors equally | Vendor list is dynamic from settings, prompt loops over them |
| EUR is the main currency | User in SA or US has different currency | `restock_currency` setting; cart already supports `currency` field |
| Style buckets are stable (11 types) | New styles would need new suggestions | Style data is data-driven via `STYLE_IDS`/`STYLE_LABELS` from `styleIds.js` — adding a style automatically enables restock for it |
| Web search finds relevant results | Some styles/regions may have poor coverage | Graceful degradation: if extraction returns <2 results, show message with adjustment hints |
| `projectedDeficit` accurately reflects cart state | Cart deletions between guide load and search could cause mismatch | Server re-derives at search time from fresh `generateBuyingGuide()` call |

### How the design accommodates future change

1. **Vendor system is data-driven** — stored in settings, not code. Adding a new vendor is a UI action.
2. **Prompt is parameterised** — style, budget, vendors, qty constraints, food signals all injected. No hardcoded wine knowledge in the prompt template.
3. **Results schema is extensible** — JSON extraction can add fields (e.g. `sustainability_rating`, `delivery_estimate`) without breaking existing rendering.
4. **Cart integration is via existing state machine** — if cart evolves (e.g. `expected_delivery_date`), restock just passes the new field through `addItem()`.
5. **Two-phase architecture allows swapping models** — Phase 1 model (Sonnet) and Phase 2 model (Haiku) are independently configurable via `aiModels.js`.
6. **"Find Wines" button can later become "Auto-fill all gaps"** — the per-style architecture allows sequential orchestration without redesign.

### Extension points

- **"Fill All Gaps" button** on the buying guide header — iterates gaps, calls search for each style sequentially, animates results appearing one section at a time.
- **Vendor price comparison** — if a wine appears on multiple vendors, show price comparison.
- **Follow-up research** — after adding to cart, the existing 🔍 research button enriches with ratings/drinking windows.
- **Budget optimizer** — "I have €500 total, allocate across all gaps" — wrapper that distributes budget proportionally to projectedDeficit.
- **SSE streaming** — when the ~30s wait becomes a UX problem, add a streaming contract (EventSource on client, SSE on server). Deferred because `wineResearch.js`'s async-fetch pattern handles 30s–2m waits adequately.

---

## 4. User Flow & Wireframes

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
- **Saving**: Brief "Saved ✓" toast on each change (debounced 350ms)

### Flow 2: Finding wines for a gap (main flow)

```
Buying Guide → Gap card for Dry Rosé:

┌─────────────────────────────────────────────────────────┐
│ Dry Rosé                                    +23 bottles │
│ 1 of 24 needed (14% demand)                            │
│ 15 needed after planned                                 │
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
│ Budget: ~€15/bottle · Checking Vivino, Grandcruwijnen   │
│ ┌───────────────────────────────────────┐               │
│ │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░ │               │
│ └───────────────────────────────────────┘               │
│ This may take 30 seconds – 2 minutes                    │
└─────────────────────────────────────────────────────────┘

Results arrive →

┌─────────────────────────────────────────────────────────┐
│ Dry Rosé                                    +23 bottles │
│ ... (gap card content) ...                              │
│ [+ Add to Plan] [🔍 Hide Results ▴]                     │
├─────────────────────────────────────────────────────────┤
│ Found 5 wines · ~€270 · 15 bottles  [🛒 Add All]       │
│                                                         │
│ ┌─── Vivino ──────────────────────────────────────────┐ │
│ │ 🍷 Château Cavalier Marafiance 2024          ×6     │ │
│ │    Côtes de Provence · Grenache, Cinsault            │ │
│ │    Est. €12.00                                       │ │
│ │    🏆 DWWA 2025 Best in Show 97pts                   │ │
│ │    Pairs: pork, chicken, spicy                       │ │
│ │                                     [🛒 Add to Cart] │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🍷 Domaine Houchart Côtes de Provence 2023    ×4   │ │
│ │    Côtes de Provence · Est. €10.00                   │ │
│ │    🏆 DWWA Silver                                    │ │
│ │                                     [🛒 Add to Cart] │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─── Grandcruwijnen ──────────────────────────────────┐ │
│ │ 🍷 Grenache Rosé, Pays d'Oc                  ×3    │ │
│ │    Southern France · Est. €10.00                     │ │
│ │                                     [🛒 Add to Cart] │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─── Other ───────────────────────────────────────────┐ │
│ │ 🍷 Tavel Rosé (Mordorée)                     ×2    │ │
│ │    Tavel AOC · Est. €14.00                           │ │
│ │                                     [🛒 Add to Cart] │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Vendor Summary                                          │
│ ┌──────────────┬──────┬──────────┐                      │
│ │ Vendor       │ Btls │ Est.     │                      │
│ │ Vivino       │  10  │ ~€108    │                      │
│ │ Grandcruwijnen│  3  │ ~€30     │                      │
│ │ Other        │  2   │ ~€28     │                      │
│ │ TOTAL        │ 15   │ ~€166    │                      │
│ └──────────────┴──────┴──────────┘                      │
└─────────────────────────────────────────────────────────┘
```

### Flow 3: Adding to cart + buying guide refresh

```
User clicks "🛒 Add to Cart" on Château Cavalier →
  Button changes to "✓ Added" (disabled, green)
  Toast: "Château Cavalier Marafiance added to cart (6 bottles)"
  cartState.addItem() → cartState.notify() → cart panel updates

User clicks "🛒 Add All" →
  All recommendation buttons change to "✓ Added"
  Toast: "5 wines (15 bottles) added to cart"
  After all adds: renderBuyingGuide() re-renders the full buying guide
  Gap card's projectedDeficit recalculates (now 0 if all added)
```

### State Map — Restock Panel

| State | What user sees | Trigger |
|---|---|---|
| **Hidden** | Gap card only, "🔍 Find Wines" button | Initial render |
| **Loading** | Panel below card: spinner + vendor list + progress text | "Find Wines" click |
| **Success** | Recommendation cards grouped by vendor, summary table | API returns data |
| **Partial** | Results + note "Found 8 of 15 needed — adjust budget?" | Results < projectedDeficit |
| **Empty** | "No wines found at this price point. Try adjusting budget in Settings." | 0 results from extraction |
| **Error** | "Search failed: {message}. Try again." with retry button | API error or timeout |
| **No vendors** | "Configure vendors in Settings → Restock Preferences first." | No `restock_vendors` setting |
| **No AI** | Button hidden entirely | `aiAvailable === false` on guide response |
| **Added** | Individual "✓ Added" badges per wine, or all disabled after "Add All" | After cartState.addItem() |

### UX Principles Applied

| Principle | Application |
|---|---|
| **Progressive Disclosure (#13)** | One style at a time. Results hidden until requested. Vendor summary at the bottom (detail after overview). |
| **Hick's Law (#15)** | Max 5-8 recommendations per style. Grouped by vendor reduces visual choice paralysis. |
| **Proximity (#1)** | Results panel directly below its gap card — spatial relationship is clear. |
| **Common Region (#6)** | Vendor groups enclosed in bordered sections. Summary table enclosed in its own container. |
| **Feedback & System Status (#11)** | Loading spinner with "Budget: ~€15/bottle · Checking Vivino, Grandcruwijnen...". "✓ Added" confirms action. Time estimate sets expectations. |
| **Error Prevention (#12)** | Button disables after add (no double-add). "Add All" is easily undoable (delete from cart). |
| **Recognition Over Recall (#14)** | Awards shown inline. Food pairing chips match the gap card's "Because you cook" signals. |
| **Visual Hierarchy (#17)** | Wine name is bold, price is prominent, awards get icon treatment (🏆), vendor name is section header. |
| **Consistency (#10)** | Cards reuse `.gap-card` border/radius/padding pattern. Buttons match `.gap-add-btn` style. Colour badges match existing `STYLE_COLOURS`. |
| **Fitts's Law (#16)** | "Add to Cart" buttons are right-aligned and full-width within cards on mobile. "Add All" is large and top-right. Touch targets ≥44px. |
| **Whitespace (#18)** | 0.5rem gap between cards (matches existing gap-cards grid). Vendor groups separated by expanded margin. |

---

## 5. File-Level Plan

### New Files

#### 5.1 `src/services/recipe/restockSearch.js` — Restock search service (two-phase)

**Purpose**: Builds Claude prompts for vendor-aware wine recommendations per style, executes two-phase search (Sonnet → Haiku), extracts structured results.

**Key functions**:
- `searchStyleRestock({ gap, preferences })` — Main entry. Accepts the server-derived gap object + user preferences. Returns `{ recommendations: [...], summary: { totalBottles, estimatedSpend, vendorCount }, searchDuration }`.
- `buildSearchPrompt({ gap, preferences })` — Constructs the Phase 1 system + user prompt for Sonnet. Includes vendor names/URLs, budget constraint, quantity rules, food signal context. **NO JSON schema** in this prompt.
- `buildExtractionPrompt(narrative, sourceUrls, gap)` — Constructs Phase 2 prompt for Haiku. Includes the JSON schema + assistant prefill `[` for immediate array output.
- `normalizeRecommendations(parsed)` — Guarantees type safety: arrays are arrays, numbers are numbers, missing fields get defaults.

**Dependencies**: `ai/claudeClient.js` (shared client), `config/aiModels.js` (`getModelForTask('restockAdvisor')` for Phase 1, `getModelForTask('wineExtraction')` for Phase 2), `shared/jsonUtils.js` (`extractJsonWithRepair`), `ai/claudeResponseUtils.js` (`extractText`, `extractStreamText`)

**Architecture** (mirrors `claudeWineSearch.js` two-phase pattern):
```
Phase 1: Sonnet + web_search_20250305 tool (SSE streaming)
  → Simple research prompt (vendor-aware, style-specific)
  → Returns { narrative, sourceUrls, citations, duration }
  → Handles pause_turn continuations (max 2)
  → Safety abort timeout: 180s

Phase 2: Haiku extraction (non-streaming)
  → Narrative + SOURCE REFERENCE block → JSON array
  → Assistant prefill "[" forces immediate array output
  → extractJsonWithRepair() handles malformed JSON
  → normalizeRecommendations() guarantees types
```

**Recommendation schema (Phase 2 output)**:
```javascript
{
  wine_name: string,       // "Château Cavalier Cuvée Marafiance, Côtes de Provence 2024"
  producer: string|null,   // "Château Cavalier"
  vintage: number|null,    // 2024
  est_price: number|null,  // 12.00
  currency: string,        // "EUR" (from preferences, not from LLM)
  vendor: string|null,     // "Vivino"
  vendor_url: string|null, // full URL if found, else null
  qty: number,             // 6
  awards: string|null,     // "DWWA 2025 Best in Show 97pts"
  food_pairing: string[],  // ["pork", "chicken", "spicy"]
  notes: string|null,      // "Top 25 under €15 on Vivino NL"
  colour: string|null,     // "Rosé"
  grapes: string|null,     // "Grenache, Cinsault, Syrah"
  region: string|null,     // "Côtes de Provence"
  country: string|null     // "France"
}
```

**Why this file** (SRP #2): Restock search is distinct from rating search (`claudeWineSearch.js`) and gap analysis (`buyingGuide.js`). Different prompt, different output schema, different consumer. Both `claudeWineSearch.js` and this file share `claudeClient.js` and `extractJsonWithRepair()` — the shared utility, not the orchestration.

#### 5.2 `src/routes/restockAdvisor.js` — API routes

**Purpose**: Express router for restock advisor endpoints.

**Endpoints**:
| Method | Path | Body / Query | Description |
|---|---|---|---|
| `POST` | `/search` | `{ styleId: string }` | Server derives gap context + prefs, calls search, returns recommendations |
| `GET` | `/preferences` | — | Read restock preferences from user_settings |
| `PUT` | `/preferences` | `{ vendors?, budget?, currency?, minQty?, maxQty?, allowOtherVendors? }` | Save restock preferences (upserts multiple settings keys) |

**Middleware**: `requireAuth`, `requireCellarContext` (applied at mount in `routes/index.js`)

**POST /search handler logic**:
```javascript
// 1. Validate body (Zod: { styleId })
// 2. Load current buying guide
const guide = await generateBuyingGuide(cellarId);

// 3. Find the gap for requested styleId
const gap = guide.gaps.find(g => g.style === styleId);
if (!gap) return res.status(404).json({ error: `No gap found for style ${styleId}` });
if ((gap.projectedDeficit ?? gap.deficit) <= 0) {
  return res.status(400).json({ error: `Style ${styleId} is already covered` });
}

// 4. Load restock preferences
const prefs = await loadRestockPreferences(cellarId);
if (!prefs.vendors?.length) {
  return res.status(400).json({ error: 'No vendors configured' });
}

// 5. Call search service
const result = await searchStyleRestock({ gap, preferences: prefs });

// 6. Return
res.json({ data: result });
```

**Dependencies**: `services/recipe/restockSearch.js`, `services/recipe/buyingGuide.js`, `db/index.js` (settings), `schemas/restockAdvisor.js` (validation)

**Why this file** (SRP #2): Restock is a distinct domain from recipes (`routes/recipes.js`) and cart items (`routes/buyingGuideItems.js`). Follows the same per-domain route file pattern.

#### 5.3 `src/schemas/restockAdvisor.js` — Zod validation schemas

**Purpose**: Request validation for restock advisor endpoints.

**Schemas**:
```javascript
import { z } from 'zod';
import { STYLE_IDS } from '../config/styleIds.js';

export const searchSchema = z.object({
  styleId: z.enum(STYLE_IDS)
});

export const preferencesSchema = z.object({
  vendors: z.array(z.object({
    name: z.string().min(1).max(100),
    url: z.string().max(200).optional()
  })).max(10).optional(),
  budget: z.number().min(1).max(10000).optional(),
  currency: z.string().min(1).max(10).optional(),
  minQty: z.number().int().min(1).max(50).optional(),
  maxQty: z.number().int().min(1).max(100).optional(),
  allowOtherVendors: z.boolean().optional()
}).refine(data => {
  if (data.minQty && data.maxQty) return data.minQty <= data.maxQty;
  return true;
}, { message: 'minQty must be <= maxQty' });
```

**Why this file** (Consistency #10, Defensive Validation #12): All routes validate via `validateBody(schema)`. Follows the exact pattern of existing schema files.

#### 5.4 `public/js/recipes/restockPanel.js` — Frontend restock panel UI

**Purpose**: Renders the restock recommendation panel below gap cards, handles user interactions.

**Key functions**:
- `openRestockForStyle(gapCardEl, gap, guideContainer)` — Creates/toggles the restock panel below a gap card. Calls API, manages loading → results → error states.
- `renderLoadingState(panel, gap, preferences)` — Shows spinner + "Checking Vivino, Grandcruwijnen..." + progress bar with "30s–2m" estimate. Follows `wineResearch.js` pattern.
- `renderResults(panel, data, gap, guideContainer)` — Builds recommendation cards grouped by vendor, summary table, "Add All" button.
- `renderRecommendationCard(rec)` — Single wine card HTML. Uses `escapeHtml()` for all user-facing text.
- `renderVendorSummary(recommendations)` — Summary table: vendor → bottles → estimated cost.
- `handleAddToCart(rec, btn, gap)` — Calls `cartState.addItem()` with mapped fields. Disables button. Shows toast.
- `handleAddAll(recommendations, panel, gap, guideContainer)` — Batch-adds all via `cartState.addItem()`. After all adds complete: calls `renderBuyingGuide(guideContainer)` to refresh gap cards.
- `closePanel(panel, gapCardEl)` — Removes panel, restores button text.

**Cart item mapping** (recommendation → `addItem` data):
```javascript
{
  wine_name: `${rec.producer ? rec.producer + ' ' : ''}${rec.wine_name}`,
  producer: rec.producer || null,
  quantity: rec.qty,
  style_id: gap.style,
  price: rec.est_price || null,
  currency: rec.currency || preferences.currency || 'EUR',
  vintage: rec.vintage || null,
  notes: [rec.awards, rec.notes].filter(Boolean).join(' · ') || null,
  source: 'ai_restock',
  source_gap_style: gap.style,
  vendor_url: rec.vendor_url || null
}
```

**Stale guard**: After the async fetch, check if the panel DOM element still exists before rendering (same pattern as `wineResearch.js`).

**Dependencies**: `api/restockAdvisor.js` (API calls), `recipes/cartState.js` (`addItem`), `recipes/buyingGuide.js` (`renderBuyingGuide` — for refresh after adds), `utils.js` (`escapeHtml`, `showToast`)

**Why this file** (SRP #2, Consistency #10): Lives under `public/js/recipes/` alongside `buyingGuide.js`, `cartPanel.js`, `cartState.js`, `wineResearch.js`. Each module has one job.

#### 5.5 `public/js/api/restockAdvisor.js` — Frontend API module

**Purpose**: Authenticated API calls for restock advisor endpoints.

**Key functions**:
```javascript
import { API_BASE, apiFetch, handleResponse } from './base.js';
const fetch = apiFetch;

export async function searchRestockForStyle(styleId) {
  const res = await fetch(`${API_BASE}/api/restock-advisor/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ styleId })
  });
  return handleResponse(res, 'Restock search failed');
}

export async function getRestockPreferences() {
  const res = await fetch(`${API_BASE}/api/restock-advisor/preferences`);
  return handleResponse(res, 'Failed to load restock preferences');
}

export async function saveRestockPreferences(prefs) {
  const res = await fetch(`${API_BASE}/api/restock-advisor/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs)
  });
  return handleResponse(res, 'Failed to save restock preferences');
}
```

**Dependencies**: `api/base.js` (`apiFetch`, `handleResponse`)

**Why this file** (SRP #2, Consistency #10): Follows the existing pattern where each domain has its own API module. All re-exported via `api/index.js`.

### Modified Files

#### 5.6 `public/js/recipes/buyingGuide.js` — Add "Find Wines" button to gap cards

**Changes**:
1. Import `openRestockForStyle` from `./restockPanel.js`.
2. In `renderGaps()`, add `data-style-id` attribute to each gap card for event delegation.
3. Add `<button class="gap-restock-btn" data-style="${gap.style}" type="button">🔍 Find Wines</button>` next to the existing `.gap-add-btn` — conditionally rendered when `aiAvailable` is truthy.
4. In the button wiring, add click handler for `.gap-restock-btn` that calls `openRestockForStyle(gapCardEl, gap, container)`.
5. Pass `aiAvailable` down from the guide response to `renderGaps()`.
6. **Export `renderBuyingGuide()`** so `restockPanel.js` can re-render after batch adds. (Verify it's exported; if not, add the export.)
7. Store the `guide.gaps` array so `restockPanel.js` can look up gap data by style when the button is clicked.

**Principle**: Open/Closed (#3) — extending gap cards without modifying their core rendering logic.

#### 5.7 `src/services/recipe/buyingGuide.js` — Add `aiAvailable` to guide response

**Changes**: In the guide response object construction, add:
```javascript
aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY)
```

This follows the exact pattern from the awards route. No new dependency needed — `process.env` is always available.

**Principle**: Progressive Disclosure (#13) — expose capability flag so the UI can conditionally show AI features.

#### 5.8 `public/index.html` — Add "Restock Preferences" settings section

**Changes**: Add a new `<div class="settings-section">` block for vendor preferences, following the exact same pattern as existing sections (Rating Preferences, Display Settings, etc.):

```html
<div class="settings-section">
  <button class="settings-section-toggle" aria-expanded="false"
          data-section-id="restock-preferences">
    Restock Preferences <span class="settings-section-arrow">▸</span>
  </button>
  <div class="settings-section-body" style="display: none;">
    <p class="settings-section-desc">Configure preferred vendors and budget
    for AI wine recommendations.</p>
    <div id="restock-vendors-list"></div>
    <button id="restock-add-vendor-btn" class="btn btn-small btn-secondary"
            type="button">+ Add vendor</button>
    <label class="settings-checkbox-row">
      <input type="checkbox" id="restock-allow-other" checked />
      Also suggest wines from other vendors
    </label>
    <div class="settings-row">
      <label class="settings-label">Budget per bottle</label>
      <input type="number" id="restock-budget"
             class="settings-input settings-input-small"
             min="1" max="10000" />
      <select id="restock-currency"
              class="settings-select settings-select-small">
        <option value="EUR">EUR</option>
        <option value="USD">USD</option>
        <option value="GBP">GBP</option>
        <option value="ZAR">ZAR</option>
        <option value="AUD">AUD</option>
        <option value="CHF">CHF</option>
      </select>
    </div>
    <div class="settings-row">
      <label class="settings-label">Quantity per wine</label>
      <input type="number" id="restock-min-qty"
             class="settings-input settings-input-small"
             min="1" max="50" placeholder="min" />
      <span class="settings-label-inline">to</span>
      <input type="number" id="restock-max-qty"
             class="settings-input settings-input-small"
             min="1" max="100" placeholder="max" />
    </div>
  </div>
</div>
```

**Principle**: Consistency (#10) — follows the exact `settings-section` / `settings-section-toggle` / `settings-section-body` pattern.

#### 5.9 `public/js/settings.js` — Initialize restock preferences section

**Changes**:
- Add `initRestockPreferences()` function — loads current values via `getRestockPreferences()`, renders vendor rows, wires event listeners.
- Call `initRestockPreferences()` from existing `initSettings()` bootstrap.
- Wire: vendor add/remove, budget input, currency select, qty inputs, checkbox — each calls `saveRestockPreferences()` (debounced 350ms).
- Vendor row rendering: name input + URL input + remove button per row. Dynamic DOM creation (no inline handlers — CSP compliant).

**Principle**: Consistency (#10) — same init/wire pattern as existing settings sections.

#### 5.10 `src/config/aiModels.js` — Add `restockAdvisor` task

**Changes**: Add entry to `TASK_MODELS` and `TASK_THINKING`:
```javascript
// In TASK_MODELS:
restockAdvisor: 'claude-sonnet-4-6',

// In TASK_THINKING:
restockAdvisor: 'low',
```

Phase 2 extraction reuses the existing `wineExtraction` → Haiku task. No new task needed for Phase 2.

**Principle**: Single Source of Truth (#10) — all model selection goes through `aiModels.js`.

#### 5.11 `src/routes/index.js` — Mount restock advisor router

**Changes**: Add import and route registration:
```javascript
import restockAdvisorRoutes from './restockAdvisor.js';

// In the DATA ROUTES section:
router.use('/restock-advisor', requireAuth, requireCellarContext, restockAdvisorRoutes);
```

**Note**: The mount is `/restock-advisor` (not `/api/restock-advisor`) because `server.js` already prefixes `/api`.

**Principle**: Consistency (#10) — follows the exact pattern of all other data route mounts.

#### 5.12 `public/js/api/index.js` — Add restock advisor barrel exports

**Changes**: Add re-export section:
```javascript
// Restock advisor
export {
  searchRestockForStyle,
  getRestockPreferences,
  saveRestockPreferences
} from './restockAdvisor.js';
```

**Principle**: Consistency (#10) — all API modules are barelled through `index.js`.

#### 5.13 `public/sw.js` — Add new JS files to STATIC_ASSETS + bump cache

**Changes**:
1. Add `/js/recipes/restockPanel.js` to `STATIC_ASSETS` array.
2. Add `/js/api/restockAdvisor.js` to `STATIC_ASSETS` array.
3. Bump `CACHE_VERSION` (e.g. current value → next increment).

**Principle**: Deployment Safety — the existing `swStaticAssets` regression test will catch missing entries.

#### 5.14 `public/css/components.css` — Restock panel styles

**Changes**: Add CSS for:
- `.restock-panel` — container below gap card, border-top to visually connect to its gap card. Uses **Common Region** (Gestalt #6).
- `.restock-loading` — spinner state with progress bar.
- `.restock-results-header` — summary line ("Found 5 wines · ~€270 · 15 bottles").
- `.restock-vendor-group` — vendor section container with header.
- `.restock-card` — individual recommendation card. Reuses `.gap-card` border/radius/padding for consistency.
- `.restock-card-awards` — awards badge (🏆 + text).
- `.restock-card-pairing` — food pairing chips, reuses `.recipe-tag` pattern.
- `.restock-vendor-summary` — summary table.
- `.restock-add-btn` — "Add to Cart" button. Reuses `.gap-add-btn` sizing.
- `.restock-add-btn.added` — "✓ Added" state (green, disabled).
- `.restock-add-all-btn` — "Add All to Cart" button (prominent, right-aligned).
- `.gap-restock-btn` — "Find Wines" button on gap cards (matches `.gap-add-btn` sizing).
- Responsive: single-column on mobile, cards stack vertically. Touch targets ≥44px.

**Principle**: Consistency (#10), CSS Variables (#40) — reuses existing design tokens.

---

## 6. Buying Guide Re-rendering Strategy

**The problem**: `buyingGuide.js` renders once on load and does not subscribe to cart state. After adding restock items, `projectedDeficit` changes — but the gap cards don't reflect this.

**The chosen strategy**: **Explicit re-render after batch operations.**

After "Add All" (or after panel close following individual adds), `restockPanel.js` calls `renderBuyingGuide(container)` on the parent container. This triggers a fresh `GET /recipes/buying-guide` fetch, which recalculates projectedDeficit with the newly-added cart items.

**Why not subscribe to cart state?** Adding a `cartState.subscribe()` in `buyingGuide.js` would cause a cascade: every cart state change (status transitions, deletions, edits) would trigger a full buying guide fetch — an expensive server call with gap analysis. The explicit re-render is one call after a completed action, not a reactive subscription.

**Trade-off**: After a single "Add to Cart" (not "Add All"), we do NOT re-render the buying guide — only the button state changes. This avoids the jarring UX of the gap card changing while the user is still reviewing other recommendations. The re-render happens after "Add All" or when the user collapses the panel.

**Implication for `renderBuyingGuide`**: The function must be exported and callable multiple times on the same container. Currently it sets `container.innerHTML` directly — this is already idempotent. We verify it's exported (if not, add the export).

---

## 7. Technical Architecture Details

### Phase 1 (Search) — Research Prompt Design

The search prompt must:
- Name specific vendors and their URLs so Claude searches those sites
- Specify budget constraint per bottle
- Reference the style and its typical sub-styles/grapes (from `SHOPPING_SUGGESTIONS`)
- Mention food signals that drive demand (from gap's `drivingSignals`)
- Request awards, ratings, and variety
- **NOT contain any JSON schema** (prevents code_execution loops — proven in `claudeWineSearch.js`)
- Use `projectedDeficit` as the quantity target (accounts for cart items)

Example prompt structure (system + user, no JSON schema):
```
System: You are a wine purchasing advisor. Research specific wines
available from the given vendors at the given price point. Be thorough
and check each vendor's site for availability and pricing.

User: I need to restock approximately {projectedDeficit} bottles of
{styleLabel} wine.

Budget: approximately {budget} {currency} per bottle
Vendors to check: {vendors[].name} ({vendors[].url})
{allowOtherVendors ? "You may also suggest wines from other reputable
vendors." : "Only suggest wines from the listed vendors."}
Quantity per wine: minimum {minQty}, maximum {maxQty} bottles
My cooking drives demand for: {drivingSignals.join(', ')}
Wine styles to consider: {suggestions.join(', ')}

For each wine found, note: full name with producer and vintage, the
approximate price, which vendor has it, any competition awards or high
ratings, and which foods it pairs well with. Aim for variety across
sub-styles and vendors.
```

### Phase 2 (Extraction) — Structured Output Prompt Design

The extraction prompt:
- Receives the Phase 1 prose narrative + SOURCE REFERENCE block (maps citation numbers → URLs)
- Contains the JSON array schema for recommendations
- Uses assistant prefill `[` to force immediate JSON array output
- Runs on Haiku (fast, cheap, sufficient for structured extraction)
- `extractJsonWithRepair()` handles edge cases (truncated JSON, extra text)

### Currency Handling

The `currency` field on recommendations uses the user's configured `restock_currency` preference, NOT whatever currency Claude finds on vendor websites. This prevents mixing EUR/USD/GBP within a single style's results. Prices are estimates regardless — using a consistent currency makes the summary table meaningful.

### Quantity Allocation

The extraction prompt instructs Claude to distribute `projectedDeficit` bottles across recommendations, respecting `minQty` and `maxQty` per wine. The `normalizeRecommendations()` function in `restockSearch.js` enforces a hard cap: total recommended qty ≤ projectedDeficit. If Claude over-allocates, quantities are proportionally scaled down.

### State Management (Frontend)

The restock panel does **not** need global state — it's ephemeral per gap card interaction:

- **Panel state** lives in DOM data attributes and closure variables
- **Results** are rendered once and not re-fetched on cart state changes
- **"Added" state** is tracked per-button via `disabled` attribute + CSS class
- **Cart integration** uses `cartState.addItem()` which handles reactive notification

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

## 8. Risk & Trade-off Register

| Risk | Severity | Mitigation |
|---|---|---|
| **Claude web search returns inaccurate prices** | Medium | UI labels "Est." everywhere. Notes field captures caveats. User verifies on vendor site. |
| **Vendor sites may not be indexed by Claude's search** | Medium | Include vendor name + URL in prompt. `allowOtherVendors` default `true` provides fallback. |
| **Search takes 30–60 seconds** | Low | Loading state with progress text (proven pattern from wineResearch.js). Style-by-style means no blocking. |
| **Two-phase extraction returns malformed JSON** | Low | `extractJsonWithRepair()` handles common issues. `normalizeRecommendations()` guarantees types. Fallback to error state. |
| **Race condition: cart state changes between guide load and search** | Low | Server re-derives gap from fresh `generateBuyingGuide()` at search time. No stale client data. |
| **API cost per search** | Low | One Sonnet + one Haiku call per style (~$0.01–0.05). 7 gaps = ~$0.07–0.35. No background polling. |
| **`buyingGuide.js` re-render after adds disrupts open restock panels** | Medium | Re-render only happens after "Add All" or panel close, not after individual adds. The re-rendered DOM replaces the buying guide section, so any open panel is closed — acceptable because "Add All" is a terminal action. |
| **Settings validation — malformed vendor JSON** | Low | Zod schema validates on PUT. Frontend validates before save. Settings getter returns `[]` on parse failure. |

### Trade-offs

| Choice | Alternative considered | Why this choice |
|---|---|---|
| **Server-derived gap context** | Client sends deficit/signals | Server is authoritative (`buyingGuide.js` owns gap computation). Prevents TOCTOU and fabrication. One extra `generateBuyingGuide()` call on search — acceptable because it's fast. |
| **Two-phase search** | Single-call JSON web search | Two-phase prevents code_execution loops (proven in `claudeWineSearch.js`). Small latency overhead vs robust reliability. |
| **Explicit re-render (not subscription)** | `cartState.subscribe()` in buyingGuide | Subscription would trigger expensive guide fetches on every cart change. Explicit re-render is surgical — one fetch after a completed action. |
| **Inline panel (not modal)** | Full-page or modal overlay | Inline preserves gap card context. User can see deficit and signals. Modal would break flow. |
| **No result caching** | Cache for 24h | Wine availability changes. Stale cache → user frustration. Small API cost doesn't justify complexity. |
| **Sonnet (not Opus) for search** | Opus for better reasoning | Same `web_search` tool capability. 5× cost for marginal quality improvement on product recommendations. |
| **No SSE streaming to browser for MVP** | EventSource streaming | `wineResearch.js` proves async-fetch + loading state handles 30s–2m waits. Streaming adds complexity for small UX gain. Can be added later. |

### Deliberately deferred

| Feature | Why deferred |
|---|---|
| **"Fill all gaps" automation** | Sequential wrapper over per-style search. Not MVP. |
| **Live price fetching** | Requires Puppeteer/BrightData scraping. Claude estimates are sufficient for MVP. |
| **Vendor account integration** | Vivino API, direct ordering — significant scope. |
| **Budget optimizer** ("€500 across all gaps") | Requires constraint-solving across styles. Per-style budget is simpler. |
| **Result persistence** | Cart items already persist the decision. Past search results don't add value. |
| **SSE streaming to browser** | Async-fetch + loading state is proven. Can add streaming contract later. |

---

## 9. Testing Strategy

### Unit Tests

| Test file | Covers |
|---|---|
| `tests/unit/services/recipe/restockSearch.test.js` | Prompt building (Phase 1 & 2), two-phase orchestration with mocked Claude, recommendation normalization, error handling (Phase 1 failure, Phase 2 malformed JSON, empty results) |
| `tests/unit/routes/restockAdvisor.test.js` | Zod schema validation (styleId enum, preferences shape), auth/cellar middleware enforcement, POST /search gap lookup logic, GET/PUT /preferences settings round-trip |
| `tests/unit/schemas/restockAdvisor.test.js` | Schema edge cases: minQty > maxQty rejection, vendor array max 10, empty styleId rejection |
| `tests/unit/utils/swStaticAssets.test.js` | (Existing) — auto-catches missing STATIC_ASSETS entries for new files |

### Key unit test cases

**restockSearch.test.js**:
- `buildSearchPrompt()` includes vendor names/URLs in prompt text
- `buildSearchPrompt()` uses `projectedDeficit` not raw `deficit`
- `buildSearchPrompt()` includes food signals and suggestions
- `buildExtractionPrompt()` contains JSON schema but NOT in Phase 1 prompt
- `normalizeRecommendations()` converts string numbers to numbers
- `normalizeRecommendations()` defaults missing `qty` to `preferences.minQty`
- `normalizeRecommendations()` caps total qty at gap's `projectedDeficit`
- `searchStyleRestock()` returns structured result on success
- `searchStyleRestock()` handles Phase 1 timeout gracefully (returns error, not throw)
- `searchStyleRestock()` handles Phase 2 malformed JSON (`extractJsonWithRepair` fails)
- `searchStyleRestock()` handles empty narrative from Phase 1

**restockAdvisor.test.js (routes)**:
- POST `/search` without body → 400 validation error
- POST `/search` with invalid styleId → 400 validation error
- POST `/search` with valid styleId but no gap → 404
- POST `/search` with valid styleId, gap exists, no vendors → 400
- POST `/search` happy path → 200 with recommendations
- GET `/preferences` → returns parsed settings
- PUT `/preferences` with invalid data → 400
- PUT `/preferences` happy path → upserts settings
- All endpoints require auth (mocked requireAuth)
- All endpoints require cellar context (mocked requireCellarContext)

### Integration tests

- **Settings round-trip** — PUT preferences → GET preferences → verify structure matches
- **Search → cart flow** — POST /search → response includes recommendations → POST to buying-guide-items → verify cart item has `source: 'ai_restock'` and `source_gap_style`

### Manual testing checklist

- [ ] Settings: Add/remove vendors, verify save persistence across page reload
- [ ] Settings: Budget, currency, qty min/max save correctly
- [ ] Settings: "Allow other vendors" checkbox persists
- [ ] Gap card: "Find Wines" button appears only when `aiAvailable === true`
- [ ] Gap card: "Find Wines" button hidden when no ANTHROPIC_API_KEY
- [ ] Loading: Spinner shows, vendor names listed during search
- [ ] Loading: Panel appears directly below the clicked gap card
- [ ] Results: Cards render with correct vendor grouping
- [ ] Results: Awards, prices ("Est."), food pairing chips render correctly
- [ ] Results: Summary table shows correct totals per vendor
- [ ] Results: Total bottles ≈ projectedDeficit (not raw deficit)
- [ ] Add to Cart: Button disables to "✓ Added", toast shows
- [ ] Add to Cart: Cart panel updates reactively (via cartState subscriber)
- [ ] Add All: All buttons disable, toast shows total
- [ ] Add All: Buying guide re-renders with updated projectedDeficits
- [ ] Empty results: Helpful message when no wines found
- [ ] Error: Retry button works after transient failure
- [ ] No vendors: Shows settings link prompt
- [ ] Mobile: Cards stack single-column, buttons remain tappable (≥44px touch target)
- [ ] Keyboard: Tab through results, Enter to add to cart
- [ ] Multiple panels: Can have two restock panels open simultaneously (independent styles)
- [ ] XSS: Wine names with `<script>` tags are escaped in rendering

---

## 10. Implementation Sequence

Suggested build order (each step is independently testable):

| Step | Files | Testable? |
|---|---|---|
| 1. AI model config | `src/config/aiModels.js` (+restockAdvisor task) | ✅ Existing model tests |
| 2. Zod schemas | `src/schemas/restockAdvisor.js` | ✅ Schema unit tests |
| 3. Backend service | `src/services/recipe/restockSearch.js` | ✅ Unit tests with mocked Claude |
| 4. Backend routes | `src/routes/restockAdvisor.js` + mount in `routes/index.js` | ✅ Route unit tests |
| 5. Buying guide `aiAvailable` flag | `src/services/recipe/buyingGuide.js` | ✅ Verify in guide response |
| 6. Frontend API module | `public/js/api/restockAdvisor.js` + barrel export in `index.js` | ✅ Manual API test |
| 7. Settings UI | `public/index.html` + `public/js/settings.js` | ✅ Manual settings test |
| 8. Restock panel UI | `public/js/recipes/restockPanel.js` + CSS | ✅ Manual E2E flow |
| 9. Gap card integration | `public/js/recipes/buyingGuide.js` modifications | ✅ Full flow test |
| 10. Service worker | `public/sw.js` (STATIC_ASSETS + cache bump) | ✅ `swStaticAssets` test |
| 11. Tests | Unit + integration test files | ✅ `npm run test:all` |

---

## Appendix: Prompt Design Notes

### Phase 1 prompt constraints
- Must not contain JSON schema (causes code_execution loops)
- Must name each vendor + URL so Claude's web_search targets them
- Must specify `projectedDeficit` as target quantity (not raw deficit)
- Should request awards/ratings context for higher-quality recommendations
- Should mention food signals to guide pairing-aware selection

### Phase 2 extraction constraints
- Must include SOURCE REFERENCE block mapping citation numbers → URLs
- Must use assistant prefill `[` or `{` to force immediate structured output
- Must run on Haiku (`wineExtraction` task) for cost/speed
- Currency is injected from preferences, not extracted from narrative

### Quantity allocation rules (enforced in `normalizeRecommendations`)
1. Each wine's qty must be ≥ `minQty` and ≤ `maxQty`
2. Total qty across all wines must be ≤ `projectedDeficit`
3. If Claude over-allocates: scale down proportionally, rounding to integers
4. If Claude under-allocates: acceptable (partial results shown in UI)
