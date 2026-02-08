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

**Phase E: Restaurant Pairing Integration**

Phase D is complete — 5 JS modules (controller + 4 step modules) with 145 tests, all passing (1630 total). But the feature is invisible: no HTML container exists, no CSS styles exist, the controller isn't initialized in app.js, and the service worker doesn't cache the new files. Phase E wires everything together.

**Execution strategy: two-cluster pass with light audit between.**

All 5 file edits are _edit-time independent_ (no file's content depends on another's output), but they are _runtime coupled_ — the wizard requires HTML structure, CSS styles, app.js init, and SW caching to all be correct. A light clustering catches issues earlier:

| Cluster | Files | Audit |
|---------|-------|-------|
| **1 — Visual** | `variables.css`, `index.html`, `components.css` | Open browser → verify toggle renders, wizard container exists, styles applied, no nesting errors |
| **2 — Functional** | `app.js`, `sw.js` | `npm run test:all` → toggle mode → verify wizard initialises, SW caches updated |

If time-constrained, a single pass with one audit at the end is acceptable since each edit is self-contained. No new JS logic — just HTML structure, CSS styling, an import/call, and a cache bump.

### Quick Pair UI — Explicitly Deferred

The rest-plan specifies a Quick Pair shortcut. The controller exports `runQuickPairFlow(wineItems, dishItems)` (ready to wire). However, Quick Pair needs its own mini-UI (photo + text input → parse calls → invoke flow) which is non-trivial to build and test. **Deferred to Phase F** to keep Phase E scope clean. The full 4-step wizard is the primary v1 UX; Quick Pair is a speed optimization for returning users.

Manual verification item 7 (Quick Pair) is moved to Phase F verification.

### Prerequisite: Fix stray `</div>` nesting in index.html

**CRITICAL**: Lines 386-387 of `public/index.html` have an extra `</div>` inside `view-pairing`:

```html
      </div>        ← closes .modal.modal-sm
    </div>          ← closes .modal-overlay#pairing-feedback-modal
    </div>          ← STRAY — prematurely closes view-pairing ⚠️

  </div>            ← intended close for #view-pairing
```

This stray tag must be **removed** before wrapping cellar content in `.pairing-cellar-section`. Otherwise the wrapper div gets closed prematurely and the feedback modal escapes the view container. Fix: delete line 387 so the indented `</div>` at line 389 properly closes `#view-pairing`.

### Files Modified (5 files)

| File | Change | ~Lines |
|------|--------|--------|
| `public/css/variables.css` | Add `--red-wine-rgb` and `--sage-green-rgb` RGB helpers in `:root` block | ~2 |
| `public/index.html` | Fix stray `</div>`, add mode toggle + wizard container inside `view-pairing`, wrap existing cellar content in `.pairing-cellar-section`, bump CSS version | ~20 |
| `public/css/components.css` | Append ~500 lines of `.restaurant-*` namespaced styles | ~500 |
| `public/js/app.js` | Import + call `initRestaurantPairing()` in `startAuthenticatedApp()` | ~3 |
| `public/sw.js` | Increment `CACHE_VERSION`, add restaurant pairing JS + all `api/*.js` sub-modules to `STATIC_ASSETS`, bump CSS version query | ~25 |

No new files created. No existing JS logic changed. No backend changes.

---

### E.1 HTML Changes (`public/index.html`)

**Current structure** (lines 303–389):

```html
<div id="view-pairing">
  <div class="natural-pairing">...</div>        ← sommelier
  <div id="sommelier-results"></div>
  <hr class="section-divider">
  <div class="pairing-form">...</div>            ← manual signal pairing
  <h3>Suggestions</h3>
  <div id="pairing-results">...</div>
  <div id="pairing-feedback-modal">...</div>     ← modal
  </div>                                         ← STRAY — remove this
</div>
```

**New structure**:

```html
<div id="view-pairing">
  <!-- Mode Toggle (new) — proper tablist for accessibility -->
  <div class="restaurant-mode-toggle form-toggle" role="tablist"
       aria-label="Pairing mode">
    <button class="toggle-btn active" data-mode="cellar" type="button"
            id="tab-cellar" role="tab" aria-selected="true"
            aria-controls="pairing-cellar-section">From My Cellar</button>
    <button class="toggle-btn" data-mode="restaurant" type="button"
            id="tab-restaurant" role="tab" aria-selected="false"
            aria-controls="restaurant-wizard">At a Restaurant</button>
  </div>

  <!-- Cellar Mode (existing content, wrapped) -->
  <div class="pairing-cellar-section" id="pairing-cellar-section" role="tabpanel"
       aria-labelledby="tab-cellar">
    <div class="natural-pairing">...</div>         ← existing, untouched
    <div id="sommelier-results"></div>              ← existing
    <hr class="section-divider">
    <div class="pairing-form">...</div>             ← existing
    <h3>Suggestions</h3>
    <div id="pairing-results">...</div>             ← existing
  </div>

  <!-- Restaurant Mode (new — hidden by default) -->
  <div class="restaurant-wizard" id="restaurant-wizard" role="tabpanel"
       aria-labelledby="tab-restaurant" style="display: none;"></div>

  <!-- Feedback Modal (shared, outside both sections) -->
  <div id="pairing-feedback-modal">...</div>        ← existing, untouched
</div>
```

**Key decisions**:

- Mode toggle uses existing `.form-toggle` + `.toggle-btn` pattern (proven, accessible)
- **Proper tablist/tab/tabpanel roles** — fixes `aria-selected` semantic (only valid on `role="tab"` elements). `aria-controls` links tabs to their panels. `aria-labelledby` on each tabpanel references the controlling tab's `id` for full screen-reader context.
- Tab buttons get explicit `id="tab-cellar"` / `id="tab-restaurant"` so tabpanels can reference them via `aria-labelledby`.
- Existing cellar content wrapped in `.pairing-cellar-section` div with `id` for `aria-controls` linkage. Controller shows/hides via `style.display`.
- `.restaurant-wizard` gets `id="restaurant-wizard"` for `aria-controls`. Starts hidden — controller populates on init.
- Feedback modal stays **outside** both tabpanels (shared resource, unaffected by mode toggle).
- Stray `</div>` at line 387 removed — nesting validated before and after edit.
- No changes to existing element IDs or classes — backward compatible.

**Cache version bump**: Update `styles.css?v=20260207a` → `styles.css?v=20260208a` in the `<link>` tag (line 33). Required because `components.css` is `@import`ed inside `styles.css` — bumping the parent ensures browsers re-fetch the chain.

**Nesting audit checklist** (execute before/after edit):
1. Count `<div` opens inside `#view-pairing`
2. Count `</div>` closes inside `#view-pairing`
3. Verify counts match
4. Verify `.pairing-cellar-section` wrapper open/close pair encloses exactly the cellar content
5. Verify feedback modal is between close of `.restaurant-wizard` and close of `#view-pairing`

---

### E.2 CSS Architecture (`public/css/components.css`)

All styles appended at end of file (after line 7208). All namespaced `.restaurant-*`. ~500 lines total.

#### E.2.0 New CSS Variables (`public/css/variables.css`)

Before writing restaurant CSS, add RGB helpers for theme-responsive card tints:

```css
/* Restaurant pairing card tints — add after existing RGB helpers */
--red-wine-rgb: 114, 47, 55;       /* matches --red-wine: #722F37 */
--sage-green-rgb: 76, 175, 80;     /* for dish card tint */
```

