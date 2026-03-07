# Plan: Dynamic Fridge Stocking — Frontend

- **Date**: 2026-03-06
- **Status**: Draft (rev 2 — incorporates audit feedback)
- **Author**: Claude + User
- **Companion**: [Backend plan](dynamic-fridge-stocking.md)

---

## 1. Current UI Audit

### What Exists Today

**Fridge workspace tab** — One of 4 workspace tabs (Zones, Placement, Fridge, Zone Config) inside the cellar analysis panel. Renders via `renderFridgeStatus(analysis.fridgeStatus)` in `cellarAnalysis/fridge.js`.

**Current layout** (top to bottom):
1. Household fridge warning banner (conditional, text-only)
2. Capacity bar — green fill + "X/9 slots" text + "Organize Fridge" button
3. Category mix grid — 7 fixed columns (Sparkling, Crisp White, Aromatic, Oaked White, Rose, Light Red, Flex) showing current counts with orange highlight on gaps
4. Par-Level Gaps section — lists gaps with "Need N" badge + unfilled messages
5. Suggested Additions/Swaps — candidate cards with "Add to F4" / "Swap" buttons, plus collapsible "Other options" alternatives
6. Fridge organize panel (hidden by default, toggle via button)

**Main grid** (`grid.js`) — Renders fridge grid in the main cellar view. Currently only finds the first `wine_fridge` area. No `kitchen_fridge` rendering.

**HTML structure** — Single container: `#analysis-fridge` > `#fridge-status-content`. All content is innerHTML-replaced by `renderFridgeStatus()`.

**CSS** — ~250 lines of `.fridge-*` classes in `components.css`. Design language uses warm earth tones matching the wine cellar theme. CSS variables for fridge colours exist in `variables.css` (`--fridge-bg`).

### Existing Patterns & Design Language

- **Workspace tabs** — Horizontal tab bar switching between panels, with notification badges
- **Category grid** — Fixed-column flexbox layout (`.fridge-mix-grid`) with count + label per cell
- **Candidate cards** — Info block (name, reason, location) + action button, stacked vertically
- **Capacity bar** — Simple CSS bar with percentage fill
- **Buttons** — `.btn .btn-secondary .btn-small` for fridge actions
- **Collapsible sections** — `style="display: none"` toggled by JS
- **Toast notifications** — `showToast()` for action feedback
- **Section headings** — `<h3>` for workspace titles, `<h5>` for subsections

### Pain Points Identified

1. **Hardcoded 7 columns** in mix grid — category list is a JS literal, doesn't adapt to fewer/more categories
2. **Single fridge assumption** — No container structure for multiple fridge areas
3. **No fridge type indicator** — Only a warning banner for household fridge, no positive label for wine fridge
4. **Category labels duplicated** — `categoryLabels` object in `fridge.js` is a copy of backend data
5. **No temperature context** — User doesn't see why certain categories appear/disappear for their fridge type

### Reusable Components

- `escapeHtml()`, `showToast()` from `utils.js`
- `executeCellarMoves()`, `getFridgeOrganization()` from `api.js`
- `refreshLayout()` from `app.js`
- Existing CSS classes: `.fridge-candidate`, `.fridge-gap-item`, `.fridge-capacity-bar`, `.btn-*`
- `switchWorkspace()`, `getCurrentAnalysis()` from `state.js`
- `identifySwapTarget()`, `buildSwapOutReason()`, `computeUrgency()` — keep as-is

---

## 2. User Flow & Wireframe

### User Journey

1. User opens Cellar Analysis → clicks "Fridge" workspace tab
2. System shows one section per fridge area the user has configured
3. Each section shows:
   - Area name + type badge (e.g., "Wine Fridge" or "Kitchen Fridge")
   - Capacity bar
   - Dynamic category grid (only eligible categories for that fridge type)
   - Par-level gaps (computed proportionally to capacity)
   - Candidates/alternatives
4. If user has both fridge types, sections stack vertically with clear separation
5. Actions (Add/Swap/Organize) work per-area — button executes move into that area's slots

### Wireframe — Single Wine Fridge (most common case)

