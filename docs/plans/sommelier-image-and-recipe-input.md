# Plan: Sommelier Image Attachment & Recipe Import

- **Date**: 2026-03-07
- **Status**: Draft (v4 — revised after third GPT-5.4 audit)
- **Author**: Claude + User
- **Audit v1**: GPT-5.4 surfaced 2 Critical/High security bugs, 2 High UX conflicts, 2 Medium inconsistencies, 3 open questions. All addressed in v2.
- **Audit v2**: GPT-5.4 surfaced 3 High contract gaps, 1 High downstream breakage, 1 Medium mobile regression. All addressed in v3.
- **Audit v3**: GPT-5.4 surfaced 2 Medium internal inconsistencies, 1 Medium underspecified backend, 1 Low stale reference. All addressed below.

---

## 0. Prerequisites (Security & Contract Fixes)

These bugs exist in the current codebase and are on the modification path for this feature.
They MUST be fixed before or as part of this work — not deferred.

### 0a. CRITICAL: Cellar-scoped wine queries in sommelier service

**Bug**: `src/services/pairing/sommelier.js` receives `cellarId` (line 23) but never includes it in SQL queries.
Four queries leak cross-tenant data:

| Line | Query | Missing filter |
|------|-------|----------------|
| 33-48 | `reduce_now` wine list | `AND w.cellar_id = ?` and `AND rn.cellar_id = ?` |
| 50-63 | Full cellar wine list | `AND w.cellar_id = ?` |
| 79-87 | Priority wines section | `WHERE w.cellar_id = ?` (or `AND` when colour filter present) |
| 117 | Pairing history | Already scoped via `getRelevantPairingHistory(cellarId)` — OK |

**Fix**: Add `cellar_id` filter to all three unscoped queries. Use the existing `cellarId` parameter.
The `reduce_now` and `slots` tables should also be joined through cellar-scoped wines.

```javascript
// Line 42: change WHERE 1=1 → WHERE w.cellar_id = ?
// Add cellarId as first param
// Line 57: same pattern
// Lines 79-87: add WHERE w.cellar_id = ? (unconditional), move colour to AND
```

**Tests**: Add unit tests confirming queries include cellar_id. Add negative test confirming wines from other cellars are excluded.

### 0b. HIGH: Chat context ownership validation (ALL write paths + DELETE)

**Bug**: `src/routes/pairing.js:32-44` stores sommelier chat contexts in an in-memory Map keyed by UUID, but neither `POST /chat` (line 104-130) nor `DELETE /chat/:chatId` (line 136-140) validates that the requesting user owns the chat session.

**Additionally**: the `/hybrid` endpoint (line 215) also writes to `chatContexts` without ownership stamps, meaning hybrid chat sessions would fail validation if only `/natural` is fixed.

**Fix**: Apply ownership stamps and validation to ALL paths that touch `chatContexts`:

```javascript
// Helper function (shared across all write paths):
function stampChatContext(context, req) {
  return { ...context, userId: req.user.id, cellarId: req.cellarId };
}

function validateChatOwnership(context, req) {
  if (context.userId !== req.user.id || context.cellarId !== req.cellarId) {
    return false;
  }
  return true;
}

// POST /natural (line 85): add stamps
chatContexts.set(chatId, stampChatContext({
  ...result._chatContext, chatHistory: [], createdAt: Date.now()
}, req));

// POST /hybrid (line 215): add stamps
chatContexts.set(chatId, stampChatContext({
  dish, source, colour, wines, initialResponse: {...},
  chatHistory: [], createdAt: Date.now()
}, req));

// POST /chat (line 113): validate ownership
const context = chatContexts.get(chatId);
if (!context) return res.status(404)...;
if (!validateChatOwnership(context, req)) {
  return res.status(403).json({ error: 'Chat session belongs to another user' });
}

// DELETE /chat/:chatId (line 136): validate before deleting
router.delete('/chat/:chatId', requireAuth, requireCellarContext, (req, res) => {
  const context = chatContexts.get(req.params.chatId);
  if (!context) return res.json({ message: 'Chat session cleared' });
  if (!validateChatOwnership(context, req)) {
    return res.status(403).json({ error: 'Chat session belongs to another user' });
  }
  chatContexts.delete(req.params.chatId);
  res.json({ message: 'Chat session cleared' });
});
```

**Tests**: Add unit tests confirming cross-user chat access returns 403 on POST /chat, DELETE /chat, and that /hybrid contexts also carry stamps.

### 0c. HIGH: Raise sanitizer dish description limit

**Bug**: `naturalPairingSchema` is raised to 2000 chars, but `sanitizeDishDescription()` in `src/services/shared/inputSanitizer.js:145-149` silently truncates to `MAX_LENGTHS.dishDescription = 500`. Recipe imports with ingredients would be chopped before the AI sees them.

**Fix**: Increase `MAX_LENGTHS.dishDescription` from 500 to 2000 in `inputSanitizer.js:39`. This is safe because:
- The schema already validates max length (schema is the trust boundary)
- The sanitizer is a defence-in-depth layer, not the primary validator
- 2000 chars of dish description is ~500 tokens — well within the sommelier prompt budget
- `sanitizeDishDescription` also strips injection patterns, which remains useful at 2000 chars

