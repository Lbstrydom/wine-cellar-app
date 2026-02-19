/**
 * @fileoverview Clean article text extraction via Mozilla Readability.
 * Provides a free, high-quality alternative to raw regex HTML stripping.
 * Used as the first extraction attempt for non-blocked domains before
 * falling back to basic tag removal.
 * @module services/scraping/readabilityExtractor
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import logger from '../../utils/logger.js';

/** Minimum chars for Readability output to be considered useful */
const MIN_READABLE_LENGTH = 200;

/**
 * Extract clean article text from raw HTML using Mozilla Readability.
 * Returns null if Readability cannot parse the page or the result is
 * too short to be useful (SPA shells, login walls, etc.).
 *
 * @param {string} html - Raw HTML string
 * @param {string} url - Page URL (used by JSDOM for relative link resolution)
 * @returns {{ title: string, text: string, length: number } | null}
 *   Parsed article or null if extraction failed / insufficient content.
 */
export function extractWithReadability(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent) {
      logger.debug('Readability', `No article extracted from ${url}`);
      return null;
    }

    // Collapse whitespace for a clean output
    // Prepend title — Readability moves <h1> into article.title and strips it
    // from textContent, but the h1 often contains the wine name which is
    // critical for downstream identity matching and Claude extraction.
    const bodyText = article.textContent.replace(/\s+/g, ' ').trim();
    const title = (article.title || '').trim();
    const text = title ? `${title}\n${bodyText}` : bodyText;

    if (text.length < MIN_READABLE_LENGTH) {
      logger.debug('Readability', `Article too short (${text.length} chars) from ${url}`);
      return null;
    }

    logger.info('Readability', `Extracted ${text.length} chars from ${url} — "${(article.title || '').substring(0, 60)}"`);
    return {
      title: article.title || '',
      text,
      length: text.length
    };
  } catch (err) {
    logger.debug('Readability', `Parse failed for ${url}: ${err.message}`);
    return null;
  }
}
