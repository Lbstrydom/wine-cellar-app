# Code Audit Report: Sommelier Image Attachment & Recipe Import

- **Plan**: `docs/plans/sommelier-image-and-recipe-input.md`
- **Date**: 2026-03-07
- **Auditor**: Claude

---

## Summary

- **Files Planned**: 14 | **Files Found**: 14 | **Missing**: 0
- **HIGH findings**: 3
- **MEDIUM findings**: 5
- **LOW findings**: 3

All 14 planned files were implemented and all tests pass (3,561). However, three HIGH bugs mean
the recipe import and recipe picker flows are silently broken at the API boundary. The security
prerequisites (P1, P2, P3) are correctly implemented and the vision API integration is solid.

---

## Findings

### HIGH Severity

#### [H1] Wiring: `getRecipe()` returns `{ data: recipe }` but callers access `recipe.name` / `recipe.ingredients` directly

- **Files**: `public/js/sommelier.js:590-598`, `public/js/recipes/recipeLibrary.js:197-210`
- **Detail**: The backend `GET /api/recipes/:id` responds with `res.json({ data: recipe })`.
  `handleResponse()` in `api/base.js` returns `JSON.parse(text)` — the full envelope — so
  `getRecipe(id)` resolves to `{ data: { id, name, ingredients, ... } }`.

  In `selectRecipe()` (`sommelier.js:590`), the resolved value is passed directly to
  `buildRecipeDescription(recipe)`, which reads `recipe.name` and `recipe.ingredients`.
  Both are `undefined` on the envelope object. `buildRecipeDescription` returns `''` (empty
  string) and the dish input is cleared. The toast shows `Recipe "undefined" loaded`.

  In `recipeLibrary.js:197`, the new Pair button code also reads `recipe.name` and
  `recipe.ingredients`. `recipe.name` is `undefined` so it silently falls back to
  `btn.dataset.name`; `recipe.ingredients` is `undefined` so no ingredients are ever
  added. The enhancement is a no-op — behaviour is identical to before the feature.

  In `handleImportRecipeUrl()` (`sommelier.js:658`), the same `buildRecipeDescription(recipe)`
  call is made after the URL import — again, the dish input is populated with empty string.

- **Recommendation**: At every call site, unwrap the response before passing to
  `buildRecipeDescription`:
  ```javascript
  // selectRecipe (sommelier.js)
  const { data: recipe } = await getRecipe(recipeId);

  // recipeLibrary.js Pair button
  const { data: recipe } = await getRecipe(recipeId);
  const parts = [recipe?.name || name];
  if (recipe?.ingredients ...) { ... }

  // handleImportRecipeUrl (sommelier.js)
  const { data: recipe } = await getRecipe(recipeId);
  ```
  The plan (Section 13) correctly used `recipe?.data?.ingredients` — the implementation
  dropped the `.data` access at all three call sites.

- **Principle**: Wiring Audit — response shape must be consumed as the backend sends it.

---

### MEDIUM Severity

#### [M1] Image-only prompt instruction not added to the user prompt

- **File**: `src/services/pairing/sommelier.js:115-162`
- **Detail**: Plan Section 10 explicitly specified: *"When image is present but dish text is
  empty, adjust the user prompt to say: 'The user has attached a photo of their dish. Analyze
  the image to identify the dish and its key flavour components, then recommend wines.'"*

  The implementation sets `effectiveDish = '[Image attached — see vision analysis above]'`
  when dish is empty, but does not modify the user prompt. The prompt therefore reads:
  `DISH: [Image attached — see vision analysis above]` with no instruction to analyze the
  image. Claude will usually infer this from the vision block, but the explicit guidance
  planned for image-only submissions is absent, reducing pairing quality when no text is given.

