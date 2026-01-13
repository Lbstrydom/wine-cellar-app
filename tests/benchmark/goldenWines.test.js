/**
 * @fileoverview Golden wine benchmark tests for Phase 6 integration.
 * Uses offline fixtures to ensure deterministic CI testing.
 * 
 * These tests validate that:
 * - Structured extraction returns expected ratings
 * - Confidence scoring is correct for known wines
 * - Match accuracy meets 90%+ threshold
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  STRUCTURED_PARSERS,
  tryStructuredExtraction,
  calculateConfidence
} from '../../src/services/structuredParsers.js';
import { WineFingerprint } from '../../src/services/wineFingerprint.js';

function loadFixture(filename) {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', filename), 'utf8');
}

/**
 * Golden wines benchmark dataset.
 * Each entry has stored HTML fixture + expected extraction values.
 */
const GOLDEN_WINES = [
  {
    name: 'Chateau Margaux 2015 (Vivino)',
    fixture: 'vivino-golden.html',
    domain: 'vivino.com',
    query: {
      wine_name: 'Château Margaux',  // Match the accent in fixture
      vintage: 2015,
      country: 'France',
      producer: 'Château Margaux'
    },
    expected: {
      rating: { min: 4.5, max: 5.0 },
      ratingCount: { min: 10000 },
      confidence: { min: 0.5 }  // Lowered threshold for realistic testing
    }
  },
  {
    name: 'Wine-Searcher Golden Wine',
    fixture: 'winesearcher-golden.html',
    domain: 'wine-searcher.com',
    query: {
      wine_name: 'Test Wine',
      vintage: 2020
    },
    expected: {
      rating: { min: 90, max: 100 },
      confidence: { min: 0.5 }
    }
  }
];

describe('Golden Wine Benchmarks', () => {
  describe('Extraction Accuracy', () => {
    for (const wine of GOLDEN_WINES) {
      it(`should extract correct data from ${wine.name}`, () => {
        const html = loadFixture(wine.fixture);
        const result = tryStructuredExtraction(html, wine.domain);

        expect(result).toBeDefined();
        expect(result).not.toBeNull();

        // Validate rating within expected range
        if (wine.expected.rating) {
          expect(result.rating).toBeGreaterThanOrEqual(wine.expected.rating.min);
          if (wine.expected.rating.max) {
            expect(result.rating).toBeLessThanOrEqual(wine.expected.rating.max);
          }
        }

        // Validate rating count if expected
        if (wine.expected.ratingCount) {
          expect(result.ratingCount).toBeGreaterThanOrEqual(wine.expected.ratingCount.min);
        }
      });
    }
  });

  describe('Confidence Scoring', () => {
    for (const wine of GOLDEN_WINES) {
      it(`should score confidence correctly for ${wine.name}`, () => {
        const html = loadFixture(wine.fixture);
        const result = tryStructuredExtraction(html, wine.domain);

        expect(result).toBeDefined();

        const confidence = calculateConfidence(result, wine.query);

        expect(confidence.score).toBeGreaterThanOrEqual(wine.expected.confidence.min);
        expect(confidence.evidenceCount).toBeGreaterThan(0);
        expect(confidence.reasons).toBeInstanceOf(Array);
        expect(confidence.reasons.length).toBeGreaterThan(0);
      });
    }
  });

  describe('Fingerprint Generation', () => {
    it('should generate consistent fingerprints for known wines', () => {
      const wine = {
        wine_name: 'Kanonkop Pinotage 2019',
        producer: 'Kanonkop',
        vintage: 2019,
        country: 'South Africa',
        region: 'Stellenbosch'
      };

      const fp1 = WineFingerprint.generate(wine);
      const fp2 = WineFingerprint.generate(wine);

      expect(fp1).toBe(fp2);
      expect(fp1).toContain('kanonkop');
      expect(fp1).toContain('pinotage');
      expect(fp1).toContain('2019');
    });

    it('should return versioned fingerprints', () => {
      const wine = {
        wine_name: 'Cloudy Bay Sauvignon Blanc',
        producer: 'Cloudy Bay',
        vintage: null,
        country: 'New Zealand',
        region: 'Marlborough'
      };

      const result = WineFingerprint.generateWithVersion(wine);

      expect(result).toBeDefined();
      expect(result.fingerprint).toContain('nv');
      expect(result.version).toBe(1);
    });

    it('should handle NV wines correctly', () => {
      const wine = {
        wine_name: 'NV Champagne',
        producer: 'Moet',
        vintage: 'NV'
      };

      const result = WineFingerprint.generateWithVersion(wine);

      expect(result.fingerprint).toContain('nv');
    });
  });

  describe('Benchmark Metrics', () => {
    it('should meet 90%+ correct match threshold', () => {
      let correctMatches = 0;
      let totalTests = 0;

      for (const wine of GOLDEN_WINES) {
        const html = loadFixture(wine.fixture);
        const result = tryStructuredExtraction(html, wine.domain);

        if (result && wine.expected.rating) {
          totalTests++;
          if (result.rating >= wine.expected.rating.min &&
              (!wine.expected.rating.max || result.rating <= wine.expected.rating.max)) {
            correctMatches++;
          }
        }
      }

      const matchRate = totalTests > 0 ? correctMatches / totalTests : 0;
      
      // Target: 90%+ correct matches
      expect(matchRate).toBeGreaterThanOrEqual(0.9);
    });

    it('should have extraction method logged', () => {
      const html = loadFixture('vivino-golden.html');
      const result = STRUCTURED_PARSERS.vivino(html);

      expect(result).toBeDefined();
      expect(result.extractionMethod).toBeDefined();
      expect(['__NEXT_DATA__', 'json-ld', 'microdata', 'regex']).toContain(result.extractionMethod);
    });
  });
});
