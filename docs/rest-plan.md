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
- Multi-image upload (file picker + camera button, up to 4 photos — reduced from 5 to stay within 10-call/15min parse budget)
- Image thumbnails grid with remove (X) buttons
- "Analyze" button → sends all inputs to backend
- Per-image progress indicator (bounded concurrency: 2 at a time, not all 4)
- **"Skip to Manual"** button visible immediately — lets user skip capture and add wines manually in Step 2
- Removing an image while in-flight cancels its request via `AbortController` (save battery/data)

### Step 2: Review & Filter Wines
- **Low-confidence triage first**: If any items have `confidence: 'low'`, show triage banner: "Review N uncertain items" — highlights them with warning styling. User can edit inline or remove. Price fields use `inputmode="decimal"` for fast 3-second mobile corrections (most common OCR error: bin number mistaken for price).
- All parsed wines shown as selectable cards (checked by default)
- Cards have **subtle pale burgundy tint** background (distinguishes from dish cards at a glance — Gestalt: similarity)
- User unchecks wines to exclude
- **Colour filter chips** (multi-select): Red, White, Rose, Sparkling — filters hide non-matching cards but **do not change** their checked state
- **Max price input** (derived from parsed prices) — hides wines above price
- **By-the-glass toggle**: Filter to only by-the-glass wines
- Counter: "8 selected (5 visible)" — two numbers to clarify that **filters are visual aids only**. Payload always uses `getSelectedWines()` regardless of filter state.
- "Select All Visible" / "Deselect All Visible" toggle
- Manual "Add Wine" button for anything parsing missed

### Step 3: Capture & Review Dishes
- Text area for typing dish descriptions (one per line)
- Multi-image upload (same component as Step 1, up to 4 photos, shares parse budget)
- "Analyze" button (+ **"Skip to Manual"** button visible immediately — lets user add dishes manually)
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
Wizard state saved to `sessionStorage` with **namespaced keys** (`wineapp.restaurant.*`) to prevent collisions with cellar analysis or other features that use sessionStorage. Cleared on "Start Over" (after confirm dialog). **Switching to "From My Cellar" mode preserves state** — user might switch back; "Start Over" exists for intentional clearing.

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
9. ~~**Route tests** — `tests/unit/routes/restaurantPairing.test.js`~~ ✅ Done. 39 tests via supertest. Three endpoint suites: /parse-menu (text+image happy paths, dish_menu type, 5 Zod validations including mutual-exclusion refinements, rejectOversizedImage 413, service error 500), /recommend (happy path with arg forwarding, Zod defaults verification, 5 validation rejections, service error), /chat (happy path, 503 API-key guard, CHAT_ERRORS.NOT_FOUND→404 and FORBIDDEN→403, non-chat error re-throw, 3 Zod validations). Rate limiter wiring: strictRateLimiter×3, createRateLimiter config (10/15min, user+cellar key, anon fallback). Middleware integration: real requireAuth→401 without Bearer, real requireCellarContext→400 no active cellar + 403 non-member, server-mount body-parser 413 normalizer contract.
10. ~~**Auth scan** — Update `tests/unit/utils/apiAuthHeaders.test.js` to scan `restaurantPairing/` folder~~ ✅ Done. Added scan test following `cellarAnalysis/` pattern. Directory guard (`fs.existsSync`) skips gracefully until Phase C creates the folder.
11. ~~**Run `npm run test:unit`** — All existing + new tests pass before touching frontend~~ ✅ Done. 1406 tests passing (46 test files). Phase B complete.

**Phase C: Frontend Foundation**

12. ~~**Export resizeImage** — Update `public/js/bottles/imageParsing.js` (export currently private fn)~~ ✅ Done. Added `export` keyword to `resizeImage()`. No other changes needed — function signature and behaviour unchanged.
13. ~~**Frontend API client** — `public/js/api/restaurantPairing.js` + update `public/js/api/index.js` barrel~~ ✅ Done. Three functions: `parseMenu(payload, signal)` with AbortSignal support for cancel-on-remove, `getRecommendations(payload)`, `restaurantChat(chatId, message)`. All use `apiFetch` from `base.js` (automatic auth headers). Barrel re-export added to `api/index.js`.
14. ~~**Frontend state** — `public/js/restaurantPairing/state.js` (sessionStorage persistence)~~ ✅ Done. Full sessionStorage persistence with `wineapp.restaurant.*` namespaced keys. Features: step tracking (1-4), wine/dish merge with dedup (composite key: `normalize(name)+vintage+by_the_glass`), secondary fuzzy match (Jaccard > 0.7 + same vintage), price divergence guard (>20% keeps both entries), selection state (per-item checked/unchecked), results + chatId persistence, `clearState()` for Start Over, `hasData()` for confirm guard. Stable incrementing IDs assigned client-side during merge.

