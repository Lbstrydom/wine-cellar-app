/**
 * @fileoverview Tests for grape-colour map configuration.
 * Uses vitest globals (do NOT import from 'vitest').
 */

import {
  getExpectedColours,
  getCanonicalGrape,
  getGrapeCount,
  findException,
  KNOWN_EXCEPTIONS,
} from '../../../src/config/grapeColourMap.js';

describe('grapeColourMap', () => {
  describe('getExpectedColours', () => {
    it('returns red for shiraz (synonym → syrah)', () => {
      const colours = getExpectedColours('shiraz');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('red')).toBe(true);
    });

    it('returns red for syrah (canonical)', () => {
      const colours = getExpectedColours('syrah');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('red')).toBe(true);
    });

    it('returns white for chardonnay', () => {
      const colours = getExpectedColours('chardonnay');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('white')).toBe(true);
    });

    it('returns white for sauvignon blanc', () => {
      const colours = getExpectedColours('sauvignon blanc');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('white')).toBe(true);
    });

    it('returns red for cabernet sauvignon', () => {
      const colours = getExpectedColours('cabernet sauvignon');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('red')).toBe(true);
    });

    it('includes curiosity grapes: saperavi → red', () => {
      const colours = getExpectedColours('saperavi');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('red')).toBe(true);
    });

    it('includes curiosity grapes: furmint → white', () => {
      const colours = getExpectedColours('furmint');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('white')).toBe(true);
    });

    it('resolves synonyms: Garnacha → grenache → includes red', () => {
      const colours = getExpectedColours('Garnacha');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('red')).toBe(true);
    });

    it('resolves synonyms: Pinot Grigio → pinot gris → includes white', () => {
      const colours = getExpectedColours('Pinot Grigio');
      expect(colours).toBeInstanceOf(Set);
      expect(colours.has('white')).toBe(true);
    });

    it('is case-insensitive', () => {
      const upper = getExpectedColours('CHARDONNAY');
      const lower = getExpectedColours('chardonnay');
      const mixed = getExpectedColours('Chardonnay');
      expect(upper).toEqual(lower);
      expect(upper).toEqual(mixed);
    });

    it('returns null for unknown grape', () => {
      expect(getExpectedColours('unicorn grape')).toBeNull();
    });

    it('returns null for null/undefined/empty', () => {
      expect(getExpectedColours(null)).toBeNull();
      expect(getExpectedColours(undefined)).toBeNull();
      expect(getExpectedColours('')).toBeNull();
    });
  });

  describe('getCanonicalGrape', () => {
    it('resolves Shiraz → syrah', () => {
      expect(getCanonicalGrape('Shiraz')).toBe('syrah');
    });

    it('resolves Pinot Grigio → pinot gris', () => {
      expect(getCanonicalGrape('Pinot Grigio')).toBe('pinot gris');
    });

    it('resolves Garnacha → grenache', () => {
      expect(getCanonicalGrape('Garnacha')).toBe('grenache');
    });

    it('resolves Tinta Roriz → tempranillo', () => {
      expect(getCanonicalGrape('Tinta Roriz')).toBe('tempranillo');
    });

    it('resolves Primitivo → zinfandel', () => {
      expect(getCanonicalGrape('Primitivo')).toBe('zinfandel');
    });

    it('lowercases and strips diacritics for unknown grapes', () => {
      expect(getCanonicalGrape('Gewürztraminer')).toBe('gewurztraminer');
    });

    it('returns null for null/empty', () => {
      expect(getCanonicalGrape(null)).toBeNull();
      expect(getCanonicalGrape('')).toBeNull();
    });
  });

  describe('getGrapeCount', () => {
    it('returns 40+ entries', () => {
      expect(getGrapeCount()).toBeGreaterThanOrEqual(40);
    });
  });

  describe('findException', () => {
    it('matches Blanc de Noirs', () => {
      const result = findException('Blanc de Noirs Brut 2019');
      expect(result).not.toBeNull();
      expect(result.description).toContain('Blanc de Noirs');
    });

    it('matches orange wine', () => {
      const result = findException('Orange Wine Skin Contact');
      expect(result).not.toBeNull();
    });

    it('matches skin contact', () => {
      const result = findException('Ramato Skin Contact Pinot Grigio');
      expect(result).not.toBeNull();
    });

    it('matches vin gris', () => {
      const result = findException('Vin Gris de Cigare');
      expect(result).not.toBeNull();
    });

    it('matches ramato', () => {
      const result = findException('Ramato Pinot Grigio');
      expect(result).not.toBeNull();
    });

    it('checks style as well as wine name', () => {
      const result = findException('Some Wine', 'skin contact');
      expect(result).not.toBeNull();
    });

    it('returns null for standard wine names', () => {
      expect(findException('Kanonkop Pinotage 2019')).toBeNull();
      expect(findException('Cloudy Bay Sauvignon Blanc 2022')).toBeNull();
    });

    it('returns null for null/empty', () => {
      expect(findException(null)).toBeNull();
      expect(findException('')).toBeNull();
    });
  });

  describe('module privacy', () => {
    it('does not export raw Map — only getter functions', () => {
      expect(typeof getExpectedColours).toBe('function');
      expect(typeof getCanonicalGrape).toBe('function');
      expect(typeof getGrapeCount).toBe('function');
      expect(typeof findException).toBe('function');
    });

    it('KNOWN_EXCEPTIONS is an array of objects with pattern and description', () => {
      expect(Array.isArray(KNOWN_EXCEPTIONS)).toBe(true);
      for (const ex of KNOWN_EXCEPTIONS) {
        expect(ex.pattern).toBeInstanceOf(RegExp);
        expect(typeof ex.description).toBe('string');
      }
    });
  });
});
