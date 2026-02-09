/**
 * @fileoverview Producer micro-crawler for verified producer domains.
 * Crawls allowed paths (/wines, /range, /downloads, /awards, /press) with
 * robots.txt governance and rate limiting.
 * @module services/producerCrawler
 */

import db from '../db/index.js';
import { globalFetchSemaphore } from '../utils/fetchSemaphore.js';
import { isPathAllowed } from './robotsParser.js';
import {
  upsertPublicUrlCache,
  getPublicUrlCache,
  cachePublicExtraction
} from './cacheService.js';
import { PRODUCER_CRAWL } from '../config/scraperConfig.js';
import crypto from 'crypto';
import logger from '../utils/logger.js';

// Allowed paths for producer crawling (whitelist approach)
export const ALLOWED_PATH_PREFIXES = [
  '/wines',
  '/range',
  '/downloads',
  '/awards',
  '/press',
  '/accolades',
  '/medals',
  '/tasting-notes'
];

/**
 * Crawl a verified producer domain.
 *
 * @param {string} domain - Domain to crawl
 * @param {Object} options - Crawl options
 * @param {boolean} options.respectRobotsTxt - Whether to respect robots.txt (default: true)
 * @param {number} options.maxPages - Maximum pages to crawl (default: 20)
 * @param {boolean} options.followLinks - Whether to discover links (default: true)
 * @returns {Promise<{crawled: number, queued: number, blocked: number, errors: string[]}>}
 */
export async function crawlProducerDomain(domain, options = {}) {
  const {
    respectRobotsTxt = true,
    maxPages = PRODUCER_CRAWL?.MAX_PAGES_PER_DOMAIN ?? 20,
    followLinks = true
  } = options;

  const stats = { crawled: 0, queued: 0, blocked: 0, errors: [] };

  // Verify domain is registered and crawl-enabled
  const producerDomain = await getProducerDomain(domain);
  if (!producerDomain) {
    stats.errors.push(`Domain ${domain} not registered as producer`);
    return stats;
  }

  if (!producerDomain.crawl_enabled) {
    stats.errors.push(`Crawling disabled for ${domain}`);
    return stats;
  }

  console.log(`[Crawler] Starting crawl of ${domain} (max ${maxPages} pages)`);

  // Get pending URLs from queue or seed with entry points
  let pendingUrls = await getPendingUrls(producerDomain.id, maxPages);

  if (pendingUrls.length === 0) {
    // Seed initial URLs
    pendingUrls = await seedInitialUrls(producerDomain);
    stats.queued = pendingUrls.length;
  }

  // Crawl each URL
  for (const queueItem of pendingUrls) {
    if (stats.crawled >= maxPages) break;

    try {
      // Check robots.txt
      if (respectRobotsTxt) {
        const { allowed, crawlDelay, reason } = await isPathAllowed(domain, queueItem.path);

        if (!allowed) {
          console.log(`[Crawler] Blocked by robots.txt: ${queueItem.url} (${reason})`);
          await updateQueueStatus(queueItem.id, 'blocked_by_robots');
          stats.blocked++;
          continue;
        }

        // Respect crawl-delay
        if (crawlDelay && crawlDelay > 0) {
          await sleep(crawlDelay * 1000);
        }
      } else {
        // Default delay between requests
        const defaultDelay = PRODUCER_CRAWL?.DEFAULT_CRAWL_DELAY_S ?? 1;
        await sleep(defaultDelay * 1000);
      }

      // Mark as in progress
      await updateQueueStatus(queueItem.id, 'in_progress');

      // Crawl the page
      const result = await crawlPage(queueItem.url, producerDomain);

      if (result.success) {
        await updateQueueStatus(queueItem.id, 'completed', result.urlCacheId);
        stats.crawled++;

        // Discover and queue new links
        if (followLinks && result.discoveredUrls?.length > 0) {
          const newQueued = await queueDiscoveredUrls(producerDomain.id, result.discoveredUrls);
          stats.queued += newQueued;
        }
      } else {
        await updateQueueStatus(queueItem.id, 'failed', null, result.error);
        stats.errors.push(`${queueItem.url}: ${result.error}`);
      }

    } catch (err) {
      logger.error('Crawler', `Error crawling ${queueItem.url}: ${err.message}`);
      await updateQueueStatus(queueItem.id, 'failed', null, err.message);
      stats.errors.push(`${queueItem.url}: ${err.message}`);
    }
  }

  // Update domain's last crawled timestamp
  await updateDomainCrawlTime(producerDomain.id);

  console.log(`[Crawler] Crawl complete for ${domain}: ${stats.crawled} crawled, ${stats.blocked} blocked, ${stats.errors.length} errors`);

  return stats;
}

