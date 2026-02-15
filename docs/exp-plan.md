# Cellar Analysis UX Redesign — Actionable AI Recommendations

**Date**: 15 February 2026
**Priority**: High
**Status**: PLANNED (pending implementation)

---

## Context

The Cellar Analysis page has two main actions: **Expert Review** (AI assessment of zone strategy/style groupings) and **Reorganise Cellar** (zone reconfiguration + physical move plan). Three UX problems:

1. **Wrong sequence**: The physical reorganisation button appears before the strategic assessment button — logic says assess first, then act.
2. **Dead-end Expert Review**: Claude returns actionable data (`confirmedMoves`, `modifiedMoves`, `zoneAdjustments`, `ambiguousWines`, `fridgePlan`) but the UI renders only narrative text with NO action buttons. The move data is silently discarded.
3. **Duplicate labelling**: Both the primary CTA and the zone reconfig banner say "Reorganise Cellar", creating confusion.

**Goal**: Reorder buttons for logical flow, rename for clarity, make AI Recommendations actionable by rendering all AI data with action buttons, and add a direct path from results into zone reconfiguration.

**Scope**: Frontend-only changes. No backend modifications needed — the AI response schema already contains all the actionable data.

---

## Review Findings — Disposition (Round 1)

| # | Severity | Finding | Verdict | Resolution |
|---|----------|---------|---------|------------|
| R1-1 | HIGH | State desync: AI move execution doesn't update Suggested Moves | **IMPLEMENT** | After AI move, mutate `currentAnalysis.suggestedMoves` + re-render via `renderMoves()` (mirrors `moves.js:280-302`) |
| R1-2 | HIGH | XSS: not all AI text escaped | **IMPLEMENT** | Every AI-provided string goes through `escapeHtml()` — summary, narrative, reasons, zone names, wine names, error messages, legacy string mode |
| R1-3 | HIGH | Ambiguous wine buttons are non-committal | **IMPLEMENT** | Use existing `reassignWineZone(wineId, newZoneId, reason)` API (`api/cellar.js:298`) to persist zone choice |
| R1-4 | MEDIUM | SRP regression: aiAdvice.js 105→350 lines | **SUPERSEDED by R2-4** | File split implemented per round 2 review |
| R1-5 | MEDIUM | DRY: labels spread across 5 files | **SUPERSEDED by R2-3** | Labels.js created per round 2 review |
| R1-6 | MEDIUM | Cache-busting: SW STATIC_ASSETS has versioned CSS URLs | **IMPLEMENT** | Update `components.css` version in sw.js STATIC_ASSETS array |
| R1-7 | MEDIUM | NO_ZONES flow weakened by prominent AI section | **IMPLEMENT** | When `needsZoneSetup=true`, skip rendering move cards, ambiguous wines, and "Reconfigure Zones" CTA |
| R1-8 | LOW | Terminology: "AI review in progress" inconsistent | **SUPERSEDED by R2-12** | Unified to "Recommendations" wording |
| R1-9 | — | Testing gaps | **IMPLEMENT** | Unit tests for `formatAIAdvice()` + `enrichMovesWithNames()` + label consistency grep |

## Review Findings — Disposition (Round 2)

| # | Severity | Finding | Verdict | Resolution |
|---|----------|---------|---------|------------|
| R2-1 | HIGH | Schema mismatch: confirmedMoves lacks wineName, rejectedMoves lacks from/to | **IMPLEMENT** | `enrichMovesWithNames()` called on all 3 move arrays before rendering; handles rejectedMoves shape (no from/to) — see §4e |
| R2-2 | MED-HIGH | State sync fragile for modified moves (AI may change `to` field) | **IMPLEMENT** | Match on `wineId + from` only (intentional — the original `to` in suggestedMoves is stale after AI modification). Document in code comment — see §5g |
| R2-3 | MEDIUM | DRY dismissal wrong — add labels.js | **IMPLEMENT** | Create `labels.js` (~10 lines) exporting 4 CTA constants. Import everywhere. Zero-coupling leaf module — see §3 |
| R2-4 | MEDIUM | aiAdvice.js needs split (moves.js is 706 lines, not 384) | **IMPLEMENT** | Split into `aiAdvice.js` (view: API call, spinner, rendering ~200 lines) and `aiAdviceActions.js` (controller: event wiring, execution, state sync ~150 lines) — see §4 and §5 |
| R2-5 | MEDIUM | Callback threading via module state is fragile | **IMPLEMENT** | Replace `setOnRenderAnalysis` setter with `getOnRenderAnalysis()` getter exported from `analysis.js`. Controller imports getter at action time. No stale state — see §2b and §5f |
| R2-6 | MEDIUM | Move cards in two disconnected sections (Gestalt proximity) | **IMPLEMENT** | After AI move execution updates Suggested Moves, flash-highlight the Suggested Moves heading + auto-scroll to it. Visual sync cue bridges the spatial gap — see §5e |
| R2-7 | LOW-MED | XSS on error path: `err.message` not escaped | **IMPLEMENT** | Add `escapeHtml(err.message)` in catch block — see §4d |
| R2-8 | LOW-MED | Hardcoded CSS classes scattered in JS | **IMPLEMENT** | Define `SECTION_CONFIG` map + single `renderMoveSection()` function — see §4f |
| R2-9 | LOW-MED | Missing try/catch on reassignWineZone | **IMPLEMENT** | Add try/catch matching `zoneChat.js:164-187` pattern — see §5h |
| R2-10 | LOW | Stale cache version reference in plan | **IMPLEMENT** | Verified: sw.js has `components.css?v=20260214a` (not 20260215d). index.html links `styles.css?v=20260215d` (no components.css link). Plan updated to actual values — see §1c and §7 |
| R2-11 | LOW | Test file in wrong directory | **IMPLEMENT** | Changed to `tests/unit/cellarAnalysis/aiAdvice.test.js` (matches existing `analysisState.test.js`, `moveGuide.test.js`, `fridgeSwap.test.js`) — see §10 |
| R2-12 | MINOR | "Assessment" doesn't signal actionability | **IMPLEMENT** | Changed to "AI Recommendations" throughout. Signals suggested actions, not passive evaluation — see all sections |
| R2-13 | MINOR | No progressive disclosure for 9 sections | **IMPLEMENT** | Use native `<details>` elements with counts in `<summary>`. Actionable sections default open, informational sections default closed — see §4f |