These go in the `:root` block of `variables.css` (after line ~143, near existing RGB helpers). This ensures card tints respond to theme changes instead of using hardcoded values.

**Theme validation**: All referenced variables (`--bg-card`, `--bg-slot`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-rgb`, `--color-warning`, `--color-warning-bg`, `--color-error`, `--color-error-bg`, `--font-md`, `--font-sm`, `--font-xs`, `--font-2xs`, `--font-base`) confirmed present in both dark and light themes.

#### E.2.1 Gestalt: Proximity — Mode Toggle + Wizard Container

```css
/* ============================================================
   RESTAURANT PAIRING WIZARD
   All styles namespaced .restaurant-* to avoid collisions.
   ============================================================ */

/* Mode toggle — pill-shaped container, reuses .form-toggle + .toggle-btn */
.restaurant-mode-toggle {
  margin-bottom: 1.5rem;
}

/* Wizard container — bounded region (Gestalt: Closure) */
.restaurant-wizard {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.5rem;
}
```

#### E.2.2 Gestalt: Continuity — Step Indicator

Circles connected by a line, creating visual flow 1→2→3→4.

```css
.restaurant-step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  margin-bottom: 1.5rem;
}

/* Step circles (Gestalt: Closure) */
.restaurant-step-indicator-item {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: var(--bg-slot);
  color: var(--text-muted);
  font-weight: 600;
  font-size: var(--font-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  transition: all 0.2s;
  position: relative;
  z-index: 1;
}

/* Connecting line between circles (Gestalt: Continuity) */
.restaurant-step-indicator-item + .restaurant-step-indicator-item::before {
  content: '';
  position: absolute;
  right: 100%;
  top: 50%;
  width: 24px;
  height: 2px;
  background: var(--border);
  transform: translateY(-50%);
}

/* Active step — prominent (Gestalt: Figure-Ground) */
.restaurant-step-indicator-item.active {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

/* Completed step — clickable, muted accent */
.restaurant-step-indicator-item.completed {
  border-color: var(--accent);
  color: var(--accent);
  cursor: pointer;
}
.restaurant-step-indicator-item.completed::before {
  background: var(--accent);
}
.restaurant-step-indicator-item.active::before {
  background: var(--accent);
}
```

#### E.2.3 Gestalt: Similarity — Wine vs Dish Cards

Both use identical card structure but differ in background tint. Users distinguish wine cards from dish cards at a glance.

```css
/* Shared card base (both wine + dish) */
.restaurant-wine-card,
.restaurant-dish-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 0.5rem;
}

/* Wine cards — pale burgundy tint (Gestalt: Similarity within group) */
.restaurant-wine-card {
  background: rgba(var(--red-wine-rgb), 0.08);
}
.restaurant-wine-card:hover {
  background: rgba(var(--red-wine-rgb), 0.15);
  border-color: var(--accent);
}

/* Dish cards — pale sage tint (Gestalt: Similarity within group) */
.restaurant-dish-card {
  background: rgba(var(--sage-green-rgb), 0.06);
}
.restaurant-dish-card:hover {
  background: rgba(var(--sage-green-rgb), 0.12);
  border-color: var(--accent);
}

/* Selected state — checked cards are prominent (Figure-Ground) */
.restaurant-wine-card[aria-checked="true"],
.restaurant-dish-card[aria-checked="true"] {
  border-color: var(--accent);
}

/* Deselected state — dimmed (Figure-Ground) */
.restaurant-wine-card[aria-checked="false"],
.restaurant-dish-card[aria-checked="false"] {
  opacity: 0.5;
}
.restaurant-wine-card[aria-checked="false"] .restaurant-card-info strong,
.restaurant-dish-card[aria-checked="false"] .restaurant-card-info strong {
  text-decoration: line-through;
}

/* Card list containers — consistent spacing */
.restaurant-wine-cards,
.restaurant-dish-cards {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
```

**Note**: `.filter-chip` base class is reused for colour chips (both classes applied: `filter-chip restaurant-colour-chip`). The existing `.filter-chip:has(input:checked)` rule won't conflict because our chips use `.active` class toggle (no hidden checkbox). `.restaurant-colour-chip.active` overrides the active appearance intentionally using `var(--accent)` instead of the wine-list's `var(--priority-2)`.

#### E.2.4 Gestalt: Figure-Ground — Low Confidence Triage

Low-confidence items stand out from the normal card flow.

```css
/* Low confidence — warning border + icon */
.restaurant-low-confidence {
  border-color: var(--color-warning);
  border-width: 2px;
}

/* Triage banner — prominent alert */
.restaurant-triage-banner {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: var(--font-sm);
  font-weight: 500;
  margin-bottom: 1rem;
}
.restaurant-triage-banner:empty {
  display: none;
}

/* Confidence badges */
.restaurant-conf-badge {
  font-size: var(--font-2xs);
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}
.restaurant-conf-low {
  background: var(--color-error-bg);
  color: var(--color-error);
}
.restaurant-conf-medium {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
```

#### E.2.5 Navigation — Sticky Bottom Bar (Mobile Priority)

```css
/* Nav bar — inline on desktop, sticky on mobile */
.restaurant-nav-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1rem;
  margin-top: 1rem;
  border-top: 1px solid var(--border);
}

/* Wizard header — indicator + Start Over */
.restaurant-wizard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

/* Start Over button — muted, intentionally small */
.restaurant-start-over-btn {
  font-size: var(--font-xs);
  padding: 0.4rem 0.75rem;
  min-height: 36px;
}
```

#### E.2.6 Image Capture Widget

```css
/* Text input area */
.restaurant-text-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-slot);
  color: var(--text);
  font-size: var(--font-base);
  resize: vertical;
  min-height: 80px;
}
.restaurant-text-input:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15);
}
.restaurant-text-counter {
  text-align: right;
  font-size: var(--font-2xs);
  color: var(--text-muted);
  margin-top: 0.25rem;
}

/* Image grid — responsive, 2-col on mobile */
.restaurant-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.75rem;
  margin: 1rem 0;
}

/* Image thumbnail */
.restaurant-image-thumb {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  aspect-ratio: 3/4;
}
.restaurant-image-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Remove button — positioned top-right of image */
.restaurant-image-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

/* Progress overlay on image */
.restaurant-image-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--bg-slot);
}
.restaurant-image-progress.active {
  background: linear-gradient(90deg,
    var(--accent) 0%, var(--accent) var(--progress, 50%),
    var(--bg-slot) var(--progress, 50%));
}

/* Capture actions + buttons */
.restaurant-capture-actions,
.restaurant-capture-buttons {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}
.restaurant-capture-status {
  font-size: var(--font-sm);
  color: var(--text-muted);
  min-height: 1.2em;
  margin-top: 0.5rem;
}
```

#### E.2.7 Wine Review Filters (Gestalt: Proximity — grouped in one row)

```css
.restaurant-wine-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: var(--bg-slot);
  border-radius: 8px;
}

/* Colour filter chips — reuse .filter-chip pill shape */
.restaurant-colour-filters {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
/* Active override — accent instead of .filter-chip's priority-2 */
.restaurant-colour-chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

/* Price filter + BTG toggle — inline */
.restaurant-price-filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.restaurant-max-price-input {
  width: 80px;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text);
  font-size: var(--font-sm);
}
.restaurant-btg-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--font-sm);
  color: var(--text-muted);
  cursor: pointer;
}
```

#### E.2.8 Counter + Select Actions

```css
.restaurant-wine-counter,
.restaurant-dish-counter {
  font-size: var(--font-sm);
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}
.restaurant-select-actions {
  margin-bottom: 0.75rem;
}
.restaurant-select-all-btn {
  font-size: var(--font-xs);
}
```

#### E.2.9 Card Internals (shared between wine + dish cards)

```css
.restaurant-card-check {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--border);
  border-radius: 4px;
  font-size: var(--font-sm);
  color: var(--accent);
}
[aria-checked="true"] > .restaurant-card-check {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.15);
}

