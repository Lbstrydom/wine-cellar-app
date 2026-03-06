# Code Audit: Dynamic Fridge Stocking (Frontend)

**Plan**: `docs/plans/dynamic-fridge-stocking-frontend.md` (rev 2)
**Plan type**: Frontend
**Audit date**: 2026-03-06
**Auditor**: Copilot (Claude Opus 4.6)

---

## Summary

The frontend implementation closely follows the plan's architecture: multi-area rendering, dynamic category grids, transfer suggestions, per-area scoped actions, backward compatibility, and the four-way branch in `analysis.js` are all implemented correctly. The main file (`fridge.js`) exceeds the 500-line guideline, two functions exceed 50 lines, and the transfer suggestions section renders after all areas rather than between them as the wireframe specified.

| Severity | Count |
|----------|-------|
| HIGH | 0 |
| MEDIUM | 3 |
| LOW | 4 |

---

## Findings

### MEDIUM Severity

#### [M1] Transfer suggestions render after all areas, not between them

**Plan reference**: Section 2 wireframe (stacked layout), Decision 8
**File**: `public/js/cellarAnalysis/fridge.js` lines 74-86

The plan explicitly states:
> "Transfer section placement: Between the area sections, not inside either area."

The wireframe shows:
```
Wine Fridge section
Transfer Suggestions (between)
Kitchen Fridge section
```

**Actual implementation**: `renderFridgeAreas()` loops all areas first, then appends transfer suggestions after all area sections:

```javascript
for (const areaData of validAreas) {
  html += /* area section */;
}
if (transfers.length > 0) {
  html += buildTransferSuggestionsHtml(transfers);  // After ALL areas
}
```

**Impact**: Users see both fridge sections stacked before seeing transfer corrections. Since transfers fix misplacements between areas, placing them between the affected areas would create a more logical reading flow. Functionally correct but UX differs from spec.

**Recommendation**: Insert transfers between the wine fridge and kitchen fridge sections. This requires sorting `validAreas` (wine_fridge first) and inserting transfer HTML after the first area section.

---

#### [M2] `fridge.js` exceeds 500-line file size guideline

**File**: `public/js/cellarAnalysis/fridge.js` — 929 lines
**Principle**: CLAUDE.md "Let files grow beyond ~500 lines without splitting by responsibility"

The file contains:
- Multi-area rendering (~100 lines)
- HTML building helpers (~200 lines)
- Event wiring (~30 lines)
- Backward compat wrapper (~15 lines)
- 5 action handlers (move, swap, alt, transfer, organize — ~250 lines)
- Organize fridge execution helpers (~75 lines)
- Pure computation helpers (~60 lines)
- AI annotation rendering (~80 lines)

**Recommendation**: Extract the organize-fridge panel logic (`handleOrganizeFridge`, `renderFridgeSummary`, `executeFridgeOrganizeMove`, `executeAllFridgeOrganizeMoves` — ~100 lines) into a `fridgeOrganize.js` module. This is the most self-contained grouping.

---

#### [M3] Two functions exceed the 50-line guideline

**File**: `public/js/cellarAnalysis/fridge.js`
**Principle**: CLAUDE.md "Keep functions under 50 lines where practical"

| Function | Lines | Span |
|----------|-------|------|
| `buildCandidatesHtml()` | 75 | L276–L351 |
| `handleOrganizeFridge()` | 83 | L601–L684 |

`buildCandidatesHtml` handles two distinct rendering paths (fridge full → swap mode vs. has empty slots → add mode) plus alternatives. Each path is ~35 lines.

`handleOrganizeFridge` handles toggle logic, API call, result rendering, and event wiring — four distinct responsibilities.

**Recommendation**: Split `buildCandidatesHtml` into `buildSwapCandidateHtml` and `buildAddCandidateHtml`. Extract the organize result rendering from `handleOrganizeFridge` into a `renderOrganizeResult(panel, result)` helper.

---

### LOW Severity