**Phase C Audit Round 1** ✅ All 5 findings addressed:
- *Medium*: Corrupted sessionStorage shape guard — `load()` validates arrays via `Array.isArray()` check before returning parsed value.
- *Medium*: 54 unit tests added (`tests/unit/restaurantPairing/state.test.js`) — covers dedup/merge, fuzzy match, persistence, corrupted storage recovery, selection state, input immutability.
- *Low-Medium*: `setStep()` now clamps to 1-4 via `Math.max(1, Math.min(4, Number(step) || 1))`.
- *Low-Medium*: `mergeWines()`, `mergeDishes()`, `addWine()`, `addDish()` now shallow-clone input objects before mutation (`{ ...raw }`).
- *Low*: `clearState()` storage loop wrapped in try/catch consistent with other storage helpers.

**Phase C Audit Round 2** ✅ All 3 findings addressed (1468 tests passing):
- *Medium*: `load()` now validates object and number fallbacks too — corrupted `selections` (string/array/null) no longer crashes `setWineSelected()`.
- *Low-Medium*: Step clamped at load time (`Math.max(1, Math.min(4, ...))`) — persisted `"banana"` or `999` recovers to valid range on reload.
- *Low*: 8 new corruption recovery tests added — selections (string/array/null), step (string/object/out-of-range), results, chatId. Total: 62 state tests.

**Phase D: Frontend UI** (detailed plan: `C:\Users\User\.claude\plans\melodic-whistling-map.md`)

**Phase D Pre-requisites:**
- Add `jsdom` devDependency (per-file `// @vitest-environment jsdom` for DOM tests)
- Add `invalidateResults()` to state.js — clears results + chatId when selections change
- Add invalidation tests to state.test.js

**Phase D Audit Findings Incorporated (2 rounds, 15 findings + 3 open questions resolved):**
- *High*: dishReview.js owns ALL of Step 3 (capture + review). Controller just calls `renderDishReview(container)`.
- *High*: Filters are visual aids only. Counter: "N selected (M visible)". Payload = `getSelectedWines()`/`getSelectedDishes()` regardless of filter state.
- *High*: 5 test files (all modules). jsdom + vi.fn() mocks.
- *High*: Pre-flight validation in `requestRecommendations()` enforces backend caps (wines ≤ 80, dishes ≤ 20). Blocking toast if over.
- *High*: Parse budget tracker in imageCapture — `maxImages` reduced to 4/step, shared `parseBudget` object tracks cross-step usage (10 req/15min). Disable Analyze when exhausted.
- *High*: Chat gated on `chatId !== null`. Fallback shows explanatory line, no disabled chat UI.
- *Medium*: Quick Pair extracted to `runQuickPairFlow()` helper. Calls `requestRecommendations()` directly (not synthetic DOM clicks).
- *Medium*: Lifecycle contract: `renderStep(n)` is sole caller of `destroy*()`. Each module tracks own listeners/timers/AbortControllers.
- *Medium*: `invalidateResults()` called from selection/merge mutations. Step 4 shows fresh "Get Pairings" after invalidation.
- *Medium*: Accessibility: `aria-live`, `role="checkbox"`, `aria-label`, `role="alert"`. Selected state: checkmark + sr-only text. Filter chips show count.
- *Medium*: Doc consistency fixed: counter = "N selected (M visible)", mode switch = persist state.
- *Low*: Client-side limits mirror backend: `maxlength="5000"` (parse text), `maxlength="2000"` (chat), char counters.
- *Open Q*: Step 1→2 always allowed (manual-only flow). "Skip to Manual" visible immediately.
- *Open Q*: Mode switch preserves state (not clear). "Start Over" for intentional clearing.
- *Open Q*: Fallback: hide chat, show explanatory line.

**Phase D Implementation Clusters** (execute sequentially, **stop after each cluster for audit review**):

Full Phase D specification: `C:\Users\User\.claude\plans\melodic-whistling-map.md`

**Cluster 1: Pre-requisites + imageCapture (D.0 + D.1)** — Medium risk

| Step | Task | Files |
|------|------|-------|
| D.0 | Pre-requisites | `npm install --save-dev jsdom`, edit `state.js` (add `invalidateResults()`), edit `state.test.js` (add invalidation tests) |
| D.1 | imageCapture source + tests | `public/js/restaurantPairing/imageCapture.js` + `tests/unit/restaurantPairing/imageCapture.test.js` |

