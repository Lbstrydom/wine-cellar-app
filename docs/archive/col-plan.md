# Standardize `color` → `colour` across zone config and cellar logic

## Context

The database column is `wines.colour` (British) but zone config properties and internal functions use American spelling (`zone.color`, `getEffectiveZoneColor()`, `inferColor()`). A fragile bridge at `normalizeWineAttributes()` in `cellarPlacement.js` translates between the two by outputting a `color:` property consumed only by `calculateZoneMatch()` in the same file. This refactor standardizes on British `colour` everywhere, removes the bridge, kills dead `wine.color` fallback code, and adds machine-readable `reasonCode` fields to eliminate brittle string-matching coupling.

---

## Scope

- **22 source files** (config, services, routes)
- **10 test files**
- **2 frontend JS files**
- **2 documentation files** (CLAUDE.md, AGENTS.md)
- **~300+ identifier renames** + 1 structural improvement (reason codes)
- **0 external API clients** — all consumers are in this repo

---

## What gets renamed

### Functions (definition + all imports + all call sites)

| Old name | New name | Defined in |
|---|---|---|
| `getEffectiveZoneColor()` | `getEffectiveZoneColour()` | `src/services/cellar/cellarMetrics.js` |
| `detectColorAdjacencyIssues()` | `detectColourAdjacencyIssues()` | `src/services/cellar/cellarMetrics.js` |
| `getZoneColor()` | `getZoneColour()` | `src/services/zone/rowAllocationSolver.js` (internal) |
| `fixColorBoundaryViolations()` | `fixColourBoundaryViolations()` | `src/services/zone/rowAllocationSolver.js` (internal) |
| `countColorRows()` | `countColourRows()` | `src/services/zone/rowAllocationSolver.js` (internal) |
| `inferColor()` | `inferColour()` | `src/services/cellar/cellarPlacement.js` |
| `getColorForId()` | `getColourForId()` | `tests/unit/services/zone/rowAllocationSolver.test.js` (test helper) |

### Config properties

- **`src/config/cellarZones.js`**: all ~24 `color:` → `colour:` in zone definitions + `sortPreference`
- **`src/config/cellarThresholds.js`**: `SCORING_WEIGHTS.color` → `SCORING_WEIGHTS.colour`

### Report / API fields (backend + frontend atomic rename)

| Old | New | Files |
|---|---|---|
| `report.colorAdjacencyIssues` | `report.colourAdjacencyIssues` | cellarAnalysis.js, zoneReconfigurationPlanner.js, rowAllocationSolver.js |
| `report.summary.colorAdjacencyViolations` | `report.summary.colourAdjacencyViolations` | cellarAnalysis.js, cellarAI.test.js |
| `color1` / `color2` (issue objects) | `colour1` / `colour2` | cellarMetrics.js, zoneReconfigurationPlanner.js, cellarAnalysis.js |
| `'color_adjacency_violation'` (alert type) | `'colour_adjacency_violation'` | cellarAnalysis.js, `public/js/cellarAnalysis/analysis.js`, `public/js/cellarAnalysis/issueDigest.js` |

### Local variables (mechanical rename per file)

`zoneColor` → `zoneColour`, `wineColor` → `wineColour`, `fromColor` → `fromColour`, `toColor` → `toColour`, `bufferColor` → `bufferColour`, `ownerColor` → `ownerColour`, `primaryColor` → `primaryColour`, `colorRange` → `colourRange`, `colorSet` → `colourSet`, `colorCandidates` → `colourCandidates`, `colorFixActions` → `colourFixActions`, `colorActions` → `colourActions`, `colorFixes` → `colourFixes`, `colorSwaps` → `colourSwaps`, `colorAlerts` → `colourAlerts`, `colorBoundaryViolations` → `colourBoundaryViolations`, etc.

### Reason strings → machine reason codes (structural improvement)

**Before:**
```js
// rowAllocationSolver.js
actions.push({ type: 'reallocate_row', reason: 'Fix color boundary: ...' });

// zoneReconfigurationPlanner.js
const isColorFix = action.reason?.includes('color');
```

**After:**
```js
// rowAllocationSolver.js
actions.push({ type: 'reallocate_row', reasonCode: 'fix_colour_boundary', reason: 'Fix colour boundary: ...' });
actions.push({ type: 'reallocate_row', reasonCode: 'fix_colour_adjacency', reason: 'Fix colour adjacency: ...' });

// zoneReconfigurationPlanner.js
const isColourFix = action.reasonCode?.startsWith('fix_colour');
```

