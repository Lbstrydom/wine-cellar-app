/**
 * @fileoverview Puppeteer-based web scraper using direct browser launch.
 * Provides reliable scraping for JavaScript-heavy sites like Vivino and Decanter.
 * Refactored from MCP wrapper to direct puppeteer.launch() for Docker/Railway stability.
 * @module services/scraping/puppeteerScraper
 */

import puppeteer from 'puppeteer';
import logger from '../../utils/logger.js';
import { TIMEOUTS, COOKIE_CONSENT_SELECTORS } from '../../config/scraperConfig.js';

/**
 * Browser launch arguments for Docker/headless environments.
 * Critical for Railway deployment where containers run as root.
 */
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
  '--no-zygote'
];

// Singleton browser instance
let browserInstance = null;
let lastUsedTime = 0;

/**
 * Get or create a browser instance.
 * Reuses existing browser if still connected, otherwise launches a new one.
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function getBrowser() {
  const now = Date.now();

  // Reuse existing browser if connected and recently used
  if (browserInstance && browserInstance.connected && (now - lastUsedTime) < TIMEOUTS.CLIENT_IDLE_TIMEOUT) {
    lastUsedTime = now;
    return browserInstance;
  }

  // Close existing browser if it exists
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore close errors
    }
    browserInstance = null;
  }

  // Launch new browser
  logger.info('Puppeteer', 'Launching browser...');
  browserInstance = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: BROWSER_ARGS
  });

  lastUsedTime = now;
  logger.info('Puppeteer', 'Browser launched successfully');
  return browserInstance;
}

/**
 * Wait for a specified duration.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Accept cookie consent dialog on a page.
 * Handles various consent frameworks (OneTrust, native, etc.)
 * @param {import('puppeteer').Page} page - The Puppeteer page
 * @param {string} siteType - Site type: 'vivino', 'decanter', or 'generic'
 * @returns {Promise<void>}
 */
async function acceptCookieConsent(page, siteType = 'generic') {
  const selectors = COOKIE_CONSENT_SELECTORS[siteType] || COOKIE_CONSENT_SELECTORS.generic;

  try {
    // Try CSS selectors first
    for (const selector of selectors.filter(s => s.type === 'selector')) {
      try {
        const element = await page.$(selector.value);
        if (element) {
          await element.click();
          await wait(TIMEOUTS.COOKIE_CONSENT_WAIT);
          return;
        }
      } catch {
        // Selector not found, continue
      }
    }

    // Try text-based matches
    const textSelectors = selectors.filter(s => s.type === 'text').map(s => s.value);
    if (textSelectors.length > 0) {
      await page.evaluate((texts) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const text of texts) {
          const match = buttons.find(b =>
            b.textContent.trim().toLowerCase() === text.toLowerCase()
          );
          if (match) {
            match.click();
            return;
          }
        }
      }, textSelectors);
      await wait(TIMEOUTS.COOKIE_CONSENT_WAIT);
    }
  } catch (error) {
    logger.debug('Puppeteer', `Cookie consent handling: ${error.message}`);
    // Continue even if cookie consent fails
  }
}

/**
 * Scrape Vivino wine page and extract wine data.
 * @param {string} url - Vivino wine URL
 * @returns {Promise<Object|null>} Wine data or null on failure
 */
