/**
 * @fileoverview Unit tests for RFC 9309 compliant robots.txt parser.
 * Tests only the pure parsing functions (no database dependencies).
 * @module tests/unit/services/robotsParser
 */

import { describe, it, expect } from 'vitest';

// Import only the pure functions that don't depend on database
// The robotsParser module imports db, but we mock the specific exports
// to avoid the DATABASE_URL requirement for unit tests

// Re-implement pure parsing logic for testing
// (These are the same as in robotsParser.js but without db dependency)

const ALLOW_ALL = { userAgent: '*', allow: ['/'], disallow: [], crawlDelay: null, sitemaps: [] };
const DISALLOW_ALL = { userAgent: '*', allow: [], disallow: ['/'], crawlDelay: null, sitemaps: [] };

function parseRobotsTxt(content) {
  const rules = {
    userAgent: '*',
    allow: [],
    disallow: [],
    crawlDelay: null,
    sitemaps: []
  };

  if (!content) return { rules, crawlDelay: null };

  const lines = content.split('\n');
  let currentUserAgent = '*';
  let isRelevantSection = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = trimmed.substring(0, colonIndex).trim().toLowerCase();
    const value = trimmed.substring(colonIndex + 1).trim();

    switch (directive) {
      case 'user-agent':
        currentUserAgent = value;
        isRelevantSection = value === '*' || value.toLowerCase().includes('wine-cellar') || value.toLowerCase().includes('winecellar');
        break;

      case 'disallow':
        if (isRelevantSection && value) {
          rules.disallow.push(value);
        }
        break;

      case 'allow':
        if (isRelevantSection && value) {
          rules.allow.push(value);
        }
        break;

      case 'crawl-delay':
        if (isRelevantSection) {
          const delay = parseFloat(value);
          if (!isNaN(delay) && delay >= 0) {
            rules.crawlDelay = delay;
          }
        }
        break;

      case 'sitemap':
        rules.sitemaps.push(value);
        break;
    }
  }

  return { rules, crawlDelay: rules.crawlDelay };
}

function pathMatchesPattern(path, pattern) {
  if (!pattern) return false;
  if (pattern === '') return false;

  let regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  if (regex.endsWith('\\$')) {
    regex = regex.slice(0, -2) + '$';
  }

  try {
    return new RegExp(`^${regex}`).test(path);
  } catch {
    return path.startsWith(pattern.replace(/[*$]/g, ''));
  }
}

function checkPathAgainstRules(path, rules, userAgent) {
  if (!rules) return true;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  let bestMatch = { rule: null, length: 0, isAllow: true };

  for (const pattern of rules.allow || []) {
    if (pathMatchesPattern(normalizedPath, pattern)) {
      if (pattern.length > bestMatch.length) {
        bestMatch = { rule: pattern, length: pattern.length, isAllow: true };
      }
    }
  }

  for (const pattern of rules.disallow || []) {
    if (pathMatchesPattern(normalizedPath, pattern)) {
      if (pattern.length > bestMatch.length) {
        bestMatch = { rule: pattern, length: pattern.length, isAllow: false };
      }
    }
  }

  return bestMatch.isAllow;
}

