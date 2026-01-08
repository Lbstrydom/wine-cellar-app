/*
  Audit: API routes defined on the backend that appear not to be called from the frontend.

  Approach:
  1) Parse src/routes/index.js for router.use(mountPath, routeModule)
  2) Parse each route file for router.get/post/put/delete/patch('path', ...)
  3) For each route, compute a static prefix string up to the first parameter (:id) or wildcard.
  4) If that static prefix never appears in frontend JS under public/js/, flag as "not referenced".

  Notes:
  - Heuristic only; dynamic URL construction can cause false positives.
  - It does not understand router.route().get().post() chains.
*/

import fs from 'fs';
import path from 'path';

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

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

function normalizePath(p) {
  return p.replace(/\/+/g, '/');
}

function joinPaths(...parts) {
  const cleaned = parts
    .filter(Boolean)
    .map((p) => String(p))
    .map((p) => p.trim())
    .map((p) => (p === '/' ? '' : p))
    .map((p) => p.replace(/(^\/|\/$)/g, ''))
    .filter(Boolean);
  return '/' + cleaned.join('/');
}

function staticPrefix(routePath) {
  // routePath starts with '/'
  const idxParam = routePath.indexOf('/:');
  const idxWildcard = routePath.indexOf('/*');
  const cut = [idxParam, idxWildcard].filter((n) => n !== -1).sort((a, b) => a - b)[0];
  if (cut === undefined) return routePath;
  return routePath.slice(0, cut + 1); // keep trailing '/'
}

const repoRoot = process.cwd();
const routesIndexPath = path.join(repoRoot, 'src', 'routes', 'index.js');
const routesDir = path.join(repoRoot, 'src', 'routes');

const indexText = read(routesIndexPath);

// Map imported route module identifiers to file names.
const importMap = new Map();
for (const m of indexText.matchAll(/^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"](\.\/[^'"]+)['"];?/gm)) {
  importMap.set(m[1], m[2]);
}

// Collect mounts.
const mounts = [];
for (const m of indexText.matchAll(/router\.use\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
  const mountPath = m[1];
  const ident = m[2];
  const rel = importMap.get(ident);
  if (!rel) continue;
  mounts.push({ mountPath, routeFile: path.join(routesDir, rel.replace(/^\./, '')) });
}

// Frontend text
const frontendFiles = walk(path.join(repoRoot, 'public', 'js')).filter((p) => p.endsWith('.js'));
const frontendText = frontendFiles.map((p) => read(p)).join('\n');

function hasFrontendRef(str) {
  return frontendText.includes(str);
}

// Parse route definitions.
const routeDefs = [];
const methods = ['get', 'post', 'put', 'delete', 'patch'];

for (const mount of mounts) {
  const routeText = read(mount.routeFile);
  for (const method of methods) {
    const re = new RegExp(`\\brouter\\.${method}\\(\\s*['\"]([^'\"]+)['\"]`, 'g');
    for (const match of routeText.matchAll(re)) {
      const localPath = match[1];
      const idx = match.index;
      const line = 1 + routeText.slice(0, idx).split(/\r\n|\r|\n/).length - 1;

      // Compute full API path
      const mountNormalized = mount.mountPath === '/' ? '' : mount.mountPath;
      const full = joinPaths('/api', mountNormalized, localPath);
      const fullNorm = normalizePath(full);
      const prefix = normalizePath(staticPrefix(fullNorm));

      routeDefs.push({
        method: method.toUpperCase(),
        fullPath: fullNorm,
        staticPrefix: prefix,
        file: path.relative(repoRoot, mount.routeFile).replace(/\\/g, '/'),
        line,
      });
    }
  }
}

// Decide "unused" as: staticPrefix never appears in frontend.
const notReferenced = routeDefs.filter((r) => {
  // Ignore extremely generic prefixes.
  if (r.staticPrefix === '/api/' || r.staticPrefix === '/api') return false;
  return !hasFrontendRef(r.staticPrefix);
});

notReferenced.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

process.stdout.write(
  `${JSON.stringify({
    totalRoutesParsed: routeDefs.length,
    notReferencedCount: notReferenced.length,
    // Output only a sample to avoid massive console output.
    notReferencedSample: notReferenced.slice(0, 200),
  }, null, 2)}\n`
);
