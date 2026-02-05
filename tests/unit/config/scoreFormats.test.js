/**
 * @fileoverview Unit tests for score format definitions.
 * Tests score normalization for various rating sources.
 */

import { normaliseScore, getScoreFormatsForSources, buildScoreFormatPrompt } from '../../../src/config/unifiedSources.js';

describe('scoreFormats', () => {
  describe('100-point scale sources', () => {
    const hundredPointSources = ['wine_advocate', 'wine_spectator', 'vinous', 'james_suckling', 'wine_enthusiast', 'decanter_magazine'];

    hundredPointSources.forEach(source => {
      it(`should normalise ${source} scores correctly`, () => {
        const format = getScoreFormatsForSources([source])[0];
        expect(format).toBeDefined();
        expect(format.scale).toBe(100);
        expect(normaliseScore(source, '92')).toBe(92);
        expect(normaliseScore(source, '95')).toBe(95);
      });
    });

    it('should handle Wine Spectator range scores', () => {
      const result = normaliseScore('wine_spectator', '88-90');
      expect(result).toBe(88); // Takes first number
    });

    it('should handle plus notation (95+)', () => {
      const result = normaliseScore('vinous', '91+');
      expect(result).toBe(91);
    });
  });

  describe('20-point scale sources', () => {
    it('should convert Jancis Robinson 20-point scores', () => {
      const format = getScoreFormatsForSources(['jancis_robinson'])[0];
      expect(format.scale).toBe(20);
      expect(normaliseScore('jancis_robinson', '17/20')).toBe(85);
      expect(normaliseScore('jancis_robinson', '18.5')).toBe(93);
      expect(normaliseScore('jancis_robinson', '16')).toBe(80);
    });

    it('should convert RVF 20-point scores', () => {
      const format = getScoreFormatsForSources(['rvf'])[0];
      expect(format.scale).toBe(20);
      expect(normaliseScore('rvf', '17/20')).toBe(85);
      expect(normaliseScore('rvf', '18')).toBe(90);
    });

    it('should convert Bettane+Desseauve 20-point scores', () => {
      const format = getScoreFormatsForSources(['bettane_desseauve'])[0];
      expect(format.scale).toBe(20);
      expect(normaliseScore('bettane_desseauve', '16/20')).toBe(80);
      expect(normaliseScore('bettane_desseauve', '17.5')).toBe(88);
    });

    it('should convert Vinum 20-point scores', () => {
      const format = getScoreFormatsForSources(['vinum'])[0];
      expect(format.scale).toBe(20);
      expect(normaliseScore('vinum', '17/20')).toBe(85);
      expect(normaliseScore('vinum', '19')).toBe(95);
    });
  });

  describe('Italian guides - symbol-based', () => {
    describe('Gambero Rosso', () => {
      it('should normalise Tre Bicchieri', () => {
        expect(normaliseScore('gambero_rosso', 'Tre Bicchieri')).toBe(95);
      });

      it('should normalise Due Bicchieri Rossi', () => {
        expect(normaliseScore('gambero_rosso', 'Due Bicchieri Rossi')).toBe(90);
      });

      it('should normalise Due Bicchieri', () => {
        expect(normaliseScore('gambero_rosso', 'Due Bicchieri')).toBe(87);
      });

      it('should normalise Un Bicchiere', () => {
        expect(normaliseScore('gambero_rosso', 'Un Bicchiere')).toBe(80);
      });

      it('should handle numeric format (3 bicchieri)', () => {
        expect(normaliseScore('gambero_rosso', '3 bicchieri')).toBe(95);
        expect(normaliseScore('gambero_rosso', '2 bicchieri')).toBe(87);
      });

      it('should return null for unrecognized symbols', () => {
        expect(normaliseScore('gambero_rosso', 'Zero Bicchieri')).toBeNull();
      });
    });

    describe('Bibenda', () => {
      it('should normalise 5 grappoli', () => {
        expect(normaliseScore('bibenda', '5 grappoli')).toBe(95);
        expect(normaliseScore('bibenda', 'cinque grappoli')).toBe(95);
      });

      it('should normalise 4 grappoli', () => {
        expect(normaliseScore('bibenda', '4 grappoli')).toBe(90);
        expect(normaliseScore('bibenda', 'quattro grappoli')).toBe(90);
      });

      it('should normalise 3 grappoli', () => {
        expect(normaliseScore('bibenda', '3 grappoli')).toBe(85);
        expect(normaliseScore('bibenda', 'tre grappoli')).toBe(85);
      });

      it('should normalise 2 grappoli', () => {
        expect(normaliseScore('bibenda', '2 grappoli')).toBe(80);
        expect(normaliseScore('bibenda', 'due grappoli')).toBe(80);
      });
    });
  });

  describe('French guides - symbol-based', () => {
    describe('Guide Hachette', () => {
      it('should normalise Coup de Coeur', () => {
        expect(normaliseScore('guide_hachette', 'Coup de Coeur')).toBe(96);
        expect(normaliseScore('guide_hachette', 'Coup de Cœur')).toBe(96);
      });

      it('should normalise star symbols', () => {
        expect(normaliseScore('guide_hachette', '★★★')).toBe(94);
        expect(normaliseScore('guide_hachette', '★★')).toBe(88);
        expect(normaliseScore('guide_hachette', '★')).toBe(82);
      });

      it('should normalise text star notation', () => {
        expect(normaliseScore('guide_hachette', '3 étoiles')).toBe(94);
        expect(normaliseScore('guide_hachette', '2 étoiles')).toBe(88);
        expect(normaliseScore('guide_hachette', '1 étoile')).toBe(82);
      });
    });
  });

  describe('South African - stars', () => {
    describe("Platter's", () => {
      it('should normalise 5 stars', () => {
        expect(normaliseScore('platters', '5 stars')).toBe(100);
        expect(normaliseScore('platters', '★★★★★')).toBe(100);
      });

      it('should normalise 4.5 stars', () => {
        expect(normaliseScore('platters', '4.5 stars')).toBe(90);
        expect(normaliseScore('platters', '★★★★½')).toBe(90);
        expect(normaliseScore('platters', '4½')).toBe(90);
      });

      it('should normalise 4 stars', () => {
        expect(normaliseScore('platters', '4 stars')).toBe(80);
        expect(normaliseScore('platters', '★★★★')).toBe(80);
      });
    });
  });

  describe('Community ratings', () => {
    describe('Vivino', () => {
      it('should convert 5-point scale to 100', () => {
        expect(normaliseScore('vivino', '4.2')).toBe(84);
        expect(normaliseScore('vivino', '4.5/5')).toBe(90);
        expect(normaliseScore('vivino', '4.1 stars')).toBe(82);
      });
    });

    describe('CellarTracker', () => {
      it('should normalise CT scores', () => {
        expect(normaliseScore('cellar_tracker', 'CT89')).toBe(89);
        expect(normaliseScore('cellar_tracker', '91')).toBe(91);
        expect(normaliseScore('cellar_tracker', '87.5')).toBe(88);
      });
    });
  });

  describe('Competition medals', () => {
    describe('DWWA (Decanter World Wine Awards)', () => {
      it('should normalise DWWA awards', () => {
        expect(normaliseScore('decanter', 'Best in Show')).toBe(99);
        expect(normaliseScore('decanter', 'Platinum')).toBe(97);
        expect(normaliseScore('decanter', 'Gold')).toBe(94);
        expect(normaliseScore('decanter', 'Silver')).toBe(88);
        expect(normaliseScore('decanter', 'Bronze')).toBe(82);
        expect(normaliseScore('decanter', 'Commended')).toBe(78);
      });
    });

    describe('IWC', () => {
      it('should normalise IWC awards', () => {
        expect(normaliseScore('iwc', 'Trophy')).toBe(98);
        expect(normaliseScore('iwc', 'Gold')).toBe(94);
        expect(normaliseScore('iwc', 'Silver')).toBe(88);
        expect(normaliseScore('iwc', 'Bronze')).toBe(82);
        expect(normaliseScore('iwc', 'Commended')).toBe(78);
      });
    });

    describe('IWSC', () => {
      it('should normalise IWSC awards', () => {
        expect(normaliseScore('iwsc', 'Trophy')).toBe(98);
        expect(normaliseScore('iwsc', 'Gold Outstanding')).toBe(96);
        expect(normaliseScore('iwsc', 'Gold')).toBe(94);
        expect(normaliseScore('iwsc', 'Silver Outstanding')).toBe(90);
        expect(normaliseScore('iwsc', 'Silver')).toBe(88);
        expect(normaliseScore('iwsc', 'Bronze')).toBe(82);
      });
    });
  });
});