.restaurant-card-info {
  flex: 1;
  min-width: 0;
}
.restaurant-card-info strong {
  display: block;
  font-size: var(--font-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.restaurant-card-vintage,
.restaurant-card-colour,
.restaurant-card-category,
.restaurant-card-desc,
.restaurant-card-price {
  font-size: var(--font-xs);
  color: var(--text-muted);
  margin-right: 0.5rem;
}

/* BTG badge — pill-shaped accent */
.restaurant-btg-badge {
  font-size: var(--font-2xs);
  padding: 0.1rem 0.4rem;
  border-radius: 10px;
  background: var(--accent);
  color: white;
  font-weight: 600;
}

/* Inline price edit (low-confidence) */
.restaurant-inline-price {
  width: 70px;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--color-warning);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--text);
  font-size: var(--font-xs);
}

/* Remove button (X) on cards */
.restaurant-wine-remove,
.restaurant-dish-remove {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.restaurant-wine-remove:hover,
.restaurant-dish-remove:hover {
  background: var(--color-error-bg);
  color: var(--color-error);
}
```

#### E.2.10 Manual Add Forms

```css
.restaurant-add-wine-form,
.restaurant-add-dish-form {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.restaurant-add-wine-form h4,
.restaurant-add-dish-form h4 {
  font-size: var(--font-sm);
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}
.restaurant-form-row {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}
.restaurant-form-row input,
.restaurant-form-row select {
  flex: 1;
  min-width: 100px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-slot);
  color: var(--text);
  font-size: var(--font-sm);
}
.restaurant-form-row input:focus,
.restaurant-form-row select:focus {
  border-color: var(--accent);
  outline: none;
}
.restaurant-add-wine-btg-label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--font-sm);
  color: var(--text-muted);
  white-space: nowrap;
}
```

#### E.2.11 Results (Step 4)

```css
/* Summary bar */
.restaurant-results-summary {
  font-size: var(--font-md);
  margin-bottom: 1rem;
}
.restaurant-over-cap-warning {
  color: var(--color-error);
  font-weight: 600;
  font-size: var(--font-sm);
}

/* Options row */
.restaurant-results-options {
  margin-bottom: 1rem;
}
.restaurant-results-options .form-row {
  align-items: flex-end;
}
.restaurant-prefer-btg-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--font-sm);
  color: var(--text-muted);
  white-space: nowrap;
}

/* Loading spinner */
.restaurant-results-loading {
  text-align: center;
  padding: 1rem;
  color: var(--text-muted);
}

/* Fallback banner */
.restaurant-fallback-banner {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  font-size: var(--font-sm);
}

/* Result cards grid */
.restaurant-results-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

/* Individual result card */
.restaurant-result-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.restaurant-result-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.restaurant-result-dish {
  margin-bottom: 0.5rem;
}
.restaurant-result-wine {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}
.restaurant-result-wine-name {
  font-weight: 500;
}
.restaurant-result-why {
  font-size: var(--font-sm);
  color: var(--text-muted);
  font-style: italic;
  margin-bottom: 0.25rem;
}
.restaurant-result-tip {
  font-size: var(--font-xs);
  color: var(--text-muted);
}
.restaurant-pairing-confidence {
  font-size: var(--font-2xs);
  color: var(--text-muted);
  text-transform: uppercase;
}

