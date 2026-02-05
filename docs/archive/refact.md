# Wine Cellar App -- Refactoring Plan

**Audit date**: 2026-02-05
**Codebase**: Node.js / Express / PostgreSQL / Vanilla JS
**Test baseline**: 942 unit tests passing (`npm run test:unit`)

---

## Audit Summary

| Category | Issues | Critical | High | Medium | Low |
|----------|--------|----------|------|--------|-----|
| Broken Transactions (ACID) | 3 | **3** | - | - | - |
| DRY: Unadopted Error Handling | 19 route files | - | 1 | - | - |
| Missing Input Validation | 8 routes | - | 1 | - | - |
| SOLID / File Size (SRP) | 8 files | - | 4 | 4 | - |
| Dead/Unused Code | 4 | - | 1 | 2 | 1 |
| Logging: Incomplete Adoption | 204 calls / 42 files | - | - | 1 | - |
| Encapsulation | 2 | - | - | 1 | 1 |
| Migration Naming | 3 conflicts | - | - | 3 | - |

---

## Existing Infrastructure (already built, partially adopted)

Before starting any phase, be aware of infrastructure that **already exists** but is underused:

| Component | Location | Status |
|-----------|----------|--------|
| `asyncHandler(fn)` | `src/utils/errorResponse.js:166` | **Built, 0 route files use it** |
| `errorHandler` middleware | `src/utils/errorResponse.js:109` | **Built, mounted at `src/server.js:77`** |
| `AppError` class | `src/utils/errorResponse.js:42` | **Built, with `.notFound()`, `.validation()`, `.conflict()`, `.badRequest()` factory methods** |
| `notFoundHandler` | `src/utils/errorResponse.js:177` | **Built, mounted at `src/server.js:71`** |
| Winston logger | `src/utils/logger.js:1` | **Built, imported in 37/42 backend files that need it** |
| `validateBody`/`validateQuery` | `src/middleware/validate.js` | **Built, used in 2 of 25 route files** |

**Key takeaway**: Phases 2, 3, and 6 are *adoption* work, not *creation* work.

---

## Phase 1: CRITICAL -- Fix Broken Database Transactions

### Problem

`db.prepare('BEGIN TRANSACTION').run()` acquires a **random connection** from the PostgreSQL pool on each call. Successive calls to `db.prepare(...)` in the same code block may hit **different pool connections**, meaning `BEGIN`, `INSERT`, and `COMMIT` execute on separate connections. The transaction is illusory -- there is no atomicity.

The correct `db.transaction()` method exists at `src/db/postgres.js:123` and holds a **single client** for the entire callback. It is already used correctly in `src/routes/slots.js:45-48`.

### 3 Broken Transaction Sites

#### Site 1: Zone merge --`src/routes/cellar.js:602-634`

```javascript
// WRONG: BROKEN -- each db.prepare().run() gets a different pool connection
await db.prepare('BEGIN TRANSACTION').run();              // conn A
await db.prepare('UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND zone_id = $3')
  .run(targetZoneId, req.cellarId, sourceZoneId);         // conn B -- NOT in transaction
await db.prepare('UPDATE zone_allocations SET ...')
  .run(...);                                               // conn C
await db.prepare('DELETE FROM zone_allocations WHERE ...')
  .run(req.cellarId, sourceZoneId);                        // conn D
await db.prepare('COMMIT').run();                          // conn E
```

**Fix**: Convert to `db.transaction()`:

```javascript
// OK: CORRECT -- single client throughout
await db.transaction(async (client) => {
  await client.query(
    'UPDATE wines SET zone_id = $1 WHERE cellar_id = $2 AND zone_id = $3',
    [targetZoneId, req.cellarId, sourceZoneId]
  );
  await client.query(
    `UPDATE zone_allocations SET assigned_rows = $1, wine_count = $2, updated_at = CURRENT_TIMESTAMP
     WHERE cellar_id = $3 AND zone_id = $4`,
    [JSON.stringify(mergedRows), mergedWineCount, req.cellarId, targetZoneId]
  );
  await client.query(
    'DELETE FROM zone_allocations WHERE cellar_id = $1 AND zone_id = $2',
    [req.cellarId, sourceZoneId]
  );
});
```

#### Site 2: Execute moves --`src/routes/cellar.js:1142-1181`

