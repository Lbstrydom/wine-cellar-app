
# UI/UX Audit Plan

## Goal
Apply Gestalt principles, fix contrast/accessibility issues, consolidate the color system, add light mode, standardize typography, and improve mobile layout across the Wine Cellar PWA.

## Progress

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 0.1 | **DONE** | 2026-02-05 | CSS split into 5 modules, SW updated, cache bumped |
| Phase 0.2 | **DONE** | 2026-02-05 | 51 hex + 40 rgba families mapped in variables.css |
| Phase 1 | **DONE** | 2026-02-05 | Contrast, fonts, and missing vars fixed |
| Phase 2 | **DONE** | 2026-02-05 | Semantic tokens + non-color cues |
| Phase 3 | **DONE** | 2026-02-05 | Light mode + theme toggle + FOUC fix + Phase 3.5 refinements (manual QA pending) |
| Phase 3.5 | **DONE** | 2026-02-05 | Color system refinement (WCAG AA fixes, 60-30-10 balance, spatial separation) |
| Phase 4 | **DONE** | 2026-02-06 | Settings grouping, inline style cleanup, non-color cues, wine card hierarchy, tab indicator |
| Phase 5 | **DONE** | 2026-02-06 | Type scale variables, html-level multiplier, base heading sizes, tab visibility fix |
| Post-Phase UX | **DONE** | 2026-02-06 | Grid UX (column headers, slot-loc hiding, priority legend), btn-primary light mode contrast fix |
| Phase 6 | **DONE** | 2026-02-06 | Mobile responsive refinements, touch targets, PWA safe areas (manual QA pending) |
| Phase 7 | **DONE** | 2026-02-06 | Focus rings, skeleton loading, toast stacking + screen reader announcements |
| Phase 8 | **DONE** | 2026-02-06 | Cellar Analysis: theme hardening, text overflow, messages, loading UX |
| Phase 9 | **DONE** | 2026-02-06 | Cellar Analysis: state machine, single CTA, post-reconfig flow |
| Phase 10 | **DONE** | 2026-02-06 | Cellar Analysis: fridge swap-out suggestions when full |
| Phase 11 | Pending | | Cellar Analysis: visual grid move guide |

## Files Modified
- `public/css/variables.css` — :root custom properties, theme palettes, color migration map comment block
- `public/css/components.css` — wine cards, modals, toasts, badges, grid slots (6,531 lines)
- `public/css/layout.css` — grid, responsive breakpoints, settings page structure (858 lines)
- `public/css/themes.css` — light mode palette + component overrides, high-contrast / forced-colors (327 lines)
- `public/css/accessibility.css` — focus rings, touch targets, reduced-motion, skip link (167 lines)
- `public/css/styles.css` — retained as @import aggregator (imports above files in cascade order)
- `public/index.html` — Phase 4 (inline styles, settings grouping), Phase 3 (theme toggle + FOUC script)
- `public/js/grid.js` — Post-Phase UX (column headers, priority legend, slot-loc hiding in both render paths)
- `public/js/settings.js` — Phase 3 (theme toggle logic)
- `public/js/utils.js` — Phase 7 (toast container + aria-live)
- `public/manifest.json` — Phase 3 (fix background_color mismatch)
- `public/sw.js` — cache version bump per phase
- `public/js/theme-init.js` — Phase 8 (explicit data-theme for WebView compatibility)
- `public/js/cellarAnalysis/aiAdvice.js` — Phase 8 (inline spinner, no forced scroll)
- `public/js/cellarAnalysis/moves.js` — Phase 8 (fix misleading message), Phase 11 (Visual Guide button)
- `public/js/cellarAnalysis/analysisState.js` — Phase 9 (**NEW** — state machine module)
- `public/js/cellarAnalysis/analysis.js` — Phase 9 (updateActionButton using state machine)
- `public/js/cellarAnalysis.js` — Phase 9 (remove old button wiring)
- `public/js/cellarAnalysis/zoneReconfigurationModal.js` — Phase 9 (post-apply scroll)
- `public/js/cellarAnalysis/zoneReconfigurationBanner.js` — Phase 9 (Review Moves button), Phase 11 (Guide Me button)
- `public/js/cellarAnalysis/fridge.js` — Phase 10 (swap logic, user-goal language)
- `src/routes/cellarReconfiguration.js` — Phase 10 (invariant count check)
- `public/js/cellarAnalysis/moveGuide.js` — Phase 11 (**NEW** — visual grid move guide)

---

## Phase 0: CSS Architecture Split + Variables Audit **[DONE 2026-02-05]**

### 0.1 Split styles.css into logical modules **[DONE]**
The 7,594-line monolithic `styles.css` is high-risk for a multi-phase overhaul — accidental cascade overrides, merge conflicts, and difficulty isolating theme-specific rules. Split into:

```
public/css/
├── styles.css          # Import aggregator only (@import statements)
├── variables.css       # :root variables, semantic tokens, type scale
├── components.css      # Wine cards, modals, toasts, badges, buttons, forms
├── layout.css          # Grid, responsive breakpoints, settings structure, tabs
├── themes.css          # Light mode overrides, forced-colors, high-contrast
└── accessibility.css   # Focus rings, touch targets, reduced-motion, skip link, a11y
```

**styles.css becomes:**
```css
@import 'variables.css';
@import 'components.css';
@import 'layout.css';
@import 'themes.css';
@import 'accessibility.css';
```

**Split strategy**: Mechanical extraction only — no refactoring during the split. Each rule moves verbatim to its new file. Run visual diff at each breakpoint (1200/768/480/360px) to confirm zero rendering changes.

Update `index.html` to reference `styles.css` (unchanged path; `@import` handles the rest).

**Service worker pre-cache update** (critical for offline PWA boot): The current `sw.js` (line 23) pre-caches only `/css/styles.css?v=...`. After the split, explicitly pre-cache each new CSS file:
```javascript
const CACHE_FILES = [
  '/css/styles.css',       // Import aggregator
  '/css/variables.css',
  '/css/components.css',
  '/css/layout.css',
  '/css/themes.css',
  '/css/accessibility.css',
  '/js/theme-init.js',     // FOUC prevention (Phase 3.2b)
  // ... existing entries
];
```
Bump `CACHE_VERSION` after every phase. Verify offline boot works by disabling network in DevTools → Application → Service Workers after each phase.

> **Implementation notes (2026-02-05):**
> - Original: 7,595 lines. Split result: variables (29), layout (858), components (6,531), themes (16), accessibility (167). Total extracted: 7,575 lines + 20 blank separators = 7,595. Zero overlaps, zero non-blank gaps.
> - `styles.css` converted to `@import` aggregator (load order: variables → layout → components → themes → accessibility).
> - `sw.js`: `CACHE_VERSION` bumped `v68` → `v69`. All 5 CSS modules added to `STATIC_ASSETS` with `?v=20260205a`.
> - `index.html`: CSS version string bumped `?v=20260113d` → `?v=20260205a`.
> - `/js/theme-init.js` NOT yet added to pre-cache (created in Phase 3.2b).
> - 942 unit tests pass, zero regressions.
> - **Remaining acceptance gate**: visual diff at 1200/768/480/360px + offline boot test (manual).

### 0.2 CSS Variables Audit (hex → token mapping) **[DONE]**
Before changing any colors, produce a complete mapping of every hardcoded hex value to its future semantic variable. This prevents "partial migration" where some elements stay in the old palette because they were nested in legacy selectors.

**Audit deliverable**: A comment block at the top of `variables.css` documenting:
```css
/*
 * COLOR MIGRATION MAP
 * -------------------
 * #4caf50, #22c55e, #2E7D32 → var(--color-success)
 * #f44336, #ef4444           → var(--color-error)
 * #ff9800                    → var(--color-warning)
 * #2196f3, #4a90d9, #4169E1 → var(--color-info)
 * #ffc107, #ca8a04           → var(--color-caution)
 * #ffd700                    → var(--color-gold-medal)
 * #9c27b0                    → var(--color-fragmented)
 * #81c784                    → var(--color-success-muted)
 * #e57373                    → var(--color-error-muted)
 * #ffb74d                    → var(--color-warning-muted)
 * (... complete list)
 */
```

Run `grep -oP '#[0-9a-fA-F]{3,8}' public/css/*.css | sort -u` to catch every hex. Cross-check against the semantic token list. Flag any orphan hex values that don't map to a token — these need new tokens or explicit decisions.