/**
 * Crawl a single page and extract content.
 *
 * @param {string} url - URL to crawl
 * @param {Object} producerDomain - Producer domain record
 * @returns {Promise<{success: boolean, urlCacheId?: number, discoveredUrls?: string[], error?: string}>}
 */
async function crawlPage(url, producerDomain) {
  // Check cache first
  const cached = await getPublicUrlCache(url);
  if (cached && !cached.isExpired) {
    console.log(`[Crawler] Cache hit for ${url}`);
    return { success: true, urlCacheId: cached.id, discoveredUrls: [] };
  }

  // Build request headers
  const userAgent = PRODUCER_CRAWL?.USER_AGENT ?? 'WineCellarBot/1.0';
  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  } else if (cached?.lastModified) {
    headers['If-Modified-Since'] = cached.lastModified;
  }

  try {
    const pageTimeout = PRODUCER_CRAWL?.PAGE_TIMEOUT_MS ?? 15000;

    const response = await globalFetchSemaphore.withSemaphore(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), pageTimeout);

      try {
        return await fetch(url, {
          signal: controller.signal,
          headers
        });
      } finally {
        clearTimeout(timeout);
      }
    });

    // Handle 304 Not Modified
    if (response.status === 304 && cached) {
      const cacheTtl = PRODUCER_CRAWL?.CACHE_TTL_HOURS ?? 168;
      await upsertPublicUrlCache({
        url,
        etag: cached.etag,
        lastModified: cached.lastModified,
        status: 'valid',
        ttlHours: cacheTtl
      });
      return { success: true, urlCacheId: cached.id, discoveredUrls: [] };
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    // Check content type
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { success: false, error: `Unsupported content type: ${contentType}` };
    }

    // Get content
    const content = await response.text();

    // Cache the URL
    const cacheTtl = PRODUCER_CRAWL?.CACHE_TTL_HOURS ?? 168;
    const urlCacheId = await upsertPublicUrlCache({
      url,
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      contentType,
      byteSize: content.length,
      status: 'valid',
      ttlHours: cacheTtl
    });

    // Discover links for further crawling
    const discoveredUrls = extractAllowedLinks(content, url, producerDomain.domain);

    // Extract and cache content
    await extractAndCacheContent(url, content, urlCacheId, producerDomain);

    return { success: true, urlCacheId, discoveredUrls };

  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Timeout' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Extract allowed links from page content.
 * Only returns links matching ALLOWED_PATH_PREFIXES.
 *
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative links
 * @param {string} domain - Domain to restrict links to
 * @returns {string[]}
 */
