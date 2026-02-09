/**
 * @fileoverview Tests to ensure API calls use authenticated fetch wrapper.
 * Prevents regression where raw fetch() is used instead of the auth-aware apiFetch.
 *
 * NOTE: Some existing files have raw fetch() calls that predate this test.
 * They are tracked in LEGACY_FILES and should be migrated over time.
 * New files must use api.js functions.
 */

import fs from 'fs';
import path from 'path';

const PUBLIC_JS_DIR = path.join(process.cwd(), 'public', 'js');

/**
 * Patterns that indicate raw fetch usage instead of API wrapper.
 * These should be flagged as potential auth header omissions.
 */
const RAW_FETCH_PATTERNS = [
  // Direct fetch to /api/* endpoints (should use api.js functions)
  /fetch\s*\(\s*['"`]\/api\//,
  // fetch with template literal to /api/*
  /fetch\s*\(\s*`\/api\//,
  // window.fetch to /api/*
  /window\.fetch\s*\(\s*['"`]\/api\//
];

/**
 * Pattern that indicates the file imports the authenticated fetch from api.js.
 * Files with this import shadow the global fetch — their bare fetch() calls are safe.
 * However, explicit window.fetch() calls still bypass the import and must be flagged.
 */
const IMPORTS_AUTH_FETCH = /import\s*\{[^}]*\bfetch\b[^}]*\}\s*from\s*['"]\.\/api\.js['"]/;

/**
 * Detects files that define a constant assigned to an API base path (e.g. const API_BASE = '/api').
 * Used to scope the interpolated-fetch check to API-relevant contexts only.
 */
const DEFINES_API_BASE = /(?:const|let|var)\s+\w+\s*=\s*['"]\/api['"]/;

/**
 * Matches fetch() calls using a template literal with an interpolated variable as the base URL.
 * Only flagged when the file also defines an API base constant (see DEFINES_API_BASE).
 */
const INTERPOLATED_FETCH = /fetch\s*\(\s*`\$\{[^}]+\}\//;

/**
 * Files that are allowed to use raw fetch (the API wrapper itself).
 */
const ALLOWED_FILES = [
  'api.js'  // The wrapper itself uses raw fetch internally
];

/**
 * Legacy files that have raw fetch() calls predating this test.
 * These should be migrated to use api.js functions over time.
 * DO NOT ADD NEW FILES HERE - fix them instead!
 *
 * Last audit: 9 February 2026
 */
const LEGACY_FILES = [
  'app.js',            // 1 call - /api/public-config (intentionally unauthenticated)
  'browserTests.js'    // 6 calls - test file, intentionally raw
];

/**
 * Scan file content for raw fetch violations.
 * Files that import authenticated fetch from api.js are only checked for
 * explicit window.fetch bypasses — bare fetch() is safe in those files.
 * @param {string} content - File source content
 * @returns {Array<{pattern: string, matches: number}>} Violations found
 */
function scanForViolations(content) {
  const violations = [];
  const usesAuthFetch = IMPORTS_AUTH_FETCH.test(content);

  for (const pattern of RAW_FETCH_PATTERNS) {
    // If file imports authenticated fetch, only flag explicit window.fetch bypasses
    if (usesAuthFetch && !pattern.source.includes('window')) continue;

    const matches = content.match(new RegExp(pattern.source, 'gm'));
    if (matches) {
      violations.push({ pattern: pattern.source, matches: matches.length });
    }
  }

  // Separate check: interpolated base URL (e.g. fetch(`${API_BASE}/...`))
  // Only flag if file defines an API base constant AND doesn't use auth fetch
  if (!usesAuthFetch && DEFINES_API_BASE.test(content)) {
    const matches = content.match(new RegExp(INTERPOLATED_FETCH.source, 'gm'));
    if (matches) {
      violations.push({ pattern: 'API base variable + fetch template literal', matches: matches.length });
    }
  }

  return violations;
}

describe('API Authentication Headers', () => {
  it('should not use raw fetch() for API calls in NEW frontend modules', () => {
    const jsFiles = fs.readdirSync(PUBLIC_JS_DIR)
      .filter(f => f.endsWith('.js') && !ALLOWED_FILES.includes(f) && !LEGACY_FILES.includes(f));

    const violations = [];

    for (const file of jsFiles) {
      const filePath = path.join(PUBLIC_JS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');

      for (const v of scanForViolations(content)) {
        violations.push({ file, ...v });
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v =>
        `  ${v.file}: ${v.matches} raw fetch() call(s) to /api/* endpoints\n` +
        `    Pattern: ${v.pattern}\n` +
        `    Fix: Import and use the appropriate function from api.js instead`
      ).join('\n');

      expect.fail(
        `Found raw fetch() calls to API endpoints. These will NOT include auth headers!\n\n` +
        `${details}\n\n` +
        `All API calls should use exported functions from api.js which automatically ` +
        `include Authorization and X-Cellar-ID headers.\n\n` +
        `If this is intentional (e.g., public endpoint), add to ALLOWED_FILES in the test.`
      );
    }
  });

  it('should not use raw fetch() for API calls in NEW bottles/ modules', () => {
    const bottlesDir = path.join(PUBLIC_JS_DIR, 'bottles');
    if (!fs.existsSync(bottlesDir)) {
      return; // Skip if directory doesn't exist
    }

    const legacyBottlesFiles = LEGACY_FILES
      .filter(f => f.startsWith('bottles/'))
      .map(f => f.replace('bottles/', ''));

    const jsFiles = fs.readdirSync(bottlesDir)
      .filter(f => f.endsWith('.js') && !legacyBottlesFiles.includes(f));

    const violations = [];

    for (const file of jsFiles) {
      const filePath = path.join(bottlesDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      for (const v of scanForViolations(content)) {
        violations.push({ file: `bottles/${file}`, ...v });
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v =>
        `  ${v.file}: ${v.matches} raw fetch() call(s)`
      ).join('\n');

      expect.fail(
        `Found raw fetch() calls in bottles/ modules:\n${details}\n\n` +
        `Use api.js functions instead.`
      );
    }
  });

  it('should not use raw fetch() for API calls in cellarAnalysis/ modules', () => {
    const analysisDir = path.join(PUBLIC_JS_DIR, 'cellarAnalysis');
    if (!fs.existsSync(analysisDir)) {
      return; // Skip if directory doesn't exist
    }

    const jsFiles = fs.readdirSync(analysisDir).filter(f => f.endsWith('.js'));
    const violations = [];

    for (const file of jsFiles) {
      const filePath = path.join(analysisDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      for (const v of scanForViolations(content)) {
        violations.push({ file: `cellarAnalysis/${file}`, ...v });
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v =>
        `  ${v.file}: ${v.matches} raw fetch() call(s)`
      ).join('\n');

      expect.fail(
        `Found raw fetch() calls in cellarAnalysis/ modules:\n${details}\n\n` +
        `Use api.js functions instead.`
      );
    }
  });

  it('should not use raw fetch() for API calls in restaurantPairing/ modules', () => {
    const pairingDir = path.join(PUBLIC_JS_DIR, 'restaurantPairing');
    if (!fs.existsSync(pairingDir)) {
      return; // Skip if directory doesn't exist (Phase C not yet started)
    }

    const jsFiles = fs.readdirSync(pairingDir).filter(f => f.endsWith('.js'));
    const violations = [];

    for (const file of jsFiles) {
      const filePath = path.join(pairingDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      for (const v of scanForViolations(content)) {
        violations.push({ file: `restaurantPairing/${file}`, ...v });
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v =>
        `  ${v.file}: ${v.matches} raw fetch() call(s)`
      ).join('\n');

      expect.fail(
        `Found raw fetch() calls in restaurantPairing/ modules:\n${details}\n\n` +
        `Use api.js functions instead.`
      );
    }
  });

  it('should document legacy files count for tracking migration progress', () => {
    // This test tracks the number of legacy files that need migration
    // As files are migrated, remove them from LEGACY_FILES and this count should decrease
    const legacyCount = LEGACY_FILES.length;

    // Log current count for visibility
    console.log(`Legacy files with raw fetch(): ${legacyCount}`);

    // If all legacy files are migrated, this test will fail as a reminder to remove this test
    expect(legacyCount).toBeGreaterThan(0);
  });
});
