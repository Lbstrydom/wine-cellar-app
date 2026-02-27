#!/usr/bin/env node
/**
 * @fileoverview Packages the Chrome extension into a distributable ZIP file.
 *
 * Steps:
 *   1. Copy icons from public/images/ into extension/icons/
 *   2. Zip extension/ → dist/wine-cellar-extension.zip
 *
 * Usage:
 *   node scripts/packageExtension.js
 *   npm run ext:package
 *
 * Chrome Web Store submission:
 *   https://chrome.google.com/webstore/devconsole
 */

import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const EXT_DIR   = resolve(ROOT, 'extension');
const DIST_DIR  = resolve(ROOT, 'dist');
const OUT_ZIP   = resolve(DIST_DIR, 'wine-cellar-extension.zip');

// ── 1. Validate extension directory ──────────────────────────────────────────

if (!existsSync(EXT_DIR)) {
  console.error(`ERROR: extension/ directory not found at ${EXT_DIR}`);
  process.exit(1);
}

// ── 2. Copy icons ─────────────────────────────────────────────────────────────

console.log('Copying icons…');

const ICONS_DIR = resolve(EXT_DIR, 'icons');
mkdirSync(ICONS_DIR, { recursive: true });

const ICON_MAP = [
  ['public/images/favicon-16.png',  'icons/icon16.png'],
  ['public/images/favicon-32.png',  'icons/icon32.png'],
  ['public/images/icon-128.png',    'icons/icon128.png']
];

for (const [src, dst] of ICON_MAP) {
  const srcPath = resolve(ROOT, src);
  const dstPath = resolve(EXT_DIR, dst);
  if (!existsSync(srcPath)) {
    console.warn(`  ⚠ Source not found: ${src} — skipping`);
    continue;
  }
  cpSync(srcPath, dstPath);
  console.log(`  ✓ ${src} → extension/${dst}`);
}

// ── 3. Prepare dist directory ─────────────────────────────────────────────────

console.log('Preparing dist/…');
mkdirSync(DIST_DIR, { recursive: true });

// Remove old zip
try {
  rmSync(OUT_ZIP);
  console.log('  ✓ Removed old zip');
} catch (_) { /* no old zip */ }

// ── 4. Create ZIP ─────────────────────────────────────────────────────────────

console.log('Creating ZIP…');

const isWindows = process.platform === 'win32';

if (isWindows) {
  // PowerShell is available on all modern Windows versions
  const cmd = `powershell -Command "Compress-Archive -Path '${EXT_DIR}\\*' -DestinationPath '${OUT_ZIP}' -Force"`;
  execSync(cmd, { stdio: 'inherit' });
} else {
  // zip is available on macOS / Linux CI
  execSync(`cd "${EXT_DIR}" && zip -r "${OUT_ZIP}" .`, { stdio: 'inherit' });
}

console.log(`\n✅  Extension packaged: dist/wine-cellar-extension.zip`);
console.log('    Upload at: https://chrome.google.com/webstore/devconsole');