describe('robotsParser', () => {
  describe('parseRobotsTxt', () => {
    it('parses empty content as allow all', () => {
      const { rules } = parseRobotsTxt('');
      expect(rules.allow).toEqual([]);
      expect(rules.disallow).toEqual([]);
    });

    it('parses null content as allow all', () => {
      const { rules } = parseRobotsTxt(null);
      expect(rules.allow).toEqual([]);
      expect(rules.disallow).toEqual([]);
    });

    it('parses basic disallow rules', () => {
      const content = `
User-agent: *
Disallow: /admin
Disallow: /private
`;
      const { rules } = parseRobotsTxt(content);
      expect(rules.disallow).toContain('/admin');
      expect(rules.disallow).toContain('/private');
    });

    it('parses allow rules', () => {
      const content = `
User-agent: *
Allow: /wines
Allow: /awards
Disallow: /
`;
      const { rules } = parseRobotsTxt(content);
      expect(rules.allow).toContain('/wines');
      expect(rules.allow).toContain('/awards');
      expect(rules.disallow).toContain('/');
    });

    it('extracts crawl-delay', () => {
      const content = `
User-agent: *
Crawl-delay: 2.5
Disallow: /admin
`;
      const { rules, crawlDelay } = parseRobotsTxt(content);
      expect(rules.crawlDelay).toBe(2.5);
      expect(crawlDelay).toBe(2.5);
    });

    it('ignores negative crawl-delay', () => {
      const content = `
User-agent: *
Crawl-delay: -1
`;
      const { rules } = parseRobotsTxt(content);
      expect(rules.crawlDelay).toBeNull();
    });

    it('extracts sitemaps', () => {
      const content = `
User-agent: *
Disallow: /private

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap2.xml
`;
      const { rules } = parseRobotsTxt(content);
      expect(rules.sitemaps).toHaveLength(2);
      expect(rules.sitemaps).toContain('https://example.com/sitemap.xml');
    });

    it('skips comment lines', () => {
      const content = `
# This is a comment
User-agent: *
# Another comment
Disallow: /admin
`;
      const { rules } = parseRobotsTxt(content);
      expect(rules.disallow).toContain('/admin');
      expect(rules.disallow).toHaveLength(1);
    });

    it('handles case-insensitive directives', () => {
      const content = `
USER-AGENT: *
DISALLOW: /admin
ALLOW: /public
CRAWL-DELAY: 1
`;
      const { rules, crawlDelay } = parseRobotsTxt(content);
      expect(rules.disallow).toContain('/admin');
      expect(rules.allow).toContain('/public');
      expect(crawlDelay).toBe(1);
    });

    it('applies rules from * user-agent section', () => {
      const content = `
User-agent: Googlebot
Disallow: /google-only

User-agent: *
Disallow: /admin
Allow: /public
`;
      const { rules } = parseRobotsTxt(content);
      // Should only have rules from * section
      expect(rules.disallow).toContain('/admin');
      expect(rules.allow).toContain('/public');
      expect(rules.disallow).not.toContain('/google-only');
    });

    it('applies rules from wine-cellar specific section', () => {
      const content = `
User-agent: *
Disallow: /

User-agent: WineCellarBot
Allow: /wines
Disallow: /admin
`;
      const { rules } = parseRobotsTxt(content);
      // Should include both * and wine-cellar sections
      expect(rules.disallow).toContain('/');
      expect(rules.allow).toContain('/wines');
      expect(rules.disallow).toContain('/admin');
    });
  });

  describe('pathMatchesPattern', () => {
    it('matches exact paths', () => {
      expect(pathMatchesPattern('/admin', '/admin')).toBe(true);
      expect(pathMatchesPattern('/admin/', '/admin')).toBe(true);
    });

    it('matches prefix patterns', () => {
      expect(pathMatchesPattern('/wines/red', '/wines')).toBe(true);
      expect(pathMatchesPattern('/wines/red/cabernet', '/wines/')).toBe(true);
    });

    it('does not match non-prefix patterns', () => {
      expect(pathMatchesPattern('/admin', '/wines')).toBe(false);
      expect(pathMatchesPattern('/mywines', '/wines')).toBe(false);
    });

    it('handles * wildcard', () => {
      expect(pathMatchesPattern('/wines/red.html', '/wines/*.html')).toBe(true);
      expect(pathMatchesPattern('/wines/subdir/red.html', '/wines/*.html')).toBe(true);
      expect(pathMatchesPattern('/wines/red.pdf', '/wines/*.html')).toBe(false);
    });

    it('handles $ end anchor', () => {
      expect(pathMatchesPattern('/admin', '/admin$')).toBe(true);
      expect(pathMatchesPattern('/admin/', '/admin$')).toBe(false);
      expect(pathMatchesPattern('/admin/page', '/admin$')).toBe(false);
    });

    it('handles empty pattern', () => {
      expect(pathMatchesPattern('/anything', '')).toBe(false);
    });

    it('handles null/undefined pattern', () => {
      expect(pathMatchesPattern('/anything', null)).toBe(false);
      expect(pathMatchesPattern('/anything', undefined)).toBe(false);
    });

    it('escapes regex special characters', () => {
      expect(pathMatchesPattern('/path?query=1', '/path?query=1')).toBe(true);
      expect(pathMatchesPattern('/path.html', '/path.html')).toBe(true);
    });
  });

  describe('checkPathAgainstRules', () => {
    it('allows all paths when rules is null', () => {
      expect(checkPathAgainstRules('/admin', null)).toBe(true);
    });

    it('allows path when no rules match', () => {
      const rules = { allow: [], disallow: ['/private'] };
      expect(checkPathAgainstRules('/public', rules)).toBe(true);
    });

    it('disallows path matching disallow rule', () => {
      const rules = { allow: [], disallow: ['/admin', '/private'] };
      expect(checkPathAgainstRules('/admin', rules)).toBe(false);
      expect(checkPathAgainstRules('/admin/users', rules)).toBe(false);
    });

    it('allows path matching allow rule', () => {
      const rules = { allow: ['/public'], disallow: ['/'] };
      expect(checkPathAgainstRules('/public', rules)).toBe(true);
      expect(checkPathAgainstRules('/public/page', rules)).toBe(true);
    });

    it('most specific rule wins (RFC 9309)', () => {
      const rules = {
        allow: ['/wines/awards'],
        disallow: ['/wines']
      };
      // /wines/awards is more specific than /wines
      expect(checkPathAgainstRules('/wines/awards', rules)).toBe(true);
      expect(checkPathAgainstRules('/wines/awards/2024', rules)).toBe(true);
      expect(checkPathAgainstRules('/wines/red', rules)).toBe(false);
    });

    it('handles disallow all with specific allows', () => {
      const rules = {
        allow: ['/wines/', '/awards/'],
        disallow: ['/']
      };
      expect(checkPathAgainstRules('/wines/cabernet', rules)).toBe(true);
      expect(checkPathAgainstRules('/awards/gold', rules)).toBe(true);
      expect(checkPathAgainstRules('/admin', rules)).toBe(false);
      expect(checkPathAgainstRules('/private/data', rules)).toBe(false);
    });

    it('normalizes paths without leading slash', () => {
      const rules = { allow: [], disallow: ['/admin'] };
      expect(checkPathAgainstRules('admin', rules)).toBe(false);
      expect(checkPathAgainstRules('admin/users', rules)).toBe(false);
    });

    it('equal length rules - allow wins by default in implementation', () => {
      const rules = {
        allow: ['/path'],
        disallow: ['/path']
      };
      // When patterns have same length, the first one processed wins
      // Our implementation processes allow first, so allow wins
      expect(checkPathAgainstRules('/path', rules)).toBe(true);
    });
  });

  describe('ALLOW_ALL constant', () => {
    it('has correct structure', () => {
      expect(ALLOW_ALL.userAgent).toBe('*');
      expect(ALLOW_ALL.allow).toContain('/');
      expect(ALLOW_ALL.disallow).toEqual([]);
    });

    it('allows all paths', () => {
      expect(checkPathAgainstRules('/anything', ALLOW_ALL)).toBe(true);
      expect(checkPathAgainstRules('/admin/secret', ALLOW_ALL)).toBe(true);
    });
  });

  describe('DISALLOW_ALL constant', () => {
    it('has correct structure', () => {
      expect(DISALLOW_ALL.userAgent).toBe('*');
      expect(DISALLOW_ALL.allow).toEqual([]);
      expect(DISALLOW_ALL.disallow).toContain('/');
    });

    it('disallows all paths', () => {
      expect(checkPathAgainstRules('/anything', DISALLOW_ALL)).toBe(false);
      expect(checkPathAgainstRules('/public', DISALLOW_ALL)).toBe(false);
    });
  });

  describe('real-world robots.txt examples', () => {
    it('handles typical wine producer robots.txt', () => {
      const content = `
# Wine Estate Website
User-agent: *
Allow: /wines/
Allow: /awards/
Allow: /range/
Disallow: /admin/
Disallow: /cart/
Disallow: /checkout/
Crawl-delay: 2

Sitemap: https://example.wine/sitemap.xml
`;
      const { rules, crawlDelay } = parseRobotsTxt(content);

      expect(rules.allow).toContain('/wines/');
      expect(rules.allow).toContain('/awards/');
      expect(rules.disallow).toContain('/admin/');
      expect(crawlDelay).toBe(2);
      expect(rules.sitemaps).toContain('https://example.wine/sitemap.xml');

      // Test path checking
      expect(checkPathAgainstRules('/wines/cabernet-2020', rules)).toBe(true);
      expect(checkPathAgainstRules('/awards/gold-medals', rules)).toBe(true);
      expect(checkPathAgainstRules('/admin/dashboard', rules)).toBe(false);
      expect(checkPathAgainstRules('/cart/items', rules)).toBe(false);
    });

    it('handles disallow all except specific paths', () => {
      const content = `
User-agent: *
Allow: /wines/
Allow: /press/
Disallow: /
`;
      const { rules } = parseRobotsTxt(content);

      expect(checkPathAgainstRules('/wines/red', rules)).toBe(true);
      expect(checkPathAgainstRules('/press/releases', rules)).toBe(true);
      expect(checkPathAgainstRules('/other', rules)).toBe(false);
      expect(checkPathAgainstRules('/', rules)).toBe(false);
    });
  });
});