- **Recommendation**: When `imageOpts` is present and `dish` is empty/absent, prepend an
  image-analysis instruction to the user prompt (before the dish and wine list), e.g.:
  ```javascript
  const dishLine = (!dish || !dish.trim())
    ? 'The user has attached a photo of their dish. Analyze the image to identify the dish and its key flavour components, then recommend wines from the list below.'
    : `DISH: ${sanitizedDish}`;
  ```
- **Principle**: Missing state handling — image-only is a documented state that requires
  its own prompt path.

#### [M2] Image not cleared after successful submission

- **File**: `public/js/sommelier.js:67-87` (`handleAskSommelier`)
- **Detail**: The plan's State Management section states *"State is cleared on successful
  submission or manual removal."* The manual testing checklist also includes
  *"Image cleared after successful submission."* After a successful sommelier call,
  `attachedImage` remains set and the thumbnail preview stays visible. On a second
  submission the same image would be re-sent.

- **Recommendation**: Call `clearAttachedImage()` inside the `try` block after
  `renderSommelierResponse(data)`.

- **Principle**: State synchronisation — component state must reflect completed actions.

#### [M3] Recipe modal has no focus trap or focus-return

- **File**: `public/js/sommelier.js:496-506, 727-733` (`openRecipePicker` / `initSommelier`)
- **Detail**: Plan Section 3 (Accessibility) states: *"Recipe picker modal manages focus
  (trap inside, return on close)."* The `openRecipePicker` function calls `searchInput?.focus()`
  on open, but there is no focus trap (Tab can leave the modal) and no focus return when the
  modal closes. The close button and backdrop-click handlers set `display: none` but do not
  restore focus to the Recipe button that opened the modal.

- **Recommendation**: Store a reference to the opener (`sommelier-recipe-btn`) before opening.
  On close, call `opener.focus()`. Add a keydown handler on the modal for Tab/Shift+Tab to
  cycle within focusable modal elements (or use the existing modal manager in `modals.js` if
  it provides a trap).

- **Principle**: Accessibility — Focus Management (Principle 22).

#### [M4] Missing tests: `tests/unit/api/pairing.test.js` and `tests/unit/routes/recipes.test.js`

- **Files**: `tests/unit/api/` (directory does not exist), `tests/unit/routes/recipes.test.js`
- **Detail**: The plan's Section 8 (Testing Strategy) specified:
  - **`tests/unit/api/pairing.test.js`** — 3 tests: `askSommelier` sends image fields when
    provided; omits image fields when null; request body within size limits.
  - **`tests/unit/routes/recipes.test.js`** — 2 tests: `POST /import/url` returns
    `recipe_id` in response; returns `recipe_id: null` when lookup fails.

  Neither file was created. The `recipe_id` return from the URL import route (a plan-specified
  fix) has zero test coverage.

- **Recommendation**: Create both test files as specified in the plan.

- **Principle**: Missing tests for new routes and API contract changes.

#### [M5] `AND deleted_at IS NULL` missing from URL import recipe lookup

- **File**: `src/routes/recipes.js:169-171`
- **Detail**: Plan Section 11 specified the lookup query as:
  ```sql
  SELECT id FROM recipes
  WHERE cellar_id = $1 AND source_provider = $2 AND source_recipe_id = $3
    AND deleted_at IS NULL
  ```
  The implementation omits `AND deleted_at IS NULL`. If a recipe was previously imported and
  then soft-deleted, the lookup would return the deleted row's ID. `getRecipe()` on the
  frontend would then receive a 404 (since `recipeService.getRecipe` filters by `deleted_at`)
  and `handleImportRecipeUrl` would hit the `!recipeId` branch, showing a degraded toast
  instead of populating the dish input correctly.

- **Recommendation**: Add `AND deleted_at IS NULL` to the lookup query.

- **Principle**: Data integrity — soft-delete filter must be consistent across all queries.

---

### LOW Severity

#### [L1] Browse file input uses `accept="*/*"` instead of `accept="image/*"`

