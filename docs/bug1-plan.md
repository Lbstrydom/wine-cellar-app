# Comprehensive UX Overhaul Plan

## Context

The user performed a systematic UX audit of every tab, dialog, and sub-view of the Wine Cellar App, plus identified three major cellar-management issues (broken bottle count, zone consolidation paradox, 52-move chaos). This plan addresses ALL findings across 5 phases, from quick bug fixes through major architectural improvements.

**Reviewer feedback incorporated**: All 15 corrections from two independent reviewers have been verified against the codebase and accepted where accurate. Changes marked with [R] below.

### Implementation Progress (28 Feb 2026)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | ✅ Done (1.1, 1.2 partial, 1.3) | 1.2 prevention in place; DB cleanup pending |
| Phase 2 | ✅ Done (2.1, 2.2, 2.3, 2.4) | Table view, inline edit, batch ratings, toggle |
| Phase 3 | ✅ Done (3.1, 3.2, 3.3) | sortPlan primary, zone-grouped, cycle detection |
| Phase 4 | ✅ Done (4.1-4.4, 4.6, 4.7) | 4.5 (history grouping) deferred |
| Phase 5 | ✅ Done (5.1–5.8) | Shipped 28 Feb 2026 — see notes below |

---

## Phase 1: Critical Bug Fixes (Quick Wins)

### 1.1 Fix Wine List bottle count concatenation bug ✅ DONE
**Files**: `src/routes/wines.js` (line 212), `public/js/app.js` (line 839)
**Problem**: PostgreSQL `COUNT()` returns strings via `pg` driver. `reduce((sum, w) => sum + w.bottle_count, 0)` concatenates instead of adding → shows "0121151111…" instead of "94 bottles".
**Fix (two layers)** [R: fix at SQL root, not just frontend]:
1. **SQL root fix**: Change `COUNT(s.id) as bottle_count` → `CAST(COUNT(s.id) AS INTEGER) as bottle_count` in `src/routes/wines.js` GET endpoint
2. **Frontend defence**: `sum + Number(w.bottle_count)` in `app.js` line 839 + explicit `Number(w.bottle_count) > 0` at line 754

### 1.2 Fix empty parentheses on grid ("Kleine Zalze Shiraz ( )") — ✅ PARTIAL (prevention done, DB cleanup pending)
**Files**: Data investigation needed first; then possibly `public/js/bottles.js` or import pipeline
**Problem** [R: likely stored in wine_name, not a grid rendering bug]: Verified — `grid.js` renders `slot.wine_name` directly (line 586). The `( )` is in the stored wine_name field, not constructed at render time.
**Fix**:
1. **Investigate**: Query DB for wines with `wine_name LIKE '% ( )%'` or `wine_name LIKE '% ()%'` to confirm
2. **Clean existing data**: SQL update to strip trailing ` ( )` from affected wine_name records
3. **Prevent recurrence**: Add sanitisation in wine creation/import pipeline — strip empty `()` or `( )` suffix before save

### 1.3 Fix "At a Restaurant" wizard step label spacing ✅ DONE
**Files** [R: CSS/layout issue, not state.js]: `public/css/styles.css` — step indicator styling
**Problem**: "CaptureWines DishesPairings" labels run together. The step state logic (`state.js`) is correct; the rendering/CSS has insufficient spacing between step labels.
**Fix**: Add `gap`, `margin`, or separator styling to the step indicator CSS. Inspect the step label container and add appropriate flex gap or padding between step items.

---

## Phase 2: Wine List Table View Overhaul ✅ DONE

### 2.1 Expand GET /api/wines response + fix pagination ✅ DONE
**Files**: `src/routes/wines.js` (lines 209-226), `public/js/api/wines.js`
**Current**: Returns 9 columns (id, style, colour, wine_name, vintage, vivino_rating, price_eur, bottle_count, locations).
**Changes**:
1. **Add columns to SELECT + GROUP BY**: `producer`, `country`, `region`, `grapes`, `drink_from`, `drink_until`, `zone_id`
2. **CAST bottle count**: `CAST(COUNT(s.id) AS INTEGER) as bottle_count` (see 1.1)
3. [R: pagination blocks table completeness] **Fix fetchWines() limit**: Update `public/js/api/wines.js` `fetchWines()` to pass `?limit=500` (current max allowed by backend). For cellars with 500+ wines (unlikely for personal use), add a "Load more" button. The backend already supports limit/offset params — we just need the frontend to request more.

### 2.2 Build sortable, editable table view ✅ DONE
**Files**: `public/js/app.js` (lines 802-900), `public/index.html`, `public/css/styles.css`

**Table columns** (all placement-affecting criteria visible):
| Column | Source | Editable | Affects placement? |
|--------|--------|----------|-------------------|
| Wine Name | wine_name | Yes | No |
| Producer | producer | Yes | No |
| Vintage | vintage | Yes (number input) | Yes (drinking window) |
| Colour | colour | Yes (dropdown) | Yes (zone colour family) |
| Style | style | Yes | Yes (zone assignment) |
| Grapes | grapes | Yes | Yes (zone matching) |
| Region | region | Yes | Yes (zone matching) |
| Country | country | Yes | Yes (zone matching) |
| Qty | bottle_count | No | No |
| Rating | vivino_rating | No | No |
| Location | locations | No | No |
| Actions | — | — | Edit/Search ratings |

**Implementation**:
- New `renderWineTable()` with `<table>` structure, colour-coded left border per row
- [R: colour dropdown needs all 7 values] Colour column uses `<select>` with all valid values: `red`, `white`, `rose`, `orange`, `sparkling`, `dessert`, `fortified` (from `src/schemas/wine.js` WINE_COLOURS)
- [R: virtual scrolling + inline editing conflict] **No virtual scrolling for table view**. Virtual scrolling recycles DOM nodes, which destroys focus, input state, and scroll position during editing. Instead, render all rows (up to 500 via increased limit) in a plain `<table>` with `overflow-y: auto` container. 500 `<tr>` elements is well within browser rendering capability — no virtualisation needed.
- Click-to-edit cells: on click → swap `<td>` content with `<input>`, on blur/Enter → save via `updateWine(id, {field: value})` using existing `public/js/api/wines.js`
- [R: inline edit needs Zod type normalization] **Type coercion before save**: `vintage` → `parseInt()` or `null`, `price_eur` → `parseFloat()` or `null`, `vivino_rating` → `parseFloat()` or `null`. Empty strings → `null`. This prevents Zod validation failures on the backend where the update schema expects numbers/null not strings.
- Clickable sort column headers (client-side sort of loaded data)
- Keep existing filter bar above table

