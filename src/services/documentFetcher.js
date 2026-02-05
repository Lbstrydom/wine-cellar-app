/**
 * @fileoverview Document content fetching for PDF, DOC, DOCX, XLS, XLSX.
 * Handles streaming downloads with budget/size limits and zip-bomb protection.
 * @module services/documentFetcher
 */

import logger from '../utils/logger.js';
import { semaphoredFetch } from '../utils/fetchSemaphore.js';
import {
  getCachedPage, cachePage,
  getPublicUrlCache, upsertPublicUrlCache,
  getCacheTTL
} from './cacheService.js';
import { TIMEOUTS, LIMITS } from '../config/scraperConfig.js';
import {
  hasWallClockBudget, reserveDocumentFetch,
  canConsumeBytes, recordBytes
} from './searchBudget.js';
import {
  createTimeoutAbort, buildConditionalHeaders,
  resolvePublicCacheStatus, hashBuffer
} from './fetchUtils.js';
import { handlePdfDocument, handleDocxDocument } from './documentHandlers.js';

/**
 * Fetch and extract content from document URLs (PDF, DOC, DOCX, XLS, XLSX).
 * Uses Claude Vision for PDFs and basic text extraction for Office documents.
 * @param {string} url - Document URL
 * @param {number} maxLength - Maximum content length
 * @param {Object} budget - Budget tracker
 * @returns {Promise<Object>} { content, success, status, isDocument, documentType, error }
 */