---

## Existing Code Reference — Key Files to Understand Before Coding

These files contain patterns and APIs the implementation depends on. Read them before starting.

### Backend (NO changes needed — read for schema understanding)

| File | Why Read It |
|------|-------------|
| `src/services/cellar/cellarAI.js:188-203` | AI prompt OUTPUT_FORMAT — defines the exact schema for `confirmedMoves`, `modifiedMoves`, `rejectedMoves`, `ambiguousWines` |
| `src/services/cellar/cellarAI.js:231-248` | `validateAdviceSchema()` — what the backend validates before sending to frontend |

**AI Response Schema** (from `cellarAI.js:188-203`):
```json
{
  "confirmedMoves": [{ "wineId": "number", "from": "slot", "to": "slot" }],
  "modifiedMoves": [{ "wineId": "number", "from": "slot", "to": "slot", "reason": "string" }],
  "rejectedMoves": [{ "wineId": "number", "reason": "string" }],
  "ambiguousWines": [{ "wineId": "number", "name": "string", "options": ["zone1", "zone2"], "recommendation": "string" }],
  "zoneAdjustments": [{ "zoneId": "string", "suggestion": "string" }],
  "zoneHealth": [{ "zone": "string", "status": "string", "recommendation": "string" }],
  "fridgePlan": { "toAdd": [{ "wineId": "number", "reason": "string", "category": "string" }], "toRemove": [...], "coverageAfter": {...} },
  "layoutNarrative": "string",
  "summary": "string"
}
```

**CRITICAL schema notes:**
- `confirmedMoves` has NO `wineName` field — only `wineId`, `from`, `to`
- `modifiedMoves` has NO `wineName` field — only `wineId`, `from`, `to`, `reason`
- `rejectedMoves` has NO `wineName`, NO `from`, NO `to` — only `wineId`, `reason`
- `ambiguousWines` HAS `name` field (not `wineName`)
- All 4 arrays need name enrichment before rendering (see §4e)

### Frontend (patterns to follow)

| File | Lines | Why Read It |
|------|-------|-------------|
| `public/js/cellarAnalysis/moves.js` | 280-302 | **State sync pattern**: After move execution, splice from `currentAnalysis.suggestedMoves`, recalculate swap flags, call `renderMoves()`, call `refreshLayout()` |
| `public/js/cellarAnalysis/moves.js` | 19 | `renderMoves` export signature: `renderMoves(moves, needsZoneSetup, hasSwaps = false)` |
| `public/js/cellarAnalysis/zoneChat.js` | 164-187 | **Error handling pattern**: try/catch with `showToast()` for `reassignWineZone()` calls |
| `public/js/cellarAnalysis/analysis.js` | 176-205 | **State machine**: `updateActionButton()` — maps `AnalysisState` enum to CTA button text/handler |
| `public/js/cellarAnalysis/state.js` | — | `getCurrentAnalysis()` returns `{ suggestedMoves, misplacedWines, needsZoneSetup, movesHaveSwaps, ... }` |
| `public/js/cellarAnalysis/aiAdvice.js` | 1-105 | **Current file** (to be rewritten) — understand existing structure |
| `public/js/cellarAnalysis.js` | 58-59 | **Button wiring**: `getAIAdviceBtn.addEventListener('click', handleGetAIAdvice)` — NO parameters passed |
| `public/js/utils.js` | 95-103 | `escapeHtml(str)` — returns empty string for null/undefined, escapes `& < > " '` |
| `public/js/api.js` | — | `analyseCellarAI()`, `executeCellarMoves()`, `reassignWineZone()` — all use authenticated `apiFetch` |
| `public/css/components.css` | 1042-1128 | Existing AI advice CSS classes: `.analysis-ai-advice`, `.ai-advice-structured`, `.ai-summary`, etc. |
| `public/sw.js` | 6, 20-35 | `CACHE_VERSION` and `STATIC_ASSETS` array — both need updating |

### Dependency Graph (verify no circular imports)

```
cellarAnalysis.js (init)
  ├── analysis.js          ← exports getOnRenderAnalysis()
  │     └── labels.js      ← leaf module (no imports)
  ├── aiAdvice.js (view)
  │     ├── labels.js
  │     ├── state.js
  │     └── aiAdviceActions.js (controller)
  │           ├── analysis.js   ← pulls getOnRenderAnalysis() at action time
  │           ├── state.js
  │           ├── moves.js      ← imports renderMoves()
  │           ├── zoneReconfigurationModal.js
  │           └── app.js        ← imports refreshLayout()
  ├── moves.js
  ├── zoneReconfigurationBanner.js
  │     └── labels.js
  └── zoneReconfigurationModal.js
```

No circular dependencies. `aiAdviceActions.js` → `analysis.js` is one-directional.

---

## Files to Modify (9 files + 2 new files)

### §1. `public/index.html` — Button order, label, and section position

**§1a. Swap button order + rename** (lines 158-163):

Current HTML:
```html
<div class="analysis-actions">
  <button class="btn btn-primary" id="cellar-action-btn">Setup Zones</button>
  <button class="btn btn-secondary" id="get-ai-advice-btn">Expert Review</button>
  <button class="btn btn-secondary btn-icon" id="refresh-analysis-btn" title="Refresh analysis" aria-label="Refresh analysis">&#8635;</button>
  <span id="ai-advice-status" class="analysis-status" role="status" aria-live="polite"></span>
  <span class="analysis-cache-status" id="analysis-cache-status"></span>
</div>
```

New HTML:
```html
<div class="analysis-actions">
  <!-- Recommendations first (logical sequence: assess -> act) -->
  <button class="btn btn-secondary" id="get-ai-advice-btn">AI Recommendations</button>
  <!-- Primary CTA - text/action driven by state machine -->
  <button class="btn btn-primary" id="cellar-action-btn">Setup Zones</button>
  <!-- Refresh icon -->
  <button class="btn btn-secondary btn-icon" id="refresh-analysis-btn" title="Refresh analysis" aria-label="Refresh analysis">&#8635;</button>
  <span id="ai-advice-status" class="analysis-status" role="status" aria-live="polite"></span>
  <span class="analysis-cache-status" id="analysis-cache-status"></span>
</div>
```

