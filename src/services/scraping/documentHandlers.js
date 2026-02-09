/**
 * @fileoverview Document type handlers for PDF and DOCX extraction.
 * Includes zip-bomb protection for DOCX and cached extraction for PDFs.
 * @module services/scraping/documentHandlers
 */

import logger from '../../utils/logger.js';
import { cachePage } from '../shared/cacheService.js';
import { LIMITS } from '../../config/scraperConfig.js';

/**
 * Handle PDF document extraction.
 * Checks extraction cache first, falls back to Claude Vision extraction.
 * @param {string} url - Document URL
 * @param {Buffer} buffer - PDF buffer
 * @param {number} sizeKB - Size in KB
 * @param {number|null} urlCacheId - Public URL cache ID
 * @param {string} contentHash - SHA-256 hash
 * @returns {Promise<Object>} Extraction result
 */
export async function handlePdfDocument(url, buffer, sizeKB, urlCacheId, contentHash) {
  const { getPublicExtraction, cachePublicExtraction } = await import('../shared/cacheService.js');

  if (urlCacheId) {
    const cachedExtraction = await getPublicExtraction(urlCacheId, contentHash);
    if (cachedExtraction?.facts?.awards) {
      const cachedText = cachedExtraction.facts.text || '';
      const content = cachedText.substring(0, LIMITS.MAX_CONTENT_CHARS);
      await cachePage(url, content, 'success', 200);
      return {
        content,
        success: true,
        status: 200,
        isDocument: true,
        documentType: 'pdf',
        extractedAwards: cachedExtraction.facts.awards || [],
        fromCache: true,
        extractionCacheHit: true
      };
    }
  }

  try {
    const { extractFromPDF } = await import('../awards/index.js');
    const pdfBase64 = buffer.toString('base64');
    const extractedData = await extractFromPDF(pdfBase64, null, null);
    if (extractedData && extractedData.text) {
      const content = extractedData.text.substring(0, LIMITS.MAX_CONTENT_CHARS);
      await cachePage(url, content, 'success', 200);

      if (urlCacheId) {
        await cachePublicExtraction(
          urlCacheId,
          'pdf_extract',
          { awards: extractedData.awards || [], text: content },
          null,
          content.substring(0, 200) || null,
          contentHash
        );
      }

      return {
        content,
        success: true,
        status: 200,
        isDocument: true,
        documentType: 'pdf',
        extractedAwards: extractedData.awards || []
      };
    }
  } catch (pdfErr) {
    logger.warn('Document', `PDF extraction failed: ${pdfErr.message}`);
  }

  return {
    content: `[PDF Document: ${sizeKB}KB - requires PDF extraction]`,
    success: true,
    status: 200,
    isDocument: true,
    documentType: 'pdf',
    needsExtraction: true
  };
}

/**
 * Handle DOCX document extraction with zip-bomb protections.
 * Validates entry count, uncompressed size, and compression ratio before extracting.
 * @param {string} url - Document URL
 * @param {Buffer} buffer - DOCX buffer
 * @param {number} sizeKB - Size in KB
 * @returns {Promise<Object>} Extraction result
 */
export async function handleDocxDocument(url, buffer, sizeKB) {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    // ZIP-BOMB PROTECTION 1: Check entry count
    const entries = Object.keys(zip.files);
    if (entries.length > LIMITS.DOCX_MAX_ENTRIES) {
      logger.warn('Document', `DOCX has ${entries.length} entries, exceeds limit ${LIMITS.DOCX_MAX_ENTRIES}`);
      return {
        content: '',
        success: false,
        status: 400,
        isDocument: true,
        documentType: 'docx',
        error: `DOCX zip-bomb protection: too many entries (${entries.length} > ${LIMITS.DOCX_MAX_ENTRIES})`
      };
    }

    // ZIP-BOMB PROTECTION 2: Check uncompressed size
    let totalUncompressedSize = 0;
    for (const entry of entries) {
      const file = zip.files[entry];
      if (!file.dir) {
        const compressedSize = file._data?.compressedSize || 0;
        totalUncompressedSize += compressedSize * 10;
      }
    }

    if (totalUncompressedSize > LIMITS.DOCX_MAX_UNCOMPRESSED_BYTES) {
      logger.warn('Document', `DOCX uncompressed size estimate ${totalUncompressedSize} exceeds limit`);
      return {
        content: '',
        success: false,
        status: 400,
        isDocument: true,
        documentType: 'docx',
        error: `DOCX zip-bomb protection: estimated uncompressed size too large`
      };
    }

    // Extract document.xml
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (documentXml) {
      // ZIP-BOMB PROTECTION 3: Check compression ratio
      const compressedSize = buffer.byteLength;
      const uncompressedSize = documentXml.length;
      const compressionRatio = uncompressedSize / compressedSize;

      if (compressionRatio > LIMITS.DOCX_MAX_COMPRESSION_RATIO) {
        logger.warn('Document', `DOCX compression ratio ${compressionRatio.toFixed(1)} exceeds limit ${LIMITS.DOCX_MAX_COMPRESSION_RATIO}`);
        return {
          content: '',
          success: false,
          status: 400,
          isDocument: true,
          documentType: 'docx',
          error: `DOCX zip-bomb protection: compression ratio too high (${compressionRatio.toFixed(1)}:1)`
        };
      }

      const textContent = documentXml
        .replace(/<w:p[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, LIMITS.MAX_CONTENT_CHARS);

      if (textContent.length > 50) {
        await cachePage(url, textContent, 'success', 200);
        return {
          content: textContent,
          success: true,
          status: 200,
          isDocument: true,
          documentType: 'docx'
        };
      }
    }
  } catch (docxErr) {
    logger.warn('Document', `DOCX extraction failed: ${docxErr.message}`);
  }

  return {
    content: `[Word Document: ${sizeKB}KB]`,
    success: true,
    status: 200,
    isDocument: true,
    documentType: 'docx',
    needsExtraction: true
  };
}