Alternatively, the sommelier service could use a new `sanitizeRecipeDescription()` with a higher limit, but that's unnecessary indirection — the generic limit just needs to match the schema.

**Tests**: Existing sanitizer tests should be updated to reflect the new limit.

---

## 1. Current UI Audit

### What Exists Today

**Sommelier Input** (`public/index.html:464-483`):
- Single text input (`#dish-input`) with placeholder "Describe your dish..."
- Source filter (All wines / Drink Soon only) — radio buttons
- Colour filter (Any / Red / White / Rose) — radio buttons
- "Ask Sommelier" button
- Results render into `#sommelier-results` with recommendation cards + follow-up chat

**Existing Image Infrastructure**:
- `restaurantPairing/imageCapture.js` — full multi-image capture widget with Browse/Camera/textarea, concurrency queue, parse budget, abort controllers. Heavy-weight — designed for menu parsing with API calls per image.
- `bottles/imageParsing.js` — `resizeImage()` utility (canvas-based resize, JPEG compression, max 2048px). Lightweight, reusable.
- `bottles/imageParsing.js` — paste handler for clipboard screenshots.
- **Mobile image selection**: `imageParsing.js:21-56` deliberately separates "Browse Files" (file input without `capture` — opens gallery) from "Take Photo" (file input with `capture="environment"` — opens camera). This is critical on mobile where a single `accept="image/*"` input without `capture` reliably gives gallery access, while `capture` forces camera-only.

**Existing Recipe Infrastructure**:
- Paprika and Mealie credentials already configured in Settings (`index.html:837-875`)
- `src/services/recipe/` — full recipe sync pipeline with adapters (Paprika, Mealie, JSON-LD, CSV)
- `api/recipes.js` — `listRecipes(params)` with server-side search + pagination (default limit=50)
- `importRecipeFromUrl(url)` already exists at `api/recipes.js:133` — persists recipe, returns `{ message, added, updated, recipe_name }` (but NOT ingredients or recipe ID)
- Recipe pairing exists: `getRecipePairing(recipeId, options)` — separate flow
- **Existing recipe-to-sommelier shortcut**: `recipeLibrary.js:185-197` — "Pair" button on recipe cards switches to Pairing view and pre-fills `#dish-input` with recipe name, then auto-clicks "Ask Sommelier"

**Backend Vision API**:
- `src/services/wine/wineParsing.js` uses Claude vision with `type: 'image'` content blocks
- Shared client: `src/services/ai/claudeClient.js` (180s timeout, singleton)
- Sommelier uses `anthropic.messages.create()` with text-only `messages` array

**Design Language**:
- Dark theme with CSS variables (`--bg-card`, `--border`, `--accent`, `--text-muted`)
- Card-based layouts with `border-radius: 12px`
- `.btn.btn-primary` / `.btn.btn-secondary` / `.btn.btn-small` for buttons
- `.loading-spinner` for async states
- Forms use `filter-group`, `filter-label` patterns

### Pain Points
- The text input is a single line — insufficient for describing complex dishes
- No way to share visual context (photo of a dish being prepared, recipe screenshot)
- Recipe library has a basic pairing shortcut (`recipeLibrary.js:185`) but it only pre-fills the recipe name — not ingredients. The sommelier has no food context beyond the dish name.
- URL import endpoint returns only `recipe_name` — no ingredients, no recipe ID for follow-up lookup

### Reusable Components
- `resizeImage()` from `bottles/imageParsing.js` — direct reuse for image processing
- `listRecipes()` from `api/recipes.js` — server-side search + pagination (already handles large collections)
- `getRecipe(id)` from `api/recipes.js` — fetch full recipe with ingredients by ID
- `apiFetch` from `api/base.js` — all API calls
- `showToast()` from `utils.js` — feedback

---

## 2. User Flow & Wireframe

### Flow A: Photo/Screenshot Attachment

```
1. User sees sommelier input area with textarea
2. Below the textarea, a compact attachment bar shows:
   [Browse/Gallery] [Take Photo] [Recipe]
3a. User clicks "Browse/Gallery" → file picker (gallery on mobile, file browser on desktop)
3b. User clicks "Take Photo" → camera capture (mobile: opens camera directly)
4. Thumbnail preview appears below the textarea with (x) remove button
5. User optionally adds text description alongside (or leaves empty — image-only is valid)
6. Ctrl+Enter (or button click) submits → image + text sent to backend
7. Claude receives image via vision API + text + wine list
8. Response renders as normal
```

### Flow B: Recipe Import

