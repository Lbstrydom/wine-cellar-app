/*
  Audit: CSS classes defined in public/css/styles.css but not referenced anywhere in public/
  (excluding CSS itself). Heuristic only.
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

const repoRoot = process.cwd();
const cssPath = path.join(repoRoot, 'public', 'css', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

// Collect class selectors from CSS.
const classRe = /\.(?!\d)([a-zA-Z_-][\w-]*)/g;
const classes = new Set();
let m;
while ((m = classRe.exec(css))) {
  const name = m[1];
  if (!name) continue;
  classes.add(name);
}

// Build searchable text from public/ excluding css and images.
const publicFiles = walk(path.join(repoRoot, 'public'))
  .filter((p) => !p.includes(`${path.sep}images${path.sep}`))
  .filter((p) => !p.includes(`${path.sep}css${path.sep}`))
  .filter((p) => !p.endsWith('.map'));

const haystack = publicFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');

function firstLineOfClass(className) {
  const needle = `.${className}`;
  const idx = css.indexOf(needle);
  if (idx === -1) return null;
  return css.slice(0, idx).split(/\r\n|\r|\n/).length;
}

const unused = [];
for (const c of classes) {
  // word-ish boundary check, but allow class lists like "foo bar".
  const re = new RegExp(`(^|[^a-zA-Z0-9_-])${c}([^a-zA-Z0-9_-]|$)`);
  if (!re.test(haystack)) {
    unused.push({ className: c, line: firstLineOfClass(c) });
  }
}

unused.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.className.localeCompare(b.className));
process.stdout.write(`${JSON.stringify({ total: classes.size, unusedCount: unused.length, unused }, null, 2)}\n`);
