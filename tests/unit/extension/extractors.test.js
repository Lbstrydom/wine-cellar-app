// @vitest-environment jsdom
/**
 * @fileoverview Unit tests for extension/shared/extractors.js.
 *
 * The file is a browser IIFE (non-module) that sets window.WineExtractors.
 * We load it in the jsdom environment via readFileSync + eval so that
 * window.WineExtractors is populated before tests run.
 *
 * Coverage areas:
 *   - parseVintage   — year extraction from text
 *   - parsePrice     — ZAR/EUR/GBP/USD parsing
 *   - isLikelyWine   — signal detection
 *   - extractWineFromPage — full pipeline with mocked DOM
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load the IIFE into jsdom's window ─────────────────────────────────────────

let WE; // alias for window.WineExtractors

beforeAll(() => {
  const code = readFileSync(
    join(__dirname, '../../../extension/shared/extractors.js'),
    'utf8'
  );
  // eslint-disable-next-line no-eval
  eval(code);
  WE = window.WineExtractors;
});

// ── parseVintage ──────────────────────────────────────────────────────────────

describe('parseVintage', () => {
  it('extracts a 4-digit year from a wine name', () => {
    expect(WE.parseVintage('Kanonkop Paul Sauer 2019')).toBe(2019);
  });

  it('extracts year from middle of string', () => {
    expect(WE.parseVintage('2021 Mullineux Syrah Swartland')).toBe(2021);
  });

  it('handles early-century vintages', () => {
    expect(WE.parseVintage('Penfolds Grange 2001')).toBe(2001);
  });

  it('returns null when no year is present', () => {
    expect(WE.parseVintage('Mullineux Syrah')).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(WE.parseVintage('')).toBeNull();
    expect(WE.parseVintage(null)).toBeNull();
    expect(WE.parseVintage(undefined)).toBeNull();
  });

  it('does not match years outside 1900-2029', () => {
    expect(WE.parseVintage('Barrel 1800')).toBeNull();
    expect(WE.parseVintage('Vintage 2035')).toBeNull();
  });
});

// ── parsePrice ────────────────────────────────────────────────────────────────

describe('parsePrice', () => {
  it('parses ZAR with R prefix', () => {
    const r = WE.parsePrice('R 450.00');
    expect(r).toEqual({ price: 450, currency: 'ZAR' });
  });

  it('parses ZAR without space', () => {
    const r = WE.parsePrice('R650');
    expect(r).toEqual({ price: 650, currency: 'ZAR' });
  });

  it('parses ZAR with explicit ZAR prefix', () => {
    const r = WE.parsePrice('ZAR 1 200.00');
    expect(r).not.toBeNull();
    expect(r.currency).toBe('ZAR');
  });

  it('parses EUR with € symbol', () => {
    const r = WE.parsePrice('€ 24.50');
    expect(r).toEqual({ price: 24.5, currency: 'EUR' });
  });

  it('parses GBP with £ symbol', () => {
    const r = WE.parsePrice('£12.99');
    expect(r).toEqual({ price: 12.99, currency: 'GBP' });
  });

  it('parses USD with $ symbol', () => {
    const r = WE.parsePrice('$29');
    expect(r).toEqual({ price: 29, currency: 'USD' });
  });

  it('returns null for text with no recognisable price', () => {
    expect(WE.parsePrice('Add to cart')).toBeNull();
    expect(WE.parsePrice('')).toBeNull();
    expect(WE.parsePrice(null)).toBeNull();
  });
});

// ── isLikelyWine ──────────────────────────────────────────────────────────────

describe('isLikelyWine', () => {
  it('returns true for a grape variety mention', () => {
    expect(WE.isLikelyWine('Kanonkop Pinotage 2019', '')).toBe(true);
  });

  it('returns true for Cabernet Sauvignon', () => {
    expect(WE.isLikelyWine('Paul Sauer Cabernet Sauvignon', '')).toBe(true);
  });

  it('returns true for "red wine" in description', () => {
    expect(WE.isLikelyWine('Product', 'A full-bodied red wine')).toBe(true);
  });

  it('returns true for "estate" in name', () => {
    expect(WE.isLikelyWine('Buitenverwachting Estate', '')).toBe(true);
  });

  it('returns true for French wine terms', () => {
    expect(WE.isLikelyWine('Château Margaux', '')).toBe(true);
  });

  it('returns false for a non-wine product', () => {
    expect(WE.isLikelyWine('Samsung 65" QLED TV', 'Smart TV with 4K resolution')).toBe(false);
  });

  it('returns false for generic food product', () => {
    expect(WE.isLikelyWine('Organic Olive Oil Extra Virgin', '')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(WE.isLikelyWine('', '')).toBe(false);
  });
});

// ── extractWineFromPage — JSON-LD path ───────────────────────────────────────

describe('extractWineFromPage — JSON-LD', () => {
  beforeEach(() => {
    // Clean up injected scripts and body after each test
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => el.remove());
    document.body.innerHTML = '';
    // Default location
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/wine', hostname: 'example.com' },
      writable: true
    });
  });

  it('extracts wine from valid Product JSON-LD with price', () => {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Kanonkop Paul Sauer 2019',
      brand: { '@type': 'Brand', name: 'Kanonkop' },
      description: 'Iconic Cabernet Sauvignon blend from Stellenbosch.',
      offers: { '@type': 'Offer', price: '1200.00', priceCurrency: 'ZAR' }
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);

    const result = WE.extractWineFromPage();
    expect(result).not.toBeNull();
    expect(result.wine_name).toBe('Kanonkop Paul Sauer 2019');
    expect(result.producer).toBe('Kanonkop');
    expect(result.vintage).toBe(2019);
    expect(result.price).toBe(1200);
    expect(result.currency).toBe('ZAR');
    expect(result.confidence).toBe('high');
  });

  it('returns null if JSON-LD product is not a wine', () => {
    const ld = {
      '@type': 'Product',
      name: 'Wireless Keyboard',
      description: 'Compact wireless keyboard for laptops.'
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);

    // No h1, no og: — all extractors should fail
    const result = WE.extractWineFromPage();
    expect(result).toBeNull();
  });

  it('handles malformed JSON-LD gracefully', () => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = '{ invalid json ';
    document.head.appendChild(script);

    // Should not throw
    expect(() => WE.extractWineFromPage()).not.toThrow();
  });
});

// ── extractWineFromPage — OpenGraph path ─────────────────────────────────────

describe('extractWineFromPage — OpenGraph fallback', () => {
  beforeEach(() => {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => el.remove());
    document.querySelectorAll('meta[property^="og:"]').forEach(el => el.remove());
    document.body.innerHTML = '';
  });

  function addOg(prop, content) {
    const meta = document.createElement('meta');
    meta.setAttribute('property', prop);
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
  }

  it('extracts wine from og:title with grape variety', () => {
    addOg('og:title', 'Mullineux Syrah 2020 | Swartland Wine');
    addOg('og:description', 'Exceptional Syrah from Swartland');

    const result = WE.extractWineFromPage();
    expect(result).not.toBeNull();
    expect(result.wine_name).toBe('Mullineux Syrah 2020 | Swartland Wine');
    expect(result.vintage).toBe(2020);
    expect(result.confidence).toBe('low');
  });

  it('returns null if og:title is not wine-related', () => {
    addOg('og:title', 'Buy Running Shoes Online');
    addOg('og:description', 'Best prices on athletic footwear');

    const result = WE.extractWineFromPage();
    expect(result).toBeNull();
  });
});

// ── extractWineFromPage — Generic heuristic path ─────────────────────────────

describe('extractWineFromPage — generic heuristic', () => {
  beforeEach(() => {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => el.remove());
    document.querySelectorAll('meta[property^="og:"]').forEach(el => el.remove());
    document.body.innerHTML = '';
    document.title = '';
  });

  it('extracts wine from h1 with "Chardonnay"', () => {
    document.body.innerHTML = `
      <h1>Waterkloof Chardonnay 2022</h1>
      <div class="price">R 280.00</div>
    `;

    const result = WE.extractWineFromPage();
    expect(result).not.toBeNull();
    expect(result.wine_name).toBe('Waterkloof Chardonnay 2022');
    expect(result.vintage).toBe(2022);
    expect(result.confidence).toBe('low');
  });

  it('returns null when h1 contains no wine signals', () => {
    document.body.innerHTML = '<h1>Blue Denim Jeans</h1>';
    document.title = 'Fashion Store';

    const result = WE.extractWineFromPage();
    expect(result).toBeNull();
  });

  it('returns null for a completely empty page', () => {
    document.body.innerHTML = '';
    document.title = '';

    const result = WE.extractWineFromPage();
    expect(result).toBeNull();
  });
});