export async function scrapeVivinoPage(url) {
  let browser = null;
  let page = null;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    // Set user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    logger.info('Puppeteer', `Navigating to Vivino: ${url}`);

    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: TIMEOUTS.VIVINO_FETCH_TIMEOUT
    });

    if (!response || !response.ok()) {
      logger.warn('Puppeteer', `Navigation failed: status ${response?.status()}`);
      return null;
    }

    // Wait for SPA to render
    logger.info('Puppeteer', `Waiting for page to render (${TIMEOUTS.SPA_RENDER_WAIT / 1000}s)...`);
    await wait(TIMEOUTS.SPA_RENDER_WAIT);

    // Click cookie consent
    await acceptCookieConsent(page, 'vivino');

    // Extract wine data
    const wineData = await page.evaluate(() => {
      const data = {};

      // Rating
      const ratingSelectors = [
        '.vivinoRating_averageValue__uDdPM',
        '[class*="averageValue"]',
        '.average__number'
      ];
      for (const sel of ratingSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          data.rating = parseFloat(el.textContent.trim().replace(',', '.'));
          break;
        }
      }

      // Rating count
      const countSelectors = [
        '.vivinoRating_caption__xL84P',
        '[class*="ratingCount"]',
        '[class*="caption"]'
      ];
      for (const sel of countSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.includes('rating')) {
          const match = el.textContent.match(/([\d,]+)\s*rating/i);
          if (match) {
            data.ratingCount = parseInt(match[1].replace(/,/g, ''), 10);
          }
          break;
        }
      }

      // Wine name from header
      const h1 = document.querySelector('h1');
      if (h1) data.wineName = h1.textContent.trim();

      // Winery
      const wineryEl = document.querySelector('[class*="winery"]') ||
                      document.querySelector('a[href*="/wineries/"]');
      if (wineryEl) data.winery = wineryEl.textContent.trim();

      // Region
      const regionEl = document.querySelector('[class*="location"]') ||
                      document.querySelector('a[href*="/wine-regions/"]');
      if (regionEl) data.region = regionEl.textContent.trim();

      // Grape variety
      const grapeEl = document.querySelector('[class*="grape"]') ||
                     document.querySelector('a[href*="/grapes/"]');
      if (grapeEl) data.grape = grapeEl.textContent.trim();

      // Price
      const priceEl = document.querySelector('[class*="price"]');
      if (priceEl) data.price = priceEl.textContent.trim();

      // URL
      data.url = window.location.href;

      // Extract wine ID from URL
      const idMatch = window.location.pathname.match(/\/w\/(\d+)/);
      if (idMatch) data.vivinoId = parseInt(idMatch[1], 10);

      return data;
    });

    if (!wineData || typeof wineData !== 'object') {
      logger.warn('Puppeteer', 'No wine data extracted from page');
      return null;
    }

    logger.info('Puppeteer', `Vivino: ${wineData.wineName} - ${wineData.rating}★ (${wineData.ratingCount} ratings)`);
    return wineData;

  } catch (error) {
    logger.error('Puppeteer', `Vivino scrape failed: ${error.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Search Vivino for wines and return matches.
 * NOTE: Vivino search pages are blocked for headless browsers (HTTP 405).
 * This function now scrapes individual wine pages found via other means.
 *
 * @param {Object} params - Search parameters
 * @param {string} params.query - Wine name to search
 * @param {string} [params.producer] - Producer name
 * @param {number} [params.vintage] - Vintage year
 * @returns {Promise<{matches: Array, error: string|null}>}
 */
export async function searchVivinoWithPuppeteer({ query: _query, producer: _producer, vintage: _vintage }) {
  // Vivino blocks headless browsers on search pages (HTTP 405)
  // We need to use a different approach - search via Google or Bright Data
  logger.warn('Puppeteer', 'Vivino search pages are blocked for headless browsers');
  return {
    matches: [],
    error: 'Vivino blocks headless browser search. Use scrapeVivinoPage() for individual wine URLs instead.'
  };
}

/**
 * Scrape Decanter wine review page.
 * @param {string} url - Decanter review URL
 * @returns {Promise<Object|null>} Review data or null
 */
export async function scrapeDecanterPage(url) {
  let browser = null;
  let page = null;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    logger.info('Puppeteer', `Navigating to Decanter: ${url}`);

    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: TIMEOUTS.STANDARD_FETCH_TIMEOUT * 3
    });

    if (!response || !response.ok()) {
      logger.warn('Puppeteer', `Navigation failed: status ${response?.status()}`);
      return null;
    }

    // Wait for page to render
    await wait(TIMEOUTS.PAGE_LOAD_WAIT);

    // Accept cookies if prompted
    await acceptCookieConsent(page, 'decanter');

    // Extract review data
    const reviewData = await page.evaluate(() => {
      const data = {};

      // Try JSON embedded data first (current Decanter format)
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        const scoreMatch = text.match(/"score"\s*:\s*(\d{2,3})/);
        if (scoreMatch) {
          data.score = parseInt(scoreMatch[1], 10);
        }
        const drinkFromMatch = text.match(/"drink_from"\s*:\s*(\d{4})/);
        const drinkToMatch = text.match(/"drink_to"\s*:\s*(\d{4})/);
        if (drinkFromMatch && drinkToMatch) {
          data.drinkFrom = parseInt(drinkFromMatch[1], 10);
          data.drinkTo = parseInt(drinkToMatch[1], 10);
        }
        const reviewMatch = text.match(/"review"\s*:\s*"([^"]+)"/);
        if (reviewMatch) {
          data.tastingNotes = reviewMatch[1]
            .replace(/\\n/g, ' ')
            .replace(/\\u[\dA-Fa-f]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))
            .replace(/\\(.)/g, '$1')
            .trim();
        }
        if (data.score) break;
      }

      // Fallback: structured data
      if (!data.score) {
        const ratingEl = document.querySelector('[itemprop="ratingValue"]');
        if (ratingEl) {
          data.score = parseInt(ratingEl.content || ratingEl.textContent, 10);
        }
      }

      // Fallback: data-rating attribute
      if (!data.score) {
        const ratingAttr = document.querySelector('[data-rating]');
        if (ratingAttr) {
          data.score = parseInt(ratingAttr.dataset.rating, 10);
        }
      }

      // Fallback: "XX points" pattern
      if (!data.score) {
        const bodyText = document.body.textContent;
        const pointsMatch = bodyText.match(/(\d{2,3})\s*points/i);
        if (pointsMatch) {
          data.score = parseInt(pointsMatch[1], 10);
        }
      }

      // Wine name
      const h1 = document.querySelector('h1');
      if (h1) data.wineName = h1.textContent.trim();

      // URL
      data.url = window.location.href;

      return data;
    });

    if (!reviewData || !reviewData.score || reviewData.score < 50 || reviewData.score > 100) {
      logger.warn('Puppeteer', `Decanter: No valid score found (got: ${reviewData?.score})`);
      return null;
    }

    logger.info('Puppeteer', `Decanter: ${reviewData.score} points${reviewData.drinkFrom ? ` (Drink ${reviewData.drinkFrom}-${reviewData.drinkTo})` : ''}`);
    return reviewData;

  } catch (error) {
    logger.error('Puppeteer', `Decanter scrape failed: ${error.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Search Decanter for wine reviews.
 * @param {string} wineName - Wine name
 * @param {number} vintage - Vintage year
 * @returns {Promise<Object|null>} Best matching review or null
 */
export async function searchDecanterWithPuppeteer(wineName, vintage) {
  let browser = null;
  let page = null;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Extract search tokens
    const tokens = wineName
      .toLowerCase()
      .replace(/[''`]/g, '')
      .replace(/\([^)]+\)/g, ' ')
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
      .slice(0, 4);

    // Build search query - use WordPress search which actually works
    const searchQuery = `${tokens.join(' ')} ${vintage || ''} wine review`.trim();
    const searchUrl = `https://www.decanter.com/?s=${encodeURIComponent(searchQuery)}`;

    logger.info('Puppeteer', `Decanter search: "${searchQuery}"`);

    const response = await page.goto(searchUrl, {
      waitUntil: 'networkidle0',
      timeout: TIMEOUTS.STANDARD_FETCH_TIMEOUT * 3
    });

    if (!response || !response.ok()) {
      logger.warn('Puppeteer', `Search navigation failed: status ${response?.status()}`);
      return null;
    }

    // Wait for search results
    await wait(TIMEOUTS.SEARCH_RESULTS_WAIT);

    // Accept cookies if prompted
    await acceptCookieConsent(page, 'decanter');

    // Find matching wine review URLs
    const vintageStr = String(vintage || '');
    const matchingUrl = await page.evaluate((searchTokens, vStr) => {
      const minTokensToMatch = Math.max(1, searchTokens.length - 1);

      // Collect all wine review links
      const links = document.querySelectorAll('a[href*="/wine-reviews/"]');
      const urls = [];

      for (const link of links) {
        const href = link.href;
        // Skip non-review pages
        if (href.includes('/images/') || href.includes('/search') || href.includes('/decanter-world-wine-awards/')) {
          continue;
        }
        // Must end with numeric ID
        if (!href.match(/\d+$/)) continue;

        const slug = href.split('/').pop().toLowerCase();
        let score = 0;
        let tokensMatched = 0;

        // Token matches - require most tokens to match for a valid result
        for (const token of searchTokens) {
          if (slug.includes(token)) {
            score += 10;
            tokensMatched++;
          }
        }

        // Skip if not enough tokens match (avoid false positives)
        if (tokensMatched < minTokensToMatch) {
          continue;
        }

        // Vintage match bonus
        if (vStr && slug.includes(vStr)) {
          score += 20;
        }

        urls.push({ url: href, score, tokensMatched });
      }

      // Sort by tokens matched first, then score
      urls.sort((a, b) => {
        if (a.tokensMatched !== b.tokensMatched) {
          return b.tokensMatched - a.tokensMatched;
        }
        return b.score - a.score;
      });
      return urls[0]?.url || null;
    }, tokens, vintageStr);

    // Close the search page
    await page.close();
    page = null;

    if (!matchingUrl) {
      logger.info('Puppeteer', 'Decanter: No matching wine review found');
      return null;
    }

    logger.info('Puppeteer', `Decanter: Found review at ${matchingUrl}`);
    return await scrapeDecanterPage(matchingUrl);

  } catch (error) {
    logger.error('Puppeteer', `Decanter search failed: ${error.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Close the shared Puppeteer browser.
 * Call this when shutting down the server.
 */
export async function closePuppeteerClient() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore close errors
    }
    browserInstance = null;
    logger.info('Puppeteer', 'Browser closed');
  }
}

export default {
  scrapeVivinoPage,
  searchVivinoWithPuppeteer,
  scrapeDecanterPage,
  searchDecanterWithPuppeteer,
  closePuppeteerClient
};