```javascript
// WRONG: BROKEN -- loop of UPDATEs inside fake transaction
await db.prepare('BEGIN TRANSACTION').run();
for (const move of moves) {
  await db.prepare('UPDATE slots SET wine_id = $1 WHERE ...').run(null, ...);
  await db.prepare('UPDATE slots SET wine_id = $1 WHERE ...').run(move.wineId, ...);
}
await db.prepare('COMMIT').run();
```

**Fix**: Same pattern -- use `db.transaction()` with `client.query()`.

#### Site 3: Create cellar + membership --`src/routes/cellars.js:52-75`

```javascript
// WRONG: BROKEN -- cellar insert and membership insert on different connections
await db.prepare('BEGIN').run();
const cellar = await db.prepare('INSERT INTO cellars (...) RETURNING id, ...').get(...);
await db.prepare('INSERT INTO cellar_memberships (...)').run(cellar.id, ...);
await db.prepare('COMMIT').run();
```

If the membership INSERT fails, the cellar INSERT is **not rolled back** because they're on different connections.

**Fix**:

```javascript
const cellar = await db.transaction(async (client) => {
  const { rows } = await client.query(
    `INSERT INTO cellars (name, description, created_by)
     VALUES ($1, $2, $3) RETURNING id, name, description, created_by, created_at`,
    [name.trim(), description || null, req.user.id]
  );
  await client.query(
    `INSERT INTO cellar_memberships (cellar_id, user_id, role, invited_by)
     VALUES ($1, $2, 'owner', $3)`,
    [rows[0].id, req.user.id, req.user.id]
  );
  return rows[0];
});
```

### Correct pattern reference

See `src/routes/slots.js:45-48` for the correct usage:

```javascript
await db.transaction(async (client) => {
  await client.query('UPDATE slots SET wine_id = NULL WHERE cellar_id = $1 AND location_code = $2', [req.cellarId, from_location]);
  await client.query('UPDATE slots SET wine_id = $1 WHERE cellar_id = $2 AND location_code = $3', [sourceSlot.wine_id, req.cellarId, to_location]);
});
```

### Verification

```bash
npm run test:unit    # Must still pass 942 tests
npm run test:all     # Unit + integration
# Manual: POST /api/cellars to create a cellar -- verify membership row exists
# Manual: POST /api/cellar/zones/merge -- verify source zone deleted, target updated
```

**Files**: `src/routes/cellar.js`, `src/routes/cellars.js`

---

## Phase 2: HIGH -- Adopt Existing asyncHandler (DRY)

### Problem

19 route files wrap every handler in identical try/catch blocks, but `asyncHandler` and `errorHandler` **already exist and are mounted**:

- `asyncHandler` --`src/utils/errorResponse.js:166`
- `errorHandler` --`src/utils/errorResponse.js:109`, mounted at `src/server.js:77`
- `AppError` --`src/utils/errorResponse.js:42`, with factory methods for 404, 400, 409, 503

**Zero route files currently import or use `asyncHandler`.** The infrastructure is live but unadopted.

### Current state (repeated ~202 times across 19 route files)

```javascript
router.get('/endpoint', async (req, res) => {
  try {
    // ... route logic ...
  } catch (error) {
    console.error('Context:', error);
    res.status(500).json({ error: error.message });
  }
});
```

**Worst offenders** (catch count):

| File | Catches | Lines |
|------|---------|-------|
| `src/routes/cellar.js` | 36 | 1,560 |
| `src/routes/wines.js` | 25 | 1,057 |
| `src/routes/ratings.js` | 21 | 963 |
| `src/routes/pairing.js` | 11 | 449 |
| `src/routes/slots.js` | 9 | 357 |
| `src/routes/storageAreas.js` | 7 | 547 |
| `src/routes/settings.js` | 5 | 320 |
| `src/routes/reduceNow.js` | 6 | 280 |
| Other 11 route files | ~82 | - |

### Approach

**No new files needed.** Import existing infrastructure:

```javascript
import { asyncHandler } from '../utils/errorResponse.js';
```

Convert route handlers **endpoint-by-endpoint** (not blanket replacement):

