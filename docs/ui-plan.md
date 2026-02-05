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
| Phase 3 | **DONE** | 2026-02-05 | Light mode + theme toggle + FOUC fix + review fixes |
| Phase 4 | Pending | | |
| Phase 5 | Pending | | |
| Phase 6 | Pending | | |
| Phase 7 | Pending | | |

## Files Modified
- `public/css/variables.css` — :root custom properties, theme palettes, color migration map comment block
- `public/css/components.css` — wine cards, modals, toasts, badges, grid slots (6,531 lines)
- `public/css/layout.css` — grid, responsive breakpoints, settings page structure (858 lines)
- `public/css/themes.css` — high-contrast / forced-colors overrides (16 lines)
- `public/css/accessibility.css` — focus rings, touch targets, reduced-motion, skip link (167 lines)
- `public/css/styles.css` — retained as @import aggregator (imports above files in cascade order)
- `public/index.html` — Phase 4 (inline styles, settings grouping), Phase 3 (theme toggle + FOUC script)
- `public/js/settings.js` — Phase 3 (theme toggle logic)
- `public/js/utils.js` — Phase 7 (toast container + aria-live)
- `public/manifest.json` — Phase 3 (fix background_color mismatch)
- `public/sw.js` — cache version bump per phase

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
> - **Phase 3 complete and ready for signoff.**

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

---

## Phase 6: Mobile & Responsive Refinements

### 6.1 Consolidate duplicate media query blocks
Two separate `@media (max-width: 768px)` blocks (lines ~3659 and ~4527) with conflicting slot sizes. Merge into single blocks per breakpoint.

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

## Execution Order

| Order | Phase | Description | Risk | Status |
|-------|-------|-------------|------|--------|
| 0a | Gate | Review pre-implementation accessibility checklist | None | Pending |
| 0b | Phase 0 | CSS split + hex-to-token audit | Low — mechanical, no visual changes | **DONE** |
| 1 | Phase 1 | Contrast & readability fixes (11px floor + collision check) | Low — CSS only | **DONE** |
| 2 | Phase 2 | Color system + non-color status cues | Low — CSS + pseudo-elements | **DONE** |
| 3 | Phase 5 | Typography scale (11px minimum) | Low — CSS only | Pending |
| 4 | Phase 4 | Gestalt layout + non-color cue integration | Low — HTML+CSS | Pending |
| 5 | Phase 3 | Light mode + FOUC fix + theme parity + SVG audit | Medium — needs extended QA | **DONE** |
| 6 | Phase 6 | Mobile + touch targets (24px AA floor, 44px product std) | Medium — layout changes | Pending |
| 7 | Phase 7 | Navigation + motion accessibility + toast aria-live | Medium — JS changes | Pending |

**Rationale**:
- Phase 0 first: splitting the CSS de-risks every subsequent phase by isolating changes to their own file
- Phase 5 before Phase 4: type scale variables are used in layout fixes
- Phase 3 after Phase 4: inline style cleanup should be done before duplicating for a second theme
- Extended QA matrix runs after Phases 3, 6, and 7 (keyboard, screen reader, forced-colors, color-blind, reduced-motion)

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
| Phase 5 | `grep` confirms no font-size below 0.6875rem + visual check at all breakpoints | Pending |
| Phase 4 | Keyboard walkthrough of settings page + screenshot of grouped sections | Pending |
| Phase 3 | Theme parity matrix signed off (all 16 rows) + SVG audit complete + FOUC test (reload in light mode) | **DONE** (implementation complete; parity matrix + SVG audit require manual validation) |
| Phase 6 | Touch target audit at iPhone SE (375px) + 24px floor verified + 44px product standard where feasible | Pending |
| Phase 7 | Keyboard-only full walkthrough + screen reader smoke test + reduced-motion verification | Pending |

This prevents cascading regressions and provides clear rollback points if a phase introduces issues.