#### [L1] No ARIA attributes on dynamic fridge content

**File**: `public/js/cellarAnalysis/fridge.js`
**Plan reference**: Section 8 "Accessibility Testing" — screen reader reads "Wine Fridge, 18 of 24 slots occupied"

No `aria-label`, `role`, or `aria-live` attributes are present in the dynamically generated HTML. The plan's testing checklist specifies screen reader support (area headings, button explanations), but no ARIA attributes were implemented.

**Impact**: Screen readers will not convey fridge area context (type, capacity) when navigating dynamically rendered sections. Not a functional issue but reduces accessibility compliance.

**Recommendation**: Add `aria-label` to area wrapper divs (e.g., `aria-label="Wine Fridge, 18 of 24 slots occupied"`), `role="region"` to each `.fridge-area`, and `aria-live="polite"` to the `#fridge-status-content` container.

---

#### [L2] Vintage values not HTML-escaped in template literals

**File**: `public/js/cellarAnalysis/fridge.js` lines 294, 317, 331, 362, 646

`c.vintage || ''` is interpolated directly into HTML without `escapeHtml()`, while `c.wineName` is always escaped. Vintage is a numeric year from the database, so XSS risk is negligible, but the inconsistency could become a problem if the data shape changes.

**Recommendation**: Wrap in `escapeHtml(String(c.vintage || ''))` for consistency with `wineName` treatment.

---

#### [L3] No responsive media queries for fridge-specific classes

**File**: `public/css/components.css`
**Plan reference**: Section 8 "Responsive Breakpoints" checklist

No `@media` queries target fridge classes. The `auto-fit` grid provides basic responsiveness, but the plan's testing checklist lists three breakpoints (desktop, tablet, mobile) for explicit testing.

**Impact**: On very narrow screens (< 360px), category cells with long labels may compress awkwardly. The plan explicitly defers "Mobile-optimized fridge layout" (section 7, "Deliberately Deferred #4"), so this is acknowledged.

**Recommendation**: No action needed now (deferred by design). Consider adding `@media (max-width: 480px)` rules if mobile fridge usage grows.

---

#### [L4] `KITCHEN_FRIDGE_NOTE` uses a non-breaking en-dash but is not internationalization-ready

**File**: `public/js/cellarAnalysis/fridge.js` line 34

The kitchen fridge note is a hardcoded English string. This is consistent with the rest of the app (no i18n), but the plan's Decision 5 suggests this should be a "neutral info note" — the current implementation matches this intent.

**Impact**: None — the entire app is English-only. Flagging for completeness.

---

## Plan Compliance Summary

