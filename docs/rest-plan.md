# Restaurant Pairing Assistant

## Context

When dining at a restaurant, users need to pair wines from the restaurant's wine list with multiple dishes ordered at a table. This is different from the existing cellar sommelier (which pairs from the user's own collection). The user wants to photograph or type in the wine list and dish menu, filter/curate both lists, then get AI pairing recommendations. The primary use case is **mobile** (sitting at a restaurant table).

---

## UI Location

**Sub-mode within the existing "Find Pairing" tab** (`view-pairing`).

A mode toggle at the top splits the tab into two modes:
- **From My Cellar** (existing sommelier + manual pairing — default)
- **At a Restaurant** (new wizard flow)

Rationale: Avoids adding a 7th tab (mobile nav already has 6). Groups all pairing under one tab (Gestalt: proximity). The restaurant wizard gets full screen real estate (not a cramped modal).

---

## User Flow (4-Step Wizard)

```
[1: Wine List] → [2: Review Wines] → [3: Dishes] → [4: Pairings]
```

### Quick Pair Shortcut
A "Quick Pair" link at the top of restaurant mode for speed at the table:
- One photo upload (wine list) + text area (type your dishes)
- No review step — goes straight to recommendations
- Results show **confidence warning** if OCR quality was low: "Pairings based on best-guess parsing — tap Refine for accuracy"
- Results show a "Refine" button that loads the full wizard with parsed data pre-populated

### Step 1: Capture Wine List
- Text area for pasting/typing wine list
- Multi-image upload (file picker + camera button, up to 5 photos)
- Image thumbnails grid with remove (X) buttons
- "Analyze" button → sends all inputs to backend
- Per-image progress indicator (bounded concurrency: 2 at a time, not all 5)
- **"Skip to Manual"** button appears after 10s if parsing slow — lets user type wines directly
- Removing an image while in-flight cancels its request via `AbortController` (save battery/data)

### Step 2: Review & Filter Wines
- **Low-confidence triage first**: If any items have `confidence: 'low'`, show triage banner: "Review N uncertain items" — highlights them with warning styling. User can edit inline or remove. Price fields use `inputmode="decimal"` for fast 3-second mobile corrections (most common OCR error: bin number mistaken for price).
- All parsed wines shown as selectable cards (checked by default)
- Cards have **subtle pale burgundy tint** background (distinguishes from dish cards at a glance — Gestalt: similarity)
- User unchecks wines to exclude
- **Colour filter chips** (multi-select): Red, White, Rose, Sparkling — filters hide non-matching cards but **do not change** their checked state
- **Max price input** (derived from parsed prices) — hides wines above price
- **By-the-glass toggle**: Filter to only by-the-glass wines
- Counter: "12 of 18 wines selected" — reflects **checked AND visible** count (exactly what gets sent)
- "Select All Visible" / "Deselect All Visible" toggle
- Manual "Add Wine" button for anything parsing missed