/* Table wine card — distinct from per-dish cards */
.restaurant-table-wine-card {
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px solid var(--accent);
  border-radius: 10px;
  padding: 1rem;
  margin-top: 0.5rem;
}
.restaurant-table-wine-why {
  font-size: var(--font-sm);
  color: var(--text-muted);
  font-style: italic;
  margin-top: 0.25rem;
}
```

**Reduced motion**: Result card hover uses `transform: none` — the `translateY(-1px)` lift was removed to respect `prefers-reduced-motion` without needing a media query. Shadow alone provides the visual feedback.

#### E.2.12 Chat Interface

```css
.restaurant-chat {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.restaurant-chat-messages {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 0.75rem;
}
.restaurant-chat-message {
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  margin-bottom: 0.5rem;
  font-size: var(--font-sm);
  animation: fadeIn 0.15s ease-out;  /* reuses existing @keyframes fadeIn */
}
.restaurant-chat-message.user {
  background: rgba(var(--accent-rgb), 0.15);
  margin-left: 2rem;
  text-align: right;
}
.restaurant-chat-message.assistant {
  background: var(--bg-slot);
  margin-right: 2rem;
}

.restaurant-chat-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.restaurant-chat-input {
  flex: 1;
  min-width: 150px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-slot);
  color: var(--text);
  font-size: var(--font-sm);
}
.restaurant-chat-char-counter {
  font-size: var(--font-2xs);
  color: var(--text-muted);
}
.restaurant-chat-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.restaurant-chat-suggestion {
  font-size: var(--font-xs);
  padding: 0.3rem 0.6rem;
}
.restaurant-chat-unavailable {
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-style: italic;
}
.restaurant-chat-error {
  color: var(--color-error);
}
.restaurant-chat-section {
  margin-top: 1rem;
}
```

#### E.2.13 Dish Review Sections

```css
.restaurant-dish-review {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.restaurant-dish-capture-section {
  border-bottom: 1px solid var(--border);
  padding-bottom: 1rem;
}
.restaurant-dish-capture-section h3 {
  font-size: var(--font-md);
  margin-bottom: 0.75rem;
}
.restaurant-dish-review-section h3 {
  font-size: var(--font-md);
  margin-bottom: 0.75rem;
}
```

#### E.2.14 Responsive — Mobile (max-width: 480px)

```css
@media (max-width: 480px) {
  .restaurant-wizard {
    padding: 1rem;
    border-radius: 8px;
  }

  /* Sticky bottom nav bar */
  .restaurant-nav-bar {
    position: sticky;
    bottom: 0;
    background: var(--bg-card);
    padding: 0.75rem 1rem;
    margin: 0 -1rem -1rem;
    border-top: 1px solid var(--border);
    z-index: 10;
  }

  /* Start Over — header stacks on small screens */
  .restaurant-wizard-header {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* Image grid — force 2 columns */
  .restaurant-image-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  /* Filters — stack vertically */
  .restaurant-wine-filters {
    flex-direction: column;
    align-items: stretch;
  }

  /* Form rows — stack */
  .restaurant-form-row {
    flex-direction: column;
  }

  /* Result cards — single column */
  .restaurant-results-cards {
    grid-template-columns: 1fr;
  }

  /* Chat input — full width */
  .restaurant-chat-input-row {
    flex-direction: column;
  }
  .restaurant-chat-input {
    width: 100%;
  }
}
```

#### E.2.15 Responsive — Tablet (max-width: 768px)

```css
@media (max-width: 768px) {
  .restaurant-wizard {
    padding: 1rem;
  }

  .restaurant-step-indicator-item {
    width: 32px;
    height: 32px;
    font-size: var(--font-xs);
  }
  .restaurant-step-indicator-item + .restaurant-step-indicator-item::before {
    width: 16px;
  }
}
```

---

### E.3 App Init (`public/js/app.js`)

**Import** (at top with other imports, after `initCellarAnalysis`):

```js
import { initRestaurantPairing } from './restaurantPairing.js';
```

**Call** (in `startAuthenticatedApp()`, after `initSommelier()`):

```js
initSommelier();
initRestaurantPairing();    // ← new, after sommelier (same pairing tab)
initSettings();
```

Why after `initSommelier()`: Both operate within `view-pairing`. Sommelier binds to the cellar-mode elements; restaurant pairing binds to the wizard container. Grouping pairing-related inits together.

---

### E.4 Service Worker (`public/sw.js`)

**Bump cache version** — increment the current `CACHE_VERSION` (expected: `'v98'` → `'v99'`; verify current value before editing to avoid no-op bumps from parallel work):

```js
const CACHE_VERSION = 'v99';   // verify: was v98 at time of writing
```

**Add to STATIC_ASSETS** — two groups:

_Group 1: Restaurant pairing modules_ (after `/js/pairing.js`):

```js
'/js/restaurantPairing.js',
'/js/restaurantPairing/state.js',
'/js/restaurantPairing/imageCapture.js',
'/js/restaurantPairing/wineReview.js',
'/js/restaurantPairing/dishReview.js',
'/js/restaurantPairing/results.js',
```

_Group 2: Complete `api/*` module graph_ (pre-existing bug fix — `api.js` barrel is already cached but none of its sub-modules are, breaking offline cold-start for the **entire app**, not just restaurant pairing):

```js
'/js/api/base.js',
'/js/api/index.js',
'/js/api/profile.js',
'/js/api/wines.js',
'/js/api/ratings.js',
'/js/api/cellar.js',
'/js/api/settings.js',
'/js/api/awards.js',
'/js/api/acquisition.js',
'/js/api/palate.js',
'/js/api/health.js',
'/js/api/pairing.js',
'/js/api/restaurantPairing.js',
'/js/api/errors.js',
```

**Why all 14, not just 3?** The reviewer correctly identified that `results.js` imports from the `api.js` barrel (which re-exports all 14 sub-modules). But this is a pre-existing issue: every module in the app imports from `api.js`, and the barrel's sub-module chain was never pre-cached after the api/ directory split. Adding all 14 fixes offline cold-start for the entire app at negligible cost (~14 extra pre-cache entries). Changing `results.js` to import from `api/restaurantPairing.js` directly was rejected because: (a) it only fixes restaurant pairing, not the app-wide gap; (b) it breaks the established import pattern used by 12+ other modules; (c) it violates Phase E's "no JS logic changes" constraint.

**Bump CSS version queries** — the `?v=` on STATIC_ASSETS CSS entries serves as an audit trail for SW cache differentiation. The actual browser cache-busting mechanism is:
1. `CACHE_VERSION` bump → old caches (STATIC + DYNAMIC) deleted during SW activate
2. `<link href="styles.css?v=...">` bump in `index.html` → browser re-fetches entry stylesheet
3. CSS `@import` sub-modules (e.g., `@import 'components.css'`) are fetched without query strings — they miss the pre-cache but are re-fetched from network and stored in DYNAMIC_CACHE

```js
'/css/styles.css?v=20260208a',        // was 20260207a
'/css/variables.css?v=20260208a',      // was 20260207a — new RGB variables added
'/css/components.css?v=20260208a',     // was 20260207a — restaurant styles added
```

Also bump `styles.css?v=` in the `<link>` tag in `index.html` (primary browser cache trigger).

---

### E.5 UX Flow Walkthrough

**Default State**: User opens "Find Pairing" tab → sees mode toggle at top with "From My Cellar" active → familiar sommelier + manual pairing below. Zero disruption to existing users.

**Switching to Restaurant Mode**: User taps "At a Restaurant" → cellar sections hide, wizard appears → Step 1 (Capture Wine List) with text area + image upload buttons. Clear visual hierarchy: step circles at top show progression.

**Step 1 → Step 2** (always allowed): User uploads wine list photo or types text → clicks Analyze → wines parsed → auto-advances to Step 2. OR clicks "Skip to Manual" → advances with empty list.

**Step 2 → Step 3** (needs ≥1 wine): Wine cards with pale burgundy tint. Low-confidence items have orange warning border. Filters (colour chips, max price, BTG toggle) narrow view but don't change selection. Counter: "8 selected (5 visible)". Blocked with toast if no wines selected.

**Step 3 → Step 4** (needs ≥1 dish): Dish cards with pale sage tint (visually distinct from wine cards). Same capture + review pattern. Blocked with toast if no dishes.

**Step 4** (Results): Summary bar, optional inputs, "Get Pairings" → AI recommendation cards. Table wine card highlighted with accent border. Chat interface below for follow-ups (gated on chatId; fallback shows explanatory line).

**Navigation**: Back button hidden on step 1. Step indicator circles clickable for completed steps. "Start Over" requires confirm dialog if data exists. Switching back to "From My Cellar" preserves wizard state.

---

### E.6 Controller↔HTML Contract Verification

The controller (`restaurantPairing.js`) queries these DOM elements that must exist in the HTML:

| Selector | HTML Source | Purpose |
|----------|------------|---------|
| `.restaurant-wizard` | New `<div>` in index.html | Wizard container |
| `.restaurant-mode-toggle .toggle-btn` | New mode toggle buttons | Mode switching |
| `.pairing-cellar-section` | New wrapper div | Hide cellar content |

The controller **creates** these internally (via innerHTML):

| Selector | Created by | Purpose |
|----------|-----------|---------|
| `.restaurant-step-indicator-item` | `initRestaurantPairing()` | Step circles |
| `.restaurant-start-over-btn` | `initRestaurantPairing()` | Start Over |
| `.restaurant-nav-back`, `.restaurant-nav-next` | `initRestaurantPairing()` | Navigation |
| `.restaurant-step-content` | `initRestaurantPairing()` | Step module mount point |

No orphan selectors — every class queried in JS has a corresponding CSS rule or HTML source.

---

### E.7 Verification

#### Automated (must pass before merge)

1. `npm run test:all` — all 1630+ unit + integration tests pass (AGENTS.md: recommended pre-commit command)
2. `npm run lint` — no new lint errors in `app.js` and `restaurantPairing/*.js` (note: lint targets `src/` and `public/js/` only — `sw.js` is at `public/sw.js` outside the lint scope; HTML and CSS are not ESLint targets)
3. Auth scan: `apiAuthHeaders.test.js` scans `restaurantPairing/` folder — no raw `fetch('/api/...')` (already passing from Phase B)
4. `sw.js` syntax check: `node --check public/sw.js` — ensures no syntax errors since sw.js is outside lint scope

#### Visual / Developer Checks

5. View source of `index.html` — count `<div` opens and `</div>` closes inside `#view-pairing`, verify they match
6. Open dev tools → Application → Service Workers → verify SW updated (version incremented), all `api/*.js` + `restaurantPairing/*.js` files listed in cache
7. Hard refresh → Network tab → verify `styles.css?v=20260208a` loaded (this is the primary cache trigger; the `@import`ed sub-files are fetched without query strings)

#### Manual Regression

8. Open "Find Pairing" tab → verify existing sommelier + manual pairing visible by default (mode toggle shows "From My Cellar" active)
9. Use sommelier feature — enter dish, click "Ask Sommelier" → verify existing feature works unchanged
10. Use manual pairing — select signals, click "Find Pairing" → verify existing feature works unchanged
11. Click pairing result feedback → verify modal still opens (modal is outside both tabpanels)

#### Manual — New Feature

12. Toggle "At a Restaurant" → verify cellar content hidden, wizard appears with step indicator + nav bar
13. Step through wizard: Step 1 → 2 → 3 → 4 → verify step indicator, nav buttons, content rendering
14. Upload wine list photos → verify per-image progress, parsed wines as selectable cards with pale burgundy tint
15. Low-confidence triage: verify banner, warning styling, inline price edit with `inputmode="decimal"`
16. "Skip to Manual" button: verify visible immediately on Steps 1 and 3
17. Remove image while parsing → verify request cancelled (no orphaned spinner)
18. Apply colour/price/BTG filters → verify cards hide/show, checked state preserved, counter shows "N selected (M visible)"
19. Type dish descriptions → verify parsed dishes with categories and pale sage tint
20. Uncheck wines/dishes → "Get Pairings" sends only selected items
21. Verify result cards show per-dish pairings + table wine + prices
22. Deterministic fallback: disable AI → verify colour-matching results with "AI unavailable" banner — no chat UI rendered
23. Follow-up chat (when chatId present) → verify messages appear
24. "Start Over" → verify confirm dialog → confirm → state cleared, `wineapp.restaurant.*` removed from sessionStorage
25. Result invalidation: get pairings → go back → change selection → return to Step 4 → verify fresh "Get Pairings" shown
26. Mode switch preservation: switch to "From My Cellar" → switch back → verify wizard state intact

#### Manual — Mobile

27. Mobile (480px viewport): sticky nav, camera access via `capture="environment"`, 44px touch targets, 2-col image grid
28. Start Over positioned away from Next button (opposite side of nav bar)
29. App switch on mobile: navigate away → return → verify wizard state restored from sessionStorage

#### Manual — Edge Cases

30. Selection cap: select 81+ wines → "Get Pairings" → verify blocking toast, API not called
31. Parse budget: exhaust 10 parses → verify Analyze disabled, guidance toast
32. Multi-menu: upload photos with same wine at different prices → verify both entries preserved

---

### Phase F: Quick Pair + Polish

Phase F delivers the **Quick Pair** speed shortcut and three CSS polish items deferred from Phase E. Quick Pair is the only item requiring a new JS module + tests; the other three are CSS-only additions (~80 lines total).

---

#### F.0 Overview

| # | Item | Type | ~Lines | Risk |
|---|------|------|--------|------|
| F.1 | Quick Pair UI | New JS module + CSS + HTML + tests | ~350 | High |
| F.2 | Mode switch animation | CSS edit | ~15 | Low |
| F.3 | Print styles | CSS append | ~35 | Low |
| F.4 | `prefers-reduced-motion` | CSS append | ~25 | Low |

**Execution strategy: two clusters.**

| Cluster | Steps | Risk | Gate |
|---------|-------|------|------|
| **1 — Quick Pair** | F.1 (module + CSS + HTML + tests) | High | Audit before Cluster 2 |
| **2 — CSS Polish** | F.2 + F.3 + F.4 (CSS only) | Low | `npm run test:unit` + manual check |

---

#### F.1 Quick Pair UI

##### F.1.1 Concept

Quick Pair is a speed shortcut for the **"At a Restaurant"** mode. The user skips the review steps entirely:

```
[1 photo + dish text] → Parse → Straight to pairings
```

**When to use**: Returning user who knows the flow, or time-pressed at the table. They accept lower accuracy in exchange for speed. The full wizard is always available via "Refine".

##### F.1.2 Trigger Location

Quick Pair link renders **inside** `.restaurant-wizard` at the top of Step 1, above the capture widget:

```html
<div class="restaurant-quick-pair-banner">
  <button class="btn btn-link restaurant-quick-pair-trigger" type="button">
    ⚡ Quick Pair — snap a wine list photo + type your dishes → instant pairings
  </button>
</div>
```

**Why Step 1 top, not a separate entry point**: Keeps Quick Pair discoverable without adding navigation complexity. The user enters restaurant mode, sees the full wizard, and can opt into the shortcut. Once familiar, they'll tap it immediately.

**Visibility**: Only shown when wizard is at Step 1 (hidden on Steps 2-4). The controller's `renderStep(1)` populates this banner before the capture widget.

##### F.1.3 Quick Pair Overlay

Clicking the trigger opens a **minimal inline form** (not a modal — modals are jarring on mobile). This replaces the Step 1 capture widget area:

```html
<div class="restaurant-quick-pair-form">
  <h3 class="restaurant-quick-pair-title">Quick Pair</h3>
  <p class="text-muted">One photo + your dishes → instant suggestions</p>

  <!-- Wine list: single image only (speed over accuracy) -->
  <div class="restaurant-quick-pair-section">
    <label class="restaurant-quick-pair-label">Wine List</label>
    <div class="restaurant-quick-pair-image-row">
      <button class="btn btn-secondary restaurant-quick-pair-camera" type="button">📷 Photo</button>
      <button class="btn btn-secondary restaurant-quick-pair-file" type="button">📁 File</button>
      <span class="restaurant-quick-pair-image-status text-muted">No image</span>
    </div>
    <input type="file" accept="image/*" capture="environment"
           class="restaurant-quick-pair-camera-input" hidden>
    <input type="file" accept="image/*"
           class="restaurant-quick-pair-file-input" hidden>
    <!-- Thumbnail preview -->
    <div class="restaurant-quick-pair-thumb" style="display: none;"></div>
  </div>

  <!-- Dishes: simple text area (one per line) -->
  <div class="restaurant-quick-pair-section">
    <label class="restaurant-quick-pair-label" for="quick-pair-dishes">Your Dishes</label>
    <textarea class="restaurant-quick-pair-dishes restaurant-text-input"
              id="quick-pair-dishes"
              placeholder="Type your dishes, one per line&#10;e.g. Grilled salmon&#10;Beef fillet&#10;Caesar salad"
              rows="4" maxlength="2000"></textarea>
    <div class="restaurant-text-counter"><span>0</span>/2000</div>
  </div>

  <!-- Actions -->
  <div class="restaurant-quick-pair-actions">
    <button class="btn btn-primary restaurant-quick-pair-go" type="button" disabled>
      Get Pairings
    </button>
    <button class="btn btn-link restaurant-quick-pair-cancel" type="button">
      Use Full Wizard
    </button>
  </div>

  <!-- Loading state -->
  <div class="restaurant-quick-pair-loading" style="display: none;">
    <div class="loading-spinner"></div>
    <span>Analyzing wine list & dishes…</span>
  </div>
</div>
```

**Key constraints**:
- **Single image only** (not multi-image). Quick Pair trades accuracy for speed. One photo → one parse call → fast.
- **No wine review step** — all parsed wines are selected by default.
- **No dish review step** — text lines become dishes directly (one per line, trimmed, empty lines filtered).
- **"Get Pairings" enabled** when at least one of: image selected OR dish text non-empty. Both empty → disabled.
- **Parse budget**: Consumes 1 parse from shared `parseBudget` for the wine image (if provided). If budget exhausted, show toast and disable photo buttons — user can still type wines as text.
- **Dish text → items**: Each non-empty line becomes a dish item `{ name: line.trim(), description: '', category: 'other', confidence: 'high' }`. No AI parse needed for typed dishes.

##### F.1.4 Quick Pair Flow (detailed)

```
User taps "⚡ Quick Pair"
  → Step 1 capture widget replaced by quick-pair-form
  → User takes/uploads ONE photo of wine list (optional)
  → User types dishes in text area (optional but encouraged)
  → User taps "Get Pairings"
  
  IF image provided:
    → parseMenu({ type: 'wine_list', image, mediaType }) → wineItems[]
    → parseBudget.used++
  IF text provided:
    → Parse lines client-side → dishItems[]  (no API call)
  IF neither:
    → "Get Pairings" was disabled — should not reach here

  → mergeWines(wineItems)
  → mergeDishes(dishItems)
  → Call runQuickPairFlow(wineItems, dishItems)
    → renderStep(4) → requestRecommendations()

  Results page shows:
    → Confidence warning banner (role="alert"):
      "Pairings based on best-guess parsing — tap Refine for accuracy"
    → Normal result cards
    → "Refine" button → loads full wizard with parsed data pre-populated
      (data is already in state from merge calls — just renderStep(2))
```

**Confidence warning**: Always shown on Quick Pair results (no review step = inherently lower confidence). Uses `.restaurant-quick-pair-warning` class with `role="alert"` for screen readers.

**"Refine" button**: Calls `renderStep(2)` so user enters the full wizard at wine review. State is already populated from the merge calls. No data loss.

**Error handling**:
- Parse fails → toast error, hide loading, re-enable form. Don't navigate away.
- Parse succeeds but zero wines extracted → proceed with empty wines (dish-only pairing is valid). Results will show "No wines provided — showing dish-based suggestions."
- Network error → toast, re-enable form.

##### F.1.5 Module: `public/js/restaurantPairing/quickPair.js`

**New file** (~200 lines). Exports:

```javascript
/**
 * Render Quick Pair inline form, replacing current Step 1 content.
 * @param {HTMLElement} container - Mount point (.restaurant-step-content)
 * @param {{used: number}} parseBudget - Shared budget tracker
 * @param {Function} onComplete - Callback after successful parse+recommend
 * @param {Function} onCancel - Callback to return to full wizard Step 1
 * @returns {{destroy: Function}}
 */
export function renderQuickPair(container, { parseBudget, onComplete, onCancel })
```

**Internal logic**:
- Builds HTML (F.1.3 template)
- Wires camera button → hidden `<input type="file" capture="environment">`
- Wires file button → hidden `<input type="file" accept="image/*">`
- On file selected: `resizeImage()` → store base64 + show thumbnail
- Wires "Get Pairings" button:
  1. Validate: at least image or text
  2. Show loading spinner
  3. If image → `parseMenu({ type: 'wine_list', image, mediaType })`
  4. Parse dish text → `lines.filter(l => l.trim()).map(l => ({ name: l.trim(), description: '', category: 'other', confidence: 'high' }))`
  5. `mergeWines(wineItems)`, `mergeDishes(dishItems)`
  6. Call `onComplete(wineItems, dishItems)` (controller handles rest)
- Wires "Use Full Wizard" → `onCancel()`
- `destroy()`: remove listeners, abort any in-flight parse, cleanup

**Dependencies**:
- `resizeImage` from `bottles/imageParsing.js`
- `parseMenu` from `api/restaurantPairing.js`
- `mergeWines`, `mergeDishes` from `state.js`
- `showToast` from `utils.js`

##### F.1.6 Controller Changes (`public/js/restaurantPairing.js`)

Modify `renderStep(1)` to include Quick Pair banner:

```javascript
case 1: {
  // Quick Pair banner (only on Step 1)
  const bannerHtml = `
    <div class="restaurant-quick-pair-banner">
      <button class="btn btn-link restaurant-quick-pair-trigger" type="button">
        ⚡ Quick Pair — snap & type → instant pairings
      </button>
    </div>`;
  stepContent.insertAdjacentHTML('afterbegin', bannerHtml);

  // Wire Quick Pair trigger
  const qpTrigger = stepContent.querySelector('.restaurant-quick-pair-trigger');
  qpTrigger.addEventListener('click', () => {
    // Replace step content with quick pair form
    destroyCurrentStep();
    const qp = renderQuickPair(stepContent, {
      parseBudget,
      onComplete: async (wineItems, dishItems) => {
        await runQuickPairFlow(wineItems, dishItems);
      },
      onCancel: () => {
        renderStep(1); // Return to full Step 1
      }
    });
    currentStepDestroy = qp.destroy;
  });

  // Normal Step 1 capture widget below the banner
  const capture = createImageCapture(stepContent, { ... });
  currentStepDestroy = capture.destroy;
  break;
}
```

**Important lifecycle detail**: When Quick Pair trigger is clicked, `destroyCurrentStep()` tears down the capture widget, then `renderQuickPair` takes over the container. `currentStepDestroy` is reassigned to `qp.destroy`. If user cancels, `onCancel` → `renderStep(1)` which calls `destroyCurrentStep()` → tears down Quick Pair → renders fresh Step 1.

**Modify `runQuickPairFlow`**: Add a `quickPairMode` flag to state so Step 4 knows to show the confidence warning and "Refine" button:

```javascript
export async function runQuickPairFlow(wineItems, dishItems) {
  try {
    mergeWines(wineItems);
    mergeDishes(dishItems);
    setQuickPairMode(true);  // New state flag
    renderStep(4);
    await requestRecommendations();
  } catch (err) {
    console.error('Quick Pair error:', err);
    showToast('Failed to get pairing recommendations', 'error');
    throw err;
  }
}
```

##### F.1.7 State Changes (`public/js/restaurantPairing/state.js`)

Add Quick Pair mode flag:

```javascript
const KEYS = {
  // ... existing keys ...
  QUICK_PAIR_MODE: 'wineapp.restaurant.quickPairMode'
};

export function getQuickPairMode() {
  return load(KEYS.QUICK_PAIR_MODE, false);
}

export function setQuickPairMode(val) {
  save(KEYS.QUICK_PAIR_MODE, !!val);
}
```

- `clearState()` resets `quickPairMode` to `false`.
- `invalidateResults()` resets `quickPairMode` to `false` (editing after Quick Pair = full wizard flow).

##### F.1.8 Results Changes (`public/js/restaurantPairing/results.js`)

Add confidence warning and "Refine" button when in Quick Pair mode:

```javascript
import { getQuickPairMode, setQuickPairMode } from './state.js';

// In renderResults():
const isQuickPair = getQuickPairMode();
if (isQuickPair) {
  const warningHtml = `
    <div class="restaurant-quick-pair-warning" role="alert">
      <strong>⚡ Quick Pair</strong> — Pairings based on best-guess parsing.
      <button class="btn btn-link restaurant-refine-btn" type="button">
        Refine for accuracy →
      </button>
    </div>`;
  container.insertAdjacentHTML('afterbegin', warningHtml);

  const refineBtn = container.querySelector('.restaurant-refine-btn');
  refineBtn.addEventListener('click', () => {
    setQuickPairMode(false);
    // Navigate to Step 2 — data is already in state
    // Emit custom event for controller to handle (no circular import)
    container.dispatchEvent(new CustomEvent('restaurant:refine', { bubbles: true }));
  });
}
```

Controller listens for `restaurant:refine` event on wizard container:
```javascript
addListener(wizardContainer, 'restaurant:refine', () => {
  renderStep(2);
});
```

This avoids circular imports (results.js doesn't import controller).

##### F.1.9 CSS (`public/css/components.css`)

Append ~60 lines after existing restaurant styles:

```css
/* --- Quick Pair --- */

.restaurant-quick-pair-banner {
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px dashed var(--accent);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  text-align: center;
}

.restaurant-quick-pair-trigger {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--accent);
}

.restaurant-quick-pair-form {
  padding: 0.5rem 0;
}

.restaurant-quick-pair-title {
  font-size: var(--font-md);
  margin-bottom: 0.25rem;
}

.restaurant-quick-pair-section {
  margin-bottom: 1rem;
}

.restaurant-quick-pair-label {
  display: block;
  font-weight: 600;
  font-size: var(--font-sm);
  margin-bottom: 0.5rem;
  color: var(--text);
}

.restaurant-quick-pair-image-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.restaurant-quick-pair-image-status {
  font-size: var(--font-xs);
}

.restaurant-quick-pair-thumb {
  margin-top: 0.5rem;
  max-width: 120px;
  border-radius: 8px;
  overflow: hidden;
}
.restaurant-quick-pair-thumb img {
  width: 100%;
  display: block;
}

.restaurant-quick-pair-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}