- **File**: `public/index.html:496`
- **Detail**: Plan Section 6 specified `accept="image/*"` for `#sommelier-file-input`. The
  implementation uses `accept="*/*"`, so the native file picker on mobile and desktop shows
  all file types rather than filtering to images. The JS change handler does validate the type
  and shows a toast for non-images, so it is not broken — just a worse UX (user must hunt
  through all file types).
- **Recommendation**: Change `accept="*/*"` to `accept="image/*"` on `#sommelier-file-input`.

#### [L2] Recipe picker loads 10 items per page instead of plan's 20

- **File**: `public/js/sommelier.js:25` (`recipePicker.limit = 10`)
- **Detail**: Plan Section 4 specified `listRecipes({ limit: 20 })` for the recipe picker.
  The implementation uses `limit: 10`. This increases the frequency of "Load more" clicks for
  users with larger recipe libraries.
- **Recommendation**: Change `limit: 10` to `limit: 20` in the `recipePicker` state object.

#### [L3] Redundant image-type check in `initSommelier` change handler

- **File**: `public/js/sommelier.js:693-701`
- **Detail**: The `change` handler on `sommelier-file-input` checks
  `!file.type.startsWith('image/')` and shows a toast before calling `handleImageFile`.
  `handleImageFile` also performs the same check independently. The double-check is harmless
  but creates misleading code — it appears `handleImageFile` won't check, when it will.
- **Recommendation**: Remove the duplicate check from the `change` handler in `initSommelier`
  and rely solely on `handleImageFile`'s validation (which covers both the browse and camera
  paths uniformly).

---

## Plan Compliance Summary

| Planned Item | Status | Notes |
|---|---|---|
| P1: `src/services/pairing/sommelier.js` cellar scoping | Implemented | All 3 queries scoped to `cellar_id` |
| P2: `src/routes/pairing.js` chat ownership | Implemented | `stampChatContext` + `validateChatOwnership` on all paths |
| P3: `src/services/shared/inputSanitizer.js` limit 500→2000 | Implemented | `MAX_LENGTHS.dishDescription = 2000` |
| `src/schemas/pairing.js` naturalPairingSchema | Implemented | Either-or refinement, image/mediaType fields, `IMAGE_MEDIA_TYPES` constant |
| `src/routes/pairing.js` image passthrough | Implemented | `imageOpts` built and passed to service |
| `src/services/pairing/sommelier.js` vision block | Implemented | Image block constructed correctly when `imageOpts` present |
| `src/services/pairing/sommelier.js` effectiveDish | Implemented | Fallback `'[Image attached — see vision analysis above]'` used |
| `src/services/pairing/sommelier.js` image-only prompt | **Missing** | No prompt adjustment for image-only sessions [M1] |
| `src/routes/recipes.js` recipe_id return | Implemented | Inline DB lookup added; `deleted_at IS NULL` missing [M5] |
| `public/index.html` textarea + attachment bar | Implemented | textarea, Browse/Photo/Recipe/URL buttons, file inputs, preview, modal |
| `public/js/sommelier.js` image attachment | Implemented | `handleImageFile`, `renderImagePreview`, `clearAttachedImage`, paste handler |
| `public/js/sommelier.js` image clear on submit | **Missing** | `clearAttachedImage()` not called on success [M2] |
| `public/js/sommelier.js` recipe picker | Implemented | Server-side search, pagination, `selectRecipe` — but recipe data unwrapping broken [H1] |
| `public/js/sommelier.js` URL import | Implemented | `handleImportRecipeUrl` — broken by same recipe data issue [H1] |
| `public/js/api/pairing.js` askSommelier signature | Implemented | Accepts `image` param, conditionally includes fields |
| `public/js/recipes/recipeLibrary.js` Pair button enhancement | Partial | Calls `getRecipe` but accesses `recipe.name`/`recipe.ingredients` (not `.data`) — silently broken [H1] |
| `public/css/components.css` attachment styles | Implemented | All planned classes present |
| `public/css/layout.css` responsive rules | Implemented | textarea + attachment bar responsive |
| `public/css/accessibility.css` selector update | Implemented | `.natural-pairing textarea` + URL input added |
| `public/sw.js` cache version bump | Implemented | `CACHE_VERSION = 'v201'`, CSS version strings updated |
| `tests/unit/schemas/naturalPairingSchema.test.js` | Implemented | 10 tests |
| `tests/unit/routes/pairingChatOwnership.test.js` | Implemented | 5 tests (plan specified 6) |
| `tests/unit/services/pairing/sommelier.test.js` | Implemented | 8 tests |
| `tests/unit/services/shared/inputSanitizer.test.js` | Implemented | 7 tests (plan specified 2 updated) |
| `tests/unit/api/pairing.test.js` | **Missing** | 3 planned tests not created [M4] |
| `tests/unit/routes/recipes.test.js` | **Missing** | 2 planned tests not created [M4] |