```javascript
// Before:
router.get('/wines', async (req, res) => {
  try {
    const wines = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1').all(req.cellarId);
    res.json({ data: wines });
  } catch (error) {
    console.error('Get wines error:', error);
    res.status(500).json({ error: error.message });
  }
});

// After:
router.get('/wines', asyncHandler(async (req, res) => {
  const wines = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1').all(req.cellarId);
  res.json({ data: wines });
}));
```

### Migration risks and safeguards

**WARNING**: Current catch blocks are **not uniform**. Some return custom status codes, add logging context, or return different response shapes. Blanket removal will change behavior.

**Required safeguards**:

1. **Endpoint-by-endpoint migration** -- Do NOT batch-replace all catch blocks. Inspect each handler individually.
2. **Preserve explicit status codes** -- Routes that return 400, 404, 409 must keep their explicit `res.status()` calls or use `AppError` factory methods:
   ```javascript
   // These patterns must NOT be blindly removed:
   if (!wine) return res.status(404).json({ error: 'Wine not found' });
   if (conflict) return res.status(409).json({ error: 'Slot occupied' });

   // Convert to AppError if desired:
   if (!wine) throw AppError.notFound('Wine', id);
   if (conflict) throw AppError.conflict('Slot occupied');
   ```
3. **Response shape compatibility** -- The existing `errorHandler` returns `{ error: { code, message } }` (structured), but current catch blocks return `{ error: "string" }` (flat). Both shapes must remain valid. The contract test at `tests/unit/contracts/responseShapes.test.js` validates both formats -- run it after each file.
4. **One route file per commit** -- Convert, test, commit. Start with the largest offender (`cellar.js`).

### Verification per file

```bash
npm run test:unit                # 942 tests must pass
npm run test:all                 # Unit + integration
# Check error responses still match expected shapes
```

**Files**: All 19 `src/routes/*.js` files (no new files needed)

---

## Phase 3: HIGH -- Add Input Validation to Unvalidated Routes

### Problem

Only 2 of 25 route files use Zod schema validation via `validateBody()`/`validateQuery()`:
- `src/routes/wines.js` -- uses schemas from `src/schemas/wine.js`
- `src/routes/slots.js` -- uses schemas from `src/schemas/slot.js`

The remaining 23 route files use manual ad-hoc checks or no validation at all.

### Priority: mutation endpoints first

Focus validation on **POST/PUT/DELETE** endpoints first (data-modifying), then GET query params.

| Route file | Endpoint(s) | Validate | Type |
|-----------|-------------|----------|------|
| `src/routes/cellars.js` | `POST /` (create cellar) | `name` required string, `description` optional | body |
| `src/routes/pairing.js` | `POST /suggest` | `signals` non-empty array of strings, `limit` positive int, `prefer_reduce_now` boolean | body |
| `src/routes/pairing.js` | `POST /natural` | `dish` non-empty string, `source` enum, `colour` enum | body |
| `src/routes/settings.js` | `PUT /:key` | `key` is alphanumeric, `value` is string/number | params + body |
| `src/routes/ratings.js` | `GET /:wineId/ratings` | `wineId` positive integer, `vintage` optional query | params + query |
| `src/routes/ratings.js` | `POST /:wineId/ratings/fetch` | `wineId` positive integer | params |
| `src/routes/ratings.js` | `POST /:wineId/ratings` | `wineId` positive integer, rating body shape | params + body |
| `src/routes/awards.js` | `POST /`, `PUT /:id` | Award data shape (name, year, medal, etc.) | body |
| `src/routes/acquisition.js` | `POST /parse-image` | `image` required (base64), `mediaType` required string | body |
| `src/routes/acquisition.js` | `POST /suggest-placement`, `/enrich`, `/workflow`, `/save` | `wine` object shape | body |
| `src/routes/palateProfile.js` | `POST /feedback`, `GET /profile`, `GET /score/:wineId`, `GET /recommendations` | Feedback payload, query filters | body, query |
| `src/routes/storageAreas.js` | `POST /`, `PUT /:id` | Area configuration shape | body |

### Approach

For each route:
1. Create a Zod schema in `src/schemas/<domain>.js`
2. Import the existing `validateBody`/`validateQuery`/`validateParams` from `src/middleware/validate.js`
3. Apply to mutation endpoints first, then query endpoints

### Example: `src/routes/cellars.js`