.restaurant-quick-pair-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  color: var(--text-muted);
}

/* Confidence warning on Quick Pair results */
.restaurant-quick-pair-warning {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  font-size: var(--font-sm);
}

.restaurant-refine-btn {
  font-weight: 600;
  margin-left: 0.25rem;
}
```

##### F.1.10 HTML (`public/index.html`)

No HTML changes needed — Quick Pair renders entirely via JS into the existing `.restaurant-step-content` container.

##### F.1.11 Service Worker (`public/sw.js`)

Add `quickPair.js` to `STATIC_ASSETS`:
```javascript
'/js/restaurantPairing/quickPair.js',
```

Bump `CACHE_VERSION` (increment from current).

##### F.1.12 New Test File: `tests/unit/restaurantPairing/quickPair.test.js`

**~20 tests** using jsdom + vi.fn() mocks:

| Category | Tests |
|----------|-------|
| **Render** | Form renders with camera, file, textarea, buttons. "Get Pairings" initially disabled. |
| **Image selection** | Camera input triggers `resizeImage()`, shows thumbnail, updates status text. File input same. Second selection replaces first. |
| **Enable logic** | Disabled when both empty. Enabled when image only. Enabled when text only. Enabled when both. |
| **Parse flow (image + text)** | Calls `parseMenu()` with correct payload. Merges wine items. Splits dish text by lines. Filters empty lines. Trims. Calls `onComplete`. |
| **Parse flow (text only)** | No `parseMenu` call. Dishes created from lines. Calls `onComplete`. |
| **Parse flow (image only)** | `parseMenu` called. Empty dish array. Calls `onComplete`. |
| **Parse budget** | When budget exhausted → camera/file buttons disabled, toast shown. |
| **Parse error** | `parseMenu` rejects → toast error, loading hidden, form re-enabled. |
| **Cancel** | "Use Full Wizard" calls `onCancel`. |
| **Destroy** | Removes listeners, aborts in-flight parse, cleans up. |
| **Char counter** | Textarea input updates counter. |

##### F.1.13 Existing Test Updates

| File | Change |
|------|--------|
| `tests/unit/restaurantPairing/state.test.js` | Add tests for `getQuickPairMode()`, `setQuickPairMode()`, `clearState()` resets it, `invalidateResults()` resets it |
| `tests/unit/restaurantPairing/restaurantPairing.test.js` | Add tests: Quick Pair trigger renders on Step 1, clicking trigger replaces content, `onComplete` calls `runQuickPairFlow`, `onCancel` returns to Step 1, `restaurant:refine` event navigates to Step 2 |
| `tests/unit/restaurantPairing/results.test.js` | Add tests: Quick Pair warning renders when `getQuickPairMode()=true`, hidden when `false`, "Refine" button dispatches `restaurant:refine` event |
| `tests/unit/utils/apiAuthHeaders.test.js` | Already scans `restaurantPairing/` folder — `quickPair.js` will be auto-detected |

---

#### F.2 Mode Switch Animation

**Problem**: Switching between "From My Cellar" and "At a Restaurant" uses `display: none/block` — an instant cut. Adding a CSS opacity transition gives perceived smoothness.

**Gotcha**: `display: none` removes elements from layout — CSS transitions don't fire on `display` changes. Fix: use `visibility` + `opacity` + `position: absolute` for the hidden panel, or use a class-based approach with `setTimeout`.

**Implementation** (class-based, ~15 lines CSS + ~5 lines JS):

CSS addition in `components.css`:
```css
/* Mode switch transition */
.pairing-cellar-section,
.restaurant-wizard {
  transition: opacity 0.2s ease-in-out;
}
.pairing-cellar-section.mode-hidden,
.restaurant-wizard.mode-hidden {
  opacity: 0;
  pointer-events: none;
  position: absolute;
  visibility: hidden;
}
```

JS change in controller `setMode()`:
```javascript
// Replace style.display toggles with class-based approach
function setMode(mode) {
  const cellarSections = document.querySelectorAll('.pairing-cellar-section');
  const wizard = wizardContainer;

  if (mode === 'restaurant') {
    cellarSections.forEach(el => el.classList.add('mode-hidden'));
    if (wizard) wizard.classList.remove('mode-hidden');
  } else {
    cellarSections.forEach(el => el.classList.remove('mode-hidden'));
    if (wizard) wizard.classList.add('mode-hidden');
  }
  // ... toggle buttons unchanged
}
```

And in `initRestaurantPairing()`, replace the initial `style.display = 'none'` with `classList.add('mode-hidden')` on the wizard.

HTML change: Remove `style="display: none;"` from `.restaurant-wizard` in index.html. Replace with `class="restaurant-wizard mode-hidden"`.

**Risk**: Low. Only CSS + 2 small JS changes. No new modules or tests needed — existing mode toggle tests cover the class being applied.

**Test update**: Existing controller tests check for `style.display` — update to check for `mode-hidden` class instead.

---

#### F.3 Print Styles

**Purpose**: Users may want to print or screenshot the pairing recommendations while at the table.

CSS append (~35 lines):
```css
/* --- Print Styles --- */

