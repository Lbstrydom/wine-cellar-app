# Cellar Analysis Fix Plan (Audited)

## Scope

This plan covers 7 known analysis UX and behavior issues and corrects errors in the previous draft. It is reviewed against:

- DRY and SOLID design
- code safety and implementation risk
- UX flow, affordance clarity, and Gestalt grouping/readability

## Critical corrections from previous draft

1. `tests/unit/services/cellar/fridgeStocking.test.js` does not currently exist. It is valid as a new file target, but it is not an existing file to edit.
2. Reordering `renderFridgeStatus`, `renderZoneNarratives`, and `renderMoves` in `public/js/cellarAnalysis/analysis.js` is not required for visual section order. DOM order in `public/index.html` controls reading order.
3. Zone label misalignment is not only `padding-top`. `public/js/grid.js` uses hardcoded `rowHeight = 55`, but slot heights are currently 60/58/56/52 by breakpoint. That causes cumulative drift.
4. The previous zone-label width tweak proposal risks desync with `.grid-legend` left offset. Keep row-label width unchanged unless legend offsets are updated in the same change.
5. Offline-state proposal did not clear all stale sections (`analysis-ai-advice`, `zone-setup-wizard`) and did not include cached fallback in catch path.
6. User-facing rename misses `Reduce Reason` in the wine modal (`public/index.html` line ~883).
7. Out-of-scope but critical: `src/services/cellar/cellarHealth.js` currently calls async `analyseFridge(...)` without `await` and without `cellarId` (around line 352). Fix this separately before relying on fridge metrics.

## Issue 1: Show source slot on fridge Add suggestions

### Problem

Add suggestions show target slot only (for example `Add to F1`) but not source location. User cannot quickly fetch the bottle.

### Root cause

In `public/js/cellarAnalysis/fridge.js` Add-card template (around lines 99-108), `c.fromSlot` is omitted.

### Changes

- `public/js/cellarAnalysis/fridge.js`
  - Add source line under reason text in Add cards.
  - Disable Add button when `fromSlot` is missing (affordance: prevent dead-end action).
- `public/css/components.css`
  - Add `.fridge-source-slot` style.

### UX rationale

- Affordance: required action data (where to fetch) is visible next to the action button.
- Figure-ground: source slot should be visually stronger than descriptive reason text.

## Issue 2: Fill all empty fridge slots and offer alternatives

### Problem

- Candidate generation only runs when `status.hasGaps` is true.
- It fills only `gap.need`, no alternatives.
- Frontend derives target slot repeatedly from unchanged state, so labels can repeat the same slot.

### Root cause

- `src/services/cellar/fridgeStocking.js`
  - `analyseFridge()` gates candidates by `status.hasGaps`.
  - `selectFridgeFillCandidates()` returns only primary fills.

### Design updates (SOLID + UX)

- Keep `candidates` array for compatibility.
- Add `alternatives` as an extra field on `fridgeStatus`.
- Add `targetSlot` to each primary candidate so button labels map to concrete empty slots.
- Add `selectFlexCandidates()` for remaining empty slots after gap fill.

### Changes

- `src/services/cellar/fridgeStocking.js`
  - Extract `buildCandidateObject(...)` (DRY).
  - Keep `selectFridgeFillCandidates(...)` focused on required gap fills.
  - Add `selectFridgeAlternatives(...)` for up to 2 alternates per category.
  - Add `selectFlexCandidates(...)` for leftover empty slots.
  - In `analyseFridge(...)`:
    - run when `status.hasGaps || status.emptySlots > 0`
    - assign deterministic `targetSlot` values to primary candidates
    - append flex candidates until empty slots are covered
    - return `{ ...status, candidates, alternatives, wines }`
- `public/js/cellarAnalysis/fridge.js`
  - Render source slot for primary and alternative entries.
  - Use candidate `targetSlot` for primary button labels.
  - Render alternatives as compact rows with `Use this instead` action (not fake static slot labels).
  - Add alternative click handler.
- `public/css/components.css`
  - Add compact alternatives styles.
- Tests
  - Add new backend tests in `tests/unit/services/cellar/fridgeStocking.test.js`.
  - Add frontend rendering/handler tests in `tests/unit/cellarAnalysis/fridgeSuggestions.test.js` (new file).

### UX rationale

- Similarity + proximity: alternatives grouped under the primary recommendation.
- Affordance consistency: primary buttons map to specific slots; alternatives clearly indicate replacement intent.

## Issue 3: Mobile analysis header crowding

### Problem

Title and actions are cramped on small screens.

### Root cause

`public/css/components.css` defines desktop flex header but has no analysis-specific mobile override.

### Changes

- `public/css/components.css` under the global `@media (max-width: 768px)` block:
  - stack `.analysis-view-header` vertically
  - allow `.analysis-actions` wrapping
  - keep cache/status lines full-width below buttons

### UX rationale

- Proximity: title and controls become distinct scan groups.
- Reduced crowding improves tap accuracy and readability.

## Issue 4: Analysis section order

### Problem

Current order puts fridge before zone/move sections, which interrupts cellar-first workflow.

### Target order

`summary -> alerts -> zones -> moves -> fridge -> AI advice`

### Changes

