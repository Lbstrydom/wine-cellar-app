/*
  Audit: backend mounted /api route bases that are never referenced by the frontend.
  Heuristic: compares `src/routes/index.js` router.use mounts against any string/template usage
  of `/api/<base>` in frontend JS under `public/js/`.

  NOTE: This can have false positives/negatives when endpoints are built dynamically.
*/

import fs from 'fs';
import path from 'path';

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractFrontendApiBases(frontendText) {
  const used = new Set();

  // Robust heuristic: find any occurrence of /api/<base> anywhere in text,
  // including template literals like `${API_BASE}/api/cellar/analyse`.
  for (const m of frontendText.matchAll(/\/api\/([a-z0-9-]+)/gi)) {
    const base = m[1];
    if (base) used.add(`/api/${base}`);
  }

  return used;
}

function extractMountedBases(routeIndexText) {
  const mounts = [];
  for (const m of routeIndexText.matchAll(/router\.use\(\s*['"]([^'"]+)['"]/g)) {
    mounts.push(m[1]);
  }

  const bases = mounts
    .map((p) => (p.startsWith('/') ? p : `/${p}`))
    .map((p) => (p === '/' ? '/api' : `/api${p}`))
    .sort();

  return bases;
}

const repoRoot = process.cwd();
const routeIndexPath = path.join(repoRoot, 'src', 'routes', 'index.js');
const frontendFiles = walk(path.join(repoRoot, 'public', 'js')).filter((p) => p.endsWith('.js'));

const frontendText = frontendFiles.map((p) => readText(p)).join('\n');
const usedApiBases = extractFrontendApiBases(frontendText);

const routeIndexText = readText(routeIndexPath);
const mountedApiBases = extractMountedBases(routeIndexText);

const notSeenInFrontend = mountedApiBases.filter((b) => {
  if (b === '/api') return false; // root mount contains nested /wines/:id/drinking-windows etc.
  return !usedApiBases.has(b);
});

const result = {
  mountedApiBases,
  frontendBases: [...usedApiBases].sort(),
  notSeenInFrontend,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
