/**
 * @fileoverview Web page content fetching with caching and proxy support.
 * Handles HTML pages, Vivino SPA extraction, and blocked domains.
 * @module services/pageFetcher
 */

import logger from '../utils/logger.js';
import { extractDomain } from '../utils/url.js';
import {
  getCachedPage, cachePage,
  getPublicUrlCache, upsertPublicUrlCache,
  getCacheTTL
} from './cacheService.js';
import { getDomainIssue } from './fetchClassifier.js';
import { TIMEOUTS } from '../config/scraperConfig.js';
import { BLOCKED_DOMAINS, BRIGHTDATA_API_URL } from './searchConstants.js';
import {
  createTimeoutAbort, buildConditionalHeaders,
  resolvePublicCacheStatus
} from './fetchUtils.js';
import { fetchDocumentContent } from './documentFetcher.js';

/**
 * Fetch page content for parsing.
 * Uses Bright Data Web Unlocker API for domains known to block standard scrapers.
 * Implements page-level caching to avoid redundant fetches.
 * @param {string} url - URL to fetch
 * @param {number} maxLength - Maximum content length
 * @param {Object} budget - Budget tracker
 * @returns {Promise<Object>} { content, success, status, blocked, error, fromCache }
 */
export async function fetchPageContent(url, maxLength = 8000, budget = null) {
  const domain = extractDomain(url);

  // Check if this is a document URL
  const isDocument = /\.(pdf|doc|docx|xls|xlsx)(\?|$)/i.test(url);
  if (isDocument) {
    return await fetchDocumentContent(url, maxLength, budget);
  }

  let cachedPage = null;
  let urlCache = null;

  // Check cache first (include stale for conditional revalidation)
  try {
    [cachedPage, urlCache] = await Promise.all([
      getCachedPage(url, { includeStale: true }),
      getPublicUrlCache(url)
    ]);

    if (cachedPage && !cachedPage.isStale) {
      logger.info('Cache', `Page HIT: ${url.substring(0, 60)}...`);
      return {
        content: cachedPage.content || '',
        success: cachedPage.status === 'success',
        status: cachedPage.statusCode,
        blocked: cachedPage.status === 'blocked' || cachedPage.status === 'auth_required',
        error: cachedPage.error,
        fromCache: true
      };
    }
  } catch (err) {
    logger.warn('Cache', `Page lookup failed: ${err.message}`);
  }

  // Check if domain has known issues
  const domainIssue = getDomainIssue(url);
  if (domainIssue) {
    logger.info('Fetch', `Known issue for ${domain}: ${domainIssue.issue}`);
  }

  // Check if we should use Bright Data API for this domain
  const bdApiKey = process.env.BRIGHTDATA_API_KEY;
  const bdZone = process.env.BRIGHTDATA_WEB_ZONE;
  const useUnblocker = BLOCKED_DOMAINS.some(d => domain.includes(d)) && bdApiKey && bdZone;

  logger.info('Fetch', `Fetching: ${url}${useUnblocker ? ' (via Bright Data Web Unlocker)' : ''}`);

  const isVivinoDomain = domain.includes('vivino.com');
  const timeoutMs = isVivinoDomain
    ? TIMEOUTS.VIVINO_FETCH_TIMEOUT
    : (useUnblocker ? TIMEOUTS.WEB_UNLOCKER_TIMEOUT : TIMEOUTS.STANDARD_FETCH_TIMEOUT);
  const { controller, cleanup } = createTimeoutAbort(timeoutMs);

  try {
    let response;
    const conditionalHeaders = cachedPage?.isStale && !useUnblocker
      ? buildConditionalHeaders(urlCache)
      : null;

    if (useUnblocker) {
      const isVivino = domain.includes('vivino.com');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bdApiKey}`
      };

      if (isVivino) {
        headers['x-unblock-expect'] = JSON.stringify({
          element: '[class*="average"]'
        });
        logger.info('Fetch', 'Vivino: waiting for rating element to render via x-unblock-expect');
      }

      response = await fetch(BRIGHTDATA_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          zone: bdZone,
          url: url,
          format: 'raw',
          data_format: 'markdown'
        })
      });
    } else {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(conditionalHeaders || {})
        }
      });
    }
    cleanup();

    const status = response.status;

    if (status === 304 && cachedPage?.content) {
      const ttlHours = await getCacheTTL('page');
      await upsertPublicUrlCache({
        url,
        etag: urlCache?.etag || null,
        lastModified: urlCache?.lastModified || null,
        contentType: urlCache?.contentType || null,
        byteSize: urlCache?.byteSize || null,
        status: 'valid',
        ttlHours
      });

      await cachePage(
        url,
        cachedPage.content || '',
        cachedPage.status || 'success',
        cachedPage.statusCode || 200
      );

      logger.info('Fetch', `Conditional revalidation hit (304) for ${url}`);
      return {
        content: cachedPage.content || '',
        success: cachedPage.status === 'success',
        status: cachedPage.statusCode || 200,
        blocked: cachedPage.status === 'blocked' || cachedPage.status === 'auth_required',
        error: cachedPage.error,
        fromCache: true,
        revalidated: true
      };
    }

    if (!response.ok) {
      logger.info('Fetch', `HTTP ${status} from ${domain}`);
      const ttlHours = await getCacheTTL('blocked_page');
      await upsertPublicUrlCache({
        url,
        status: resolvePublicCacheStatus(status, false),
        ttlHours
      });
      return {
        content: '',
        success: false,
        status,
        blocked: status === 403 || status === 429,
        error: `HTTP ${status}`
      };
    }

    const contentText = await response.text();
    const byteSize = Buffer.byteLength(contentText);

    // Check for blocked/consent indicators
    const isBlocked =
      contentText.length < 500 && (
        contentText.toLowerCase().includes('captcha') ||
        contentText.toLowerCase().includes('consent') ||
        contentText.toLowerCase().includes('verify') ||
        contentText.toLowerCase().includes('cloudflare') ||
        contentText.toLowerCase().includes('access denied')
      );

    if (isBlocked) {
      logger.info('Fetch', `Blocked/consent page from ${domain} (${contentText.length} chars)`);
      const ttlHours = await getCacheTTL('blocked_page');
      await upsertPublicUrlCache({
        url,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentType: response.headers.get('content-type'),
        byteSize,
        status: 'error',
        ttlHours
      });
      return {
        content: '',
        success: false,
        status,
        blocked: true,
        error: 'Blocked or consent page'
      };
    }

    let text = '';

    if (useUnblocker) {
      logger.info('Fetch', `BrightData returned ${contentText.length} chars from ${domain}`);
      if (domain.includes('vivino')) {
        logger.info('Fetch', `Vivino content sample:\n${contentText.substring(0, 1500)}`);
      } else if (contentText.length < 2000) {
        logger.info('Fetch', `BrightData content preview: ${contentText.substring(0, 500)}`);
      }

      if (domain.includes('vivino')) {
        const hasRatingData = contentText.match(/\d[.,]\d\s*(?:stars?|rating|average)/i) ||
                              contentText.match(/(?:rating|score)[:\s]+\d[.,]\d/i) ||
                              contentText.match(/\d+\s*ratings/i) ||
                              contentText.match(/\d[.,]\d[\s\S]{0,20}count\s*ratings/i);
        if (!hasRatingData) {
          logger.info('Fetch', `Vivino page has no extractable rating data (SPA shell)`);
          return {
            content: '',
            success: false,
            status,
            blocked: true,
            error: 'Vivino SPA - no rating data'
          };
        }
        logger.info('Fetch', `Vivino page has rating data - proceeding with extraction`);
      }
      text = contentText.replace(/\s+/g, ' ').trim();
    } else {
      // Raw HTML response
      if (domain.includes('vivino')) {
        text = extractVivinoData(contentText);

        if (!text) {
          logger.info('Fetch', `Vivino page has no extractable rating data (SPA shell)`);
          return {
            content: '',
            success: false,
            status,
            blocked: true,
            error: 'Vivino SPA - no rating data in HTML'
          };
        }
      }

      if (!text) {
        text = contentText
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    // Check if we got meaningful content
    if (text.length < 200) {
      logger.info('Fetch', `Short response from ${domain}: ${text.length} chars`);
      const result = {
        content: text,
        success: false,
        status,
        blocked: true,
        error: `Too short (${text.length} chars)`,
        fromCache: false
      };
      const ttlHours = await getCacheTTL('blocked_page');
      await upsertPublicUrlCache({
        url,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentType: response.headers.get('content-type'),
        byteSize,
        status: 'error',
        ttlHours
      });
      try {
        await cachePage(url, text, 'insufficient_content', status, result.error);
      } catch (err) {
        logger.warn('Cache', `Page cache write failed: ${err.message}`);
      }
      return result;
    }

    logger.info('Fetch', `Got ${text.length} chars from ${domain}`);

    const finalContent = text.substring(0, maxLength);
    const result = {
      content: finalContent,
      success: true,
      status,
      blocked: false,
      error: null,
      fromCache: false
    };

    // Cache successful result
    try {
      const ttlHours = await getCacheTTL('page');
      await upsertPublicUrlCache({
        url,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentType: response.headers.get('content-type'),
        byteSize,
        status: 'valid',
        ttlHours
      });
      await cachePage(url, finalContent, 'success', status, null);
    } catch (err) {
      logger.warn('Cache', `Page cache write failed: ${err.message}`);
    }

    return result;

  } catch (error) {
    cleanup();
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    logger.error('Fetch', `Failed for ${url}: ${errorMsg}`);
    const result = {
      content: '',
      success: false,
      status: null,
      blocked: false,
      error: errorMsg,
      fromCache: false
    };
    const ttlHours = await getCacheTTL('blocked_page');
    await upsertPublicUrlCache({
      url,
      status: 'error',
      ttlHours
    });
    try {
      await cachePage(url, '', error.name === 'AbortError' ? 'timeout' : 'error', null, errorMsg);
    } catch (err) {
      logger.warn('Cache', `Page cache write failed: ${err.message}`);
    }
    return result;
  }
}

/**
 * Extract rating data from Vivino's Next.js JSON payload.
 * @param {string} html - Raw HTML
 * @returns {string} Extracted text or empty string
 */
function extractVivinoData(html) {
  try {
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      const jsonData = JSON.parse(nextDataMatch[1]);
      const wine = jsonData?.props?.pageProps?.wine;
      if (wine) {
        const parts = [
          `Wine: ${wine.name || ''}`,
          `Rating: ${wine.statistics?.ratings_average || ''} stars`,
          `Ratings count: ${wine.statistics?.ratings_count || ''}`,
          `Region: ${wine.region?.name || ''}`,
          `Country: ${wine.region?.country?.name || ''}`,
        ];
        logger.info('Fetch', `Extracted Vivino data: ${wine.statistics?.ratings_average} stars, ${wine.statistics?.ratings_count} ratings`);
        return parts.join('\n');
      }
    }

    const ldJsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (ldJsonMatch) {
      const jsonData = JSON.parse(ldJsonMatch[1]);
      if (jsonData.aggregateRating) {
        return `Rating: ${jsonData.aggregateRating.ratingValue} stars (${jsonData.aggregateRating.ratingCount} ratings)`;
      }
    }

    const ratingMatch = html.match(/content="(\d+\.?\d*)"[^>]*property="og:rating"/i) ||
                        html.match(/property="og:rating"[^>]*content="(\d+\.?\d*)"/i);
    if (ratingMatch) {
      return `Rating: ${ratingMatch[1]} stars`;
    }

  } catch (e) {
    logger.info('Fetch', `Vivino JSON extraction failed: ${e.message}`);
  }

  return '';
}