---

## Wiring Verification

| Frontend Call | Backend Route | Status | Notes |
|---|---|---|---|
| `askSommelier(dish, source, colour, image)` | `POST /api/pairing/natural` | Wired | Correct — body includes `image`/`mediaType` when present |
| `sommelierChat(chatId, message)` | `POST /api/pairing/chat` | Wired | Ownership validation now applied |
| `clearSommelierChat(chatId)` | `DELETE /api/pairing/chat/:chatId` | Wired | Ownership validation now applied |
| `listRecipes({ search, limit, offset })` | `GET /api/recipes` | Wired | Used in recipe picker with server-side search |
| `getRecipe(id)` | `GET /api/recipes/:id` | **Broken** | Returns `{ data: recipe }` but callers read `recipe.name` [H1] |
| `importRecipeFromUrl(url)` | `POST /api/recipes/import/url` | Wired | `recipe_id` now returned; `deleted_at IS NULL` missing [M5] |

---

## Recommendations (Prioritised)

1. **[HIGH] Fix `recipe.data` unwrapping at all 3 call sites** — `selectRecipe()` in
   `sommelier.js`, `handleImportRecipeUrl()` in `sommelier.js`, and the Pair button in
   `recipeLibrary.js`. Change `await getRecipe(id)` to `const { data: recipe } = await getRecipe(id)`.
   This unblocks all recipe import/selection flows.

2. **[HIGH] Fix `recipeLibrary.js` ingredients access** — Change `recipe.ingredients` to
   `recipe?.ingredients` after the `.data` fix above; also handle `typeof recipe.ingredients === 'string'`
   (already handled in the existing code path).

3. **[MEDIUM] Add image-only prompt instruction** — When `imageOpts` is present and `dish` is
   empty, prepend an explicit "Analyze the image to identify the dish" instruction to the user
   prompt before the DISH/CONSTRAINTS block.

4. **[MEDIUM] Clear image after successful submission** — Call `clearAttachedImage()` in the
   `try` block of `handleAskSommelier` after `renderSommelierResponse(data)`.

5. **[MEDIUM] Add focus trap and return to recipe modal** — Store opener reference, return
   focus on close, and cycle Tab within modal focusable elements.

6. **[MEDIUM] Create missing test files** — `tests/unit/api/pairing.test.js` (3 tests) and
   `tests/unit/routes/recipes.test.js` (2 tests) per plan Section 8.

7. **[MEDIUM] Add `AND deleted_at IS NULL`** to the URL import lookup query in
   `src/routes/recipes.js:170`.

8. **[LOW] Change `accept="*/*"` to `accept="image/*"`** on `#sommelier-file-input` in HTML.

9. **[LOW] Change recipe picker `limit` from 10 to 20** in `sommelier.js:25`.

10. **[LOW] Remove redundant type check** from the `change` handler in `initSommelier` —
    rely on `handleImageFile`'s validation.
