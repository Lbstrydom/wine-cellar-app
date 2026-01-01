/**
 * @fileoverview Unit tests for score format definitions.
 * Tests score normalization for various rating sources.
 */

import { describe, it, expect } from 'vitest';
import scoreFormats, { getScoreFormat, normaliseScore, getScoreFormatsForSources, buildScoreFormatPrompt } from '../../../src/config/scoreFormats.js';

describe('scoreFormats', () => {
  describe('100-point scale sources', () => {
    const hundredPointSources = ['robert_parker', 'wine_spectator', 'vinous', 'james_suckling', 'wine_enthusiast', 'decanter'];

    hundredPointSources.forEach(source => {
      it(`should normalise ${source} scores correctly`, () => {
        const format = scoreFormats[source];
        expect(format).toBeDefined();
        expect(format.scale).toBe(100);
        expect(format.normalise('92')).toBe(92);
        expect(format.normalise('95')).toBe(95);
      });
    });

    it('should handle Wine Spectator range scores', () => {
      const result = scoreFormats.wine_spectator.normalise('88-90');
      expect(result).toBe(88); // Takes first number
    });

    it('should handle plus notation (95+)', () => {
      const result = scoreFormats.vinous.normalise('91+');
      expect(result).toBe(91);
    });
  });

  describe('20-point scale sources', () => {
    it('should convert Jancis Robinson 20-point scores', () => {
      const format = scoreFormats.jancis_robinson;
      expect(format.scale).toBe(20);
      expect(format.normalise('17/20')).toBe(85);
      expect(format.normalise('18.5')).toBe(93);
      expect(format.normalise('16')).toBe(80);
    });

    it('should convert RVF 20-point scores', () => {
      const format = scoreFormats.rvf;
      expect(format.scale).toBe(20);
      expect(format.normalise('17/20')).toBe(85);
      expect(format.normalise('18')).toBe(90);
    });

    it('should convert Bettane+Desseauve 20-point scores', () => {
      const format = scoreFormats.bettane_desseauve;
      expect(format.scale).toBe(20);
      expect(format.normalise('16/20')).toBe(80);
      expect(format.normalise('17.5')).toBe(88);
    });

    it('should convert Vinum 20-point scores', () => {
      const format = scoreFormats.vinum;
      expect(format.scale).toBe(20);
      expect(format.normalise('17/20')).toBe(85);
      expect(format.normalise('19')).toBe(95);
    });
  });

  describe('Italian guides - symbol-based', () => {
    describe('Gambero Rosso', () => {
      const format = scoreFormats.gambero_rosso;

      it('should normalise Tre Bicchieri', () => {
        expect(format.normalise('Tre Bicchieri')).toBe(95);
      });

      it('should normalise Due Bicchieri Rossi', () => {
        expect(format.normalise('Due Bicchieri Rossi')).toBe(90);
      });

      it('should normalise Due Bicchieri', () => {
        expect(format.normalise('Due Bicchieri')).toBe(87);
      });

      it('should normalise Un Bicchiere', () => {
        expect(format.normalise('Un Bicchiere')).toBe(80);
      });

      it('should handle numeric format (3 bicchieri)', () => {
        expect(format.normalise('3 bicchieri')).toBe(95);
        expect(format.normalise('2 bicchieri')).toBe(87);
      });

      it('should return null for unrecognized symbols', () => {
        expect(format.normalise('Zero Bicchieri')).toBeNull();
      });
    });

    describe('Bibenda', () => {
      const format = scoreFormats.bibenda;

      it('should normalise 5 grappoli', () => {
        expect(format.normalise('5 grappoli')).toBe(95);
        expect(format.normalise('cinque grappoli')).toBe(95);
      });

      it('should normalise 4 grappoli', () => {
        expect(format.normalise('4 grappoli')).toBe(90);
        expect(format.normalise('quattro grappoli')).toBe(90);
      });

      it('should normalise 3 grappoli', () => {
        expect(format.normalise('3 grappoli')).toBe(85);
        expect(format.normalise('tre grappoli')).toBe(85);
      });

      it('should normalise 2 grappoli', () => {
        expect(format.normalise('2 grappoli')).toBe(80);
        expect(format.normalise('due grappoli')).toBe(80);
      });
    });
  });

  describe('French guides - symbol-based', () => {
    describe('Guide Hachette', () => {
      const format = scoreFormats.guide_hachette;

      it('should normalise Coup de Coeur', () => {
        expect(format.normalise('Coup de Coeur')).toBe(96);
        expect(format.normalise('Coup de Cœur')).toBe(96);
      });

      it('should normalise star symbols', () => {
        expect(format.normalise('★★★')).toBe(94);
        expect(format.normalise('★★')).toBe(88);
        expect(format.normalise('★')).toBe(82);
      });

      it('should normalise text star notation', () => {
        expect(format.normalise('3 étoiles')).toBe(94);
        expect(format.normalise('2 étoiles')).toBe(88);
        expect(format.normalise('1 étoile')).toBe(82);
      });
    });
  });

  describe('South African - stars', () => {
    describe("Platter's", () => {
      const format = scoreFormats.platters;

      it('should normalise 5 stars', () => {
        expect(format.normalise('5 stars')).toBe(100);
        expect(format.normalise('★★★★★')).toBe(100);
      });

      it('should normalise 4.5 stars', () => {
        expect(format.normalise('4.5 stars')).toBe(90);
        expect(format.normalise('★★★★½')).toBe(90);
        expect(format.normalise('4½')).toBe(90);
      });

      it('should normalise 4 stars', () => {
        expect(format.normalise('4 stars')).toBe(80);
        expect(format.normalise('★★★★')).toBe(80);
      });
    });
  });

  describe('Community ratings', () => {
    describe('Vivino', () => {
      const format = scoreFormats.vivino;

      it('should convert 5-point scale to 100', () => {
        expect(format.normalise('4.2')).toBe(84);
        expect(format.normalise('4.5/5')).toBe(90);
        expect(format.normalise('4.1 stars')).toBe(82);
      });
    });

    describe('CellarTracker', () => {
      const format = scoreFormats.cellartracker;

      it('should normalise CT scores', () => {
        expect(format.normalise('CT89')).toBe(89);
        expect(format.normalise('91')).toBe(91);
        expect(format.normalise('87.5')).toBe(88);
      });
    });
  });

  describe('Competition medals', () => {
    describe('Generic competition medal', () => {
      const format = scoreFormats.competition_medal;

      it('should normalise trophy awards', () => {
        expect(format.normalise('Trophy')).toBe(98);
        expect(format.normalise('Best in Show')).toBe(98);
        expect(format.normalise('Platinum')).toBe(98);
      });

      it('should normalise gold medals', () => {
        expect(format.normalise('Grand Gold')).toBe(96);
        expect(format.normalise('Double Gold')).toBe(96);
        expect(format.normalise('Gold')).toBe(94);
      });

      it('should normalise silver medals', () => {
        expect(format.normalise('Silver')).toBe(88);
      });

      it('should normalise bronze medals', () => {
        expect(format.normalise('Bronze')).toBe(82);
      });

      it('should normalise commended/seal', () => {
        expect(format.normalise('Commended')).toBe(78);
        expect(format.normalise('Seal of Approval')).toBe(78);
      });
    });

    describe('DWWA', () => {
      const format = scoreFormats.dwwa;

      it('should normalise DWWA specific awards', () => {
        expect(format.normalise('Best in Show')).toBe(99);
        expect(format.normalise('Platinum')).toBe(97);
        expect(format.normalise('Gold')).toBe(94);
        expect(format.normalise('Silver')).toBe(88);
        expect(format.normalise('Bronze')).toBe(82);
        expect(format.normalise('Commended')).toBe(78);
      });
    });

    describe('IWC', () => {
      const format = scoreFormats.iwc;

      it('should normalise IWC awards', () => {
        expect(format.normalise('Trophy')).toBe(98);
        expect(format.normalise('Gold')).toBe(94);
        expect(format.normalise('Silver')).toBe(88);
        expect(format.normalise('Bronze')).toBe(82);
        expect(format.normalise('Commended')).toBe(78);
      });
    });

    describe('IWSC', () => {
      const format = scoreFormats.iwsc;

      it('should normalise IWSC awards', () => {
        expect(format.normalise('Trophy')).toBe(98);
        expect(format.normalise('Gold Outstanding')).toBe(96);
        expect(format.normalise('Gold')).toBe(94);
        expect(format.normalise('Silver Outstanding')).toBe(90);
        expect(format.normalise('Silver')).toBe(88);
        expect(format.normalise('Bronze')).toBe(82);
      });
    });
  });
});

describe('getScoreFormat', () => {
  it('should return format for known source', () => {
    const format = getScoreFormat('wine_spectator');
    expect(format).toBeDefined();
    expect(format.name).toBe('Wine Spectator');
  });

  it('should return null for unknown source', () => {
    const format = getScoreFormat('unknown_source');
    expect(format).toBeNull();
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