- `public/index.html`
  - move `#analysis-fridge` block to after `#analysis-moves`.
- `public/js/cellarAnalysis/analysis.js`
  - no render-call reorder required.

### UX rationale

- Continuity: diagnose cellar organization first, then stock fridge from those insights.

## Issue 5: Offline behavior and error messaging

### Problem

Raw `Error: Offline` is shown. Stale sections can remain visible.

### Root cause

`public/js/cellarAnalysis/analysis.js` catch block writes raw error text only.

### Changes

- `public/js/cellarAnalysis/analysis.js`
  - Add helper `renderOfflineState({ hasCachedAnalysis })`.
  - Pre-check `navigator.onLine` before API call.
  - If offline and cached report exists, render cached report and show cache status `Offline - showing cached analysis`.
  - In catch path, treat both `Offline` and fetch/network errors as offline; fall back to cached report when available.
  - Clear/hide all analysis subsections in no-cache offline state:
    - `analysis-alerts`
    - `analysis-zones`
    - `analysis-moves` content/actions
    - `analysis-fridge`
    - `analysis-ai-advice`
    - `zone-setup-wizard`
- `public/css/components.css`
  - Add `.analysis-offline-banner` style.

### UX rationale

- Better recovery affordance: user sees what can still be used (cached state) and what cannot (live analysis).

## Issue 6: Rename user-facing terminology to Drink Soon

### Problem

`Reduce Now` phrasing is unclear for non-technical users.

### Scope

User-facing text only. Keep IDs/routes/table names unchanged (`reduce_now`, `/api/reduce-now`, DOM ids).

### Required text updates in `public/index.html`

- stats label: `Reduce Now` -> `Drink Soon`
- pairing source radio: `Reduce-now only` -> `Drink Soon only`
- settings section title: `Reduce-Now Auto Rules` -> `Drink Soon Auto Rules`
- settings description: `reduce-now list` -> `drink-soon list`
- settings action button: `Add All to Reduce-Now` -> `Add All to Drink Soon`
- modal label: `Reduce Reason` -> `Drink Soon Reason`
- comments updated for consistency (optional but recommended)

### UX rationale

- Language should reflect user intent, not internal system naming.

## Issue 7: Zone labels on cellar grid (visibility + alignment)

### Problem

Zone context is weak on the main grid: no inline row zone name and sidebar labels can misalign.

### Root cause

- `public/js/grid.js` row labels only render `R#`.
- Sidebar label offset does not account for dynamic header/legend heights.
- Hardcoded row height (`55`) is stale versus current slot sizes.

### Changes

- `public/js/grid.js`
  - Add inline `.zone-name` span in row labels when zone data exists.
  - Replace hardcoded `rowHeight` with measured row height from rendered `.cellar-row`.
  - Compute `zone-labels` top padding from measured `.col-headers` and `.grid-legend` heights.
  - Keep `Not configured` fallback behavior.
- `public/css/layout.css`
  - Keep current row-label width unless legend offsets are updated together.
  - Optional: increase `.row-label .zone-name` clarity via font weight/color only.

### UX rationale

- Similarity: repeated row-level zone tags strengthen mapping from bottle to zone.
- Continuity: aligned sidebar blocks match the physical row structure.

## Implementation order

### Phase 1 (low-risk UI and flow)

- Issue 1
- Issue 3
- Issue 4
- Issue 5
- Issue 6
- Issue 7

### Phase 2 (fridge recommendation contract)

- Issue 2 backend + frontend + tests in one PR

Reason: Issue 2 changes recommendation data shape and UI interaction model; keep it atomic.

## Cache busting

After frontend changes:

1. `public/index.html`: bump `/css/styles.css?v=20260208a` -> new date token.
2. `public/sw.js`: bump `CACHE_VERSION` (`v103` -> next value).
3. `public/sw.js`: if any CSS version tokens in `STATIC_ASSETS` changed files, keep those tokens in sync.

## Files summary

- `public/js/cellarAnalysis/fridge.js` (Issues 1, 2)
- `src/services/cellar/fridgeStocking.js` (Issue 2)
- `public/css/components.css` (Issues 1, 2, 3, 5)
- `public/index.html` (Issues 4, 6, cache bust)
- `public/js/cellarAnalysis/analysis.js` (Issue 5)
- `public/js/grid.js` (Issue 7)
- `public/css/layout.css` (Issue 7, optional)
- `tests/unit/services/cellar/fridgeStocking.test.js` (new)
- `tests/unit/cellarAnalysis/fridgeSuggestions.test.js` (new)
- `public/sw.js` (cache bust)

## Verification checklist

1. `npm run test:unit`
2. `rg -n "selectFridgeFillCandidates|analyseFridge" src tests`
3. Manual checks on mobile and desktop:
   - Add suggestions show source slot.
   - Missing-source candidates cannot be clicked.
   - Empty fridge slots are fully covered by primary suggestions.
   - Alternatives are visible and actionable.
   - Header wraps cleanly on mobile.
   - Section order is zones -> moves -> fridge.
   - Offline state shows friendly banner and clears stale sections.
   - Cached analysis renders when offline with prior data.
   - User-facing text consistently says Drink Soon.
   - Zone names appear inline on rows and sidebar labels align to row blocks.
