/**
 * @fileoverview Unit tests for wine identity token generation.
 * Tests identity score calculation and token generation.
 */

import {
  generateIdentityTokens,
  calculateIdentityScore,
  calculateDiscoveryTokenOverlap
} from '../../../src/services/wineIdentity.js';

describe('wineIdentity', () => {
  describe('generateIdentityTokens', () => {
    it('should generate tokens from wine data', () => {
      const wine = {
        winery: 'Kanonkop',
        vintage: '2019',
        range_name: 'Paul Sauer',
        grape_variety: 'Cabernet Sauvignon',
        region: 'Stellenbosch',
        country: 'South Africa'
      };

      const tokens = generateIdentityTokens(wine);

      expect(tokens.identity).toBeDefined();
      expect(tokens.identity.producer).toBeDefined();
      expect(tokens.identity.vintage).toBe(2019);
      expect(tokens.discovery).toBeDefined();
      expect(tokens.negative).toBeDefined();
    });

    it('should handle missing fields', () => {
      const wine = {
        winery: 'Kanonkop',
        vintage: '2019'
      };

      const tokens = generateIdentityTokens(wine);

      expect(tokens.identity.producer.length).toBeGreaterThan(0);
      expect(tokens.identity.vintage).toBe(2019);
      expect(tokens.identity.range.length).toBe(0);
    });

    it('should normalize producer name', () => {
      const wine = {
        winery: 'Château Margaux',
        vintage: '2015'
      };

      const tokens = generateIdentityTokens(wine);

      expect(tokens.identity.producer).toBeDefined();
      expect(tokens._raw.producer).toBe('Château Margaux');
    });
  });

  describe('calculateIdentityScore', () => {
    it('should score exact match as valid', () => {
      const wine = {
        winery: 'Kanonkop',
        vintage: '2019'
      };
      const tokens = generateIdentityTokens(wine);

      const text = 'Kanonkop Paul Sauer 2019 - Wine Spectator 94 points';
      const result = calculateIdentityScore(text, tokens);

      expect(result.valid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(4);
      expect(result.matches.producerMatch).toBe(true);
      expect(result.matches.vintageMatch).toBe(true);
    });

    it('should reject wrong vintage', () => {
      const wine = {
        winery: 'Penfolds',
        vintage: '2018'
      };
      const tokens = generateIdentityTokens(wine);

      const text = 'Penfolds Grange 2020 Review';
      const result = calculateIdentityScore(text, tokens);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('vintage_missing_or_wrong');
    });

    it('should reject missing producer', () => {
      const wine = {
        winery: 'Kanonkop',
        vintage: '2019'
      };
      const tokens = generateIdentityTokens(wine);

      const text = 'Paul Sauer 2019 Wine Review';
      const result = calculateIdentityScore(text, tokens);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('producer_missing');
    });

    it('should detect negative tokens', () => {
      const wine = {
        winery: 'Penfolds',
        vintage: '2018'
      };
      const tokens = generateIdentityTokens(wine);

      expect(tokens.negative).toBeDefined();
      expect(tokens.negative.producerCompeting).toBeDefined();
    });

    it('should boost score for range match', () => {
      const wine = {
        winery: 'Kanonkop',
        vintage: '2019',
        range_name: 'Paul Sauer'
      };
      const tokens = generateIdentityTokens(wine);

      const textWithRange = 'Kanonkop Paul Sauer 2019 Review';
      const textWithoutRange = 'Kanonkop Red Wine 2019 Review';

      const resultWith = calculateIdentityScore(textWithRange, tokens);
      const resultWithout = calculateIdentityScore(textWithoutRange, tokens);

      expect(resultWith.score).toBeGreaterThan(resultWithout.score);
    });
  });

  describe('calculateDiscoveryTokenOverlap', () => {
    it('should calculate overlap score', () => {
      const wine = {
        winery: 'Kanonkop',
        vintage: '2019',
        region: 'Stellenbosch'
      };
      const tokens = generateIdentityTokens(wine);

      const title = 'Kanonkop Paul Sauer 2019 Stellenbosch Red Wine';
      const score = calculateDiscoveryTokenOverlap(title, tokens.discovery);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return 0 for no matches', () => {
      const wine = {
        winery: 'Kanonkop',
        vintage: '2019'
      };
      const tokens = generateIdentityTokens(wine);

      const title = 'Some Random Wine Review';
      const score = calculateDiscoveryTokenOverlap(title, tokens.discovery);

      expect(score).toBe(0);
    });

    it('should weight name tokens higher than region', () => {
      const wine = {
        winery: 'Kanonkop',
        region: 'Stellenbosch'
      };
      const tokens = generateIdentityTokens(wine);

      const titleWithName = 'Kanonkop Random Region';
      const titleWithRegion = 'Unknown Producer Stellenbosch';

      const scoreWithName = calculateDiscoveryTokenOverlap(titleWithName, tokens.discovery);
      const scoreWithRegion = calculateDiscoveryTokenOverlap(titleWithRegion, tokens.discovery);

      expect(scoreWithName).toBeGreaterThan(scoreWithRegion);
    });
  });
});