```
1. User clicks "Recipe" button
2. Modal opens with:
   - Search input + scrollable recipe list (server-side search, paginated)
   - "OR import from URL" section at bottom
3a. "From list":
    - User types to search → debounced server query (reuses listRecipes API)
    - Each recipe row shows name, source, category
    - User selects recipe → getRecipe(id) fetches full data → name + ingredients populate textarea
    - Modal closes, image attachment still available alongside
3b. "From URL":
    - URL input + "Import & Use" button
    - Calls importRecipeFromUrl() → backend returns recipe_id (see Section 4)
    - Uses returned recipe_id → getRecipe(recipe_id) → name + ingredients populate textarea
    - Fallback: if recipe_id is null, populate with returned recipe_name only
    - On success: modal closes, textarea populated, recipe saved to library
4. User reviews populated text, optionally edits, optionally attaches photo
5. Ctrl+Enter or button click submits
```

### Wireframe — Sommelier Input Area

```
┌─────────────────────────────────────────────────┐
│  Ask the Sommelier                              │
│                                                 │
│  ┌─────────────────────────────────────────────┐│
│  │ Describe your dish...                       ││
│  │ (textarea, 3 rows, auto-expand)             ││
│  │                              Ctrl+Enter ↵   ││
│  └─────────────────────────────────────────────┘│
│                                                 │
│  ┌──────────┐  (thumbnail appears when attached)│
│  │  [img]   │  ✕                                │
│  │ 80x80    │                                   │
│  └──────────┘                                   │
│                                                 │
│  [📁 Browse] [📷 Photo] [📖 Recipe]     (compact)│
│                                                 │
│  Source: ○ All wines  ○ Drink Soon only          │
│  Colour: ○ Any  ○ Red  ○ White  ○ Rose          │
│                                                 │
│  [ Ask Sommelier ]                              │
└─────────────────────────────────────────────────┘
```

### Wireframe — Recipe Picker Modal

```
┌────────────────────────────────────────┐
│  Import Recipe                    [✕]  │
│                                        │
│  ┌────────────────────────────────────┐│
│  │ Search recipes...                 ││
│  └────────────────────────────────────┘│
│                                        │
│  ┌────────────────────────────────────┐│
│  │ Grilled Salmon with Herb Crust    ││
│  │ Paprika · Seafood                 ││
│  ├────────────────────────────────────┤│
│  │ Beef Bourguignon                  ││
│  │ Mealie · French                   ││
│  ├────────────────────────────────────┤│
│  │ ...                               ││
│  └────────────────────────────────────┘│
│  [Load More]  (if more pages exist)    │
│                                        │
│  ── OR import from URL ──              │
│  ┌──────────────────────┐ [Import]     │
│  │ https://...          │              │
│  └──────────────────────┘              │
│  (saves to library & fills input)      │
└────────────────────────────────────────┘
```

---

## 3. UX Design Decisions

### Progressive Disclosure (Principle 13)
- The primary input remains the textarea — simple and familiar
- Attachment options are a compact button row below, not competing for attention
- Recipe picker is a modal — shown only on demand
- URL import is a secondary option within the recipe modal

### Proximity & Common Region (Principles 1, 6)
- Attachment buttons grouped together in one row below the textarea
- Image preview appears between textarea and attachment buttons (visual association)
- Source/colour filters stay in their existing position (consistency)

### Consistency (Principle 10)
- Image thumbnail style mirrors the restaurant pairing pattern (rounded corners, ✕ remove)
- Recipe picker modal follows the same pattern as the wine picker modal (`#wine-picker-modal`)
- Button sizing matches existing `.btn.btn-secondary.btn-small`
- **Two image buttons** (Browse + Photo) mirrors the pattern in `imageParsing.js` and `imageCapture.js` — both existing image features separate gallery from camera

### Feedback & System Status (Principle 11)
- Image upload shows a loading spinner on the thumbnail while resizing
- Recipe fetch shows loading state on the Import button
- "Ask Sommelier" button shows "Thinking..." with spinner (existing pattern)
- Toast messages for errors (existing pattern)

### Error Prevention (Principle 12)
- Only one image allowed (sommelier context, not menu parsing — keep it simple)
- Image validated for type (JPEG, PNG, WebP, GIF) before processing
- URL validated before fetch attempt
- Recipe selection auto-populates but remains editable

### Textarea Submit Key Convention (Principle 4 — Match Real World)

**Decision**: Plain Enter inserts a newline. **Ctrl+Enter** (or Cmd+Enter on Mac) submits.

**Rationale**: The entire purpose of moving from `<input>` to `<textarea>` is to support multi-line recipe content. Having Enter submit would break this. Ctrl+Enter is the established convention for multi-line inputs that also support submission (Slack, Discord, GitHub comments, etc.).

The textarea will show a subtle hint: `Ctrl+Enter to submit` aligned bottom-right inside the field. The "Ask Sommelier" button remains as the primary visual submit affordance.

### Image-Only Submission Contract (Principle 26 — No Dark Patterns)

**Decision**: Image-only submission IS allowed. Text is optional when an image is attached.

**Rationale**: A photo of a dish on the table is fully sufficient context for a sommelier. Forcing the user to also type something ("uh, it's the dish in the photo") would be artificial friction.

**Contract**:
- At least one of `dish` (text) or `image` must be present
- `dish` can be empty string when `image` is provided
- `dish` alone (no image) is the normal text-only flow
- Neither present → validation error

