/*
  Audit: config exports that are not referenced.

  We report two things:
  1) Config exports that are never imported from their file anywhere in src/ (strong signal).
  2) Config files that are never imported anywhere in src/ (very strong signal).

  Notes:
  - Heuristic only: code can access exports via namespace imports or dynamic imports.
  - We focus on explicit ESM imports in src/**.
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

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function lineNumberFromIndex(text, idx) {
  return text.slice(0, idx).split(/\r\n|\r|\n/).length;
}

const repoRoot = process.cwd();
const configDir = path.join(repoRoot, 'src', 'config');
const configFiles = walk(configDir).filter((p) => p.endsWith('.js'));

const srcFiles = walk(path.join(repoRoot, 'src'))
  .filter((p) => p.endsWith('.js'))
  .filter((p) => !p.startsWith(configDir));

const srcTexts = srcFiles.map((p) => ({ file: p, text: read(p) }));

// Build: for each config file, list all exports.
function extractNamedExports(configText) {
  const exports = [];

  // export const X / export function X / export class X
  for (const m of configText.matchAll(/^\s*export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    exports.push({ name: m[1], index: m.index });
  }

  // export { A, B as C }
  for (const m of configText.matchAll(/^\s*export\s*\{([^}]+)\}\s*;?\s*$/gm)) {
    const raw = m[1];
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const asMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      exports.push({ name: (asMatch ? asMatch[2] : part), index: m.index });
    }
  }

  return exports;
}

function importsFromFile(text, relConfigPath) {
  // relConfigPath like '../config/foo.js' or './config/foo.js'
  const imports = [];

  // import X from '...'
  // import { A, B as C } from '...'
  // import X, { A } from '...'
  const re = new RegExp(`^\\s*import\\s+([^;]+?)\\s+from\\s+['\"]${relConfigPath.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}['\"];?`, 'gm');
  for (const m of text.matchAll(re)) {
    imports.push(m[1].trim());
  }

  return imports;
}

function parseImportedNames(importClause) {
  const names = new Set();

  // Namespace import: * as X
  if (/\*\s+as\s+/.test(importClause)) {
    names.add('*');
    return names;
  }

  // Default import: Foo
  const defaultOnly = importClause.match(/^([A-Za-z_$][\w$]*)$/);
  if (defaultOnly) {
    names.add('default');
    return names;
  }

  // Default + named: Foo, { A, B as C }
  const defaultAndNamed = importClause.match(/^([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s*$/);
  if (defaultAndNamed) {
    names.add('default');
    const raw = defaultAndNamed[2];
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const asMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      names.add(asMatch ? asMatch[2] : part);
    }
    return names;
  }

  // Named only: { A, B as C }
  const namedOnly = importClause.match(/^\{([^}]+)\}\s*$/);
  if (namedOnly) {
    const raw = namedOnly[1];
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const asMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      names.add(asMatch ? asMatch[2] : part);
    }
    return names;
  }

  // Fallback: treat as unknown
  names.add('?');
  return names;
}

const report = {
  filesNeverImported: [],
  exportsNeverImported: [],
};

for (const configFile of configFiles) {
  const relFromSrc = `../config/${path.basename(configFile)}`;
  const relFromSrcSameDir = `./config/${path.basename(configFile)}`;

  let fileImported = false;
  const importedNames = new Set();

  for (const sf of srcTexts) {
    const clauses = [
      ...importsFromFile(sf.text, relFromSrc),
      ...importsFromFile(sf.text, relFromSrcSameDir),
      // sometimes routes/services import from '../../config/foo.js'
    ];

    // handle arbitrary ../../config/foo.js
    const anyDepthRe = new RegExp(`^\\s*import\\s+([^;]+?)\\s+from\\s+['\"][^'\"]*\\/config\\/${path.basename(configFile).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}['\"];?`, 'gm');
    for (const m of sf.text.matchAll(anyDepthRe)) clauses.push(m[1].trim());

    if (clauses.length) fileImported = true;
    for (const clause of clauses) {
      const names = parseImportedNames(clause);
      for (const n of names) importedNames.add(n);
    }
  }

  const configText = read(configFile);
  const exports = extractNamedExports(configText);

  if (!fileImported) {
    report.filesNeverImported.push({
      file: path.relative(repoRoot, configFile).replace(/\\/g, '/'),
    });
  }

  for (const ex of exports) {
    if (importedNames.has('*')) continue; // namespace import could use any export
    if (importedNames.has(ex.name)) continue;

    report.exportsNeverImported.push({
      file: path.relative(repoRoot, configFile).replace(/\\/g, '/'),
      line: lineNumberFromIndex(configText, ex.index),
      name: ex.name,
      evidence: fileImported ? 'File imported, but this export name never imported' : 'Config file never imported anywhere in src/',
    });
  }
}

report.filesNeverImported.sort((a, b) => a.file.localeCompare(b.file));
report.exportsNeverImported.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
