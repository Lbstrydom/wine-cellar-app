/**
 * @fileoverview Puppeteer-based web scraper using MCP server.
 * Provides reliable scraping for JavaScript-heavy sites like Vivino and Decanter.
 * @module services/puppeteerScraper
 */

import { spawn } from 'child_process';
import logger from '../utils/logger.js';
import { TIMEOUTS, COOKIE_CONSENT_SELECTORS } from '../config/scraperConfig.js';

/**
 * Simple MCP client that communicates with puppeteer-mcp-server via JSON-RPC over stdio.
 */
class MCPPuppeteerClient {
  constructor() {
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.isConnected = false;
  }

  /**
   * Connect to the MCP Puppeteer server.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isConnected) return;

    return new Promise((resolve, reject) => {
      logger.info('Puppeteer', 'Starting MCP server...');

      this.process = spawn('npx', ['-y', 'puppeteer-mcp-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('error') || msg.includes('Error')) {
          logger.warn('Puppeteer', `Server stderr: ${msg.substring(0, 200)}`);
        }
      });

      this.process.on('error', (err) => {
        this.isConnected = false;
        reject(new Error(`Failed to start MCP server: ${err.message}`));
      });

      this.process.on('exit', (code) => {
        this.isConnected = false;
        logger.info('Puppeteer', `MCP server exited with code ${code}`);
      });

      // Give server time to start, then initialize
      setTimeout(async () => {
        try {
          await this.initialize();
          this.isConnected = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      }, TIMEOUTS.MCP_SERVER_START);
    });
  }

  /**
   * Process incoming JSON-RPC messages from the server.
   */
  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        if (response.id && this.pendingRequests.has(response.id)) {
          const { resolve, reject } = this.pendingRequests.get(response.id);
          this.pendingRequests.delete(response.id);
          if (response.error) {
            reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else {
            resolve(response.result);
          }
        }
      } catch {
        // Not valid JSON, might be log output
      }
    }
  }

  /**
   * Send a JSON-RPC request to the server.
   * @param {string} method - RPC method name
   * @param {Object} params - Method parameters
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Object>}
   */
  async sendRequest(method, params = {}, timeoutMs = TIMEOUTS.MCP_REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      const requestStr = JSON.stringify(request) + '\n';
      this.process.stdin.write(requestStr);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, timeoutMs);
    });
  }

  /**
   * Initialize the MCP connection.
   * @returns {Promise<Object>}
   */
  async initialize() {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'wine-cellar-app',
        version: '1.0.0'
      }
    });

    // Send initialized notification
    const notif = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n';
    this.process.stdin.write(notif);

    logger.info('Puppeteer', 'MCP connection initialized');
    return result;
  }

  /**
   * Call an MCP tool.
   * @param {string} name - Tool name
   * @param {Object} args - Tool arguments
   * @param {number} timeoutMs - Timeout
   * @returns {Promise<Object>}
   */
  async callTool(name, args = {}, timeoutMs = TIMEOUTS.MCP_REQUEST_TIMEOUT) {
    return await this.sendRequest('tools/call', { name, arguments: args }, timeoutMs);
  }

  /**
   * Navigate to a URL.
   * @param {string} url - URL to navigate to
   * @returns {Promise<boolean>} Success status
   */
  async navigate(url) {
    const result = await this.callTool('puppeteer_navigate', { url });
    const text = result?.content?.[0]?.text || '';
    return text.includes('Successfully navigated') || text.includes('Status: 200');
  }

  /**
   * Click an element on the page.
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>} Success status
   */
  async click(selector) {
    try {
      await this.callTool('puppeteer_click', { selector });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute JavaScript in the browser and return the result.
   * IMPORTANT: The puppeteer-mcp-server requires scripts to use 'return' statements.
   * This method wraps scripts that don't have return in a function.
   * @param {string} script - JavaScript code to execute
   * @returns {Promise<any>} Execution result
   */
  async evaluate(script) {
    // The MCP puppeteer server requires explicit return statements
    // Wrap the script if it doesn't already have a return
    let wrappedScript = script.trim();
    if (!wrappedScript.startsWith('return ')) {
      // If it's an IIFE or function call, wrap it with return
      wrappedScript = `return (${wrappedScript});`;
    }

    const result = await this.callTool('puppeteer_evaluate', { script: wrappedScript });
    const text = result?.content?.[0]?.text || '';

    // Parse the result format: 'Execution result:\n"<value>"\n\nConsole output:\n'
    const resultMatch = text.match(/Execution result:\s*"([\s\S]*?)"\s*\n\nConsole output:/);
    if (resultMatch) {
      const unescaped = resultMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

      try {
        return JSON.parse(unescaped);
      } catch {
        return unescaped;
      }
    }

    // Try direct JSON parse for simple values
    const directMatch = text.match(/Execution result:\s*([\s\S]*?)\s*\n\nConsole output:/);
    if (directMatch) {
      const value = directMatch[1].trim();
      if (value === 'undefined' || value === 'null') return null;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return null;
  }

  /**
   * Close the MCP server connection.
   */
  async close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isConnected = false;
    }
  }
}