**Downstream pairing session handling**: When `dish` is empty (image-only), the sommelier service generates `dish_analysis` from the image. This `dish_analysis` string is used as the `dish_description` when persisting the pairing session via `createPairingSession()` (`pairingSession.js:40`). This ensures:
- `pairing_sessions.dish_description` is never blank
- Pending rating reminders (`ratingReminder.js:167`) display pairing context — they read `pairing_dish` which comes from `COALESCE(ps.dish_description, ...)` in `pendingRatings.js:29`
- Pairing feedback flow works normally

**Note**: The Consumption History tab (`stats.js:283`) reads `consumption_log.pairing_dish`, which is a separate column set at drink-time by the `drinkBottle` flow (not by the sommelier). That column is populated from `pairing_sessions.dish_description` when the user drinks a bottle from a pairing session. So the `effectiveDish` fallback propagates transitively — but only if the user actually drinks via the pairing session's "Drink This Bottle" action. Direct drinks without a pairing session will still show no pairing dish, which is correct behaviour.

```javascript
// In sommelier service, after AI response:
const effectiveDish = dish || parsed.dish_analysis || 'Dish from photo';
// Use effectiveDish when calling createPairingSession()
```

### Fitts's Law (Principle 16)
- "Ask Sommelier" remains the largest, most prominent button (primary action)
- Attachment buttons are secondary size — discoverable but not competing
- Remove (✕) on image is small but has adequate touch target (32px minimum)

### Accessibility (Principles 19-22)
- All buttons have `aria-label` attributes
- Image preview has `alt` text
- Recipe modal manages focus (trap inside, return on close)
- File inputs are hidden with visible button proxies (existing pattern)
- Keyboard: Ctrl+Enter submits from textarea; Tab navigates to buttons

### Hick's Law (Principle 15)
- Three attachment options (Browse, Photo, Recipe) — same count as restaurant pairing's capture widget
- On desktop, "Photo" button can be hidden (no camera) or shown based on `navigator.mediaDevices` availability
- Recipe picker has search to reduce scanning

### Mobile Gallery vs Camera (Principle 10 — Consistency)

**Decision**: Two separate image buttons: "Browse" (gallery/file picker) and "Photo" (camera capture).

**Rationale**: The existing `imageParsing.js` (lines 21-56) deliberately separates these because:
- `<input type="file" accept="image/*">` (no `capture`) → gallery/file picker on all platforms
- `<input type="file" accept="image/*" capture="environment">` → camera only on mobile

A single button cannot reliably offer both. Merging them would force either camera-only (losing gallery access) or gallery-only (losing quick camera capture). The restaurant pairing widget also uses this two-button pattern.

---

## 4. Technical Architecture

### Component Diagram

```
sommelier.js (modified)
  ├── Imports resizeImage() from bottles/imageParsing.js
  ├── Imports listRecipes(), getRecipe(), importRecipeFromUrl() from api/ (existing)
  ├── Manages attachment state (image base64)
  ├── Renders attachment bar + preview
  ├── Opens/manages recipe picker modal
  └── Passes image data to askSommelier()

api/pairing.js (modified)
  └── askSommelier(dish, source, colour, image?) — adds optional image fields

pairing route (modified)
  ├── POST /natural — accepts optional image + mediaType
  ├── POST /natural, POST /hybrid — add ownership stamps
  ├── POST /chat — validate ownership
  └── DELETE /chat/:chatId — validate ownership before delete

sommelier service (modified)
  ├── Cellar-scoped queries (Section 0a)
  ├── Vision content block when image present
  └── effectiveDish fallback for image-only sessions

inputSanitizer.js (modified)
  └── MAX_LENGTHS.dishDescription: 500 → 2000

recipes route (modified)
  └── POST /import/url — return recipe ID in response (for follow-up getRecipe)

recipeLibrary.js (modified)
  └── "Pair" button enhanced — pre-fills name + ingredients (not just name)
```

### State Management (Principle 32 — State Locality)

All attachment state lives in `sommelier.js` module scope (not global):

```javascript
// Module-level state
let attachedImage = null;   // { base64, mediaType, dataUrl }
```

State is cleared on successful submission or manual removal.
No `importedRecipe` state needed — recipe import just populates the textarea directly.

### Event Handling (Principles 36-37)

- Attachment buttons use direct `addEventListener` (static elements created once)
- Recipe list items use event delegation on the list container
- File input change handlers follow existing pattern from `imageParsing.js`
- Paste handler for screenshots attached to the `.natural-pairing` container
- Ctrl+Enter handler on textarea for submission
- Zero inline handlers (CSP compliant)

### Recipe Picker: Server-Side Search + Pagination

The recipe picker MUST use server-side search, not client-side filtering. The existing `listRecipes()` API supports `search`, `limit`, and `offset` parameters (default limit=50). The picker will:

1. On modal open: call `listRecipes({ limit: 20 })` for initial page
2. On search input (debounced 300ms): call `listRecipes({ search: query, limit: 20 })`
3. "Load More" button: call `listRecipes({ search, limit: 20, offset: currentOffset })`
4. Track `hasMore` flag from `result.total > loadedCount`