@media print {
  /* Hide everything except results */
  .restaurant-mode-toggle,
  .restaurant-wizard-header,
  .restaurant-nav-bar,
  .restaurant-quick-pair-banner,
  .restaurant-chat-section,
  .restaurant-optional-inputs,
  .restaurant-get-pairings-btn,
  .restaurant-results-loading {
    display: none !important;
  }

  /* Full-width results */
  .restaurant-wizard {
    border: none;
    padding: 0;
    background: white;
  }

  .restaurant-results-cards {
    grid-template-columns: 1fr;
  }

  /* Ensure cards are visible (not dimmed) */
  .restaurant-result-card {
    break-inside: avoid;
    border: 1px solid #ccc;
    margin-bottom: 0.5rem;
  }

  /* Table wine suggestion — prominent */
  .restaurant-table-wine {
    border: 2px solid #333;
    padding: 0.75rem;
    break-inside: avoid;
  }

  /* Summary bar — keep visible */
  .restaurant-results-summary {
    font-size: 14pt;
    margin-bottom: 1rem;
  }
}
```

**Scope**: Only restaurant pairing elements. Does not affect existing cellar print behaviour.

---

#### F.4 `prefers-reduced-motion`

**Purpose**: Explicit opt-out for users who prefer reduced motion. The restaurant wizard already avoids `transform` on hover, but the step indicator has `transition: all 0.2s` and the mode switch animation (F.2) adds `transition: opacity 0.2s`.

CSS append (~25 lines):
```css
/* --- Reduced Motion --- */

