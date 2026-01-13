# API Authentication Migration Plan

**Created:** 13 January 2026
**Purpose:** Track migration of raw `fetch()` calls to use `api.js` authenticated wrapper
**Status:** Planning

---

## Problem

31 raw `fetch()` calls to `/api/*` endpoints exist across 10 frontend files. These calls:
- May fail with 401 Unauthorized if they require authentication
- Don't include the `X-Cellar-ID` header needed for multi-tenant isolation
- Could leak data across cellars if the endpoint doesn't enforce cellar scoping server-side

---

## Migration Strategy

For each file, we need to:
1. Identify which endpoints are called
2. Check if an `api.js` function already exists for that endpoint
3. If not, add the function to `api.js`
4. Update the file to import and use the `api.js` function
5. Remove the file from `LEGACY_FILES` in the test

---

## Files to Migrate (31 violations across 10 files)

### Priority 1: Data Endpoints (Security Critical)

These endpoints access user data and MUST have proper auth headers.

#### `ratings.js` - 6 calls (3 unique)
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 367 | `POST /api/wines/:id/ratings/fetch-async` | Yes | Add `fetchRatingsAsync(wineId)` |
| 406 | `GET /api/wines/:id` | Yes | Use existing `getWine(id)` |
| 463 | `GET /api/ratings/jobs/:id/status` | Yes | Add `getRatingsJobStatus(jobId)` |

#### `tastingService.js` - 8 calls (4 unique)
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 48 | `GET /api/wines/:id/tasting-notes` | Yes | Add `getTastingNotes(wineId)` |
| 65 | `GET /api/wines/:id/serving-temperature` | Yes | Add `getServingTemperature(wineId)` |
| 82 | `GET /api/wines/:id/drinking-windows/best` | Yes | Add `getBestDrinkingWindow(wineId)` |
| 644 | `POST /api/wines/:id/tasting-notes/report` | Yes | Add `reportTastingNotes(wineId, data)` |

#### `modals.js` - 2 calls (1 unique)
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 140 | `GET /api/wines/:id/personal-rating` | Yes | Add `getPersonalRating(wineId)` |

#### `settings.js` - 2 calls (2 unique)
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 775 | `GET /api/awards/competitions` | Yes | Add `getAwardCompetitions()` |
| 1117 | `POST /api/backup/import` | Yes | Add `importBackup(data)` |

#### `pairing.js` - 2 calls (1 unique)
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 69 | `POST /api/pairing/sessions/:id/choose` | Yes | Add `choosePairingWine(sessionId, wineId)` |

#### `sommelier.js` - 2 calls (1 unique)
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 113 | `POST /api/pairing/sessions/:id/feedback` | Yes | Add `submitPairingFeedback(sessionId, data)` |

#### `bottles/form.js` - 1 call
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 156 | `GET /api/wine-search/status` | Yes | Add `getWineSearchStatus()` |

### Priority 2: Intentionally Unauthenticated

#### `app.js` - 1 call
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 81 | `GET /api/public-config` | **No** | Keep as-is (intentionally public) |

**Note:** This endpoint returns Supabase public config and MUST be callable before authentication. Keep in `LEGACY_FILES` with comment.

#### `errorBoundary.js` - 1 call
| Line | Endpoint | Auth Required | Migration |
|------|----------|---------------|-----------|
| 159 | `POST /api/errors/log` | **Maybe** | Review - should errors be loggable pre-auth? |

**Note:** Error logging should probably work even if user isn't authenticated. May need server-side adjustment to allow unauthenticated error reports, or add to api.js with optional auth.

### Priority 3: Test Files (OK to Skip)

#### `browserTests.js` - 6 calls
| Line | Endpoint | Notes |
|------|----------|-------|
| 160 | `GET /api/wines` | Test file - intentionally raw |
| 176 | `GET /api/wines?limit=3&offset=1` | Test file - intentionally raw |
| 194 | `POST /api/slots/move` | Test file - intentionally raw |
| 205 | `POST /api/slots/move` | Test file - intentionally raw |
| 215 | `POST /api/wines` | Test file - intentionally raw |
| 234 | `GET /api/stats` | Test file - intentionally raw |

**Note:** `browserTests.js` is a test file that intentionally uses raw fetch to test API endpoints directly. Keep in `LEGACY_FILES` permanently.

---

## New api.js Functions Needed

```javascript
// ratings.js support
export async function fetchRatingsAsync(wineId) { ... }
export async function getRatingsJobStatus(jobId) { ... }

// tastingService.js support
export async function getTastingNotes(wineId, includeSources = false) { ... }
export async function getServingTemperature(wineId) { ... }
export async function getBestDrinkingWindow(wineId) { ... }
export async function reportTastingNotes(wineId, data) { ... }

// modals.js support
export async function getPersonalRating(wineId) { ... }

// settings.js support
export async function getAwardCompetitions() { ... }
export async function importBackup(data, options) { ... }

// pairing.js support
export async function choosePairingWine(sessionId, wineId) { ... }

// sommelier.js support
export async function submitPairingFeedback(sessionId, data) { ... }

// bottles/form.js support
export async function getWineSearchStatus() { ... }
```

---

## Migration Order

1. **Phase A: Add api.js functions** (no breaking changes)
   - Add all 12 new functions to api.js
   - Test each function works

2. **Phase B: Migrate data files** (one at a time)
   - `tastingService.js` (4 endpoints, highest count)
   - `ratings.js` (3 endpoints)
   - `settings.js` (2 endpoints)
   - `modals.js` (1 endpoint)
   - `pairing.js` (1 endpoint)
   - `sommelier.js` (1 endpoint)
   - `bottles/form.js` (1 endpoint)

3. **Phase C: Update test allowlist**
   - Remove migrated files from `LEGACY_FILES`
   - Keep `app.js`, `browserTests.js`, `errorBoundary.js` with comments

---

## Final LEGACY_FILES (after migration)

```javascript
const LEGACY_FILES = [
  'app.js',            // 1 call - /api/public-config (intentionally unauthenticated)
  'browserTests.js',   // 6 calls - test file, intentionally raw
  'errorBoundary.js',  // 1 call - error reporting (may need to work pre-auth)
];
```

---

## Estimated Effort

| Task | LOC | Time |
|------|-----|------|
| Add 12 api.js functions | ~120 | 30 min |
| Migrate 7 files | ~50 | 45 min |
| Test changes | - | 15 min |
| Update test allowlist | ~5 | 5 min |
| **Total** | ~175 | ~1.5 hours |

---

## Success Criteria

- [ ] All 12 new api.js functions added and exported
- [ ] 7 data files migrated to use api.js
- [ ] `LEGACY_FILES` reduced from 10 to 3
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual test: ratings, tasting notes, pairings work correctly

---

*Plan created: 13 January 2026*