This mirrors the pattern already used in `recipeLibrary.js:107-114`.

### URL Import: Closing the Return-Data Gap

**Problem identified in audit v2**: `POST /api/recipes/import/url` returns `{ message, added, updated, recipe_name }` but NOT the recipe ID or ingredients. The frontend cannot populate the textarea without a follow-up lookup.

**Fix**: Modify the import endpoint to return the recipe ID:

```javascript
// In src/routes/recipes.js, POST /import/url:
const result = await recipeService.importRecipes(recipes, req.cellarId);
// Also look up the just-imported recipe to get its ID
const imported = await recipeService.findRecipeBySourceId(
  req.cellarId, recipes[0].source_provider, recipes[0].source_recipe_id
);
res.json({
  message: result.added > 0 ? 'Recipe imported' : 'Recipe updated',
  ...result,
  recipe_name: recipes[0].name,
  recipe_id: imported?.id || null  // NEW: return ID for follow-up getRecipe()
});
```

The frontend then does: `importRecipeFromUrl(url)` → use returned `recipe_id` → `getRecipe(recipe_id)` → populate textarea with name + ingredients.

If `recipe_id` is null (edge case), fall back to populating with `recipe_name` only.

---

## 5. State Map

### Sommelier Input Area

| State | What User Sees |
|-------|---------------|
| **Empty** | Textarea with placeholder + Ctrl+Enter hint, attachment buttons enabled, no preview |
| **Text only** | Textarea with content, "Ask Sommelier" enabled |
| **Image only** | Thumbnail preview with ✕ button, textarea empty but submission still valid |
| **Image + text** | Both present, "Ask Sommelier" enabled |
| **Recipe imported** | Textarea auto-populated with recipe name + ingredients, editable |
| **Loading (resize)** | Small spinner on thumbnail area while image processes |
| **Loading (sommelier)** | Button shows spinner + "Thinking...", inputs disabled |
| **Error (image)** | Toast message, no preview shown, inputs remain enabled |
| **Error (sommelier)** | Error message in results area (existing pattern) |

### Recipe Picker Modal

| State | What User Sees |
|-------|---------------|
| **Empty (no recipes)** | "No recipes synced. Configure Paprika or Mealie in Settings." with link |
| **Loading recipes** | Spinner in modal body |
| **Populated** | Scrollable list of recipes with "Load More" if paginated |
| **Search active** | Filtered results from server query |
| **URL import loading** | "Import" button shows spinner |
| **URL import error** | Toast + error text below URL input |
| **URL import success** | Modal closes, textarea populated, recipe saved to library |

---

## 6. File-Level Plan

### Prerequisite fixes (Section 0)

#### P1. `src/services/pairing/sommelier.js`
**Security fix**: Add `AND w.cellar_id = ?` to all three unscoped wine queries (lines 42, 57, 79-84). Add `cellarId` to params arrays. The priority query (line 79) needs restructuring since it conditionally includes WHERE.

#### P2. `src/routes/pairing.js`
**Security fix**: Add `userId` and `cellarId` ownership stamps on ALL `chatContexts.set()` calls (POST /natural line 85, POST /hybrid line 215). Add ownership validation on POST /chat (line 113) and DELETE /chat/:chatId (line 136). Extract `stampChatContext()` and `validateChatOwnership()` helpers.

#### P3. `src/services/shared/inputSanitizer.js`
**Contract fix**: Increase `MAX_LENGTHS.dishDescription` from 500 to 2000 (line 39). Update any unit tests that assert the old limit.

### Feature files

#### 1. `public/index.html`
**Changes**: Replace `<input type="text" id="dish-input">` with `<textarea>`, add attachment bar HTML, add recipe picker modal shell, add hidden file inputs.

**Key elements**:
- `<textarea id="dish-input" rows="3">` — replaces single-line input
- `<div class="sommelier-attachments">` — attachment button row (Browse, Photo, Recipe)
- `<div class="sommelier-image-preview" id="sommelier-image-preview">` — image thumbnail container (initially empty)
- `<div id="recipe-picker-modal" class="modal-overlay" style="display:none">` — recipe import modal
- `<input type="file" id="sommelier-file-input" accept="image/*" hidden>` — gallery/file picker (NO `capture`)
- `<input type="file" id="sommelier-camera-input" accept="image/*" capture="environment" hidden>` — camera capture

#### 2. `public/js/sommelier.js`
**Changes**: Image attachment, recipe picker, paste handler, Ctrl+Enter submit, modify `handleAskSommelier()` to include image data.

**Key functions** (new):
- `handleBrowseImage()` — triggers file input (gallery/file picker)
- `handleCapturePhoto()` — triggers camera input
- `handleImageFile(file)` — validates type, processes via `resizeImage()`, stores in `attachedImage`
- `handlePasteImage(e)` — clipboard paste handler for screenshots
- `renderImagePreview()` / `clearAttachedImage()` — thumbnail preview management
- `openRecipePicker()` — opens modal, loads first page via `listRecipes({ limit: 20 })`
- `handleRecipeSearch(query)` — debounced server-side search via `listRecipes({ search, limit: 20 })`
- `handleRecipeLoadMore()` — pagination via `listRecipes({ search, limit: 20, offset })`
- `renderRecipePickerResults(recipes, total)` — renders list + "Load More" button
- `selectRecipe(recipe)` — fetches full recipe via `getRecipe(id)`, populates textarea with `"${name}\n\nIngredients:\n${ingredients}"`, closes modal
- `handleImportRecipeUrl()` — calls `importRecipeFromUrl()`, then `getRecipe(recipe_id)` to get ingredients, populates textarea