```javascript
// src/schemas/cellar.js
import { z } from 'zod';

export const createCellarSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable()
});

// src/routes/cellars.js
import { validateBody } from '../middleware/validate.js';
import { createCellarSchema } from '../schemas/cellar.js';

router.post('/', validateBody(createCellarSchema), async (req, res) => { ... });
```

### Example: params + query validation

```javascript
// src/schemas/rating.js
import { z } from 'zod';

export const ratingWineIdParamsSchema = z.object({
  wineId: z.string().regex(/^\d+$/).transform(Number)
});

export const ratingQuerySchema = z.object({
  vintage: z.string().regex(/^\d{4}$/).transform(Number).optional()
});

// src/routes/ratings.js
import { validateParams, validateQuery } from '../middleware/validate.js';
router.get('/:wineId/ratings', validateParams(ratingWineIdParamsSchema), asyncHandler(async (req, res) => { ... }));
```

**Files**: NEW schemas in `src/schemas/`, updated route files

---

## Phase 4: HIGH -- Split Oversized Files (SRP)

### Problem

CLAUDE.md guideline: keep files focused on a single responsibility and split at ~500 lines. These 8 backend files and 1 frontend file had grown far beyond that, handling multiple distinct concerns:

| File | Lines | Over limit | Responsibility count |
|------|-------|-----------|---------------------|
| `src/services/searchProviders.js` | 3,312 | **11x** | Search orchestration + budget tracking + SERP calls + page fetching + URL scoring + discovery + web scraping + cache |
| `public/js/api.js` | 1,813 | **6x** | 128 API functions for every domain |
| `src/routes/cellar.js` | 1,560 | **5x** | Zone CRUD + merge + analysis endpoints + health + metadata + reconfig |
| `src/services/claude.js` | 1,348 | **4.5x** | Sommelier + wine parsing (text+image) + rating extraction + conversation mgmt |
| `src/services/awards.js` | 1,133 | **3.8x** | Award parsing + matching + competition data |
| `src/routes/wines.js` | 1,057 | **3.5x** | CRUD + search + global search + duplicate check + parsing + ratings + vivino |
| `src/routes/ratings.js` | 963 | **3.2x** | 3-tier waterfall + tier logging + cache stats + circuit breakers |
| `src/services/cellarAnalysis.js` | 791 | **2.6x** | Metrics calculation + analysis |

### Additional files over 300 lines (lower priority)

| File | Lines | Over limit |
|------|-------|-----------|
| `src/services/vivinoSearch.js` | 718 | 2.4x |
| `src/services/cacheService.js` | 728 | 2.4x |
| `src/services/openaiReviewer.js` | 776 | 2.6x |
| `src/services/tastingExtractor.js` | 688 | 2.3x |
| `src/services/cellarHealth.js` | 631 | 2.1x |
| `src/services/cellarPlacement.js` | 619 | 2.1x |
| `src/services/zoneReconfigurationPlanner.js` | 620 | 2.1x |
| `src/services/tastingNotesV2.js` | 607 | 2x |
| `src/services/ratings.js` | 584 | 1.9x |
| `src/services/palateProfile.js` | 592 | 2x |
| `src/services/fridgeStocking.js` | 547 | 1.8x |
| `src/services/pairingEngine.js` | 551 | 1.8x |
| `src/services/puppeteerScraper.js` | 539 | 1.8x |
| `src/routes/storageAreas.js` | 547 | 1.8x |
| `public/js/app.js` | 1,133 | 3.8x |
| `public/js/settings.js` | 1,267 | 4.2x |
| `public/js/ratings.js` | 787 | 2.6x |
| `public/js/tastingService.js` | 670 | 2.2x |

### Suggested splits (priority order)

#### 1. `src/services/searchProviders.js` (3,312 lines)

| New file | Responsibility | Approx lines |
|----------|---------------|-------------|
| `src/services/searchBudget.js` | `createSearchBudgetTracker()`, `hasWallClockBudget()`, `reserveSerpCall()`, `canConsumeBytes()`, `recordBytes()` | ~100 |
| `src/services/searchOrchestrator.js` | `searchWineRatings()` entry point, tier selection, result merging | ~300 |
| `src/services/searchGoogle.js` | `searchGoogle()`, `searchBrightDataSerp()`, SERP API calls | ~400 |
| `src/services/fetchContent.js` | `fetchDocumentContent()`, `fetchPageContent()`, `fetchWithRetry()` | ~500 |
| `src/services/searchProviders.js` | Source registry, `getSourcesForWine()`, `buildSourceQuery()`, relevance scoring | ~500 |
| `src/services/urlScoring.js` | Already exists -- move `scoreAndRankUrls()`, `applyMarketCaps()` there | ~300 |