### 2.3 Add "Search Ratings" bulk action ✅ DONE
[R: endpoint already exists — reuse, don't create]
- Checkbox column in table for multi-select
- "Search Ratings" toolbar button triggers batch rating search
- **Reuse existing endpoint**: `POST /api/ratings/batch-fetch` (already in `src/routes/ratings.js` lines 301-323) — accepts `{ wineIds: [...], forceRefresh: false }`, validates cellar ownership, queues via job system, returns `jobId` + `statusUrl`
- [R: batch ratings need background queue + polling] **Already async**: The existing endpoint uses `jobQueue.enqueue('batch_fetch', ...)` and returns `202 Accepted` with a `statusUrl` for polling. Frontend needs a polling UI: show progress indicator, poll `GET /api/jobs/:jobId/status` every 2-3s, update table rows as ratings arrive, show completion toast.

### 2.4 Table/Card view toggle ✅ DONE
- View toggle button in filter bar (table icon / grid icon)
- Default to table view, remember preference in `localStorage`
- Card view preserved as-is (existing `renderWineCard()`)
- Card view continues to use virtual scrolling (no conflict since cards aren't editable inline)

---

## Phase 3: Move System & Consolidation UX ✅ DONE

### 3.1 Surface optimal layout moves in the Suggested Moves view ✅ DONE
[R: Phase 3 partly implemented — sortPlan already surfaced via CTA + diff flow]

**Current state**:
- `layoutDiffOrchestrator.js` already renders a CTA with sortPlan move count and a full visual diff flow (view → review → execute)
- `moves.js` renders "Suggested Moves" from `suggestedMoves` (legacy greedy algorithm)
- These are two separate, disconnected UIs showing different move sets

**Approach** [R: don't remove suggestedMoves — AI badges, Find Slot, recalculation depend on it]:
- **Keep `suggestedMoves` intact** — it's referenced in 23+ locations including AI badges (`aiAdvice.js`), manual Find Slot, move recalculation, swap detection, and batch execution
- **Change `moves.js` primary data source**: Read from `layoutProposal.sortPlan` for the move list rendering, falling back to `suggestedMoves` if sortPlan is unavailable
- **Adapt move object mapping**: sortPlan uses `{ wineId, wineName, from, to, zoneId, moveType }` — map `zoneId→toZoneId`, `moveType: "direct"→"move"/"swap"→"swap"/"cycle"→"move"`
- **Keep move execution using existing slot API** — the actual move/swap endpoints don't change

### 3.2 Improve move presentation UX ✅ DONE
**Files**: `public/js/cellarAnalysis/moves.js`
- Group moves by destination zone (not sequential order)
- Zone section headers: "→ Red Reserve (8 moves)"
- Within each zone: direct moves first, then swaps
- Swaps rendered as single paired row "A ↔ B" (not two separate entries)
- [R: circular moves need buffer slot verification] **Cycle handling**: For cycles (A→B→C→A), verify at least one empty buffer slot exists before starting. If no buffer available, show warning: "This move sequence requires a temporary empty slot — please empty one slot first." Render cycles as numbered chains: "1. A → temp, 2. C → A, 3. B → C, 4. temp → B"

### 3.3 Reconcile consolidation wording with move count ✅ DONE
**Files**: `public/js/cellarAnalysis/consolidation.js`
[R: consolidation mismatch is UX framing, not a logic replacement]
- The "23 scattered across 11 zones" (bottleScanner) and "X moves to optimal" (layoutSorter) measure **different things**: zone-row allocation mismatches vs. slot-level permutation. Both are valid metrics.
- **Fix the UX framing, not the logic**:
  - Consolidation message: "23 bottles are in non-ideal zones" (descriptive, not implying a specific move count)
  - Optimal layout CTA: "View optimal layout (X moves)" — already handled by `layoutDiffOrchestrator.js`
  - Link consolidation's "View details" to the same optimal layout diff view
  - Do NOT replace consolidation logic with sortPlan count — they measure different things

---

## Phase 4: UX Polish (From Assessment) — ✅ MOSTLY DONE (4.5 deferred)

### 4.1 Wine detail modal — add X close button ✅ DONE
**Files**: `public/js/modals.js`, `public/css/styles.css`
- `<button class="modal-close-x" aria-label="Close">×</button>` top-right of modal header
- Wire to existing `closeModal()` function via `addEventListener` (CSP-compliant)

### 4.2 Header stats — make clickable ✅ DONE
**Files**: `public/js/app.js`, `public/index.html`, `public/css/styles.css`
[R: need semantic `<button>` elements + ARIA for accessibility]
- Replace stat `<span>`/`<div>` elements with `<button>` elements (semantic, keyboard-focusable, screen reader accessible)
- Add `role="link"` or `aria-label="View N bottles in wine list"` etc.
- "94 Bottles" → switches to Wine List tab
- "9 Drink Soon" → switches to Wine List tab with "Drink Soon" filter pre-checked
- "84 Empty Slots" → switches to Cellar Grid tab
- CSS: `cursor: pointer` + subtle hover underline/highlight, no button chrome (styled as text links)

### 4.3 Grid zone banding ✅ DONE
**Files**: `public/js/grid.js`, `public/css/styles.css`
- Alternating subtle background tint between zone row groups
- Or: thin horizontal divider between zones

### 4.4 Wine name truncation — add tooltips + smarter truncation ✅ DONE
**Files**: `public/js/grid.js`, `public/css/styles.css`
- `title="${escapeHtml(fullWineName)}"` on every slot for hover tooltip
- Show vintage more prominently (small badge)
- Prefer middle truncation to preserve producer + distinguishing suffix

### 4.5 History duplicate grouping — DEFERRED
**Files**: `public/js/app.js` or history rendering module
- Group same-wine + same-date entries: "Vouvray Reserve Champalou 2018 × 4"
- Individual entries on expand

### 4.6 Drink Soon readiness badges — stronger visual treatment ✅ DONE
**Files**: `public/js/grid.js`, `public/css/styles.css`
[R: need icons/patterns alongside colours for accessibility]
- Current: tiny corner squares that disappear into dark background
- **Improve with colour + shape** (accessible to colour-blind users):
  - Now = red left border + small clock/exclamation icon
  - Soon = amber left border + small hourglass icon
  - Hold = muted border + no icon (default state)
- Icons are small inline SVG or Unicode symbols within the badge, ensuring information is conveyed through both colour and shape

### 4.7 Remove duplicate "Reorganise Zones" buttons ✅ DONE
**Files**: `public/js/cellarAnalysis/analysis.js`
- Keep ONE "Reorganise Zones" button (Zone Issue alert banner)
- Remove the duplicate in Cellar Issues card

---

## Phase 5: Consolidate Pairing & Settings Architecture ✅ DONE (28 Feb 2026)

**Shipped:** 5.7, 5.8, 5.6, 5.5, 5.2, 5.4, 5.3, 5.1 — all items complete. Cache bumped to v176 / ?v=20260228b. All 2837 unit tests pass. Committed `466be8d`, review fixes `08241b4`.

**Post-ship review fixes** (`08241b4`, 28 Feb 2026):
| # | Severity | Fix |
|---|----------|-----|
| 1 | HIGH | Recipe Pair button now clicks `#ask-sommelier` (not `dispatchEvent('input')` which had no listener) |
| 2 | MEDIUM | sommelier.js uses `import('./recommendations.js').then(({ expandPanel }) => ...)` instead of DOM toggle click |
| 3 | MEDIUM | Full ARIA wiring: IDs on all parent/sub-tabs, `aria-controls` on sub-tabs, `role=tablist`+`aria-label` on sub-tab rows, all `aria-labelledby` on view panels now point to real element IDs |
| 4 | MEDIUM | Drink Soon dashboard complete: summary bar (overdue/approaching counts), per-card 🍷 Pair button (auto-triggers search), Settings link (scrolls to drink-soon-rules section) |
| 5 | LOW | Single-view parent tabs (pairing, kitchen, settings) now carry `data-view` for backward compat per plan spec |

**Implementation order** (simple → complex): 5.7 → 5.8 → 5.6 → 5.5 → 5.2 → 5.4+5.3 → 5.1

### Audit Findings Disposition (28 Feb 2026)

All 12 findings from independent audit incorporated:

| # | Severity | Finding | Verdict |
|---|----------|---------|---------|
| 1 | HIGH | Tab handlers wired in `startAuthenticatedApp()`, not `bindEvents()` | ✅ Accept — plan referenced wrong function |
| 2 | HIGH | `[data-view]` migration scope incomplete (10 refs across 4 files) | ✅ Accept — keep `data-view` on all navigable buttons + export `switchView` |
| 3 | HIGH | Single-view parents lose `data-view` target | ✅ Accept — single-view parents keep both `data-parent` AND `data-view` |
| 4 | HIGH | Recipe deep-link: wrong file, switchView not exported, `input` event won't trigger | ✅ Accept all 3 — fix file ref to `recipeLibrary.js`; export `switchView`; click Ask button |
| 5 | HIGH | AI Picks reuse underestimates refactor; `#cellar-mode` doesn't exist | ✅ Accept — scale back to cross-link approach instead of embedded clone |
| 6 | MEDIUM | AI Picks visible in restaurant mode | ✅ Accept (moot with cross-link approach) |
| 7 | MEDIUM | Quick nav ignores dynamic storage areas | ✅ Accept — hide nav when `hasAreas === true` |
| 8 | MEDIUM | Tab ARIA attributes under-specified | ✅ Accept — full ARIA added to plan |
| 9 | MEDIUM | Mobile menu close misses sub-tabs | ✅ Accept — extend listener to `.sub-tab` class |
| 10 | MEDIUM | Bottle initializer: `initBottleModal()` doesn't exist | ✅ Accept — wire in `initBottles()` in `bottles.js` |
| 11 | LOW | Quick-nav should use `<button>` not `<a>` | ✅ Accept — change to semantic buttons |
| 12 | LOW | `VALID_VIEWS` needs `'drinksoon'` (and `'settings'` also missing) | ✅ Accept — add both to allowlist |

**Open Questions resolved:**
- **Navigation API**: Export `switchView` from `app.js`. Modules use direct import instead of DOM-click hacks
- **Drink Soon**: Separate view with distinct dashboard UI (not a Wine List filter preset)
- **AI Picks in restaurant mode**: Moot — using cross-link approach

### Second Audit Findings Disposition (28 Feb 2026)

7 unique findings from second reviewer (overlapping items with first audit omitted):

| # | Severity | Finding | Verdict |
|---|----------|---------|---------|
| A1 | MEDIUM | Style field is currently in PRIMARY HTML group — plan moves it to secondary | ✅ Accept as intentional — Style is useful but not essential for quick entry; callout added |
| A2 | MEDIUM | Quantity in separate `#quantity-section`, mode-dependent visibility | ✅ Accept — Quantity stays primary (outside advanced wrapper); DOM structure note added |
| A3 | LOW | Settings section count is 11 (not ~9) — all `data-section-id` values needed | ✅ Accept — all 11 IDs enumerated in plan |
| A4 | HIGH | `switchView()` existing tab deactivation loop (line 1393-1398) would undo `activateParentTab()` | ✅ Accept — loop must be REPLACED not augmented; plan corrected |
| A5 | MEDIUM | URL deep-linking `?view=` already exists; needs `'drinksoon'` in VALID_VIEWS; parent-level URL resolution | ✅ Accept — already covered by VALID_VIEWS update; parent-level URL mapping added |
| A6 | LOW | Mobile sub-tab UX undefined | ✅ Accept — sub-tabs inline below parent tabs in mobile drawer; CSS note added |
| A7 | LOW | Storage areas rendering creates dynamic zone wrappers without IDs | ℹ️ Noted — moot since nav is hidden entirely when `hasAreas`; no dynamic IDs needed |

---

### 5.7 "Tonight's Recommendations" panel — defaults to collapsed

**File**: `public/js/recommendations.js`

- Change `recState.isCollapsed = false` → `true`
- In `initRecommendations()`, after binding toggle button, apply initial collapsed CSS state directly (do NOT call `togglePanel()` which would flip the state):
  ```js
  if (recState.isCollapsed) {
    panel.classList.add('collapsed');
    const icon = toggleBtn?.querySelector('.toggle-icon');
    if (icon) icon.textContent = '+';
    toggleBtn?.setAttribute('aria-expanded', 'false');
    if (toggleBtn) toggleBtn.title = 'Show panel';
  }
  ```

### 5.8 Search overlay keyboard shortcut — platform-aware

**File**: `public/js/globalSearch.js`

- Add `updateShortcutDisplay()` called from `initGlobalSearch()`:
  ```js
  function updateShortcutDisplay() {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
      /Mac/i.test(navigator.userAgent);
    const kbd = document.querySelector('#global-search-trigger kbd');
    if (kbd) kbd.textContent = isMac ? '⌘K' : 'Ctrl+K';
  }
  ```
- Keyboard handler already checks `e.metaKey || e.ctrlKey` — no change needed there

### 5.6 Fridge/Cellar quick navigation

**Files**: `public/index.html`, `public/css/styles.css`, `public/js/app.js`

- Add a sticky nav row inside `#view-grid` directly below the recommendations section. Use `<button>` not `<a>` [audit LOW-1]:
  ```html
  <nav class="grid-section-nav" id="grid-section-nav" aria-label="Jump to section">
    <button type="button" class="section-nav-btn" id="nav-to-fridge">▲ Fridge</button>
    <button type="button" class="section-nav-btn" id="nav-to-cellar">▼ Cellar</button>
  </nav>
  ```
- Add `id="fridge-section"` to existing `.fridge-section.zone` div; add `id="cellar-section"` to the adjacent `.zone` cellar div
- Bind click in `startAuthenticatedApp()` (where existing nav handlers live) [audit HIGH-1]:
  ```js
  document.getElementById('nav-to-fridge')?.addEventListener('click', () =>
    document.getElementById('fridge-section')?.scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('nav-to-cellar')?.addEventListener('click', () =>
    document.getElementById('cellar-section')?.scrollIntoView({ behavior: 'smooth' }));
  ```
- **Hide when storage areas active** [audit MED-2, A7] — in `loadLayout()` (app.js line ~678). When `hasAreas === true`, `renderStorageAreas()` creates dynamic zone wrappers without IDs (in `grid.js` line 319). Rather than adding nav anchors to dynamic zones, hide the nav entirely since fridge/cellar sections don't exist in areas mode:
  ```js
  const gridSectionNav = document.getElementById('grid-section-nav');
  if (gridSectionNav) gridSectionNav.style.display = hasAreas ? 'none' : '';
  ```
- CSS: `position: sticky; top: 0; z-index: 10; display: flex; gap: 0.5rem; background: var(--bg-dark); padding: 0.4rem;`

### 5.5 Improve Add dialogs

**Files**: `public/index.html` (bottle modal), `public/js/bottles.js`, `public/css/styles.css`

**Add Wine — progressive disclosure:**
- Primary fields (always visible): Wine Name, Colour, Vintage, Quantity
- Secondary fields (collapsed by default): Style _(currently in primary group — intentionally demoted for quick-entry UX)_ [audit A1], Grapes, Producer, Region, Country, Price, Drinking Window
- **DOM note** [audit A2]: Quantity lives in a separate `<div id="quantity-section">` outside `#new-wine-section`, with mode-dependent visibility (add vs edit). It stays outside the advanced wrapper — only fields INSIDE `#new-wine-section` are wrapped
- In bottle modal HTML, wrap secondary fields (within `#new-wine-section`) in `<div class="bottle-form-advanced" id="bottle-form-advanced" hidden>`
- Add toggle button (above the wrapper): `<button type="button" class="btn btn-text" id="toggle-advanced-fields">+ More fields</button>`
- Wire in `initBottles()` in `public/js/bottles.js` (NOT `initBottleModal()` which doesn't exist) [audit MED-5]:
  ```js
  document.getElementById('toggle-advanced-fields')?.addEventListener('click', () => {
    const adv = document.getElementById('bottle-form-advanced');
    const btn = document.getElementById('toggle-advanced-fields');
    const isHidden = adv.hasAttribute('hidden');
    adv.toggleAttribute('hidden', !isHidden);
    btn.textContent = isHidden ? '− Less fields' : '+ More fields';
  });
  ```
- When populating form for edit (in `showEditBottleModal()` in `bottles/modal.js`), auto-expand if any secondary field has a non-empty value:
  ```js
  const advFields = ['wine-style','wine-grapes','wine-producer','wine-region','wine-country','wine-price','wine-drink-from','wine-drink-until'];
  const hasAdvanced = advFields.some(id => document.getElementById(id)?.value?.trim());
  if (hasAdvanced) {
    document.getElementById('bottle-form-advanced')?.removeAttribute('hidden');
    const btn = document.getElementById('toggle-advanced-fields');
    if (btn) btn.textContent = '− Less fields';
  }
  ```

**Add Recipe dark theme:**
- Recipe modal form inputs should use existing `form-input` class (already dark-themed); check for any inline `background: white` or `background: #fff` on recipe modal inputs and move to CSS

### 5.2 Break Settings into collapsible sub-sections

**Files**: `public/index.html` (settings HTML), `public/js/settings.js`, `public/css/styles.css`

- Convert each `<h3 class="settings-section-title">` into:
  ```html
  <button class="settings-section-toggle" aria-expanded="true"
          data-section-id="display">
    Display Settings <span class="settings-section-arrow">▾</span>
  </button>
  ```
- Wrap each section body (everything below the title) in `<div class="settings-section-body">`
- In `settings.js`, add `initCollapsibleSections()` called from `initSettings()`:
  ```js
  function initCollapsibleSections() {
    document.querySelectorAll('.settings-section-toggle').forEach(btn => {
      const sectionId = btn.dataset.sectionId;
      // Restore state from localStorage
      const stored = localStorage.getItem(`settings-section-${sectionId}`);
      if (stored === 'collapsed') {
        btn.setAttribute('aria-expanded', 'false');
        btn.closest('.settings-section').querySelector('.settings-section-body')
          .classList.add('collapsed');
      }
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        btn.closest('.settings-section').querySelector('.settings-section-body')
          .classList.toggle('collapsed', expanded);
        localStorage.setItem(`settings-section-${sectionId}`, expanded ? 'collapsed' : 'expanded');
      });
    });
  }
  ```
- The 3 `settings-group` group titles (Preferences, Integrations, Data & App) remain plain `<h3>` — only inner `settings-section` headings become toggles
- **All 11 `data-section-id` values** [audit A3]:
  1. `rating-preferences` — Rating Preferences
  2. `display` — Display Settings
  3. `drink-soon-rules` — Drink Soon Auto Rules
  4. `storage-conditions` — Storage Conditions
  5. `cellar-layout` — Cellar Layout
  6. `account-credentials` — Account Credentials
  7. `awards-database` — Awards Database
  8. `storage-areas` — Storage Areas
  9. `backup-export` — Backup & Export
  10. `install-app` — Install App
  11. `about` — About
- CSS: `.settings-section-body.collapsed { display: none; }` + arrow rotation on toggle button

### 5.4 Reduce top-level tabs (7 → 5) + 5.3 Drink Soon dashboard

**Files**: `public/index.html`, `public/js/app.js`, `public/css/styles.css`

**Routing map:**
```
Cellar     → views: grid, analysis      (sub-tabs)
Pairing    → views: pairing             (single-view)
Kitchen    → views: recipes             (single-view)
Collection → views: wines, history, drinksoon  (sub-tabs, drinksoon is new)
Settings   → views: settings            (single-view)
```

#### Prerequisite: Export `switchView` [audit HIGH-2, HIGH-4]

**Critical architectural change**: Export `switchView` from `app.js` so other modules can navigate without DOM-click hacks:
```js
// app.js — change from:
function switchView(viewName) { ... }
// to:
export function switchView(viewName) { ... }
```

**Migrate all `querySelector('[data-view="..."]').click()` calls** (10 occurrences across 4 files) [audit HIGH-2]:

| File | Line(s) | Current | Replacement |
|------|---------|---------|-------------|
| `app.js` | 1287, 1291, 1301 | Internal `switchView()` calls | Already direct — no change |
| `app.js` | 1393-1413 | Tab deactivation + `querySelector('[data-view="${viewName}"]')` activation | REPLACE entire block with `activateParentTab()` + sub-tab loop [audit A4] |
| `globalSearch.js` | 452, 472, 489, 506, 532, 541 | `querySelector('[data-view="wines/pairing"]').click()` | `import { switchView } from './app.js'; switchView('wines')` |
| `moveGuide.js` | 589 | `querySelector('[data-view="grid"]').click()` | `import { switchView } from './app.js'; switchView('grid')` |
| `moveGuide.js` | 599 | `querySelectorAll('.tab[data-view]')` for close-on-leave detection | Change to listen for `state.currentView` changes or query `.tab[data-parent], .sub-tab[data-view]` |
| `recommendations.js` | 337 | `querySelector('[data-view="wines"]').click()` | `import { switchView } from './app.js'; switchView('wines')` |

#### HTML changes in `index.html`

1. Replace 7 `<button class="tab" data-view="...">` with 5 parent tabs. Single-view parents keep BOTH `data-parent` AND `data-view` for backward compat [audit HIGH-3]. Multi-view parents have only `data-parent`:
   ```html
   <div class="tabs-container" id="tabs-container" role="tablist" aria-label="Views">
     <button class="tab active" data-parent="cellar" role="tab"
             aria-selected="true" id="tab-cellar-parent">Cellar</button>
     <button class="tab" data-parent="pairing" data-view="pairing" role="tab"
             aria-selected="false" aria-controls="view-pairing" id="tab-pairing">Pairing</button>
     <button class="tab" data-parent="kitchen" data-view="recipes" role="tab"
             aria-selected="false" aria-controls="view-recipes" id="tab-kitchen">Kitchen</button>
     <button class="tab" data-parent="collection" role="tab"
             aria-selected="false" id="tab-collection-parent">Collection</button>
     <button class="tab" data-parent="settings" data-view="settings" role="tab"
             aria-selected="false" aria-controls="view-settings" id="tab-settings">Settings</button>
   </div>
   ```
   Note: Single-view parents (`pairing`, `kitchen`, `settings`) keep `data-view` so existing `querySelector('[data-view="pairing"]')` calls still work [audit HIGH-3].

2. Add sub-tab rows below main tabs (inside `<nav class="tabs">`):
   ```html
   <div class="sub-tabs-row" data-parent="cellar" role="tablist" aria-label="Cellar views">
     <button class="sub-tab active" data-view="grid" role="tab"
             aria-selected="true" aria-controls="view-grid">Grid</button>
     <button class="sub-tab" data-view="analysis" role="tab"
             aria-selected="false" aria-controls="view-analysis">Analysis</button>
   </div>
   <div class="sub-tabs-row" data-parent="collection" hidden role="tablist" aria-label="Collection views">
     <button class="sub-tab" data-view="wines" role="tab"
             aria-selected="false" aria-controls="view-wines">Wine List</button>
     <button class="sub-tab" data-view="history" role="tab"
             aria-selected="false" aria-controls="view-history">History</button>
     <button class="sub-tab" data-view="drinksoon" role="tab"
             aria-selected="false" aria-controls="view-drinksoon">Drink Soon</button>
   </div>
   ```
   Full ARIA attributes included [audit MED-3].

3. Add new `#view-drinksoon` div after `#view-history`:
   ```html
   <div class="view" id="view-drinksoon" role="tabpanel"
        aria-labelledby="tab-drinksoon" hidden>
     <h2 class="view-title">Drink Soon</h2>
     <p class="view-subtitle">Wines approaching or past their optimal drinking window</p>
     <div id="drink-soon-summary"></div>
     <div id="drink-soon-list"></div>
   </div>
   ```

4. Keep all existing `view-*` divs and their IDs unchanged.

#### JS changes in `app.js`

**Add PARENT_TAB_MAP** near top (after existing constants):
```js
const PARENT_TAB_MAP = {
  cellar: ['grid', 'analysis'],
  pairing: ['pairing'],
  kitchen: ['recipes'],
  collection: ['wines', 'history', 'drinksoon'],
  settings: ['settings']
};
const VIEW_TO_PARENT = Object.entries(PARENT_TAB_MAP).reduce((acc, [p, vs]) => {
  vs.forEach(v => { acc[v] = p; }); return acc;
}, {});
```

**Update `VALID_VIEWS`** [audit LOW-2] — add `'drinksoon'` and `'settings'`:
```js
const VALID_VIEWS = ['grid', 'analysis', 'pairing', 'recipes', 'wines', 'history', 'settings', 'drinksoon'];
```

**Add `activateParentTab()`**:
```js
function activateParentTab(parentName) {
  // Update parent tab buttons
  document.querySelectorAll('.tab[data-parent]').forEach(t => {
    const active = t.dataset.parent === parentName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
    t.setAttribute('tabindex', active ? '0' : '-1');
  });
  // Show/hide sub-tab rows
  document.querySelectorAll('.sub-tabs-row').forEach(row => {
    row.hidden = row.dataset.parent !== parentName;
  });
}
```

**Modify `switchView()`**:
1. **REPLACE the existing tab deactivation + activation block** (lines 1393-1413) [audit A4]. The old code does `querySelectorAll('.tab').forEach(...)` which would undo `activateParentTab()` if called after it. Replace the entire block with:
   ```js
   // Activate parent tab + show/hide sub-tab rows
   const parent = VIEW_TO_PARENT[viewName];
   if (parent) activateParentTab(parent);

   // Activate the matching sub-tab or single-view tab
   document.querySelectorAll('.sub-tab').forEach(t => {
     const active = t.dataset.view === viewName;
     t.classList.toggle('active', active);
     t.setAttribute('aria-selected', String(active));
     t.setAttribute('tabindex', active ? '0' : '-1');
   });
   // For single-view parents (pairing, kitchen, settings) that have data-view,
   // their active state is already handled by activateParentTab()
   ```
   **Key**: `activateParentTab()` handles ALL parent tab states (active class, aria-selected). Sub-tab states are handled by the sub-tab loop. The old blanket `.tab` deactivation is removed entirely.

2. Add Drink Soon lazy-load guard alongside existing guards:
   ```js
   if (viewName === 'drinksoon' && !state.drinkSoonLoaded) {
     state.drinkSoonLoaded = true;
     loadDrinkSoonView();
   }
   ```

**Wire tab/sub-tab handlers** in `startAuthenticatedApp()` [audit HIGH-1]:

Replace existing line 305-306:
```js
// OLD (remove):
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

// NEW:
// Parent tab clicks → switch to first sub-view in group
document.querySelectorAll('.tab[data-parent]').forEach(btn => {
  btn.addEventListener('click', () => {
    const parent = btn.dataset.parent;
    // If parent has data-view (single-view), use it; otherwise use first child
    const targetView = btn.dataset.view || PARENT_TAB_MAP[parent][0];
    switchView(targetView);
  });
});
// Sub-tab clicks → switch to that view
document.querySelectorAll('.sub-tab[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
```

**Update mobile menu close** [audit MED-4] in `initMobileMenu()` (line ~1464):
```js
// OLD:
if (e.target.classList.contains('tab')) {
// NEW:
if (e.target.classList.contains('tab') || e.target.classList.contains('sub-tab')) {
```

**Drink Soon view: `loadDrinkSoonView()`** function in `app.js`:
- Fetches `/api/reduce-now` (existing endpoint, already used for header stats)
- Renders wine cards with urgency tag + "Find Pairing" button that calls `switchView('pairing')`
- Link to Settings for rule adjustment
- Header `#stat-btn-reduce` click handler (in `initStatButtons()`): change from wines-filter to `switchView('drinksoon')`

**URL deep-linking** [audit A5]: Existing `?view=` parameter handling (line 338-344) already reads `VALID_VIEWS` and calls `switchView()`. Adding `'drinksoon'` and `'settings'` to `VALID_VIEWS` automatically enables `?view=drinksoon`. For parent-level URLs like `?view=collection`, add a resolution step before the switchView call:
```js
const PARENT_URL_MAP = { cellar: 'grid', collection: 'wines' };
const resolvedView = PARENT_URL_MAP[urlView] || urlView;
if (VALID_VIEWS.includes(resolvedView)) switchView(resolvedView);
```

**Mobile sub-tab UX** [audit A6]: Sub-tab rows (`.sub-tabs-row`) render inline below parent tabs inside the mobile drawer (`.tabs-container.open`). CSS:
```css
@media (max-width: 768px) {
  .sub-tabs-row { width: 100%; padding-left: 1rem; }
  .sub-tab { font-size: 0.85em; }
}
```
Sub-tab rows are shown/hidden by `activateParentTab()` — when a parent without sub-tabs is active, the row stays `hidden`.

### 5.1 Unify food-to-wine pairing experience — SCALED BACK [audit HIGH-5]

**Rationale for scale-back**: `recommendations.js` is hardwired to fixed container IDs (`#recommendation-cards`, `#rec-occasion`, `#rec-food`, `#rec-food-detail`). A `loadRecommendationsInto()` refactor would require parameterising 6+ getElementById calls and duplicating context selectors. Instead, use a **cross-link approach**: the Pairing tab gets a button that navigates to the Grid view and expands the recommendations panel.

**Files**: `public/index.html` (pairing view), `public/js/sommelier.js`, `public/js/recommendations.js`, `public/js/recipes/recipeLibrary.js`

**AI Picks cross-link in Pairing tab:**

Add inside `#pairing-cellar-section` (actual ID, not `#cellar-mode`) [audit HIGH-5], so it hides with restaurant mode [audit MED-1]:
```html
<div class="pairing-ai-crosslink" id="pairing-ai-crosslink">
  <span>Want AI-curated picks based on your cellar?</span>
  <button class="btn btn-secondary btn-small" id="go-to-ai-picks">
    AI Cellar Picks →
  </button>
</div>
```

Wire in `sommelier.js` `initSommelier()`:
```js
document.getElementById('go-to-ai-picks')?.addEventListener('click', () => {
  import('./app.js').then(({ switchView }) => {
    switchView('grid');
    // Expand recommendations panel if collapsed
    setTimeout(() => {
      import('./recommendations.js').then(({ expandPanel }) => expandPanel());
    }, 100);
  });
});
```

In `recommendations.js`, export a small `expandPanel()` helper:
```js
export function expandPanel() {
  if (recState.isCollapsed) togglePanel();
}
```

**Recipe → Pairing deep-link:**

In `public/js/recipes/recipeLibrary.js` (NOT `buyingGuide.js`) [audit HIGH-4], add a "Pair" button to `renderRecipeCard()` (line ~214):
```js
<button class="recipe-pair-btn" data-name="${escapeHtml(recipe.name)}" title="Find wine pairing">🍷</button>
```

After render in `loadAndRenderRecipes()`, bind click handlers:
```js
grid.querySelectorAll('.recipe-pair-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    import('../app.js').then(({ switchView }) => {
      switchView('pairing');
      setTimeout(() => {
        const dishInput = document.getElementById('dish-input');
        if (dishInput) {
          dishInput.value = btn.dataset.name;
          // Trigger search by clicking the Ask button (not dispatching input event) [audit HIGH-4]
          document.getElementById('ask-sommelier')?.click();
        }
      }, 150);
    });
  });
});
```

---

## Files Changed Summary (Phase 5)

| File | Changes |
|------|---------|
| `public/js/recommendations.js` | Default collapsed; export `expandPanel()` |
| `public/js/globalSearch.js` | `updateShortcutDisplay()`; replace 6× `[data-view].click()` with `switchView()` import |
| `public/index.html` | 5 parent tabs + sub-tabs (full ARIA), `#view-drinksoon`, grid-section-nav, bottle-form-advanced, pairing cross-link |
| `public/js/app.js` | Export `switchView`; `PARENT_TAB_MAP`, `activateParentTab()`; `switchView()` parent/sub-tab updates; `loadDrinkSoonView()`; nav scroll handlers; `VALID_VIEWS` + `'drinksoon','settings'`; mobile menu `.sub-tab` close |
| `public/js/settings.js` | `initCollapsibleSections()` called from `initSettings()` |
| `public/js/bottles.js` | Toggle advanced fields handler in `initBottles()` |
| `public/js/bottles/modal.js` | Auto-expand advanced fields in `showEditBottleModal()` |
| `public/js/recipes/recipeLibrary.js` | "Pair" deep-link button per recipe card |
| `public/js/sommelier.js` | Wire AI Picks cross-link button |
| `public/js/cellarAnalysis/moveGuide.js` | Replace 2× `[data-view].click()` with `switchView()` import |
| `public/css/styles.css` | Sub-tabs, grid-section-nav, settings toggles, bottle-form-advanced, pairing cross-link |
| `public/sw.js` | Bump `CACHE_VERSION` v174 → v175 |
| `public/index.html` | Bump `?v=` in CSS link |

---

## Reviewer Feedback Disposition

All 15 reviewer corrections were verified against the codebase. Disposition:

| # | Reviewer Claim | Verdict | Plan Impact |
|---|---------------|---------|-------------|
| 1 | Phase 3 partly implemented (sortPlan surfaced via CTA+diff) | ✅ Accept | 3.1 rewritten: don't duplicate, extend `moves.js` data source |
| 2 | Table blocked by pagination (fetchWines limit=50) | ✅ Accept | 2.1: pass `?limit=500` from frontend |
| 3 | Batch ratings endpoint already exists `/api/ratings/batch-fetch` | ✅ Accept | 2.3: reuse existing, add polling UI |
| 4 | Removing suggestedMoves breaks AI badges, Find Slot, recalc | ✅ Accept | 3.1: keep suggestedMoves, read sortPlan for rendering only |
| 5 | Colour schema: red/white/rose/orange/sparkling/dessert/fortified | ✅ Accept | 2.2: dropdown lists all 7 values |
| 6 | Step labels are CSS/layout, not state.js | ✅ Accept | 1.3: fix in CSS, not state.js |
| 7 | Empty "( )" is in stored wine_name, not grid.js | ✅ Accept | 1.2: data investigation + cleanup |
| 8 | Header stats need semantic `<button>` + ARIA | ✅ Accept | 4.2: use `<button>` with ARIA labels |
| 9 | Inline edit needs Zod type/null normalization | ✅ Accept | 2.2: coerce types before API call |
| 10 | Consolidation mismatch is UX framing, not logic | ✅ Accept | 3.3: fix wording, not replace metrics |
| 11 | Virtual scrolling + inline editing conflict | ✅ Accept | 2.2: plain `<table>` (no virtualisation) |
| 12 | Batch ratings need background queue + polling | ✅ Accept (already async) | 2.3: add polling UI, endpoint already queues |
| 13 | Circular moves need buffer slot verification | ✅ Accept | 3.2: verify empty slot, show warning if none |
| 14 | Readiness badges need icons/patterns for accessibility | ✅ Accept | 4.6: icons alongside colour borders |
| 15 | Bottle count: CAST(COUNT(...) AS INTEGER) in SQL | ✅ Accept | 1.1: two-layer fix (SQL + frontend) |

---

## Files Changed Summary

### Phase 1 (Bug Fixes)
| File | Changes |
|------|---------|
| `src/routes/wines.js` | CAST(COUNT(...) AS INTEGER) for bottle_count |
| `public/js/app.js` | `Number(w.bottle_count)` defence at lines 754, 839 |
| `public/css/styles.css` | Step label spacing for restaurant pairing wizard |
| DB cleanup | One-time SQL to strip `( )` from wine_name records |

### Phase 2 (Table View)
| File | Changes |
|------|---------|
| `src/routes/wines.js` | Add producer, country, region, grapes, drink_from, drink_until, zone_id to SELECT+GROUP BY |
| `public/js/api/wines.js` | Pass `?limit=500` in fetchWines() |
| `public/js/app.js` | New `renderWineTable()`, table/card toggle, sort headers, inline edit with type coercion |
| `public/index.html` | Table/card toggle button in filter bar, checkbox column for bulk actions |
| `public/css/styles.css` | Table styles, row hover, edit input states, colour-coded borders |

### Phase 3 (Move System)
| File | Changes |
|------|---------|
| `public/js/cellarAnalysis/moves.js` | Read sortPlan as primary data, zone-grouped rendering, swap pairing, cycle buffer check |
| `public/js/cellarAnalysis/consolidation.js` | Reword messaging, link to layout diff view |

### Phase 4 (UX Polish)
| File | Changes |
|------|---------|
| `public/js/modals.js` | X close button |
| `public/js/app.js` | Semantic `<button>` header stats with ARIA |
| `public/index.html` | `<button>` stat elements |
| `public/js/grid.js` | Zone banding, tooltips, readiness badges with icons |
| `public/css/styles.css` | Zone banding, badge icons+borders, modal X, stat hover |
| `public/js/cellarAnalysis/analysis.js` | Remove dup Reorganise button |

### Phase 5 (Architecture) ✅ DONE
| File | Changes |
|------|---------|
| `public/js/recommendations.js` | Default collapsed (5.7); export `expandPanel()` (5.1) |
| `public/js/globalSearch.js` | `updateShortcutDisplay()` (5.8); replace 6× `.click()` with `switchView()` import |
| `public/index.html` | 5 parent tabs + sub-tabs with full ARIA (5.4); `#view-drinksoon` (5.3); grid-section-nav (5.6); bottle-form-advanced wrapper + toggle (5.5); pairing AI cross-link (5.1) |
| `public/js/app.js` | Export `switchView`; `PARENT_TAB_MAP`, `activateParentTab()`; `switchView()` rewrite; `loadDrinkSoonView()`; nav scroll handlers; `VALID_VIEWS` + `'drinksoon','settings'`; mobile `.sub-tab` close; `stat-btn-reduce` → `switchView('drinksoon')` |
| `public/js/settings.js` | `initCollapsibleSections()` with `localStorage` persistence (5.2) |
| `public/js/bottles.js` | Toggle advanced fields handler in `initBottles()` (5.5) |
| `public/js/bottles/modal.js` | Auto-expand advanced fields in `showEditBottleModal()` (5.5) |
| `public/js/recipes/recipeLibrary.js` | 🍷 Pair button per card; `switchView('pairing')` + pre-fill dish input (5.1) |
| `public/js/sommelier.js` | Wire AI Picks cross-link → `switchView('grid')` + expand panel (5.1) |
| `public/js/cellarAnalysis/moveGuide.js` | Replace 2× `.click()` with `switchView()` import; listener updated for parent/sub-tabs |
| `public/css/components.css` | Sub-tabs, grid-section-nav, settings toggles, bottle-form-advanced, pairing cross-link, recipe pair button, drink-soon cards |
| `public/sw.js` | Bump `CACHE_VERSION` v174 → v175; CSS `?v=20260228a` |
| `tests/unit/cellarAnalysis/moveGuide.test.js` | Add `switchView: vi.fn()` to app.js mock; update tab-switch assertion |

### Always
| File | Changes |
|------|---------|
| `public/sw.js` | Bump `CACHE_VERSION` after frontend changes |
| `public/index.html` | Match `?v=` cache bust strings |

**Reused existing code** (no new backend modules for Phases 1-4):
- `public/js/api/wines.js` → `updateWine(id, data)` for inline editing
- `public/js/api/wines.js` → `fetchWines()` for data loading (with increased limit)
- `public/js/utils.js` → `escapeHtml()`, `showToast()`, `debounce()`
- `POST /api/ratings/batch-fetch` → existing batch rating endpoint (no new endpoint)
- `src/services/cellar/layoutSorter.js` → `computeSortPlan()` already production-ready
- `src/services/cellar/layoutProposer.js` → `proposeIdealLayout()` already production-ready
- `public/js/cellarAnalysis/layoutDiffOrchestrator.js` → existing diff flow for sortPlan

---

## Verification

1. **Unit tests**: `npm run test:unit` — all pass, especially:
   - `tests/unit/utils/swStaticAssets.test.js` (verify if new modules added)
   - `tests/unit/utils/apiAuthHeaders.test.js` (no new raw fetch calls)
2. **Integration tests**: `npm run test:integration`
3. **Manual verification per phase**:
   - **P1**: Bottle count shows correct integer, no empty `( )` in names, step labels spaced correctly
   - **P2**: Table renders all columns, inline edit saves with correct types, toggle works, bulk rating search queues + polls, limit=500 loads full cellar
   - **P3**: Moves grouped by zone, swaps shown as pairs, cycles show buffer warning, consolidation wording accurate
   - **P4**: Modal X button, clickable stats with keyboard focus, zone banding, tooltips, history grouping, badges with icons, no dup button
4. **Cache busting**: Bump `CACHE_VERSION` in `sw.js` + `?v=` in `index.html`
5. **Accessibility check**: Header stat buttons focusable via Tab, readiness badges distinguishable without colour