Changes: (a) `#get-ai-advice-btn` moves before `#cellar-action-btn`, (b) text "Expert Review" → "AI Recommendations"

**§1b. Move AI advice section** from after `#analysis-fridge` (line ~265) to between `#analysis-alerts` and `#zone-setup-wizard`:

```html
<div class="analysis-alerts" id="analysis-alerts"></div>

<!-- AI Recommendations Section (moved up from bottom) -->
<div class="analysis-ai-advice" id="analysis-ai-advice" style="display: none;"></div>

<div class="zone-setup-wizard" id="zone-setup-wizard" style="display: none;">
```

New page section order: Summary → Alerts → **AI Recommendations** → Zone Wizard → Zone Overview → Moves → Compaction → Fridge

**§1c. Bump cache version** on CSS link tag:
- `styles.css?v=20260215d` → `styles.css?v=20260216a`

(Note: `index.html` links `styles.css` only, not `components.css`. The `components.css` version is in `sw.js` STATIC_ASSETS — see §7.)

---

### §2. `public/js/cellarAnalysis/analysis.js` — Rename CTA labels + export callback getter

**§2a.** In `updateActionButton()` (line 176), rename the state labels. Import from `labels.js`:

```javascript
import { CTA_RECONFIGURE_ZONES, CTA_AI_RECOMMENDATIONS } from './labels.js';
```

| State | Old Label | New Label |
|-------|-----------|-----------|
| `ZONES_DEGRADED` | "Reorganise Cellar" | `CTA_RECONFIGURE_ZONES` ("Reconfigure Zones") |
| `ZONES_HEALTHY` | "Reorganise Cellar" | `CTA_RECONFIGURE_ZONES` ("Reconfigure Zones") |
| `NO_ZONES` | "Setup Zones" | (unchanged) |
| `JUST_RECONFIGURED` | "Guide Me Through Moves" | (unchanged) |

**§2b.** Export a getter for the `onRenderAnalysis` callback (R2-5 — replaces module-state setter pattern):

Add near the top of the file, after imports:

```javascript
let _onRenderAnalysis = null;

/**
 * Get the current render-analysis callback.
 * Called by aiAdviceActions.js at action time — always returns fresh callback.
 * @returns {Function|null} Current render-analysis callback
 */
export function getOnRenderAnalysis() {
  return _onRenderAnalysis;
}
```

At the end of `renderAnalysis()`, after `updateActionButton()`:

```javascript
_onRenderAnalysis = () => loadAnalysis(true);
```

This keeps the callback ownership in `analysis.js` where it originates. `aiAdviceActions.js` pulls it via the getter at action time — no setter, no stale state, clean dependency direction (controller → analysis, not analysis → controller).

---

### §3. `public/js/cellarAnalysis/labels.js` — NEW constants file (R2-3)

Create new file. ~10 lines. Zero-coupling leaf module with no imports of its own:

```javascript
/**
 * @fileoverview Shared CTA label constants for cellar analysis UI.
 * Single source of truth — change here to rename a button everywhere.
 * @module cellarAnalysis/labels
 */

export const CTA_RECONFIGURE_ZONES = 'Reconfigure Zones';
export const CTA_AI_RECOMMENDATIONS = 'AI Recommendations';
export const CTA_SETUP_ZONES = 'Setup Zones';
export const CTA_GUIDE_MOVES = 'Guide Me Through Moves';
```

Used in: `analysis.js`, `zoneReconfigurationBanner.js`, `aiAdvice.js`, `index.html` (HTML uses literal string but grep test ensures consistency).

---

### §4. `public/js/cellarAnalysis/aiAdvice.js` — Rewrite (view layer) (~200 lines)

Split from the original 105-line file. This file handles: API call, spinner UI, HTML rendering. Action wiring is delegated to `aiAdviceActions.js` (§5).

**§4a. Imports:**

```javascript
import { analyseCellarAI } from '../api.js';
import { escapeHtml } from '../utils.js';
import { getCurrentAnalysis } from './state.js';
import { CTA_AI_RECOMMENDATIONS, CTA_RECONFIGURE_ZONES } from './labels.js';
import { wireAdviceActions } from './aiAdviceActions.js';
```

**§4b. Exports for testability:**

```javascript
export { formatAIAdvice, enrichMovesWithNames };
```

Both are pure functions (string in, string out) — testable without DOM or JSDOM.

**§4c. `handleGetAIAdvice()` — main entry point:**

This function is called by the button click handler registered in `cellarAnalysis.js:59`. It receives NO parameters — that registration does NOT change.

Text changes for terminology consistency (R2-12):
- Spinner text: `"Reviewing..."` → **`"Analysing..."`**
- Fallback restore text: `"Expert Review"` → **`CTA_AI_RECOMMENDATIONS`**
- Status text: `"AI review in progress (may take up to 2 minutes)..."` → **`"AI recommendations in progress (may take up to 2 minutes)..."`**
- Section heading: `"Expert Review"` → **`"AI Recommendations"`** (use `CTA_AI_RECOMMENDATIONS` constant)
- Section description: `"AI sommelier's assessment of your cellar organisation."` → **`"AI sommelier's recommendations for your cellar."`**

Enrichment flow — must happen BEFORE rendering:

```javascript
const analysis = getCurrentAnalysis();
const needsZoneSetup = analysis?.needsZoneSetup ?? false;

// Enrich all move arrays with wine names (R2-1: schema lacks wineName)
const enrichedAdvice = {
  ...result.aiAdvice,
  confirmedMoves: enrichMovesWithNames(result.aiAdvice.confirmedMoves || []),
  modifiedMoves: enrichMovesWithNames(result.aiAdvice.modifiedMoves || []),
  rejectedMoves: enrichMovesWithNames(result.aiAdvice.rejectedMoves || []),
};

adviceEl.innerHTML = `<h3>${escapeHtml(CTA_AI_RECOMMENDATIONS)}</h3>
  <p class="section-desc">AI sommelier's recommendations for your cellar.</p>
  ${formatAIAdvice(enrichedAdvice, needsZoneSetup)}`;

// Wire event listeners AFTER HTML is in DOM (CSP-compliant)
wireAdviceActions(adviceEl, enrichedAdvice);
```