**Modified functions**:
- `handleAskSommelier()` — reads `attachedImage`, allows image-only submission, passes to `askSommelier()`
- `initSommelier()` — wires new event listeners, paste handler, Ctrl+Enter on textarea (replaces Enter-submit)

#### 3. `public/js/api/pairing.js`
**Changes**: Extend `askSommelier()` to accept optional image parameter.

```javascript
export async function askSommelier(dish, source, colour, image = null) {
  const body = { dish, source, colour };
  if (image) {
    body.image = image.base64;
    body.mediaType = image.mediaType;
  }
  // ... existing fetch
}
```

#### 4. `public/js/api/index.js`
**No changes needed** — `importRecipeFromUrl` is already re-exported at line 224.

#### 5. `public/css/components.css`
**Changes**: Add sommelier attachment styles, update `#dish-input` selectors for textarea.

**New classes**:
- `.sommelier-attachments` — flex row for attachment buttons
- `.sommelier-image-preview` — container for thumbnail (hidden when empty)
- `.sommelier-image-thumb` — thumbnail styling (mirrors `.restaurant-image-thumb` visual)
- `.sommelier-image-remove` — ✕ button on thumbnail (mirrors `.restaurant-image-remove`)
- `.sommelier-submit-hint` — subtle "Ctrl+Enter" hint inside textarea area
- `.recipe-picker-list` — scrollable recipe list in modal
- `.recipe-picker-item` — individual recipe row (clickable, hover state)
- `.recipe-picker-item-source` — muted source/category label
- `#dish-input` / `.natural-pairing textarea` — update from `input[type="text"]` selectors

#### 6. `public/css/layout.css`
**Changes**: Update responsive rules for `.natural-pairing` (textarea + attachment row). Mobile: attachment buttons wrap, textarea full-width.

#### 7. `public/css/accessibility.css`
**Changes**: Update `.natural-pairing input[type="text"]` selector (line 103) to `.natural-pairing textarea`.

#### 8. `src/schemas/pairing.js`
**Changes**: Extend `naturalPairingSchema` — make `dish` optional when image present.

```javascript
export const naturalPairingSchema = z.object({
  dish: z.string().max(2000).trim().default(''),
  source: z.string().max(50).default('all'),
  colour: z.string().max(20).default('any'),
  image: z.string().max(5_000_000).optional(),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']).optional()
}).refine(
  data => (data.dish && data.dish.length > 0) || data.image,
  { message: 'Provide a dish description or attach an image' }
).refine(
  data => !data.image || data.mediaType,
  { message: 'mediaType required when image is provided' }
);
```

#### 9. `src/routes/pairing.js`
**Changes**: Pass image data through to sommelier service. Add ownership stamps/validation to all chat context paths (see Section 0b).

#### 10. `src/services/pairing/sommelier.js`
**Changes**: (a) Fix cellar-scoped queries (Section 0a). (b) Accept optional `imageOpts` parameter. (c) Build vision-enabled content block when image present. (d) Use `effectiveDish` fallback for pairing session persistence.

```javascript
// Signature change:
export async function getSommelierRecommendation(db, dish, source, colour, cellarId, imageOpts = {}) {

// Content block construction:
const content = [];
if (imageOpts?.image && imageOpts?.mediaType) {
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: imageOpts.mediaType, data: imageOpts.image }
  });
}
content.push({ type: 'text', text: userPrompt });

// After AI response, derive effectiveDish for createPairingSession():
const effectiveDish = dish || parsed.dish_analysis || 'Dish from photo';
```

When image is present but dish text is empty, adjust the user prompt to say:
"The user has attached a photo of their dish. Analyze the image to identify the dish and its key flavour components, then recommend wines."

#### 11. `src/routes/recipes.js`
**Changes**: Modify `POST /import/url` to return `recipe_id` in response (for follow-up `getRecipe()` lookup).

After the existing `importRecipes()` call, add a direct DB lookup to find the just-imported recipe:

```javascript
// After importRecipes() succeeds:
const imported = await db.prepare(`
  SELECT id FROM recipes
  WHERE cellar_id = $1 AND source_provider = $2 AND source_recipe_id = $3
    AND deleted_at IS NULL
`).get(req.cellarId, recipes[0].source_provider, recipes[0].source_recipe_id);

res.json({
  message: result.added > 0 ? 'Recipe imported' : 'Recipe updated',
  ...result,
  recipe_name: recipes[0].name,
  recipe_id: imported?.id ?? null  // NEW
});
```

This avoids creating a new service helper — the query is a one-line lookup on the existing unique constraint `(cellar_id, source_provider, source_recipe_id)`.