Safe together: Pre-reqs are small state.js additions. imageCapture has zero dependencies on other Phase D files — self-contained widget using only the API client and `resizeImage()`.
Run: `npm run test:unit` — all 1468+ existing tests pass + ~15 new tests.
Audit focus: `invalidateResults()` integration, parse budget logic (shared `parseBudget` object, 10 req/15min), concurrency queue (max 2 concurrent), AbortController cleanup, 429 handling.

**Cluster 1 Done** ✅ (1515 tests passing):
- D.0: `invalidateResults()` added to state.js, integrated into all 10 mutation functions. 15 invalidation tests in state.test.js (including removeWine/removeDish).
- D.1: `imageCapture.js` (385 lines) — full widget with text area, multi-image upload, concurrency queue (max 2), AbortController per request, parse budget, 429 handling, destroy lifecycle. 34 tests in imageCapture.test.js.
- Audit round 1 — all 5 findings addressed:
  1. **High**: `destroyed` flag guards `scheduleNext()` — queued requests won't start after `destroy()`.
  2. **High**: Queue checks `images.some(img => img.id === req.imageId)` before starting — removed images are skipped.
  3. **Medium**: `removeWine()` and `removeDish()` now call `invalidateResults()`.
  4. **Medium**: Removed `updateStatus('')` from `handleAnalyze` finally block — `updateAnalyzeState()` preserves budget counter.
  5. **Low**: `imageListeners[]` array tracks per-render image-button listeners, cleaned up in `renderImages()` and `destroy()`.

**Cluster 2: wineReview + dishReview (D.2 + D.3)** — Medium risk

| Step | Task | Files |
|------|------|-------|
| D.2 | wineReview source + tests | `public/js/restaurantPairing/wineReview.js` + `tests/unit/restaurantPairing/wineReview.test.js` |
| D.3 | dishReview source + tests | `public/js/restaurantPairing/dishReview.js` + `tests/unit/restaurantPairing/dishReview.test.js` |

Safe together: Both are selectable-card modules with the same render-from-state pattern. dishReview depends on imageCapture (Cluster 1) but not on wineReview — they're peer modules.
Run: `npm run test:unit` — all prior tests pass + ~20 new tests.
Audit focus: Filter ≠ selection invariant (filters are visual aids, payload unchanged), counter semantics ("N selected (M visible)"), `invalidateResults()` called on all mutations, accessibility (`role="checkbox"`, `aria-checked`, `aria-live`). dishReview owns entire Step 3 (capture + review cards).

**Cluster 2 Done** ✅ (1577 tests passing):
- D.2: `wineReview.js` — selectable wine cards with colour/price/BTG filters, triage banner, "N selected (M visible)" counter, select-all-visible toggle, manual add wine form, remove wine. 38 tests in wineReview.test.js.
- D.3: `dishReview.js` — owns entire Step 3 (Section A: dish capture via `createImageCapture`, Section B: dish review cards). Triage banner, "N of M dishes selected" counter, manual add dish, remove dish. 24 tests in dishReview.test.js.
- Audit round 1 — all 6 findings addressed:
  1. **High**: XSS — all user/model text now escaped via `escapeHtml()` in innerHTML (wine.name, dish.name, dish.description, wine.colour, etc.).
  2. **High**: Rosé filter — COLOURS changed to `{value, label}` objects; `data-colour` uses backend canonical `rose`; filter comparison uses lowercase. Chip displays `Rosé` but matches `rose`.
  3. **Medium**: Dish categories — changed `Shared` to `Sharing` matching backend `DISH_CATEGORIES`; dropdown values now title-case (matching schema exactly).
  4. **Medium**: Keyboard operability — added `keydown` handlers for Space/Enter on all `role="checkbox"` cards in both modules; inline price input excluded from toggle.
  5. **Medium**: Low-confidence inline price edit — low-confidence wine cards render `<input type="number" inputmode="decimal">` instead of read-only price text; change handler updates wine object in-memory.
  6. **Low**: Listener cleanup — separated `chipListeners` from `cardListeners` in wineReview (chips live independently of card re-renders); `cardListeners` cleaned before each re-render in both modules; all cleaned on destroy.

**Cluster 3: results (D.4)** — High risk, implement alone

| Step | Task | Files |
|------|------|-------|
| D.4 | results source + tests | `public/js/restaurantPairing/results.js` + `tests/unit/restaurantPairing/results.test.js` |