After rendering, call `wireAdviceActions(adviceEl, enrichedAdvice)` to bind all event listeners. This must happen AFTER `innerHTML` is set (CSP compliance — no inline handlers).

**§4d. Error path — XSS protection (R2-7):**

The current code does NOT escape `err.message`:
```javascript
// CURRENT (vulnerable):
adviceEl.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
```

Fix:
```javascript
// FIXED:
} catch (err) {
  adviceEl.style.display = 'block';
  adviceEl.innerHTML = `<div class="ai-advice-error">Error: ${escapeHtml(err.message)}</div>`;
  if (statusEl) statusEl.textContent = '';
}
```

**§4e. `enrichMovesWithNames(aiMoves)` — name lookup helper (R2-1):**

**Why this exists**: The AI response schema (see "Existing Code Reference" above) does NOT include `wineName` on confirmedMoves, modifiedMoves, or rejectedMoves. Additionally, `rejectedMoves` lacks `from`/`to` fields entirely. This function enriches all move arrays with display-ready names and locations.

**Lookup strategy**: Search `getCurrentAnalysis().misplacedWines` first (by `wineId`), then fall back to `getCurrentAnalysis().suggestedMoves` (by `wineId`). If no match found anywhere, use `"Wine #${wineId}"`.

```javascript
/**
 * Enrich AI move objects with wine names and locations from analysis state.
 * @param {Array} moves - AI move objects (may lack wineName, from, to)
 * @returns {Array} Enriched move objects with wineName, from, to populated
 */
function enrichMovesWithNames(moves) {
  if (!moves?.length) return [];
  const analysis = getCurrentAnalysis();
  const misplaced = analysis?.misplacedWines || [];
  const suggested = analysis?.suggestedMoves || [];

  return moves.map(m => {
    // Name lookup: misplacedWines first, then suggestedMoves
    const mp = misplaced.find(w => w.wineId === m.wineId);
    const sg = suggested.find(s => s.wineId === m.wineId);
    const wineName = m.wineName || mp?.name || sg?.wineName || `Wine #${m.wineId}`;

    // For rejectedMoves (no from/to), try to fill from suggestedMoves
    const from = m.from || sg?.from || null;
    const to = m.to || sg?.to || null;

    return { ...m, wineName, from, to };
  });
}
```

**§4f. `formatAIAdvice(advice, needsZoneSetup)` — HTML rendering:**

Uses `SECTION_CONFIG` map for move sections (R2-8 — eliminates scattered CSS class strings) and native `<details>` for progressive disclosure (R2-13).

```javascript
/** Configuration for the 3 move section types — DRY rendering via renderMoveSection() */
const SECTION_CONFIG = {
  confirmed: {
    cssClass: 'ai-confirmed-moves',
    badge: 'CONFIRMED',
    badgeVariant: 'confirmed',
    cardVariant: 'ai-confirmed',
    hint: 'The AI agrees with these suggested moves.',
    showActions: true,
    defaultOpen: true,
  },
  modified: {
    cssClass: 'ai-modified-moves',
    badge: 'MODIFIED',
    badgeVariant: 'modified',
    cardVariant: 'ai-modified',
    hint: 'The AI suggests a different target for these moves.',
    showActions: true,
    defaultOpen: true,
  },
  rejected: {
    cssClass: 'ai-rejected-moves',
    badge: 'KEEP',
    badgeVariant: 'rejected',
    cardVariant: 'ai-rejected',
    hint: 'The AI recommends keeping these wines where they are.',
    showActions: false,
    defaultOpen: false,
  },
};
```

**Section rendering order** (9 sections total):

1. **Summary** — `escapeHtml(advice.summary)` as paragraph. Always visible, no `<details>` wrapper.
2. **Layout Narrative** — `escapeHtml(advice.layoutNarrative)` as paragraph. Always visible, no `<details>` wrapper.
3. **Zone Health** — `<details open>` with `advice.zoneHealth[]` as status cards. Status classes: `good` for "healthy", `warning` for "fragmented", `bad` for everything else. All text escaped.
4. **Zone Adjustments** — `<details open>` with `advice.zoneAdjustments[]` as `<li>` items. All text escaped.

**Only when `needsZoneSetup` is false** (R1-7 — prevents rendering actionable move cards when no zones are configured):

5. **Confirmed Moves** — `<details open>` using `renderMoveSection(advice.confirmedMoves, SECTION_CONFIG.confirmed)`
6. **Modified Moves** — `<details open>` using `renderMoveSection(advice.modifiedMoves, SECTION_CONFIG.modified)`
7. **Rejected Moves** — `<details>` (collapsed by default) using `renderMoveSection(advice.rejectedMoves, SECTION_CONFIG.rejected)`
8. **Ambiguous Wines** — `<details open>` with cards showing `escapeHtml(name)`, `escapeHtml(recommendation)`, and zone choice buttons (one per entry in `options[]`). Each button uses class `.ai-zone-choice-btn` with `data-wine-id`, `data-zone`, `data-wine-name` attributes.

**Always rendered:**

9. **Fridge Plan** — `<details>` (collapsed by default) with `advice.fridgePlan.toAdd[]` as `<li>` items. All text escaped.

**Bottom CTAs** — only when `needsZoneSetup` is false (R1-7):

```html
<div class="ai-advice-cta">
  <button class="btn btn-primary" data-action="ai-reconfigure-zones">Reconfigure Zones</button>
  <button class="btn btn-secondary" data-action="ai-scroll-to-moves">Scroll to Moves</button>
</div>
```

**`renderMoveSection(moves, config)`** — shared function for sections 5/6/7 (R2-8):

```javascript
/**
 * Render a move section using SECTION_CONFIG. Returns HTML string.
 * @param {Array} moves - Enriched move objects
 * @param {Object} config - Entry from SECTION_CONFIG
 * @returns {string} HTML string (empty string if no moves)
 */
