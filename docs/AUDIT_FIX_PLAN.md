# Plan: Fix Audit Issues (Revised)

**Date**: 2026-01-13
**Scope**: Fix 3 CRITICAL + 1 MODERATE issues from audit report
**Revision**: Incorporates feedback on parameter handling, regression guards, and logging clarity

---

## Overview

Fix all issues identified in the audit:
1. **CRITICAL**: SQL string interpolation in `backup.js`
2. **CRITICAL**: Integration test schema mismatch (nonexistent `wine_id` column)
3. **CRITICAL**: Integration test expectation mismatch (wrong return structure)
4. **MODERATE**: Add startup warnings when Phase 6 features disabled

---

## DB API Clarification

The `db.prepare(sql).get/all/run()` methods use **varargs** (not arrays):

```javascript
// From src/db/postgres.js:90-91
async get(...params) {
  const result = await self.pool.query(pgSql, params);
  return result.rows[0] || null;
}
```

So the correct call pattern is:
```javascript
db.prepare('SELECT * FROM wines WHERE cellar_id = $1').get(req.cellarId)  // ✓ varargs
db.prepare('SELECT * FROM wines WHERE cellar_id = $1').get([req.cellarId])  // ✗ would fail
```

---

## Issue 1: SQL Injection Pattern in backup.js

### Files to Modify
- `src/routes/backup.js`

### Changes

**Step 1.1**: Update `safeCount()` function (lines 27-36)
```javascript
// FROM:
async function safeCount(sql) {
  try {
    const result = await db.prepare(sql).get();
    return result?.count || 0;
  } catch (err) { ... }
}

// TO:
async function safeCount(sql, ...params) {
  try {
    const result = await db.prepare(sql).get(...params);
    // COUNT(*) may return string in some drivers - ensure number
    return Number(result?.count) || 0;
  } catch (err) { ... }
}
```

**Step 1.2**: Update `safeDelete()` function (lines 42-49)
```javascript
// FROM:
async function safeDelete(sql) { ... }

// TO:
async function safeDelete(sql, ...params) {
  try {
    await db.prepare(sql).run(...params);
  } catch (err) { ... }
}
```

**Step 1.3**: Update `safeQuery()` function (lines 359-367)
```javascript
// FROM:
async function safeQuery(sql) { ... }

// TO:
async function safeQuery(sql, ...params) {
  try {
    return await db.prepare(sql).all(...params);
  } catch (err) { ... }
}
```

**Step 1.4**: Update `/info` route (lines 58-61)
```javascript
// FROM:
wines: await safeCount(`SELECT COUNT(*) as count FROM wines WHERE cellar_id = '${req.cellarId}'`),

// TO:
wines: await safeCount('SELECT COUNT(*) as count FROM wines WHERE cellar_id = $1', req.cellarId),
slots: await safeCount('SELECT COUNT(*) as count FROM slots WHERE cellar_id = $1 AND wine_id IS NOT NULL', req.cellarId),
history: await safeCount('SELECT COUNT(*) as count FROM consumption_log WHERE cellar_id = $1', req.cellarId),
ratings: await safeCount('SELECT COUNT(*) as count FROM wine_ratings WHERE wine_id IN (SELECT id FROM wines WHERE cellar_id = $1)', req.cellarId),
```

**Step 1.5**: Update `/export/json` route (lines 85-90)
```javascript
// Convert all 6 safeQuery() calls to parameterized format
wine_ratings: await safeQuery('SELECT * FROM wine_ratings WHERE wine_id IN (SELECT id FROM wines WHERE cellar_id = $1)', req.cellarId),
consumption_log: await safeQuery('SELECT * FROM consumption_log WHERE cellar_id = $1', req.cellarId),
drinking_windows: await safeQuery('SELECT * FROM drinking_windows WHERE wine_id IN (SELECT id FROM wines WHERE cellar_id = $1)', req.cellarId),
user_settings: await safeQuery('SELECT * FROM user_settings WHERE cellar_id = $1', req.cellarId),
data_provenance: await safeQuery('SELECT * FROM data_provenance WHERE cellar_id = $1', req.cellarId),
reduce_now: await safeQuery('SELECT * FROM reduce_now WHERE cellar_id = $1', req.cellarId),
```

---

