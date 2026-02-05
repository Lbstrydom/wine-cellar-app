/**
 * @fileoverview RFC 9309 compliant robots.txt parser and cache.
 * Handles robots.txt fetching, parsing, caching with proper status handling.
 * @module services/robotsParser
 */

import db from '../db/index.js';
import { semaphoredFetch } from '../utils/fetchSemaphore.js';
import { PRODUCER_CRAWL } from '../config/scraperConfig.js';
import logger from '../utils/logger.js';

// RFC 9309 constants
const ROBOTS_TXT_CACHE_TTL_HOURS = 24;
const ROBOTS_TXT_FETCH_TIMEOUT_MS = 5000;
const MAX_ROBOTS_TXT_SIZE = 512 * 1024; // 512KB max
const MAX_REDIRECTS = 5;

/**
 * Special rule sets for RFC 9309 status handling.
 */
export const ALLOW_ALL = { userAgent: '*', allow: ['/'], disallow: [], crawlDelay: null, sitemaps: [] };
export const DISALLOW_ALL = { userAgent: '*', allow: [], disallow: ['/'], crawlDelay: null, sitemaps: [] };

/**
 * Get robots.txt rules for a domain, with RFC 9309 compliant caching.
 *
 * @param {string} domain - Domain to fetch robots.txt for
 * @returns {Promise<{rules: Object, crawlDelay: number|null, fromCache: boolean, status: string}>}
 */
export async function getRobotsTxt(domain) {
  // Check cache first
  const cached = await getRobotsTxtFromCache(domain);

  if (cached && !isExpired(cached.expires_at)) {
    console.log(`[Robots] Cache HIT for ${domain}`);
    return {
      rules: cached.parsed_rules || ALLOW_ALL,
      crawlDelay: cached.crawl_delay_seconds,
      fromCache: true,
      status: cached.fetch_status
    };
  }

  // Fetch fresh
  const result = await fetchRobotsTxt(domain, cached);

  // Cache the result
  await cacheRobotsTxt(domain, result);

  return {
    rules: result.rules,
    crawlDelay: result.crawlDelay,
    fromCache: false,
    status: result.status
  };
}

/**
 * Check if crawling a specific path is allowed by robots.txt.
 *
 * @param {string} domain - Domain to check
 * @param {string} path - Path to check (e.g., "/wines/awards")
 * @param {string} userAgent - User agent to check for (default: "*")
 * @returns {Promise<{allowed: boolean, crawlDelay: number|null, reason: string}>}
 */
export async function isPathAllowed(domain, path, userAgent = '*') {
  const { rules, crawlDelay, status } = await getRobotsTxt(domain);

  // RFC 9309 status-based decisions
  if (status === 'not_found') {
    const defaultDelay = PRODUCER_CRAWL?.DEFAULT_CRAWL_DELAY_S ?? 1;
    return { allowed: true, crawlDelay: defaultDelay, reason: '4xx: no restrictions (RFC 9309 §2.3)' };
  }

  if (status === 'unreachable' && (!rules || rules === DISALLOW_ALL)) {
    return { allowed: false, crawlDelay: null, reason: 'Unreachable + no cache: conservative disallow (RFC 9309 §2.4)' };
  }

  // Check rules
  const allowed = checkPathAgainstRules(path, rules, userAgent);
  const defaultDelay = PRODUCER_CRAWL?.DEFAULT_CRAWL_DELAY_S ?? 1;

  return {
    allowed,
    crawlDelay: crawlDelay ?? defaultDelay,
    reason: allowed ? 'Path allowed by rules' : 'Path disallowed by rules'
  };
}

/**
 * Fetch robots.txt with RFC 9309 compliant status handling.
 *
 * @param {string} domain - Domain to fetch
 * @param {Object|null} cached - Previous cached entry for fallback
 * @returns {Promise<Object>}
 */
