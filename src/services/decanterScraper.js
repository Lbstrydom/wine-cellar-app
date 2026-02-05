/**
 * @fileoverview Dedicated Decanter.com scraping logic.
 * Uses Web Unlocker with Puppeteer fallback for review extraction.
 * @module services/decanterScraper
 */

import logger from '../utils/logger.js';
import { TIMEOUTS } from '../config/scraperConfig.js';
import { BRIGHTDATA_API_URL } from './searchConstants.js';
import { createTimeoutAbort } from './fetchUtils.js';
import { getLocaleParams } from './queryBuilder.js';

/**
 * Extract wine review data from Decanter HTML.
 * Works with Web Unlocker responses.
 * @param {string} html - HTML content
 * @param {string} url - Original URL
 * @returns {Object|null} Review data or null
 */
export function extractDecanterDataFromHtml(html, url) {
  const data = { url };

  // Try JSON embedded data first (current Decanter format has inline JSON)
  const scoreMatch = html.match(/"score"\s*:\s*(\d{2,3})/);
  if (scoreMatch) {
    data.score = parseInt(scoreMatch[1], 10);
  }

  const drinkFromMatch = html.match(/"drink_from"\s*:\s*(\d{4})/);
  const drinkToMatch = html.match(/"drink_to"\s*:\s*(\d{4})/);
  if (drinkFromMatch && drinkToMatch) {
    data.drinkFrom = parseInt(drinkFromMatch[1], 10);
    data.drinkTo = parseInt(drinkToMatch[1], 10);
  }

  const reviewMatch = html.match(/"review"\s*:\s*"([^"]+)"/);
  if (reviewMatch) {
    data.tastingNotes = reviewMatch[1]
      .replace(/\\n/g, ' ')
      .replace(/\\u[\dA-Fa-f]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))
      .replace(/\\(.)/g, '$1')
      .trim();
  }

  // Extract vintage year from JSON data
  const vintageMatch = html.match(/"vintage"\s*:\s*(\d{4})/) ||
                       html.match(/"year"\s*:\s*(\d{4})/);
  if (vintageMatch) {
    data.vintage = parseInt(vintageMatch[1], 10);
  }

  // Fallback: structured data
  if (!data.score) {
    const ratingMatch = html.match(/itemprop="ratingValue"\s*content="(\d+)"/);
    if (ratingMatch) {
      data.score = parseInt(ratingMatch[1], 10);
    }
  }

  // Fallback: "XX points" pattern in text
  if (!data.score) {
    const pointsMatch = html.match(/(\d{2,3})\s*points/i);
    if (pointsMatch) {
      data.score = parseInt(pointsMatch[1], 10);
    }
  }

  // Wine name from title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) {
    data.wineName = titleMatch[1].split(/\s*[-|]\s*Decanter/i)[0].trim();
  }

  // Extract vintage from title if not found in JSON
  if (!data.vintage && data.wineName) {
    const titleVintageMatch = data.wineName.match(/\b(19|20)\d{2}\b/);
    if (titleVintageMatch) {
      data.vintage = parseInt(titleVintageMatch[0], 10);
    }
  }

  // Extract vintage from URL as last resort
  if (!data.vintage) {
    const urlVintageMatch = url.match(/-(19|20\d{2})-\d+$/);
    if (urlVintageMatch) {
      data.vintage = parseInt(urlVintageMatch[1] === '19' ? `19${url.match(/-(19\d{2})-/)[1].slice(2)}` : urlVintageMatch[0].match(/20\d{2}/)[0], 10);
    }
    // Simpler URL pattern
    const simpleUrlVintage = url.match(/\b(19|20)\d{2}\b/);
    if (!data.vintage && simpleUrlVintage) {
      data.vintage = parseInt(simpleUrlVintage[0], 10);
    }
  }

  // Validate score
  if (!data.score || data.score < 50 || data.score > 100) {
    return null;
  }

  return data;
}

/**
 * Scrape a Decanter review page using Web Unlocker.
 * @param {string} url - Decanter review URL
 * @param {string} apiKey - Bright Data API key
 * @param {string} webZone - Web Unlocker zone name
 * @returns {Promise<Object|null>} Review data or null
 */
export async function scrapeDecanterWithWebUnlocker(url, apiKey, webZone) {
  logger.info('Decanter', `Fetching via Web Unlocker: ${url}`);

  const { controller, cleanup } = createTimeoutAbort(TIMEOUTS.WEB_UNLOCKER_TIMEOUT);

  try {
    const response = await fetch(BRIGHTDATA_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        zone: webZone,
        url,
        format: 'raw'
      })
    });

    cleanup();

    if (!response.ok) {
      logger.warn('Decanter', `Web Unlocker returned ${response.status}`);
      return null;
    }

    const html = await response.text();
    logger.info('Decanter', `Got ${html.length} bytes from Web Unlocker`);

    const reviewData = extractDecanterDataFromHtml(html, url);

    if (reviewData) {
      logger.info('Decanter', `Web Unlocker extracted: ${reviewData.score} points${reviewData.drinkFrom ? ` (${reviewData.drinkFrom}-${reviewData.drinkTo})` : ''}`);
    } else {
      logger.warn('Decanter', 'Web Unlocker: Could not extract review data from HTML');
    }

    return reviewData;

  } catch (error) {
    cleanup();
    if (error.name === 'AbortError') {
      logger.warn('Decanter', 'Web Unlocker request timed out');
    } else {
      logger.warn('Decanter', `Web Unlocker error: ${error.message}`);
    }
    return null;
  }
}

