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
   * Try to extract vintage from explicit page signals (selectors/labels),
   * not only title/name text.
   * @returns {number|null}
   */
  function findVintageFromPageSignals() {
    const selectorCandidates = [
      '[itemprop="releaseDate"]',
      '[itemprop="productionDate"]',
      '[data-testid*="vintage"]',
      '[class*="vintage"]',
      '[id*="vintage"]',
      '[name*="vintage"]'
    ];

    for (const selector of selectorCandidates) {
      const node = document.querySelector(selector);
      if (!node) continue;

      const nodeText = [
        node.textContent,
        node.getAttribute?.('content'),
        node.getAttribute?.('value'),
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('title')
      ].filter(Boolean).join(' ');

      const vintage = parseVintage(nodeText);
      if (vintage) return vintage;
    }

    // Common spec tables: "Vintage: 2023" / "Year: 2023"
    const labelledNodes = document.querySelectorAll('dt, th, .label, .spec-label, .product-attribute__name');
    for (const labelNode of labelledNodes) {
      const label = (labelNode.textContent || '').trim();
      if (!/\b(vintage|year|harvest)\b/i.test(label)) continue;

      // try sibling value first
      const siblingText = [
        labelNode.nextElementSibling?.textContent,
        labelNode.parentElement?.querySelector('dd, td, .value, .spec-value, .product-attribute__value')?.textContent
      ].filter(Boolean).join(' ');

      const vintage = parseVintage(siblingText || label);
      if (vintage) return vintage;
    }

    return null;
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
    /\b(cabernet|sauvignon|merlot|pinotage|shiraz|syrah|chardonnay|chenin|blanc|noir|viognier|riesling|pinot|grenache|tempranillo|sangiovese|malbec|zinfandel|nebbiolo|mourv[eè]dre|cinsault|verdelho|vermentino|albarino|albar[iì]no|gruner|torront[eé]s|carmenere|barbera|dolcetto|primitivo|aglianico|fiano|verdicchio|pecorino|nero|corvina|amarone|valpolicella)\b/i,
    /\bwine\b|\bwinery\b|\bvintage\b|\bestate\b|\bcellar\b|\bvineyards?\b|\bwinemaker\b|\bvino\b/i,
    /\b(red wine|white wine|ros[eé]|rosato|rosso|bianco|sparkling wine|dessert wine|port|blanc de blancs|cap classique|brut|sec|demi.sec|doux|cr[eé]mant|prosecco|cava|sekt|pét.nat|pétillant)\b/i,
    /\b(appellation|ch[aâ]teau|domaine|clos|mas|bodega|quinta|tenuta|weingut|cantina|cave|cru|premier|grand|r[eé]serve|reserva|riserva|cuv[eé]e|tinto|blanco)\b/i
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

          const vintage = parseVintage(name) || parseVintage(item.description || '') || findVintageFromPageSignals();
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
    // Vivino — entire site is wine, so no isLikelyWine gating needed.
    // Their React app uses hashed class names, so we rely on semantic
    // selectors + URL params rather than fragile class-name matching.

    // 1. Wine name — Vivino puts the wine label name in the h1.
    //    On some page versions the h1 contains producer + name; on others
    //    the producer is a sibling element.
    const h1 = document.querySelector('h1');
    if (!h1) return null;
    const rawName = h1.textContent.trim();
    if (!rawName) return null;

    // Remove year tokens from the name (they belong in vintage field).
    const wineName = rawName.replace(/\b(19[0-9]{2}|20[0-2][0-9])\b/g, '').replace(/\s{2,}/g, ' ').trim();

    // 2. Vintage — prefer ?year= URL param (most reliable on Vivino).
    const urlYear = new URLSearchParams(window.location.search).get('year');
    const vintage = parseVintage(urlYear) || parseVintage(rawName) || findVintageFromPageSignals();

    // 3. Producer — Vivino links the winery, e.g. href contains "/wineries/".
    const producerEl =
      document.querySelector('a[href*="/wineries/"]') ||
      document.querySelector('a[href*="/winery/"]') ||
      document.querySelector('[class*="winery"] a, [class*="producer"] a');
    const producer = producerEl?.textContent.trim() || null;

    // 4. Price
    const priceData = parsePrice(findPriceText());

    return {
      wine_name: wineName || rawName,
      producer,
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
      vintage: parseVintage(name) || findVintageFromPageSignals(),
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
      vintage: parseVintage(name) || findVintageFromPageSignals(),
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
      vintage: parseVintage(name) || findVintageFromPageSignals(),
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'medium'
    };
  }

  // ── Extractor: Vinatis ─────────────────────────────────────────────────────

  /**
   * Extract wine from a Vinatis product page.
   * Product pages have titles like "BANDOL - LES ADRETS ROSE 2024 - MOULIN DE LA ROQUE".
   */
  function extractVinatis() {
    const h1 = document.querySelector('h1[itemprop="name"], h1');
    if (!h1) return null;
    const name = h1.textContent.trim();
    if (!name) return null;

    // Vinatis product names are always wine — entire site is a wine shop
    const vintage = parseVintage(name) || findVintageFromPageSignals();
    const priceData = parsePrice(findPriceText());

    // Try to extract producer from breadcrumbs or structured data
    const producerEl =
      document.querySelector('[itemprop="brand"] [itemprop="name"]') ||
      document.querySelector('[itemprop="brand"]') ||
      document.querySelector('.product-producer, .producer-name');
    const producer = producerEl?.textContent.trim() || null;

    return {
      wine_name: name,
      producer,
      vintage,
      ...(priceData || {}),
      vendor_url: window.location.href,
      confidence: 'high'
    };
  }

  /**
   * Extract multiple wines from a Vinatis cart or order history page.
   * Order rows contain wine name lines like "BANDOL - LES ADRETS ROSE 2024 - MOULIN DE LA ROQUE"
   * with unit price and quantity.
   * @returns {Array<object>|null}
   */
  function extractVinatisMulti() {
    const wines = [];
    const hostname = window.location.hostname.replace(/^www\./, '');
    if (hostname !== 'vinatis.com' && !hostname.endsWith('.vinatis.com')) return null;

    // Order history page: rows with wine name + price + quantity
    // Cart page: similar structure with line items
    // Detect by looking for multiple product-like rows
    const rows = document.querySelectorAll(
      '.order-detail-content tr, ' +
      '[class*="order"] [class*="product"], ' +
      '[class*="cart"] [class*="product"], ' +
      '[class*="cart"] [class*="item"], ' +
      '[class*="line-item"], ' +
      'table tbody tr'
    );

    for (const row of rows) {
      const text = row.textContent || '';
      // Look for rows that contain a price pattern (€) — these are product lines
      const priceMatch = text.match(/(\d+[.,]\d{2})\s*€/);
      if (!priceMatch) continue;

      // Extract the wine name — usually the longest text block or first cell
      const cells = row.querySelectorAll('td, .product-name, [class*="name"], [class*="title"]');
      let wineName = null;
      for (const cell of cells) {
        const cellText = cell.textContent.trim();
        // Wine names are typically the longest cell and contain wine signals or all-caps
        if (cellText.length > 10 && (isLikelyWine(cellText, '') || /^[A-Z\s\-'É0-9]+$/.test(cellText))) {
          wineName = cellText;
          break;
        }
      }

      // Fallback: scan all text nodes for all-caps wine name pattern
      if (!wineName) {
        const allCapsMatch = text.match(/([A-ZÉÈÊÀÂÔÙÛÇÎÏœŒ][A-ZÉÈÊÀÂÔÙÛÇÎÏœŒ\s\-'0-9]{8,})/);
        if (allCapsMatch) {
          wineName = allCapsMatch[1].trim();
        }
      }

      if (!wineName) continue;

      // Parse quantity (e.g., "x6", "x2")
      const qtyMatch = text.match(/x\s*(\d+)/i);
      const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

      // Parse unit price
      const unitPriceMatch = text.match(/(\d+[.,]\d{2})\s*€\s*x/i);
      const totalPriceMatch = text.match(/(\d+[.,]\d{2})\s*€\s*$/m);
      let unitPrice = null;
      if (unitPriceMatch) {
        unitPrice = parseFloat(unitPriceMatch[1].replace(',', '.'));
      } else if (totalPriceMatch && quantity > 1) {
        unitPrice = parseFloat(totalPriceMatch[1].replace(',', '.')) / quantity;
      } else if (priceMatch) {
        unitPrice = parseFloat(priceMatch[1].replace(',', '.'));
      }

      const vintage = parseVintage(wineName);

      wines.push({
        wine_name: wineName,
        producer: null,
        vintage,
        price: unitPrice,
        currency: 'EUR',
        quantity,
        vendor_url: window.location.href,
        confidence: 'medium'
      });
    }

    return wines.length > 0 ? wines : null;
  }

  const DOMAIN_EXTRACTORS = {
    'vivino.com':           extractVivino,
    'vinatis.com':          extractVinatis,
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
      vintage: parseVintage(title) || parseVintage(description) || findVintageFromPageSignals(),
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
      vintage: parseVintage(name) || parseVintage(title) || findVintageFromPageSignals(),
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

  /**
   * Extract multiple wines from a cart, order history, or listing page.
   * Currently supports Vinatis; returns null for unsupported domains.
   * @returns {Array<object>|null}
   */
  function extractMultipleWines() {
    return extractVinatisMulti() || null;
  }

  // ── Expose ───────────────────────────────────────────────────────────────────

  /* global window, module */

  const WineExtractors = {
    extractWineFromPage,
    extractMultipleWines,
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
