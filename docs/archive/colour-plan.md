# Plan: Wine Data Consistency Checker

## Context

A Kleine Zalze wine with Shiraz grape was found marked as `colour: 'white'` — an obvious data error. There is no validation catching grape-colour mismatches on entry or post-hoc. This plan adds a consistency system informed by industry best practices (OIV, WSET, Vivino, CellarTracker, Wine-Searcher, Decanter) and addresses all reviewer findings from two review rounds.

**Industry consensus**: No major wine platform uses blocking validation for grape-colour. All use advisory patterns. WSET treats colour (red/white/rosé) and method (still/sparkling/fortified) as separate dimensions but consumer apps flatten them into 6-7 categories. Our current 6-value enum matches Vivino; adding `orange` matches the broadest industry consensus (7 values, matching Wine-Searcher/Decanter trend).

## Round 1 Reviewer Findings Addressed

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | High | No write-path enforcement | Add server-side advisory hook to POST/PUT wines + acquisition save |
| 2 | High | Normalization underspecified | Create central `normalizeColour()` + `normalizeGrape()` utilities with synonym map |
| 3 | High | Validation coupled to zone config | Freeze grape-colour rules as explicit standalone config, seeded from zones but independent |
| 4 | Medium | Sparkling exemption too narrow | Bypass check for sparkling/dessert/fortified colours AND when keywords indicate these methods |
| 5 | Medium | Rosé rule too simplistic | Allow any grape in rosé (red, white, or mixed blends). No warning for rosé. |
| 6 | Medium | Unknown grapes under-signaled | Add warning when ALL parsed grapes are unknown; include count in summary |
| 7 | Medium | Parser too weak | Robust tokenizer handling `/`, `&`, `%`, object arrays; reuse `parseJsonArray` pattern |
| 8 | Low | API pagination missing | Add `limit`, `offset`, `severity` params to audit endpoint |
| 9 | Low | SQL placeholder style | Use `?` consistently (DB adapter auto-converts to `$1`) |

## Round 2 Reviewer Findings Addressed

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 10 | High | POST response shape `{ id, message }` would break if changed to `{ data: { id } }` | **Integrate**: preserve existing shape, add `warnings` as sibling field only |
| 11 | High | Checker must be fail-open — if it throws after INSERT, asyncHandler returns 500 on committed data | **Integrate**: wrap all checker calls in try/catch, default to empty warnings on failure |
| 12 | High | Acquisition INSERT lacks `RETURNING id` — `lastInsertRowid` is null in PostgreSQL | **Integrate**: fix pre-existing bug by adding `RETURNING id` to acquisition INSERT and switch to `.get()` |
| 13 | Medium | Orange colour incomplete without UI/styling updates (forms, filters, color chips, accessibility) | **Acknowledge, defer**: backend-only in this phase. Note UI follow-up needed. |
| 14 | Medium | Base schema files need parity update (schema.postgres.sql, schema.sqlite.sql) | **Integrate**: update both base schema CHECK constraints alongside migration |
| 15 | Medium | `Object.freeze()` on Map doesn't prevent `.set()/.delete()` | **Integrate**: keep Map module-private, only export getter functions. No raw Map exposed. |
| 16 | Low | `findException` referenced in tests but unclear in exports | **Integrate**: explicitly listed in exports of grapeColourMap.js |
| 17 | Low | New routes should include Zod schemas for query/params | **Integrate**: add validation schemas for audit query params and check/:id param |

## Files to Create (4 new files)

### 1. `src/config/grapeColourMap.js` — Standalone grape-colour rules