function extractAllowedLinks(html, baseUrl, domain) {
  const links = [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const href = match[1];
      const absoluteUrl = new URL(href, baseUrl);

      // Only same domain
      if (!absoluteUrl.hostname.includes(domain)) continue;

      // Check if path is in allowed prefixes
      const path = absoluteUrl.pathname;
      const isAllowed = ALLOWED_PATH_PREFIXES.some(prefix =>
        path.startsWith(prefix) || path === prefix
      );

      if (isAllowed) {
        links.push(absoluteUrl.href);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return [...new Set(links)]; // Dedupe
}

/**
 * Extract and cache content from page.
 *
 * @param {string} url - Source URL
 * @param {string} content - HTML content
 * @param {number} urlCacheId - URL cache ID
 * @param {Object} producerDomain - Producer domain record
 */
async function extractAndCacheContent(url, content, urlCacheId, _producerDomain) {
  // Basic extraction - look for awards, medals, ratings
  const extracted = {
    awards: extractAwards(content),
    ratings: extractRatings(content),
    wines: extractWineNames(content)
  };

  if (Object.values(extracted).some(arr => arr.length > 0)) {
    const contentHash = hashContent(content);

    await cachePublicExtraction(
      urlCacheId,
      'html_parse',
      extracted,
      0.7, // Medium confidence for auto-extraction
      content.substring(0, 500), // Evidence snippet
      contentHash
    );

    console.log(`[Crawler] Extracted ${extracted.awards.length} awards, ${extracted.ratings.length} ratings from ${url}`);
  }
}

/**
 * Extract award mentions from HTML.
 *
 * @param {string} html - HTML content
 * @returns {string[]}
 */
function extractAwards(html) {
  const awards = [];
  const patterns = [
    /(?:gold|silver|bronze|platinum)\s*medal/gi,
    /(?:double\s+gold|grand\s+gold)/gi,
    /(?:trophy|best\s+in\s+show|best\s+of\s+class)/gi,
    /\d+\s*(?:stars?|points?)/gi
  ];

  for (const pattern of patterns) {
    const matches = html.match(pattern);
    if (matches) {
      awards.push(...matches.map(m => m.trim()));
    }
  }

  return [...new Set(awards)];
}

/**
 * Extract rating mentions from HTML.
 *
 * @param {string} html - HTML content
 * @returns {string[]}
 */
function extractRatings(html) {
  const ratings = [];
  const patterns = [
    /(\d{2,3})\s*(?:points?|\/100)/gi,
    /(\d(?:\.\d)?)\s*(?:stars?|\/5)/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      ratings.push(match[0].trim());
    }
  }

  return [...new Set(ratings)];
}

/**
 * Extract wine names from HTML (basic heuristic).
 *
 * @param {string} html - HTML content
 * @returns {string[]}
 */
function extractWineNames(html) {
  // Look for common wine name patterns in headings
  const wines = [];
  const headingRegex = /<h[1-4][^>]*>([^<]+)<\/h[1-4]>/gi;
  let match;

  while ((match = headingRegex.exec(html)) !== null) {
    const text = match[1].trim();
    // Check if it looks like a wine name (contains year or wine keywords)
    if (/\d{4}/.test(text) || /(?:wine|reserve|estate|vineyard)/i.test(text)) {
      wines.push(text);
    }
  }

  return wines.slice(0, 50); // Limit to avoid noise
}

// Database helper functions
async function getProducerDomain(domain) {
  return await db.prepare(`
    SELECT * FROM producer_domains WHERE domain = $1
  `).get(domain);
}

async function getPendingUrls(producerDomainId, limit) {
  return await db.prepare(`
    SELECT * FROM producer_crawl_queue
    WHERE producer_domain_id = $1 AND status = 'pending'
    ORDER BY priority ASC, created_at ASC
    LIMIT $2
  `).all(producerDomainId, limit);
}

async function seedInitialUrls(producerDomain) {
  const baseUrl = `https://${producerDomain.domain}`;
  const seeds = ALLOWED_PATH_PREFIXES.map(path => ({
    url: `${baseUrl}${path}`,
    path,
    urlType: path.replace('/', '').replace(/-/g, '_').substring(0, 10) || 'other'
  }));

  const inserted = [];
  for (const seed of seeds) {
    try {
      // Map url type to valid enum value
      let urlType = seed.urlType;
      if (!['wines', 'awards', 'downloads', 'range', 'press', 'accolades', 'medals', 'other'].includes(urlType)) {
        urlType = 'other';
      }

      await db.prepare(`
        INSERT INTO producer_crawl_queue (producer_domain_id, url, path, url_type)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (producer_domain_id, url) DO NOTHING
      `).run(producerDomain.id, seed.url, seed.path, urlType);
      inserted.push(seed);
    } catch (err) {
      logger.warn('Crawler', `Failed to seed URL ${seed.url}: ${err.message}`);
    }
  }

  return inserted;
}

async function updateQueueStatus(queueId, status, urlCacheId = null, error = null) {
  await db.prepare(`
    UPDATE producer_crawl_queue SET
      status = $1,
      url_cache_id = $2,
      error_message = $3,
      last_attempted_at = NOW(),
      completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END,
      attempts = attempts + 1
    WHERE id = $4
  `).run(status, urlCacheId, error, queueId);
}

async function queueDiscoveredUrls(producerDomainId, urls) {
  let queued = 0;
  for (const url of urls) {
    try {
      const path = new URL(url).pathname;
      let urlType = ALLOWED_PATH_PREFIXES.find(p => path.startsWith(p))?.replace('/', '').replace(/-/g, '_') || 'other';

      // Ensure valid enum value
      if (!['wines', 'awards', 'downloads', 'range', 'press', 'accolades', 'medals', 'other'].includes(urlType)) {
        urlType = 'other';
      }

      await db.prepare(`
        INSERT INTO producer_crawl_queue (producer_domain_id, url, path, url_type)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (producer_domain_id, url) DO NOTHING
      `).run(producerDomainId, url, path, urlType);
      queued++;
    } catch {
      // Skip invalid URLs
    }
  }
  return queued;
}

async function updateDomainCrawlTime(producerDomainId) {
  await db.prepare(`
    UPDATE producer_domains SET
      last_crawled_at = NOW(),
      next_crawl_after = NOW() + INTERVAL '7 days',
      updated_at = NOW()
    WHERE id = $1
  `).run(producerDomainId);
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  crawlProducerDomain,
  ALLOWED_PATH_PREFIXES
};
