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

    // If we reach here, no violations found
    expect(violations).toEqual([]);
  });
});