function renderMoveSection(moves, config) {
  if (!moves?.length) return '';
  const openAttr = config.defaultOpen ? ' open' : '';
  let html = `<details class="${config.cssClass}"${openAttr}>`;
  html += `<summary><h4>${config.badge} <span class="ai-count-badge">${moves.length}</span></h4></summary>`;
  html += `<p class="ai-section-hint">${config.hint}</p>`;

  moves.forEach(m => {
    html += `<div class="move-item move-item--${config.cardVariant}" data-wine-id="${m.wineId}">`;
    html += `<span class="ai-move-badge ai-move-badge--${config.badgeVariant}">${config.badge}</span>`;
    html += `<strong>${escapeHtml(m.wineName)}</strong>`;
    if (m.from) html += ` <span class="move-from">${escapeHtml(m.from)}</span>`;
    if (m.to) html += ` &rarr; <span class="move-to">${escapeHtml(m.to)}</span>`;
    if (m.reason) html += `<p class="move-reason">${escapeHtml(m.reason)}</p>`;
    if (config.showActions) {
      html += `<div class="move-actions">`;
      html += `<button class="btn btn-sm btn-primary ai-move-execute-btn" data-wine-id="${m.wineId}" data-from="${escapeHtml(m.from || '')}" data-to="${escapeHtml(m.to || '')}">Move</button>`;
      html += `<button class="btn btn-sm btn-secondary ai-move-dismiss-btn">Dismiss</button>`;
      html += `</div>`;
    }
    html += `</div>`;
  });

  html += `</details>`;
  return html;
}
```

**Legacy string mode** (backward compatibility): If `advice` is a string instead of an object, split on `\n\n`, escape each paragraph with `escapeHtml()`, wrap in `<p>` tags. Same as current behavior but with escaping added.

**XSS protection checklist** (R1-2) — every AI-provided string MUST use `escapeHtml()`:
- `advice.summary`, `advice.layoutNarrative`
- `zoneHealth[].zone`, `zoneHealth[].status`, `zoneHealth[].recommendation`
- `zoneAdjustments[].zoneId`, `zoneAdjustments[].suggestion`
- All move arrays `[].wineName` (enriched), `[].from`, `[].to`, `[].reason`
- `ambiguousWines[].name`, `ambiguousWines[].recommendation`, `ambiguousWines[].options[]`
- `fridgePlan.toAdd[].category`, `fridgePlan.toAdd[].reason`
- Error messages: `escapeHtml(err.message)` (see §4d)
- Legacy string mode: `escapeHtml()` each paragraph

---

### §5. `public/js/cellarAnalysis/aiAdviceActions.js` — NEW controller layer (~150 lines) (R2-4)

Create new file. Handles all event wiring and action handlers. Separated from view layer for SRP.

**§5a. Imports:**

```javascript
/**
 * @fileoverview Action handlers for AI Recommendations section.
 * Wires event listeners and handles move execution, zone reassignment,
 * and navigation actions. Separated from aiAdvice.js (view) for SRP.
 * @module cellarAnalysis/aiAdviceActions
 */

import { executeCellarMoves, reassignWineZone } from '../api.js';
import { escapeHtml, showToast } from '../utils.js';
import { openReconfigurationModal } from './zoneReconfigurationModal.js';
import { getCurrentAnalysis } from './state.js';
import { getOnRenderAnalysis } from './analysis.js';
import { renderMoves } from './moves.js';
import { refreshLayout } from '../app.js';
```

Dependency direction: `aiAdviceActions.js` → `analysis.js` (pulls getter). No reverse dependency. No circular imports.

**§5b. Export:**

```javascript
export { wireAdviceActions };
```

**§5c. `wireAdviceActions(container, advice)` function:**

Binds all event listeners after HTML is rendered (CSP-compliant). Called by `handleGetAIAdvice()` in `aiAdvice.js` after setting `innerHTML`.

| Selector | Handler | Action |
|----------|---------|--------|
| `[data-action="ai-reconfigure-zones"]` | click | `openReconfigurationModal({ onRenderAnalysis: getOnRenderAnalysis() })` |
| `[data-action="ai-scroll-to-moves"]` | click | Smooth scroll to `#analysis-moves` |
| `.ai-move-execute-btn` | click | `handleAIMoveExecute(btn, container)` — see §5g |
| `.ai-move-dismiss-btn` | click | `handleDismiss(btn, container)` — see §5i |
| `.ai-zone-choice-btn` | click | `handleZoneChoice(btn, container)` — see §5h |

Implementation pattern (CSP-compliant event delegation):
```javascript
function wireAdviceActions(container, advice) {
  // Reconfigure Zones CTA
  container.querySelector('[data-action="ai-reconfigure-zones"]')?.addEventListener('click', () => {
    const callback = getOnRenderAnalysis();
    openReconfigurationModal({ onRenderAnalysis: callback });
  });

  // Scroll to Moves CTA
  container.querySelector('[data-action="ai-scroll-to-moves"]')?.addEventListener('click', () => {
    document.getElementById('analysis-moves')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Move execute buttons
  container.querySelectorAll('.ai-move-execute-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAIMoveExecute(btn, container));
  });

  // Move dismiss buttons
  container.querySelectorAll('.ai-move-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDismiss(btn, container));
  });

  // Zone choice buttons (ambiguous wines)
  container.querySelectorAll('.ai-zone-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => handleZoneChoice(btn, container));
  });
}
```

**§5d. `updateSectionCount(container, detailsEl)` helper:**

After a card is removed from a `<details>` section, update the count badge and auto-hide empty sections:

```javascript
/**
 * Update count badge after card removal. Hide section if count reaches 0.
 * @param {HTMLElement} container - The AI advice container
 * @param {HTMLElement} detailsEl - The <details> element containing the card
 */
function updateSectionCount(container, detailsEl) {
  if (!detailsEl) return;
  const remaining = detailsEl.querySelectorAll('.move-item').length;
  const badge = detailsEl.querySelector('.ai-count-badge');
  if (badge) badge.textContent = remaining;
  if (remaining === 0) detailsEl.style.display = 'none';
}
```

**§5e. `flashSuggestedMoves()` helper (R2-6 — visual sync cue):**

After an AI move execution updates the Suggested Moves section, briefly flash-highlight the heading and scroll to it. This bridges the Gestalt proximity gap between the AI Recommendations section and the Suggested Moves section:

```javascript
/**
 * Flash-highlight the Suggested Moves section to signal it was updated.
 * Called after an AI move is executed and suggestedMoves is re-rendered.
 */
function flashSuggestedMoves() {
  const movesSection = document.getElementById('analysis-moves');
  if (!movesSection) return;
  movesSection.classList.add('flash-highlight');
  movesSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => movesSection.classList.remove('flash-highlight'), 1500);
}
```