| Planned Item | Status | Notes |
|-------------|--------|-------|
| 6.1 MODIFY `fridge.js` — `renderFridgeAreas()` | Implemented | Matches plan; transfer placement differs (M1) |
| 6.1 MODIFY `fridge.js` — `renderFridgeArea()` | Implemented | Split into `buildAreaHeaderHtml` + `buildAreaBodyHtml` (acceptable decomposition) |
| 6.1 MODIFY `fridge.js` — `renderFridgeStatus()` (backward compat) | Implemented | Thin wrapper delegating to `renderFridgeAreas([fridgeStatus], [])` |
| 6.1 MODIFY `fridge.js` — `renderNoFridgeState()` | Implemented | Shows empty state message |
| 6.1 MODIFY `fridge.js` — `buildCategoryGridHtml()` | Implemented | Dynamic from `eligibleCategories`, LEGACY fallback present |
| 6.1 MODIFY `fridge.js` — `buildAreaHeaderHtml()` | Implemented | Type badge + temp context |
| 6.1 MODIFY `fridge.js` — `renderTransferSuggestions()` | Implemented | Named `buildTransferSuggestionsHtml()` (returns string, not void) |
| 6.1 MODIFY `fridge.js` — `executeTransfer()` | Implemented | Finds empty slot in target area, executes move |
| 6.1 MODIFY `fridge.js` — `LEGACY_CATEGORY_LABELS` | Implemented | Includes `dessertFortified` (8 entries, not 7) |
| 6.1 MODIFY `fridge.js` — action handlers gain `areaId` param | Implemented | All handlers use `getAreaById(areaId)` |
| 6.1 MODIFY `fridge.js` — `getAreaById()` helper | Implemented | Uses `String()` coercion for safe comparison |
| 6.1 MODIFY `fridge.js` — `renderAIFridgeAnnotations()` multi-area | Implemented | Iterates `fridgeAnalysis[]` with `fridgeStatus` fallback |
| 6.2 MODIFY `analysis.js` — four-way branch | Implemented | Exact match with plan spec (section 6.2) |
| 6.2 MODIFY `analysis.js` — import updates | Implemented | `renderFridgeAreas`, `renderNoFridgeState` imported |
| 6.3 MODIFY `components.css` — new classes | Implemented | All 13 planned classes present |
| 6.3 MODIFY `components.css` — `fridge-mix-grid` auto-fit | Implemented | `repeat(auto-fit, minmax(80px, 1fr))` |
| 6.4 MODIFY `index.html` — no structural changes | Compliant | Container unchanged |
| 6.5 MODIFY `grid.js` — `getFridgeRows()` multi-area | Implemented | Filters both `wine_fridge` and `kitchen_fridge` |
| 6.6 NO CHANGE `state.js` | Compliant | No modifications |
| 6.7 Backend companion update — `eligibleCategories` | Implemented | `fridgeStocking.js` returns metadata per area |
| 6.7 Backend companion update — `fridgeTransfers` top-level | Implemented | `cellarAnalysis.js` attaches to report |

## Wiring Verification

| Frontend Call/Access | Backend Field | Status | Notes |
|---------------------|--------------|--------|-------|
| `analysis.fridgeAnalysis` | `report.fridgeAnalysis` | Wired | Array of per-area objects |
| `analysis.fridgeTransfers` | `report.fridgeTransfers` | Wired | Top-level, conditional |
| `analysis.fridgeStatus` | `report.fridgeStatus` | Wired | Backward compat alias (first area) |
| `areaData.eligibleCategories` | `result.eligibleCategories` | Wired | Object with label/priority/description |
| `areaData.fridgeType` | `result.fridgeType` | Wired | `'wine_fridge'` or `'kitchen_fridge'` |
| `areaData.areaId` | `result.areaId` | Wired | Stable storage area ID |
| `areaData.areaName` | `result.areaName` | Wired | Area display name |
| `areaData.currentMix` | `result.currentMix` | Wired | Category counts |
| `areaData.parLevelGaps` | `result.parLevelGaps` | Wired | Gap objects with `need`, `priority`, `description` |
| `areaData.candidates` | `result.candidates` | Wired | Candidate array |
| `areaData.alternatives` | `result.alternatives` | Wired | `{ [category]: [...] }` |
| `areaData.wines` | `result.wines` | Wired | Current fridge wines |
| `areaData.allSlots` | `result.allSlots` | Wired | All slot IDs for area |
| `areaData.emptySlots` | `result.emptySlots` | Wired | Empty slot count |
| `areaData.capacity` | `result.capacity` | Wired | Total capacity |
| `areaData.occupied` | `result.occupied` | Wired | Occupied count |
| `executeCellarMoves()` | `POST /api/cellar/execute-moves` | Wired | Via `api/cellar.js` |
| `getFridgeOrganization(areaId)` | `GET /api/cellar/fridge-organize?areaId=` | Wired | Via `api/cellar.js` |

## Event Wiring Verification