export async function fetchDocumentContent(url, maxLength = 8000, budget = null) {
  const extension = url.match(/\.(pdf|doc|docx|xls|xlsx)(\?|$)/i)?.[1]?.toLowerCase() || 'unknown';
  logger.info('Document', `Fetching document: ${url} (type: ${extension})`);

  let cachedPage = null;
  let urlCache = null;

  // Check cache first
  try {
    [cachedPage, urlCache] = await Promise.all([
      getCachedPage(url, { includeStale: true }),
      getPublicUrlCache(url)
    ]);

    if (cachedPage && !cachedPage.isStale) {
      logger.info('Cache', `Document HIT: ${url.substring(0, 60)}...`);
      return {
        content: cachedPage.content || '',
        success: cachedPage.status === 'success',
        status: cachedPage.statusCode,
        isDocument: true,
        documentType: extension,
        fromCache: true
      };
    }
  } catch (err) {
    logger.warn('Cache', `Document cache lookup failed: ${err.message}`);
  }

  if (budget && !hasWallClockBudget(budget)) {
    logger.warn('Budget', 'Wall-clock budget exceeded before document fetch');
    return {
      content: '',
      success: false,
      status: 429,
      isDocument: true,
      documentType: extension,
      error: 'Document fetch skipped: wall-clock budget exceeded'
    };
  }

  if (budget && !reserveDocumentFetch(budget)) {
    logger.warn('Budget', 'Document fetch budget exhausted');
    return {
      content: '',
      success: false,
      status: 429,
      isDocument: true,
      documentType: extension,
      error: 'Document fetch skipped: fetch budget exceeded'
    };
  }

  if (budget && !canConsumeBytes(budget, 0)) {
    return {
      content: '',
      success: false,
      status: 429,
      isDocument: true,
      documentType: extension,
      error: 'Document fetch skipped: byte budget exhausted'
    };
  }

  const { controller, cleanup } = createTimeoutAbort(TIMEOUTS.WEB_UNLOCKER_TIMEOUT);

  try {
    // HEAD-first check to fail fast on large documents
    const { controller: headController, cleanup: headCleanup } = createTimeoutAbort(TIMEOUTS.STANDARD_FETCH_TIMEOUT);
    let headContentLength = 0;
    try {
      const headResponse = await semaphoredFetch(url, {
        method: 'HEAD',
        signal: headController.signal,
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      headCleanup();

      if (headResponse.ok) {
        headContentLength = parseInt(headResponse.headers.get('content-length') || '0', 10);
        if (headContentLength > LIMITS.MAX_DOCUMENT_BYTES) {
          logger.warn('Document', `HEAD Content-Length ${headContentLength} exceeds limit ${LIMITS.MAX_DOCUMENT_BYTES}, aborting`);
          cleanup();
          return {
            content: '',
            success: false,
            status: 413,
            isDocument: true,
            documentType: extension,
            error: `Document too large: ${Math.round(headContentLength / 1024 / 1024)}MB (limit: ${Math.round(LIMITS.MAX_DOCUMENT_BYTES / 1024 / 1024)}MB)`
          };
        }
        if (budget && headContentLength > 0 && !canConsumeBytes(budget, headContentLength)) {
          logger.warn('Budget', `Byte budget would be exceeded by HEAD length ${headContentLength}`);
          cleanup();
          return {
            content: '',
            success: false,
            status: 429,
            isDocument: true,
            documentType: extension,
            error: 'Document fetch skipped: byte budget would be exceeded'
          };
        }
      } else {
        logger.warn('Document', `HEAD request returned ${headResponse.status} for ${url}`);
      }
    } catch (headErr) {
      headCleanup();
      logger.warn('Document', `HEAD request failed: ${headErr.message}`);
    }

    const conditionalHeaders = cachedPage?.isStale ? buildConditionalHeaders(urlCache) : null;
    const requestHeaders = {
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(conditionalHeaders || {})
    };

    const response = await semaphoredFetch(url, {
      signal: controller.signal,
      headers: requestHeaders
    });

    cleanup();

    if (response.status === 304 && cachedPage?.content) {
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

      logger.info('Document', `Conditional revalidation hit (304) for ${url}`);
      return {
        content: cachedPage.content || '',
        success: cachedPage.status === 'success',
        status: cachedPage.statusCode || 200,
        isDocument: true,
        documentType: extension,
        fromCache: true,
        revalidated: true
      };
    }

    if (!response.ok) {
      logger.warn('Document', `HTTP ${response.status} for ${url}`);
      const ttlHours = await getCacheTTL('blocked_page');
      await upsertPublicUrlCache({
        url,
        status: resolvePublicCacheStatus(response.status, false),
        ttlHours
      });
      return {
        content: '',
        success: false,
        status: response.status,
        isDocument: true,
        documentType: extension,
        error: `HTTP ${response.status}`
      };
    }

    // Check Content-Length from GET
    const contentLengthHeader = parseInt(response.headers.get('content-length') || '0', 10);
    const effectiveContentLength = contentLengthHeader || headContentLength;
    if (effectiveContentLength > LIMITS.MAX_DOCUMENT_BYTES) {
      logger.warn('Document', `Content-Length ${effectiveContentLength} exceeds limit ${LIMITS.MAX_DOCUMENT_BYTES}, aborting`);
      return {
        content: '',
        success: false,
        status: 413,
        isDocument: true,
        documentType: extension,
        error: `Document too large: ${Math.round(effectiveContentLength / 1024 / 1024)}MB (limit: ${Math.round(LIMITS.MAX_DOCUMENT_BYTES / 1024 / 1024)}MB)`
      };
    }

    if (budget && effectiveContentLength > 0 && !canConsumeBytes(budget, effectiveContentLength)) {
      logger.warn('Budget', `Byte budget would be exceeded by declared length ${effectiveContentLength}`);
      return {
        content: '',
        success: false,
        status: 429,
        isDocument: true,
        documentType: extension,
        error: 'Document fetch skipped: byte budget would be exceeded'
      };
    }

    // Stream download with byte counter
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body not readable');
    }

    const chunks = [];
    let bytesRead = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkSize = value.length;
        const projectedDownload = bytesRead + chunkSize;
        const projectedTotal = budget ? budget.totalBytes + projectedDownload : 0;

        if (budget && projectedTotal > budget.limits.MAX_TOTAL_BYTES) {
          bytesRead += chunkSize;
          recordBytes(budget, bytesRead);
          logger.warn('Budget', `Byte budget exceeded during download at ${projectedTotal}`);
          reader.cancel();
          return {
            content: '',
            success: false,
            status: 429,
            isDocument: true,
            documentType: extension,
            error: 'Document fetch skipped: byte budget exceeded'
          };
        }

        bytesRead = projectedDownload;
        if (bytesRead > LIMITS.MAX_DOCUMENT_BYTES) {
          logger.warn('Document', `Download exceeded ${LIMITS.MAX_DOCUMENT_BYTES} bytes, aborting`);
          reader.cancel();
          recordBytes(budget, bytesRead);
          return {
            content: '',
            success: false,
            status: 413,
            isDocument: true,
            documentType: extension,
            error: `Download exceeded ${Math.round(LIMITS.MAX_DOCUMENT_BYTES / 1024 / 1024)}MB limit`
          };
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate chunks into buffer
    const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    const sizeKB = Math.round(buffer.byteLength / 1024);
    recordBytes(budget, buffer.byteLength);
    logger.info('Document', `Downloaded: ${sizeKB}KB`);

    const ttlHours = await getCacheTTL('page');
    const urlCacheId = await upsertPublicUrlCache({
      url,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentType: response.headers.get('content-type'),
      byteSize: buffer.byteLength,
      status: 'valid',
      ttlHours
    });

    const contentHash = hashBuffer(buffer);

    // Handle different document types
    if (extension === 'pdf') {
      return await handlePdfDocument(url, buffer, sizeKB, urlCacheId, contentHash);
    }

    if (extension === 'docx') {
      return await handleDocxDocument(url, buffer, sizeKB);
    }

    if (extension === 'doc') {
      return {
        content: `[Word Document: ${sizeKB}KB - legacy format]`,
        success: true,
        status: 200,
        isDocument: true,
        documentType: 'doc',
        needsExtraction: true
      };
    }

    // XLS/XLSX
    return {
      content: `[Excel Document: ${sizeKB}KB - type: ${extension}]`,
      success: true,
      status: 200,
      isDocument: true,
      documentType: extension,
      needsExtraction: true
    };

  } catch (error) {
    cleanup();
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    logger.error('Document', `Fetch failed: ${errorMsg}`);
    return {
      content: '',
      success: false,
      isDocument: true,
      documentType: extension,
      error: errorMsg
    };
  }
}

