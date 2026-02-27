/**
 * @fileoverview Wine data extraction pipeline for content scripts.
 *
 * Runs as a regular (non-module) content script loaded BEFORE content.js.
 * Exposes window.WineExtractors = { extractWineFromPage, parseVintage, parsePrice, isLikelyWine }.
 *
 * Extraction pipeline (priority order):
 *   1. JSON-LD Product schema           → confidence: 'high'
 *   2. Domain-specific extractors       → confidence: 'medium'
 *   3. OpenGraph meta tags              → confidence: 'low'
 *   4. Generic heuristics (h1 + price)  → confidence: 'low'
 */

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Parse a vintage year (1900-2029) from text.
   * @param {string} text
   * @returns {number|null}
   */
  function parseVintage(text) {
    if (!text) return null;
    const m = String(text).match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * Parse price and currency from a string like "R 450.00" or "€12.50".
   * @param {string} text
   * @returns {{ price: number, currency: string }|null}
   */
  function parsePrice(text) {
    if (!text) return null;
    const t = String(text).trim();
    // ZAR: R 450, R450, ZAR 450
    const zarM = t.match(/(?:^|[\s(])(?:ZAR|R)\s*([\d\s,]+(?:\.\d{1,2})?)/i);
    if (zarM) return { price: parseFloat(zarM[1].replace(/[\s,]/g, '')), currency: 'ZAR' };
    // EUR
    const eurM = t.match(/(?:^|[\s(])(?:€|EUR)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (eurM) return { price: parseFloat(eurM[1].replace(',', '.')), currency: 'EUR' };
    // GBP
    const gbpM = t.match(/(?:^|[\s(])(?:£|GBP)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (gbpM) return { price: parseFloat(gbpM[1].replace(',', '.')), currency: 'GBP' };
    // USD
    const usdM = t.match(/(?:^|[\s(])(?:\$|USD)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (usdM) return { price: parseFloat(usdM[1].replace(',', '')), currency: 'USD' };
    return null;
  }

  /**
   * Scan common price element selectors and return the first text found.
   * @returns {string|null}
   */
  function findPriceText() {
    const selectors = [
      '[itemprop="price"]',
      '[class*="price"]',
      '[data-testid*="price"]',
      '.product-price',
      '#price',
      '.woocommerce-Price-amount'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
      }
    }
    return null;
  }

  // ── Wine signal detector ──────────────────────────────────────────────────────

  const WINE_SIGNALS = [
    /\b(cabernet|sauvignon|merlot|pinotage|shiraz|syrah|chardonnay|chenin|blanc|noir|viognier|riesling|pinot|grenache|tempranillo|sangiovese|malbec|zinfandel|nebbiolo|mourv[eè]dre|cinsault|verdelho)\b/i,
    /\bwine\b|\bwinery\b|\bvintage\b|\bestate\b|\bcellar\b|\bvineyards?\b|\bwinemaker\b/i,
    /\b(red wine|white wine|ros[eé]|sparkling wine|dessert wine|port|blanc de blancs|cap classique)\b/i,
    /\b(appellation|ch[aâ]teau|domaine|clos|mas|bodega|quinta|tenuta|weingut)\b/i
  ];

  /**
   * Check if a product name / description looks like a wine.
   * @param {string} name
   * @param {string} description
   * @returns {boolean}
   */
  function isLikelyWine(name, description) {
    const combined = `${name} ${description}`.toLowerCase();
    return WINE_SIGNALS.some(re => re.test(combined));
  }

  // ── Extractor 1: JSON-LD ────────────────────────────────────────────────────

  function extractFromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!item['@type']) continue;
          const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
          if (!types.some(t => /product|winerack|winery/i.test(t))) continue;
          const name = item.name;
          if (!name || !isLikelyWine(name, item.description || '')) continue;

          const vintage = parseVintage(name) || parseVintage(item.description || '');
          const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const price = offers?.price != null ? parseFloat(String(offers.price).replace(',', '.')) : null;
          const currency = offers?.priceCurrency || 'ZAR';

          return {
            wine_name: name,
            producer: item.brand?.name || item.manufacturer || null,
            vintage,
            price,
            currency: price != null ? currency : null,
            vendor_url: window.location.href,
            confidence: 'high'
          };
        }
      } catch (_) { /* malformed JSON — skip */ }
    }
    return null;
  }

  // ── Extractor 2: Domain-specific ─────────────────────────────────────────────

  function extractVivino() {
    const nameEl = document.querySelector('.vintage-name, .wine-name, h1[class*="wine"]');
    if (!nameEl) return null;
    const name = nameEl.textContent.trim();
    if (!isLikelyWine(name, '')) return null;
    const vinYear = document.querySelector('.vintage-year, [class*="vintage"]')?.textContent;
    const vintage = parseVintage(vinYear || name);
    const priceData = parsePrice(findPriceText());
    return {
      wine_name: name,
      producer: document.querySelector('.producer-name, [class*="winery"]')?.textContent.trim() || null,
      vintage,
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'high'
    };
  }

  function extractWoolworthsSA() {
    const h1 = document.querySelector('h1[class*="title"], h1.product-name, h1');
    if (!h1) return null;
    const name = h1.textContent.trim();
    if (!isLikelyWine(name, '')) return null;
    const priceData = parsePrice(
      document.querySelector('[class*="price"], .price__wrapper')?.textContent || ''
    );
    return {
      wine_name: name,
      producer: null,
      vintage: parseVintage(name),
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'medium'
    };
  }

  function extractTakealot() {
    const h1 = document.querySelector('h1[class*="title"], h1[data-ref*="title"], h1');
    if (!h1) return null;
    const name = h1.textContent.trim();
    if (!isLikelyWine(name, '')) return null;
    const priceData = parsePrice(
      document.querySelector('[class*="price"]')?.textContent || ''
    );
    return {
      wine_name: name,
      producer: null,
      vintage: parseVintage(name),
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'medium'
    };
  }

  /** Generic h1-based extractor used for known SA wine retail domains. */
  function extractGenericProductPage() {
    const h1 = document.querySelector('h1');
    if (!h1) return null;
    const name = h1.textContent.trim();
    if (!isLikelyWine(name, document.title || '')) return null;
    const priceData = parsePrice(findPriceText());
    return {
      wine_name: name,
      producer: null,
      vintage: parseVintage(name),
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'medium'
    };
  }

  const DOMAIN_EXTRACTORS = {
    'vivino.com':           extractVivino,
    'winemag.co.za':        extractGenericProductPage,
    'faithful2nature.co.za': extractGenericProductPage,
    'woolworths.co.za':     extractWoolworthsSA,
    'yuppiechef.com':       extractGenericProductPage,
    'wine.co.za':           extractGenericProductPage,
    'takealot.com':         extractTakealot
  };

  function runDomainExtractor() {
    const hostname = window.location.hostname.replace(/^www\./, '');
    const key = Object.keys(DOMAIN_EXTRACTORS).find(
      d => hostname === d || hostname.endsWith('.' + d)
    );
    if (!key) return null;
    try {
      return DOMAIN_EXTRACTORS[key]();
    } catch (_) {
      return null;
    }
  }

  // ── Extractor 3: OpenGraph ───────────────────────────────────────────────────

  function extractFromOpenGraph() {
    const ogMeta = (prop) =>
      document.querySelector(`meta[property="og:${prop}"]`)?.content || '';
    const title = ogMeta('title') || document.title || '';
    const description = ogMeta('description') || '';
    if (!isLikelyWine(title, description)) return null;
    const priceData = parsePrice(findPriceText());
    return {
      wine_name: title.trim(),
      producer: null,
      vintage: parseVintage(title) || parseVintage(description),
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'low'
    };
  }

  // ── Extractor 4: Generic heuristic ──────────────────────────────────────────

  function extractGenericHeuristic() {
    const h1 = document.querySelector('h1');
    const title = document.title || '';
    // Use h1 first, fall back to stripping site name from <title>
    const name = h1?.textContent.trim() ||
      title.split(/[|\-–]/).map(s => s.trim()).sort((a, b) => b.length - a.length)[0] || '';
    if (!name || !isLikelyWine(name, title)) return null;
    const priceData = parsePrice(findPriceText());
    return {
      wine_name: name,
      producer: null,
      vintage: parseVintage(name) || parseVintage(title),
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'low'
    };
  }

  // ── Pipeline ─────────────────────────────────────────────────────────────────

  /**
   * Run the full extraction pipeline. Returns first non-null result or null.
   * @returns {{
   *   wine_name: string, producer: string|null, vintage: number|null,
   *   price: number|null, currency: string|null, vendor_url: string,
   *   confidence: 'high'|'medium'|'low'
   * }|null}
   */
  function extractWineFromPage() {
    return (
      extractFromJsonLd() ||
      runDomainExtractor() ||
      extractFromOpenGraph() ||
      extractGenericHeuristic() ||
      null
    );
  }

  // ── Expose ───────────────────────────────────────────────────────────────────

  /* global window, module */

  const WineExtractors = {
    extractWineFromPage,
    parseVintage,
    parsePrice,
    isLikelyWine
  };

  // Browser: set on window (used by content.js)
  if (typeof window !== 'undefined') {
    window.WineExtractors = WineExtractors;
  }

  // Node/test environment: CommonJS export for vitest eval fallback
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = WineExtractors;
  }

})();
