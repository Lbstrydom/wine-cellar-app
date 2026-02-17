# Fix: Grape Data Quality + Bottles-First Analysis

## Context

The cellar layout is badly broken (screenshots confirm: Shiraz in Aromatic Whites, Chardonnay labelled as Aromatic, empty rows held by zones with 0-1 bottles, Sauvignon Blancs scattered across 3 different zone rows). The root cause is **missing grape data**: the `grapes` column exists in the DB but is **never written during wine add**. The INSERT in `wines.js` has 20 columns — `grapes` is not one of them. The Zod schema strips it. Vivino's `grapeVariety` is available but only mapped to the `style` field.

Without grapes, `findBestZone()` loses its strongest signal (35 of ~145 possible points). Wines like "Castillo de Aresan", "Quoin Rock Red Blend", "Boschendal Black Angus" get zero grape signal → land in wrong zones or Unclassified.

**This plan has two parts:**
- **Part A** — Fix data quality (persist grapes, backfill existing wines, auto re-classify)
- **Part B** — Bottles-first analysis improvements (now viable with clean data)

---

## Progress Tracker

| Phase | Description | Status |
|-------|-------------|--------|
| **A1** | Persist grapes on new wine add | DONE |
| A1.1 | Add `grapes` to Zod schemas | DONE |
| A1.2 | Add `grapes` to INSERT in POST /api/wines | DONE |
| A1.3 | Add `grapes` to UPDATE in PUT /api/wines/:id | DONE |
| A1.4 | Map grapeVariety→grapes in frontend form submissions | DONE |
| A1.5 | Create unified grape enrichment service | DONE |
| A1.6 | Auto-detect grapes on add when no Vivino data | DONE |
| A1.7 | Wire enrichment into normalizeWineAttributes() fallback | DONE |
| A1.8 | Tests (31 new + existing updated) | DONE |
| **A2** | Backfill existing wines + auto re-classify | DONE |
| A2.1 | Backfill API endpoint | DONE |
| A2.2 | Auto re-classify zone_id when grapes updated | DONE |
| A2.3 | Grapes field in bottle edit form | DONE |
| A2.4 | Frontend: grape health banner in analysis panel | DONE |
| A2.5 | Tests (11 new) | DONE |
| A2.6 | Audit review: blocker fix (findBestZone shape, updateZoneWineCount signature), wineIds validation, dead variable cleanup | DONE |
| **B1** | scanBottles() — bottles-first grouping | TODO |
| **B2** | Minimum-row threshold | TODO |
| **B3** | Row cleanliness sweep | TODO |
| **B4** | Zone consolidation | TODO |
| **B5** | AI polish scope reduction | TODO |

---

## Part A: Fix Data Quality

### Phase A1: Persist grapes on new wine add

**A1.1 — Add `grapes` to Zod schemas**
- **File**: `src/schemas/wine.js`
- Add `grapes: z.string().max(500).optional().nullable()` to `createWineSchema`
- `updateWineSchema` inherits it automatically (extends create)

**A1.2 — Add `grapes` to INSERT in POST /api/wines**
- **File**: `src/routes/wines.js` (POST handler, lines 388-406)
- Destructure `grapes` from `req.body` at line 351
- Add as 21st column in INSERT + parameter
- Remove `captureGrapes` middleware (lines 30-38) — no longer needed since `grapes` passes schema

**A1.3 — Add `grapes` to UPDATE in PUT /api/wines/:id**
- **File**: `src/routes/wines.js` (PUT handler, lines 461-553)
- Add `addUpdate('grapes', grapes || null)` alongside other field updates

**A1.4 — Map grapeVariety→grapes in frontend form submissions**
- **File**: `public/js/bottles/form.js`
- In `saveWineWithConfirmation()` (line 220): add `grapes: confirmedWine.grapeVariety || null`
- In `saveWineWithExternalMatch()` (line 264): add `grapes: match.grape_variety || match.grapeVariety || null`
- Keep existing `style` fallback mapping too (backward compat)