#### 12. `src/services/recipe/recipeService.js`
**No changes needed** — the recipe ID lookup is handled inline in the route (see above). The existing `importRecipes()` return signature is unchanged.

#### 13. `public/js/recipes/recipeLibrary.js`
**Changes**: Enhance the existing "Pair" button shortcut (line 186-197) to pre-fill ingredients alongside the recipe name. Currently it only fills `name`:

```javascript
// BEFORE (line 193-194):
dishInput.value = name;

// AFTER:
const recipe = await getRecipe(id);
const ingredients = recipe?.data?.ingredients || '';
dishInput.value = ingredients
  ? `${name}\n\nIngredients:\n${ingredients}`
  : name;
```

This makes the existing shortcut and the new recipe picker produce consistent sommelier input.

#### 14. `public/sw.js`
**Changes**: No new JS modules created. Bump `CACHE_VERSION` only.

---

## 7. Risk & Trade-off Register

### Trade-offs Made

| Decision | Alternative | Rationale |
|----------|-------------|-----------|
| Single image only | Multi-image like restaurant pairing | Sommelier is about one dish — multi-image adds complexity without clear benefit. Keeps payload small. |
| Textarea replaces input | Keep input, add separate textarea | Textarea better suits recipe descriptions and multi-line input. Single input point is clearer. |
| Ctrl+Enter to submit | Enter submits (current), or submit-on-button-only | Ctrl+Enter is the established convention for multi-line inputs (Slack, Discord, GitHub). Plain Enter must insert newlines for the textarea to be useful. Button remains as fallback. |
| Image-only allowed | Require text always | A photo of a dish is sufficient context. Forcing redundant text is artificial friction. `effectiveDish` fallback handles downstream persistence. |
| Two image buttons (Browse + Photo) | Single "Photo" button | Mobile platforms need separate `capture` and non-`capture` file inputs to reliably offer both gallery and camera. Existing codebase uses this pattern in `imageParsing.js` and `imageCapture.js`. |
| Recipe text populate (not recipe ID) | Send recipe ID to backend | Populating text lets user edit/refine. More transparent — user sees exactly what the sommelier receives. |
| URL import persists + uses | Fetch-only (no save) | Saves are a feature — builds the recipe library. Requires adding `recipe_id` to import response. |
| Server-side recipe search | Client-side filter of full list | Recipe collections can be large (Paprika syncs hundreds). `listRecipes()` already supports server-side search + pagination. |
| Enhance existing "Pair" shortcut | Replace with new picker only | The shortcut in recipeLibrary.js is useful on its own. Enhancing it (add ingredients) makes both paths consistent. |
| Raise sanitizer limit to 2000 | New sanitizer function | One limit change is simpler than a new function. Schema is the trust boundary; sanitizer is defence-in-depth. |

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large base64 payloads slow request | Medium | `resizeImage()` caps at 2048px + JPEG compression. Schema caps at 5MB. |
| Recipe URL fetch fails on many sites | Low | Graceful error toast. Existing `importRecipeFromUrl` handles this. User can still manually describe. |
| Vision API increases Claude cost | Low | Single image per request, sommelier already rate-limited. |
| Textarea height on mobile | Low | CSS `resize: vertical` + `max-height: 200px`. Test on mobile. |
| Ctrl+Enter unfamiliar to some users | Low | Visual hint in textarea + button always visible as fallback. |
| URL import returns no recipe_id | Low | Requires small backend change. Fallback: populate with recipe_name only. |

### Deliberately Deferred

- **Multi-image support** — not needed for sommelier (one dish = one photo)
- **Image in follow-up chat** — first iteration only supports image on initial request
- **Drag-and-drop on textarea** — nice-to-have, not essential for v1
- **Recipe image display** — could show recipe photo alongside thumbnail but adds complexity

---

## 8. Testing Strategy

### Unit Tests — Schema & Validation

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/schemas/pairing.test.js` | 6 new | `naturalPairingSchema`: accepts dish-only, image-only, both; rejects neither; rejects image without mediaType; validates mediaType enum |

### Unit Tests — Sommelier Service

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/services/pairing/sommelier.test.js` | 10 new | (1) Wine query includes `cellar_id` for `source=all`; (2) Wine query includes `cellar_id` for `source=reduce_now`; (3) Priority query includes `cellar_id`; (4) Wines from other cellars excluded; (5) Vision content block constructed when image present; (6) Text-only content block when no image; (7) Image-only prompt includes "analyze the image" instruction; (8) Empty dish + no image throws validation error; (9) `effectiveDish` falls back to `dish_analysis` for image-only; (10) `effectiveDish` falls back to 'Dish from photo' when no analysis |

### Unit Tests — Route Ownership

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/routes/pairing.test.js` | 6 new | (1) POST /natural stores userId + cellarId on chat context; (2) POST /hybrid stores userId + cellarId on chat context; (3) POST /chat returns 403 for wrong userId; (4) POST /chat returns 403 for wrong cellarId; (5) DELETE /chat returns 403 for wrong user; (6) POST /chat returns 404 for expired context |

### Unit Tests — Frontend API

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/api/pairing.test.js` | 3 new | (1) `askSommelier` sends image fields when provided; (2) `askSommelier` omits image fields when null; (3) Request body size within limits |

