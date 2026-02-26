/**
 * @fileoverview Regression test: ensures every JS module reachable from app.js
 * is listed in the SW STATIC_ASSETS pre-cache list.
 *
 * Root cause of the Feb 2026 production outage: sw.js was not updated across
 * 7 commits that added new frontend modules. The SW served stale cached
 * copies of api/index.js and api/cellar.js that lacked new exports, crashing
 * the entire ES module tree.
 *
 * This test prevents recurrence by:
 *   1. Parsing sw.js STATIC_ASSETS array
 *   2. Walking the import tree starting from app.js
 *   3. Failing if any reachable module is missing from STATIC_ASSETS
 *
 * Allowlist: browserTests.js (dev-only, loaded via console import())
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.resolve('public');
const SW_PATH = path.join(PUBLIC_DIR, 'sw.js');

/** Files intentionally excluded from SW pre-cache (dev-only, not in module tree) */
const ALLOWLIST = new Set([
  '/js/browserTests.js'
]);

/**
 * Lazy-loaded entry points that use dynamic import() in app.js or other roots.
 * The main walkImportTree only follows static `import ... from` statements.
 * These entry points are walked separately to catch their dependency trees.
 */
const LAZY_ENTRYPOINTS = [
  '/js/recipes.js',
];

/**
 * Extract STATIC_ASSETS entries from sw.js.
 * @returns {Set<string>} Set of paths like '/js/app.js'
 */
function parseStaticAssets() {
  const content = fs.readFileSync(SW_PATH, 'utf8');
  const match = content.match(/const STATIC_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  if (!match) throw new Error('Could not find STATIC_ASSETS in sw.js');

  const entries = new Set();
  const entryPattern = /'([^']+)'/g;
  let m;
  while ((m = entryPattern.exec(match[1])) !== null) {
    // Strip query strings for comparison (CSS versions)
    entries.add(m[1].replace(/\?.*$/, ''));
  }
  return entries;
}

/**
 * Extract static import paths from a JS file.
 * Only handles `import ... from '...'` and `import '...'` (not dynamic import()).
 * @param {string} filePath - Absolute path to the JS file
 * @returns {string[]} Array of relative import specifiers
 */
function extractImports(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  // Match: import { ... } from './foo.js'  or  import './foo.js'
  const pattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/**
 * Extract dynamic import() paths from a JS file.
 * Matches patterns like: import('./foo.js') and import("./bar.js")
 * @param {string} filePath - Absolute path to the JS file
 * @returns {string[]} Array of relative import specifiers
 */
function extractDynamicImports(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  const pattern = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/**
 * Discover dynamic import entry points from root modules.
 * @param {string[]} rootWebPaths - Root web paths to scan for dynamic imports
 * @returns {string[]} Resolved web paths of dynamically imported modules
 */
function discoverDynamicEntrypoints(rootWebPaths) {
  const entrypoints = [];
  for (const rootPath of rootWebPaths) {
    const filePath = path.join(PUBLIC_DIR, rootPath);
    const dynamicImports = extractDynamicImports(filePath);
    for (const imp of dynamicImports) {
      const dir = path.dirname(rootPath);
      const resolved = path.posix.normalize(`${dir}/${imp}`);
      entrypoints.push(resolved);
    }
  }
  return entrypoints;
}

/**
 * Walk the import tree from a root module, collecting all reachable modules.
 * @param {string} rootWebPath - Web path like '/js/app.js'
 * @returns {Set<string>} All reachable web paths
 */
function walkImportTree(rootWebPath) {
  const visited = new Set();
  const queue = [rootWebPath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const filePath = path.join(PUBLIC_DIR, current);
    const imports = extractImports(filePath);

    for (const imp of imports) {
      const dir = path.dirname(current);
      const resolved = path.posix.normalize(`${dir}/${imp}`);
      if (!visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

describe('SW STATIC_ASSETS completeness', () => {
  it('every JS module reachable from app.js (including lazy imports) is in SW STATIC_ASSETS', () => {
    const staticAssets = parseStaticAssets();
    const staticRoots = ['/js/app.js', '/js/pairing.js'];
    const reachable = new Set();

    // Walk static import trees from all roots
    for (const root of staticRoots) {
      for (const p of walkImportTree(root)) reachable.add(p);
    }

    // Auto-discover dynamic import() calls from root files
    const dynamicEntrypoints = discoverDynamicEntrypoints(staticRoots);

    // Combine with manually declared LAZY_ENTRYPOINTS
    const allLazy = [...new Set([...LAZY_ENTRYPOINTS, ...dynamicEntrypoints])];

    // Walk each lazy entrypoint's static import tree
    for (const entry of allLazy) {
      for (const p of walkImportTree(entry)) reachable.add(p);
    }

    const missingModules = [];
    for (const modulePath of reachable) {
      if (!modulePath.endsWith('.js')) continue;
      if (ALLOWLIST.has(modulePath)) continue;
      if (!staticAssets.has(modulePath)) {
        missingModules.push(modulePath);
      }
    }

    if (missingModules.length > 0) {
      const list = missingModules.toSorted((a, b) => a.localeCompare(b)).map(m => `  - ${m}`).join('\n');
      expect.fail(
        `${missingModules.length} JS module(s) reachable from app.js are NOT in sw.js STATIC_ASSETS.\n` +
        `This will cause stale SW cache to crash the app.\n` +
        `Add them to STATIC_ASSETS in public/sw.js:\n${list}`
      );
    }
  });

  it('STATIC_ASSETS JS entries all point to files that exist', () => {
    const staticAssets = parseStaticAssets();
    const missingFiles = [];

    for (const asset of staticAssets) {
      if (!asset.startsWith('/js/')) continue;
      const filePath = path.join(PUBLIC_DIR, asset);
      if (!fs.existsSync(filePath)) {
        missingFiles.push(asset);
      }
    }

    if (missingFiles.length > 0) {
      const list = missingFiles.toSorted((a, b) => a.localeCompare(b)).map(m => `  - ${m}`).join('\n');
      expect.fail(
        `${missingFiles.length} STATIC_ASSETS entry/ies point to non-existent files:\n${list}`
      );
    }
  });

  it('CSS version strings match between index.html and sw.js', () => {
    const swContent = fs.readFileSync(SW_PATH, 'utf8');
    const htmlContent = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

    // Extract CSS version from index.html (styles.css?v=XXXXXXXXX)
    const htmlMatch = htmlContent.match(/styles\.css\?v=([^"']+)/);
    expect(htmlMatch, 'Could not find styles.css version in index.html').toBeTruthy();

    // Extract CSS version from sw.js
    const swMatch = swContent.match(/styles\.css\?v=([^']+)/);
    expect(swMatch, 'Could not find styles.css version in sw.js').toBeTruthy();

    expect(swMatch[1]).toBe(htmlMatch[1]);
  });
});