Requires CSS animation in `components.css` (see §6).

**§5f. Reconfigure Zones CTA handler (R2-5):**

```javascript
container.querySelector('[data-action="ai-reconfigure-zones"]')?.addEventListener('click', () => {
  const callback = getOnRenderAnalysis();  // Pull at action time — always fresh
  openReconfigurationModal({ onRenderAnalysis: callback });
});
```

No stored callback, no stale state. The getter is called at the moment the user clicks, which guarantees it returns the callback created by the most recent `renderAnalysis()` call.

**§5g. AI move execution handler (R1-1 state sync + R2-2 match semantics):**

This is the most complex handler. After executing a move via the API, it must:
1. Remove the card from the AI section
2. Sync the Suggested Moves state (mutate `currentAnalysis.suggestedMoves`)
3. Re-render the Suggested Moves section
4. Refresh the cellar grid layout
5. Flash-highlight the Suggested Moves section

```javascript
/**
 * Execute an AI-confirmed or AI-modified move.
 * After success: remove card, sync suggestedMoves state, re-render, refresh grid.
 * @param {HTMLElement} btn - The clicked "Move" button
 * @param {HTMLElement} container - The AI advice container
 */
async function handleAIMoveExecute(btn, container) {
  const card = btn.closest('.move-item');
  const wineId = Number(btn.dataset.wineId);
  const from = btn.dataset.from;
  const to = btn.dataset.to;

  btn.disabled = true;
  try {
    const result = await executeCellarMoves([{ wineId, from, to }]);
    if (result?.success === false) {
      showToast(`Move failed: ${escapeHtml(result.error || 'validation error')}`);
      return;
    }

    showToast('Move executed');

    // 1. Remove card from AI section
    const detailsEl = card?.closest('details');
    if (card) card.remove();
    updateSectionCount(container, detailsEl);

    // 2. Sync Suggested Moves state (R1-1)
    // Match on wineId + from only (R2-2: intentional — for modifiedMoves,
    // the AI changed the 'to' field, so the original suggestedMoves entry
    // has a different 'to'. We match on wineId + from because those identify
    // the wine's current position, which is what matters for deduplication.)
    const analysis = getCurrentAnalysis();
    if (analysis?.suggestedMoves) {
      const idx = analysis.suggestedMoves.findIndex(
        m => m.wineId === wineId && m.from === from
      );
      if (idx !== -1) analysis.suggestedMoves.splice(idx, 1);

      // Recalculate swap flags (mirrors moves.js:294-297 pattern)
      const sources = new Set(analysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.from));
      const targets = new Set(analysis.suggestedMoves.filter(m => m.type === 'move').map(m => m.to));
      analysis.movesHaveSwaps = [...sources].some(s => targets.has(s));

      // 3. Re-render Suggested Moves section
      renderMoves(analysis.suggestedMoves, false, analysis.movesHaveSwaps);
    }

    // 4. Refresh grid layout
    refreshLayout();

    // 5. Flash-highlight Suggested Moves section (R2-6: visual sync cue)
    flashSuggestedMoves();
  } catch (err) {
    showToast(`Error: ${escapeHtml(err.message)}`);
  } finally {
    btn.disabled = false;
  }
}
```

**§5h. Ambiguous wine zone choice handler (R1-3 + R2-9):**

Uses existing `reassignWineZone()` API to persist the zone assignment. This is a REAL action, not just a toast (R1-3). Wrapped in try/catch (R2-9) matching the `zoneChat.js:164-187` pattern.

```javascript
/**
 * Handle zone choice for an ambiguous wine.
 * Persists zone assignment via API, removes card on success.
 * @param {HTMLElement} btn - The clicked zone choice button
 * @param {HTMLElement} container - The AI advice container
 */
async function handleZoneChoice(btn, container) {
  const wineId = Number(btn.dataset.wineId);
  const zone = btn.dataset.zone;
  const wineName = btn.dataset.wineName || `Wine #${wineId}`;

  btn.disabled = true;
  try {
    // Persist zone assignment via existing API (R1-3: real action)
    await reassignWineZone(wineId, zone, 'AI recommendation');
    showToast(`Assigned ${escapeHtml(wineName)} to ${escapeHtml(zone)}`);

    // Remove card from AI section
    const card = btn.closest('.move-item');
    const detailsEl = card?.closest('details');
    if (card) card.remove();
    updateSectionCount(container, detailsEl);

    // Note: Physical move (if needed) will appear in Suggested Moves after
    // next analysis refresh. Don't auto-refresh — let user trigger when ready.
  } catch (err) {
    // R2-9: error handling matching zoneChat.js:184 pattern
    showToast(`Error: ${escapeHtml(err.message)}`);
  } finally {
    btn.disabled = false;
  }
}
```

**§5i. Dismiss handler:**

Simple card removal with count update. No API call needed.

```javascript
/**
 * Dismiss a move card from the AI section (no API call).
 * @param {HTMLElement} btn - The clicked "Dismiss" button
 * @param {HTMLElement} container - The AI advice container
 */
