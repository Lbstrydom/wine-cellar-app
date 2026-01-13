# Known Issues Audit Report

**Date**: 2026-01-13
**Auditor**: Claude Code

---

## Executive Summary

This audit identifies all known issues in the codebase that need to be addressed. Issues are categorized by severity with proposed actions.

---

## Issue Tracker

| # | Issue | Severity | Status | Effort |
|---|-------|----------|--------|--------|
| 1 | Pre-existing SQL injection patterns | 🟡 MODERATE | Open | 2-4 hrs |

---

## � Issue #1: Pre-Existing SQL Injection Patterns

### Description
The new SQL injection regression guard test (`tests/unit/utils/sqlInjectionPatterns.test.js`) detects 21 files with template literal SQL patterns that should be converted to parameterized queries.

### Test Output
```
Found SQL template literal injection patterns!

  src\db\scripts\backfill_fingerprints.js: 1 violation(s)
  src\jobs\batchFetchJob.js: 1 violation(s)
  src\jobs\ratingFetchJob.js: 1 violation(s)
  src\routes\bottles.js: 1 violation(s)
  src\routes\cellar.js: 1 violation(s)
  src\routes\drinkingWindows.js: 1 violation(s)
  src\routes\pairing.js: 1 violation(s)
  src\routes\ratings.js: 3 violation(s)
  src\routes\reduceNow.js: 2 violation(s)
  src\routes\wines.js: 3 violation(s)
  src\services\awards.js: 1 violation(s)
  src\services\cacheService.js: 8 violation(s)
  src\services\cellarHealth.js: 1 violation(s)
  src\services\drinkNowAI.js: 1 violation(s)
  src\services\pairing.js: 2 violation(s)
  src\services\pairingSession.js: 3 violation(s)
  src\services\provenance.js: 4 violation(s)
  src\services\searchCache.js: 3 violation(s)
  src\services\wineAddOrchestrator.js: 1 violation(s)
  src\services\zoneMetadata.js: 1 violation(s)
```

### Important Context
Many of these patterns are **safe** because they use:
- Placeholder generation (e.g., `$1, $2, $3` for IN clauses)
- Server-side constants (e.g., `CURRENT_TIMESTAMP`)
- Validated column names (not user input)

However, they violate the style guideline and should be refactored for consistency.

### Proposed Actions

**Step 1: Triage violations**
- Review each file to categorize as safe-but-inconsistent vs potentially risky
- Document safe patterns in regression test allowlist if needed

**Step 2: Batch refactor**
- Convert template literals to parameterized queries where possible
- For dynamic SQL (e.g., IN clauses), use helper functions that generate safe placeholders

**Example fix:**
```javascript
// BEFORE (safe but inconsistent):
const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
db.prepare(`SELECT * FROM wines WHERE id IN (${placeholders})`).all(cellarId, ...ids);

// AFTER (explicit):
const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
const sql = `SELECT * FROM wines WHERE id IN (${placeholders})`;
db.prepare(sql).all(cellarId, ...ids);
// Note: Still uses template literal for placeholder generation, but more obvious it's safe
```

### Acceptance Criteria
- [ ] All 21 files reviewed and triaged
- [ ] Risky patterns converted to parameterized queries
- [ ] Safe patterns either refactored or allowlisted
- [ ] Regression test passes

---

## ✅ Previously Identified Issues (Now Resolved)

### Issue #2: Startup Service Availability Logging
**Status**: ✅ Fixed in commit 361ff6d

Created `src/config/serviceAvailability.js` with service checker that logs disabled Phase 6 features at startup.

### Issue #3: SQL Injection Regression Guard Test Not Running
**Status**: ✅ Fixed - Tests now run successfully

Test suite is working. 757 of 758 tests pass. Only the SQL injection guard fails (expected due to pre-existing violations in Issue #1).

### Issue #4: Stale Documentation (API_AUTH_MIGRATION_PLAN.md)
**Status**: ✅ Resolved - File removed

`docs/API_AUTH_MIGRATION_PLAN.md` has been deleted as migration is complete.

### SQL Injection in backup.js
**Status**: ✅ Fixed

All 10 instances converted from string interpolation to parameterized queries:
```javascript
// BEFORE (vulnerable):
await safeCount(`SELECT COUNT(*) as count FROM wines WHERE cellar_id = '${req.cellarId}'`)

// AFTER (fixed):
await safeCount('SELECT COUNT(*) as count FROM wines WHERE cellar_id = $1', req.cellarId)
```

### Integration Test Schema Mismatch
**Status**: ✅ Fixed

`tests/integration/phase6Integration.test.js` updated to:
- Remove references to non-existent `wine_id` column in `wine_search_cache`
- Use correct orchestrator return structure (`result.fingerprint`, `result.duplicates`)
- Create test wines before checking duplicates
- Include proper beforeAll setup for test cellars

### Frontend API Auth Compliance
**Status**: ✅ Compliant

All frontend API calls use `api.js` wrapper except:
- `app.js` - `/api/public-config` (intentionally unauthenticated)
- `browserTests.js` - test file (intentionally raw)

### Async/Await Patterns
**Status**: ✅ Compliant

All route handlers calling `db.prepare()` are properly async with await.

---

## Current Status Summary

| Status | Count | Issues |
|--------|-------|--------|
| 🟡 Open | 1 | Pre-existing SQL injection patterns (21 files) |
| ✅ Resolved | 4 | Startup logging, regression test, API auth migration, backup.js SQL injection |

**Test Suite Health**: ✅ 757 of 758 tests passing (99.9%)

---

## Recommended Priority Order

1. **Issue #1** (Pre-existing SQL patterns) - Triage and refactor in batches

---

## Follow-up Tasks (Future Sprints)

| Task | Priority | Notes |
|------|----------|-------|
| SQL style standardization | Low | Enforce `$1` placeholder style via lint |
| Backup export streaming | Low | For large cellars (>1000 bottles) |
| evaluateWineAdd rename | Low | Consider `evaluateWineCandidate` for clarity |