This eliminates the brittle string-matching coupling entirely. The human-readable `reason` text can change freely without breaking detection.

---

## Dead code removal

| Location | Before | After |
|---|---|---|
| `cellarPlacement.js` ~L680 (`normalizeWineAttributes`) | `color: wine.colour \|\| wine.color \|\| inferColor(wine)` | `colour: wine.colour \|\| inferColour(wine)` |
| `cellarPlacement.js` ~L475 (`zonesShareColour`) | `wine?.colour \|\| wine?.color` | `wine?.colour` |
| `cellarPlacement.js` ~L626 | `wine?.color \|\| wine?.colour` | `wine?.colour` |
| `cellarPlacement.js` ~L125 (`calculateZoneMatch`) | `wine.color && zoneColors.includes(wine.color...)` | `wine.colour && zoneColours.includes(wine.colour...)` |
| `cellarMetrics.js` ~L322,342 (`wineViolatesZoneColour`) | `wine.colour \|\| wine.color \|\| inferColor(wine)` | `wine.colour \|\| inferColour(wine)` |
| `cellarAnalysis.js` ~L429 | same pattern | remove `wine.color` fallback |
| `bottleScanner.js` ~L224 | same pattern | remove `wine.color` fallback |

---

## What NOT to rename

- CSS `color:` property (W3C standard)
- `themeColor`, `tileColor`, `confidenceColor` (CSS styling variables)
- `prefers-color-scheme` (browser API)
- `theme-color` (HTML meta attribute)
- Grape variety name `colorino` in `cellarZones.js`
- `colourOrder`, `normalizeColours`, `normalizeColour` (already British)

---

## Execution order

### Phase 1 — Config layer
1. `src/config/cellarZones.js` — rename all `color:` → `colour:` in zone definitions + `sortPreference`
2. `src/config/cellarThresholds.js` — `SCORING_WEIGHTS.color` → `SCORING_WEIGHTS.colour`

### Phase 2 — Core definitions
3. `src/services/cellar/cellarMetrics.js` — rename `getEffectiveZoneColor` → `getEffectiveZoneColour`, `detectColorAdjacencyIssues` → `detectColourAdjacencyIssues`, rename `color1`/`color2` → `colour1`/`colour2` in issue objects, update local variables, remove `wine.color` fallbacks
4. `src/services/cellar/cellarPlacement.js` — rename `inferColor` → `inferColour`, refactor `normalizeWineAttributes` bridge (`color:` → `colour:`), remove `wine.color` fallbacks, update `calculateZoneMatch` to use `wine.colour`/`zone.colour`, rename all local variables
5. `src/services/zone/rowAllocationSolver.js` — rename internal functions (`getZoneColor`, `fixColorBoundaryViolations`, `countColorRows`), rename `colorAdjacencyIssues` parameter, add `reasonCode` fields to all colour-related actions, rename reason strings, rename local variables

### Phase 3 — Consumer services
6. `src/services/cellar/cellarAnalysis.js` — update import of `detectColourAdjacencyIssues`, rename report fields (`colorAdjacencyIssues` → `colourAdjacencyIssues`, `colorAdjacencyViolations` → `colourAdjacencyViolations`), rename alert type to `'colour_adjacency_violation'`, remove `wine.color` fallbacks
7. `src/services/zone/zoneReconfigurationPlanner.js` — update import of `getEffectiveZoneColour`, switch from `reason?.includes('color')` to `reasonCode?.startsWith('fix_colour')`, rename `colorAdjacencyIssues` references, rename `color1`/`color2` → `colour1`/`colour2`, rename all local variables
8. `src/services/cellar/cellarAllocation.js` — rename zone colour references
9. `src/services/cellar/bottleScanner.js` — remove `wine.color` fallback, rename local variables
10. `src/services/cellar/cellarNarratives.js` — rename colour references
11. `src/services/cellar/cellarAI.js` — rename colour references
12. `src/services/cellar/movePlanner.js` — rename `zone.color` → `zone.colour`, rename local variables
13. `src/services/cellar/layoutProposer.js` — rename `zone.color` → `zone.colour`
14. `src/services/zone/zoneLayoutProposal.js` — rename colour references
15. `src/services/zone/zoneCapacityAdvisor.js` — rename colour references
16. `src/services/cellar/grapeColourMap.js` — rename if any American spellings remain