#### 2. `src/routes/cellar.js` (1,560 lines)

| New file | Responsibility | Current endpoints |
|----------|---------------|-----------------|
| `src/routes/cellarZones.js` | Zone CRUD, merge, allocation, metadata | `GET /zones`, `GET /zone-map`, `GET /zone-statuses`, `GET /allocations`, `POST /zones/allocate-row`, `POST /zones/merge`, `POST /assign-zone`, `GET/PUT /zone-metadata/*`, `GET /zones-with-intent`, `POST /zone-chat`, `POST /zone-reassign` |
| `src/routes/cellarAnalysis.js` | Analysis, fridge, AI advice, reconfig | `GET /analyse`, `GET /analyse/ai`, `GET/DELETE /analyse/cache`, `GET /fridge-status`, `GET /fridge-organize`, `POST /zone-capacity-advice`, `POST /reconfiguration-plan`, `POST /reconfiguration-plan/apply`, `POST /reconfiguration/:id/undo` |
| `src/routes/cellar.js` | Placement, moves, wine attributes | `POST /suggest-placement`, `GET /suggest-placement/:wineId`, `POST /execute-moves`, `POST /update-wine-attributes`, `GET/POST /zone-layout/*` |

#### 3. `src/routes/wines.js` (1,057 lines)

| New file | Responsibility | Endpoints |
|----------|---------------|----------|
| `src/routes/wineRatings.js` | Personal ratings, vivino URLs, rating refresh | `PUT /:id/personal-rating`, `GET /:id/personal-rating`, `POST /:id/set-vivino-url`, `GET /:id/ratings`, `POST /:id/refresh-ratings` |
| `src/routes/wines.js` | CRUD, search, global search, duplicate check | `GET/POST/PUT/DELETE /`, `GET /search`, `GET /global-search` |

#### 4. `src/services/claude.js` (1,348 lines)

| New file | Responsibility |
|----------|---------------|
| `src/services/sommelierService.js` | `getSommelierRecommendation()`, prompt building, response parsing |
| `src/services/wineParser.js` | `parseWineText()`, `parseWineImage()`, extraction logic |
| `src/services/claude.js` | Claude API wrapper, message construction, conversation management |

### Guidelines

- **Preserve all existing exports** -- create re-exports in the original file if needed for backwards compatibility during migration
- **One file at a time** -- split, run tests, commit, then move to next
- **Update `src/routes/index.js`** when splitting route files to register new routers

**Files**: All files listed above

---

## Phase 5: MEDIUM -- Dead/Unused Code Cleanup

### Confirmed dead exports

| File | Export | Evidence | Action |
|------|--------|----------|--------|
| `src/db/postgres.js:160-176` | `preparedStatements` | Zero imports anywhere in codebase (`grep -r preparedStatements src/` returns only the definition and re-export) | Remove export and the object |
| `src/db/index.js:21` | `preparedStatements` re-export | Dead since source is unused | Remove |

### Low-value removal (defer unless refactoring awards service)

| File | Export | Evidence | Action |
|------|--------|----------|--------|
| `src/db/postgres.js:154` | `awardsDb` | Aliases `db` exactly (same pool, same database), but is **actively used in 19+ call sites** in `src/services/awards.js` | **Defer** -- removing requires updating all 19+ call sites in awards.js. Only worth doing if already refactoring the awards service. Not dead code, just an unnecessary indirection. |

### Duplicate utility functions

| Function | Location 1 | Location 2 | Action |
|----------|-----------|-----------|--------|
| `extractDomain(url)` | `src/services/searchProviders.js` | `src/services/claude.js` | Move to `src/utils/url.js`, import from both |
| `stringAgg()` helper | `src/db/helpers.js` | Reimplemented inline in several routes | Use `helpers.stringAgg()` consistently |

### Migration file naming conflicts