Alone because: Pre-flight cap validation (wines ≤ 80, dishes ≤ 20), API integration, fallback/chat gating on `chatId !== null`, exports `requestRecommendations()` for Quick Pair. Getting this wrong means 400s or broken chat.
Run: `npm run test:unit` — all prior tests pass + ~14 new tests.
Audit focus: Pre-flight caps block oversized payloads, chat gated on `chatId !== null` (fallback = explanatory line, no chat UI), `requestRecommendations()` callable standalone, invalidated state → fresh "Get Pairings", `maxlength="2000"` on chat input.

**Cluster 3 Done** ✅ (1598 tests passing):
- D.4: `results.js` — Step 4 results module. Summary bar with wine/dish counts and over-cap warnings. Optional inputs (party size, max bottles, prefer BTG). Pre-flight validation blocks payloads exceeding MAX_WINES=80 / MAX_DISHES=20. "Get Pairings" button calls `getRecommendations()` API with loading state (button disabled + spinner). Result cards render per-dish pairings with flat fields matching backend contract (`wine_name`, `wine_colour`, `wine_price`, `by_the_glass`). Table wine suggestion rendered from object `{ wine_name, wine_price, why }`. Fallback banner (`role="alert"`) when `fallback: true`. Chat interface gated on `chatId !== null` — renders full chat UI (messages, input `maxlength="2000"` + char counter, send button, 3 suggestion buttons) when chatId exists; shows "Follow-up chat is not available for basic suggestions." when null. `requestRecommendations()` exported for Quick Pair direct invocation. Invalidated state renders fresh "Get Pairings" UI with no stale cards. 21 tests in results.test.js covering: summary counts (3), pre-flight caps (2), API call + payload (3), result cards (2), fallback banner (2), chat rendering/hiding (5), loading state (1), direct invocation (1), invalidated state (1), destroy (1).
- Audit round 1 — all 4 findings addressed:
  1. **High**: API shape mismatch — result cards now read flat fields (`p.wine_name`, `p.wine_colour`, `p.wine_price`, `p.by_the_glass`) matching `pairingItemSchema`; `table_wine` rendered as object `{ wine_name, wine_price, why }` matching `tableWineSchema`.
  2. **High**: chatId never cleared — `setChatId(data.chatId ?? null)` now always called, clearing stale chat context on fallback responses.
  3. **Medium**: Test fixture contract mismatch — `mockPairingsResponse` updated to include `rank`, `wine_id`, flat `wine_name`/`wine_colour`/`wine_price`/`by_the_glass` fields, `table_summary`, and object `table_wine` matching `recommendResponseSchema`. Added test verifying `setChatId(null)` called on fallback.
  4. **Low**: Double-escaping — assistant chat messages now pass raw text to `appendChatMessage()` which uses `textContent` (safe, no escaping needed). Error messages still use `isHtml=true` path with `escapeHtml` for the error string.

**Cluster 4: main controller (D.5)** — High risk, implement alone

| Step | Task | Files |
|------|------|-------|
| D.5 | controller source + tests | `public/js/restaurantPairing.js` + `tests/unit/restaurantPairing/restaurantPairing.test.js` |

Alone because: Orchestrator — wires all 4 modules, manages lifecycle (`destroyCurrentStep` before each render), navigation guards, Quick Pair flow, state restoration. If lifecycle contract is wrong, all steps leak listeners.
Run: `npm run test:unit` — all prior tests pass + ~12 new tests. Full Phase D: ~55 new tests total.
Audit focus: Destroy-before-render lifecycle (no leaked listeners), nav guards (Step 1→2 always allowed, Step 2→3 needs ≥1 wine, Step 3→4 needs ≥1 dish), Quick Pair direct invocation (`runQuickPairFlow` → `requestRecommendations`), parse budget reset on Start Over, mode toggle preserves state.