**Decoupled from zones** (addresses R1-#3). Seeded from `CELLAR_ZONES` at build time but stored as explicit frozen rules that don't change if zone layout changes.

**Module-private Map** (addresses R2-#15): The `Map<string, Set<string>>` is NOT exported directly. `Object.freeze()` on a Map doesn't prevent `.set()`/`.delete()`, so the Map stays private and is only accessible through getter functions.

Exports:
- `getExpectedColours(grape)` — Returns `Set<string>` of valid colours for a grape (resolves synonyms first), or null if unknown
- `getCanonicalGrape(grape)` — Returns canonical form via synonym map
- `getGrapeCount()` — Returns number of grapes in the map (for test assertions)
- `findException(wineName, style)` — Checks wine name/style against known exception patterns (R2-#16: explicitly exported)
- `GRAPE_SYNONYMS` — `Map<string, string>` mapping aliases to canonical names (~50 pairs: Shiraz→Syrah, Pinot Grigio→Pinot Gris, Garnacha→Grenache, Tinta Roriz→Tempranillo, Primitivo→Zinfandel, Monastrell→Mourvèdre, etc.)
- `KNOWN_EXCEPTIONS` — Array of regex patterns for Blanc de Noirs, orange wine/skin contact, vin gris, ramato

**Build process**: `buildGrapeColourMap()` iterates zones with explicit `color` + `rules.grapes`, skips buffer/fallback/curated zones. Then merges curiosity supplements (saperavi→red, furmint→white, etc.). Map is module-private.

### 2. `src/utils/wineNormalization.js` — Central normalization utilities

Addresses R1-#2. Single source of truth for colour/grape normalization, reused by map build AND checker AND write paths.

Exports:
- `normalizeColour(colour)` — Lowercases, maps aliases (rosé→rose, rosado→rose), returns canonical or null if invalid
- `normalizeGrape(grape)` — Strip diacritics for matching (Unicode NFD), lowercase, trim, resolve via GRAPE_SYNONYMS, return canonical form. Preserves original for display.
- `parseGrapesField(grapes)` — Robust tokenizer (addresses R1-#7): tries JSON parse first, then splits on `,`, `;`, `/`, `&`, `+`. Strips percentage numbers (e.g. "60% Cabernet, 40% Merlot" → ["Cabernet", "Merlot"]). Deduplicates. Aligns with existing `parseJsonArray` pattern from [cellarPlacement.js:514](src/services/cellarPlacement.js#L514).
- `stripDiacritics(str)` — Unicode NFD + strip combining marks (gewürztraminer↔gewurztraminer, mourvèdre↔mourvedre)

### 3. `src/services/consistencyChecker.js` — Checking logic

**`checkWineConsistency(wine)`** — Checks one wine, returns finding or null:
- Returns null if no colour or no parseable grapes
- Checks known exceptions first (Blanc de Noirs, orange wine, etc.)
- **Method-type bypass** (R1-#4): skip check entirely for sparkling, dessert, fortified colours. ALSO skip if wine_name/style contains sparkling/dessert/fortified keywords (catches "sparkling stored as white" pattern from [fridgeStocking.js:24](src/services/fridgeStocking.js#L24))
- **Rosé handling** (R1-#5): allow ANY grape in rosé. No warning.
- **Orange handling**: allow any white grape for orange colour
- Normalizes grapes via `normalizeGrape()` before lookup
- Severity: `error` if ALL grapes mismatch, `warning` if partial blend conflict
- **Unknown grape handling** (R1-#6): if ALL parsed grapes are unknown, return `info` severity finding
- Returns: `{ wineId, wineName, vintage, issue, severity, message, details: { mismatches, unknownGrapes, currentColour, suggestedColour }, suggestedFix }`
- **Must never throw** (R2-#11): all logic wrapped defensively; returns null on any internal error

**`auditCellar(cellarId, options)`** — Full audit with pagination (R1-#8):
- Options: `{ limit, offset, severity, includeUnknown }`
- SQL: `SELECT id, wine_name, vintage, colour, grapes, style FROM wines WHERE cellar_id = ? AND grapes IS NOT NULL AND grapes != ''`
- Returns: `{ data: findings[], summary: { totalWines, checked, skippedNoGrapes, issuesFound, errors, warnings, infos, unknownGrapeCount }, pagination: { limit, offset, total } }`

### 4. `src/routes/consistency.js` — API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/consistency/audit` | Full cellar audit. Query params: `limit`, `offset`, `severity`, `includeUnknown` |
| GET | `/api/consistency/check/:id` | Check single wine by ID |
| POST | `/api/consistency/validate` | Pre-save validation (wine fields in body) |

**Zod schemas for all params/query** (R2-#17): add `auditQuerySchema`, `wineIdParamSchema`, `validateBodySchema` using existing `validateQuery`/`validateParams`/`validateBody` helpers.

Response shape matches existing patterns (`{ data, summary, pagination }`).

## Files to Modify (7 existing files)

### 5. `src/schemas/wine.js` — Add orange colour

Add `'orange'` to `WINE_COLOURS` array → `['red', 'white', 'rose', 'orange', 'sparkling', 'dessert', 'fortified']`

This aligns schema with AI response validator ([responseValidator.js:44](src/services/responseValidator.js#L44) already accepts orange) and matches industry trend (Decanter, Wine-Searcher, OIV "white with maceration").

### 6. `src/routes/wines.js` — Write-path advisory hook (POST + PUT)

Addresses R1-#1. **Fail-open pattern** (R2-#11) and **preserve response shape** (R2-#10):

**POST** (line 432) — current shape is `{ id: ..., message: 'Wine added' }`. Add warnings as sibling:
```javascript
// After successful insert (line 432):
let warnings = [];
try {
  const finding = checkWineConsistency({ id: result?.id, wine_name, colour, grapes: req.body.grapes, style });
  if (finding) warnings = [finding];
} catch { /* fail-open: never crash after successful write */ }
res.status(201).json({ id: result?.id || result?.lastInsertRowid, message: 'Wine added', warnings });
```

**PUT** (line 519) — current shape is `{ message: 'Wine updated' }`. Same pattern:
```javascript
let warnings = [];
try {
  const finding = checkWineConsistency({ id: req.params.id, wine_name, colour, grapes: req.body.grapes, style });
  if (finding) warnings = [finding];
} catch { /* fail-open */ }
res.json({ message: 'Wine updated', warnings });
```

### 7. `src/services/acquisitionWorkflow.js` — Fix RETURNING id + advisory hook

**Pre-existing bug fix** (R2-#12): The INSERT at line 364 uses `.run()` without `RETURNING id`. In PostgreSQL, `lastInsertRowid` returns null because `result.rows` is empty ([postgres.js:105](src/db/postgres.js#L105)). Fix by adding `RETURNING id` to the INSERT and switching to `.get()`:

```javascript
// Line 364: change .run(...) to:
const insertResult = await db.prepare(`
  INSERT INTO wines (...) VALUES (?, ?, ...) RETURNING id
`).get(cellarId, ...);
const wineId = insertResult?.id || insertResult?.lastInsertRowid;
```

Then add fail-open advisory warnings to the return object.

### 8. `src/routes/index.js` — Register new route

Add: `router.use('/consistency', requireAuth, requireCellarContext, consistencyRoutes);`

### 9. `data/migrations/049_add_orange_colour.sql` — DB migration

```sql
ALTER TABLE wines DROP CONSTRAINT IF EXISTS wines_colour_check;
ALTER TABLE wines ADD CONSTRAINT wines_colour_check
  CHECK (colour IN ('red', 'white', 'rose', 'orange', 'sparkling', 'dessert', 'fortified'));
```

### 10. `data/schema.postgres.sql` — Base schema parity (R2-#14)

Update the CHECK constraint on line 9 to include 'orange'.

### 11. `data/schema.sqlite.sql` — Base schema parity (R2-#14)

Update the CHECK constraint on line 8 to include 'orange'.

## Orange Colour — UI Follow-up (R2-#13, deferred)

Adding orange to the backend schema/validation is safe — it's additive and no existing data is affected. However, full UI support requires separate work:
- Form dropdowns: [index.html:269](public/index.html#L269), [index.html:1056](public/index.html#L1056)
- Text parsing: [textParsing.js:118](src/services/textParsing.js#L118)
- Accessibility: [accessibility.js:186](public/js/accessibility.js#L186)
- Color chips/styling: [components.css:328](public/css/components.css#L328), [components.css:1322](public/css/components.css#L1322)

This is tracked as a follow-up, not blocking this phase.

## Test Files to Create (2 new files)

### 12. `tests/unit/config/grapeColourMap.test.js` (~15 tests)

- `getExpectedColours('shiraz')` returns Set containing 'red'
- `getExpectedColours('chardonnay')` returns Set containing 'white'
- `getGrapeCount()` returns 40+ entries
- Curiosity grapes included: `getExpectedColours('saperavi')` → red, `getExpectedColours('furmint')` → white
- Synonyms: `getCanonicalGrape('Shiraz')` → 'syrah', `getCanonicalGrape('Pinot Grigio')` → 'pinot gris'
- `getExpectedColours` resolves synonyms: `getExpectedColours('Garnacha')` → includes 'red'
- `getExpectedColours` case-insensitive, returns null for unknown
- `findException` matches Blanc de Noirs, rosé, orange wine, vin gris
- `findException` returns null for standard wine names
- No raw Map exposed (only getter functions)

### 13. `tests/unit/services/consistencyChecker.test.js` (~25 tests)

- `parseGrapesField`: JSON array, comma-sep, slash-sep, `&`-sep, percentage format, null, empty, dedup
- `checkWineConsistency`:
  - Shiraz+white → error with suggestedFix='red'
  - Shiraz+red → null (ok)
  - Cabernet+rosé → null (rosé allows any grape)
  - Chardonnay+sparkling → null (method-type bypass)
  - Chardonnay+orange → null (orange allows white grapes)
  - "Champagne"+white → null (sparkling keyword bypass)
  - Blanc de Noirs+white → null (exception match)
  - Mixed blend partial mismatch → warning
  - All unknown grapes → info severity
  - No grapes → null
  - No colour → null
  - **Never throws** — bad input returns null, never exception
- `normalizeColour`: rosé→rose, ROSÉ→rose, invalid→null
- `normalizeGrape`: Gewürztraminer→gewurztraminer, Shiraz→syrah (via synonym)
- `auditCellar`: scoped by cellarId, returns summary with counts including unknownGrapeCount

## Key Design Decisions

1. **Advisory only, never blocking** — matches all major wine platforms. Writes always succeed; warnings returned alongside success response.
2. **Fail-open** (R2-#11) — checker calls wrapped in try/catch at every call site. If checker throws, response still succeeds with empty warnings. Never risk a 500 after committed data.
3. **Preserve response shapes** (R2-#10) — POST returns `{ id, message, warnings }`, PUT returns `{ message, warnings }`. No `data` wrapper that would break existing clients.
4. **Frozen standalone rules** (R1-#3) — grape-colour map seeded from zones but module-private. Zone layout changes don't silently alter validation.
5. **Private Map, public getters** (R2-#15) — `Object.freeze()` on Map doesn't work; instead keep Map private, expose only `getExpectedColours()`, `getCanonicalGrape()`, `getGrapeCount()`.
6. **Method-type colours fully exempt** (R1-#4) — sparkling, dessert, fortified skip check entirely. Also detected by keywords when stored as white/red.
7. **Rosé fully exempt** (R1-#5) — any grape can make rosé. No warnings.
8. **Orange as first-class colour** — aligns with Decanter, Wine-Searcher, OIV. Backend + schema only; UI deferred (R2-#13).
9. **Fix acquisition RETURNING id** (R2-#12) — pre-existing PostgreSQL bug, fixed as part of hooking advisory warnings.
10. **Central normalization** (R1-#2) — single `wineNormalization.js` used by map build, checker, and write paths.

## Implementation Order

| Step | File | Notes |
|------|------|-------|
| 1 | `src/utils/wineNormalization.js` | Create normalization utilities |
| 2 | `src/config/grapeColourMap.js` | Create grape-colour map (uses normalization) |
| 3 | `tests/unit/config/grapeColourMap.test.js` | ~15 tests |
| 4 | `src/services/consistencyChecker.js` | Create checker service |
| 5 | `tests/unit/services/consistencyChecker.test.js` | ~25 tests |
| 6 | `src/routes/consistency.js` | Create API routes with Zod schemas |
| 7 | `src/routes/index.js` | Register route |
| 8 | `src/schemas/wine.js` | Add orange |
| 9 | `data/migrations/049_add_orange_colour.sql` | Migration |
| 10 | `data/schema.postgres.sql` + `data/schema.sqlite.sql` | Base schema parity |
| 11 | `src/routes/wines.js` | Advisory warnings on POST/PUT (fail-open) |
| 12 | `src/services/acquisitionWorkflow.js` | Fix RETURNING id + advisory warnings |
| 13 | Run `npm run test:all` | Verify all pass |

## Verification

1. `npm run test:unit` — all existing 996+ tests pass, ~40 new tests pass
2. `npm run test:all` — integration tests still pass
3. Manual: Kleine Zalze Shiraz/white → `error` finding with `suggestedFix: 'red'`
4. Manual: Champagne Chardonnay/white → no finding (sparkling keyword bypass)
5. Manual: Côtes de Provence Grenache/rose → no finding (rosé exempt)
6. Manual: POST wine with Shiraz+white → wine created + `warnings` array in response, `id` at top level (not nested)
7. Verify checker failure doesn't cause 500 — mock throw in test, confirm response still returns `{ id, message, warnings: [] }`