/**
 * Search Google for Decanter reviews using SERP API.
 * @param {string} wineName - Wine name
 * @param {number} vintage - Vintage year
 * @param {string} apiKey - Bright Data API key
 * @param {string} serpZone - SERP zone name
 * @param {string} webZone - Web Unlocker zone name (fallback)
 * @returns {Promise<string[]>} Array of Decanter review URLs
 */
export async function searchGoogleForDecanter(wineName, vintage, apiKey, serpZone, webZone) {
  const wine = { wine_name: wineName, vintage, country: null };
  const { hl, gl } = getLocaleParams(wine);

  const tokens = wineName
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/\([^)]+\)/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .slice(0, 4);

  const googleQuery = `site:decanter.com/wine-reviews ${tokens.join(' ')} ${vintage || ''} points`.trim();

  logger.info('Decanter', `Google query: "${googleQuery}" (${hl}/${gl})`);

  const { controller, cleanup } = createTimeoutAbort(TIMEOUTS.SERP_API_TIMEOUT);

  try {
    let response;
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&num=10&hl=${hl}&gl=${gl}`;

    if (serpZone) {
      response = await fetch(BRIGHTDATA_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          zone: serpZone,
          url: googleUrl,
          format: 'raw'
        })
      });
    } else if (webZone) {
      response = await fetch(BRIGHTDATA_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          zone: webZone,
          url: googleUrl,
          format: 'raw'
        })
      });
    } else {
      logger.warn('Decanter', 'No SERP or Web Unlocker zone configured');
      cleanup();
      return [];
    }

    cleanup();

    if (!response.ok) {
      logger.error('Decanter', `SERP API returned ${response.status}`);
      return [];
    }

    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON, use text */ }

    const decanterUrls = [];

    if (data?.organic) {
      for (const result of data.organic) {
        const resultUrl = result.url || result.link;
        if (resultUrl?.includes('decanter.com/wine-reviews/') && resultUrl.match(/\d+$/)) {
          decanterUrls.push(resultUrl);
        }
      }
    } else if (text) {
      const urlPattern = /https?:\/\/(?:www\.)?decanter\.com\/wine-reviews\/[^"'\s]*\d+/gi;
      const matches = text.match(urlPattern) || [];
      decanterUrls.push(...new Set(matches));
    }

    // Score URLs by token matching in the slug
    const scoredUrls = decanterUrls.map(resultUrl => {
      const slug = resultUrl.split('/').pop().toLowerCase();
      let score = 0;
      let tokensMatched = 0;

      for (const token of tokens) {
        if (slug.includes(token)) {
          score += 10;
          tokensMatched++;
        }
      }

      if (vintage && slug.includes(String(vintage))) {
        score += 20;
      }

      return { url: resultUrl, score, tokensMatched };
    });

    scoredUrls.sort((a, b) => b.score - a.score);
    const minTokens = Math.max(1, tokens.length - 2);

    return scoredUrls
      .filter(u => u.tokensMatched >= minTokens)
      .slice(0, 3)
      .map(u => u.url);

  } catch (error) {
    cleanup();
    logger.error('Decanter', `SERP search failed: ${error.message}`);
    return [];
  }
}

/**
 * Search Decanter for wine reviews using Web Unlocker.
 * Uses Google SERP to find review URLs, then scrapes with Web Unlocker.
 * Falls back to Puppeteer if Web Unlocker fails.
 * @param {string} wineName - Wine name
 * @param {number} vintage - Vintage year
 * @returns {Promise<Object|null>} Review data or null
 */
export async function searchDecanterWithWebUnlocker(wineName, vintage) {
  const bdApiKey = process.env.BRIGHTDATA_API_KEY;
  const bdSerpZone = process.env.BRIGHTDATA_SERP_ZONE;
  const bdWebZone = process.env.BRIGHTDATA_WEB_ZONE;

  if (!bdApiKey) {
    logger.warn('Decanter', 'Bright Data API key not configured');
    return null;
  }

  logger.info('Decanter', `Searching via Web Unlocker: ${wineName} ${vintage}`);

  try {
    const { scrapeDecanterPage } = await import('./puppeteerScraper.js');

    const reviewUrls = await searchGoogleForDecanter(wineName, vintage, bdApiKey, bdSerpZone, bdWebZone);

    if (reviewUrls.length === 0) {
      logger.info('Decanter', 'No review URLs found in search results');
      return null;
    }

    logger.info('Decanter', `Found ${reviewUrls.length} review URL(s), fetching details...`);

    for (const url of reviewUrls) {
      let reviewData = null;

      if (bdWebZone) {
        reviewData = await scrapeDecanterWithWebUnlocker(url, bdApiKey, bdWebZone);
      }

      if (!reviewData) {
        try {
          logger.info('Decanter', `Trying Puppeteer fallback for: ${url}`);
          reviewData = await scrapeDecanterPage(url);
        } catch (err) {
          logger.warn('Decanter', `Puppeteer fallback failed: ${err.message}`);
        }
      }

      if (reviewData && reviewData.score) {
        try {
          const { generateIdentityTokens, calculateIdentityScore } = await import('./wineIdentity.js');
          const idTokens = generateIdentityTokens({ producer_name: wineName || '', vintage });
          const validationText = [reviewData.wineName || wineName, url].filter(Boolean).join(' ');
          const identity = calculateIdentityScore(validationText, idTokens);
          if (!identity.valid) {
            logger.info('Decanter', `Rejected non-matching Decanter review: ${identity.reason}`);
            continue;
          }
          reviewData.identity_score = identity.score;
          reviewData.identity_reason = identity.reason;
        } catch (e) {
          logger.warn('Decanter', `Identity validation skipped: ${e.message}`);
        }

        return reviewData;
      }
    }

    return null;

  } catch (error) {
    logger.error('Decanter', `Web Unlocker search failed: ${error.message}`);
    return null;
  }
}
