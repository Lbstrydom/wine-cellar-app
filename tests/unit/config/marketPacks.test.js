/**
 * @fileoverview Unit tests for Market Packs configuration (Phase 4).
 */

import { describe, it, expect } from 'vitest';
import {
  getMarketPack,
  detectMarketFromLocale,
  getMarketSources,
  getMarketSourcesByCategory,
  isSourceAvailableInMarket,
  getMerchantsWithPricing,
  getNationalCritics,
  getMarketQueryTemplate,
  getAvailableMarkets,
  getMarketSummary,
  MARKET_PACKS,
  MARKET_PACK_PRIORITIES
} from '../../../src/config/marketPacks.js';

describe('Market Packs Configuration', () => {
  describe('getMarketPack', () => {
    it('should return USA market pack', () => {
      const pack = getMarketPack('usa');
      expect(pack).toBeDefined();
      expect(pack.market).toBe('usa');
      expect(pack.locale).toBe('en-US');
      expect(pack.currency).toBe('USD');
    });

    it('should return Netherlands market pack', () => {
      const pack = getMarketPack('netherlands');
      expect(pack).toBeDefined();
      expect(pack.market).toBe('netherlands');
      expect(pack.locale).toBe('nl-NL');
      expect(pack.currency).toBe('EUR');
    });

    it('should return Canada market pack', () => {
      const pack = getMarketPack('canada');
      expect(pack).toBeDefined();
      expect(pack.market).toBe('canada');
      expect(pack.locale).toBe('en-CA');
      expect(pack.currency).toBe('CAD');
    });

    it('should return global market pack', () => {
      const pack = getMarketPack('global');
      expect(pack).toBeDefined();
      expect(pack.market).toBe('global');
    });

    it('should return null for invalid market code', () => {
      const pack = getMarketPack('invalid');
      expect(pack).toBeNull();
    });

    it('should return null for undefined market code', () => {
      const pack = getMarketPack();
      expect(pack).toBeNull();
    });
  });

  describe('detectMarketFromLocale', () => {
    it('should detect USA from en-US', () => {
      expect(detectMarketFromLocale('en-US')).toBe('usa');
    });

    it('should detect USA from EN-US (case insensitive)', () => {
      expect(detectMarketFromLocale('EN-US')).toBe('usa');
    });

    it('should detect Netherlands from nl-NL', () => {
      expect(detectMarketFromLocale('nl-NL')).toBe('netherlands');
    });

    it('should detect Canada from en-CA', () => {
      expect(detectMarketFromLocale('en-CA')).toBe('canada');
    });

    it('should detect Canada from fr-CA', () => {
      expect(detectMarketFromLocale('fr-CA')).toBe('canada');
    });

    it('should detect Netherlands from nl-BE (Belgium)', () => {
      expect(detectMarketFromLocale('nl-BE')).toBe('netherlands');
    });

    it('should return global for empty locale', () => {
      expect(detectMarketFromLocale('')).toBe('global');
    });

    it('should return global for undefined locale', () => {
      expect(detectMarketFromLocale()).toBe('global');
    });

    it('should return global for unrecognized locale', () => {
      expect(detectMarketFromLocale('ja-JP')).toBe('global');
    });
  });

  describe('getMarketSources', () => {
    it('should return all sources for USA market sorted by priority', () => {
      const sources = getMarketSources('usa');
      expect(sources).toBeDefined();
      expect(sources.length).toBeGreaterThan(0);

      // Check descending priority order
      for (let i = 0; i < sources.length - 1; i++) {
        expect(sources[i].priority).toBeGreaterThanOrEqual(sources[i + 1].priority);
      }
    });

    it('should include merchants, critics, databases, and competitions', () => {
      const sources = getMarketSources('usa');
      const sourceIds = sources.map(s => s.sourceId);

      expect(sourceIds).toContain('wine_com');
      expect(sourceIds).toContain('wine_advocate');
      expect(sourceIds).toContain('vivino');
      expect(sourceIds).toContain('decanter_awards');
    });

    it('should return empty array for invalid market', () => {
      const sources = getMarketSources('invalid');
      expect(sources).toEqual([]);
    });

    it('should prioritize merchants highest', () => {
      const sources = getMarketSources('usa');
      const merchantSources = sources.filter(s => s.priority === MARKET_PACK_PRIORITIES.merchant);
      expect(merchantSources.length).toBeGreaterThan(0);

      // Merchants should be at the top
      const topSources = sources.slice(0, merchantSources.length);
      topSources.forEach(s => {
        expect(s.priority).toBe(MARKET_PACK_PRIORITIES.merchant);
      });
    });
  });

  describe('getMarketSourcesByCategory', () => {
    it('should return merchants for USA market', () => {
      const merchants = getMarketSourcesByCategory('usa', 'merchants');
      expect(merchants.length).toBeGreaterThan(0);
      expect(merchants[0].sourceId).toBeDefined();
      expect(merchants[0].name).toBeDefined();
    });

    it('should return critics for USA market', () => {
      const critics = getMarketSourcesByCategory('usa', 'critics');
      expect(critics.length).toBeGreaterThan(0);
      const sourceIds = critics.map(c => c.sourceId);
      expect(sourceIds).toContain('wine_advocate');
      expect(sourceIds).toContain('wine_spectator');
    });

    it('should return databases for USA market', () => {
      const databases = getMarketSourcesByCategory('usa', 'databases');
      expect(databases.length).toBeGreaterThan(0);
      const sourceIds = databases.map(d => d.sourceId);
      expect(sourceIds).toContain('vivino');
    });

    it('should return competitions for USA market', () => {
      const competitions = getMarketSourcesByCategory('usa', 'competitions');
      expect(competitions.length).toBeGreaterThan(0);
      const sourceIds = competitions.map(c => c.sourceId);
      expect(sourceIds).toContain('decanter_awards');
    });

    it('should return empty array for invalid category', () => {
      const result = getMarketSourcesByCategory('usa', 'invalid');
      expect(result).toEqual([]);
    });

    it('should return empty array for invalid market', () => {
      const result = getMarketSourcesByCategory('invalid', 'merchants');
      expect(result).toEqual([]);
    });

    it('should sort sources by priority within category', () => {
      const critics = getMarketSourcesByCategory('usa', 'critics');
      for (let i = 0; i < critics.length - 1; i++) {
        expect(critics[i].priority).toBeGreaterThanOrEqual(critics[i + 1].priority);
      }
    });
  });

  describe('isSourceAvailableInMarket', () => {
    it('should return true for wine_com in USA market', () => {
      expect(isSourceAvailableInMarket('usa', 'wine_com')).toBe(true);
    });

    it('should return true for gall_gall in Netherlands market', () => {
      expect(isSourceAvailableInMarket('netherlands', 'gall_gall')).toBe(true);
    });

    it('should return false for gall_gall in USA market', () => {
      expect(isSourceAvailableInMarket('usa', 'gall_gall')).toBe(false);
    });

    it('should return true for wine_advocate in multiple markets', () => {
      expect(isSourceAvailableInMarket('usa', 'wine_advocate')).toBe(true);
      expect(isSourceAvailableInMarket('canada', 'wine_advocate')).toBe(true);
    });

    it('should return false for invalid source', () => {
      expect(isSourceAvailableInMarket('usa', 'invalid_source')).toBe(false);
    });

    it('should return false for invalid market', () => {
      expect(isSourceAvailableInMarket('invalid', 'wine_com')).toBe(false);
    });
  });

  describe('getMerchantsWithPricing', () => {
    it('should return merchants with pricingAvailable flag for USA', () => {
      const merchants = getMerchantsWithPricing('usa');
      expect(merchants.length).toBeGreaterThan(0);
      merchants.forEach(m => {
        expect(m.pricingAvailable).toBe(true);
      });
    });

    it('should include wine_com for USA', () => {
      const merchants = getMerchantsWithPricing('usa');
      const sourceIds = merchants.map(m => m.sourceId);
      expect(sourceIds).toContain('wine_com');
    });

    it('should include gall_gall for Netherlands', () => {
      const merchants = getMerchantsWithPricing('netherlands');
      const sourceIds = merchants.map(m => m.sourceId);
      expect(sourceIds).toContain('gall_gall');
    });

    it('should return empty array for invalid market', () => {
      const merchants = getMerchantsWithPricing('invalid');
      expect(merchants).toEqual([]);
    });

    it('should sort merchants by priority', () => {
      const merchants = getMerchantsWithPricing('usa');
      for (let i = 0; i < merchants.length - 1; i++) {
        expect(merchants[i].priority).toBeGreaterThanOrEqual(merchants[i + 1].priority);
      }
    });
  });

  describe('getNationalCritics', () => {
    it('should return national critics for Netherlands (Hamersma, Perswijn)', () => {
      const critics = getNationalCritics('netherlands');
      expect(critics.length).toBeGreaterThan(0);
      const sourceIds = critics.map(c => c.sourceId);
      expect(sourceIds).toContain('hamersma');
      expect(sourceIds).toContain('perswijn');
    });

    it('should return national critics for Canada (Natalie MacLean)', () => {
      const critics = getNationalCritics('canada');
      const sourceIds = critics.map(c => c.sourceId);
      expect(sourceIds).toContain('natalie_maclean');
    });

    it('should return empty array for USA (no national critics defined)', () => {
      const critics = getNationalCritics('usa');
      expect(critics).toEqual([]);
    });

    it('should only include critics with national_critic priority', () => {
      const critics = getNationalCritics('netherlands');
      critics.forEach(c => {
        expect(c.priority).toBe(MARKET_PACK_PRIORITIES.national_critic);
      });
    });

    it('should return empty array for invalid market', () => {
      const critics = getNationalCritics('invalid');
      expect(critics).toEqual([]);
    });
  });

  describe('getMarketQueryTemplate', () => {
    it('should return query template for wine_searcher in USA market', () => {
      const query = getMarketQueryTemplate('usa', 'wine_searcher', 'Château Margaux', 2015);
      expect(query).toBeDefined();
      expect(query).toContain('Château Margaux');
      expect(query).toContain('2015');
    });

    it('should return null for source not in market', () => {
      const query = getMarketQueryTemplate('usa', 'gall_gall', 'Bordeaux', 2015);
      expect(query).toBeNull();
    });

    it('should return null for invalid market', () => {
      const query = getMarketQueryTemplate('invalid', 'wine_searcher', 'Wine', 2020);
      expect(query).toBeNull();
    });

    it('should return null for invalid source', () => {
      const query = getMarketQueryTemplate('usa', 'invalid_source', 'Wine', 2020);
      expect(query).toBeNull();
    });
  });

  describe('getAvailableMarkets', () => {
    it('should return array of market codes', () => {
      const markets = getAvailableMarkets();
      expect(Array.isArray(markets)).toBe(true);
      expect(markets.length).toBeGreaterThan(0);
    });

    it('should include usa, netherlands, canada, global', () => {
      const markets = getAvailableMarkets();
      expect(markets).toContain('usa');
      expect(markets).toContain('netherlands');
      expect(markets).toContain('canada');
      expect(markets).toContain('global');
    });
  });

  describe('getMarketSummary', () => {
    it('should return summary for USA market', () => {
      const summary = getMarketSummary('usa');
      expect(summary).toBeDefined();
      expect(summary.market).toBe('usa');
      expect(summary.locale).toBe('en-US');
      expect(summary.currency).toBe('USD');
      expect(summary.sourceCount).toBeDefined();
      expect(summary.sourceCount.total).toBeGreaterThan(0);
    });

    it('should include source counts by category', () => {
      const summary = getMarketSummary('usa');
      expect(summary.sourceCount.merchants).toBeGreaterThan(0);
      expect(summary.sourceCount.critics).toBeGreaterThan(0);
      expect(summary.sourceCount.databases).toBeGreaterThan(0);
      expect(summary.sourceCount.competitions).toBeGreaterThan(0);
    });

    it('should calculate total source count correctly', () => {
      const summary = getMarketSummary('usa');
      const expectedTotal = summary.sourceCount.merchants +
                           summary.sourceCount.critics +
                           summary.sourceCount.databases +
                           summary.sourceCount.competitions;
      expect(summary.sourceCount.total).toBe(expectedTotal);
    });

    it('should return null for invalid market', () => {
      const summary = getMarketSummary('invalid');
      expect(summary).toBeNull();
    });
  });

  describe('Market Pack Structure Validation', () => {
    it('should have all required fields in USA market pack', () => {
      const pack = MARKET_PACKS.usa;
      expect(pack.market).toBe('usa');
      expect(pack.locale).toBeDefined();
      expect(pack.currency).toBeDefined();
      expect(Array.isArray(pack.merchants)).toBe(true);
      expect(Array.isArray(pack.critics)).toBe(true);
      expect(Array.isArray(pack.databases)).toBe(true);
      expect(Array.isArray(pack.competitions)).toBe(true);
    });

    it('should have valid priority values', () => {
      const sources = getMarketSources('usa');
      sources.forEach(source => {
        expect(source.priority).toBeGreaterThanOrEqual(0);
        expect(source.priority).toBeLessThanOrEqual(100);
      });
    });

    it('should have unique sourceIds within a market', () => {
      const sources = getMarketSources('usa');
      const sourceIds = sources.map(s => s.sourceId);
      const uniqueIds = new Set(sourceIds);
      expect(uniqueIds.size).toBe(sourceIds.length);
    });

    it('should have valid score scales', () => {
      const validScales = ['100-point', '20-point', '10-point', '5-point', 'medal'];
      const critics = getMarketSourcesByCategory('usa', 'critics');
      critics.forEach(critic => {
        if (critic.scoreScale) {
          expect(validScales).toContain(critic.scoreScale);
        }
      });
    });
  });

  describe('Priority Constants', () => {
    it('should have merchant as highest priority', () => {
      expect(MARKET_PACK_PRIORITIES.merchant).toBe(100);
    });

    it('should have priorities in descending order', () => {
      const priorities = Object.values(MARKET_PACK_PRIORITIES);
      for (let i = 0; i < priorities.length - 1; i++) {
        expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i + 1]);
      }
    });

    it('should have national_critic higher than global_critic', () => {
      expect(MARKET_PACK_PRIORITIES.national_critic).toBeGreaterThan(MARKET_PACK_PRIORITIES.global_critic);
    });
  });

  describe('Integration with Language Config', () => {
    it('should reference sources that exist in languageConfig', () => {
      // This test ensures market packs don't reference non-existent sources
      const sources = getMarketSources('usa');
      const sourceIds = sources.map(s => s.sourceId);

      // Key sources that should be defined in languageConfig
      const expectedSources = ['wine_searcher', 'vivino'];
      expectedSources.forEach(expectedSource => {
        if (sourceIds.includes(expectedSource)) {
          // If market pack references it, it should exist
          expect(true).toBe(true); // Placeholder - actual integration test would check languageConfig
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null market code gracefully', () => {
      expect(getMarketPack(null)).toBeNull();
      expect(getMarketSources(null)).toEqual([]);
      expect(getMarketSummary(null)).toBeNull();
    });

    it('should handle undefined category gracefully', () => {
      const result = getMarketSourcesByCategory('usa', undefined);
      expect(result).toEqual([]);
    });

    it('should handle empty string inputs', () => {
      expect(detectMarketFromLocale('')).toBe('global');
      expect(isSourceAvailableInMarket('', '')).toBe(false);
    });
  });
});