```
+----------------------------------------------------------------------+
|  Wine Fridge                                    [wine fridge badge]   |
|  10-14C — Ideal for all wine types                                   |
+----------------------------------------------------------------------+
|  [===========================================-------]  18/24 slots   |
|                                              [Organize Fridge]       |
+----------------------------------------------------------------------+
|  2        4        1        3        2        4        1        1    |
|  Sparkling Crisp   Aromatic Oaked    Rose    Light    Dessert  Flex  |
|           White    White    White            Red      /Fort.         |
+----------------------------------------------------------------------+
|  Par-Level Gaps                                                      |
|  ┌──────────────────────────────────────────────────────────────┐   |
|  │ Aromatic White: Off-dry/aromatic for spicy food     Need 1  │   |
|  └──────────────────────────────────────────────────────────────┘   |
+----------------------------------------------------------------------+
|  Suggested Additions                                                  |
|  ┌──────────────────────────────────────────────────────────────┐   |
|  │ 2024 Trimbach Riesling Reserve                    [Add to F7]│   |
|  │ Fills aromatic white gap - Great for spicy, asian             │   |
|  │ Currently in R12C3                                            │   |
|  │                                                               │   |
|  │ Other options:                                                │   |
|  │  Hugel Gewurztraminer 2023  in R12C5     [Use this instead]  │   |
|  └──────────────────────────────────────────────────────────────┘   |
+----------------------------------------------------------------------+
```

### Wireframe — Kitchen Fridge (fewer categories)

```
+----------------------------------------------------------------------+
|  Kitchen Fridge                              [kitchen fridge badge]   |
|  4-8C — Pre-serve chilling for whites & sparkling                    |
+----------------------------------------------------------------------+
|  [=================-----------------------------]  3/6 slots         |
+----------------------------------------------------------------------+
|  1         1         0         1         0                           |
|  Sparkling Crisp     Aromatic  Rose      Flex                        |
|            White     White                                           |
+----------------------------------------------------------------------+
|  Note: Reds and oaked whites need warmer storage (10-14C).           |
|  Add a wine fridge for these styles.                                 |
+----------------------------------------------------------------------+
```

### Wireframe — Both Fridges (stacked)

```
+----------------------------------------------------------------------+
|  FRIDGE STATUS                                                        |
+----------------------------------------------------------------------+
|  ┌─── Wine Fridge (24 slots) ─────────────────────────────────────┐ |
|  │ [full rendering as above — all categories]                      │ |
|  └─────────────────────────────────────────────────────────────────┘ |
|                                                                      |
|  ┌─── Transfer Suggestions ───────────────────────────────────────┐ |
|  │ ⚠ Pinot Noir 2023 — Kitchen Fridge → Wine Fridge              │ |
|  │   Too cold at 4-8°C; needs 12-14°C (wine fridge)  [Transfer]  │ |
|  └─────────────────────────────────────────────────────────────────┘ |
|                                                                      |
|  ┌─── Kitchen Fridge (6 slots) ───────────────────────────────────┐ |
|  │ [compact rendering — white/sparkling categories only]           │ |
|  └─────────────────────────────────────────────────────────────────┘ |
+----------------------------------------------------------------------+
```

**Transfer section placement**: Between the area sections, not inside either area. Transfers span two areas and belong to neither. Visually distinguished with a left border accent and warning-color styling. Only rendered when `fridgeTransfers.length > 0`.

---

## 3. UX Design Decisions