### Unit Tests — Sanitizer

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/services/shared/inputSanitizer.test.js` | 2 updated | (1) `sanitizeDishDescription` allows up to 2000 chars; (2) Truncates at 2001 chars |

### Unit Tests — Recipe Import

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/routes/recipes.test.js` | 2 new | (1) POST /import/url returns `recipe_id` in response; (2) POST /import/url returns `recipe_id: null` when lookup fails |

### Regression Tests

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/utils/apiAuthHeaders.test.js` | existing | Ensure no new raw `fetch('/api/...')` patterns |
| `tests/unit/utils/swStaticAssets.test.js` | existing | Ensure no missing `STATIC_ASSETS` entries |

**Total new/updated tests: 29**

### Visual/Manual Testing Checklist

- [ ] Textarea renders correctly, placeholder visible, Ctrl+Enter hint shown
- [ ] Plain Enter inserts newline in textarea
- [ ] Ctrl+Enter (Cmd+Enter on Mac) triggers "Ask Sommelier"
- [ ] Button click still triggers "Ask Sommelier"
- [ ] "Browse" button opens gallery/file picker on both desktop and mobile
- [ ] "Photo" button opens camera on mobile
- [ ] Selected image shows thumbnail preview with ✕ button
- [ ] Clicking ✕ removes image, re-enables attachment
- [ ] Pasting screenshot from clipboard attaches image
- [ ] Submitting with image only (no text) works — sommelier analyzes photo
- [ ] Image-only pairing session shows dish_analysis in pending-rating reminders (not blank)
- [ ] Image-only session → drink via pairing → consumption history shows pairing_dish (not blank)
- [ ] Submitting with text only works (existing behaviour preserved)
- [ ] Submitting with both image + text works
- [ ] "Recipe" button opens recipe picker modal
- [ ] Recipe list loads first page, search filters via server query (debounced)
- [ ] "Load More" fetches next page
- [ ] Selecting recipe populates textarea with name + ingredients (not just name)
- [ ] URL import persists recipe, populates textarea with name + ingredients
- [ ] URL import shows error toast on failure
- [ ] Empty recipe library shows "Configure in Settings" message
- [ ] Sommelier response renders correctly (existing behaviour preserved)
- [ ] Follow-up chat still works after image-based initial query
- [ ] Image cleared after successful submission
- [ ] Existing recipe library "Pair" button now pre-fills name + ingredients
- [ ] Cross-user chat access returns 403 on POST /chat (test via devtools)
- [ ] Cross-user chat delete returns 403 on DELETE /chat (test via devtools)
- [ ] Hybrid pairing chat contexts carry ownership stamps
- [ ] Long recipe description (>500 chars) reaches AI unsanitized-truncated

### Accessibility Testing

- [ ] Tab through all new interactive elements in order
- [ ] Screen reader announces attachment buttons, image preview, recipe list items
- [ ] Focus moves into recipe modal on open, returns on close
- [ ] File inputs are not focusable (hidden), proxy buttons are
- [ ] Ctrl+Enter hint visible to all users (not colour-dependent)

### Responsive Breakpoints

- [ ] Desktop (>768px): attachment buttons in row, thumbnail inline
- [ ] Mobile (<768px): attachment buttons wrap, textarea full-width, touch targets ≥44px
- [ ] Textarea height appropriate on both

---

## 9. Implementation Order

1. **Security prerequisite P1**: Fix cellar-scoped queries in `sommelier.js` + add tests
2. **Security prerequisite P2**: Add chat ownership validation to ALL chat paths in `pairing.js` route + add tests
3. **Contract prerequisite P3**: Raise `MAX_LENGTHS.dishDescription` to 2000 in `inputSanitizer.js` + update tests
4. **Backend: recipe import**: Add `recipe_id` to `POST /import/url` response + add tests
5. **Schema**: Extend `naturalPairingSchema` with optional image + either-or refinement
6. **Backend service**: Add `imageOpts` parameter to `getSommelierRecommendation()`, build vision content block, `effectiveDish` fallback
7. **Backend route**: Pass image data through, wire ownership stamps
8. **Frontend HTML**: Textarea swap + attachment bar (Browse + Photo + Recipe) + hidden inputs + modal shell
9. **Frontend JS**: Image attachment flow in `sommelier.js` (Ctrl+Enter, paste, browse, camera)
10. **Frontend JS**: Recipe picker flow in `sommelier.js` (server-side search, pagination, URL import with `getRecipe()` follow-up)
11. **Frontend JS**: Enhance `recipeLibrary.js` "Pair" shortcut to include ingredients
12. **Frontend API**: Extend `askSommelier()` signature, ensure `importRecipeFromUrl` is re-exported
13. **CSS**: Attachment styles + textarea selectors + responsive adjustments
14. **Cache**: Bump `CACHE_VERSION` in `sw.js`
15. **Tests**: All unit tests from Section 8 + manual verification