## Issue 1b: Add Regression Guard for SQL Injection

### Files to Create
- `tests/unit/utils/sqlInjectionPatterns.test.js`

### Purpose
Prevent future SQL template literal injection patterns (same idea as `apiAuthHeaders.test.js` for frontend auth).

### Implementation
```javascript
/**
 * @fileoverview Tests to prevent SQL injection via template literals.
 * Scans backend code for db.prepare() calls containing ${...} patterns.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.join(process.cwd(), 'src');

// Pattern: db.prepare(`...${...}...`) - template literal with interpolation
const SQL_INJECTION_PATTERNS = [
  /db\.prepare\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/g
];

const ALLOWED_FILES = [
  // None - all files should use parameterized queries
];

function scanDirectory(dir, violations = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && entry.name !== 'node_modules') {
      scanDirectory(fullPath, violations);
    } else if (entry.name.endsWith('.js')) {
      const relativePath = path.relative(process.cwd(), fullPath);
      if (ALLOWED_FILES.includes(relativePath)) continue;

      const content = fs.readFileSync(fullPath, 'utf8');

      for (const pattern of SQL_INJECTION_PATTERNS) {
        const matches = content.match(pattern);
        if (matches) {
          violations.push({
            file: relativePath,
            matches: matches.length,
            examples: matches.slice(0, 2)
          });
        }
      }
    }
  }

  return violations;
}

describe('SQL Injection Prevention', () => {
  it('should not use template literals with interpolation in db.prepare()', () => {
    const violations = scanDirectory(SRC_DIR);

    if (violations.length > 0) {
      const details = violations.map(v =>
        `  ${v.file}: ${v.matches} violation(s)\n` +
        `    Example: ${v.examples[0]?.substring(0, 80)}...`
      ).join('\n');

      expect.fail(
        `Found SQL template literal injection patterns!\n\n` +
        `${details}\n\n` +
        `Use parameterized queries instead:\n` +
        `  ✗ db.prepare(\`SELECT * FROM t WHERE id = '\${id}'\`).get()\n` +
        `  ✓ db.prepare('SELECT * FROM t WHERE id = $1').get(id)`
      );
    }
  });
});
```

---

## Issue 2 & 3: Integration Test Fixes

### Files to Modify
- `tests/integration/phase6Integration.test.js`

### Decision: Test Realistic Flow

The test will exercise a **realistic flow**:
1. Create a wine through DB helper (simulating existing wine)
2. Run `evaluateWineAdd()` with same fingerprint input
3. Assert `duplicates` array contains the created wine
4. Validate fingerprint matching works with cellar scoping

### Actual Orchestrator Return Structure
From `wineAddOrchestrator.js:257-266`:
```javascript
{
  fingerprint,           // string - the computed fingerprint
  fingerprint_version,   // number - always 1 currently
  pipeline_version,      // number - pipeline version
  query_hash,            // string - cache key hash
  duplicates,            // array - wines with matching fingerprint
  matches,               // array - external search matches
  auto_select,           // object|null - auto-selected match
  cache_hit              // boolean - whether result was cached
}
```

### Implementation

**Step 2.1**: Remove invalid cleanup (line 20 area)
```javascript
// REMOVE: wine_search_cache doesn't have wine_id column
// await db.prepare('DELETE FROM wine_search_cache WHERE wine_id = $1').run(testWineId);

// REPLACE WITH: cleanup by fingerprint + cellar_id
await db.prepare('DELETE FROM wine_search_cache WHERE cellar_id = $1 AND fingerprint = $2')
  .run(testCellarId, testFingerprint);
