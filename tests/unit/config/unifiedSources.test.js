/**
 * @fileoverview Unit tests for unified source configuration.
 * Tests source metadata, normalization functions, and helper utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  SOURCES,
  LENS,
  LENS_CREDIBILITY,
  LENS_ORDER,
  LENS_DISPLAY_MAP,
  getSource,
  getSourcesByLens,
  getSourcesByDisplayLens,
  getSourcesForCountry,
  getDomainsForCountry,
  normaliseScore,
  getScoreFormatsForSources,
  buildScoreFormatPrompt,
  REGION_SOURCE_PRIORITY
} from '../../../src/config/unifiedSources.js';

describe('LENS constants', () => {
  it('should define all lens types', () => {
    expect(LENS.COMPETITION).toBe('competition');
    expect(LENS.PANEL_GUIDE).toBe('panel_guide');
    expect(LENS.CRITIC).toBe('critic');
    expect(LENS.COMMUNITY).toBe('community');
    expect(LENS.AGGREGATOR).toBe('aggregator');
    expect(LENS.PRODUCER).toBe('producer');
  });

  it('should have credibility weights for all lenses', () => {
    expect(LENS_CREDIBILITY[LENS.COMPETITION]).toBe(3.0);
    expect(LENS_CREDIBILITY[LENS.PANEL_GUIDE]).toBe(2.5);
    expect(LENS_CREDIBILITY[LENS.CRITIC]).toBe(1.5);
    expect(LENS_CREDIBILITY[LENS.COMMUNITY]).toBe(1.0);
    expect(LENS_CREDIBILITY[LENS.AGGREGATOR]).toBe(0.85);
    expect(LENS_CREDIBILITY[LENS.PRODUCER]).toBe(1.2);
  });

  it('should have correct lens order', () => {
    expect(LENS_ORDER).toEqual([
      'competition',
      'panel_guide',
      'critic',
      'community',
      'aggregator',
      'producer'
    ]);
  });

  it('should map lenses to display categories', () => {
    expect(LENS_DISPLAY_MAP[LENS.COMPETITION]).toBe('competition');
    expect(LENS_DISPLAY_MAP[LENS.PANEL_GUIDE]).toBe('critics');
    expect(LENS_DISPLAY_MAP[LENS.CRITIC]).toBe('critics');
    expect(LENS_DISPLAY_MAP[LENS.COMMUNITY]).toBe('community');
  });
});

describe('SOURCES configuration', () => {
  it('should have required fields for each source', () => {
    for (const [id, source] of Object.entries(SOURCES)) {
      expect(source.name, `${id} missing name`).toBeDefined();
      expect(source.short_name, `${id} missing short_name`).toBeDefined();
      expect(source.lens, `${id} missing lens`).toBeDefined();
      expect(source.credibility, `${id} missing credibility`).toBeGreaterThan(0);
      expect(source.scope, `${id} missing scope`).toBeDefined();
      expect(source.home_regions, `${id} missing home_regions`).toBeDefined();
      expect(source.score_type, `${id} missing score_type`).toBeDefined();
    }
  });

  it('should have valid lens values', () => {
    const validLenses = Object.values(LENS);
    for (const [id, source] of Object.entries(SOURCES)) {
      expect(validLenses, `${id} has invalid lens: ${source.lens}`).toContain(source.lens);
    }
  });

  it('should have valid scope values', () => {
    const validScopes = ['global', 'national', 'regional', 'varietal'];
    for (const [id, source] of Object.entries(SOURCES)) {
      expect(validScopes, `${id} has invalid scope: ${source.scope}`).toContain(source.scope);
    }
  });

  it('should have credibility between 0 and 1', () => {
    for (const [id, source] of Object.entries(SOURCES)) {
      expect(source.credibility, `${id} credibility out of range`).toBeGreaterThan(0);
      expect(source.credibility, `${id} credibility out of range`).toBeLessThanOrEqual(1);
    }
  });

  it('should have domains for non-producer sources', () => {
    for (const [id, source] of Object.entries(SOURCES)) {
      if (id !== 'producer_website') {
        expect(source.domain, `${id} missing domain`).toBeDefined();
      }
    }
  });
});

describe('getSource', () => {
  it('should return source config by ID', () => {
    const decanter = getSource('decanter');
    expect(decanter.name).toBe('Decanter World Wine Awards');
    expect(decanter.lens).toBe(LENS.COMPETITION);
  });

  it('should return null for unknown source', () => {
    expect(getSource('unknown_source')).toBeNull();
  });
});

describe('getSourcesByLens', () => {
  it('should return all competition sources', () => {
    const competitions = getSourcesByLens(LENS.COMPETITION);
    expect(competitions.length).toBeGreaterThan(0);
    competitions.forEach(source => {
      expect(source.lens).toBe(LENS.COMPETITION);
    });
  });

  it('should return all critic sources', () => {
    const critics = getSourcesByLens(LENS.CRITIC);
    expect(critics.length).toBeGreaterThan(0);
    critics.forEach(source => {
      expect(source.lens).toBe(LENS.CRITIC);
    });
  });

  it('should include source IDs', () => {
    const sources = getSourcesByLens(LENS.COMPETITION);
    expect(sources[0].id).toBeDefined();
    expect(sources[0].id).toBe('decanter');
  });
});

describe('getSourcesByDisplayLens', () => {
  it('should combine panel_guide and critic into critics', () => {
    const critics = getSourcesByDisplayLens('critics');
    const hasPanel = critics.some(s => s.lens === LENS.PANEL_GUIDE);
    const hasCritic = critics.some(s => s.lens === LENS.CRITIC);
    expect(hasPanel).toBe(true);
    expect(hasCritic).toBe(true);
  });

  it('should return competition sources for competition display', () => {
    const competitions = getSourcesByDisplayLens('competition');
    competitions.forEach(source => {
      expect([LENS.COMPETITION, LENS.PRODUCER]).toContain(source.lens);
    });
  });
});

describe('getSourcesForCountry', () => {
  it('should return global sources for unknown country', () => {
    const sources = getSourcesForCountry('');
    expect(sources.length).toBeGreaterThan(0);
    // Global sources should have high relevance
    const globalSource = sources.find(s => s.id === 'decanter');
    expect(globalSource.relevance).toBe(1.0);
  });

  it('should prioritize regional sources for matching country', () => {
    const sources = getSourcesForCountry('South Africa');
    const platters = sources.find(s => s.id === 'platters');
    const halliday = sources.find(s => s.id === 'halliday');
    expect(platters.relevance).toBe(1.0);
    expect(halliday.relevance).toBe(0.1); // Australian source for SA wine
  });

  it('should sort by combined score', () => {
    const sources = getSourcesForCountry('Italy');
    // Global competitions have highest lens credibility (3.0)
    // Italian panel guides have lens credibility 2.5 but full regional relevance
    // Gambero Rosso should be in top 10 with full relevance
    const topIds = sources.slice(0, 10).map(s => s.id);
    expect(topIds).toContain('gambero_rosso');
    // Italian source should have full relevance
    const gambero = sources.find(s => s.id === 'gambero_rosso');
    expect(gambero.relevance).toBe(1.0);
  });

  it('should include regional sources at medium relevance for unknown country', () => {
    const sources = getSourcesForCountry(null);
    const platters = sources.find(s => s.id === 'platters');
    expect(platters.relevance).toBe(0.5);
  });
});

describe('getDomainsForCountry', () => {
  it('should return array of domains', () => {
    const domains = getDomainsForCountry('France');
    expect(Array.isArray(domains)).toBe(true);
    expect(domains.length).toBeGreaterThan(0);
  });

  it('should include regional domains for matching country', () => {
    const domains = getDomainsForCountry('France');
    expect(domains).toContain('larvf.com');
    expect(domains).toContain('mybettanedesseauve.fr');
  });

  it('should include global domains', () => {
    const domains = getDomainsForCountry('France');
    expect(domains).toContain('decanter.com');
  });

  it('should include alt_domains', () => {
    const domains = getDomainsForCountry('South Africa');
    expect(domains).toContain('wineonaplatter.com');
    expect(domains).toContain('platterwineguide.com');
  });
});

describe('normaliseScore', () => {
  describe('100-point scales', () => {
    it('should normalize Wine Advocate scores', () => {
      expect(normaliseScore('wine_advocate', '92')).toBe(92);
      expect(normaliseScore('wine_advocate', '95+')).toBe(95);
      expect(normaliseScore('wine_advocate', '88-90')).toBe(88);
    });

    it('should normalize James Suckling scores', () => {
      expect(normaliseScore('james_suckling', '94')).toBe(94);
      expect(normaliseScore('james_suckling', '91 points')).toBe(91);
    });

    it('should normalize Halliday scores', () => {
      expect(normaliseScore('halliday', '95')).toBe(95);
      expect(normaliseScore('halliday', '92 points')).toBe(92);
    });
  });

  describe('20-point scales', () => {
    it('should normalize Jancis Robinson scores', () => {
      expect(normaliseScore('jancis_robinson', '17/20')).toBe(85);
      expect(normaliseScore('jancis_robinson', '16.5')).toBe(83);
      expect(normaliseScore('jancis_robinson', '18.5/20')).toBe(93);
    });

    it('should normalize RVF scores', () => {
      expect(normaliseScore('rvf', '17/20')).toBe(85);
      expect(normaliseScore('rvf', '16')).toBe(80);
    });

    it('should normalize Vinum scores', () => {
      expect(normaliseScore('vinum', '18/20')).toBe(90);
      expect(normaliseScore('vinum', '17')).toBe(85);
    });
  });

  describe('star ratings', () => {
    it('should normalize Platter star ratings', () => {
      expect(normaliseScore('platters', '5 stars')).toBe(100);
      expect(normaliseScore('platters', '4.5 stars')).toBe(90);
      expect(normaliseScore('platters', '4 stars')).toBe(80);
    });

    it('should normalize Vivino ratings', () => {
      expect(normaliseScore('vivino', '4.2')).toBe(84);
      expect(normaliseScore('vivino', '3.8')).toBe(76);
      expect(normaliseScore('vivino', '4.5 stars')).toBe(90);
    });
  });

  describe('medal awards', () => {
    it('should normalize DWWA medals', () => {
      expect(normaliseScore('decanter', 'Best in Show')).toBe(99);
      expect(normaliseScore('decanter', 'Platinum')).toBe(97);
      expect(normaliseScore('decanter', 'Gold')).toBe(94);
      expect(normaliseScore('decanter', 'Silver')).toBe(88);
      expect(normaliseScore('decanter', 'Bronze')).toBe(82);
    });

    it('should normalize IWC medals', () => {
      expect(normaliseScore('iwc', 'Trophy')).toBe(98);
      expect(normaliseScore('iwc', 'Gold')).toBe(94);
      expect(normaliseScore('iwc', 'Silver')).toBe(88);
    });

    it('should normalize IWSC medals', () => {
      expect(normaliseScore('iwsc', 'Gold Outstanding')).toBe(96);
      expect(normaliseScore('iwsc', 'Gold')).toBe(94);
      expect(normaliseScore('iwsc', 'Silver Outstanding')).toBe(90);
    });

    it('should normalize Veritas medals', () => {
      expect(normaliseScore('veritas', 'Double Gold')).toBe(96);
      expect(normaliseScore('veritas', 'Gold')).toBe(92);
      expect(normaliseScore('veritas', 'Silver')).toBe(86);
    });
  });

  describe('symbol-based ratings', () => {
    it('should normalize Gambero Rosso bicchieri', () => {
      expect(normaliseScore('gambero_rosso', 'Tre Bicchieri')).toBe(95);
      expect(normaliseScore('gambero_rosso', 'Due Bicchieri Rossi')).toBe(90);
      expect(normaliseScore('gambero_rosso', 'Due Bicchieri')).toBe(87);
      expect(normaliseScore('gambero_rosso', 'Un Bicchiere')).toBe(80);
    });

    it('should normalize Bibenda grappoli', () => {
      expect(normaliseScore('bibenda', '5 grappoli')).toBe(95);
      expect(normaliseScore('bibenda', 'cinque grappoli')).toBe(95);
      expect(normaliseScore('bibenda', '4 grappoli')).toBe(90);
      expect(normaliseScore('bibenda', 'quattro grappoli')).toBe(90);
    });

    it('should normalize Guide Hachette stars', () => {
      expect(normaliseScore('guide_hachette', 'Coup de Cœur')).toBe(96);
      expect(normaliseScore('guide_hachette', '★★★')).toBe(94);
      expect(normaliseScore('guide_hachette', '★★')).toBe(88);
      expect(normaliseScore('guide_hachette', '3 étoiles')).toBe(94);
    });
  });

  describe('fallback behavior', () => {
    it('should use fallback parser for unknown source', () => {
      expect(normaliseScore('unknown_source', '92')).toBe(92);
      expect(normaliseScore('unknown_source', '87.5')).toBe(88);
    });

    it('should return null for unparseable scores', () => {
      expect(normaliseScore('wine_advocate', 'excellent')).toBeNull();
    });
  });
});

describe('getScoreFormatsForSources', () => {
  it('should return format info for valid sources', () => {
    const formats = getScoreFormatsForSources(['wine_advocate', 'jancis_robinson']);
    expect(formats.length).toBe(2);
    expect(formats[0].name).toBe('Wine Advocate / Robert Parker');
    expect(formats[1].name).toBe('Jancis Robinson');
  });

  it('should include examples', () => {
    const formats = getScoreFormatsForSources(['gambero_rosso']);
    expect(formats[0].examples).toContain('Tre Bicchieri');
  });

  it('should filter out unknown sources', () => {
    const formats = getScoreFormatsForSources(['wine_advocate', 'unknown', 'jancis_robinson']);
    expect(formats.length).toBe(2);
  });
});

describe('buildScoreFormatPrompt', () => {
  it('should build prompt string for sources', () => {
    const prompt = buildScoreFormatPrompt(['wine_advocate', 'jancis_robinson']);
    expect(prompt).toContain('Wine Advocate');
    expect(prompt).toContain('Jancis Robinson');
    expect(prompt).toContain('Score formats to recognise');
  });

  it('should return empty string for empty input', () => {
    expect(buildScoreFormatPrompt([])).toBe('');
  });

  it('should return empty string for unknown sources', () => {
    expect(buildScoreFormatPrompt(['unknown1', 'unknown2'])).toBe('');
  });
});

describe('REGION_SOURCE_PRIORITY', () => {
  it('should have priority lists for major wine regions', () => {
    expect(REGION_SOURCE_PRIORITY['France']).toBeDefined();
    expect(REGION_SOURCE_PRIORITY['Italy']).toBeDefined();
    expect(REGION_SOURCE_PRIORITY['South Africa']).toBeDefined();
    expect(REGION_SOURCE_PRIORITY['Australia']).toBeDefined();
  });

  it('should have default fallback', () => {
    expect(REGION_SOURCE_PRIORITY['_default']).toBeDefined();
    expect(REGION_SOURCE_PRIORITY['_default'].length).toBeGreaterThan(0);
  });

  it('should have premium sources list', () => {
    expect(REGION_SOURCE_PRIORITY['_premium']).toBeDefined();
    expect(REGION_SOURCE_PRIORITY['_premium']).toContain('wine_advocate');
    expect(REGION_SOURCE_PRIORITY['_premium']).toContain('jancis_robinson');
  });

  it('should reference valid source IDs', () => {
    for (const [region, sources] of Object.entries(REGION_SOURCE_PRIORITY)) {
      for (const sourceId of sources) {
        expect(SOURCES[sourceId], `Invalid source ${sourceId} in ${region}`).toBeDefined();
      }
    }
  });
});