**A1.5 — Create unified grape enrichment service**
- **New file**: `src/services/wine/grapeEnrichment.js`
- Merges two disconnected implementations:
  - `extractGrapesFromText()` in `cellarPlacement.js:741` (31 patterns, used in production)
  - `detectGrape()` in `grapeDetection.js` (20 regex patterns, unused)
- Adds appellation→grape mappings: `barolo/barbaresco → nebbiolo`, `chianti/brunello → sangiovese`, `sancerre/pouilly-fumé → sauvignon blanc`, `vouvray/savennières → chenin blanc`, `chablis/meursault/montrachet → chardonnay`
- Returns: `{ grapes: string|null, confidence: 'high'|'medium'|'low', source: 'name'|'appellation'|'region' }`
- Exports: `detectGrapesFromWine(wine)` and `batchDetectGrapes(wines)`

**A1.6 — Auto-detect grapes on add when no Vivino data**
- **File**: `src/routes/wines.js` (POST handler, after INSERT)
- If `grapes` is still null after insert, run `detectGrapesFromWine()` and UPDATE if detected

**A1.7 — Wire enrichment into `normalizeWineAttributes()` fallback**
- **File**: `src/services/cellar/cellarPlacement.js` (line 600)
- Use `detectGrapesFromWine()` as primary fallback, keep `extractGrapesFromText()` as final fallback
- This immediately improves `findBestZone()` accuracy for all existing code paths

**A1.8 — Tests**
- New: `tests/unit/services/wine/grapeEnrichment.test.js` — name detection, appellation proxy, multi-grape, no-signal cases
- Update: `tests/unit/services/cellar/cellarPlacement.test.js` — `findBestZone()` scores higher with populated grapes

---

### Phase A2: Backfill existing wines + auto re-classify

**A2.1 — Backfill API endpoint**
- **File**: `src/routes/cellar.js` (new endpoint after line 408)
- `POST /api/cellar/grape-backfill` with `{ commit: boolean, wineIds?: number[] }`
- `commit: false` (default) = dry-run, returns suggestions
- `commit: true` = writes grapes + re-classifies zone_id + invalidates analysis cache
- Query: `SELECT * FROM wines WHERE cellar_id = $1 AND (grapes IS NULL OR grapes = '')`
- Uses `batchDetectGrapes()` from A1.5

**A2.2 — Auto re-classify zone_id when grapes updated**
- **File**: `src/routes/cellar.js` — modify `POST /api/cellar/update-wine-attributes` (lines 398-407)
- Currently calls `findBestZone()` but only returns suggestion — does NOT persist
- Add: when new zone differs and confidence ≠ 'low', persist zone_id + update zone counts + invalidate cache
- Reuse existing `updateZoneWineCount()` (already imported) and `invalidateAnalysisCache()`

**A2.3 — Grapes field in bottle edit form**
- **File**: `public/index.html` — add text input `<input id="wine-grapes">` in bottle form
- **File**: `public/js/bottles/form.js` — add `grapes` to `collectWineFormData()` (line 61-74)
- Pre-populate from wine data when editing

**A2.4 — Frontend: grape health banner in analysis panel**
- **File**: New `public/js/cellarAnalysis/grapeHealth.js`
- Shows "N wines have no grape data" count with "Detect Grapes" button
- Dry-run → preview table (wine name | detected grapes | confidence)
- "Apply All" / per-row "Apply" → commits via backfill endpoint
- Wire into `analysis.js` render flow

**A2.5 — Tests**
- New: `tests/unit/routes/cellar.grapeBackfill.test.js` — dry-run, commit mode, zone re-classification, cache invalidation

---

## Part B: Bottles-First Analysis

### Phase B1: `scanBottles()` — bottles-first grouping

**New file**: `src/services/cellar/bottleScanner.js`

