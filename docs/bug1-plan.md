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
| Phase 5 | Deferred | Architectural — future sessions |

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

## Phase 5: Consolidate Pairing & Settings Architecture

### 5.1 Unify food-to-wine pairing experience
- Merge "Tonight's Recommendations" (Cellar Grid) and "From My Cellar" (Find Pairing) into single pairing view
- "Tonight's Recommendations" panel on grid defaults to collapsed
- Recipe-level "Find Wine Pairing" deep-links to unified pairing pre-filled with recipe flavour profile
- Single consistent UI: text input + optional occasion/protein tags + source/colour filters

### 5.2 Break Settings into sub-sections
- Group into collapsible sections with anchor navigation:
  - Display (theme, text size)
  - Drink Soon Rules (drinking window, fallback, evaluate)
  - Cellar Layout (colour order, fill direction, zone threshold)
  - Awards Database (→ own expandable section or sub-route)
  - Integrations (Vivino, Decanter, Paprika, Mealie → behind "Advanced" toggle)
  - Backup & Export
  - About
- Awards Database gets its own header and collapse toggle

### 5.3 Create "Drink Soon" dashboard
- Dedicated view (or prominent section) consolidating:
  - All drink-soon wines with reasons
  - Quick actions (mark as opened, recommend pairing)
  - Rule adjustment link to Settings
- Header stat "9 Drink Soon" links here

### 5.4 Reduce top-level tabs (7 → 5)
- Proposed grouping: **Cellar** (Grid + Analysis), **Pairing**, **Kitchen** (Recipes), **Collection** (Wine List + History), **Settings**
- Sub-tabs within each group

### 5.5 Improve Add dialogs
- **Add Recipe dialog**: match dark theme (currently white background fields)
- **Add New Wine form**: progressive disclosure — show Name, Colour, Vintage first; "More fields" toggle reveals Grapes, Producer, Region, Drinking Window, etc.

### 5.6 Fridge/Cellar quick navigation
- Sticky anchor nav: "Fridge ↑ / Cellar ↓" toggle when scrolling Cellar Grid
- Or: mini-tab toggle at top of grid view

### 5.7 "Tonight's Recommendations" panel
- Default to collapsed on load
- Or: move below the main cellar grid

### 5.8 Search overlay keyboard shortcut
- Show "Ctrl+K" on Windows/Linux instead of "⌘K"
- Detect platform and display appropriate shortcut

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

### Phase 5 (Architecture — future sessions)
| File | Changes |
|------|---------|
| Multiple pairing files | Unify pairing entry points |
| `public/js/app.js` | Tab restructuring, Drink Soon dashboard, history grouping |
| Settings-related files | Sub-section navigation |
| Various dialogs | Dark theme consistency, progressive disclosure |

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