@media (prefers-reduced-motion: reduce) {
  .restaurant-step-indicator-item {
    transition: none;
  }

  .pairing-cellar-section,
  .restaurant-wizard {
    transition: none;
  }

  /* If any future animations are added, disable here */
  .restaurant-wine-card,
  .restaurant-dish-card {
    transition: none;
  }

  .restaurant-quick-pair-banner {
    transition: none;
  }
}
```

**Placement**: After the print styles block, still within the restaurant section of `components.css`.

---

#### F.5 Files Summary

##### New Files (2)

| File | Responsibility | ~Lines |
|------|----------------|--------|
| `public/js/restaurantPairing/quickPair.js` | Quick Pair inline form: single image + dish text → parse → `onComplete` callback | ~200 |
| `tests/unit/restaurantPairing/quickPair.test.js` | ~20 tests: render, enable logic, parse flows, budget, error, cancel, destroy | ~300 |

##### Modified Files (6)

| File | Change | ~Lines |
|------|--------|--------|
| `public/js/restaurantPairing.js` | Quick Pair banner on Step 1, trigger handler, `restaurant:refine` listener, `setQuickPairMode(true)` in `runQuickPairFlow`, class-based `setMode()` | ~30 |
| `public/js/restaurantPairing/state.js` | `getQuickPairMode()`, `setQuickPairMode()`, reset in `clearState`/`invalidateResults` | ~15 |
| `public/js/restaurantPairing/results.js` | Quick Pair warning banner + "Refine" button + `restaurant:refine` event dispatch | ~25 |
| `public/css/components.css` | Quick Pair styles (~60), mode switch transition (~15), print styles (~35), reduced-motion (~25) | ~135 |
| `public/index.html` | Remove `style="display: none;"` from `.restaurant-wizard`, add `mode-hidden` class | ~1 |
| `public/sw.js` | Add `quickPair.js` to `STATIC_ASSETS`, bump `CACHE_VERSION` | ~2 |

##### Updated Test Files (3)

| File | New Tests |
|------|-----------|
| `tests/unit/restaurantPairing/state.test.js` | 4 tests (get/set quickPairMode, clearState resets, invalidateResults resets) |
| `tests/unit/restaurantPairing/restaurantPairing.test.js` | 5 tests (banner, trigger, onComplete, onCancel, refine event) |
| `tests/unit/restaurantPairing/results.test.js` | 3 tests (warning renders, warning hidden, refine dispatches event) |

---

#### F.6 Implementation Order

**Cluster 1: Quick Pair (F.1)** — Implement + audit before polish

| Step | Task | Files |
|------|------|-------|
| F.1a | State additions | `state.js` (add `quickPairMode` flag + tests) |
| F.1b | Quick Pair module + tests | `quickPair.js` + `quickPair.test.js` |
| F.1c | Controller updates | `restaurantPairing.js` (banner, trigger, refine listener, `setQuickPairMode`) |
| F.1d | Results updates | `results.js` (warning banner + refine button) |
| F.1e | CSS + SW | `components.css` (Quick Pair styles), `sw.js` (add file + bump) |

Run: `npm run test:unit` — all existing + ~32 new tests pass.
Audit focus: Parse budget accounting, lifecycle (destroy when switching back to full wizard), no circular imports (refine uses CustomEvent), `resizeImage` integration, form enable/disable logic.

**Cluster 2: CSS Polish (F.2 + F.3 + F.4)** — Low risk, execute together

| Step | Task | Files |
|------|------|-------|
| F.2 | Mode switch animation | `components.css` (transition rules), `restaurantPairing.js` (class-based setMode), `index.html` (remove inline style) |
| F.3 | Print styles | `components.css` (append `@media print` block) |
| F.4 | Reduced motion | `components.css` (append `@media (prefers-reduced-motion)` block) |

Run: `npm run test:unit` — update mode toggle tests for class-based approach.
Manual: Toggle modes → verify fade transition. Print preview → verify result cards only. OS reduced-motion → verify no transitions.

---

#### F.7 Verification Checklist

##### Automated

1. `npm run test:unit` — all tests pass (expected ~1665, up from 1630)
2. `npm run lint` — no new errors
3. `node --check public/sw.js` — syntax valid
4. `apiAuthHeaders.test.js` — `quickPair.js` detected and scanned

##### Manual — Quick Pair

5. Restaurant mode → Step 1 → Quick Pair banner visible
6. Click "⚡ Quick Pair" → inline form replaces capture widget
7. Take/upload ONE photo → thumbnail shown, status updated
8. Type dishes (one per line) → "Get Pairings" enabled
9. Tap "Get Pairings" → loading spinner → results page
10. Results show confidence warning banner + "Refine" button
11. Tap "Refine" → navigates to Step 2 (wine review with parsed data)
12. "Use Full Wizard" → returns to Step 1 capture widget
13. Parse budget: after 10 parses → camera/file buttons disabled in Quick Pair form
14. Network error during parse → toast, form re-enabled (not stuck)

##### Manual — CSS Polish

15. Toggle cellar ↔ restaurant → smooth 200ms fade (not instant cut)
16. `prefers-reduced-motion: reduce` in OS settings → no fade transition
17. Print Preview on results page → only result cards + summary shown
18. Step indicator has no transition with `prefers-reduced-motion`

##### Manual — Edge Cases

19. Quick Pair with image only (no dishes) → results rendered (wines only)
20. Quick Pair with dishes only (no photo) → results rendered (dishes only, no parse call)
21. Quick Pair → Start Over → confirms → returns to Step 1 (not Quick Pair form)
22. Quick Pair → get results → navigate to Step 2 → modify selections → Step 4 → no Quick Pair warning (quickPairMode reset by `invalidateResults`)

---

### Phase E — Done (2026-02-08)

**All 5 files modified, 0 new files created. 1630 unit tests passing.**

#### Changes Made

| File | Lines Changed | Summary |
|------|--------------|---------|
| `public/css/variables.css` | +2 | Added `--red-wine-rgb` and `--sage-green-rgb` CSS variables for card tints |
| `public/index.html` | +12, -1 | Mode toggle (tablist/tab ARIA), `.pairing-cellar-section` wrapper, `.restaurant-wizard` container, removed stray `</div>` |
| `public/css/components.css` | +505 | Full `.restaurant-*` namespaced styles (E.2.1–E.2.15): mode toggle, step indicator, wine/dish cards, triage, navigation, image capture, filters, card internals, forms, results, chat, dish review, responsive (480px + 768px) |
| `public/js/app.js` | +2 | Import `initRestaurantPairing`, call after `initSommelier()` |
| `public/sw.js` | +20, ~3 | Bumped `CACHE_VERSION` to `v99`, CSS versions to `20260208a`, added 6 restaurant pairing modules + 14 `api/*.js` sub-modules to `STATIC_ASSETS` |

#### Audit Notes

- **No JS logic changed** — all styles are CSS-only, HTML is structural wrappers + toggle
- **Backward compatible** — existing cellar pairing (sommelier + manual) untouched
- **Accessibility** — `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby` on mode toggle
- **Gestalt principles applied** — Closure (wizard border), Continuity (step indicator line), Similarity (burgundy wine / sage dish cards), Figure-Ground (active/dimmed states), Proximity (grouped filters)
- **Pre-existing bug fixed** — 14 `api/*.js` sub-modules were missing from `sw.js` STATIC_ASSETS (offline caching gap)