**Cluster 4 Done** ✅ (1630 tests passing):
- D.5: `restaurantPairing.js` — Main controller orchestrating 4-step wizard. Exports `initRestaurantPairing()`, `destroyRestaurantPairing()`, and `runQuickPairFlow(wineItems, dishItems)`. Internal state: `currentStepDestroy`, `parseBudget = { used: 0 }`, `listeners[]`, `wizardContainer`. `renderStep(n)` lifecycle: `destroyCurrentStep()` → `setStep(n)` → clear container → call step module → set destroy fn → `updateStepIndicator(n)` + `updateNavButtons(n)`. Navigation guards: Step 1→2 always allowed, Step 2→3 blocked if no wines (toast), Step 3→4 blocked if no dishes (toast). `handleStartOver()` with confirm dialog → `clearState()` → reset `parseBudget.used` → `renderStep(1)`. Quick Pair: `mergeWines` + `mergeDishes` + `renderStep(4)` + `requestRecommendations()` with try/catch error handling. Mode toggle: `setMode('cellar'|'restaurant')` shows/hides cellar sections vs wizard, updates toggle button `aria-selected`. State restoration: if `getStep() > 1 && hasData()` → `renderStep(savedStep)`, else `renderStep(1)`. Step indicator: clickable completed steps, active/completed CSS classes, `aria-current="step"`. `destroyRestaurantPairing()` exported for cleanup — calls `destroyCurrentStep()`, drains `listeners[]`, nullifies `wizardContainer`. Re-init safe: init calls destroy first to prevent listener leaks. 27 tests in restaurantPairing.test.js covering: init (2), state restoration (2), mode toggle (2), step rendering lifecycle (2), navigation guards (5), quick pair (1), start over (4), step indicator (4), Step 1 onAnalyze callback (1), cleanup/re-init (3).
- Audit round 1 — all 5 findings addressed:
  1. **Medium**: Listener leak on re-init — `initRestaurantPairing()` now calls `destroyRestaurantPairing()` at start to clean up previous listeners before re-binding.
  2. **Medium**: No cleanup export — `destroyRestaurantPairing()` exported and implemented. Calls `destroyCurrentStep()`, drains event listeners, nullifies container.
  3. **Low**: `handleStartOver` async without catch — wrapped in `.catch()` with console.error + toast on error.
  4. **Low**: Quick Pair error not surfaced — `runQuickPairFlow()` now has try/catch with toast, re-throws for caller handling.
  5. **Info**: Test coverage gap — added test for Start Over when `hasData()=false` (skips confirm), plus 3 re-init/cleanup tests. Total: 27 tests (up from 23).
- Phase D complete: 145 new frontend tests across 5 files (imageCapture 34, wineReview 39, dishReview 24, results 21, controller 27). Ready for Phase E integration.

| Cluster | Steps | ~Tests | Risk | Gate |
|---------|-------|--------|------|------|
| 1 | D.0 + D.1 (pre-reqs + imageCapture) | ~15 | Medium | Audit before Cluster 2 |
| 2 | D.2 + D.3 (wineReview + dishReview) | ~20 | Medium | Audit before Cluster 3 |
| 3 | D.4 (results) | ~14 | High | Audit before Cluster 4 |
| 4 | D.5 (controller) | ~12 | High | Audit before Phase E |

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
4. Route tests (supertest): happy paths for all 3 endpoints, 413 rejectOversizedImage, chat ownership 404/403 via CHAT_ERRORS, 503 API-key guard, Zod validation rejections (mutual exclusion, UUID, max-length), rate limiter wiring verification (strict×3, parse config), real requireAuth→401 without Bearer token
5. Auth scan: `apiAuthHeaders.test.js` scans `restaurantPairing/` folder — no raw `fetch('/api/...')` calls

### Manual

6. Open "Find Pairing" tab → toggle "At a Restaurant" → verify existing sommelier hidden, wizard shown
7. Quick Pair: upload 1 photo + type dishes → verify goes straight to recommendations → confidence warning if OCR low → "Refine" loads full wizard
8. Upload 2 wine list photos → verify per-image progress, parsed wines appear as selectable cards with confidence badges and **pale burgundy tint**
9. Low-confidence triage: verify banner appears, uncertain items highlighted, price field has `inputmode="decimal"` on mobile
10. "Skip to Manual" button: verify visible immediately (no 10s delay)
11. Remove image while parsing → verify request cancelled (no orphaned spinner)
12. Apply colour filter + price range + by-the-glass toggle → verify cards hide/show, checked state preserved
13. Counter: "N selected (M visible)" — verify both numbers present, filters don't affect payload
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
24. Selection cap: select 81+ wines → "Get Pairings" → verify blocking toast, API not called
25. Parse budget: use 10 parses → verify Analyze disabled, "Parse limit reached" toast, "add items manually" guidance
26. Fallback chat: disable AI → get pairings → verify "Follow-up chat not available" text, no chat input rendered
27. Result invalidation: get pairings → go back → change wine selection → return to Step 4 → verify stale results cleared, fresh "Get Pairings" shown
28. Mode switch preservation: switch to "From My Cellar" → switch back → verify restaurant wizard state intact