### Step 3: Capture & Review Dishes
- Text area for typing dish descriptions (one per line)
- Multi-image upload (same component as Step 1)
- "Analyze" button (+ **"Skip to Manual"** button appears after 10s if parsing is slow — lets user just type 3 wines they're considering)
- Low-confidence triage (same pattern as Step 2)
- Parsed dishes shown as selectable cards (checked by default)
- Cards have **subtle pale sage tint** background (distinguishes from wine cards — Gestalt: similarity)
- User unchecks dishes they don't want paired
- Manual "Add Dish" button

### Step 4: Get Pairings
- Summary bar: "Pairing 8 wines with 4 dishes"
- Optional inputs: party size (1-20), max bottles (1-10), prefer by-the-glass
- "Get Pairings" button
- Results: recommendation cards showing per-dish wine picks
- **Table wine suggestion**: best single bottle for the whole table. If all selected wines are by-the-glass, skip table bottle — instead suggest a glass-per-dish strategy (AI prompt includes this logic).
- **Deterministic fallback**: If AI times out or unavailable, show colour-matching fallback (red→meat, white→fish) with "AI unavailable — basic suggestions shown" banner
- Follow-up chat interface (reuses existing chat pattern)
- **"Start Over" button** — requires `confirm()` dialog if items have already been parsed (prevents fat-finger wipe mid-meal). Positioned away from "Next" button on mobile.

### State Persistence
Wizard state saved to `sessionStorage` with **namespaced keys** (`wineapp.restaurant.*`) to prevent collisions with cellar analysis or other features that use sessionStorage. Cleared on "Start Over" (after confirm) or switching to "From My Cellar" mode.

Navigation: Back/Next buttons (sticky bottom on mobile). Step indicator at top. Can click completed steps to go back.

---

## New Files

### Backend (4 files)

| File | Responsibility |
|------|----------------|
| `src/schemas/restaurantPairing.js` | Zod schemas with discriminated wine/dish types, size limits, payload validation |
| `src/services/menuParsing.js` | Menu extraction: prompts for wine list + dish menu, single-image Claude Vision call, per-call timeout via `createTimeoutAbort` from `fetchUtils.js`, sanitization of OCR results |
| `src/services/restaurantPairing.js` | Pairing prompt, response parsing, deterministic fallback, owner-scoped chat context |
| `src/routes/restaurantPairing.js` | 3 endpoints with rate limiting, payload size limits, chat ownership validation |

### Frontend (7 files)

| File | Responsibility |
|------|----------------|
| `public/js/restaurantPairing.js` | Main controller: wizard init, step navigation, mode toggle, Quick Pair shortcut |
| `public/js/restaurantPairing/state.js` | State with sessionStorage persistence (`wineapp.restaurant.*` keys): wines, dishes, selections, step, images. Client-side dedup/merge logic after all parse responses collected. |
| `public/js/restaurantPairing/imageCapture.js` | Multi-image capture widget (reuses `resizeImage` from `imageParsing.js`), client-side concurrency queue (2 at a time), AbortController per request for cancel-on-remove |
| `public/js/restaurantPairing/wineReview.js` | Step 2: selectable wine cards, colour/price filters, confidence triage |
| `public/js/restaurantPairing/dishReview.js` | Step 3: selectable dish cards, confidence triage |
| `public/js/restaurantPairing/results.js` | Step 4: recommendation cards, deterministic fallback, chat |
| `public/js/api/restaurantPairing.js` | API client: `parseMenu()`, `getRecommendations()`, `restaurantChat()` |

### Test Files (5 files)

| File | Tests |
|------|-------|
| `tests/unit/services/menuParsing.test.js` | Prompt building for wine list + dish menu, single-image parse, per-call timeout, OCR sanitization |
| `tests/unit/services/restaurantPairing.test.js` | Prompt building, response parsing, deterministic fallback, chat context ownership |
| `tests/unit/schemas/restaurantPairing.test.js` | Schema validation: valid/invalid inputs, payload size limits, discriminated types |
| `tests/unit/routes/restaurantPairing.test.js` | Supertest: happy paths, 413 payload >5mb, rate limiting, chat ownership 403 rejection. **Auth tests (Blocker Fix):** include `requireAuth` + `requireCellarContext` in test app for 401/403 tests (not bypassed by direct router mount). Two test app variants: one with mock auth (route logic tests), one with real middleware (auth rejection tests). |
| Update `tests/unit/utils/apiAuthHeaders.test.js` | Extend scan to `public/js/restaurantPairing/` folder |

---

## Modified Files

| File | Change |
|------|--------|
| `public/index.html` | Add mode toggle buttons + wizard container HTML inside `view-pairing` |
| `public/css/components.css` | New **namespaced** styles: `.restaurant-wizard`, `.restaurant-step`, `.restaurant-card`, `.restaurant-image-grid`, `.restaurant-price-filter`, `.restaurant-mode-toggle`, `.restaurant-triage-banner` — NO generic class reuse to avoid collisions |
| `src/server.js` | Mount restaurant-pairing router BEFORE global `express.json({ limit: '10mb' })` with its own 5mb body parser + auth middleware (see Route Mounting section) |
| `public/js/api/index.js` | Re-export from `restaurantPairing.js` |
| `public/js/app.js` | Import and call `initRestaurantPairing()` |
| `public/js/bottles/imageParsing.js` | Export `resizeImage()` (currently local function, needed by imageCapture.js) |
| `src/config/aiModels.js` | Add `menuParsing` and `restaurantPairing` task entries |
| `src/services/inputSanitizer.js` | Add `sanitizeMenuText()` and `sanitizeMenuItems()` |
| `public/sw.js` | Bump cache version, add new JS files to pre-cache |
| `tests/unit/utils/apiAuthHeaders.test.js` | Add `restaurantPairing/` to scanned folders |

---

## API Endpoints

All under `/api/restaurant-pairing`, behind `requireAuth` + `requireCellarContext` middleware.

### Route Mounting — Blocker Fix: 15mb vs global 10mb

The global `express.json({ limit: '10mb' })` at server.js:36 runs before routes. If restaurant-pairing is mounted via index.js, the body is already parsed/rejected at 10mb. Fix: mount in **server.js BEFORE the global body parser** with its own limit:

```js
// server.js — BEFORE the global express.json({ limit: '10mb' })
import restaurantPairingRoutes from './routes/restaurantPairing.js';
app.use('/api/restaurant-pairing',
  express.json({ limit: '5mb' }),   // Per-image: ~2.7MB encoded + overhead
  requireAuth, requireCellarContext,
  restaurantPairingRoutes
);

// Then the existing global parser (line 36)
app.use(express.json({ limit: '10mb' }));
```

This keeps the global 10mb limit untouched while giving restaurant-pairing its own 5mb limit (sufficient for single-image payloads).

### `POST /api/restaurant-pairing/parse-menu` — Single-Image Model

Rate limited: `strictRateLimiter()` + max 10 parse calls per `req.user.id` + `req.cellarId` per 15min (keyed by user, not just IP).

**Blocker Fix: Per-image progress/cancel** — Changed from batch (`images[]`) to **one request per image/text**. Frontend controls concurrency (2 at a time via client-side queue), cancel (AbortController per request), and progress (per-request indicator). No orphaned promises, no streaming needed.

```js
// Request — ONE image OR text per call (not an array)
{
  type: 'wine_list' | 'dish_menu',
  text: string | null,                                    // max 5000 chars (mutually exclusive with image)
  image: string | null,                                   // single base64, ≤ 2MB decoded (~2.7MB encoded)
  mediaType: string | null                                // required if image provided
}

// Response (discriminated by type) — wine_list example:
{
  items: [{
    type: 'wine',
    name: string,
    colour: string | null,
    style: string | null,
    price: number | null,
    currency: string | null,
    vintage: number | null,
    by_the_glass: boolean,
    region: string | null,
    confidence: 'high' | 'medium' | 'low'
  }],
  overall_confidence: 'high' | 'medium' | 'low',
  parse_notes: string
}

// dish_menu example:
{
  items: [{
    type: 'dish',
    name: string,
    description: string | null,
    price: number | null,
    currency: string | null,
    category: string | null,       // Starter/Main/Dessert/Side/Sharing
    confidence: 'high' | 'medium' | 'low'
  }],
  overall_confidence: 'high' | 'medium' | 'low',
  parse_notes: string
}
```

**Implementation**:
- **Single-image per request**: Backend is stateless — one Claude Vision call per request.
- **Frontend concurrency**: 2 requests at a time via client-side queue. AbortController per request for cancel-on-remove.
- **Per-image timeout**: 30s via `createTimeoutAbort()` on the backend Claude call.
- **Per-image size**: Base64 ≤ 2MB decoded. 413 if exceeded (Zod schema validates).
- **Sanitization**: Text through `sanitizeMenuText()`, OCR results through `sanitizeMenuItems()`
- **Dedup/merge**: Happens **client-side** after all parse responses collected. Composite key: `normalize(name) + vintage + by_the_glass`. Price NOT in primary key — same wine may appear at different prices on Reserve vs Standard lists. Secondary fuzzy: Jaccard(name) > 0.7 AND same vintage. Keep both if prices differ >20%; merge if within 10%.
- **Stable IDs**: Frontend assigns incrementing `id` during merge (not backend, since responses arrive separately).

### `POST /api/restaurant-pairing/recommend`

Rate limited: `strictRateLimiter()`.

```js
// Request — (Blocker Fix: added by_the_glass + id per wine)
{
  wines: [{
    id: number,                                            // stable ID from frontend merge
    name: string,
    colour: string | null,
    style: string | null,
    vintage: number | null,
    price: number | null,
    by_the_glass: boolean                                  // REQUIRED — drives glass-per-dish strategy
  }],                                                      // max 80
  dishes: [{
    id: number,
    name: string,
    description: string | null,
    category: string | null
  }],                                                      // max 20
  colour_preferences: string[],
  budget_max: number | null,
  party_size: number | null,                               // 1-20
  max_bottles: number | null,                              // 1-10
  prefer_by_glass: boolean
}

// Response
{
  table_summary: string,
  pairings: [{
    rank: number,
    dish_name: string,
    wine_id: number,                                       // references input wine ID
    wine_name: string,
    wine_colour: string,
    wine_price: number | null,
    by_the_glass: boolean,
    why: string,
    serving_tip: string,
    confidence: 'high' | 'medium' | 'low'
  }],
  table_wine: {                                            // null if ALL wines are by_the_glass
    wine_name: string,
    wine_price: number | null,
    why: string
  } | null,
  chatId: string | null,
  fallback: boolean
}
```

**Deterministic fallback** (if AI times out or unavailable): colour-match wines to dish categories (red→meat, white→fish/salad, rose→lighter dishes). Fallback also respects `budget_max` (exclude wines above budget) and `prefer_by_glass` (prioritise glass wines). Returns `fallback: true` so UI can show banner.

### `POST /api/restaurant-pairing/chat`

Rate limited: `strictRateLimiter()`.

```js
// Request
{ chatId: string, message: string }
```

**Owner-scoped context**: Stores `userId` + `cellarId` at creation. Every `/chat` call validates `req.user.id === context.userId && req.cellarId === context.cellarId`. Returns 403 on mismatch. 30-min TTL with cleanup interval using `.unref()` (won't block Node shutdown). Export `cleanupChatContexts()` helper for test teardown.

---

## Key Reuse Points

| What | From Where | How |
|------|-----------|-----|
| Image resize/compress | `public/js/bottles/imageParsing.js` → `resizeImage()` | Export (currently private fn) and import in imageCapture.js |
| Claude Vision call | `src/services/wineParsing.js` → `parseWineFromImage()` | Same pattern, new menu-specific prompts |
| Claude text parse | `src/services/wineParsing.js` → `parseWineFromText()` | Same pattern, new menu-specific prompts |
| Claude client + model | `src/services/claudeClient.js` + `src/config/aiModels.js` | Direct reuse, add `menuParsing` + `restaurantPairing` task entries |
| Chat context + TTL | `src/routes/pairing.js` → `chatContexts` Map | Same pattern BUT add `userId` + `cellarId` ownership binding |
| Input sanitization | `src/services/inputSanitizer.js` | Add `sanitizeMenuText()` + `sanitizeMenuItems()` alongside existing fns |
| Recommendation cards | `public/js/sommelier.js` → render pattern | Adapt: add price, wine_colour; remove wine_id |
| Filter chips CSS | `public/css/components.css` → `.filter-chip` | Reuse class inside `.restaurant-wizard` container |
| Rate limiter | `src/middleware/rateLimiter.js` → `strictRateLimiter()` | Apply to all 3 endpoints + custom 10/15min parse limiter |
| Zod validation | `src/middleware/validate.js` → `validateBody`/`validateQuery` | Apply to all endpoints |
| Toast notifications | `public/js/utils.js` → `showToast()` | Direct reuse |
| API base fetch | `public/js/api/base.js` → `apiFetch` | Direct reuse (automatic auth headers) |
| Timeout abort | `src/services/fetchUtils.js` → `createTimeoutAbort()` | Direct reuse for per-call 30s timeout on backend Claude call |

**NOT reusing** `.wizard-step` from components.css (line 5850) — it belongs to cellar analysis zones. Using `.restaurant-step` instead to avoid collisions.

**Challenged suggestions (not incorporating):**
- Moving `resizeImage` to `utils/image.js` — exporting one function doesn't make imageParsing.js a kitchen sink. YAGNI.
- Strategy pattern for fallback — two code paths (AI vs heuristic) don't warrant a class hierarchy. Simple if/else is clearer.
- Varietal/grape search bar — scope creep for v1. Colour + price + by-the-glass covers 90% of filtering needs. Can add in follow-up.
- Structured "Value Pick + Premium Pick" — handled via AI prompt wording ("consider suggesting options at different price points") rather than adding response schema complexity.

---

## Dependencies

**No new npm packages required.** The codebase already has everything needed:

| Need | Existing Solution | Location |
|------|------------------|----------|
| Request timeout/abort | `createTimeoutAbort(ms)` | `src/services/fetchUtils.js` |
| Image processing (server) | `sharp` (already in devDeps) | Available if needed |
| Schema validation | `zod` v4.3.6 | Already installed |
| HTTP testing | `supertest` v7.2.2 | Already installed |
| AI client | `@anthropic-ai/sdk` v0.72.1 | Already installed |
| Rate limiting | Custom middleware | `src/middleware/rateLimiter.js` |

This avoids dependency bloat and keeps the approach consistent with existing patterns.

---

## Gestalt Principles

- **Proximity**: Wine list inputs (text + photos) grouped in single bordered section. Filter controls (colour chips + price) in single row. Each wizard step is a distinct bounded region.
- **Similarity**: Selectable cards use identical component for wines AND dishes. Buttons follow existing `.btn-primary`/`.btn-secondary`. Recommendation cards reuse `.recommendation-card` pattern.
- **Continuity**: Step indicator (1→2→3→4) with connecting line. Back/Next buttons create predictable linear flow.
- **Closure**: Each step enclosed in bordered container. Step numbers in circles. Filter sections have clear headers.
- **Figure-Ground**: Active step is visible; others hidden. Selected cards are prominent; deselected cards are dimmed (opacity + strikethrough).

---

## Mobile Priorities

- Camera button uses `capture="environment"` for direct photo access
- Sticky Back/Next nav bar at bottom of viewport
- Touch targets 44px minimum
- Step indicator: numbers only on mobile (no labels)
- Image grid: 2 columns on mobile
- Aggressive image compression (existing resizeImage pipeline)
- Loading states with spinners (mobile networks may be slow)

---

## Implementation Order

**Phase A: Backend Safety First** (schemas → services → route → tests)

1. ~~**Schemas** — `src/schemas/restaurantPairing.js`~~ ✅ Done. Zod schemas for parse-menu, recommend, chat. Request + response schemas. Reviewed: fixed base64 limit formula, chatId→UUID, whitespace-only text, exported `MAX_IMAGE_BASE64_CHARS` for route-level 413 mapping.
2. ~~**Input sanitizer** — Add `sanitizeMenuText()` + `sanitizeMenuItems()` to `src/services/inputSanitizer.js`~~ ✅ Done. Uses `allowMarkdown: true` to preserve currency symbols ($). `sanitizeMenuField()` helper with `typeof` guards for non-string passthrough. Reviewed: fixed `$→S` corruption, type guard safety.
3. ~~**AI model config** — Add `menuParsing` + `restaurantPairing` entries to `src/config/aiModels.js`~~ ✅ Done. Both → Sonnet 4.5. Bonus: added startup validation (TASK_MODELS→MODELS), invalid env override warnings, 27 unit tests in `tests/unit/config/aiModels.test.js`.
4. ~~**Menu parsing service** — `src/services/menuParsing.js`~~ ✅ Done. Single-image parse via Claude Vision, per-call 30s timeout via `createTimeoutAbort`, OCR sanitization via `sanitizeMenuItems`. Separate prompts for wine_list vs dish_menu with structured JSON output.
5. ~~**Restaurant pairing service** — `src/services/restaurantPairing.js`~~ ✅ Done. Prompt building with budget/glass/party constraints, deterministic fallback with `constraintsOverridden` flag, owner-scoped chat context (userId+cellarId binding), 30-min TTL with `.unref()` cleanup, `CHAT_ERRORS` constants for explicit error codes.
6. ~~**Route + registration** — `src/routes/restaurantPairing.js`~~ ✅ Done. 3 endpoints with `strictRateLimiter` + custom user+cellar keyed parse limiter (10/15min). Mounted in `server.js` BEFORE global body parser with own 5mb limit. Reviewed: extracted `rejectOversizedImage` pre-validation middleware, added `metricsMiddleware()` to mount chain, path-scoped 413 error handler, exception comment in `routes/index.js`.

**Phase B: Backend Tests** (validates safety before frontend)

7. ~~**Schema tests** — `tests/unit/schemas/restaurantPairing.test.js`~~ ✅ Done. 127 tests covering exported constants, parseMenuSchema (mutual exclusion refinements, image boundary), recommendSchema (strict numeric typing — no string coercion), restaurantChatSchema (trim-before-min ordering fix), all response schemas. Reviewed: tightened response chatId to `.uuid()`, added boundary/tolerance/numeric rejection tests.
8. ~~**Service tests** — `tests/unit/services/menuParsing.test.js` + `tests/unit/services/restaurantPairing.test.js`~~ ✅ Done. 95 tests (37 + 58). menuParsing: prompt building for wine_list/dish_menu, Claude API integration (model, signal, timeout), JSON extraction (code fences, raw, invalid), schema validation + best-effort fallback, sanitization integration, type discriminator injection, cleanup-always. restaurantPairing: CHAT_ERRORS constants, getChatContext ownership (NOT_FOUND, FORBIDDEN), getRecommendations AI path (prompt building with constraints, response validation, best-effort), deterministic fallback (colour matching for 6 dish types, budget/colour/glass constraint filtering, constraintsOverridden path, table wine selection), continueChat (explanation vs recommendations types, wine_id filtering, chat history accumulation, TTL refresh, prior history in messages).
9. **Route tests** — `tests/unit/routes/restaurantPairing.test.js` (supertest: happy paths, 413, rate limiting, chat ownership 403. Auth tests: two test app variants — mock auth for logic, real middleware for 401/403 rejection.)
10. **Auth scan** — Update `tests/unit/utils/apiAuthHeaders.test.js` to scan `restaurantPairing/` folder
11. **Run `npm run test:unit`** — All existing + new tests pass before touching frontend

**Phase C: Frontend Foundation**

12. **Export resizeImage** — Update `public/js/bottles/imageParsing.js` (export currently private fn)
13. **Frontend API client** — `public/js/api/restaurantPairing.js` + update `public/js/api/index.js` barrel
14. **Frontend state** — `public/js/restaurantPairing/state.js` (sessionStorage persistence)

**Phase D: Frontend UI**

15. **Image capture widget** — `public/js/restaurantPairing/imageCapture.js`
16. **Wine review UI** — `public/js/restaurantPairing/wineReview.js` (selectable cards, colour/price/glass filters, triage)
17. **Dish review UI** — `public/js/restaurantPairing/dishReview.js` (selectable cards, triage)
18. **Results + chat UI** — `public/js/restaurantPairing/results.js` (recommendation cards, fallback banner, chat)
19. **Main controller** — `public/js/restaurantPairing.js` (wizard init, step nav, mode toggle, Quick Pair)

**Phase E: Integration**

20. **HTML + CSS** — Update `index.html` (mode toggle + wizard inside `view-pairing`), `components.css` (namespaced `.restaurant-*` classes)
21. **App init + cache** — Update `app.js` (import + call `initRestaurantPairing()`), `sw.js` (bump cache, pre-cache new JS)
22. **Final test run** — `npm run test:unit` — all pass

---

## Verification

### Automated (must pass before merge)

1. `npm run test:unit` — all existing + new tests pass
2. Schema tests: valid/invalid inputs, payload size limits, discriminated type validation
3. Service tests: prompt building (wine_list/dish_menu), per-call timeout (30s), JSON extraction + schema validation + best-effort fallback, deterministic colour-matching fallback, chat context ownership. (Note: bounded concurrency and composite dedup are frontend responsibilities — tested in Phase D.)
4. Route tests (supertest): happy paths, 413 payload >5mb, chat ownership 403. Auth tests use real `requireAuth` + `requireCellarContext` middleware in test app (not bypassed by direct mount) — verify 401 without token, 403 without cellar context
5. Auth scan: `apiAuthHeaders.test.js` scans `restaurantPairing/` folder — no raw `fetch('/api/...')` calls

### Manual

6. Open "Find Pairing" tab → toggle "At a Restaurant" → verify existing sommelier hidden, wizard shown
7. Quick Pair: upload 1 photo + type dishes → verify goes straight to recommendations → confidence warning if OCR low → "Refine" loads full wizard
8. Upload 2 wine list photos → verify per-image progress, parsed wines appear as selectable cards with confidence badges and **pale burgundy tint**
9. Low-confidence triage: verify banner appears, uncertain items highlighted, price field has `inputmode="decimal"` on mobile
10. Slow parsing: wait 10s → verify "Skip to Manual" button appears
11. Remove image while parsing → verify request cancelled (no orphaned spinner)
12. Apply colour filter + price range + by-the-glass toggle → verify cards hide/show, checked state preserved
13. Counter: "N of M wines selected" reflects checked AND visible count
14. Type dish descriptions → verify parsed dishes with categories and **pale sage tint**
15. Uncheck some wines/dishes → "Get Pairings" sends only selected items
16. By-the-glass only selection → verify AI suggests glass-per-dish strategy (no table bottle)
17. Verify recommendation cards show per-dish pairings + table wine suggestion + prices
18. Deterministic fallback: disable AI → verify colour-matching results with "AI unavailable" banner
19. Follow-up chat ("What about a lighter option?") → verify owner-scoped context
20. "Start Over" → verify confirm dialog appears → confirm → verify state cleared, `wineapp.restaurant.*` keys removed from sessionStorage
21. Mobile (480px viewport): sticky nav, camera access, 44px touch targets, 2-column image grid, Start Over positioned away from Next
22. App switch on mobile: navigate away and back → verify wizard state restored from sessionStorage
23. Multi-menu test: upload Reserve List + Standard List photos with same wine at different prices → verify both entries preserved (not deduped)