describe('getScoreFormatsForSources (single)', () => {
  it('should return format for known source', () => {
    const format = getScoreFormatsForSources(['wine_spectator'])[0];
    expect(format).toBeDefined();
    expect(format.name).toBe('Wine Spectator');
  });

  it('should filter out unknown sources', () => {
    const formats = getScoreFormatsForSources(['unknown_source']);
    expect(formats).toHaveLength(0);
  });
});

describe('normaliseScore', () => {
  it('should normalise score for known source', () => {
    const score = normaliseScore('wine_spectator', '92');
    expect(score).toBe(92);
  });

  it('should fallback to parsing number for unknown source', () => {
    const score = normaliseScore('unknown_source', '89 points');
    expect(score).toBe(89);
  });

  it('should handle unparseable scores', () => {
    const score = normaliseScore('unknown_source', 'excellent');
    expect(score).toBeNull();
  });
});

describe('getScoreFormatsForSources', () => {
  it('should return formats for valid sources', () => {
    const formats = getScoreFormatsForSources(['wine_spectator', 'vivino']);
    expect(formats).toHaveLength(2);
    expect(formats[0].id).toBe('wine_spectator');
    expect(formats[1].id).toBe('vivino');
  });

  it('should filter out unknown sources', () => {
    const formats = getScoreFormatsForSources(['wine_spectator', 'unknown', 'vivino']);
    expect(formats).toHaveLength(2);
  });

  it('should return empty array for all unknown sources', () => {
    const formats = getScoreFormatsForSources(['unknown1', 'unknown2']);
    expect(formats).toHaveLength(0);
  });
});

describe('buildScoreFormatPrompt', () => {
  it('should build prompt text for known sources', () => {
    const prompt = buildScoreFormatPrompt(['wine_spectator', 'jancis_robinson']);
    expect(prompt).toContain('Wine Spectator');
    expect(prompt).toContain('Jancis Robinson');
    expect(prompt).toContain('Score formats to recognise');
  });

  it('should return empty string for unknown sources', () => {
    const prompt = buildScoreFormatPrompt(['unknown1', 'unknown2']);
    expect(prompt).toBe('');
  });
});