```

**Step 2.2**: Fix first test - "generates fingerprint for new wine"
```javascript
// Test fingerprint generation (no duplicates expected)
it('generates fingerprint for new wine', async () => {
  const wineData = {
    wine_name: 'Test Estate Cabernet',
    producer: 'Test Estate',
    vintage: 2020,
    country: 'South Africa',
    region: 'Stellenbosch'
  };

  const result = await evaluateWineAdd(wineData, testCellarId);

  // Validate return structure
  expect(result.fingerprint).toBeTruthy();
  expect(result.fingerprint_version).toBe(1);
  expect(result.duplicates).toBeDefined();
  expect(Array.isArray(result.duplicates)).toBe(true);
  expect(result.duplicates.length).toBe(0); // No duplicates for new wine

  // Store fingerprint for next test
  testFingerprint = result.fingerprint;
});
```

**Step 2.3**: Fix second test - "detects duplicates by fingerprint"
```javascript
it('detects duplicates by fingerprint', async () => {
  // First, create a wine in the database with known fingerprint
  const insertResult = await db.prepare(`
    INSERT INTO wines (cellar_id, wine_name, producer, vintage, country, region, fingerprint, fingerprint_version)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `).get(testCellarId, 'Test Estate Cabernet', 'Test Estate', 2020, 'South Africa', 'Stellenbosch', testFingerprint, 1);

  testWineId = insertResult.id;

  // Now evaluate the same wine - should find duplicate
  const wineData = {
    wine_name: 'Test Estate Cabernet',
    producer: 'Test Estate',
    vintage: 2020,
    country: 'South Africa',
    region: 'Stellenbosch'
  };

  const result = await evaluateWineAdd(wineData, testCellarId);

  // Should detect duplicate
  expect(result.duplicates.length).toBeGreaterThan(0);
  expect(result.duplicates[0].id).toBe(testWineId);
  expect(result.duplicates[0].fingerprint).toBe(testFingerprint);
});
```

**Step 2.4**: Add cleanup in afterEach
```javascript
afterEach(async () => {
  if (testWineId) {
    await db.prepare('DELETE FROM wines WHERE id = $1').run(testWineId);
    testWineId = null;
  }
  if (testFingerprint && testCellarId) {
    await db.prepare('DELETE FROM wine_search_cache WHERE cellar_id = $1 AND fingerprint = $2')
      .run(testCellarId, testFingerprint);
  }
});
```

---

## Issue 4: Startup Warnings for Disabled Features

### Files to Create
- `src/config/serviceAvailability.js`

### Files to Modify
- `src/server.js`

### Changes

**Step 4.1**: Create `src/config/serviceAvailability.js`

Key improvements from feedback:
- Show "enabled via fallback" when fallback vars present
- Report feature flag state alongside env var presence
- Clear operator-friendly messaging

```javascript
/**
 * @fileoverview Service availability checker for Phase 6 features.
 * Reports which external services are configured at startup.
 * @module config/serviceAvailability
 */

import logger from '../utils/logger.js';
import { FEATURE_FLAGS } from './featureFlags.js';

/**
 * Service definitions with required and fallback env vars.
 */
const SERVICES = {
  wineSearch: {
    name: 'Wine Search Integration',
    featureFlag: 'WINE_ADD_ORCHESTRATOR_ENABLED',
    primary: ['BRIGHTDATA_API_KEY'],
    optional: ['BRIGHTDATA_SERP_ZONE', 'BRIGHTDATA_WEB_ZONE']
  },
  sommelier: {
    name: 'AI Sommelier & Awards',
    primary: ['ANTHROPIC_API_KEY']
  },
  zoneAdvisor: {
    name: 'Zone Reconfiguration Advisor',
    primary: ['OPENAI_API_KEY'],
    featureFlag: 'OPENAI_REVIEW_ZONE_RECONFIG'
  },
  ratings: {
    name: 'External Ratings',
    primary: ['BRIGHTDATA_API_KEY'],
    fallback: ['GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID']
  }
};

/**
 * Check availability of all services.
 * @returns {Array<{key: string, name: string, status: string, reason: string}>}
 */
export function checkServiceAvailability() {
  const results = [];

  for (const [key, service] of Object.entries(SERVICES)) {
    const hasPrimary = service.primary.every(v => !!process.env[v]);
    const hasFallback = service.fallback?.every(v => !!process.env[v]) || false;
    const flagEnabled = service.featureFlag ? FEATURE_FLAGS[service.featureFlag] !== false : true;

    let status, reason;

    if (!flagEnabled) {
      status = 'disabled';
      reason = `feature flag ${service.featureFlag}=false`;
    } else if (hasPrimary) {
      status = 'enabled';
      reason = null;
    } else if (hasFallback) {
      status = 'enabled';
      reason = `via fallback (${service.fallback.join(', ')})`;
    } else {
      status = 'disabled';
      reason = `missing: ${service.primary.filter(v => !process.env[v]).join(', ')}`;
    }

    results.push({ key, name: service.name, status, reason });
  }

  return results;
}