async function fetchRobotsTxt(domain, cached) {
  const url = `https://${domain}/robots.txt`;
  let redirectCount = 0;
  let currentUrl = url;

  try {
    while (redirectCount < MAX_REDIRECTS) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ROBOTS_TXT_FETCH_TIMEOUT_MS);

      try {
        const userAgent = PRODUCER_CRAWL?.USER_AGENT ?? 'WineCellarBot/1.0';
        const response = await semaphoredFetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/plain, */*'
          }
        });

        clearTimeout(timeout);

        // Handle redirects (RFC 9309 allows up to 5)
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('Location');
          if (location) {
            currentUrl = new URL(location, currentUrl).href;
            redirectCount++;
            continue;
          }
        }

        // 2xx: Parse and cache
        if (response.ok) {
          const contentLength = parseInt(response.headers.get('Content-Length') || '0');
          if (contentLength > MAX_ROBOTS_TXT_SIZE) {
            logger.warn('Robots', `robots.txt too large for ${domain}: ${contentLength} bytes`);
            return { status: 'parse_error', rules: ALLOW_ALL, crawlDelay: null, content: null };
          }

          const content = await response.text();
          const { rules, crawlDelay } = parseRobotsTxt(content);

          console.log(`[Robots] Fetched robots.txt for ${domain}: ${rules.disallow?.length || 0} disallow rules`);

          return {
            status: 'success',
            httpStatus: response.status,
            content,
            rules,
            crawlDelay
          };
        }

        // 4xx: No restrictions (RFC 9309 section 2.3)
        if (response.status >= 400 && response.status < 500) {
          console.log(`[Robots] robots.txt not found for ${domain} (${response.status}): ALLOW_ALL`);
          return {
            status: 'not_found',
            httpStatus: response.status,
            rules: ALLOW_ALL,
            crawlDelay: null,
            content: null
          };
        }

        // 5xx: Server error, use cached if available (RFC 9309 section 2.4)
        if (response.status >= 500) {
          logger.warn('Robots', `Server error fetching robots.txt for ${domain} (${response.status})`);
          if (cached?.parsed_rules) {
            return {
              status: 'server_error',
              httpStatus: response.status,
              rules: cached.parsed_rules,
              crawlDelay: cached.crawl_delay_seconds,
              content: cached.robots_txt_content,
              usedStaleCache: true
            };
          }
          // No cache: DISALLOW_ALL (conservative)
          return {
            status: 'server_error',
            httpStatus: response.status,
            rules: DISALLOW_ALL,
            crawlDelay: null,
            content: null
          };
        }

      } catch (fetchErr) {
        clearTimeout(timeout);
        throw fetchErr;
      }
    }

    // Max redirects exceeded
    logger.warn('Robots', `Max redirects exceeded for ${domain}`);
    return {
      status: 'unreachable',
      rules: cached?.parsed_rules || DISALLOW_ALL,
      crawlDelay: cached?.crawl_delay_seconds || null,
      error: 'Max redirects exceeded'
    };

  } catch (err) {
    // Network error or timeout (RFC 9309 section 2.4)
    logger.warn('Robots', `Failed to fetch robots.txt for ${domain}: ${err.message}`);

    if (cached?.parsed_rules) {
      console.log(`[Robots] Using stale cache for ${domain}`);
      return {
        status: 'unreachable',
        rules: cached.parsed_rules,
        crawlDelay: cached.crawl_delay_seconds,
        content: cached.robots_txt_content,
        usedStaleCache: true,
        error: err.message
      };
    }

    // No cache and unreachable: DISALLOW_ALL (conservative, RFC 9309)
    return {
      status: 'unreachable',
      rules: DISALLOW_ALL,
      crawlDelay: null,
      content: null,
      error: err.message
    };
  }
}

/**
 * Parse robots.txt content into structured rules.
 *
 * @param {string} content - Raw robots.txt content
 * @returns {{rules: Object, crawlDelay: number|null}}
 */
export function parseRobotsTxt(content) {
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
  let isRelevantSection = true; // We're a generic crawler

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

/**
 * Check if a path is allowed by the parsed rules.
 * Follows RFC 9309 precedence: most specific rule wins.
 *
 * @param {string} path - Path to check
 * @param {Object} rules - Parsed rules
 * @param {string} userAgent - User agent (ignored for now, using *)
 * @returns {boolean}
 */
export function checkPathAgainstRules(path, rules, userAgent) {
  if (!rules) return true;

  // Normalize path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Find the most specific matching rule
  let bestMatch = { rule: null, length: 0, isAllow: true };

  // Check allow rules
  for (const pattern of rules.allow || []) {
    if (pathMatchesPattern(normalizedPath, pattern)) {
      if (pattern.length > bestMatch.length) {
        bestMatch = { rule: pattern, length: pattern.length, isAllow: true };
      }
    }
  }

  // Check disallow rules
  for (const pattern of rules.disallow || []) {
    if (pathMatchesPattern(normalizedPath, pattern)) {
      if (pattern.length > bestMatch.length) {
        bestMatch = { rule: pattern, length: pattern.length, isAllow: false };
      }
    }
  }

  return bestMatch.isAllow;
}

/**
 * Check if a path matches a robots.txt pattern.
 * Supports * and $ wildcards per RFC 9309.
 *
 * @param {string} path - Path to check
 * @param {string} pattern - robots.txt pattern
 * @returns {boolean}
 */
export function pathMatchesPattern(path, pattern) {
  if (!pattern) return false;

  // Empty disallow means allow all
  if (pattern === '') return false;

  // Convert robots.txt pattern to regex
  let regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and $
    .replace(/\*/g, '.*');                   // * matches anything

  // Handle $ anchor (end of path)
  if (regex.endsWith('\\$')) {
    regex = regex.slice(0, -2) + '$';
  }

  try {
    return new RegExp(`^${regex}`).test(path);
  } catch {
    // Fallback to simple prefix match
    return path.startsWith(pattern.replace(/[*$]/g, ''));
  }
}

// Database helper functions
async function getRobotsTxtFromCache(domain) {
  try {
    return await db.prepare(`
      SELECT * FROM robots_txt_cache WHERE domain = $1
    `).get(domain);
  } catch {
    return null;
  }
}

async function cacheRobotsTxt(domain, result) {
  const expiresAt = new Date(Date.now() + ROBOTS_TXT_CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();

  try {
    await db.prepare(`
      INSERT INTO robots_txt_cache (
        domain, robots_txt_content, fetch_status, http_status_code,
        parsed_rules, crawl_delay_seconds, expires_at, last_error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (domain) DO UPDATE SET
        robots_txt_content = EXCLUDED.robots_txt_content,
        fetch_status = EXCLUDED.fetch_status,
        http_status_code = EXCLUDED.http_status_code,
        parsed_rules = EXCLUDED.parsed_rules,
        crawl_delay_seconds = EXCLUDED.crawl_delay_seconds,
        fetched_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        fetch_count = robots_txt_cache.fetch_count + 1,
        last_error = EXCLUDED.last_error,
        updated_at = NOW()
    `).run(
      domain,
      result.content,
      result.status,
      result.httpStatus || null,
      result.rules ? JSON.stringify(result.rules) : null,
      result.crawlDelay,
      expiresAt,
      result.error || null
    );
  } catch (err) {
    logger.warn('Robots', `Failed to cache robots.txt for ${domain}: ${err.message}`);
  }
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt) <= new Date();
}

export default {
  getRobotsTxt,
  isPathAllowed,
  parseRobotsTxt,
  checkPathAgainstRules,
  pathMatchesPattern,
  ALLOW_ALL,
  DISALLOW_ALL
};