**Function**: `scanBottles(wines, zoneMap)`
- Iterates ALL wines (not rows), calls `findBestZone()` on each
- Groups by canonical zone, then cross-references against physical row allocations
- Returns:
  ```
  { groups: [{ zoneId, displayName, wines[], bottleCount,
               physicalRows, allocatedRows, correctlyPlacedCount,
               misplacedCount, demandRows, rowDeficit }],
    consolidationOpportunities: [{ zoneId, totalBottles, scattered[] }],
    totalBottles, totalGroups }
  ```
- Reuse: `findBestZone()` from `cellarPlacement.js`, `parseSlot()` from `cellarMetrics.js`

**Integration into analysis orchestrator**:
- **File**: `src/services/cellar/cellarAnalysis.js` (after line 93)
- Call `scanBottles(wines, zoneMap)` and attach to `report.bottleScan`
- Additive — existing row-first analysis continues alongside

---

### Phase B2: Minimum-row threshold

**File**: `src/services/zone/rowAllocationSolver.js`

- Add `export const MIN_BOTTLES_FOR_ROW = 5` (configurable constant)
- Modify `computeDemand()` (line 179): `bottles >= MIN_BOTTLES_FOR_ROW ? Math.ceil(bottles/9) : 0`
- Effect: Portugal (1 bottle) no longer consumes an entire row
- Align merge threshold in `findMergeActions()` (line 854) with same constant

**File**: `src/services/zone/zoneLayoutProposal.js`
- Add threshold filter in `proposeZoneLayout()` — under-threshold zones skip row allocation
- Collect under-threshold zones with reason text for frontend display

**Tests**: Zone with 1/4/5/10 bottles → demand = 0/0/1/2

---

### Phase B3: Row cleanliness sweep

**File**: `src/services/cellar/bottleScanner.js` (new function)

**Function**: `rowCleanlinessSweep(slotToWine, zoneMap)`
- Iterates every occupied slot in every allocated row
- Calls `findBestZone()` and compares to the row's assigned zone
- Severity grading:
  - `critical`: colour family violation (red in white zone or vice versa)
  - `moderate`: same colour but best zone scores 40+ points higher
- Returns violations sorted by severity then score delta

**Integration**: Added to analysis report as `report.cleanlinessViolations` (in Phase B1 integration code)

**Distinction from existing**: `analyseZone()` in `cellarMetrics.js` already catches misplacements wine-by-wine. The sweep adds batch severity grading and score-delta quantification for priority-driven UI.

**Tests**: Shiraz in aromatic whites → critical, Sauvignon Blanc in chenin row → moderate, correctly placed wine → not flagged

---

### Phase B4: Zone consolidation

**Leverages B1 output**: `consolidationOpportunities` from `scanBottles()` identifies wines that canonically belong to a zone but are physically in other zones.

**Frontend rendering**:
- **File**: `public/js/cellarAnalysis/analysis.js` (or new sub-module)
- Render consolidation cards: "3 Shiraz bottles are in Red Buffer but should be in Shiraz zone"
- "Consolidate" button generates move suggestions via existing `generateMoveSuggestions()` infra

**Backend enhancement**: In `rowAllocationSolver.js`, pass bottles-first utilization into `computeDemand()` as an alternative input — represents "how many rows if every wine were correct" vs "how many rows currently occupied". This gives the solver an ideal-state target.

---

### Phase B5: AI polish scope reduction

**File**: `src/services/cellar/cellarAI.js` — `buildCellarAdvicePrompt()`

Modify the AI prompt to:
1. Receive `report.bottleScan.groups` (pre-classified groupings) — AI doesn't reclassify
2. Receive `report.cleanlinessViolations` (pre-prioritized) — AI confirms, doesn't discover
3. Only review wines with `confidence: 'low'` or `'medium'` from the bottles-first scan
4. Produce explanations for edge cases, not re-classifications

**Effect**: AI token costs down, algorithmic classification authoritative, AI focuses on genuine ambiguity (blends spanning zones, unusual varietals, regional exceptions).

