# Shopping Cart / Buying Workflow

## Context

The buying guide (`src/services/recipe/buyingGuide.js`) is a read-only gap analysis engine. It compares cellar inventory against cooking profile demand and shows gaps, surpluses, and diversity recommendations — but stops at "here's what you need". There's no way to plan purchases, track incoming wine, or transition planned bottles into the physical cellar. This feature turns the buying guide into a live shopping workflow with a persistent cart, real-time recalculation, and an arrival-to-cellar pipeline.

A separate `generateShoppingList()` in `cellarHealth.js:601` duplicates gap logic with different style categories — Phase 6 reconciles this.

**Browser extension**: Extracted to a separate spec. This plan documents only the API contract the extension needs (Phase 2 endpoints: `POST /infer-style`, `GET /gaps`). The extension requires only these two endpoints plus the existing CRUD from Phase 1.

### Key Design Decisions
- **Virtual inventory = planned + ordered + unconverted arrived** — arrived items where `converted_wine_id IS NULL` still count as virtual (they haven't become physical wine records yet). Once converted, they drop out of virtual inventory and into physical. This avoids the "arrived purgatory" gap where items disappear from both counts.
- **Always create new wine records** on cellar conversion (no merge/dedup against existing wines)
- **API namespace**: `/api/buying-guide-items` (top-level, cleaner for future extension)
- **Centralized style taxonomy**: New shared module `src/config/styleIds.js` — single source of truth for all 11 style bucket IDs and labels
- **Partial conversion**: When cellar has fewer available slots than `quantity`, return partial result to frontend and let user explicitly confirm (no phantom items)
- **Reuse `saveAcquiredWine()`**: Refactor with `{ skipEnrichment, transaction }` options instead of writing a parallel INSERT path (DRY, SOLID)

### Review Resolutions

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Phase 7 scope creep | **Incorporated** — extracted to separate spec, only API contract remains |
| 2 | cellar_id type verification | **Confirmed** — `cellars.id` is `UUID PRIMARY KEY` (migration 028), all tenant tables use `cellar_id UUID` (migration 031). Middleware passes string, PostgreSQL casts transparently. |
| 3 | Parallel wine INSERT | **Incorporated** — refactor `saveAcquiredWine()` with options instead of new function |
| 4 | Phantom items from partial | **Incorporated** — return partial result to frontend, user decides |
| 5 | GET /gaps expensive | **Incorporated** — server-side caching using cooking_profiles pattern |
| 6 | Phase 6 blending under-specified | **Incorporated** — deferred blending to follow-up, delegation + fallback only |
| 7 | updated_at trigger | **Incorporated** — explicit `SET updated_at = NOW()` in all UPDATE queries (no triggers in codebase) |
| 8 | State machine no recovery | **Incorporated** — added `cancelled → planned`, allow delete of any non-converted item |
| 9 | Frontend file placement | **Incorporated** — clarified infer-style goes in buyingGuideItems.js |
| 10 | Enrichment debt | **Incorporated** — queue background enrichment after transaction commit |
| 11 | CORS verification | **Confirmed** — default `cors()` sends `Access-Control-Allow-Origin: *` with `credentials: false`. Safe for Bearer token auth. No changes needed. |
| 12 | Migration rollback | **Incorporated** — added commented rollback |
| 13 | Minor issues | **Incorporated** — ON DELETE SET NULL, rename to source_gap_style, document NUMERIC(10,2), batch-status path clarified |

---

## Phase 1: Data Model + Backend Cart API

### 1a. Centralize Style IDs
**New**: `src/config/styleIds.js`

Single source of truth for the 11 style bucket IDs and labels. Consumed by `buyingGuide.js`, `buyingGuideCart.js`, Zod schema.

```js
export const STYLE_IDS = [
  'white_crisp', 'white_medium', 'white_oaked', 'white_aromatic',
  'rose_dry', 'red_light', 'red_medium', 'red_full',
  'sparkling_dry', 'sparkling_rose', 'dessert'
];

export const STYLE_LABELS = {
  white_crisp: 'Crisp White', white_medium: 'Medium White', /* ... all 11 ... */
};
```

**Modify**: `src/services/recipe/buyingGuide.js` — import `STYLE_LABELS` from `styleIds.js` instead of local const (lines 30-42).

### 1b. Migration
**New**: `data/migrations/056_buying_guide_items.sql` (next sequential after 055)

```sql
CREATE TABLE IF NOT EXISTS buying_guide_items (
  id SERIAL PRIMARY KEY,
  cellar_id UUID NOT NULL,
  wine_name TEXT NOT NULL,
  producer TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  style_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'ordered', 'arrived', 'cancelled')),
  inferred_style_confidence TEXT
    CHECK (inferred_style_confidence IN ('high', 'medium', 'low')),
  price NUMERIC(10,2),
  currency TEXT DEFAULT 'ZAR',
  vendor_url TEXT,
  vintage INTEGER,
  colour TEXT,
  grapes TEXT,
  region TEXT,
  country TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual',
  source_gap_style TEXT,
  converted_wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgi_cellar ON buying_guide_items(cellar_id);
CREATE INDEX IF NOT EXISTS idx_bgi_cellar_status ON buying_guide_items(cellar_id, status);
CREATE INDEX IF NOT EXISTS idx_bgi_converted ON buying_guide_items(converted_wine_id)
  WHERE converted_wine_id IS NOT NULL;

ALTER TABLE buying_guide_items ENABLE ROW LEVEL SECURITY;

-- ROLLBACK: DROP TABLE IF EXISTS buying_guide_items;
```

Key decisions:
- `cellar_id UUID NOT NULL` — matches all tenant tables (`031_add_cellar_id_to_wines.sql`)
- `converted_wine_id ... ON DELETE SET NULL` — deleting a wine doesn't block cart cleanup
- `source_gap_style TEXT` — records which buying guide gap this item fills (distinct from `style_id` which is the inferred wine style)
- `NUMERIC(10,2)` for price — acceptable for wine; currencies without decimals (JPY) store whole numbers
- RLS enabled to match `047_enable_rls_all_tables.sql`

### 1c. Validation Schema
**New**: `src/schemas/buyingGuideItem.js`
- Zod schemas: `createItemSchema`, `updateItemSchema`, `updateStatusSchema`, `batchStatusSchema`, `listItemsQuerySchema`
- Import `STYLE_IDS` from `src/config/styleIds.js` (centralized)
- **Modify**: `src/schemas/index.js` — re-export new schemas

### 1d. Backend Service
**New**: `src/services/recipe/buyingGuideCart.js`

Key exports:
- `listItems(cellarId, filters)` — filter by status/style, paginated
- `createItem(cellarId, data)` — auto-infers style (calls Phase 2)
- `updateItem(cellarId, id, data)` — partial update, explicitly `SET updated_at = NOW()`
- `updateItemStatus(cellarId, id, status)` — validates state machine, sets `status_changed_at` + `updated_at`
- `batchUpdateStatus(cellarId, ids, status)` — bulk transition
- `deleteItem(cellarId, id)` — allowed for any non-converted item (`converted_wine_id IS NULL`)
- `getCartSummary(cellarId)` — counts by status + running totals segmented by currency
- `getActiveItems(cellarId)` — `planned` + `ordered` + `arrived WHERE converted_wine_id IS NULL` (for virtual inventory)

**Status State Machine** (strict transitions):
```
planned → ordered → arrived → [converted via to-cellar]
planned → cancelled
ordered → cancelled
planned → arrived (allow skip of ordered)
cancelled → planned (recovery path)
```
Invalid transitions return 400. Delete allowed for any non-converted item (not limited to `planned`).

**Currency-aware totals**: Group by currency in summary:
```js
{ totals: { ZAR: { bottles: 5, cost: 1200 }, EUR: { bottles: 2, cost: 45 } } }
```

All UPDATE queries include `SET updated_at = NOW()` explicitly (no auto-update triggers in codebase).

### 1e. Route
**New**: `src/routes/buyingGuideItems.js`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List items (query: status, style_id, limit, offset) |
| GET | `/summary` | Cart summary (counts + currency-segmented totals) |
| GET | `/:id` | Single item |
| POST | `/` | Create (auto style inference) |
| PUT | `/:id` | Update |
| PATCH | `/:id/status` | Status transition (state machine validated) |
| PATCH | `/batch-status` | Batch status update |
| DELETE | `/:id` | Delete (non-converted only) |

All paths are relative to mount point `/api/buying-guide-items` (kebab-case per convention).

**Modify**: `src/routes/index.js:110` — add:
```js
import buyingGuideItemsRoutes from './buyingGuideItems.js';
router.use('/buying-guide-items', requireAuth, requireCellarContext, buyingGuideItemsRoutes);
```

### 1f. Backup Integration
**Modify**: `src/routes/backup.js:76-89` — add to JSON export:
```js
buying_guide_items: await safeQuery(
  'SELECT * FROM buying_guide_items WHERE cellar_id = $1', req.cellarId
),
```
Also add corresponding import handling in the import endpoint.

### 1g. Tests
- `tests/unit/services/recipe/buyingGuideCart.test.js` — CRUD, state machine (valid + rejected + recovery), cellar isolation, currency-segmented totals, delete non-converted, updated_at setting
- `tests/unit/routes/buyingGuideItems.test.js` — endpoints, validation, status codes

---

## Phase 2: Style Inference + Extension API Contract

### Inference Service
**New**: `src/services/recipe/styleInference.js`

```js
export function inferStyleForItem(item) → { styleId, confidence, matchedOn }
```

1. Build wine-like object from `{ wine_name, producer, colour, grapes, region, country }`
2. If grapes missing → call `detectGrapesFromWine()` from `src/services/wine/grapeEnrichment.js`
3. If colour missing → infer from detected grapes
4. Call `matchWineToStyle(wineObj)` from `src/services/pairing/pairingEngine.js:21`
5. Return `{ styleId, confidence: 'high'|'medium'|'low', matchedOn: string[] }`

Import `STYLE_LABELS` from `src/config/styleIds.js` for label lookup.

### Integration
**Modify**: `src/services/recipe/buyingGuideCart.js` `createItem()`:
- If `style_id` not provided → call `inferStyleForItem(data)`
- Save inferred `style_id` + `inferred_style_confidence`
- Response includes `style_inferred: true`, `needs_style_confirmation: true` when confidence is `'low'`

### Extension API Contract Endpoints
**Add to** `src/routes/buyingGuideItems.js`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/infer-style` | `{ wine_name, producer?, colour?, grapes?, region? }` → `{ styleId, confidence, label }` |
| GET | `/gaps` | Lightweight gap summary (see Phase 3 caching) → `{ gaps: [...], coveragePct, projectedCoveragePct }` |

These are the only two endpoints the browser extension (separate spec) needs beyond the Phase 1 CRUD. The `POST /infer-style` function lives in `public/js/api/buyingGuideItems.js` (not `recipes.js`).

### Tests
- `tests/unit/services/recipe/styleInference.test.js` — known wines across all 11 buckets, missing data fallbacks, grape enrichment paths

---

## Phase 3: Buying Guide Recalculation with Virtual Inventory + Caching

### Modify `generateBuyingGuide()` in `src/services/recipe/buyingGuide.js`

After `classifyWines(wines)` at line 63:
1. Call `getActiveItems(cellarId)` from `buyingGuideCart.js` — returns **planned + ordered + arrived (unconverted)** items
2. Compute `virtualStyleCounts` (sum quantity by style_id)
3. Compute `projectedStyleCounts = physical + virtual` per style
4. Compute projected coverage + projected bottle coverage
5. Each gap gets `projectedDeficit: Math.max(0, target - projectedCount)`

**Why arrived (unconverted) counts as virtual**: An arrived item has NOT been converted to a wine record yet — it sits in `buying_guide_items` waiting for "Move to Cellar". Until converted, it's not in the `wines` table and not counted by `classifyWines()`. Excluding it would create an "arrived purgatory" where items vanish from both physical and virtual counts, inflating reported gaps.

### Response Additions (backwards-compatible)
```js
{
  coveragePct,                    // keep existing (= physical)
  bottleCoveragePct,              // keep existing (= physical)
  projectedCoveragePct,           // NEW: with virtual inventory
  projectedBottleCoveragePct,     // NEW: with virtual inventory
  activeCartItems: number,        // NEW: count of active (non-converted) items
  activeCartBottles: number,      // NEW: total quantity
  gaps: [{
    ...existing,
    projectedDeficit              // NEW: gap after virtual inventory
  }]
}
```

### Server-Side Caching (for GET /gaps performance)
Reuse the `cooking_profiles` table caching pattern (1-hour TTL, keyed on cellarId):

**New**: `buying_guide_cache` table (add to migration 056):
```sql
CREATE TABLE IF NOT EXISTS buying_guide_cache (
  cellar_id UUID PRIMARY KEY,
  cache_data JSONB,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Cache logic in `generateBuyingGuide()`:
- On read: check `buying_guide_cache` for cellarId, return if age < 1 hour
- On write: upsert after computation
- Invalidation: delete cache row on wine/recipe/slot/cart-item changes (piggyback on existing `invalidateProfile()` pattern from `cookingProfile.js`)

The `GET /gaps` endpoint calls the cached `generateBuyingGuide()` and returns only gap/coverage fields — making it fast enough for extension popup opens.

### Tests
- `tests/unit/services/recipe/buyingGuideProjected.test.js` — virtual counts, projected coverage, gap deficit reduction, backwards compat, arrived-unconverted included, arrived-converted excluded, cache hit/miss

---

## Phase 4: Frontend Shopping Cart UI

### API Module
**New**: `public/js/api/buyingGuideItems.js`
- All CRUD + summary + batch-status + infer-style + gaps functions
- Uses `apiFetch` from `public/js/api/base.js` (automatic auth headers)

### Cart State
**New**: `public/js/recipes/cartState.js`
- `loadCart()`, `getCartState()`, `refreshSummary()`, `addItemOptimistic()`, `removeItem()`
- Holds `{ items: [], summary: {}, loading: false }`

### Cart Panel Component
**New**: `public/js/recipes/cartPanel.js`

UX design (Gestalt principles + clear affordances):
- **Proximity**: Group cart items by status (planned → ordered → arrived) with visual separators
- **Similarity**: Consistent status badges (planned=blue, ordered=orange, arrived=green, cancelled=grey) matching style colours from profile summary
- **Affordance**: Visible action buttons with icons — "Mark Ordered" (truck icon), "Mark Arrived" (check icon), "Move to Cellar" (grid icon)
- **Feedback**: Optimistic UI updates + toast confirmations on status transitions

Features:
- Quick-add form: wine name + quantity (minimum), optional producer/vintage/colour/grapes fields
- Cart item list grouped by status with clear section headers
- Per-item: inline edit, status toggle buttons, delete (any non-converted)
- Running totals bar per currency: "5 bottles (R1,200 ZAR) + 2 bottles (€45 EUR)"
- Batch actions toolbar: checkbox select + "Mark Selected as Ordered/Arrived"
- All events via `addEventListener` (CSP compliant)

### Buying Guide Modifications
**Modify**: `public/js/recipes/buyingGuide.js`

1. **"Add to Plan" button** on each gap card — clear call-to-action affordance:
   ```html
   <button class="gap-add-btn" data-style="..." data-label="...">+ Add to Plan</button>
   ```
   Wire via `addEventListener` after innerHTML render. Click opens prefilled quick-add with that gap's style pre-set in `source_gap_style`.

2. **Dual coverage bars**: Physical (solid) + Projected (lighter/striped overlay) when `projectedBottleCoveragePct > bottleCoveragePct`. Clear visual contrast (Gestalt figure/ground).

3. **Cart section**: Render `cartPanel` between coverage bar and gap cards.

4. **Projected deficit on gap cards**: Show "X needed (Y after planned)" when `projectedDeficit < deficit`. Muted text below the deficit badge.

### Style Confirmation
When `needs_style_confirmation: true`, show inline `<select>` with 11 style options (from `STYLE_LABELS`) pre-selected with inferred style. On change → `PUT /api/buying-guide-items/:id`.

### Service Worker
**Modify**: `public/sw.js` — add to `STATIC_ASSETS`:
```
'/js/api/buyingGuideItems.js',
'/js/recipes/cartState.js',
'/js/recipes/cartPanel.js'
```
Bump `CACHE_VERSION`.

### CSS
**Modify**: `public/css/components.css` — add styles for:
- `.cart-panel`, `.cart-item`, `.cart-status-badge` (planned/ordered/arrived/cancelled)
- `.cart-quick-add`, `.cart-totals`, `.cart-batch-actions`
- `.coverage-bar-projected` (lighter/striped variant)
- `.gap-add-btn` (small primary button in gap cards)
- `.gap-projected-info` (muted text showing projected deficit)
- `.cart-group-header` (status group separators)

### Tests
- `tests/unit/recipes/cartPanel.test.js` — DOM rendering
- Existing `swStaticAssets` test catches missing SW entries

---

## Phase 5: Arrival → Cellar Flow

### Refactor `saveAcquiredWine()` — `src/services/acquisitionWorkflow.js:361`

Before adding arrival endpoints, refactor the existing function to support options:

```js
export async function saveAcquiredWine(wineData, options = {}) {
  const { quantity = 1, cellarId, skipEnrichment = false, transaction = null } = options;
  const query = transaction || db;  // Use transaction connection if provided

  // Existing INSERT (add producer to columns — currently missing!)
  const insertResult = await query.prepare(`
    INSERT INTO wines (
      cellar_id, wine_name, producer, vintage, colour, style, ...
    ) VALUES (?, ?, ?, ?, ?, ?, ...)
    RETURNING id
  `).get(cellarId, wineData.wine_name, wineData.producer || null, ...);

  // ... existing slot assignment logic ...

  // Conditional enrichment
  if (!skipEnrichment) {
    enrichWineData({ ...wineData, id: wineId }).then(...).catch(...);
  }

  return { wineId, slots: addedSlots, warnings, message };
}
```

Changes:
- Add `producer` to INSERT (it's missing — the wines table has this column per migration 032a, but `saveAcquiredWine` doesn't insert it)
- Add `skipEnrichment` option (wrap existing enrichment block in conditional)
- Add `transaction` option (use provided connection or fall back to `db`)
- No breaking changes to existing callers (all new options default to current behaviour)

### New Endpoints in `src/routes/buyingGuideItems.js`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/:id/arrive` | Mark as arrived + get placement suggestion |
| POST | `/:id/to-cellar` | Convert to wine record + assign slot |
| POST | `/batch-arrive` | Mark multiple as arrived |

### Arrival Handler
1. Validate state machine (`planned`/`ordered` → `arrived`)
2. Update status → `arrived`, set `status_changed_at` + `updated_at`
3. Call `suggestPlacement(itemAsWine, cellarId)` from `acquisitionWorkflow.js:177`
   - This internally calls `findBestZone(wine)` + `findAvailableSlot(zoneId, occupiedSlots, wine, { cellarId })` with correct signatures
   - Do NOT call `findAvailableSlot` directly — reuse `suggestPlacement` which handles occupied slot lookup
4. Return `{ zoneId, zoneName, suggestedSlot, confidence, alternatives }`

### To-Cellar Handler (Idempotent + Transactional + User-Confirmed Partial)
1. Verify `status = 'arrived'` AND `converted_wine_id IS NULL` (idempotency guard)
2. Count available slots first (pre-flight check)
3. **If fewer slots than quantity**: Return `{ partial: true, available: N, total: M }` with HTTP 200 and `requiresConfirmation: true`. Do NOT auto-create remainder items. Frontend shows: "Only N of M slots available — convert N now?" User must re-submit with `{ confirmed: true, convertQuantity: N }` to proceed.
4. **On confirmed conversion**, wrap in transaction (BEGIN/COMMIT/ROLLBACK):
   a. Call refactored `saveAcquiredWine(wineData, { cellarId, quantity: convertQuantity, skipEnrichment: true, transaction: txn })`
   b. Set `converted_wine_id` on the cart item, update quantity to `convertQuantity`
   c. If partial: user's original cart item quantity reduced; remainder stays as-is with `arrived` status
   d. Invariant check: verify assigned slot count matches `convertQuantity`
5. **Post-transaction**: Queue background enrichment for the new wine (non-blocking, fire-and-forget like existing `enrichWineData()` pattern at acquisitionWorkflow.js:443)
6. Return wine ID + assigned slots + partial info if applicable
7. If `converted_wine_id` already set → return 409 Conflict (already converted)

### Frontend
**Modify**: `public/js/recipes/cartPanel.js`
- "Mark Arrived" → calls arrive endpoint, shows placement suggestion inline with zone name
- "Move to Cellar" → calls to-cellar endpoint; if partial response, show confirmation dialog with slot count
- Batch: checkbox select + "Mark All Arrived" toolbar
- After conversion, show link to wine in cellar grid
- After batch conversion, suggest running cellar analysis

### Tests
- `tests/unit/services/recipe/buyingGuideArrival.test.js` — state machine, placement via suggestPlacement, transactional conversion via refactored saveAcquiredWine, idempotency guard, batch, partial conversion (user confirmation flow), producer field mapping, post-conversion enrichment queued

---

## Phase 6: Cellar Health Shopping List Delegation

### Modify `src/services/cellar/cellarHealth.js:601-615`

Replace `generateShoppingList()` to delegate to buying guide **with fallback for no-recipe users**:

```js
export async function generateShoppingList(cellarId) {
  try {
    const { generateBuyingGuide } = await import('../recipe/buyingGuide.js');
    const guide = await generateBuyingGuide(cellarId);

    // Fallback: if no recipes or no targets, use original health-based logic
    if (guide.empty || guide.noTargets || guide.recipeCount === 0) {
      return originalHealthShoppingList(cellarId);
    }

    if (guide.gaps.length === 0) return { gaps: [], totalNeeded: 0, source: 'buying_guide' };

    return {
      gaps: guide.gaps.map(g => ({
        category: g.label, style: g.style,
        need: g.deficit, projectedNeed: g.projectedDeficit,
        suggestions: g.suggestions
      })),
      totalNeeded: guide.gaps.reduce((s, g) => s + g.deficit, 0),
      source: 'buying_guide'
    };
  } catch {
    return originalHealthShoppingList(cellarId);
  }
}
```

Extract current logic into `originalHealthShoppingList()` private function. Fallback triggers on:
- Exception (buying guide fails)
- `guide.empty` (no recipes)
- `guide.noTargets` (recipes but no meaningful demand)
- `guide.recipeCount === 0`

This preserves `/health/shopping-list` for users who never import recipes.

**Diversity baseline blending**: Deferred to a follow-up. The delegation + fallback alone is a valuable deduplication. Blending recipe targets with health-based diversity minimums needs its own design spec with defined colour families, thresholds, and UX for hybrid recommendations.

### Tests
- Verify existing cellar health tests pass
- New tests: delegation path + fallback path (no recipes, exception)

---

## Dependency Order

```
Phase 1 (table + CRUD API + style centralization + backup)
  → Phase 2 (style inference + extension API contract)
    → Phase 3 (recalculation with virtual inventory + caching)
      → Phase 4 (frontend cart UI)
        → Phase 5 (arrival → cellar, refactored saveAcquiredWine)
      → Phase 6 (cellar health delegation with fallback)
```

---

## Files Summary

### New Files
| Phase | File |
|-------|------|
| 1 | `src/config/styleIds.js` |
| 1 | `data/migrations/056_buying_guide_items.sql` |
| 1 | `src/schemas/buyingGuideItem.js` |
| 1 | `src/services/recipe/buyingGuideCart.js` |
| 1 | `src/routes/buyingGuideItems.js` |
| 2 | `src/services/recipe/styleInference.js` |
| 4 | `public/js/api/buyingGuideItems.js` |
| 4 | `public/js/recipes/cartState.js` |
| 4 | `public/js/recipes/cartPanel.js` |

### Modified Files
| Phase | File | Change |
|-------|------|--------|
| 1 | `src/services/recipe/buyingGuide.js` | Import STYLE_LABELS from styleIds.js |
| 1 | `src/routes/index.js` | Add route mount for buying-guide-items |
| 1 | `src/schemas/index.js` | Re-export new schemas |
| 1 | `src/routes/backup.js` | Add buying_guide_items to JSON export + import |
| 3 | `src/services/recipe/buyingGuide.js` | Virtual inventory + projected coverage + caching |
| 4 | `public/js/recipes/buyingGuide.js` | Add-to-plan buttons, dual bars, cart section |
| 4 | `public/sw.js` | STATIC_ASSETS + CACHE_VERSION |
| 4 | `public/css/components.css` | Cart + coverage styles |
| 5 | `src/services/acquisitionWorkflow.js` | Refactor saveAcquiredWine() with skipEnrichment + transaction + producer |
| 6 | `src/services/cellar/cellarHealth.js` | Delegate shopping list with no-recipe fallback |

### Reused Existing Code (DRY)
| Module | Reused For |
|--------|-----------|
| `saveAcquiredWine()` — `acquisitionWorkflow.js:361` | Wine creation + slot assignment (Phase 5) — refactored, not duplicated |
| `matchWineToStyle()` — `pairingEngine.js:21` | Style inference (Phase 2) |
| `detectGrapesFromWine()` — `grapeEnrichment.js` | Grape enrichment when grapes missing (Phase 2) |
| `suggestPlacement()` — `acquisitionWorkflow.js:177` | Placement suggestion on arrival (Phase 5) |
| `findBestZone()` — `cellarPlacement.js:8` | Used internally by suggestPlacement |
| `apiFetch` — `api/base.js` | Frontend API calls with auth (Phase 4) |
| `invalidateProfile()` pattern — `cookingProfile.js` | Cache invalidation pattern (Phase 3) |

---

## Verification

After each phase, run:
```bash
npm run test:unit     # Verify no regressions
npm run test:all      # Full validation before commit
```

Phase 1: `curl -s .../api/buying-guide-items/summary` → `{ data: { planned: 0, ordered: 0, totals: {} } }`

Phase 3: `curl -s .../api/recipes/buying-guide` → response includes `projectedCoveragePct`, `projectedBottleCoveragePct`; `GET /api/buying-guide-items/gaps` returns cached gap summary

Phase 4: Open Recipe Library → Buying Guide shows "Add to Plan" on gap cards, cart panel renders with status grouping, dual coverage bars visible when items added

Phase 5: Add item → mark ordered → mark arrived → "Move to Cellar" → if partial, confirm dialog → wine appears in grid with correct zone → background enrichment queues

Phase 6: Users with no recipes → `/health/shopping-list` still returns gaps from health-based logic (not empty)
