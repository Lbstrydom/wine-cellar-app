import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg'
]);

// Inline event handler attributes are blocked by our CSP (script-src 'self' without unsafe-inline).
// Examples: onclick="...", onkeypress='...', onerror="..."
// We intentionally keep this regex fairly strict to avoid false positives.
const INLINE_HANDLER_RE = /(^|[\s<])on[a-zA-Z]+\s*=\s*['"]/m;
const JAVASCRIPT_URL_RE = /javascript\s*:/i;

async function listFilesRecursive(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function findFirstMatchLocation(content, regex) {
  const match = regex.exec(content);
  if (!match) return null;

  const matchIndex = match.index;
  const before = content.slice(0, matchIndex);
  const line = before.split('\n').length;
  const lastNewlineIndex = before.lastIndexOf('\n');
  const column = matchIndex - (lastNewlineIndex === -1 ? -1 : lastNewlineIndex);

  const snippetStart = Math.max(0, matchIndex - 80);
  const snippetEnd = Math.min(content.length, matchIndex + 160);
  const snippet = content
    .slice(snippetStart, snippetEnd)
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');

  return { line, column, snippet };
}

describe('CSP compliance: no inline event handlers in public/', () => {
  it('does not contain inline on*="..." or javascript: URLs', async () => {
    // If the public directory is missing (very unusual), skip rather than failing.
    // This keeps the test safe in environments that run backend-only.
    try {
      await fs.access(PUBLIC_DIR);
    } catch {
      return;
    }

    const allFiles = await listFilesRecursive(PUBLIC_DIR);
    const textFiles = allFiles.filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return TEXT_EXTENSIONS.has(ext);
    });

    const violations = [];

    for (const filePath of textFiles) {
      const relPath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
      const content = await fs.readFile(filePath, 'utf8');

      const inlineHandler = findFirstMatchLocation(content, INLINE_HANDLER_RE);
      if (inlineHandler) {
        violations.push({
          type: 'inline-handler',
          file: relPath,
          ...inlineHandler
        });
      }

      const javascriptUrl = findFirstMatchLocation(content, JAVASCRIPT_URL_RE);
      if (javascriptUrl) {
        violations.push({
          type: 'javascript-url',
          file: relPath,
          ...javascriptUrl
        });
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => {
          const kind = v.type === 'inline-handler' ? 'Inline handler (on*=)' : 'javascript: URL';
          return `${kind}: ${v.file}:${v.line}:${v.column}\n  ${v.snippet}`;
        })
        .join('\n\n');

      throw new Error(`CSP compliance violations found in public/\n\n${message}`);
    }
  });
});