### Decision 1: Per-area sections, not merged view
*Principles: Common Region (#6), Closure (#4), User Logic (#9)*

Each fridge area gets its own visually bounded section. Users think of their wine fridge and kitchen fridge as physically separate appliances — the UI should mirror this mental model. Merging them into one view would confuse which candidates go where.

### Decision 2: Dynamic category columns based on eligibility
*Principles: Progressive Disclosure (#13), Recognition Over Recall (#14), Hick's Law (#15)*

The category grid only shows categories eligible for that fridge type. A kitchen fridge showing "Light Red: 0" with no explanation is confusing — better to not show it at all and explain why via a subtle info note.

### Decision 3: Fridge type badge + temperature context
*Principles: Feedback & System Status (#11), Match System & Real World (#Nielsen 2)*

Each section shows a small type badge ("Wine Fridge" / "Kitchen Fridge") and a one-line temperature description. This connects the abstract category filtering to the physical reality the user understands ("oh, my kitchen fridge is too cold for reds, that makes sense").

### Decision 4: Category grid adapts column count to content
*Principles: Similarity (#2), Continuity (#3), Responsive Design (#25)*

Instead of hardcoding 7 columns, the grid uses `repeat(auto-fit, minmax(80px, 1fr))`. Categories flow naturally — 5 columns for a kitchen fridge, 8 for a wine fridge with dessert/fortified. No empty phantom columns.

### Decision 5: Info note replaces warning banner for kitchen fridge
*Principles: Error Prevention (#12), Visual Hierarchy (#17)*

The current "Household fridge selected — red wines excluded" is a warning-style banner. This implies something is wrong. Instead, a neutral info note at the bottom of the category grid explains what's excluded and why, with an optional suggestion to add a wine fridge.

### Decision 6: Backward compatible — single fridge still looks the same
*Principles: Consistency (#10), Backward Compatibility*

For users with a single wine fridge, the UI looks virtually identical to today. The area name/badge is a subtle addition, not a disruptive change. The section wrapper is always present but transparent when there's only one area.

### Decision 7: Category labels come from backend response
*Principles: Single Source of Truth (DRY #29), No Hardcoding (#31)*

The backend `fridgeAnalysis` per-area response includes `eligibleCategories` (filtered registry metadata with display labels) from `getEligibleCategories()`. The frontend reads these instead of maintaining a duplicate mapping. When a new category like `dessertFortified` is added on the backend, the frontend renders it automatically.

**Contract requirement**: Each area object in `fridgeAnalysis[]` must include:
- `eligibleCategories`: `{ [categoryId]: { label, priority, description } }` — the categories valid for this area's storage type, with display-ready labels
- The `label` field replaces the frontend's current `categoryLabels` lookup object

The backend plan (section 4.4, step 9) must be updated to include `eligibleCategories` in the per-area response shape. This is computed cheaply via `getEligibleCategories(storageType)` + `CATEGORY_DISPLAY_NAMES` from the registry.

**Fallback**: If a cached/legacy response lacks `eligibleCategories`, `buildCategoryGridHtml()` falls back to the existing hardcoded `categoryLabels` mapping in `fridge.js` (preserved as `LEGACY_CATEGORY_LABELS`). This covers the transition period where cached analysis results predate the backend change.

### Decision 8: Transfer suggestions are a distinct UI section
*Principles: Feedback & System Status (#11), Error Prevention (#12), User Logic (#9)*

The backend returns `fridgeTransfers[]` as a first-class output — cross-area misplacement corrections (e.g., "Move Pinot Noir from Kitchen Fridge → Wine Fridge"). These are rendered as a dedicated section between the per-area analyses, visually distinguished from per-area candidates:

1. **Not embedded in a specific area** — transfers span two areas, so they appear in a standalone section after all area sections
2. **Higher visual priority than candidates** — transfers correct misplacements (wine in wrong fridge type), while candidates fill gaps. Misplacement correction is more urgent.
3. **Each transfer card shows**: wine name, source area → destination area, reason (temperature suitability), and an "Execute Transfer" button
4. **No conflicting advice** — the backend already demotes candidates that compete with transfers for the same destination slot. The frontend does not need to deduplicate.

### Decision 9: Stable area ID targeting, not array index
*Principles: Defensive Validation (#12), Data Integrity*

Action buttons use `data-area-id` (the backend's stable UUID `areaId`) instead of `data-area-index`. This prevents drift when areas are hidden (0-capacity), reordered, or filtered. The handler looks up area data via `fridgeAnalysis.find(a => a.areaId === areaId)` rather than array indexing.

---

## 4. Technical Architecture

### Component Diagram

```
public/js/cellarAnalysis/fridge.js    MODIFY — main renderer
  |
  |- renderFridgeStatus(fridgeStatus)           KEEP (backward compat, single-area)
  |- renderFridgeAreas(fridgeAnalysis)           NEW  — loops over areas + transfers
  |- renderFridgeArea(areaData, containerEl)     NEW  — per-area renderer (core)
  |- renderCategoryGrid(categories, mix, gaps)   NEW  — dynamic column grid
  |- renderFridgeAreaInfo(areaData)              NEW  — type badge + temp description
  |- renderTransferSuggestions(transfers)         NEW  — cross-area transfer cards
  |- renderNoFridgeState(containerEl)            NEW  — empty state for no-fridge users
  |
  |- moveFridgeCandidate(index, areaId)          MODIFY — scope to area by ID
  |- swapFridgeCandidate(index, areaId)          MODIFY — scope to area by ID
  |- moveAlternativeCandidate(cat, idx, areaId)  MODIFY — scope to area by ID
  |- handleOrganizeFridge(areaId)                MODIFY — scope to area by ID
  |- executeTransfer(transferIndex)              NEW  — execute cross-area transfer

public/js/cellarAnalysis/analysis.js  MODIFY — call new entry point
  |- renderAnalysis() now calls renderFridgeAreas() when available,
  |  renderNoFridgeState() for empty fridgeAnalysis,
  |  falls back to renderFridgeStatus() for legacy responses

public/css/components.css             MODIFY — add fridge area wrapper + transfer styles
public/index.html                     MODIFY — trivial (container stays the same)
```

### State Management

**No new global state needed.** Each fridge area's data is self-contained in the `fridgeAnalysis[]` array from the backend response. The `getCurrentAnalysis()` accessor still works — area data is looked up via `analysis.fridgeAnalysis.find(a => a.areaId === id)`.

**Area ID convention**: Each action button gets a `data-area-id` attribute (the backend's stable UUID) identifying which fridge area it belongs to. This replaces the current assumption that there's only one fridge, and is stable even when areas are hidden (0-capacity) or reordered.

### Event Handling Strategy

**Event delegation pattern preserved.** Buttons are wired after innerHTML replacement using `querySelectorAll`, same as today. Each button carries `data-area-id` + `data-candidate-index`.

```javascript
// Example: per-area scoped action
contentEl.querySelectorAll('.fridge-add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const areaId = btn.dataset.areaId;
    const candidateIndex = Number.parseInt(btn.dataset.candidateIndex, 10);
    moveFridgeCandidate(candidateIndex, areaId);
  });
});

// Example: transfer action
contentEl.querySelectorAll('.fridge-transfer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const transferIndex = Number.parseInt(btn.dataset.transferIndex, 10);
    executeTransfer(transferIndex);
  });
});
```

### Helper: Area Data Lookup

```javascript
/**
 * Look up area data by stable areaId instead of brittle array index.
 * @param {string} areaId - UUID from backend
 * @returns {Object|undefined} Area analysis data
 */
function getAreaById(areaId) {
  const analysis = getCurrentAnalysis();
  return analysis?.fridgeAnalysis?.find(a => a.areaId === areaId);
}
```

### CSS Architecture

**New classes** (minimal additions):
```css
/* Area wrapper — visual separation between multiple fridge areas */
.fridge-area {
  margin-bottom: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
  background: var(--card-bg, transparent);
}

/* Only add visual separation when there are multiple areas */
.fridge-areas--multi .fridge-area {
  border: 1px solid var(--border-color);
}

/* Area header with type badge */
.fridge-area-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.fridge-type-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--fridge-bg);
  color: var(--text-muted);
}

.fridge-type-badge--wine { background: var(--wine-red-subtle, #f3e5e0); }
.fridge-type-badge--kitchen { background: var(--cool-blue-subtle, #e0ecf3); }

/* Temp context line */
.fridge-temp-context {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

/* Info note (replaces warning banner for kitchen fridge) */
.fridge-info-note {
  font-size: 0.8rem;
  color: var(--text-muted);
  background: var(--bg-subtle);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  margin-top: 0.75rem;
}

/* Dynamic category grid — auto-fit replaces hardcoded 7 columns */
.fridge-mix-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 0.5rem;
}

/* Transfer suggestions — cross-area section */
.fridge-transfers {
  margin: 1.5rem 0;
  padding: 1rem;
  border-radius: 8px;
  background: var(--bg-subtle);
  border-left: 3px solid var(--warning-color, #e6a817);
}

.fridge-transfer-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
}

.fridge-transfer-card:last-child {
  border-bottom: none;
}

.fridge-transfer-arrow {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0.5rem;
}

/* Empty state for no-fridge users */
.fridge-empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted);
}
```

**Existing CSS preserved** — All `.fridge-candidate`, `.fridge-gap-item`, `.fridge-capacity-bar` etc. remain unchanged. The new classes wrap around existing elements.

---

## 5. State Map

### Fridge Workspace Panel

| State | What User Sees | Render Path |
|-------|----------------|-------------|
| **No fridge configured** (`fridgeAnalysis: []` or `null`) | "No fridge configured. Add a wine fridge or kitchen fridge in Storage Settings." with link to storage builder | `renderNoFridgeState()` — dedicated empty renderer |
| **Loading** | Standard analysis loading spinner (handled by parent `loadAnalysis()`) | Parent handles |
| **Error** | "Error loading fridge analysis" toast (handled by parent) | Parent handles |
| **Single wine fridge** | Current-looking UI with subtle type badge — minimal visual change | `renderFridgeAreas()` → single `renderFridgeArea()` |
| **Single kitchen fridge** | Reduced category grid (no reds/oaked), info note about excluded categories | `renderFridgeAreas()` → single `renderFridgeArea()` |
| **Both fridge types** | Stacked sections with clear visual separation, each with own capacity bar + candidates | `renderFridgeAreas()` → two `renderFridgeArea()` calls |
| **Both types + misplaced wines** | Stacked area sections + transfer suggestions section between them | `renderFridgeAreas()` → areas + `renderTransferSuggestions()` |
| **Fridge full, has gaps** | Swap suggestions shown (existing behavior, now per-area) | `renderFridgeArea()` swap path |
| **No cellar wines match any category** | "Your cellar doesn't have wines matching any fridge categories" + empty gaps | `renderFridgeArea()` with all-zero mix |
| **0 capacity area** | Area hidden (edge case safety) | Filtered out before `renderFridgeArea()` |
| **Legacy response** (no `fridgeAnalysis`, has `fridgeStatus`) | Existing single-fridge UI via backward-compat path | `renderFridgeStatus()` wrapper |

### Category Grid Cell

| State | Visual |
|-------|--------|
| **Has wines, no gap** | Normal count + label |
| **Has wines, below par** | Orange highlighted count (existing `.has-gap`) |
| **Zero count, has par target** | "0" in orange (gap indicator) |
| **Zero count, no par target** | Not shown (category excluded or no stock) |

---

## 6. File-Level Plan

### 6.1 MODIFY: `public/js/cellarAnalysis/fridge.js`

**Purpose**: Multi-area fridge rendering with dynamic categories, transfer suggestions, empty state
**Principles**: Single Responsibility (#27), DRY (#29), No Hardcoding (#31)

Key changes:

```javascript
/**
 * NEW: Render all fridge areas from fridgeAnalysis array.
 * Entry point called by analysis.js when backend returns fridgeAnalysis[].
 * Handles: per-area sections, transfer suggestions, empty areas (0 capacity filtered out).
 * @param {Array} fridgeAnalysis - Per-area analysis objects (each has areaId, areaName, storageType, eligibleCategories, ...)
 * @param {Array} [fridgeTransfers=[]] - Cross-area transfer suggestions from backend
 */
export function renderFridgeAreas(fridgeAnalysis, fridgeTransfers = [])

/**
 * NEW: Render a single fridge area into a container element.
 * Extracted from current renderFridgeStatus() for per-area reuse.
 * @param {Object} areaData - Single area analysis (same shape as current fridgeStatus + areaId, areaName, storageType, eligibleCategories)
 * @param {HTMLElement} containerEl - Target container
 * @param {string} areaId - Stable area UUID for button data attributes (NOT array index)
 */
function renderFridgeArea(areaData, containerEl, areaId)

/**
 * EXISTING: renderFridgeStatus() kept for backward compatibility.
 * Wraps renderFridgeArea() for single-fridge case.
 * Called when backend returns legacy fridgeStatus (no fridgeAnalysis array).
 */
export function renderFridgeStatus(fridgeStatus)

/**
 * NEW: Render empty state when user has no fridge areas configured.
 * Shows helpful message with link to storage settings.
 * @param {HTMLElement} containerEl - Target container
 */
export function renderNoFridgeState(containerEl)

/**
 * NEW: Build category grid HTML from dynamic category list.
 * Replaces hardcoded 7-column categories array.
 * @param {Object} eligibleCategories - { categoryId: { label, priority, description } } from backend per-area response
 * @param {Object} currentMix - Counts by category
 * @param {Object} parLevelGaps - Gap objects by category
 * @returns {string} HTML
 *
 * FALLBACK: If eligibleCategories is missing (legacy/cached response), uses
 * LEGACY_CATEGORY_LABELS constant (preserved from current hardcoded mapping).
 */
function buildCategoryGridHtml(eligibleCategories, currentMix, parLevelGaps)

/**
 * NEW: Build fridge type header with badge and temp context.
 * @param {Object} areaData - Area analysis data
 * @returns {string} HTML
 */
function buildAreaHeaderHtml(areaData)

/**
 * NEW: Render cross-area transfer suggestions.
 * Shown as a dedicated section between area sections (transfers span two areas).
 * Each card: wine name, source area → destination area, reason, execute button.
 * @param {Array} fridgeTransfers - [{ wine, fromArea, toArea, category, reason }]
 * @param {HTMLElement} containerEl - Target container
 */
function renderTransferSuggestions(fridgeTransfers, containerEl)

/**
 * NEW: Execute a cross-area fridge transfer.
 * Moves the wine from source area slot to an available destination area slot.
 * @param {number} transferIndex - Index into fridgeTransfers array
 */
async function executeTransfer(transferIndex)

/**
 * PRESERVED: Legacy category labels for backward compatibility.
 * Used by buildCategoryGridHtml() when backend response lacks eligibleCategories.
 */
const LEGACY_CATEGORY_LABELS = {
  sparkling: 'Sparkling', crispWhite: 'Crisp White', aromaticWhite: 'Aromatic White',
  textureWhite: 'Oaked White', rose: 'Rose', chillableRed: 'Light Red', flex: 'Flex'
};
```

**Migration approach**: `renderFridgeStatus()` becomes a thin wrapper that creates a single-item array and calls `renderFridgeAreas()`. Existing tests and `renderAIFridgeAnnotations()` continue to work.

**Action handlers** — All existing handlers (`moveFridgeCandidate`, `swapFridgeCandidate`, `moveAlternativeCandidate`, `handleOrganizeFridge`) gain an `areaId` parameter (stable UUID, not array index). They look up area data via `getAreaById(areaId)` instead of `analysis.fridgeAnalysis[areaIndex]`.

### 6.2 MODIFY: `public/js/cellarAnalysis/analysis.js`

**Changes** (three-way branch — explicit about every state):
```javascript
// Line ~278 — Replace:
renderFridgeStatus(analysis.fridgeStatus);

// With:
if (analysis.fridgeAnalysis?.length > 0) {
  // New multi-area path
  renderFridgeAreas(analysis.fridgeAnalysis, analysis.fridgeTransfers);
} else if (analysis.fridgeAnalysis !== undefined) {
  // Backend returned fridgeAnalysis but it's empty → no fridge configured
  renderNoFridgeState(document.getElementById('fridge-status-content'));
} else if (analysis.fridgeStatus) {
  // Backward compat: legacy single-fridge response (no fridgeAnalysis field)
  renderFridgeStatus(analysis.fridgeStatus);
} else {
  // Backend returned neither fridgeAnalysis nor fridgeStatus → no fridge
  renderNoFridgeState(document.getElementById('fridge-status-content'));
}
```

Import `renderFridgeAreas` and `renderNoFridgeState` alongside existing `renderFridgeStatus`.

**Why a three-way branch**: The audit identified that the previous two-way branch (`fridgeAnalysis?.length > 0` / else `renderFridgeStatus`) left a gap: when `fridgeAnalysis` is an empty array, `renderFridgeStatus(null)` produced no visible output. Now every state has an explicit render path.

### 6.3 MODIFY: `public/css/components.css`

**Add** ~40 lines for `.fridge-area`, `.fridge-areas--multi`, `.fridge-area-header`, `.fridge-type-badge`, `.fridge-temp-context`, `.fridge-info-note` (detailed in Section 4).

**Modify** `.fridge-mix-grid` — change from fixed flexbox to `grid-template-columns: repeat(auto-fit, minmax(80px, 1fr))` so column count adapts to eligible categories.

### 6.4 MODIFY: `public/index.html`

**No structural changes** — The `#analysis-fridge` container and `#fridge-status-content` div remain. The `renderFridgeAreas()` function renders area sections inside `#fridge-status-content` via innerHTML.

### 6.5 MODIFY: `public/js/grid.js`

**Change** `getFridgeRows()` to find ALL fridge-type areas (wine_fridge + kitchen_fridge), not just the first `wine_fridge`. Each area renders as a separate fridge grid section in the main view.

### 6.6 NO CHANGE: `public/js/cellarAnalysis/state.js`

No new state variables needed. The `fridgeAnalysis` array lives in `analysis.fridgeAnalysis` within `currentAnalysis`.

### 6.7 COMPANION UPDATE REQUIRED: Backend plan (dynamic-fridge-stocking.md)

The backend plan section 4.4 step 9 defines the response shape as `fridgeAnalysis: [{ areaId, areaName, storageType, ...status }]`. This must be updated to include:

1. **`eligibleCategories`** per area: `{ [categoryId]: { label, priority, description } }` — computed from `getEligibleCategories(storageType)` + `CATEGORY_DISPLAY_NAMES`. Cost: negligible (pure in-memory lookup).
2. **`fridgeTransfers`** at the top level (already documented in backend Decision 8, but not in the response shape specification).
3. **`storageType`** per area (already implied but should be explicit in the response shape).

Without these fields, `buildCategoryGridHtml()` falls back to legacy labels and `renderTransferSuggestions()` has nothing to render.

---

## 7. Risk & Trade-off Register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| AI fridge annotations (`renderAIFridgeAnnotations`) assume single `fridgeStatus` | Medium | Update to iterate `fridgeAnalysis[]` and match by `areaId`. Fallback to `fridgeStatus` for cached analysis without `fridgeAnalysis` |
| Organize Fridge panel currently uses single `#fridge-organize-panel` ID | Medium | Change to `data-area-id` based targeting. Each area gets its own organize panel div |
| Long category names overflow on small screens | Low | `minmax(80px, 1fr)` grid + text truncation with title tooltip |
| Users confused by seeing two fridge sections | Low | Clear heading + type badge + temp description make it obvious |
| Existing unit tests for `fridge.js` (identifySwapTarget, etc.) | Low | Pure functions unchanged — only rendering functions gain `areaId` param |
| Transfer section invisible if backend omits `fridgeTransfers` | Low | `renderFridgeAreas` defaults to `[]`; section simply not rendered when empty |
| `eligibleCategories` missing from cached/legacy responses | Medium | `buildCategoryGridHtml()` falls back to `LEGACY_CATEGORY_LABELS`; graceful degradation, not crash |

### Deliberately Deferred

1. **Drag-and-drop between fridge areas** — Future enhancement. For now, use Add/Swap buttons per area.
2. **Fridge area settings inline** (rename, change type) — Should go through Storage Settings, not analysis panel.
3. **Animated transitions between fridge states** — Nice-to-have, not needed for correctness.
4. **Mobile-optimized fridge layout** — The `auto-fit` grid handles basic responsiveness. A dedicated mobile layout is deferred.

---

## 8. Testing Strategy

### Visual/Manual Testing Checklist

- [ ] Single wine fridge — renders same as today + subtle type badge
- [ ] Single kitchen fridge — reduced categories, info note, no red candidates
- [ ] Both fridge types — two stacked sections with clear separation
- [ ] No fridge configured — empty state message with storage settings link
- [ ] Wine fridge with 48 slots — proportional par-levels, more categories shown
- [ ] Kitchen fridge with 3 slots — minimal categories, graceful layout
- [ ] Add candidate button works per area (correct target slots, `data-area-id` resolves correctly)
- [ ] Swap button works per area (correct fridge wine identified)
- [ ] Alternative "Use this instead" works per area
- [ ] Organize Fridge works independently per area
- [ ] AI fridge annotations still appear on matching candidates
- [ ] Category grid adapts column count when window resizes
- [ ] Transfer suggestions section appears when backend returns `fridgeTransfers`
- [ ] Transfer suggestion card shows source → destination area names + reason
- [ ] Execute Transfer button moves wine and refreshes both areas
- [ ] No transfer section shown when `fridgeTransfers` is empty
- [ ] Legacy response (no `fridgeAnalysis`, only `fridgeStatus`) still renders via backward compat
- [ ] `eligibleCategories` missing from cached response — category grid falls back to legacy labels

### Accessibility Testing

- [ ] All buttons keyboard-focusable (Tab order)
- [ ] Fridge type badge has sufficient contrast (WCAG AA)
- [ ] Info note text readable at 4.5:1 contrast
- [ ] Screen reader: area heading reads as "Wine Fridge, 18 of 24 slots occupied"
- [ ] Disabled buttons have `title` explanation (existing pattern preserved)

### Responsive Breakpoints

- [ ] Desktop (1200px+) — Full category grid, side-by-side where possible
- [ ] Tablet (768px) — Category grid wraps naturally via auto-fit
- [ ] Mobile (480px) — Categories stack to fewer columns, buttons full-width

### Edge Cases

- [ ] Fridge area with 0 occupied slots — capacity bar empty, all gaps shown
- [ ] Fridge area with 0 capacity (corrupted data) — area hidden, no crash
- [ ] Backend returns legacy `fridgeStatus` (no `fridgeAnalysis`) — backward compat renders correctly
- [ ] Backend returns `fridgeAnalysis: []` — empty state message shown
- [ ] Category grid with only 2 categories — grid doesn't look stretched
- [ ] Very long area name — truncated with ellipsis

---

## Appendix: Audit Feedback Resolution

### Resolved Issues (from rev 1 audit)

| # | Finding | Severity | Resolution |
|---|---------|----------|-----------|
| 1 | Frontend assumes `categoryLabels`/`eligibleCategories` from backend, but backend plan doesn't define them in response shape | High | Added explicit contract requirement in Decision 7. The backend plan (section 4.4 step 9) must include `eligibleCategories` per area. Added `LEGACY_CATEGORY_LABELS` fallback for cached/legacy responses. Added section 6.7 documenting the companion update needed. |
| 2 | `fridgeTransfers` rendering not covered — backend returns them as first-class output but frontend plan only covers gaps, candidates, alternatives | High | Added Decision 8 (transfer suggestions UX), `renderTransferSuggestions()` function in section 6.1, transfer wireframe in section 2, transfer CSS in section 4, transfer testing items in section 8, and `executeTransfer()` action handler. |
| 3 | Empty state inconsistent — state map promises "No fridge configured" message but analysis.js falls back to `renderFridgeStatus(null)` which renders nothing | Medium | Added `renderNoFridgeState()` as dedicated empty renderer. Changed analysis.js flow from two-way to explicit four-way branch (section 6.2) covering: multi-area, empty array, legacy fallback, and no-data-at-all states. |
| 4 | `areaIndex` targeting is brittle when areas are hidden (0-capacity) or reordered; backend provides stable `areaId` | Medium | Changed all `data-area-index` to `data-area-id` throughout. Added Decision 9 documenting the rationale. Added `getAreaById()` helper. Updated component diagram, state management, event handling, action handlers, and risk register to use `areaId` consistently. |