/**
 * Log service status at startup.
 * Only logs if any services are disabled (to avoid noise when all is well).
 */
export function logServiceStatus() {
  const services = checkServiceAvailability();
  const disabled = services.filter(s => s.status === 'disabled');
  const enabledViaFallback = services.filter(s => s.status === 'enabled' && s.reason);

  // Only show status block if there's something noteworthy
  if (disabled.length > 0 || enabledViaFallback.length > 0) {
    logger.info('Startup', '--- Phase 6 Feature Status ---');

    for (const service of services) {
      if (service.status === 'enabled' && !service.reason) {
        logger.info('Startup', `✓ ${service.name}: ENABLED`);
      } else if (service.status === 'enabled' && service.reason) {
        logger.info('Startup', `✓ ${service.name}: ENABLED (${service.reason})`);
      } else {
        logger.warn('Startup', `✗ ${service.name}: DISABLED (${service.reason})`);
      }
    }

    if (disabled.length > 0) {
      logger.info('Startup', `Configure missing env vars to enable all features`);
    }

    logger.info('Startup', '-------------------------------');
  }
}
```

**Step 4.2**: Update `src/server.js`

Add import and call after job queue starts:
```javascript
import { logServiceStatus } from './config/serviceAvailability.js';

// After jobQueue.start(); (around line 83)
logServiceStatus();
```

---

## Verification & Acceptance Criteria

### Automated Tests
```bash
# Run all tests
npm run test:all

# Specifically verify new SQL injection guard
npm run test:unit -- tests/unit/utils/sqlInjectionPatterns.test.js

# Verify integration tests pass
npm run test:integration
```

### Manual Verification

| Check | Command/Action | Expected Result |
|-------|----------------|-----------------|
| No SQL injection patterns | `grep -rn "db\.prepare.*\\\${" src/` | No matches |
| Backup info works | `curl /api/backup/info` | Returns counts (numbers, not strings) |
| Startup with missing vars | Start server without BRIGHTDATA_API_KEY | See WARN log for Wine Search |
| Startup with fallback | Set GOOGLE_SEARCH_* only | See "enabled via fallback" |
| Startup all configured | Set all env vars | No status block (all quiet) |

### PR Acceptance Criteria

- [ ] **backup.js**: Zero `${...}` in any `db.prepare()` call
- [ ] **backup.js**: `safeCount/safeQuery/safeDelete` accept `...params` and pass them through
- [ ] **backup.js**: `safeCount` returns `Number(result?.count)` to handle string counts
- [ ] **sqlInjectionPatterns.test.js**: New test exists and passes
- [ ] **phase6Integration.test.js**: No reference to `wine_search_cache.wine_id`
- [ ] **phase6Integration.test.js**: Asserts on `result.fingerprint`, `result.duplicates` (not `result.wine`)
- [ ] **phase6Integration.test.js**: Creates wine first, then checks for duplicate detection
- [ ] **serviceAvailability.js**: Shows "enabled via fallback" when fallback vars present
- [ ] **serviceAvailability.js**: Shows feature flag state when flag disables service
- [ ] **server.js**: Calls `logServiceStatus()` after startup

---

## Follow-up Tasks (Out of Scope)

These are valid concerns but not blockers for this PR:

1. **SQL style standardization** - Create lint rule or test to enforce `$1` style everywhere
2. **Backup export scaling** - Consider streaming for large cellars (>1000 bottles)
3. **evaluateWineAdd naming** - Consider rename to `evaluateWineCandidate` for clarity

---

## Summary

| Issue | Severity | Files Changed | Key Changes |
|-------|----------|---------------|-------------|
| SQL injection | CRITICAL | backup.js | Parameterize 10 queries, add Number() cast |
| Regression guard | NEW | sqlInjectionPatterns.test.js | Scan for `db.prepare(\`...\${}\`)` |
| Test schema | CRITICAL | phase6Integration.test.js | Remove wine_id references |
| Test expectations | CRITICAL | phase6Integration.test.js | Use actual return structure |
| Startup warnings | MODERATE | serviceAvailability.js, server.js | Show fallback/flag state |

**Total**: 4 files modified, 1 new file, ~200 lines changed
