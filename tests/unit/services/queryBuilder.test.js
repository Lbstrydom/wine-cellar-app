/**
 * @fileoverview Tests for locale-aware query builder (Phase 3).
 * @module tests/unit/services/queryBuilder.test.js
 */


import {
  getLocaleParams,
  buildQueryVariants,
  buildSearchQuery,
  shouldRetryWithoutOperators
} from '../../../src/services/queryBuilder.js';

describe('Query Builder (Phase 3)', () => {
  describe('getLocaleParams', () => {
    it('should return correct locale for South African wine', () => {
      const wine = { country: 'South Africa' };
      const params = getLocaleParams(wine);
      
      expect(params.hl).toBe('en');
      expect(params.gl).toBe('za');
    });

    it('should return correct locale for French wine', () => {
      const wine = { country: 'France' };
      const params = getLocaleParams(wine);
      
      expect(params.hl).toBe('fr');
      expect(params.gl).toBe('fr');
    });

    it('should default to en/us for unknown country', () => {
      const wine = { country: 'Unknown' };
      const params = getLocaleParams(wine);
      
      expect(params.hl).toBe('en');
      expect(params.gl).toBe('us');
    });

    it('should handle missing country', () => {
      const wine = {};
      const params = getLocaleParams(wine);
      
      expect(params.hl).toBe('en');
      expect(params.gl).toBe('us');
    });
  });

  describe('buildQueryVariants', () => {
    const wine = {
      wine_name: 'Kanonkop Paul Sauer',
      vintage: 2019,
      producer: 'Kanonkop',
      country: 'South Africa'
    };

    it('should build review query variants', () => {
      const variants = buildQueryVariants(wine, 'reviews');
      
      expect(variants.length).toBeGreaterThan(0);
      expect(variants[0]).toContain('review rating points');
      expect(variants[0]).toContain('2019');
    });

    it('should include region-specific sources for SA wine', () => {
      const variants = buildQueryVariants(wine, 'reviews');
      const hasRegionSource = variants.some(v => 
        v.includes('Platter') || v.includes('Tim Atkin')
      );
      
      expect(hasRegionSource).toBe(true);
    });

    it('should build award query variants', () => {
      const variants = buildQueryVariants(wine, 'awards');
      
      expect(variants[0]).toContain('award medal');
      expect(variants.some(v => v.includes('Michelangelo'))).toBe(true);
    });

    it('should build community query variants', () => {
      const variants = buildQueryVariants(wine, 'community');
      
      expect(variants[0]).toContain('site:vivino.com');
      expect(variants[1]).toContain('site:cellartracker.com');
    });

    it('should build producer query variants', () => {
      const variants = buildQueryVariants(wine, 'producer');
      
      expect(variants[0]).toContain('site:');
      expect(variants[0]).toContain('awards');
    });
  });

  describe('buildSearchQuery', () => {
    const wine = {
      wine_name: 'Penfolds Grange',
      vintage: 2018,
      country: 'Australia'
    };

    it('should include locale params', () => {
      const result = buildSearchQuery(wine, 'reviews');
      
      expect(result.localeParams.hl).toBe('en');
      expect(result.localeParams.gl).toBe('au');
    });

    it('should provide multiple query variants', () => {
      const result = buildSearchQuery(wine, 'reviews');
      
      expect(result.queries.length).toBeGreaterThan(0);
    });

    it('should add site restrictions when strictOperators enabled', () => {
      const result = buildSearchQuery(wine, 'reviews', {
        siteDomains: ['winespectator.com', 'jancisrobinson.com'],
        strictOperators: true
      });
      
      expect(result.queries[0]).toContain('site:');
      expect(result.retryQueries.length).toBeGreaterThan(0);
    });

    it('should provide retry queries without operators', () => {
      const result = buildSearchQuery(wine, 'reviews', {
        siteDomains: ['example.com'],
        strictOperators: true
      });
      
      // Retry queries should not have site: operators
      expect(result.retryQueries[0]).not.toContain('site:');
    });
  });

  describe('shouldRetryWithoutOperators', () => {
    it('should retry when zero results with site: operators', () => {
      const results = [];
      const query = 'wine rating site:example.com';
      
      expect(shouldRetryWithoutOperators(results, query)).toBe(true);
    });

    it('should retry when few results with OR operators', () => {
      const results = [{ url: 'test1' }, { url: 'test2' }];
      const query = 'wine (site:a.com OR site:b.com)';
      
      expect(shouldRetryWithoutOperators(results, query)).toBe(true);
    });

    it('should not retry when sufficient results', () => {
      const results = [
        { url: 'test1' },
        { url: 'test2' },
        { url: 'test3' },
        { url: 'test4' }
      ];
      const query = 'wine rating site:example.com';
      
      expect(shouldRetryWithoutOperators(results, query)).toBe(false);
    });

    it('should not retry when no operators used', () => {
      const results = [];
      const query = 'wine rating';
      
      expect(shouldRetryWithoutOperators(results, query)).toBe(false);
    });
  });

  describe('Region-Specific Sources', () => {
    it('should include Halliday for Australian wines', () => {
      const wine = {
        wine_name: 'Penfolds Grange',
        vintage: 2018,
        country: 'Australia'
      };
      const variants = buildQueryVariants(wine, 'reviews');
      
      expect(variants.some(v => v.includes('Halliday'))).toBe(true);
    });

    it('should include Platters for South African wines', () => {
      const wine = {
        wine_name: 'Kanonkop Paul Sauer',
        vintage: 2019,
        country: 'South Africa'
      };
      const variants = buildQueryVariants(wine, 'reviews');
      
      expect(variants.some(v => v.includes('Platter'))).toBe(true);
    });

    it('should include Revue du Vin for French wines', () => {
      const wine = {
        wine_name: 'Château Margaux',
        vintage: 2015,
        country: 'France'
      };
      const variants = buildQueryVariants(wine, 'reviews');
      
      expect(variants.some(v => v.includes('Revue du Vin') || v.includes('Bettane'))).toBe(true);
    });
  });
});