---

## Phase C: Critical Review — How Part B Improves With Clean Data

| Part B Feature | Without Grapes (before Part A) | With Grapes (after Part A) |
|---|---|---|
| **`scanBottles()` grouping** | Many wines → "unclassified" or wrong zone; groups unreliable | Accurate varietal groups; "unclassified" shrinks dramatically |
| **Minimum-row threshold** | Threshold acts on inaccurate zone counts (wines in wrong zone inflate some, deflate others) | Correct zone counts → threshold accurately reflects real demand |
| **Row cleanliness sweep** | Shiraz with no grape in name might not be detected as wrong | Shiraz with `grapes: "Shiraz"` → instant critical violation flag |
| **Zone consolidation** | Consolidation suggestions based on flawed classification | Consolidation based on correct varietal identity |
| **AI polish** | AI spends tokens doing basic varietal classification | AI focuses on genuine edge cases only |

**Recommendation**: Implement Part A first, then Part B. The code for Part B has no compile-time dependency on Part A, but its **output quality** is gated on Part A's data being present. Part B on dirty data would produce unreliable bottles-first groupings.

---

## Execution Order

```
A1 (persist grapes on add) ──────── Session 1
A2 (backfill + re-classify) ─────── Session 2
B1 (scanBottles) ────────────────── Session 3
B2 (minimum-row threshold) ──┐
B3 (row cleanliness sweep) ──┼──── Session 3-4
B4 (zone consolidation) ─────┘
B5 (AI polish scope) ───────────── Session 4
```

## Verification

1. **After A1**: Add a wine with Vivino match → verify `grapes` column populated in DB
2. **After A1**: Add wine without Vivino match (grape in name) → verify auto-detection writes grapes
3. **After A2**: Run backfill dry-run → verify suggestions for wines with null grapes
4. **After A2**: Run backfill commit → verify grapes populated + zone_id reclassified + cache invalidated
5. **After B1**: Run analysis → verify `report.bottleScan` has accurate groups
6. **After B2**: Verify zones with <5 bottles get demand=0 in solver
7. **After B3**: Verify Shiraz in Aromatic Whites flagged as critical violation
8. `npm run test:unit` after each phase, `npm run test:all` before commit
9. Bump `ANALYSIS_LOGIC_VERSION` 5→6 in `cacheService.js`, `CACHE_VERSION` in `sw.js`, cache busters in `index.html`

## Key Files

| File | Phases | Changes |
|------|--------|---------|
| `src/schemas/wine.js` | A1 | Add `grapes` to createWineSchema |
| `src/routes/wines.js` | A1 | Add `grapes` to INSERT + UPDATE, auto-detect fallback |
| `public/js/bottles/form.js` | A1, A2 | Map grapeVariety→grapes, add grapes to collectWineFormData |
| `public/index.html` | A2 | Add grapes input to bottle form |
| `src/services/wine/grapeEnrichment.js` | A1 | **New** — unified grape detection service |
| `src/services/cellar/cellarPlacement.js` | A1 | Wire grapeEnrichment into normalizeWineAttributes fallback |
| `src/routes/cellar.js` | A2 | Backfill endpoint + auto zone re-classify on attribute update |
| `public/js/cellarAnalysis/grapeHealth.js` | A2 | **New** — grape health banner UI |
| `src/services/cellar/bottleScanner.js` | B1, B3 | **New** — scanBottles + rowCleanlinessSweep |
| `src/services/cellar/cellarAnalysis.js` | B1 | Integrate bottleScan into analysis report |
| `src/services/zone/rowAllocationSolver.js` | B2 | MIN_BOTTLES_FOR_ROW threshold in computeDemand |
| `src/services/zone/zoneLayoutProposal.js` | B2 | Under-threshold zone handling in proposeZoneLayout |
| `src/services/cellar/cellarAI.js` | B5 | Reduce AI scope to edge cases only |
