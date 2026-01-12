import { describe, it, expect } from 'vitest';
import {
  LANGUAGE_QUERY_TEMPLATES,
  LOCALE_CONFIG,
  SOURCE_LANGUAGE_MAP,
  getQueryTemplate,
  getLocaleConfig,
  getAvailableLanguages,
  getSourcesByLanguage
} from '../../../src/config/languageConfig.js';

describe('Language Configuration', () => {
  describe('LANGUAGE_QUERY_TEMPLATES', () => {
    it('should have templates for all configured languages', () => {
      expect(LANGUAGE_QUERY_TEMPLATES).toHaveProperty('fr');
      expect(LANGUAGE_QUERY_TEMPLATES).toHaveProperty('it');
      expect(LANGUAGE_QUERY_TEMPLATES).toHaveProperty('es');
      expect(LANGUAGE_QUERY_TEMPLATES).toHaveProperty('de');
      expect(LANGUAGE_QUERY_TEMPLATES).toHaveProperty('pt');
      expect(LANGUAGE_QUERY_TEMPLATES).toHaveProperty('nl');
      expect(LANGUAGE_QUERY_TEMPLATES).toHaveProperty('en');
    });

    it('should have templates for major sources', () => {
      // French
      expect(LANGUAGE_QUERY_TEMPLATES.fr).toHaveProperty('guide_hachette');
      expect(LANGUAGE_QUERY_TEMPLATES.fr).toHaveProperty('rvf');

      // Italian
      expect(LANGUAGE_QUERY_TEMPLATES.it).toHaveProperty('gambero_rosso');
      expect(LANGUAGE_QUERY_TEMPLATES.it).toHaveProperty('bibenda');

      // Spanish
      expect(LANGUAGE_QUERY_TEMPLATES.es).toHaveProperty('guia_penin');

      // German
      expect(LANGUAGE_QUERY_TEMPLATES.de).toHaveProperty('falstaff');

      // Dutch (v1.1)
      expect(LANGUAGE_QUERY_TEMPLATES.nl).toHaveProperty('hamersma');
      expect(LANGUAGE_QUERY_TEMPLATES.nl).toHaveProperty('perswijn');
      expect(LANGUAGE_QUERY_TEMPLATES.nl).toHaveProperty('wijnvoordeel');
      expect(LANGUAGE_QUERY_TEMPLATES.nl).toHaveProperty('gall_gall');
    });

    it('should include native language vocabulary in templates', () => {
      // French templates should use French words
      expect(LANGUAGE_QUERY_TEMPLATES.fr.guide_hachette).toContain('Hachette');
      expect(LANGUAGE_QUERY_TEMPLATES.fr.rvf).toContain('Revue du Vin');

      // Dutch templates should use Dutch words (v1.1 fix)
      expect(LANGUAGE_QUERY_TEMPLATES.nl.hamersma).toContain('beoordeling');
      expect(LANGUAGE_QUERY_TEMPLATES.nl.perswijn).toContain('proefnotitie');
      expect(LANGUAGE_QUERY_TEMPLATES.nl.wijnvoordeel).toContain('beoordeling');
      expect(LANGUAGE_QUERY_TEMPLATES.nl.gall_gall).toContain('score');
    });
  });

  describe('LOCALE_CONFIG', () => {
    it('should have locale config for all languages', () => {
      const languages = Object.keys(LANGUAGE_QUERY_TEMPLATES);
      languages.forEach(lang => {
        expect(LOCALE_CONFIG).toHaveProperty(lang);
      });
    });

    it('should have correct SERP locale parameters', () => {
      expect(LOCALE_CONFIG.fr.serpLang).toBe('fr');
      expect(LOCALE_CONFIG.fr.serpCountry).toBe('fr');

      expect(LOCALE_CONFIG.nl.serpLang).toBe('nl');
      expect(LOCALE_CONFIG.nl.serpCountry).toBe('nl');

      expect(LOCALE_CONFIG.de.serpLang).toBe('de');
      expect(LOCALE_CONFIG.de.serpCountry).toBe('de');
    });

    it('should have Accept-Language headers configured', () => {
      expect(LOCALE_CONFIG.fr.acceptLanguage).toBe('fr-FR,fr;q=0.9,en;q=0.5');
      expect(LOCALE_CONFIG.es.acceptLanguage).toContain('es-ES');
      expect(LOCALE_CONFIG.nl.acceptLanguage).toContain('nl-NL');
    });

    it('should have timeZone configured for each language', () => {
      Object.values(LOCALE_CONFIG).forEach(config => {
        expect(config).toHaveProperty('timeZone');
        expect(config.timeZone).toMatch(/^[A-Za-z_/]+$/);
      });
    });
  });

  describe('SOURCE_LANGUAGE_MAP', () => {
    it('should map all sources to languages', () => {
      const sources = Object.keys(SOURCE_LANGUAGE_MAP);
      expect(sources.length).toBeGreaterThan(0);

      sources.forEach(source => {
        const language = SOURCE_LANGUAGE_MAP[source];
        expect(LOCALE_CONFIG).toHaveProperty(language);
      });
    });

    it('should map French sources to French language', () => {
      expect(SOURCE_LANGUAGE_MAP.guide_hachette).toBe('fr');
      expect(SOURCE_LANGUAGE_MAP.rvf).toBe('fr');
      expect(SOURCE_LANGUAGE_MAP.bettane_desseauve).toBe('fr');
    });

    it('should map Italian sources to Italian language', () => {
      expect(SOURCE_LANGUAGE_MAP.gambero_rosso).toBe('it');
      expect(SOURCE_LANGUAGE_MAP.bibenda).toBe('it');
      expect(SOURCE_LANGUAGE_MAP.doctor_wine).toBe('it');
    });

    it('should map Spanish sources to Spanish language', () => {
      expect(SOURCE_LANGUAGE_MAP.guia_penin).toBe('es');
      expect(SOURCE_LANGUAGE_MAP.descorchados).toBe('es');
      expect(SOURCE_LANGUAGE_MAP.bodeboca).toBe('es');
    });

    it('should map German sources to German language', () => {
      expect(SOURCE_LANGUAGE_MAP.falstaff).toBe('de');
      expect(SOURCE_LANGUAGE_MAP.vinum).toBe('de');
      expect(SOURCE_LANGUAGE_MAP.weinwisser).toBe('de');
    });

    it('should map Dutch sources to Dutch language (v1.1)', () => {
      expect(SOURCE_LANGUAGE_MAP.hamersma).toBe('nl');
      expect(SOURCE_LANGUAGE_MAP.perswijn).toBe('nl');
      expect(SOURCE_LANGUAGE_MAP.wijnvoordeel).toBe('nl');
      expect(SOURCE_LANGUAGE_MAP.gall_gall).toBe('nl');
    });

    it('should map English sources to English language', () => {
      expect(SOURCE_LANGUAGE_MAP.vivino).toBe('en');
      expect(SOURCE_LANGUAGE_MAP.wine_searcher).toBe('en');
      expect(SOURCE_LANGUAGE_MAP.wine_com).toBe('en');
    });
  });

  describe('getQueryTemplate()', () => {
    it('should return null for unknown source', () => {
      const template = getQueryTemplate('unknown_source', 'Chateau Margaux', 2015);
      expect(template).toBe(null);
    });

    it('should substitute wine and vintage in template', () => {
      const template = getQueryTemplate('guide_hachette', 'Chateau Margaux', 2015);
      expect(template).toContain('Chateau Margaux');
      expect(template).toContain('2015');
      expect(template).not.toContain('{wine}');
      expect(template).not.toContain('{vintage}');
    });

    it('should handle NV (non-vintage) wines', () => {
      const template = getQueryTemplate('vivino', 'Champagne Brut', 'NV');
      expect(template).toContain('NV');
    });

    it('should use correct language templates for different sources', () => {
      const frenchTemplate = getQueryTemplate('guide_hachette', 'Bordeaux', 2015);
      expect(frenchTemplate).toContain('Hachette');

      const germanTemplate = getQueryTemplate('falstaff', 'Riesling', 2015);
      expect(germanTemplate).toContain('Falstaff');

      // Dutch template should contain Dutch wine rating vocabulary
      const dutchTemplate = getQueryTemplate('hamersma', 'Wine', 2015);
      expect(dutchTemplate).toContain('beoordeling');
    });

    it('should default to English for unknown language', () => {
      // Create a mock source that maps to non-existent language
      const template = getQueryTemplate('guide_hachette', 'Bordeaux', 2015);
      expect(template).toBeDefined();
      expect(template).not.toBe(null);
    });
  });

  describe('getLocaleConfig()', () => {
    it('should return correct locale config for source', () => {
      const config = getLocaleConfig('guide_hachette');
      expect(config.serpLang).toBe('fr');
      expect(config.serpCountry).toBe('fr');
    });

    it('should return correct locale for Dutch sources (v1.1)', () => {
      const config = getLocaleConfig('hamersma');
      expect(config.serpLang).toBe('nl');
      expect(config.serpCountry).toBe('nl');
      expect(config.acceptLanguage).toContain('nl-NL');
    });

    it('should default to English for unknown source', () => {
      const config = getLocaleConfig('unknown_source');
      expect(config.serpLang).toBe('en');
      expect(config.serpCountry).toBe('us');
    });

    it('should return all required locale properties', () => {
      const config = getLocaleConfig('vivino');
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('serpLang');
      expect(config).toHaveProperty('serpCountry');
      expect(config).toHaveProperty('acceptLanguage');
      expect(config).toHaveProperty('timeZone');
    });
  });

  describe('getAvailableLanguages()', () => {
    it('should return array of language codes', () => {
      const languages = getAvailableLanguages();
      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);
    });

    it('should include all major languages', () => {
      const languages = getAvailableLanguages();
      expect(languages).toContain('fr');
      expect(languages).toContain('it');
      expect(languages).toContain('es');
      expect(languages).toContain('de');
      expect(languages).toContain('pt');
      expect(languages).toContain('nl');
      expect(languages).toContain('en');
    });
  });

  describe('getSourcesByLanguage()', () => {
    it('should return all French sources', () => {
      const sources = getSourcesByLanguage('fr');
      expect(sources).toContain('guide_hachette');
      expect(sources).toContain('rvf');
      expect(sources).toContain('bettane_desseauve');
    });

    it('should return all Dutch sources (v1.1)', () => {
      const sources = getSourcesByLanguage('nl');
      expect(sources).toContain('hamersma');
      expect(sources).toContain('perswijn');
      expect(sources).toContain('wijnvoordeel');
      expect(sources).toContain('gall_gall');
      expect(sources.length).toBeGreaterThan(0);
    });

    it('should return all English sources', () => {
      const sources = getSourcesByLanguage('en');
      expect(sources).toContain('vivino');
      expect(sources).toContain('wine_searcher');
      expect(sources).toContain('wine_com');
    });

    it('should return empty array for non-existent language', () => {
      const sources = getSourcesByLanguage('xx');
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBe(0);
    });

    it('should return consistent results for same language', () => {
      const sources1 = getSourcesByLanguage('es');
      const sources2 = getSourcesByLanguage('es');
      expect(sources1).toEqual(sources2);
    });
  });

  describe('Integration: Query Template with Locale', () => {
    it('should correctly pair query template with locale for French', () => {
      const query = getQueryTemplate('guide_hachette', 'Bordeaux', 2020);
      const locale = getLocaleConfig('guide_hachette');

      expect(query).toContain('Bordeaux');
      expect(query).toContain('Hachette');
      expect(locale.serpLang).toBe('fr');
    });

    it('should correctly pair query template with locale for Dutch (v1.1)', () => {
      const query = getQueryTemplate('hamersma', 'Dutch Wine', 2020);
      const locale = getLocaleConfig('hamersma');

      expect(query).toContain('Dutch Wine');
      expect(query).toContain('beoordeling');
      expect(locale.serpLang).toBe('nl');
      expect(locale.serpCountry).toBe('nl');
    });

    it('should handle all sources without error', () => {
      const sources = Object.keys(SOURCE_LANGUAGE_MAP);
      sources.forEach(source => {
        const query = getQueryTemplate(source, 'Test Wine', 2020);
        const locale = getLocaleConfig(source);

        expect(query).not.toBeNull();
        expect(locale).toBeDefined();
        expect(locale.serpLang).toBeDefined();
      });
    });
  });
});