function handleDismiss(btn, container) {
  const card = btn.closest('.move-item');
  const detailsEl = card?.closest('details');
  if (card) card.remove();
  updateSectionCount(container, detailsEl);
}
```

---

### §6. `public/css/components.css` — New CSS for AI move cards + flash animation

Add ~90 lines after the existing `.ai-advice-error` block (after line ~1128).

**New CSS classes:**

| Class | Purpose |
|-------|---------|
| `.ai-confirmed-moves`, `.ai-modified-moves`, `.ai-rejected-moves`, `.ai-ambiguous-wines` | `<details>` section containers with bottom border |
| `.ai-section-hint` | Descriptive subtitle (0.85rem, muted color) |
| `.ai-count-badge` | Inline count pill (accent bg, rounded, small font) |
| `.ai-move-badge` | Status label on each card (CONFIRMED/MODIFIED/KEEP/REVIEW) |
| `.ai-move-badge--confirmed` | Green (success) variant |
| `.ai-move-badge--modified` | Amber (warning) variant |
| `.ai-move-badge--rejected` | Grey variant |
| `.ai-move-badge--ambiguous` | Accent variant |
| `.move-item--ai-confirmed` | Card with green left border |
| `.move-item--ai-modified` | Card with amber left border |
| `.move-item--ai-rejected` | Card with grey left border, reduced opacity |
| `.move-item--ai-ambiguous` | Card with accent left border |
| `.ai-zone-choices` | Flex wrap container for zone option buttons |
| `.ai-advice-cta` | Bottom CTA container with top border + gap |
| `.flash-highlight` | Keyframe animation: brief yellow flash (R2-6) |

Reuses existing `.move-item` base class for visual consistency with the Suggested Moves section.

**`<details>` / `<summary>` styling:**

```css
.ai-advice-structured details {
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-color, #333);
  padding-bottom: 0.75rem;
}
.ai-advice-structured details summary {
  cursor: pointer;
  user-select: none;
  padding: 0.5rem 0;
}
.ai-advice-structured details summary h4 {
  display: inline;
  margin: 0;
}
```

**Badge styling:**

```css
.ai-count-badge {
  display: inline-block;
  background: var(--accent, #8b5cf6);
  color: #fff;
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  margin-left: 0.5rem;
  vertical-align: middle;
}
.ai-section-hint {
  font-size: 0.85rem;
  color: var(--text-muted, #888);
  margin: 0.25rem 0 0.75rem;
}
.ai-move-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  margin-right: 0.5rem;
}
.ai-move-badge--confirmed { background: #166534; color: #bbf7d0; }
.ai-move-badge--modified { background: #854d0e; color: #fef08a; }
.ai-move-badge--rejected { background: #374151; color: #9ca3af; }
.ai-move-badge--ambiguous { background: var(--accent, #8b5cf6); color: #fff; }
```

**Card left-border variants:**

```css
.move-item--ai-confirmed { border-left: 3px solid #22c55e; }
.move-item--ai-modified { border-left: 3px solid #eab308; }
.move-item--ai-rejected { border-left: 3px solid #6b7280; opacity: 0.7; }
.move-item--ai-ambiguous { border-left: 3px solid var(--accent, #8b5cf6); }
```

**Zone choice buttons + CTA:**

```css
.ai-zone-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.ai-advice-cta {
  display: flex;
  gap: 0.75rem;
  padding-top: 1rem;
  margin-top: 1rem;
  border-top: 1px solid var(--border-color, #333);
}
```

**Flash animation (R2-6):**

```css
@keyframes flash-highlight {
  0% { background-color: var(--accent-light, #fff3cd); }
  100% { background-color: transparent; }
}
.flash-highlight {
  animation: flash-highlight 1.5s ease-out;
}
```

---

### §7. `public/sw.js` — Cache bust

**Line 6**: `CACHE_VERSION = 'v113'` → `'v114'`

**STATIC_ASSETS array** (R1-6 + R2-10): Update the `components.css` version string:
- `'/css/components.css?v=20260214a'` → `'/css/components.css?v=20260216a'`

(Verified: actual current value is `20260214a`, not `20260215d` as previously stated in round 1.)

---

### §8. `public/js/cellarAnalysis/zoneReconfigurationBanner.js` — Rename button

Import and use constant:

```javascript
import { CTA_RECONFIGURE_ZONES } from './labels.js';
```

Line 70: Change the button text from `"Reorganise Cellar"` to `CTA_RECONFIGURE_ZONES`.

This is a string replacement inside the template literal that builds the banner HTML.

---

### §9. `public/js/cellarAnalysis/zoneReconfigurationModal.js` — Update text reference

Line 64: Change `"Expert Review"` → `"AI Recommendations"` in the error hint message.

(Uses literal string here since it's a sentence fragment embedded in a longer message, not a standalone CTA button label. Using the constant would be awkward in sentence context.)

---

### §10. `tests/unit/cellarAnalysis/aiAdvice.test.js` — NEW test file (R2-11)

Location follows existing convention: `tests/unit/cellarAnalysis/` (alongside `analysisState.test.js`, `moveGuide.test.js`, `fridgeSwap.test.js`).

Unit tests for the exported pure functions. No JSDOM needed — tests check HTML string output.

**Mocking strategy**:
- Mock `getCurrentAnalysis()` from `./state.js` to return test fixtures with `misplacedWines` and `suggestedMoves` arrays
- Import `formatAIAdvice` and `enrichMovesWithNames` directly from `aiAdvice.js`

**Test fixtures:**

```javascript
const mockAnalysis = {
  misplacedWines: [
    { wineId: 1, name: 'Kanonkop Pinotage 2019', currentZone: 'A', suggestedZone: 'B' },
    { wineId: 2, name: 'Meerlust Rubicon 2018', currentZone: 'C', suggestedZone: 'D' },
  ],
  suggestedMoves: [
    { wineId: 1, wineName: 'Kanonkop Pinotage 2019', from: 'R3C1', to: 'R5C2', type: 'move' },
    { wineId: 3, wineName: 'Jordan Cobbler Hill 2017', from: 'R1C4', to: 'R7C1', type: 'move' },
  ],
  needsZoneSetup: false,
  movesHaveSwaps: false,
};

const mockAdvice = {
  summary: 'Your cellar is well-organized.',
  layoutNarrative: 'The zones follow logical groupings.',
  zoneHealth: [{ zone: 'SA Reds', status: 'healthy', recommendation: 'No changes needed.' }],
  zoneAdjustments: [{ zoneId: 'italian', suggestion: 'Consider splitting into sub-regions.' }],
  confirmedMoves: [{ wineId: 1, from: 'R3C1', to: 'R5C2' }],
  modifiedMoves: [{ wineId: 3, from: 'R1C4', to: 'R8C3', reason: 'Better proximity to Italian zone' }],
  rejectedMoves: [{ wineId: 5, reason: 'Already optimally placed' }],
  ambiguousWines: [{ wineId: 7, name: 'Grenache Blend', options: ['rhone', 'spanish'], recommendation: 'Fits either zone' }],
  fridgePlan: { toAdd: [{ wineId: 10, reason: 'Ready to drink', category: 'crispWhite' }], toRemove: [], coverageAfter: {} },
};
```

**Test cases:**

```
describe('formatAIAdvice')
  it('renders summary and narrative with escapeHtml')
  it('renders zone health cards with correct status classes (good/warning/bad)')
  it('renders zone adjustments as list items')
  it('renders confirmed moves using SECTION_CONFIG with CONFIRMED badge + Move/Dismiss buttons')
  it('renders modified moves with reason text and MODIFIED badge')
  it('renders rejected moves in collapsed <details> without action buttons')
  it('renders ambiguous wines with zone choice buttons per option')
  it('renders fridge plan recommendations in collapsed <details>')
  it('renders bottom CTAs (Reconfigure Zones + Scroll to Moves)')
  it('skips move sections when needsZoneSetup=true (R1-7)')
  it('skips Reconfigure Zones CTA when needsZoneSetup=true')
  it('escapes HTML in all AI-provided text fields (R1-2) — verify <script> becomes &lt;script&gt;')
  it('handles legacy string advice format — splits on \\n\\n, escapes each paragraph')
  it('handles null/empty advice gracefully — returns "No advice available."')
  it('renders empty string for section with 0 moves')

describe('enrichMovesWithNames')
  it('resolves wineName from misplacedWines by wineId')
  it('resolves wineName from suggestedMoves by wineId as fallback')
  it('falls back to "Wine #123" when name not found in either source')
  it('fills from/to for rejectedMoves from suggestedMoves (R2-1 — rejectedMoves has no from/to)')
  it('preserves existing wineName if already present on move object')
  it('returns empty array for null input')
  it('returns empty array for undefined input')
  it('returns empty array for empty array input')

describe('label consistency')
  it('no "Reorganise Cellar" text in any public/js/ file — grep scan')
  it('no "Expert Review" text in any public/js/ file — grep scan')
```

---

## What We're NOT Changing

- **No backend changes**: The AI response schema (`src/services/cellar/cellarAI.js`) already returns all the data we need
- **No new API endpoints**: We use existing `executeCellarMoves()` and `reassignWineZone()` from `public/js/api.js`
- **No changes to the reconfig planner**: The "Reconfigure Zones" CTA opens the same modal (`zoneReconfigurationModal.js`) with the same planning pipeline
- **No changes to `moves.js` internals**: We import `renderMoves` to re-render after AI move execution, but don't modify the file itself
- **No changes to `cellarAnalysis.js`** (init file): Button handler registration `getAIAdviceBtn.addEventListener('click', handleGetAIAdvice)` stays unchanged — no parameters needed

---

## Implementation Order

| Step | File | Action |
|------|------|--------|
| 1 | `public/js/cellarAnalysis/labels.js` | **CREATE** — constants file (no dependencies, must exist before other files import it) |
| 2 | `public/sw.js` | **EDIT** — cache bust (CACHE_VERSION `v113` → `v114` + STATIC_ASSETS `components.css` version) |
| 3 | `public/index.html` | **EDIT** — swap button order, rename "Expert Review" → "AI Recommendations", move AI section div, bump CSS version |
| 4 | `public/css/components.css` | **EDIT** — add ~90 lines of new CSS classes + flash animation |
| 5 | `public/js/cellarAnalysis/analysis.js` | **EDIT** — import labels.js, rename CTA labels, add `getOnRenderAnalysis()` getter + module-level `_onRenderAnalysis` variable |
| 6 | `public/js/cellarAnalysis/zoneReconfigurationBanner.js` | **EDIT** — import labels.js, rename button text |
| 7 | `public/js/cellarAnalysis/zoneReconfigurationModal.js` | **EDIT** — rename "Expert Review" reference in error hint |
| 8 | `public/js/cellarAnalysis/aiAdvice.js` | **REWRITE** — view layer (~200 lines): API call, spinner, `enrichMovesWithNames()`, `formatAIAdvice()`, `renderMoveSection()` |
| 9 | `public/js/cellarAnalysis/aiAdviceActions.js` | **CREATE** — controller layer (~150 lines): `wireAdviceActions()`, all action handlers |
| 10 | `tests/unit/cellarAnalysis/aiAdvice.test.js` | **CREATE** — unit tests for pure functions |
| 11 | Run `npm run test:unit` | **VERIFY** — all existing + new tests pass |

---

## Verification Checklist

1. **Unit tests**: `npm run test:unit` — all existing + new tests pass (currently 1644 tests across 61 files)
2. **Label consistency**: Grep for `"Reorganise Cellar"` and `"Expert Review"` across `public/js/` — zero matches (also validated by test in §10)
3. **Manual testing across all 4 analysis states**:
   - `NO_ZONES`: CTA says "Setup Zones", AI Recommendations renders narrative only (no moves, no "Reconfigure Zones" CTA)
   - `ZONES_DEGRADED`: CTA says "Reconfigure Zones", banner also says "Reconfigure Zones", AI Recommendations shows full structured data with actionable cards
   - `ZONES_HEALTHY`: Same as degraded but banner may not appear
   - `JUST_RECONFIGURED`: CTA says "Guide Me Through Moves", success banner works
4. **AI Recommendations action buttons**:
   - Click "Move" on confirmed move → toast, card removed, count badge decrements, **Suggested Moves section also updates + flash-highlights** (state sync + visual cue), cellar grid refreshes
   - Click "Dismiss" on move card → card removed, count badge decrements, section hides if 0 remaining
   - Click zone choice on ambiguous wine → **`reassignWineZone` API called** (with try/catch), toast confirms, card removed
   - Click "Reconfigure Zones" CTA → reconfig modal opens (callback fetched at click time via getter — verify fresh)
   - Click "Scroll to Moves" CTA → smooth scroll to `#analysis-moves`
5. **Progressive disclosure**: Rejected Moves and Fridge Plan sections render collapsed (`<details>` without `open`); Confirmed/Modified/Ambiguous render expanded (`<details open>`)
6. **XSS check**: Insert `<img onerror=alert(1)>` as a wine name via database, trigger AI Recommendations, verify escaped in output — including error path
7. **No duplicate "Reorganise Cellar"** text anywhere on the page
8. **Cache bust**: Hard refresh, verify sw.js reports `v114` in DevTools → Application → Service Workers
9. **Dependency graph**: No circular imports — verify `aiAdviceActions.js` → `analysis.js` (getter) is one-directional
10. **CSP compliance**: No inline event handlers (`onclick`, `onchange`) in any generated HTML — all listeners attached via `addEventListener` in `wireAdviceActions()`