**WARNING**: Do NOT renumber or delete existing migration files. If a migration has already been applied in production, renaming it can cause the migration runner to re-execute it or skip it. Use **forward-only corrective migrations** instead.

| Conflict | Files | Action |
|----------|-------|--------|
| Duplicate `019_` prefix | `019_chat_sessions.sql`, `019_structured_tasting_notes.sql` | Verify both are applied in production. If both have run, **leave them as-is** and document the conflict. If one has not run, create a new migration with the next available number that applies the missing schema. |
| Duplicate `033_` prefix | `033_add_cellar_id_to_other_tables.sql`, `033_add_cellar_id_to_other_tables_safe.sql` | Verify which ran in production. If the `_safe` version supersedes the original, **leave both files** but add a comment header to the superseded file marking it as replaced. Do NOT delete. |
| Non-standard `032a_` | `032a_create_missing_tables.sql` | If already applied, **leave as-is** and document. If not applied, create a properly numbered migration with the next available number. |

**General rule**: Migration files are append-only. Corrections go in new migrations.

**Files**: `src/db/postgres.js`, `src/db/index.js`, `data/migrations/` (documentation only, no renames/deletes)

---

## Phase 6: MEDIUM -- Complete Logger Adoption

### Problem

204 `console.error`/`console.warn` calls remain across 42 backend files, despite `src/utils/logger.js` already existing and being imported in 37 of those files.

The logger is a **Winston-based structured logger** with `info(category, message)`, `warn(category, message)`, `error(category, message)`, `debug(category, message)`, and `separator()` methods. It writes to both console (colorized in dev, JSON in prod) and file (`data/ratings-search.log`).

### Current adoption status

- **37 files** already import `src/utils/logger.js`
- **5 files** with `console.error`/`console.warn` do NOT yet import logger
- Many files import logger but **still use `console.error` alongside it**

### Distribution of remaining `console.error`/`console.warn` calls

| File | Count | Already imports logger? |
|------|-------|------------------------|
| `src/routes/cellar.js` | 36 | No |
| `src/routes/wines.js` | 25 | No |
| `src/routes/pairing.js` | 11 | No |
| `src/routes/slots.js` | 9 | No |
| `src/routes/storageAreas.js` | 7 | No |
| `src/routes/reduceNow.js` | 6 | No |
| `src/routes/searchMetrics.js` | 6 | No |
| `src/routes/settings.js` | 5 | Yes |
| `src/routes/ratings.js` | 6 | Yes |
| `src/routes/wineSearch.js` | 4 | No |
| `src/routes/backup.js` | 4 | Yes |
| `src/routes/cellars.js` | 4 | No |
| `src/middleware/auth.js` | 4 | No |
| `src/middleware/cellarContext.js` | 4 | No |
| `src/services/openaiReviewer.js` | 10 | No |
| `src/services/zoneReconfigurationPlanner.js` | 12 | No |
| Other 26 files | ~51 | Mixed |

### Approach

1. **No new files needed** --`src/utils/logger.js` already exists
2. Add `import logger from '../utils/logger.js'` to files that don't have it yet
3. Replace `console.error('Context:', error)` with `logger.error('Context', error.message)`
4. Replace `console.warn('Warning:', msg)` with `logger.warn('Tag', msg)`
5. Keep `console.log` in `src/server.js` and `src/db/postgres.js` for startup messages (acceptable)

**Note**: If Phase 2 (asyncHandler adoption) is done first, many `console.error` calls inside catch blocks will be eliminated, reducing this phase's scope significantly. Consider doing Phase 2 first.

**Files**: All 42 files listed above (no new files needed)

---

## Phase 7: LOW -- Encapsulation Improvements

### Mutable circuit breaker state

`src/services/openaiReviewer.js` uses a module-level mutable object:

```javascript
// Module-level mutable state (shared across all concurrent requests)
const circuitBreaker = {
  failures: 0,
  lastFailure: null,
  isOpen: false
};
```

Under concurrent requests, `failures` could be incremented/reset by interleaving async operations. A dedicated `CircuitBreaker` class already exists at `src/services/circuitBreaker.js` with proper encapsulation.

**Fix**: Import and use `CircuitBreaker` from `src/services/circuitBreaker.js` instead of the ad-hoc module-level state.

**Files**: `src/services/openaiReviewer.js`