| UI Element | Event | Handler | Status |
|-----------|-------|---------|--------|
| `.fridge-add-btn` | click | `moveFridgeCandidate(index, areaId)` | Wired via `wireAreaEvents()` |
| `.fridge-swap-btn` | click | `swapFridgeCandidate(index, areaId)` | Wired via `wireAreaEvents()` |
| `.fridge-alt-btn` | click | `moveAlternativeCandidate(cat, idx, areaId)` | Wired via `wireAreaEvents()` |
| `.organize-fridge-btn` | click | `handleOrganizeFridge(areaId)` | Wired via `wireAreaEvents()` |
| `.fridge-transfer-btn` | click | `executeTransfer(transferIndex)` | Wired in `renderFridgeAreas()` |
| `.fridge-move-btn` | click | `executeFridgeOrganizeMove(idx, panel)` | Wired in `handleOrganizeFridge()` |
| `.execute-all-fridge-moves-btn` | click | `executeAllFridgeOrganizeMoves(panel)` | Wired in `handleOrganizeFridge()` |
| `.close-organize-btn` | click | `panel.style.display = 'none'` | Wired in `handleOrganizeFridge()` |

## State Map Verification

| State | Plan Status | Implementation Status |
|-------|------------|----------------------|
| No fridge configured (`fridgeAnalysis: []`) | Planned | `renderNoFridgeState()` — shows message |
| Single wine fridge | Planned | `renderFridgeAreas([area], [])` — minimal UI change |
| Single kitchen fridge | Planned | Reduced grid + info note |
| Both fridge types | Planned | Stacked sections with `.fridge-areas--multi` border |
| Both types + misplaced wines | Planned | Transfer section appended (placement differs from wireframe) |
| Fridge full, has gaps | Planned | Swap mode rendering |
| No cellar wines match | Planned | All-zero mix grid rendered |
| 0-capacity area | Planned | Filtered out in line 69 |
| Legacy response | Planned | `renderFridgeStatus()` wrapper path |
| `fridgeAnalysis` undefined, no `fridgeStatus` | Planned | Fourth branch → `renderNoFridgeState()` |

## Frontend Principle Audit

| Principle | Status | Notes |
|-----------|--------|-------|
| CSP compliance (no inline handlers) | Pass | All events wired in JS, no `onclick`/`onchange` in HTML strings |
| API auth headers | Pass | Uses `executeCellarMoves()` and `getFridgeOrganization()` from `api/` module |
| No raw `fetch()` | Pass | All API calls through `api/` barrel |
| XSS prevention | Pass | `escapeHtml()` on all user-provided strings; vintage is numeric (L2 is cosmetic) |
| User feedback | Pass | `showToast()` on all action success/failure |
| Error handling | Pass | try/catch on all async handlers with toast error feedback |
| Event cleanup | Pass | Events wired after innerHTML replacement; no accumulating listeners |
| CSS variables | Pass | All semantic colors use CSS variables with fallbacks |
| Single source of truth | Pass | Category labels from backend `eligibleCategories`; `LEGACY_CATEGORY_LABELS` only for fallback |
| Backward compatibility | Pass | `renderFridgeStatus()` wraps `renderFridgeAreas()`; AI annotations handle both paths |
| `data-area-id` targeting | Pass | All action buttons use stable `areaId`, not array index |
| Progressive disclosure | Pass | Kitchen fridge hides ineligible categories; info note explains why |
| SW `STATIC_ASSETS` | N/A | `fridge.js` is an existing file (already in SW), not new |

---

## Recommendations

### Should Fix (before next release)

1. **[M1]** Move transfer suggestions between area sections (after wine fridge, before kitchen fridge) to match the plan's wireframe and improve reading flow
2. **[M2]** Extract organize-fridge logic (~100 lines) into `fridgeOrganize.js` to bring `fridge.js` closer to 500-line guideline
3. **[M3]** Split `buildCandidatesHtml` (75 lines) and extract organize-result rendering from `handleOrganizeFridge` (83 lines)

### Nice to Have

4. **[L1]** Add ARIA attributes (`role="region"`, `aria-label`) to fridge area sections for screen reader support
5. **[L2]** Wrap `vintage` values in `escapeHtml()` for consistency
6. **[L3]** No action (deferred by design in plan section 7)
7. **[L4]** No action (no i18n in app)
