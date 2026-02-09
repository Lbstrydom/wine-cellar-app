/**
 * @fileoverview Unit tests for Structured Parsers (Phase 5).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  STRUCTURED_PARSERS,
  DOMAIN_PARSERS,
  tryStructuredExtraction,
  getParsersForDomain,
  hasDomainParser,
  calculateConfidence
} from '../../../../src/services/ratings/structuredParsers.js';

// Helper to load fixtures
function loadFixture(filename) {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', filename), 'utf8');
}

describe('Structured Parsers', () => {
  describe('Vivino Parser', () => {
    it('should extract rating from __NEXT_DATA__', () => {
      const html = loadFixture('vivino-golden.html');
      const result = STRUCTURED_PARSERS.vivino(html);

      expect(result).toBeDefined();
      expect(result.rating).toBeCloseTo(4.6, 1);
      expect(result.source).toBe('vivino');
      expect(result.extractionMethod).toBe('__NEXT_DATA__');
      expect(result.confidence).toBe('high');
    });

    it('should extract rating count', () => {
      const html = loadFixture('vivino-golden.html');
      const result = STRUCTURED_PARSERS.vivino(html);

      expect(result.ratingCount).toBe(15234);
    });

    it('should extract vintage year', () => {
      const html = loadFixture('vivino-golden.html');
      const result = STRUCTURED_PARSERS.vivino(html);

      expect(result.vintage).toBe(2015);
    });

    it('should extract wine name', () => {
      const html = loadFixture('vivino-golden.html');
      const result = STRUCTURED_PARSERS.vivino(html);

      const normalized = result.wineName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      expect(normalized).toBe('Chateau Margaux');
    });

    it('should extract producer', () => {
      const html = loadFixture('vivino-golden.html');
      const result = STRUCTURED_PARSERS.vivino(html);

      const normalized = result.producer
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      expect(normalized).toBe('Chateau Margaux');
    });

    it('should extract price', () => {
      const html = loadFixture('vivino-golden.html');
      const result = STRUCTURED_PARSERS.vivino(html);

      expect(result.price).toBeDefined();
      expect(result.price.amount).toBe(850.00);
      expect(result.price.currency).toBe('USD');
    });

    it('should return null for HTML without __NEXT_DATA__', () => {
      const html = '<html><body>No data here</body></html>';
      const result = STRUCTURED_PARSERS.vivino(html);

      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const html = '<script id="__NEXT_DATA__">{invalid json}</script>';
      const result = STRUCTURED_PARSERS.vivino(html);

      expect(result).toBeNull();
    });

    it('should return null for empty HTML', () => {
      const result = STRUCTURED_PARSERS.vivino('');
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = STRUCTURED_PARSERS.vivino(null);
      expect(result).toBeNull();
    });
  });

  describe('JSON-LD Parser', () => {
    it('should extract rating from JSON-LD Product', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result).toBeDefined();
      expect(result.rating).toBeCloseTo(4.8, 1);
      expect(result.source).toBe('structured');
      expect(result.extractionMethod).toBe('json-ld');
      expect(result.confidence).toBe('high');
    });

    it('should extract review count', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result.ratingCount).toBe(342);
    });

    it('should extract best and worst ratings', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result.bestRating).toBe(5);
      expect(result.worstRating).toBe(1);
    });

    it('should extract product name', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = STRUCTURED_PARSERS.jsonld(html);

      const normalized = result.wineName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      expect(normalized).toBe('Penfolds Grange Shiraz 2018');
    });

    it('should extract price from offers', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result.price).toBeDefined();
      expect(result.price.amount).toBe(899.99);
      expect(result.price.currency).toBe('USD');
    });

    it('should handle JSON-LD array format', () => {
      const html = loadFixture('winecom-jsonld-array.html');
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result).toBeDefined();
      expect(result.rating).toBeCloseTo(4.5, 1);
      expect(result.ratingCount).toBe(2891);
    });

    it('should handle ratingCount vs reviewCount', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": 4.2,
            "ratingCount": 500
          }
        }
        </script>
      `;
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result.ratingCount).toBe(500);
    });

    it('should return null for HTML without JSON-LD', () => {
      const html = '<html><body>No JSON-LD here</body></html>';
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result).toBeNull();
    });

    it('should return null for JSON-LD without Product type', () => {
      const html = `
        <script type="application/ld+json">
        { "@type": "Organization", "name": "Test" }
        </script>
      `;
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result).toBeNull();
    });

    it('should return null for Product without aggregateRating', () => {
      const html = `
        <script type="application/ld+json">
        { "@type": "Product", "name": "Wine" }
        </script>
      `;
      const result = STRUCTURED_PARSERS.jsonld(html);

      expect(result).toBeNull();
    });
  });

  describe('Microdata Parser', () => {
    it('should extract rating from microdata', () => {
      const html = loadFixture('klwines-microdata.html');
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result).toBeDefined();
      expect(result.rating).toBe(96);
      expect(result.source).toBe('microdata');
      expect(result.extractionMethod).toBe('microdata');
      expect(result.confidence).toBe('medium');
    });

    it('should extract review count', () => {
      const html = loadFixture('klwines-microdata.html');
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result.ratingCount).toBe(128);
    });

    it('should extract best rating', () => {
      const html = loadFixture('klwines-microdata.html');
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result.bestRating).toBe(100);
    });

    it('should extract product name', () => {
      const html = loadFixture('klwines-microdata.html');
      const result = STRUCTURED_PARSERS.microdata(html);

      const normalized = result.wineName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      expect(normalized).toBe('Opus One 2019');
    });

    it('should handle content attribute for rating', () => {
      const html = '<span itemprop="ratingValue" content="4.5">*****</span>';
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result).toBeDefined();
      expect(result.rating).toBe(4.5);
    });

    it('should handle text content for rating', () => {
      const html = '<span itemprop="ratingValue">87</span>';
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result.rating).toBe(87);
    });

    it('should handle reviewCount as alternative to ratingCount', () => {
      const html = `
        <span itemprop="ratingValue">4.2</span>
        <span itemprop="reviewCount">1,234</span>
      `;
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result.rating).toBe(4.2);
      expect(result.ratingCount).toBe(1234);
    });

    it('should strip commas from review counts', () => {
      const html = `
        <span itemprop="ratingValue">4.7</span>
        <span itemprop="ratingCount">12,345</span>
      `;
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result.ratingCount).toBe(12345);
    });

    it('should return null for HTML without microdata', () => {
      const html = '<html><body>No microdata here</body></html>';
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result).toBeNull();
    });

    it('should return null if no rating found', () => {
      const html = '<span itemprop="name">Wine Name</span>';
      const result = STRUCTURED_PARSERS.microdata(html);

      expect(result).toBeNull();
    });
  });

  describe('Wine-Searcher Parser', () => {
    it('should extract rating from JSON-LD', () => {
      const html = loadFixture('winesearcher-golden.html');
      const result = STRUCTURED_PARSERS.wineSearcher(html);

      expect(result).toBeDefined();
      expect(result.rating).toBe(95);
      expect(result.source).toBe('wine-searcher');
      expect(result.extractionMethod).toBe('wine-searcher');
    });

    it('should extract rating count', () => {
      const html = loadFixture('winesearcher-golden.html');
      const result = STRUCTURED_PARSERS.wineSearcher(html);

      expect(result.ratingCount).toBe(487);
    });

    it('should fallback to span.review-score pattern', () => {
      const html = '<span class="review-score">92</span><p>150 reviews</p>';
      const result = STRUCTURED_PARSERS.wineSearcher(html);

      expect(result.rating).toBe(92);
      expect(result.ratingCount).toBe(150);
    });

    it('should return null for empty HTML', () => {
      const result = STRUCTURED_PARSERS.wineSearcher('');
      expect(result).toBeNull();
    });
  });

  describe('tryStructuredExtraction', () => {
    it('should extract from Vivino domain', () => {
      const html = loadFixture('vivino-golden.html');
      const result = tryStructuredExtraction(html, 'vivino.com');

      expect(result).toBeDefined();
      expect(result.rating).toBeCloseTo(4.6, 1);
      expect(result.domain).toBe('vivino.com');
      expect(result.timestamp).toBeDefined();
    });

    it('should extract from Total Wine domain', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = tryStructuredExtraction(html, 'totalwine.com');

      expect(result).toBeDefined();
      expect(result.rating).toBeCloseTo(4.8, 1);
      expect(result.domain).toBe('totalwine.com');
    });

    it('should extract from K&L Wines domain', () => {
      const html = loadFixture('klwines-microdata.html');
      const result = tryStructuredExtraction(html, 'klwines.com');

      expect(result).toBeDefined();
      expect(result.rating).toBe(96);
      expect(result.domain).toBe('klwines.com');
    });

    it('should normalize www. prefix from domain', () => {
      const html = loadFixture('vivino-golden.html');
      const result = tryStructuredExtraction(html, 'www.vivino.com');

      expect(result).toBeDefined();
      expect(result.domain).toBe('vivino.com');
    });

    it('should try parsers in configured order', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = tryStructuredExtraction(html, 'totalwine.com');

      // Should try jsonld first (configured), which succeeds
      expect(result.extractionMethod).toBe('json-ld');
    });

    it('should fallback to generic parsers for unknown domains', () => {
      const html = loadFixture('totalwine-jsonld.html');
      const result = tryStructuredExtraction(html, 'unknown-domain.com');

      expect(result).toBeDefined();
      expect(result.rating).toBeCloseTo(4.8, 1);
    });

    it('should return null when all parsers fail', () => {
      const html = '<html><body>No structured data</body></html>';
      const result = tryStructuredExtraction(html, 'vivino.com');

      expect(result).toBeNull();
    });

    it('should return null for empty HTML', () => {
      const result = tryStructuredExtraction('', 'vivino.com');
      expect(result).toBeNull();
    });

    it('should return null for null HTML', () => {
      const result = tryStructuredExtraction(null, 'vivino.com');
      expect(result).toBeNull();
    });

    it('should return null for missing domain', () => {
      const html = loadFixture('vivino-golden.html');
      const result = tryStructuredExtraction(html, null);
      expect(result).toBeNull();
    });
  });

  describe('getParsersForDomain', () => {
    it('should return configured parsers for Vivino', () => {
      const parsers = getParsersForDomain('vivino.com');
      expect(parsers).toEqual(['vivino', 'jsonld']);
    });

    it('should return configured parsers for Total Wine', () => {
      const parsers = getParsersForDomain('totalwine.com');
      expect(parsers).toEqual(['jsonld', 'microdata']);
    });

    it('should return generic parsers for unknown domain', () => {
      const parsers = getParsersForDomain('unknown.com');
      expect(parsers).toEqual(['jsonld', 'microdata']);
    });

    it('should normalize www. prefix', () => {
      const parsers = getParsersForDomain('www.vivino.com');
      expect(parsers).toEqual(['vivino', 'jsonld']);
    });
  });

  describe('hasDomainParser', () => {
    it('should return true for Vivino', () => {
      expect(hasDomainParser('vivino.com')).toBe(true);
    });

    it('should return true for Total Wine', () => {
      expect(hasDomainParser('totalwine.com')).toBe(true);
    });

    it('should return true for K&L Wines', () => {
      expect(hasDomainParser('klwines.com')).toBe(true);
    });

    it('should return false for unknown domain', () => {
      expect(hasDomainParser('unknown.com')).toBe(false);
    });

    it('should handle www. prefix', () => {
      expect(hasDomainParser('www.vivino.com')).toBe(true);
    });
  });

  describe('Domain Parser Configuration', () => {
    it('should have Vivino domain configured', () => {
      expect(DOMAIN_PARSERS['vivino.com']).toBeDefined();
      expect(DOMAIN_PARSERS['vivino.com']).toContain('vivino');
    });

    it('should have Total Wine domain configured', () => {
      expect(DOMAIN_PARSERS['totalwine.com']).toBeDefined();
      expect(DOMAIN_PARSERS['totalwine.com']).toContain('jsonld');
    });

    it('should have K&L Wines domain configured', () => {
      expect(DOMAIN_PARSERS['klwines.com']).toBeDefined();
      expect(DOMAIN_PARSERS['klwines.com']).toContain('microdata');
    });

    it('should have Wine-Searcher domain configured', () => {
      expect(DOMAIN_PARSERS['wine-searcher.com']).toBeDefined();
      expect(DOMAIN_PARSERS['wine-searcher.com']).toContain('wineSearcher');
    });

    it('should have all parsers as functions', () => {
      Object.values(STRUCTURED_PARSERS).forEach(parser => {
        expect(typeof parser).toBe('function');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle HTML with multiple JSON-LD blocks', () => {
      const html = `
        <script type="application/ld+json">{"@type": "Organization"}</script>
        <script type="application/ld+json">{"@type": "Product", "name": "Wine", "aggregateRating": {"@type": "AggregateRating", "ratingValue": 4.5, "reviewCount": 100}}</script>
      `;
      const result = STRUCTURED_PARSERS.jsonld(html);
      expect(result).toBeDefined();
      expect(result.rating).toBe(4.5);
    });

    it('should handle malformed microdata gracefully', () => {
      const html = '<span itemprop="ratingValue">not a number</span>';
      const result = STRUCTURED_PARSERS.microdata(html);
      // parseFloat returns NaN, which is falsy, so function returns null
      expect(result).toBeNull();
    });

    it('should handle missing optional fields', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Product",
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": 4.0
          }
        }
        </script>
      `;
      const result = STRUCTURED_PARSERS.jsonld(html);
      expect(result.rating).toBe(4.0);
      expect(result.ratingCount).toBeUndefined();
    });

    it('should handle very large rating counts', () => {
      const html = '<span itemprop="ratingValue">4.5</span><span itemprop="ratingCount">1,234,567</span>';
      const result = STRUCTURED_PARSERS.microdata(html);
      expect(result.ratingCount).toBe(1234567);
    });

    it('should handle decimal ratings with many decimal places', () => {
      const html = '<span itemprop="ratingValue">4.567890</span>';
      const result = STRUCTURED_PARSERS.microdata(html);
      expect(result.rating).toBeCloseTo(4.568, 2);
    });
  });

  describe('calculateConfidence', () => {
    it('should score higher for strong matches', () => {
      const result = {
        rating: 4.5,
        ratingCount: 500,
        wineName: 'Kanonkop Pinotage 2019',
        vintage: 2019
      };
      const query = { wine_name: 'Kanonkop Pinotage 2019', vintage: 2019 };
      const confidence = calculateConfidence(result, query);
      expect(confidence.score).toBeGreaterThan(0.7);
      expect(confidence.evidenceCount).toBeGreaterThan(0);
    });

    it('should handle missing data gracefully', () => {
      const confidence = calculateConfidence(null, { wine_name: 'Test' });
      expect(confidence.score).toBe(0);
      expect(confidence.reasons).toContain('no_result');
    });
  });

});