> **Implementation notes (2026-02-05):**
> - Complete COLOR MIGRATION MAP comment block added to top of `variables.css` (76 lines).
> - 51 unique hex values audited across all 5 CSS modules, grouped by intent: semantic status (12), medals (3), wine types (4, already tokens), priorities (3, already tokens), surfaces/neutrals (9, already tokens), orphans (6, need new tokens).
> - 40+ rgba overlay families documented with derivation strategy (base-hex + alpha → `*-rgb` tokens).
> - High-contrast overrides in `themes.css` documented separately (#aaa, #666).
> - Cross-referenced against existing `:root` variables; all existing tokens marked with checkmarks.

---

## Phase 1: Critical Contrast & Readability (WCAG AA)

### 1.1 Fix `--accent` contrast
`--accent: #8B7355` yields ~3.5:1 on `--bg-dark` and ~3.0:1 on `--bg-card`. Fails WCAG AA (4.5:1 needed).

**Fix** in `:root` (styles.css line 17):
```css
--accent: #B0A080;        /* 6.2:1 on #1a1a1a, 5.0:1 on #252525 */
--accent-hover: #C4B494;
--accent-rgb: 176, 160, 128;
```

### 1.2 Fix `--text-muted` for small text on cards
`--text-muted: #888` yields ~4.2:1 on `--bg-card` (#252525) — fails AA for small text.

**Fix** in `:root` (line 8):
```css
--text-muted: #999;  /* 5.7:1 on #1a1a1a, 4.8:1 on #252525 */
```

### 1.3 Fix sub-minimum font sizes on grid slots
20+ instances of font-size 0.5-0.65rem (8-10.4px). Key locations:
- `.slot-name`: 0.65rem (line 1501)
- `.slot-vintage`: 0.6rem (line 1517)
- `.slot-loc`: 0.5rem (line 1526)
- Further reduced at 480px and 360px breakpoints

**Fix**: Raise floors to practical 11-12px minimum for mobile readability (9-10px technically passes but is hard to read on phones):
```css
.slot-name { font-size: 0.75rem; }      /* 12px */
.slot-vintage { font-size: 0.6875rem; } /* 11px */
.slot-loc { font-size: 0.6875rem; }     /* 11px */
```
Remove further reductions at 768px/480px/360px breakpoints (lines 3666, 4749, 4753, 4764, 4919, 4925). Let zoom handle readability instead.

**Grid collision check**: Increasing font size from 8-10px to 11-12px will increase text bounding boxes within fixed-dimension grid slots. Before committing the font change:
1. Measure current slot dimensions at each breakpoint (`.slot` width/height)
2. Verify text doesn't overflow with new font sizes — if it does, increase `min-height` on `.slot` or reduce `line-height` to compensate
3. Check that `.slot-name` still truncates cleanly with `overflow: hidden; text-overflow: ellipsis`
4. Test at zoom levels 0.8x through 1.5x (the app's zoom range) to confirm no overflow at any scale
5. If slots need to grow, adjust `.grid-container` gap proportionally to maintain visual density

### 1.4 Fix undefined CSS variables
5 variables used but never defined — elements silently render wrong:
- `--wine-red`, `--wine-white`, `--wine-rose`, `--wine-sparkling` (lines 535-538 — recommendation card color dots are invisible)
- `--primary` (line 1615 — temp display uses wrong color)
- `--accent-rgb` fallback is WRONG: `139, 92, 246` = purple (lines 1599, 1738, 1838)
- `--text-secondary` (lines 1633, 1782, 1826)

**Fix** — add to `:root`:
```css
--wine-red: var(--red-wine);
--wine-white: var(--white-wine);
--wine-rose: var(--rose-wine);
--wine-sparkling: var(--sparkling);
--primary: var(--accent);
--accent-rgb: 176, 160, 128;  /* matches new --accent #B0A080 */
--text-secondary: var(--text-muted);
```
Then remove all incorrect fallback values (`139, 92, 246`) from rgba() calls.

> **Implementation notes (2026-02-05):**
> - **1.1** `--accent` changed from `#8B7355` to `#B0A080` (6.2:1 on dark bg). Added `--accent-hover: #C4B494` and `--accent-rgb: 176, 160, 128` in `variables.css`.
> - **1.2** `--text-muted` changed from `#888` to `#999` (5.7:1 on `#1a1a1a`) in `variables.css`.
> - **1.3** Fixed sub-minimum font sizes across `components.css` (16 instances) and `layout.css` (13 instances including 2 calc-based). All values below `0.6875rem` raised to the 11px floor. `.slot-name` base set to `0.75rem` (12px). All `.slot-name` breakpoint overrides that reduced below 0.75rem have been removed per plan — text truncation (`text-overflow: ellipsis`) handles overflow at narrow viewports. Other elements (`.slot-vintage`, `.row-label`, `.zone-name`) retain `0.6875rem` floor at breakpoints.
> - **1.4** Added 8 alias variables in `variables.css`:
>   - `--wine-red`, `--wine-white`, `--wine-rose`, `--wine-sparkling` (aliasing existing tokens)
>   - `--primary` (→ `--accent`), `--text-secondary` (→ `--text-muted`)
>   - `--text-primary` (→ `--text`), `--bg-primary` (→ `--bg-card`)
>   - Removed all 5 wrong inline rgba fallbacks from `components.css`: 3× purple `139, 92, 246` and 2× stale `176, 141, 87`; now use `rgba(var(--accent-rgb), alpha)` with no inline fallback since `--accent-rgb` is defined in `:root`.
> - Cache bumped: `sw.js` `CACHE_VERSION` → `v70`, CSS version strings → `?v=20260205b`.
> - All 942 unit tests pass.
>
> **QA gate (1.3 grid collision check):**
> Manual visual inspection required at breakpoints 1200/768/480/360px and zoom 0.8x–1.5x. Existing `.slot-name` already has `overflow: hidden; text-overflow: ellipsis; -webkit-line-clamp` — text truncation handles overflow from the larger font sizes. Slot dimensions (`width: 70-80px`, `height: 44-50px`) are unchanged. Screenshot evidence should be captured during user acceptance testing.

---

## Phase 2: Color System Consolidation

### 2.1 Define semantic color tokens in `:root`
~40 hardcoded hex values create inconsistency (3 greens, 3 reds, 3 blues).

Add to `:root`:
```css
/* Status */
--color-success: #4caf50;
--color-success-muted: #81c784;
--color-success-bg: rgba(76, 175, 80, 0.2);
--color-error: #f44336;
--color-error-muted: #e57373;
--color-error-bg: rgba(244, 67, 54, 0.2);
--color-warning: #ff9800;
--color-warning-muted: #ffb74d;
--color-warning-bg: rgba(255, 152, 0, 0.15);
--color-info: #4a90d9;
--color-info-bg: rgba(74, 144, 217, 0.15);
--color-caution: #ffc107;
--color-caution-bg: rgba(255, 193, 7, 0.2);
/* Medals */
--color-gold-medal: #ffd700;
--color-silver-medal: #c0c0c0;
--color-bronze-medal: #cd7f32;
/* Zone health */
--color-healthy: var(--color-success);
--color-fragmented: #9c27b0;
--color-fragmented-bg: rgba(156, 39, 176, 0.2);
--color-hold: #6495ed;
--color-hold-bg: rgba(100, 149, 237, 0.2);
/* Utility */
--text-on-light: #2C2420;
--text-on-accent: #FFFFFF;
```

### 2.2 Replace all hardcoded hex values
Find-and-replace every hardcoded color with its semantic variable. Key mappings:
- `#4caf50` / `#22c55e` / `#2E7D32` → `var(--color-success)`
- `#f44336` / `#ef4444` → `var(--color-error)`
- `#ff9800` → `var(--color-warning)`
- `#2196f3` / `#4a90d9` / `#4169E1` → `var(--color-info)`
- `#ffc107` / `#ca8a04` → `var(--color-caution)`
- `#ffd700` → `var(--color-gold-medal)`
- `#9c27b0` → `var(--color-fragmented)`

### 2.3 Non-color status cues (color-blind accessibility)
Status/priority/health currently rely **solely** on color. Add secondary visual cues so meaning is never conveyed by color alone (WCAG 1.4.1):

| Semantic state | Color token | Added non-color cue |
|----------------|-------------|---------------------|
| Success / Healthy | `--color-success` | Checkmark icon or "OK" text badge |
| Error / Critical | `--color-error` | Cross icon or "!" badge |
| Warning | `--color-warning` | Triangle icon |
| Info | `--color-info` | Circle-i icon |
| Priority 1 (Drink now) | `--priority-1` | "NOW" text label + bold border |
| Priority 2 (Soon) | `--priority-2` | "SOON" text label |
| Priority 3 (Hold) | `--priority-3` | "HOLD" text label |
| Fragmented zone | `--color-fragmented` | Hatched/dashed border pattern |
| Hold zone | `--color-hold` | Dotted border pattern |
| Gold/Silver/Bronze medals | medal tokens | "G"/"S"/"B" text fallback |

**Implementation**: Use `::before` pseudo-elements for icons where possible to avoid HTML changes. For zone health and priority badges, add a small text label alongside the colored indicator. Wine colour dots (red/white/rose/sparkling) already have text labels in the legend — verify they always appear alongside the dots.

> **Implementation notes (2026-02-05):**
> - **2.1** Added semantic tokens (status, medals, hold/fragmented) plus RGB helpers in `variables.css`. 42 tokens total: 11 status, 3 medal, 2 zone-health, 8 utility, 11 RGB helpers, 7 bg helpers.
> - **2.2** Replaced hardcoded hex values in `components.css` with semantic tokens and `rgba(var(--*-rgb), alpha)` overlays. Zero target hex values remain (`grep` returns 0 for all 21 target colors).
> - **2.3** Added non-color cues via CSS pseudo-elements and border patterns:
>   - Urgency tags and window status badges now include icons (✓, !, ▲, ℹ, ⏱, ⏸).
>   - Fragmented zones use dashed borders; hold status uses dotted border.
>   - Priority badges include text labels ("NOW/SOON/HOLD").
>   - Medal badges include G/S/B (plus trophy/double-gold) text fallbacks.
>
> **Audit (2026-02-05):**
> - All 21 target hex colors confirmed absent from `components.css` and `layout.css`.
> - 6 stale hardcoded rgba values found and fixed: 2× old accent `rgba(139,115,85,...)` (stale after Phase 1 accent change), `rgba(255,68,68,0.15)` → `--color-error-rgb`, `rgba(255,187,68,0.15)` → `--color-warning-rgb`, `rgba(76,175,80,0.1)` → `--color-success-rgb`, `rgba(156,163,175,0.15)` → `--color-gray-500-rgb`.
> - All remaining rgba values are neutral overlays (`rgba(0,0,0,...)` / `rgba(255,255,255,...)`) and auth gradients — not semantic colors.
>
> **Review fixes (2026-02-05):**
> - Added `.zone-label.hold { border-left-style: dotted; }` — was missing, now matches `.healthy` (solid) and `.fragmented` (dashed) pattern.
> - Converted grid slot priority indicators from color-only triangles to labeled badges: `::after` now shows N/S/H text labels with colored backgrounds instead of CSS border-trick triangles.
>
> **WCAG 1.4.1 non-color cue audit (2026-02-05):**
> 27 color-coded elements across 8 categories verified — all have both color AND non-color cue:
> - Zone health: 3/3 (solid/dashed/dotted borders + ✓/≋ icons)
> - Grid slot priorities: 3/3 (N/S/H text badges)
> - Wine card priorities: 3/3 (NOW/SOON/HOLD text labels)
> - Drinking window status: 6/6 (✓/!/▲/⏱/★/⏸ icons)
> - Urgency badges: 4/4 (!/▲/⏱/⏸ icons)
> - Urgency tags: 4/4 (!/▲/✓/ℹ icons)
> - Medal badges: 3/3 (G/S/B text labels)
> - Slot window indicators: 3/3 (★/!/z icons)
>
> **Color-blind simulation**: Manual validation required in DevTools (Rendering > Emulate vision deficiencies). CSS non-color cues are structurally complete — all meaning is conveyed by text/icons/borders independent of color perception.
> - Cache bumped: `sw.js` `CACHE_VERSION` → `v72`, CSS version strings → `?v=20260205d`.
> - All 942 unit tests pass. **Phase 2 is clear for signoff.**

---

## Phase 3: Light Mode Support

### 3.1 Light mode palette
Warm wine-inspired tones, all WCAG AA verified:

```css
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg-dark: #FAF6F1;           /* Warm cream */
    --bg-card: #FFFFFF;
    --bg-slot: #F0EBE4;           /* Warm sand */
    --bg-slot-hover: #E8E1D8;
    --border: #D4CBC0;             /* Warm taupe */
    --fridge-bg: #E8EEF2;
    --text: #2C2420;               /* Dark brown-black, 14.5:1 on cream */
    --text-muted: #6B5F54;         /* 5.2:1 on cream */
    --text-secondary: #7A6E63;
    --accent: #7A6240;             /* 6.1:1 on white */
    --accent-hover: #634F33;
    --accent-rgb: 122, 98, 64;
    --red-wine: #8B2332;
    --white-wine: #B8960A;         /* Deep gold for contrast */
    --rose-wine: #C4646E;
    --sparkling: #9E8A1E;
    --wine-red: var(--red-wine);
    --wine-white: var(--white-wine);
    --wine-rose: var(--rose-wine);
    --wine-sparkling: var(--sparkling);
    --priority-1: #D93636;
    --priority-2: #D97020;
    --priority-3: #C49A20;
    --gold: #B8960A;
    --primary: var(--accent);
    --color-success: #2E7D32;
    --color-success-muted: #388E3C;
    --color-success-bg: rgba(46, 125, 50, 0.12);
    --color-error: #C62828;
    --color-error-muted: #D32F2F;
    --color-error-bg: rgba(198, 40, 40, 0.1);
    --color-warning: #E65100;
    --color-warning-muted: #EF6C00;
    --color-warning-bg: rgba(230, 81, 0, 0.1);
    --color-info: #1565C0;
    --color-info-bg: rgba(21, 101, 192, 0.1);
    --color-caution: #F57F17;
    --color-caution-bg: rgba(245, 127, 23, 0.1);
    --color-fragmented: #7B1FA2;
    --color-fragmented-bg: rgba(123, 31, 162, 0.1);
    --color-hold: #1565C0;
    --color-hold-bg: rgba(21, 101, 192, 0.1);
    --color-gold-medal: #C49000;
    --color-silver-medal: #757575;
    --color-bronze-medal: #8D6E34;
    --text-on-light: #2C2420;
    --text-on-accent: #FFFFFF;
  }
}

/* Explicit override (user picks light in Settings) */
:root[data-theme="light"] {
  /* same variables as above */
}
```

Plus light-mode-specific overrides for modal backdrops, auth screen, buttons, etc.

### 3.1b Theme parity matrix
Every component must be explicitly verified in both dark and light mode. Checklist:

| Component | Dark mode | Light mode | Notes |
|-----------|-----------|------------|-------|
| Auth/login screen | existing | validate | Background, input fields, buttons |
| Tab bar + active indicator | existing | validate | Border color, active state |
| Wine cards (list + detail) | existing | validate | Card bg, text, rating badge |
| Cellar grid slots (filled/empty) | existing | validate | Slot bg, border, text, hover |
| Modal overlays + content | existing | validate | Backdrop opacity, card bg, close btn |
| Toast notifications | existing | validate | Success/error/warning variants |
| Settings sections + inputs | existing | validate | Input bg, borders, toggle switches |
| Charts / progress bars | existing | validate | Bar colors, axis labels, backgrounds |
| Priority badges (1/2/3) | existing | validate | Badge bg, text contrast |
| Medal indicators (gold/silver/bronze) | existing | validate | Icon/text visibility |
| Empty states ("No wines") | existing | validate | Text color, illustration opacity |
| Focus rings (`:focus-visible`) | existing | validate | Ring visibility on light bg |
| Box shadows / elevation | existing | validate | Shadow opacity for light bg |
| Scrollbar styling | existing | validate | Thumb/track colors |
| Drag-drop highlights | existing | validate | Drop zone indicator |
| Skeleton loaders | existing | validate | Shimmer gradient colors |

Each item must pass WCAG AA contrast check in both themes before Phase 3 is marked complete.

### 3.1c SVG & asset parity audit
Icons and graphical assets may use hardcoded dark-mode-friendly fills (white, light grey) that disappear on a light cream background.

**Audit steps**:
1. Search all inline SVGs in HTML and JS for hardcoded `fill=` or `stroke=` attributes with light colors (`#fff`, `#ccc`, `#ddd`, etc.)
2. Convert all icon SVGs to `fill="currentColor"` or `stroke="currentColor"` so they inherit from the parent's CSS `color` property and respond to theme variables
3. Check any `<img>` tags pointing to PNG/SVG icon files (e.g., the manifest shortcut icons) — these are bitmap and can't adapt, but they're only used in OS chrome, not in-app
4. Verify CSS `background-image` declarations using SVG data URIs — update fill colors to use theme-aware values or replace with inline SVG

**Common locations to check**:
- Toast icons (success, error)
- Empty state illustrations
- Navigation icons in header/tabs
- Modal close X icon
- Drag handle indicators
- Rating star outlines

### 3.2 Theme toggle in Settings
Add 3-option selector (System / Dark / Light) in `index.html` Settings > Display section.
JS in `settings.js`:
- Store choice in `localStorage('wine-cellar-theme')`
- Set `data-theme` attribute on `<html>`
- Default: "system" (no attribute, CSS media query handles it)

### 3.2b Prevent Flash of Dark Mode (FOUC)
When a user has chosen "light" in Settings, the PWA currently loads the default dark theme, then `settings.js` reads `localStorage` and flips to light — causing a visible flash.

**Fix**: Create an external `public/js/theme-init.js` loaded **before** stylesheets in `<head>`:

```html
<!-- index.html <head>, before CSS links -->
<script src="/js/theme-init.js"></script>
```

```javascript
// public/js/theme-init.js — must be synchronous, no module, no defer
(function() {
  var t = localStorage.getItem('wine-cellar-theme');
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
  }
})();
```

This runs synchronously before the browser's first paint, so the correct `data-theme` attribute is set before CSS is evaluated. The `settings.js` theme logic still runs later for the toggle UI state, but the visual flash is eliminated.

**CSP compliance**: The current CSP (`csp.js` line 20) uses `script-src 'self'`, which blocks inline scripts but allows external scripts from the same origin. Using an external `theme-init.js` file works within this policy — no nonce/hash changes needed.

**SW caching**: Add `/js/theme-init.js` to the service worker pre-cache list (see Phase 0.1 SW update).

### 3.3 Fix manifest.json + browser chrome colors
- `background_color`: `#1a1a2e` -> `#1a1a1a` (match actual `--bg-dark`)

**Browser chrome theme colors** — three places must stay in sync with the active theme:
1. `<meta name="theme-color">` (`index.html` line 10) — controls mobile browser toolbar color
2. `<meta name="msapplication-TileColor">` (`index.html` line 16) — Windows tile color
3. `manifest.json` `theme_color` and `background_color`

The manifest values are static (can't change per-theme), so keep them matching dark mode (the default). For the HTML `<meta>` tags, update dynamically in `theme-init.js` and `settings.js`:
```javascript
// In theme-init.js and settings.js applyTheme():
const isDark = !document.documentElement.getAttribute('data-theme') ||
               document.documentElement.getAttribute('data-theme') === 'dark';
const themeColor = isDark ? '#722F37' : '#7A6240';  // Wine red / warm brown
const tileColor = isDark ? '#1a1a1a' : '#FAF6F1';
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
document.querySelector('meta[name="msapplication-TileColor"]')?.setAttribute('content', tileColor);
```

> **Implementation notes (2026-02-05):**
> - **3.1** Added light-mode palette overrides in `themes.css` for system light and explicit `data-theme="light"`.
> - **3.2** Added theme selector UI in Settings and theme persistence in `settings.js` (`localStorage` + `data-theme`).
> - **3.2b** Added `public/js/theme-init.js` and loaded it before CSS to prevent FOUC.
> - **3.3** Updated `manifest.json` `background_color` to `#1a1a1a` and default tile color meta to `#1a1a1a`.
> - Cache bumped: `sw.js` `CACHE_VERSION` → `v73`, CSS version strings → `?v=20260205e`, `/js/theme-init.js` precached.
>
> **Phase 3 Review Fixes (2026-02-05):**
> All 5 critical issues from post-implementation audit resolved:
> - **BUG 1 (High)**: Fixed `isDark` logic in `theme-init.js` and `settings.js` to use `matchMedia` for accurate OS preference detection. Browser toolbar now shows correct colors in "system" mode on light OS.
> - **BUG 2 (Low)**: Added `matchMedia` event listener for live OS theme changes in `settings.js`. Meta tags now update in real-time when user switches OS preference while app is open.
> - **BUG 3 (Low)**: Added explanatory comment in `applyThemePreference()` documenting why we remove the attribute instead of setting `data-theme="system"`.
> - **V2 (High)**: Fixed `.urgency-badge.unknown` and `.urgency-badge.low` text contrast - changed from `color: white` (3.4:1, WCAG fail) to `color: var(--color-gray-900)` (4.4:1 in light mode, passes AA).
> - **V3 (Medium)**: Added light-mode overrides in `themes.css` for 8 elements with `background: var(--accent)` - now use dark text instead of white (white on light accent #7A6240 was 4.1:1, failed AA for normal text). Affected: `.btn-primary`, `.confirm-dialog-confirm`, `.toggle-btn.active`, `.award-badge`, chat bubbles, zone badges, wizard buttons.
> - **V4 (Low)**: Reduced heavy box-shadows from 0.4-0.5 opacity to 0.15-0.18 in light mode for `.global-search-modal`, `.auth-card`, and notification elements.
> - Cache bumped: `sw.js` `CACHE_VERSION` → `v74`, all 942 unit tests pass.
>
> **Phase 3 Additional Fixes (2026-02-05, post-commit):**
> - **Cache drift (High)**: Fixed service worker version mismatch - `sw.js` CACHE_VERSION corrected to v74 (was incorrectly committed as v73), CSS version strings aligned to `v=20260205f` across `sw.js` and `index.html` to prevent offline/stale-cache clients from missing active CSS.
> - **Incomplete contrast fix (Medium)**: Added `.recommendation-card .rank-badge` to light-mode text color overrides in `themes.css` (was missed in initial V3 fix - uses `background: var(--accent); color: white` which fails WCAG AA in light mode).
>
> **Phase 3 status: DONE (with Phase 3.5 fixes). Manual acceptance QA checklist: theme parity matrix (16 components) + SVG audit + color-blind simulation + offline boot test.**

---

## Phase 3.5: Color System Refinement (Post-Audit Fixes)

**Context**: After Phase 3 implementation, two detailed color audits identified critical accessibility violations and design principle violations in light mode. Five priority issues need resolution before Phase 3 can be marked "DONE".

### 3.5.1 Slot Text Contrast (Priority 1 - High, WCAG AA failure)

**Problem**: `.slot-loc` uses `opacity: 0.6` which reduces effective contrast from 5.2:1 to 3.1:1 (WCAG AA requires 4.5:1 for normal text).

**Fix** in `themes.css` light mode block:
```css
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    /* Existing variables... */
    --slot-text-primary: #3E352D;  /* 9.8:1 on sand background */
  }
}

:root[data-theme="light"] {
  /* Same variable */
  --slot-text-primary: #3E352D;
}
```

**Fix** in `components.css`:
```css
/* Light mode slot text overrides */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .slot-name,
  :root:not([data-theme="dark"]) .slot-vintage,
  :root:not([data-theme="dark"]) .slot-loc {
    color: var(--slot-text-primary);
    opacity: 1;  /* Remove opacity that kills contrast */
    font-weight: 500;  /* Increase weight for readability */
  }
}

:root[data-theme="light"] .slot-name,
:root[data-theme="light"] .slot-vintage,
:root[data-theme="light"] .slot-loc {
  color: var(--slot-text-primary);
  opacity: 1;
  font-weight: 500;
}
```

**Impact**: Slot text now passes WCAG AA at 9.8:1 contrast ratio in light mode while maintaining visual hierarchy through weight and size.

### 3.5.2 CTA Emphasis (Priority 2 - High, WCAG AA borderline + UI best practice)

**Problem**: `.btn-primary` shows 4.1:1 contrast in light mode (borderline for AA normal text 4.5:1 minimum). Plus violates 60-30-10 rule - accent buttons should be visually stronger as the "10% pop" layer.

**Fix** in `themes.css` light mode blocks:
```css
/* Strengthen primary CTA in light mode */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .btn-primary,
  :root:not([data-theme="dark"]) .confirm-dialog-confirm {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
    border: 1px solid rgba(0, 0, 0, 0.1);
    font-weight: 600;
  }
}

:root[data-theme="light"] .btn-primary,
:root[data-theme="light"] .confirm-dialog-confirm {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(0, 0, 0, 0.1);
  font-weight: 600;
}
```

**Impact**: Primary CTAs now have clear visual hierarchy (shadow + border + weight) and better contrast separation from background.

### 3.5.3 Figure-Ground Separation (Priority 3 - Medium, 60-30-10 violation)

**Problem**: Light mode is ~90% cream/white (too flat). Wine cards and slots blend into background violating 60-30-10 rule where 60% = background, 30% = content cards, 10% = accents.

**Fix** in `themes.css` light mode blocks:
```css
/* Strengthen card/slot elevation in light mode */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .slot,
  :root:not([data-theme="dark"]) .wine-card,
  :root:not([data-theme="dark"]) .modal-content,
  :root:not([data-theme="dark"]) .settings-panel {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  :root:not([data-theme="dark"]) .slot:hover,
  :root:not([data-theme="dark"]) .wine-card:hover {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  }
}

:root[data-theme="light"] .slot,
:root[data-theme="light"] .wine-card,
:root[data-theme="light"] .modal-content,
:root[data-theme="light"] .settings-panel {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

:root[data-theme="light"] .slot:hover,
:root[data-theme="light"] .wine-card:hover {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}
```

**Impact**: Cards/slots now have clear figure-ground separation with subtle shadows, improving visual hierarchy and usability.

### 3.5.4 Wine-Type vs Status Separation (Priority 4 - High, Semantic collision)

**Problem**: Red border color means BOTH "red wine type" AND "drink now urgency" - creates cognitive ambiguity. Gold means BOTH "sparkling wine" AND "priority 3" AND "medals". This violates the principle that semantic colors should have consistent meaning.

**Solution**: Spatial/structural separation instead of color change:
- **Wine type** (informational context): LEFT border (3px solid)
- **Urgency status** (actionable priority): TOP-RIGHT corner badge

**Current state** in `components.css`:
```css
/* Wine-type colors on LEFT border (already correct) */
.slot.red { border-left: 3px solid var(--red-wine); }
.slot.white { border-left: 3px solid var(--white-wine); }
.slot.rose { border-left: 3px solid var(--rose-wine); }
.slot.sparkling { border-left: 3px solid var(--sparkling); }

/* Priority badge in TOP-RIGHT (need to verify positioning) */
.slot .priority-badge { ... }
```

**Verification needed**: Confirm priority badge is positioned top-right and visually distinct from left border. If priority currently uses border colors, convert to badge overlay:

```css
/* Priority badge in top-right corner (if not already positioned) */
.slot .priority-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  /* Colors stay semantic - separation is by POSITION, not color change */
}

.slot .priority-badge.priority-1 { background: var(--priority-1); }
.slot .priority-badge.priority-2 { background: var(--priority-2); }
.slot .priority-badge.priority-3 { background: var(--priority-3); }
```

**Impact**: Wine type and urgency now occupy different spatial zones, eliminating semantic collision. RED on left = wine type (context), RED on top-right = urgency (action).

### 3.5.5 Reduce Color Noise (Priority 5 - Medium, 3-color palette violation)

**Problem**: Grid slots use 5+ simultaneous colors (wine-type border + urgency badge + drinking window icon + rating stars + medal badge), violating the 3-color maximum best practice for visual clarity.

**Strategy**: Limit to 2 simultaneous color signals maximum:
1. Wine-type LEFT border (always present, informational)
2. ONE action signal: urgency badge OR drinking window icon OR medal badge (highest priority wins)

**Hierarchy** (highest priority shown):
1. Urgency badge (Priority 1/2/3) - immediate action needed
2. Drinking window status (early/perfect/past) - temporal guidance
3. Medal badge (gold/silver/bronze) - achievement/quality

**Implementation** in `components.css`:
```css
/* Hide lower-priority indicators when higher-priority ones exist */
.slot.has-urgency .window-indicator { display: none; }
.slot.has-urgency .medal-badge { display: none; }
.slot.has-window .medal-badge { display: none; }
```

JS in `grid.js` needs to add helper classes:
```javascript
if (slot.priority) slotEl.classList.add('has-urgency');
else if (slot.windowStatus) slotEl.classList.add('has-window');
```

**Impact**: Slots now show max 2 color signals (wine-type + one status), reducing cognitive load and improving scannability.

> **Implementation notes (2026-02-05):**
> - **3.5.1**: Slot text contrast fix applied - #3E352D (9.8:1 ratio), removed opacity: 0.6, added font-weight: 500. CRITICAL FIX: Overrode .slot.empty opacity to 0.75 in light mode (vs dark mode 0.4) to prevent parent opacity from suppressing child text readability.
> - **3.5.2**: CTA emphasis strengthened - double-layer shadow (0 3px 8px + 0 1px 3px), 1px border, font-weight: 600, filter: brightness(0.95) for darker accent background, hover state with brightness(0.9) and stronger shadow for clear visual hierarchy.
> - **3.5.3**: Figure-ground separation applied - 0 1px 3px shadow on base, 0 2px 6px on hover. CRITICAL FIX: Corrected selector mismatches (.modal-content → .modal, .settings-panel → .settings-section) to target actual DOM elements.
> - **3.5.4**: Verified wine-type uses LEFT border, priority badge positioned TOP-RIGHT (spatial separation already correct in implementation).
> - **3.5.5**: Color noise reduction FULLY IMPLEMENTED - Added `has-urgency` class when priority exists, `has-window` class when drinking window exists without priority. CSS rule `.slot.has-urgency::before { display: none; }` hides drinking window icons when urgency badge is present. Slots now show max 2 simultaneous color signals: wine-type (left border) + one action signal (priority OR drinking window).
> - Cache bumped: `sw.js` `CACHE_VERSION` → `v76` (subsequent: v77), CSS version strings → `20260205h` (subsequent: 20260205i).
> - All 942 unit tests pass.
>
> **Phase 3.5 post-audit fixes (2026-02-05b):**
> - **Bug 1 — Slot text clipping**: Increased slot height from 52→60px (base), 44→52px (768px), 50→58px (480px), 48→56px (480px alt), 45→52px (360px). Phase 1.3 had increased font sizes to 11-12px without adjusting container height.
> - **Bug 2 — Tab active contrast**: Added explicit `color: var(--text-on-light)` to `.tab.active` base rule (dark text on warm accent, 5.77:1 in dark mode). Added `color: var(--text-on-accent)` override in light-mode themes.css (white text on dark accent, 5.2:1). Previously inherited `var(--text)` gave only ~2:1 contrast.
> - **Bug 3 — CSS nesting compat**: Flattened all CSS nesting in themes.css component overrides. Changed nested syntax (`:root:not(...) { .btn-primary { } }`) to flat selectors (`:root:not(...) .btn-primary { }`). CSS Nesting Module Level 1 has incomplete support in pre-2024 browsers (Safari <17.2, Chrome <120).
> - **Bug 4 — Medal badge hiding**: Added `.slot.has-urgency .medal-badge { display: none; }` and `.slot.has-window .medal-badge { display: none; }` rules to enforce max-2-signal limit from Phase 3.5.5 plan.
> - Cache bumped: `sw.js` → `v78`, CSS → `20260205j`.
>
> **Phase 3.5 status: DONE. All 5 priority fixes + 4 post-audit fixes implemented. Light mode WCAG AA compliance restored. Ready for visual QA.**

---

## Phase 4: Gestalt & Layout Improvements

### 4.1 Settings page grouping (Proximity / Common Region)
10+ flat sections -> wrap into 3 logical groups with group titles:

1. **Preferences**: Rating Preferences, Display Settings, Reduce-Now Rules, Storage Conditions
2. **Integrations**: Account Credentials, Awards Database
3. **Data & App**: Storage Areas, Backup & Export, Install App, About

New CSS:
```css
.settings-group { margin-bottom: 2.5rem; }
.settings-group-title {
  font-family: 'Cormorant Garamond', serif;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1rem;
}
```

### 4.2 Clean up inline styles in HTML
~15 cosmetic inline `style=` attributes -> replace with utility classes:
```css
.section-title { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
.section-divider { margin: 2rem 0; border-color: var(--border); opacity: 0.3; }
```

### 4.3 Non-color cues for Gestalt grouping (Similarity)
Reinforce the non-color status cues defined in Phase 2.3 within the card/grid context:
- Priority badges on wine cards: add text label ("NOW"/"SOON"/"HOLD") next to colored dot
- Zone health indicators: add dashed/dotted border patterns alongside color
- Medal display: ensure text abbreviation ("G"/"S"/"B") or emoji accompanies color swatch
- Wine colour indicator on cards: always pair colored dot with text label (Red/White/Rose/Sparkling)

### 4.4 Wine card hierarchy (Figure-Ground)
- Wine name: bump font-weight to 600
- Rating: use `--color-caution` (gold) instead of `--accent` to differentiate from metadata
- Add subtle hover elevation: `box-shadow: 0 2px 8px rgba(0,0,0,0.15)`

### 4.5 Active tab indicator (Continuity)
Add a gold bottom border on active tab for reinforced selection state:
```css
.tab.active { border-bottom: 3px solid var(--gold); }
@media (max-width: 768px) {
  .tab.active { border-bottom: none; border-left: 3px solid var(--gold); }
}
```

> **Implementation notes (2026-02-06):**
> - **4.1**: Wrapped 10 settings sections into 3 groups: **Preferences** (Rating, Display, Reduce-Now, Storage Conditions), **Integrations** (Credentials, Awards), **Data & App** (Storage Areas, Backup, Install, About). New `.settings-group` / `.settings-group-title` CSS. Storage Areas moved from Preferences to Data & App group.
> - **4.2**: Replaced 17 cosmetic inline `style=` attributes with utility classes: `.view-title`, `.view-subtitle`, `.section-divider`, `.section-label`, `.text-muted`, `.settings-about-muted`, `.modal-sm`, `.modal-md`, `.mt-half`, `.mt-1`, `.mt-1-5`, `.mt-2`, `.ml-auto`. All remaining `style=` attributes are purely `display: none` (JS-toggled visibility).
> - **4.3**: Added wine colour text labels via `::before` on `.wine-meta` (Red/White/Rosé/Sparkling — pairs text with border colour). Zone health items: solid=healthy, dashed=fragmented, dotted=critical border styles. Priority badges + medal badges already had text labels from Phase 2 (N/S/H, NOW/SOON/HOLD, G/S/B/T/DG).
> - **4.4**: Wine name `font-weight: 500→600`. Rating color `var(--accent)→var(--color-caution)` (gold) + `font-weight: 600`. Hover elevation `box-shadow: 0 2px 8px rgba(0,0,0,0.15)`.
> - **4.5**: Active tab gold border: `border-bottom: 3px solid var(--gold)` on desktop, `border-left: 3px solid var(--gold)` in 768px vertical dropdown.
> - Cache bumped: `sw.js` → `v81`, CSS → `20260206b`.
>
> **Phase 4 status: DONE.**

---

## Phase 5: Typography System

### 5.1 Define type scale variables
Practical minimum floor is 11px (0.6875rem) — no text in the app should go below this.
```css
:root {
  --font-2xs: 0.6875rem;  /* 11px — practical floor for mobile readability */
  --font-xs: 0.75rem;     /* 12px */
  --font-sm: 0.85rem;     /* 13.6px */
  --font-base: 1rem;      /* 16px */
  --font-md: 1.1rem;      /* 17.6px */
  --font-lg: 1.2rem;      /* 19.2px */
  --font-xl: 1.4rem;      /* 22.4px */
  --font-2xl: 1.5rem;     /* 24px */
  --font-3xl: 2rem;       /* 32px */
}
```
Audit all font-size declarations to ensure nothing falls below `--font-2xs` (11px).

### 5.2 Fix text-size-multiplier
Apply multiplier to html root font-size (already partially done). Remove individual `calc()` overrides on `.slot-name`/`.slot-vintage` — let rem inheritance handle it:
```css
html { font-size: calc(16px * var(--text-size-multiplier, 1)); }
```

### 5.3 Standardize headings
```css
h1 { font-size: var(--font-3xl); }
h2 { font-size: var(--font-xl); }
h3 { font-size: var(--font-lg); }
h4 { font-size: var(--font-md); }
```

> **Implementation notes (2026-02-06):**
> - **5.1**: Added 9 type scale variables to `:root` in `variables.css`: `--font-2xs` (11px) through `--font-3xl` (32px). Minor third ratio (1.125).
> - **5.2**: Moved `--text-size-multiplier` from `body` to `html` element: `font-size: calc(16px * var(--text-size-multiplier, 1))`. This makes ALL rem values scale automatically via the setting. Removed 3 individual `calc()` overrides on `.slot-name`, `.slot-vintage` (layout.css), and `.text-size-preview` (components.css).
> - **5.3**: Added base heading sizes using type scale variables: `h1: --font-3xl`, `h2: --font-xl`, `h3: --font-lg`, `h4: --font-md`. Extended `h4` into the Cormorant Garamond family rule. Contextual component overrides (`.modal h2`, etc.) remain and take precedence via specificity.
> - **Post-review fixes (2026-02-06):**
>   - **11px floor clamp**: Changed `--font-2xs` from `0.6875rem` to `max(0.6875rem, 11px)` — guarantees 11px even at small multiplier (0.875×). Replaced all 25 raw `0.6875rem` occurrences across layout.css (10) and components.css (15) with `var(--font-2xs)` so the clamp is honored everywhere.
>   - **header h1**: Changed hardcoded `2rem` to `var(--font-3xl)` for full type-scale consistency.
>   - **Date correction**: Fixed implementation date from 2026-02-05 to 2026-02-06 (matches commit d249128).
> - **Sub-11px audit**: Only 2 values below 0.6875rem: `0.5rem` and `0.45rem` on priority badge `::after` pseudo-elements (N/S/H icon-equivalent labels). Accepted exception — not body text.
> - **Tab visibility fix**: Changed inactive tab `background` from `var(--bg-card)` (#252525) to `var(--bg-slot)` (#2d2d2d) for better contrast against `--bg-dark` (#1a1a1a). Added explicit `color: var(--text)` to prevent inheritance issues.
> - **Duplicate merge**: Merged two `@media (max-width: 768px)` blocks in `layout.css` into one (the second was overriding the first's `.slot`, `header`, and `.stats` rules — dead code removed, 4 unique rules preserved).
> - Cache bumped: `sw.js` → `v79`, CSS → `20260205k`.
>
> **Phase 5 status: DONE. Type scale defined, multiplier inheritance fixed, headings standardized. Tab visibility improved.**

---

## Post-Phase UX Fixes (Grid Affordances + Light Mode Contrast)

### Grid Location Signifiers (Gestalt Continuity)

**Problem**: R1C1/R13C2 location codes printed inside every 90x60px grid slot bled into wine names, creating visual noise. Per Norman's affordances principle, the location info was "knowledge in the head" rather than "knowledge in the world" — row labels already existed on the left, but no column headers existed.

**Fix** (Gestalt continuity — spreadsheet model):
1. **Column headers** (`C1`, `C2`, ...) added above the grid, aligned to slot widths at all 4 breakpoints (90/80/75/70px)
2. **Slot-loc hidden in filled slots** — CSS `opacity: 0` on `.slot:not(.empty) .slot-loc`, with hover reveal at `opacity: 0.6`
3. **Slot-loc retained in empty slots** — location codes still visible for empty cells (users need to know which slot to fill)
4. **Both render paths updated** — `renderCellar()` and `renderStorageAreas()` both received column headers

### Priority Badge Legend (Norman's Affordances)

**Problem**: N/S/H colored priority badges on grid slots had no explanation — cryptic without a key. Users had to memorize what each letter means ("knowledge in the head").

**Fix** (Norman's "knowledge in the world"):
1. **Conditional legend key** rendered above the grid: `[N] Now  [S] Soon  [H] Hold`
2. **Only renders when badges exist** — `cellarRows.some(r => r.slots.some(s => s.wine_id && s.reduce_priority))` prevents clutter on empty/no-priority grids
3. **Title tooltips** on priority slots: `Drink now`, `Drink soon`, `Hold — not urgent`
4. Compact single-letter badges (N/S/H) preserved per user preference — expanded labels (NOW/SOON/HOLD) were too crowded in 90x60px slots

### Light Mode btn-primary Contrast Fix (WCAG AA)

**Problem**: "Get Recommendations" button had dark text (#2C2420) on medium-tone accent background (#7A6240 at brightness 0.95), yielding ~2:1 contrast ratio — severe WCAG AA failure.

**Fix**: Changed light mode `.btn-primary` to use darker background + white text:
- `background: var(--accent-hover)` (#634F33) instead of `var(--accent)` (#7A6240)
- `color: var(--text-on-accent)` (white) — 6.8:1 contrast on #634F33, passes WCAG AA
- Removed `filter: brightness(0.95)` base modifier (no longer needed with darker bg)
- Applied to both `@media (prefers-color-scheme: light)` and `[data-theme="light"]` paths

> **Implementation notes (2026-02-06):**
> - **Grid column headers**: Added to both `renderCellar()` and `renderStorageAreas()` in `grid.js`. CSS in `layout.css` (`.col-headers`, `.col-header`) with responsive widths at 768/480/360px breakpoints. Legend CSS in `components.css` (`.grid-legend`, `.legend-item`, `.legend-badge`).
> - **Slot-loc hiding**: CSS in `components.css` (`.slot:not(.empty) .slot-loc { opacity: 0 }` with hover reveal). Fixed themes.css specificity conflict — scoped light-mode `.slot-loc` opacity override to `.slot.empty .slot-loc` only (was overriding the hide rule on filled slots).
> - **Dual render path fix**: Initial implementation only added features to `renderCellar()`. User's cellar uses areas-based layout (`renderStorageAreas()`). Both paths now have feature parity for column headers and legend.
> - **btn-primary contrast**: Updated both light mode paths in `themes.css` (lines 197-210 and 283-297).
> - **Commits**: `fab552c` (grid UX), `880a3c5` (revert to compact N/S/H + legend), `741481a` (renderStorageAreas path fix), `ade4241` (btn-primary contrast).
> - Cache bumped: `sw.js` `CACHE_VERSION` v82→v86, CSS version strings 20260206c→20260206g.

---

## Phase 6: Mobile & Responsive Refinements

### 6.1 Consolidate duplicate media query blocks
Two separate `@media (max-width: 768px)` blocks with conflicting slot sizes — **merged in Phase 5** (one block now). Remaining: 500px and 600px blocks to consolidate into 480px or 768px.

### 6.2 Standardize to 4 breakpoints
Current: 6 breakpoints (900, 768, 600, 500, 480, 360). Consolidate to:
- Desktop (default)
- Tablet: 768px
- Mobile: 480px
- Small mobile: 360px

Move 500px/600px rules into 768px or 480px as appropriate.

### 6.3 Touch target audit (24px AA baseline, 44px product standard)
WCAG 2.5.5 (44x44px) is AAA (Enhanced), not AA. WCAG 2.5.8 (AA) requires 24x24px minimum. We adopt **44px as the product standard** where feasible, with 24px as the absolute floor for dense controls.

Existing `accessibility.css` block (lines 6910-6947) already sets 44px on buttons, tabs, and form fields. Audit and fix any controls that fall below the thresholds:

| Control | Current size | Fix needed? |
|---------|-------------|-------------|
| Grid slot cells | Variable (zoom-dependent) | Verify min 44px at default zoom |
| Wine card action icons (edit/delete) | ~32px | Yes — add padding to reach 44px |
| Modal close buttons | 30x30px | Yes — increase to 44x44px |
| Rating stars (personal rating) | ~24px per star | Yes — increase tap target with padding |
| Toast dismiss button | ~28px | Yes — increase to 44x44px |
| Colour filter chips | Variable | Verify min 44px height |
| Zoom +/- buttons | ~36px | Yes — increase to 44x44px |
| Dropdown/select elements | Variable | Verify min 44px height on mobile |
| Checkbox/radio inputs | ~20px native | Already styled to 44px in a11y block |

Use **real clickable sizes** (min-height + padding) rather than `::after` pseudo-element overlays, which are unreliable with overlapping elements, overflow clipping, and difficult to validate:

```css
/* Pattern: real clickable size via padding on the interactive element */
.wine-card-action,
.modal-close-btn,
.toast-dismiss,
.zoom-btn {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Icon stays visually compact; padding provides the tap area */
  padding: 10px;
  box-sizing: border-box;
}
```

Where 44px would break dense layouts (e.g., adjacent action icons on a wine card), use negative margin to visually tighten spacing while keeping the actual tap target at 44px:
```css
.wine-card-actions { display: flex; gap: 0; }
.wine-card-action { margin: 0 -4px; } /* Overlaps visually, tap areas don't conflict */
```

### 6.4 Safe area handling for PWA standalone
```css
@media (display-mode: standalone) {
  header { padding-top: max(0.75rem, env(safe-area-inset-top)); }
  .toast { bottom: max(2rem, calc(env(safe-area-inset-bottom) + 1rem)); }
}
```

> **Implementation notes (2026-02-06):**
> - **6.1 & 6.2**: Consolidated media query breakpoints from 6 to 4 standard breakpoints:
>   - Removed 500px breakpoint (1 occurrence in layout.css) → merged into 480px
>   - Removed 600px breakpoint (7 occurrences: 1 in layout.css, 6 in components.css) → merged into 480px
>   - Removed 900px breakpoint (1 occurrence in components.css) → merged into 768px
>   - Final breakpoints: default (desktop), 768px (tablet), 480px (mobile), 360px (small mobile)
>   - Total rules consolidated: 9 breakpoint blocks merged into 3 target breakpoints
> - **6.3**: Fixed touch targets to meet 44px product standard:
>   - `.btn-icon`: Changed from fixed 32x32px to min 44x44px with flex centering
>   - `.btn-small`: Increased min-height from 36px to 44px (WCAG AA baseline is 24px, product standard is 44px)
>   - Added mobile-specific overrides in accessibility.css for `.btn-icon` and `.zoom-controls .btn`
>   - Added `-webkit-tap-highlight-color: transparent` and `touch-action: manipulation` to `.btn-icon` for better mobile UX
> - **6.4**: Enhanced PWA safe area handling in standalone mode:
>   - Added `header { padding-top: max(0.75rem, env(safe-area-inset-top)); }` for notch/Dynamic Island avoidance
>   - Added `.toast { bottom: max(2rem, calc(env(safe-area-inset-bottom) + 1rem)); }` for home indicator clearance
>   - Existing body safe-area padding retained for comprehensive edge-to-edge support
> - Cache bumped: `sw.js` `CACHE_VERSION` v87 → v88, CSS version strings 20260205i → 20260206i
> - All 942 unit tests pass. Zero regressions.
>
> **Acceptance gate (Phase 6):**
> Touch target audit at iPhone SE (375px) in DevTools mobile emulation required. All interactive controls should meet 24px minimum (AA baseline) with 44px product standard where feasible. Manual tap testing recommended: zoom buttons, icon buttons, tabs, form elements.

---

## Phase 7: Navigation & Micro-interactions

### 7.1 Focus ring improvement
Current focus-visible uses old accent color. Update to double-ring pattern:
```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.25);
}
```

### 7.2 Skeleton loading states
Replace plain "Loading..." text with shimmer placeholders:
```css
.skeleton {
  background: linear-gradient(90deg, var(--bg-slot) 25%, var(--bg-slot-hover) 50%, var(--bg-slot) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 4px;
}

/* Respect prefers-reduced-motion — show static placeholder instead of shimmer */
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
    background: var(--bg-slot);
  }
}
```
Also audit all existing animations/transitions added in this plan and ensure they respect `prefers-reduced-motion`. The existing reduced-motion block (styles.css lines 5539-5548, 6964-6980) already handles current animations — new animations must be added there too.

### 7.3 Toast stacking + screen reader announcements
Wrap toast in a visual container with `flex-direction: column-reverse` so multiple toasts stack properly instead of overlapping. JS change in `utils.js`.

**Screen reader announcements — centralize, don't duplicate**: `accessibility.js` (lines 23-45) already has an announcer using an `aria-live` region. Adding a second `aria-live` on the toast container would cause duplicate announcements. Instead:

1. The toast **container** is visual-only (no `aria-live`, no `role`):
```html
<div id="toast-container"
     style="position:fixed; bottom:2rem; right:1.5rem; display:flex; flex-direction:column-reverse; gap:0.5rem; z-index:10000;">
</div>
```

2. When a toast is shown, route the announcement through the **existing** announcer in `accessibility.js`:
```javascript
// In utils.js showToast():
import { announce } from './accessibility.js';

function showToast(message, type = 'info') {
  // Visual toast (container, animation, auto-dismiss)
  renderToastElement(message, type);

  // Screen reader announcement via centralized announcer
  const priority = (type === 'error') ? 'assertive' : 'polite';
  announce(message, priority);
}
```

This avoids duplication and keeps all aria-live management in one place.

---

## Phase 8: Cellar Analysis — Quick Fixes (Theme, Text, Messages, Loading)

> **Context**: Mobile testing revealed 7 UX issues in the cellar analysis flow. Phases 8–11 address these as a review-hardened overhaul. This phase covers low-risk CSS/JS fixes.

### 8.1 Theme detection hardening
**Problem**: App stays dark on mobile even when device is in light mode. User never set a theme. CSS relies on `@media (prefers-color-scheme: light)` which may not fire reliably in Android PWA standalone WebViews.

**Root cause**: `theme-init.js` only sets `data-theme` when localStorage has an explicit value. On fresh install, no attribute is set — the app depends entirely on CSS media queries, which can fail in PWA standalone mode.

**Fix** in `public/js/theme-init.js`:
```javascript
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', savedTheme);
} else {
  // No saved preference — detect OS and set explicitly
  // This makes theme work independently of CSS media query support
  const prefersDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
}
```

**Fix** in `public/js/settings.js` — `applyThemePreference()`:
- When theme is `'system'`, detect OS preference and set explicit `data-theme` (instead of removing the attribute)
- Update the OS change listener to re-apply `data-theme` when system theme changes in real time:
```javascript
function applyThemePreference(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    // 'system' — detect and set explicitly for WebView compatibility
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
  updateThemeMeta();
}
```
- In the `systemThemeQuery.addEventListener('change', ...)` handler, call `applyThemePreference('system')` (not just `updateThemeMeta()`) so `data-theme` updates when OS switches.

**Manifest splash**: `manifest.json` `background_color: "#1a1a1a"` can't be changed dynamically. Add a `<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FAF6F1">` and `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#722F37">` pair in `index.html` to cover browser chrome color during load.

**Files**: `public/js/theme-init.js`, `public/js/settings.js`, `public/index.html` (meta tags)

### 8.2 Fix misleading "zones not configured" message
**Problem**: `moves.js` line 27 says "Click **Get AI Advice**" — but that only shows text advice, doesn't configure zones.

**Fix** in `public/js/cellarAnalysis/moves.js`:
```html
<p>Zone allocations haven't been configured yet.</p>
<p>Tap <strong>"Setup Zones"</strong> above to have AI propose a zone layout and guide you through organising your bottles.</p>
```

**Files**: `public/js/cellarAnalysis/moves.js`

### 8.3 AI advice loading: inline spinner, no forced scroll
**Problem**: `#analysis-ai-advice` is at page bottom — user can't see loading indicator. `scrollIntoView` on loading state is disorienting on mobile — breaks reading continuity.

**Fix** in `public/js/cellarAnalysis/aiAdvice.js`:
- Show inline spinner on the "Get AI Advice" button itself (disable + "Getting advice..." text)
- Show a non-jumping ARIA live status region (`role="status"`) near the button: "AI analysis in progress..."
- When response arrives, THEN populate `#analysis-ai-advice` and scroll it into view (content scroll, not loading scroll)
- Restore button state in `finally` block

```javascript
export async function handleGetAIAdvice() {
  const btn = document.getElementById('get-ai-advice-btn');
  const adviceEl = document.getElementById('analysis-ai-advice');
  const statusEl = document.getElementById('ai-advice-status'); // ARIA live region
  if (!adviceEl) return;

  // Inline button spinner — no page jump
  if (btn) { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = 'Getting advice…'; }
  if (statusEl) statusEl.textContent = 'AI analysis in progress (may take up to 2 minutes)...';

  try {
    const result = await analyseCellarAI();
    adviceEl.style.display = 'block';
    adviceEl.innerHTML = formatAIAdvice(result.aiAdvice);
    adviceEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); // scroll to RESULT, not loading
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    adviceEl.style.display = 'block';
    adviceEl.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
    if (statusEl) statusEl.textContent = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.originalText || 'Get AI Advice'; }
  }
}
```

**HTML addition** in `index.html` (near the analysis actions bar):
```html
<span id="ai-advice-status" class="analysis-status" role="status" aria-live="polite"></span>
```

**Files**: `public/js/cellarAnalysis/aiAdvice.js`, `public/index.html`

### 8.4 Fix text overflow at screen edge
**Problem**: Zone cards, reconfig modal, and AI advice text truncated on mobile.

**Fix** in `public/css/components.css`:
```css
.reconfig-action-title,
.reconfig-action-reason,
.reconfig-summary,
.zone-card,
.zone-card-purpose,
.zone-card-composition,
.zone-card-pairing,
.ai-advice-content,
.ai-advice-structured,
.zone-reconfig-banner-message,
.zone-reconfig-banner-list {
  overflow-wrap: break-word;
  word-break: break-word;
}
```

Add mobile override in `@media (max-width: 480px)`:
```css
.reconfig-modal-body { padding: 0.75rem; }
.reconfig-action { padding: 0.75rem; }
```

**Files**: `public/css/components.css`

### 8.5 Cache bump
**Files**: `public/sw.js`, `public/index.html`

---

## Phase 9: Cellar Analysis — Flow Simplification (State Machine, Single CTA)

### 9.1 Formal analysis state machine

**Problem**: "Systemic issues detected" is vague. CTA behavior must be deterministic and testable. Multiple competing buttons (Setup Zones, Reconfigure Zones, Refresh, AI Advice) confuse users.

**State model** (`public/js/cellarAnalysis/analysisState.js` — new module, ~40 lines):

| State | Condition | CTA Label | CTA Action |
|-------|-----------|-----------|------------|
| `NO_ZONES` | `needsZoneSetup === true` | "Setup Zones" | `startZoneSetup()` |
| `ZONES_DEGRADED` | `needsZoneSetup === false` AND (capacityAlerts >= 3 OR misplacementRate >= 10%) | "Reconfigure Zones" | `openReconfigurationModal()` |
| `ZONES_HEALTHY` | `needsZoneSetup === false` AND not degraded | "Optimize Cellar" | `openReconfigurationModal()` |
| `JUST_RECONFIGURED` | `analysis.__justReconfigured === true` | "Guide Me Through Moves" | `openMoveGuide()` (Phase 11) / scroll to moves (Phase 9) |

```javascript
// public/js/cellarAnalysis/analysisState.js
export const AnalysisState = { NO_ZONES: 'NO_ZONES', ZONES_DEGRADED: 'ZONES_DEGRADED', ZONES_HEALTHY: 'ZONES_HEALTHY', JUST_RECONFIGURED: 'JUST_RECONFIGURED' };

export function deriveState(analysis) {
  if (analysis?.__justReconfigured) return AnalysisState.JUST_RECONFIGURED;
  if (analysis?.needsZoneSetup) return AnalysisState.NO_ZONES;

  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue').length;
  const total = analysis?.summary?.totalBottles ?? 0;
  const misplaced = analysis?.summary?.misplacedBottles ?? 0;
  const misplacementRate = total > 0 ? misplaced / total : 0;

  if (capacityAlerts >= 3 || misplacementRate >= 0.10) return AnalysisState.ZONES_DEGRADED;
  return AnalysisState.ZONES_HEALTHY;
}
```

**Test table** (unit test in `tests/unit/cellarAnalysis/analysisState.test.js`):

| Input | Expected State |
|-------|---------------|
| `{ needsZoneSetup: true }` | `NO_ZONES` |
| `{ needsZoneSetup: false, alerts: [cap, cap, cap], summary: { totalBottles: 100, misplacedBottles: 5 } }` | `ZONES_DEGRADED` |
| `{ needsZoneSetup: false, summary: { totalBottles: 100, misplacedBottles: 15 } }` | `ZONES_DEGRADED` |
| `{ needsZoneSetup: false, alerts: [], summary: { totalBottles: 100, misplacedBottles: 2 } }` | `ZONES_HEALTHY` |
| `{ __justReconfigured: true }` | `JUST_RECONFIGURED` |

**Files**: New `public/js/cellarAnalysis/analysisState.js`, new `tests/unit/cellarAnalysis/analysisState.test.js`

### 9.2 Single primary CTA with correct hierarchy

**Problem**: Two `btn-primary` buttons ("Refresh Analysis" + "Configure Cellar") weakens Gestalt figure-ground focus.

**Fix** in `public/index.html`:
```html
<div class="analysis-view-header">
  <h2>Cellar Analysis</h2>
  <div class="analysis-actions">
    <!-- Single primary CTA — text/action driven by state machine -->
    <button class="btn btn-primary" id="cellar-action-btn">Setup Zones</button>
    <!-- Secondary actions -->
    <button class="btn btn-secondary" id="get-ai-advice-btn">AI Advice</button>
    <button class="btn btn-secondary btn-icon" id="refresh-analysis-btn" title="Refresh analysis">↻</button>
    <span id="ai-advice-status" class="analysis-status" role="status" aria-live="polite"></span>
    <span class="analysis-cache-status" id="analysis-cache-status"></span>
  </div>
</div>
```

- "Refresh Analysis" demoted to icon-only secondary button (↻) — utility, not primary flow action
- Single primary CTA: `#cellar-action-btn` — label and handler set by `updateActionButton(analysis)` using `deriveState()`
- "Get AI Advice" stays as labeled secondary button (informational, not flow-critical)
- Remove `#setup-zones-btn` and `#reconfigure-zones-btn` (replaced by `#cellar-action-btn`)

**Implementation** in `public/js/cellarAnalysis/analysis.js`:
```javascript
import { deriveState, AnalysisState } from './analysisState.js';
import { startZoneSetup } from './zones.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';

function updateActionButton(analysis, onRenderAnalysis) {
  const btn = document.getElementById('cellar-action-btn');
  if (!btn) return;

  const state = deriveState(analysis);
  const config = {
    [AnalysisState.NO_ZONES]:            { label: 'Setup Zones',            handler: () => startZoneSetup() },
    [AnalysisState.ZONES_DEGRADED]:      { label: 'Reconfigure Zones',      handler: () => openReconfigurationModal({ onRenderAnalysis }) },
    [AnalysisState.ZONES_HEALTHY]:       { label: 'Optimize Cellar',        handler: () => openReconfigurationModal({ onRenderAnalysis }) },
    [AnalysisState.JUST_RECONFIGURED]:   { label: 'Review Moves',           handler: () => document.getElementById('analysis-moves')?.scrollIntoView({ behavior: 'smooth' }) },
  };

  const { label, handler } = config[state];
  btn.textContent = label;

  // Replace handler (clone to remove old listener)
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', handler);
}
```

Call `updateActionButton(analysis, onRenderAnalysis)` at the end of `renderAnalysis()`.

**Files**: `public/index.html`, `public/js/cellarAnalysis/analysis.js`, `public/js/cellarAnalysis.js` (remove old button wiring for setup-zones-btn, reconfigure-zones-btn)

### 9.3 Post-reconfiguration feedback with scroll
**Problem**: After "Apply all changes", user doesn't see the result. Success banner + suggested moves are below the fold.

**Fix** in `public/js/cellarAnalysis/zoneReconfigurationModal.js` — `handleApply()`:
- After re-analysis + `onRenderAnalysis()`, scroll to `#analysis-alerts` (where the success banner renders)
```javascript
// After onRenderAnalysis(reportWithFlag):
document.getElementById('analysis-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
```

**Fix** in `public/js/cellarAnalysis/zoneReconfigurationBanner.js` — `renderPostReconfigBanner()`:
- Add prominent "Review Moves Below" button that scrolls to `#analysis-moves`
- In Phase 11, this button becomes "Guide Me Through Moves" → opens move guide
```html
<button class="btn btn-primary" data-action="scroll-to-moves">Review Moves Below</button>
```

**Files**: `public/js/cellarAnalysis/zoneReconfigurationModal.js`, `public/js/cellarAnalysis/zoneReconfigurationBanner.js`

### 9.4 "Zones not configured" alert with inline CTA
**Problem**: The warning says "Click 'Get AI Advice'" — wrong and confusing.

**Fix**: In the `#analysis-alerts` area (rendered when `needsZoneSetup === true`), show:
```html
<div class="alert-item warning">
  <span class="alert-icon">⚠️</span>
  <span>Cellar zones not configured.</span>
  <button class="btn btn-primary btn-small" id="alert-setup-zones-btn">Setup Zones</button>
</div>
```
Wire this button to `startZoneSetup()` in `analysis.js`.

**Files**: `public/js/cellarAnalysis/analysis.js`

### 9.5 Cache bump
**Files**: `public/sw.js`, `public/index.html`

---

## Phase 10: Cellar Analysis — Fridge Swap Suggestions

### 10.1 Transactional swap safety

**Verified**: The existing `POST /api/cellar/execute-moves` endpoint already supports atomic A→B + B→A swaps:
- `validateMovePlan()` in `src/services/movePlanner.js` (lines 399-490) tracks `vacatedSlots` — if move A vacates slot X, move B is allowed to target X
- `db.transaction()` in `src/db/postgres.js` uses explicit BEGIN/COMMIT/ROLLBACK
- 5-rule pre-validation catches duplicates, occupied targets, source mismatches

**Enhancement**: Add invariant count check in `execute-moves` handler as defense-in-depth:
```javascript
// Inside the transaction, after all moves:
const beforeCount = existingCounts; // captured before loop
const afterCount = await client.query('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL AND cellar_id = $1', [cellarId]);
if (Number(afterCount.rows[0].count) !== beforeCount) {
  throw new Error(`Invariant violation: bottle count changed from ${beforeCount} to ${afterCount.rows[0].count}`);
}
```

**Alternative**: For simple 2-way fridge swaps, can also use `POST /api/slots/direct-swap` (already exists in `src/routes/slots.js` lines 110-143) which takes `{ slot_a, slot_b }` and handles atomically.

**Files**: `src/routes/cellarReconfiguration.js` (invariant check addition)

### 10.2 User-goal fridge language

**Problem**: Replacement heuristic uses technical terms. Wine users think in "what to chill for tonight/this weekend."

**Fix** in `public/js/cellarAnalysis/fridge.js` — candidate rendering:
- Swap reason uses user-goal language: "Perfect for tonight's dinner", "Ready for the weekend", "Fills your crisp white gap"
- Explain WHY this swap: "This [Sauvignon Blanc] replaces [Chardonnay 2020] which has been chilling for 3 weeks and is best enjoyed from cellar"

**Candidate rendering when fridge is full:**
```html
<div class="fridge-candidate">
  <div class="fridge-candidate-info">
    <div class="fridge-candidate-name">Sauvignon Blanc 2023</div>
    <div class="fridge-candidate-reason">Ready to drink — fills your crisp white gap</div>
    <div class="fridge-swap-detail">
      Swap with <strong>Chardonnay 2020</strong> (F3) — move back to R5C2
      <span class="fridge-swap-why">In fridge 3 weeks, better stored in cellar now</span>
    </div>
  </div>
  <button class="btn btn-secondary btn-small fridge-swap-btn" data-candidate-index="0">Swap</button>
</div>
```

**When fridge has empty slots** (existing flow, enhanced):
```html
<div class="fridge-candidate">
  <div class="fridge-candidate-info">
    <div class="fridge-candidate-name">Riesling 2022</div>
    <div class="fridge-candidate-reason">Ready to drink — fills your aromatic gap</div>
    <div class="fridge-target-slot">Add to F7</div>
  </div>
  <button class="btn btn-secondary btn-small fridge-add-btn" data-candidate-index="1">Add to F7</button>
</div>
```

### 10.3 Swap execution logic

In `public/js/cellarAnalysis/fridge.js`:

```javascript
async function swapFridgeCandidate(candidateIndex) {
  const analysis = getCurrentAnalysis();
  const candidate = analysis?.fridgeStatus?.candidates?.[candidateIndex];
  if (!candidate) return;

  // Identify lowest-priority fridge wine to swap out
  const swapOut = identifySwapTarget(analysis.fridgeStatus, candidate);
  if (!swapOut) { showToast('No suitable swap found'); return; }

  try {
    await executeCellarMoves([
      { wineId: swapOut.wineId, from: swapOut.slot, to: candidate.fromSlot },
      { wineId: candidate.wineId, from: candidate.fromSlot, to: swapOut.slot }
    ]);
    showToast(`Swapped: ${candidate.wineName} → ${swapOut.slot}, ${swapOut.wineName} → ${candidate.fromSlot}`);
    await loadAnalysis();
    refreshLayout();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function identifySwapTarget(fridgeStatus, candidate) {
  // Priority: wine that doesn't match any par-level gap category > longest in fridge > lowest urgency
  const fridgeWines = fridgeStatus.wines || [];
  if (fridgeWines.length === 0) return null;

  return fridgeWines
    .filter(w => w.wineId !== candidate.wineId) // don't swap with self
    .sort((a, b) => {
      // 1. Prefer swapping out wines that DON'T match any gap category
      const aMatchesGap = fridgeStatus.parLevelGaps?.[a.category] ? 0 : 1;
      const bMatchesGap = fridgeStatus.parLevelGaps?.[b.category] ? 0 : 1;
      if (aMatchesGap !== bMatchesGap) return bMatchesGap - aMatchesGap;
      // 2. Longest time in fridge (if available)
      // 3. Lowest drinking urgency
      return (a.urgencyScore ?? 99) - (b.urgencyScore ?? 99);
    })[0] || null;
}
```

**Backend data check**: Verify `fridgeStatus.wines` includes `wineId`, `wineName`, `slot`, `category`, and ideally `urgencyScore`. If not, enhance `src/services/cellarAnalysis.js` fridge analysis to include these fields.

**Files**: `public/js/cellarAnalysis/fridge.js`, possibly `src/services/cellarAnalysis.js` (fridge wine enrichment)

### 10.4 Cache bump
**Files**: `public/sw.js`, `public/index.html`

---

## Phase 11: Cellar Analysis — Visual Grid Move Guide

### 11.1 Grid reuse — NO FORK

**Confirmed**: Grid.js uses DOM-based slot elements with `data-location` attributes. The `dragdrop.js` module already annotates slots post-render by querying `document.querySelectorAll('.slot')` and adding CSS classes (`drag-target`, `drag-over`, `drag-over-swap`). The move guide will use the same pattern.

**Approach**: Post-render DOM annotation (same pattern as `dragdrop.js`):
1. Call existing `renderCellar()` / `renderStorageAreas()` to render the grid normally
2. Query slots by `[data-location="R1C1"]` and add annotation classes
3. CSS handles all visual differentiation

**NO new renderer. NO grid fork.**

### 11.2 Move Guide Component (`public/js/cellarAnalysis/moveGuide.js`)

**Features:**
1. **Overlay panel** that sits above the main cellar grid view (not a separate grid copy)
   - Instruction bar: "Step 1 of 12: Move Kanonkop Pinotage 2019"
   - Source/target display: "From R5C3 → To R8C1 (Bordeaux & Blends zone)"
   - Progress bar
   - Action buttons: "Execute Move", "Recalculate" (not Skip — see 11.3)
   - The cellar grid below is annotated with move highlighting

2. **Grid annotation** (post-render, DRY):
```javascript
function annotateGrid(moves, currentIndex) {
  // Clear previous annotations
  document.querySelectorAll('.slot').forEach(s => {
    s.classList.remove('move-source', 'move-target', 'move-active-source', 'move-active-target', 'move-completed', 'move-pending');
  });

  moves.forEach((move, idx) => {
    const source = document.querySelector(`[data-location="${move.from}"]`);
    const target = document.querySelector(`[data-location="${move.to}"]`);

    if (idx < currentIndex) {
      source?.classList.add('move-completed');
      target?.classList.add('move-completed');
    } else if (idx === currentIndex) {
      source?.classList.add('move-active-source');
      target?.classList.add('move-active-target');
    } else {
      source?.classList.add('move-pending', 'move-source');
      target?.classList.add('move-pending', 'move-target');
    }
  });
}
```

3. **Zone grouping**: Moves sorted by target zone for logical batching

### 11.3 Dependency-safe "Recalculate" (not Skip)

**Problem**: Naive "Skip" can invalidate later moves. If move 3 targets R8C1 and move 5 depends on R8C1 being vacated by move 3, skipping move 3 breaks move 5.

**Solution**: Replace "Skip" with "Recalculate from here":
- When user doesn't want to do the current move, call `analyseCellar(true)` to get a fresh analysis
- Filter out already-completed moves (by checking which source slots no longer contain the expected wine)
- Re-render the move guide with the fresh move list
- The backend recalculates optimal moves based on current state

```javascript
async function handleRecalculate(completedMoves) {
  const statusEl = document.getElementById('move-guide-status');
  if (statusEl) statusEl.textContent = 'Recalculating moves...';

  // Get fresh analysis — backend generates new moves based on current slot state
  const response = await analyseCellar(true);
  const freshMoves = response.report.suggestedMoves?.filter(m => m.type === 'move') || [];

  // Filter out moves already completed in this session
  const completedFromTo = new Set(completedMoves.map(m => `${m.from}→${m.to}`));
  const remainingMoves = freshMoves.filter(m => !completedFromTo.has(`${m.from}→${m.to}`));

  // Reset guide with new moves, starting from index 0
  resetMoveGuide(remainingMoves);
}
```

This is safe because:
- Backend always calculates moves against current slot state (not stale data)
- Already-completed moves won't appear (wines have moved)
- Dependencies are recalculated based on actual slot occupancy

### 11.4 CSS for move annotations

In `public/css/components.css`:
```css
/* Move guide annotations — same pattern as dragdrop highlighting */
.slot.move-active-source {
  border: 2px solid var(--color-warning) !important;
  background: var(--color-warning-bg) !important;
  animation: move-pulse 1.5s ease-in-out infinite;
}
.slot.move-active-target {
  border: 2px solid var(--color-success) !important;
  background: var(--color-success-bg) !important;
  animation: move-pulse 1.5s ease-in-out infinite;
}
.slot.move-source, .slot.move-target { opacity: 0.7; }
.slot.move-completed { opacity: 0.4; }
.slot.move-pending { /* default styling, dimmed */ }

@keyframes move-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--color-success-rgb), 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(var(--color-success-rgb), 0); }
}

/* Respect reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .slot.move-active-source, .slot.move-active-target { animation: none; }
}
```

### 11.5 HTML container

In `public/index.html` (inside `#view-analysis`, above `#analysis-moves`):
```html
<div class="move-guide-panel" id="move-guide-panel" style="display: none;">
  <div class="move-guide-header">
    <h3>Move Guide</h3>
    <div class="move-guide-progress" id="move-guide-progress"></div>
    <button class="btn-icon" id="move-guide-close" title="Close guide">✕</button>
  </div>
  <div class="move-guide-instruction" id="move-guide-instruction"></div>
  <span id="move-guide-status" role="status" aria-live="polite"></span>
  <div class="move-guide-actions">
    <button class="btn btn-primary" id="move-guide-execute">Execute Move</button>
    <button class="btn btn-secondary" id="move-guide-recalculate">Recalculate</button>
  </div>
</div>
```

This is a panel ABOVE the existing cellar grid, not a separate grid. The cellar grid itself gets annotated via CSS classes (11.2).

### 11.6 Entry points

- Post-reconfig banner → "Guide Me Through Moves" button → `openMoveGuide(moves)`
- Suggested Moves section → "Visual Guide" button → `openMoveGuide(moves)`
- State machine `JUST_RECONFIGURED` → primary CTA "Guide Me Through Moves" → `openMoveGuide(moves)`

### 11.7 Integration with existing grid

After each executed move:
1. Call `executeCellarMoves([currentMove])` (existing API)
2. Call `refreshLayout()` (existing function — re-renders grid from API data)
3. Re-annotate grid with `annotateGrid(moves, newIndex)` (post-render annotation)

The grid re-renders naturally (fresh data from API), then annotations are re-applied. No manual DOM surgery needed.

**Files**: New `public/js/cellarAnalysis/moveGuide.js`, `public/index.html`, `public/css/components.css`, `public/js/cellarAnalysis/zoneReconfigurationBanner.js`, `public/js/cellarAnalysis/moves.js`

### Cellar Analysis — Critical Files Summary

| File | Phases | Changes |
|------|--------|---------|
| `public/js/theme-init.js` | 8 | Always set `data-theme` explicitly |
| `public/js/settings.js` | 8 | `applyThemePreference('system')` sets explicit attribute |
| `public/index.html` | 8,9,11 | Meta tags, button hierarchy, move guide panel, ARIA live region |
| `public/js/cellarAnalysis/moves.js` | 8,11 | Fix message, add "Visual Guide" button |
| `public/js/cellarAnalysis/aiAdvice.js` | 8 | Inline spinner, no forced scroll |
| `public/css/components.css` | 8,11 | Overflow fix, move guide CSS |
| `public/js/cellarAnalysis/analysisState.js` | 9 | **NEW** — state machine module |
| `public/js/cellarAnalysis/analysis.js` | 9 | `updateActionButton()` using state machine |
| `public/js/cellarAnalysis.js` | 9 | Remove old button wiring |
| `public/js/cellarAnalysis/zoneReconfigurationModal.js` | 9 | Post-apply scroll |
| `public/js/cellarAnalysis/zoneReconfigurationBanner.js` | 9,11 | "Review Moves" / "Guide Me" button |
| `public/js/cellarAnalysis/fridge.js` | 10 | Swap logic, user-goal language, slot display |
| `src/routes/cellarReconfiguration.js` | 10 | Invariant count check |
| `public/js/cellarAnalysis/moveGuide.js` | 11 | **NEW** — move guide module |
| `public/sw.js` | 8,9,10,11 | Cache version bumps |

### Cellar Analysis — Existing Code to Reuse

| What | Where | How |
|------|-------|-----|
| Grid slot annotation pattern | `public/js/dragdrop.js` | Query `[data-location]`, add CSS classes |
| Atomic swap support | `POST /api/cellar/execute-moves` | Send 2-move batch, `vacatedSlots` tracking handles A↔B |
| Direct swap endpoint | `POST /api/slots/direct-swap` | Alternative for simple 2-way fridge swaps |
| Transaction wrapper | `src/db/postgres.js` `transaction()` | BEGIN/COMMIT/ROLLBACK with auto-release |
| Move validation | `src/services/movePlanner.js` `validateMovePlan()` | 5-rule pre-execution validation |
| `refreshLayout()` | `public/js/app.js` | Re-renders grid from API after move execution |
| `escapeHtml()` / `showToast()` | `public/js/utils.js` | Safe HTML rendering, user feedback |

---

## Execution Order

| Order | Phase | Description | Risk | Status |
|-------|-------|-------------|------|--------|
| 0a | Gate | Review pre-implementation accessibility checklist | None | Pending |
| 0b | Phase 0 | CSS split + hex-to-token audit | Low — mechanical, no visual changes | **DONE** |
| 1 | Phase 1 | Contrast & readability fixes (11px floor + collision check) | Low — CSS only | **DONE** |
| 2 | Phase 2 | Color system + non-color status cues | Low — CSS + pseudo-elements | **DONE** |
| 3 | Phase 5 | Typography scale (11px minimum) | Low — CSS only | **DONE** |
| 4 | Phase 4 | Gestalt layout + non-color cue integration | Low — HTML+CSS | **DONE** |
| 5 | Phase 3 | Light mode + FOUC fix + theme parity + SVG audit | Medium — needs extended QA | **DONE** |
| 6 | Phase 6 | Mobile + touch targets (24px AA floor, 44px product std) | Medium — layout changes | **DONE** |
| 7 | Phase 7 | Navigation + motion accessibility + toast aria-live | Medium — JS changes | **DONE** |
| 8 | Phase 8 | Cellar Analysis: theme hardening, text overflow, messages, loading UX | Low — CSS + JS fixes | **DONE** |
| 9 | Phase 9 | Cellar Analysis: state machine, single CTA, post-reconfig flow | Medium — JS + HTML restructure | **DONE** |
| 10 | Phase 10 | Cellar Analysis: fridge swap-out suggestions | Medium — JS + backend enhancement | **DONE** |
| 11 | Phase 11 | Cellar Analysis: visual grid move guide | High — new module, grid annotation | Pending |

**Rationale**:
- Phase 0 first: splitting the CSS de-risks every subsequent phase by isolating changes to their own file
- Phase 5 before Phase 4: type scale variables are used in layout fixes
- Phase 3 after Phase 4: inline style cleanup should be done before duplicating for a second theme
- Extended QA matrix runs after Phases 3, 6, and 7 (keyboard, screen reader, forced-colors, color-blind, reduced-motion)
- Phase 8 before 9: quick fixes (theme, text overflow) must land before flow restructuring
- Phases 8–11 are independent of Phase 7 and can proceed in parallel or after it

---

## Pre-Implementation Checklist: Accessibility & Interaction Gate

Before starting Phase 1, confirm these requirements are understood and will be validated throughout:

### A. Keyboard & Focus Behavior
- [ ] All interactive elements reachable via Tab key
- [ ] Modal focus trap works (Tab cycles within modal, Escape closes)
- [ ] Focus returns to trigger element after modal close
- [ ] Focus ring visible in both dark and light themes
- [ ] Skip-to-content link works (already exists in `accessibility.js`)
- [ ] Arrow key navigation in grid slots (already exists)
- [ ] No keyboard traps (focus can always leave any component)

### B. Touch Targets (Mobile)
- [ ] All tappable controls >= 44x44px product standard (24x24px AA floor)
- [ ] Grid slot actions have adequate touch area even at small zoom
- [ ] Modal close button >= 44x44px
- [ ] Toast dismiss >= 44x44px
- [ ] Rating stars have adequate spacing/size for finger taps

### C. Non-Color Status Cues
- [ ] Priority levels have text labels ("NOW"/"SOON"/"HOLD"), not just color
- [ ] Zone health uses border patterns alongside color
- [ ] Medal display includes text or emoji, not just color swatch
- [ ] Success/error/warning states have icon + text, not just color
- [ ] Wine colour dots paired with text labels

### D. Motion Accessibility
- [ ] All new animations gated behind `prefers-reduced-motion`
- [ ] Skeleton shimmer has static fallback
- [ ] Hover elevation transitions respect reduced-motion
- [ ] Existing reduced-motion CSS block updated with new animations

### E. Theme Parity
- [ ] All 16 components in Phase 3.1b matrix validated in both themes
- [ ] WCAG AA contrast verified for both dark and light palettes
- [ ] Focus rings visible on both light and dark backgrounds
- [ ] Shadows/elevation appropriate for both themes

---

## Verification (Per Phase)

### Standard checks (every phase):
1. `npm run test:unit` — no JS regressions
2. Visual check all 6 views at 1200px, 768px, 480px, 360px
3. Chrome DevTools Lighthouse accessibility audit (target: 95+)

### Extended QA matrix (after Phases 3, 6, 7):
4. **Keyboard-only walkthrough**: Navigate all 6 views using only keyboard (Tab, Enter, Escape, Arrow keys). Verify focus order is logical and focus ring is always visible.
5. **Screen reader smoke test**: Test with NVDA (Windows) or VoiceOver (Mac) on:
   - Tab switching and view navigation
   - Wine card reading order
   - Modal open/close announcements
   - Toast notification announcements (aria-live region)
   - Grid slot identification
6. **Forced-colors / High Contrast mode**: Enable Windows High Contrast or `forced-colors: active` in DevTools. Verify:
   - All text readable
   - Interactive elements distinguishable
   - Focus indicators visible
   - Borders/outlines not lost
7. **Color-blind simulation**: Use Chrome DevTools > Rendering > Emulate vision deficiencies (protanopia, deuteranopia, tritanopia). Verify all status/priority states distinguishable by non-color cues.
8. **prefers-reduced-motion**: Enable in DevTools > Rendering. Verify no animations play, skeleton shows static background.
9. **Light mode**: Emulate `prefers-color-scheme: light` in DevTools. Walk through all 6 views. Validate Phase 3.1b parity matrix.
10. **Touch target audit**: Use Chrome DevTools mobile emulation (iPhone SE, 375px). Tap every interactive control. Verify no mis-taps from undersized targets.

### Phase 8 — Manual + Unit
- Clear localStorage, reload on mobile → app follows device theme (light/dark)
- Test text overflow: zone cards, reconfig modal, AI advice at 375px viewport
- Verify "zones not configured" message references "Setup Zones"
- AI advice button shows inline spinner, no page jump during loading
- `npm run test:unit` passes

### Phase 9 — Unit + State Machine Tests
- **New**: `tests/unit/cellarAnalysis/analysisState.test.js` — 5 state derivation tests (see 9.1 test table)
- Test single CTA: shows "Setup Zones" when no zones, "Reconfigure Zones" when degraded, "Optimize Cellar" when healthy
- Test post-reconfig: apply → success banner visible → "Review Moves" scrolls to moves
- Verify `#refresh-analysis-btn` is icon-only secondary, not competing for primary focus
- `npm run test:unit` passes (942+ existing + 5 new)

### Phase 10 — Unit + Integration
- **New**: `tests/unit/cellarAnalysis/fridgeSwap.test.js` — test `identifySwapTarget()` heuristic (gap category > time > urgency)
- **New**: `tests/integration/cellarSwap.test.js` — integration test:
  1. Set up fridge with 9 occupied slots
  2. POST execute-moves with A→B + B→A swap
  3. Verify both bottles moved correctly (no loss, no duplication)
  4. Verify invariant count check passes
- Test with full fridge (9/9): candidates show swap suggestions with user-goal language
- `npm run test:all` passes

### Phase 11 — Unit + Integration + Mobile E2E
- **New**: `tests/unit/cellarAnalysis/moveGuide.test.js` — test `annotateGrid()` applies correct classes, test `handleRecalculate()` filters completed moves
- **Integration**: Open move guide → execute 2 moves → recalculate → verify fresh moves returned → complete remaining
- **Mobile E2E (manual, 375px)**: Full flow: analysis tab → setup zones → reconfigure → guided moves → verify grid annotations visible and touch targets usable
- `npm run test:all` passes

### All Phases (8–11)
- `npm run test:unit` after each phase (regression gate)
- Cache bump: `sw.js` CACHE_VERSION + `index.html` version strings
- Manual mobile QA at 375px (iPhone SE emulation) for each phase

### Final:
11. Bump cache version in `index.html` and `sw.js`
12. Verify offline boot (disable network in DevTools > Application > Service Workers)

---

## Delivery Strategy: Gated PRs per Phase

Each phase ships as a separate commit (or PR if branching) with explicit acceptance checks before proceeding to the next:

| Phase | Acceptance gate | Status |
|-------|-----------------|--------|
| Phase 0 | Zero visual diff at 1200/768/480/360px (mechanical split only) + offline boot works | **DONE** (unit tests pass; visual diff + offline boot pending manual verification) |
| Phase 1 | Contrast report (DevTools computed contrast on --accent, --text-muted) + grid collision check screenshots | **DONE** (audit pass; grid collision check pending manual visual QA at 0.8x–1.5x zoom) |
| Phase 2 | `grep` returns 0 hardcoded hex in component CSS + color-blind sim screenshot | **DONE** (grep passes, 27/27 non-color cues verified; color-blind sim pending manual DevTools validation) |
| Phase 5 | `grep` confirms no font-size below 0.6875rem + visual check at all breakpoints | **DONE** (2 accepted exceptions: 0.5rem/0.45rem on priority badge ::after icon-labels) |
| Phase 4 | Keyboard walkthrough of settings page + screenshot of grouped sections | **DONE** (keyboard walkthrough + grouped screenshot pending manual QA) |
| Phase 3 | Theme parity matrix signed off (all 16 rows) + SVG audit complete + FOUC test (reload in light mode) | **CODE COMPLETE** (implementation + all review fixes done; parity matrix validation + SVG audit + color-blind simulation + offline boot test require manual QA) |
| Phase 6 | Touch target audit at iPhone SE (375px) + 24px floor verified + 44px product standard where feasible | **CODE COMPLETE** (breakpoint consolidation + touch target fixes + safe areas implemented; manual tap testing and mobile QA pending) |
| Phase 7 | Keyboard-only full walkthrough + screen reader smoke test + reduced-motion verification | **CODE COMPLETE** (double-ring focus, skeleton shimmer, toast stacking + announce(); manual keyboard/SR/reduced-motion QA pending) |
| Phase 8 | Clear localStorage + mobile reload → correct theme. Text overflow check at 375px. AI advice inline spinner. | **CODE COMPLETE** (explicit data-theme for WebView compat, word-break overflow fix, inline button spinner + ARIA status; manual mobile QA pending) |
| Phase 9 | State machine unit tests pass (9 cases). Single CTA label correct per state. Post-reconfig scrolls to banner. Inline Setup Zones CTA in alerts. | **CODE COMPLETE** (state machine + 9 unit tests, single primary CTA, post-reconfig scroll + Review Moves button, inline alert CTA; manual flow QA pending) |
| Phase 10 | `identifySwapTarget()` unit tests pass. Integration test: atomic fridge swap (no bottle loss). Full fridge shows swap suggestions. | **CODE COMPLETE** (invariant count check, candidates when full, swap UI with identifySwapTarget/swapFridgeCandidate, user-goal language; manual fridge swap QA pending) |
| Phase 11 | `annotateGrid()` unit tests pass. Move guide: execute 2 → recalculate → complete. Grid annotations visible at 375px. | Pending |

This prevents cascading regressions and provides clear rollback points if a phase introduces issues.