### Direct DB imports (no action)

29+ files import `db` directly from `../db/index.js`. This is tight coupling, but dependency injection would be over-engineering for this project size. Accepted as-is.

---

## Execution Order

| Order | Phase | Severity | Files | Depends On |
|-------|-------|----------|-------|-----------|
| 1 | Fix broken transactions | **CRITICAL** | 2 | - |
| 2 | Adopt asyncHandler | HIGH | 19 | - |
| 3 | Input validation | HIGH | 16 | - |
| 4 | Split oversized files | HIGH | 8+ | Phases 1-2 (cellar.js touched by both) |
| 5 | Dead code cleanup | MEDIUM | 4 | - |
| 6 | Complete logger adoption | MEDIUM | 42 | Phase 2 reduces scope |
| 7 | Encapsulation | LOW | 1 | - |

Phases 1, 2, 3, 5, 7 are independent and can be done in parallel by different developers. Phase 4 should wait until phases 1 and 2 are complete (since `cellar.js` is touched by all three). Phase 6 benefits from Phase 2 completing first.

---

## Verification Checklist

After **every phase**:

```bash
npm run test:unit    # 942 tests must pass
npm run test:all     # Unit + integration
```

After **Phase 1** (transactions):
- [ ] Create a new cellar via API -- verify both `cellars` and `cellar_memberships` rows exist
- [ ] Merge two zones via API -- verify source zone deleted, target zone updated atomically
- [ ] Execute batch moves -- verify all moves succeed or all fail (kill server mid-operation to test rollback)

After **Phase 2** (asyncHandler adoption):
- [ ] Verify all error responses still return expected format (check both `{ error: "string" }` flat and `{ error: { code, message } }` structured shapes)
- [ ] Verify 404 responses return correct status (not 500)
- [ ] Verify validation errors return 400 with structured error body
- [ ] Run contract tests: `npx vitest run tests/unit/contracts/responseShapes.test.js`
- [ ] Test one endpoint manually with an invalid request to verify error shape

After **Phase 4** (file splits):
- [ ] Verify all imports resolve (`node -e "import('./src/routes/index.js')"`)
- [ ] Hit every API endpoint to verify no route 404s
- [ ] Check that `src/routes/index.js` registers all new route files

---

## Reference: Correct Patterns

### Transaction pattern (`src/db/postgres.js:123`)

```javascript
// OK: Correct: single client for entire transaction
const result = await db.transaction(async (client) => {
  const { rows } = await client.query('INSERT INTO ... RETURNING id', [params]);
  await client.query('INSERT INTO related_table ...', [rows[0].id, ...]);
  return rows[0];
});

// WRONG: Wrong: each call gets a different pool connection
await db.prepare('BEGIN').run();
await db.prepare('INSERT INTO ...').run(...);  // different connection!
await db.prepare('COMMIT').run();              // different connection!
```

### Error handling pattern (using existing infrastructure)

```javascript
// Import existing utilities -- DO NOT create new ones
import { asyncHandler, AppError } from '../utils/errorResponse.js';

// OK: With asyncHandler:
router.get('/wines', asyncHandler(async (req, res) => {
  const wines = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1').all(req.cellarId);
  res.json({ data: wines });
}));
// Errors automatically caught by errorHandler at server.js:77

// OK: With AppError for specific status codes:
router.get('/wines/:id', asyncHandler(async (req, res) => {
  const wine = await db.prepare('SELECT * FROM wines WHERE id = $1 AND cellar_id = $2').get(id, req.cellarId);
  if (!wine) throw AppError.notFound('Wine', id);
  res.json({ data: wine });
}));

// WRONG: Current (repeated ~202 times):
router.get('/wines', async (req, res) => {
  try {
    const wines = await db.prepare('SELECT * FROM wines WHERE cellar_id = $1').all(req.cellarId);
    res.json({ data: wines });
  } catch (error) {
    console.error('Get wines error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### Validation pattern

```javascript
// OK: Schema validation middleware (body, query, and params):
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { createCellarSchema } from '../schemas/cellar.js';
router.post('/', validateBody(createCellarSchema), asyncHandler(async (req, res) => { ... }));

// WRONG: Manual ad-hoc checking:
router.post('/', async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Name required' });
  // ...
});
```