### Phase 4 — Routes
17. `src/routes/cellarReconfiguration.js` — update import of `getEffectiveZoneColour`, rename `zoneColor`/`primaryColor`/`effectiveColor`/`colorRange` locals
18. `src/routes/cellar.js` — rename any colour references

### Phase 5 — Frontend
19. `public/js/cellarAnalysis/issueDigest.js` — rename `'color_adjacency_violation'` → `'colour_adjacency_violation'`
20. `public/js/cellarAnalysis/analysis.js` — rename `'color_adjacency_violation'` → `'colour_adjacency_violation'`

### Phase 6 — Cache bust
21. `public/sw.js` — bump `CACHE_VERSION`
22. `public/index.html` — match `?v=` strings

### Phase 7 — Tests
23. `tests/unit/services/cellar/cellarMetrics.test.js` — rename `detectColorAdjacencyIssues` import + call sites + describe blocks
24. `tests/unit/services/zone/rowAllocationSolver.test.js` — rename `getColorForId` helper, `colorAdjacencyIssues` properties, `reason.includes('color')` → check `reasonCode` instead
25. `tests/unit/services/zone/orphanedRowRecoveryE2E.test.js` — rename `colorAdjacencyIssues` in test data
26. `tests/unit/services/cellar/cellarAI.test.js` — rename `colorAdjacencyViolations` in assertions
27. Remaining ~6 test files — mechanical rename of colour references

### Phase 8 — Documentation
28. `CLAUDE.md` — update `getEffectiveZoneColor()` → `getEffectiveZoneColour()` in zone reconfiguration docs and all other references
29. `AGENTS.md` — same updates

---

## Key risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Reason string coupling** (solver ↔ planner) | High | Eliminated: `reasonCode` field replaces brittle `includes()` text matching |
| **Frontend / backend alert type mismatch** | High | Single atomic PR touches both backend and frontend together |
| **Stale fixtures / snapshots** | Low | Audited — test fixtures directory has no `"color"` key literals |
| **SW cache serving stale frontend** | Medium | Cache version bump is mandatory step (Phase 6) |
| **Missed rename** | Medium | Final grep verification + test suite catch mismatches |
| **`colorino` grape false positive** | Low | Explicitly excluded; verified by final grep check |

---

## Verification checklist

### 1. Automated tests
```bash
npm run test:unit    # catches function/property mismatches
npm run test:all     # includes integration tests
```

### 2. Grep for straggling American-spelled identifiers
```bash
# Function names (should return 0 hits outside docs/col-plan.md)
grep -rn "getEffectiveZoneColor\|detectColorAdjacencyIssues\|inferColor[^i]\|getZoneColor\|fixColorBoundary\|countColorRows" src/ public/ tests/

# Config keys
grep -rn "SCORING_WEIGHTS\.color\b" src/

# Alert type string
grep -rn "'color_adjacency_violation'" src/ public/

# Old reason string matching
grep -rn "reason.*includes.*'color" src/ tests/

# Zone/wine property (excluding CSS/comments/this doc)
grep -rn "zone\.color\b" src/ tests/ --include="*.js"
grep -rn "wine\.color\b" src/ tests/ --include="*.js"
```

### 3. Verify structural improvements
```bash
# reasonCode field exists in solver
grep -rn "reasonCode" src/services/zone/rowAllocationSolver.js

# Planner uses reasonCode, not string matching
grep -rn "reasonCode" src/services/zone/zoneReconfigurationPlanner.js

# Cache version was bumped
grep "CACHE_VERSION" public/sw.js
```

### 4. Confirm exclusions
```bash
# colorino grape name was NOT renamed
grep -n "colorino" src/config/cellarZones.js

# Already-British names untouched
grep -rn "colourOrder\|normalizeColours\|normalizeColour" src/
```

---

## Changes from v1

| Item | v1 | v2 |
|---|---|---|
| API compatibility shim | Not addressed | Not needed (confirmed all consumers in repo) |
| Reason string coupling | Relied on lockstep rename | Structural fix: `reasonCode` field added |
| SW cache bust | Not in plan | Mandatory step (Phase 6) |
| Fixture/snapshot audit | Not in plan | Audited — clean |
| Ingress normalization | Not addressed | Not needed (single internal bridge removed) |
| Execution phases | Flat list | Ordered into 8 phases |
| Verification | Basic grep | Expanded: automated tests + targeted greps + structural checks + exclusion confirmations |