// Singleton client instance
let clientInstance = null;
let lastUsedTime = 0;

// ============================================================================
// HELPER FUNCTIONS (DRY - extracted common patterns)
// ============================================================================

/**
 * Accept cookie consent dialog on a page.
 * Handles various consent frameworks (OneTrust, native, etc.)
 * @param {MCPPuppeteerClient} client - The MCP client
 * @param {string} siteType - Site type: 'vivino', 'decanter', or 'generic'
 * @returns {Promise<void>}
 */
async function acceptCookieConsent(client, siteType = 'generic') {
  const selectors = COOKIE_CONSENT_SELECTORS[siteType] || COOKIE_CONSENT_SELECTORS.generic;

  // Build script to try all selectors
  const selectorChecks = selectors
    .filter(s => s.type === 'selector')
    .map(s => `document.querySelector('${s.value}')`)
    .join(' || ');

  const textChecks = selectors
    .filter(s => s.type === 'text')
    .map(s => s.value);

  const script = `
    // Try CSS selectors first
    ${selectorChecks ? `const btn = ${selectorChecks}; if (btn) { btn.click(); }` : ''}
    // Try finding by text content
    const buttons = Array.from(document.querySelectorAll('button'));
    const textMatches = ${JSON.stringify(textChecks)};
    for (const text of textMatches) {
      const match = buttons.find(b => b.textContent.trim().toLowerCase() === text.toLowerCase());
      if (match) { match.click(); break; }
    }
  `;

  await client.evaluate(script);
  await wait(TIMEOUTS.COOKIE_CONSENT_WAIT);
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
 * Get or create the MCP client instance.
 * Reuses existing client if still active, otherwise creates new one.
 * @returns {Promise<MCPPuppeteerClient>}
 */
async function getClient() {
  const now = Date.now();

  // If client exists and was used recently, try to reuse it
  if (clientInstance && clientInstance.isConnected && (now - lastUsedTime) < TIMEOUTS.CLIENT_IDLE_TIMEOUT) {
    lastUsedTime = now;
    return clientInstance;
  }

  // Close old client if exists
  if (clientInstance) {
    try {
      await clientInstance.close();
    } catch {
      // Ignore close errors
    }
    clientInstance = null;
  }

  // Create new client
  clientInstance = new MCPPuppeteerClient();
  await clientInstance.connect();
  lastUsedTime = now;
  return clientInstance;
}

/**
 * Scrape Vivino wine page and extract wine data.
 * @param {string} url - Vivino wine URL
 * @returns {Promise<Object|null>} Wine data or null on failure
 */
export async function scrapeVivinoPage(url) {
  let client = null;

  try {
    client = await getClient();
    logger.info('Puppeteer', `Navigating to Vivino: ${url}`);

    const navSuccess = await client.navigate(url);
    if (!navSuccess) {
      logger.warn('Puppeteer', 'Navigation failed');
      return null;
    }

    // Wait for SPA to render
    logger.info('Puppeteer', `Waiting for page to render (${TIMEOUTS.SPA_RENDER_WAIT / 1000}s)...`);
    await wait(TIMEOUTS.SPA_RENDER_WAIT);

    // Click cookie consent
    await acceptCookieConsent(client, 'vivino');

    // Extract wine data
    const wineData = await client.evaluate(`
      (() => {
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
            const match = el.textContent.match(/([\\d,]+)\\s*rating/i);
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
        const idMatch = window.location.pathname.match(/\\/w\\/(\\d+)/);
        if (idMatch) data.vivinoId = parseInt(idMatch[1], 10);

        return JSON.stringify(data);
      })()
    `);

    if (!wineData || typeof wineData !== 'object') {
      logger.warn('Puppeteer', 'No wine data extracted from page');
      return null;
    }

    logger.info('Puppeteer', `Vivino: ${wineData.wineName} - ${wineData.rating}★ (${wineData.ratingCount} ratings)`);
    return wineData;

  } catch (error) {
    logger.error('Puppeteer', `Vivino scrape failed: ${error.message}`);
    return null;
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
  let client = null;

  try {
    client = await getClient();
    logger.info('Puppeteer', `Navigating to Decanter: ${url}`);

    const navSuccess = await client.navigate(url);
    if (!navSuccess) {
      logger.warn('Puppeteer', 'Navigation failed');
      return null;
    }

    // Wait for page to render
    await wait(TIMEOUTS.PAGE_LOAD_WAIT);

    // Accept cookies if prompted
    await acceptCookieConsent(client, 'decanter');

    // Extract review data
    const reviewData = await client.evaluate(`
      (() => {
        const data = {};

        // Try JSON embedded data first (current Decanter format)
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const text = script.textContent || '';
          const scoreMatch = text.match(/"score"\\s*:\\s*(\\d{2,3})/);
          if (scoreMatch) {
            data.score = parseInt(scoreMatch[1], 10);
          }
          const drinkFromMatch = text.match(/"drink_from"\\s*:\\s*(\\d{4})/);
          const drinkToMatch = text.match(/"drink_to"\\s*:\\s*(\\d{4})/);
          if (drinkFromMatch && drinkToMatch) {
            data.drinkFrom = parseInt(drinkFromMatch[1], 10);
            data.drinkTo = parseInt(drinkToMatch[1], 10);
          }
          const reviewMatch = text.match(/"review"\\s*:\\s*"([^"]+)"/);
          if (reviewMatch) {
            data.tastingNotes = reviewMatch[1]
              .replace(/\\\\n/g, ' ')
              .replace(/\\\\u[\\dA-Fa-f]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))
              .replace(/\\\\(.)/g, '$1')
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
          const pointsMatch = bodyText.match(/(\\d{2,3})\\s*points/i);
          if (pointsMatch) {
            data.score = parseInt(pointsMatch[1], 10);
          }
        }

        // Wine name
        const h1 = document.querySelector('h1');
        if (h1) data.wineName = h1.textContent.trim();

        // URL
        data.url = window.location.href;

        return JSON.stringify(data);
      })()
    `);

    if (!reviewData || !reviewData.score || reviewData.score < 50 || reviewData.score > 100) {
      logger.warn('Puppeteer', `Decanter: No valid score found (got: ${reviewData?.score})`);
      return null;
    }

    logger.info('Puppeteer', `Decanter: ${reviewData.score} points${reviewData.drinkFrom ? ` (Drink ${reviewData.drinkFrom}-${reviewData.drinkTo})` : ''}`);
    return reviewData;

  } catch (error) {
    logger.error('Puppeteer', `Decanter scrape failed: ${error.message}`);
    return null;
  }
}

/**
 * Search Decanter for wine reviews.
 * @param {string} wineName - Wine name
 * @param {number} vintage - Vintage year
 * @returns {Promise<Object|null>} Best matching review or null
 */
export async function searchDecanterWithPuppeteer(wineName, vintage) {
  try {
    const client = await getClient();

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
    // The /wine-reviews/search/ URL doesn't filter results
    const searchQuery = `${tokens.join(' ')} ${vintage || ''} wine review`.trim();
    const searchUrl = `https://www.decanter.com/?s=${encodeURIComponent(searchQuery)}`;

    logger.info('Puppeteer', `Decanter search: "${searchQuery}"`);
    const navSuccess = await client.navigate(searchUrl);
    if (!navSuccess) {
      return null;
    }

    // Wait for search results
    await wait(TIMEOUTS.SEARCH_RESULTS_WAIT);

    // Accept cookies if prompted
    await acceptCookieConsent(client, 'decanter');

    // Find matching wine review URLs
    const vintageStr = String(vintage || '');
    const matchingUrl = await client.evaluate(`
      (() => {
        const tokens = ${JSON.stringify(tokens)};
        const vintageStr = "${vintageStr}";
        const minTokensToMatch = Math.max(1, tokens.length - 1); // Require most tokens to match

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
          if (!href.match(/\\d+$/)) continue;

          const slug = href.split('/').pop().toLowerCase();
          let score = 0;
          let tokensMatched = 0;

          // Token matches - require most tokens to match for a valid result
          for (const token of tokens) {
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
          if (vintageStr && slug.includes(vintageStr)) {
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
      })()
    `);

    if (!matchingUrl) {
      logger.info('Puppeteer', 'Decanter: No matching wine review found');
      return null;
    }

    logger.info('Puppeteer', `Decanter: Found review at ${matchingUrl}`);
    return await scrapeDecanterPage(matchingUrl);

  } catch (error) {
    logger.error('Puppeteer', `Decanter search failed: ${error.message}`);
    return null;
  }
}

/**
 * Close the shared Puppeteer client.
 * Call this when shutting down the server.
 */
export async function closePuppeteerClient() {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
  }
}

export default {
  scrapeVivinoPage,
  searchVivinoWithPuppeteer,
  scrapeDecanterPage,
  searchDecanterWithPuppeteer,
  closePuppeteerClient
};
