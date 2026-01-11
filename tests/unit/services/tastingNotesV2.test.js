/**
 * @fileoverview Unit tests for tastingNotesV2 service.
 * Tests schema conversion and pure functions using mocked database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module BEFORE importing the service
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 1 })
    }))
  }
}));

// Mock the tastingExtractor module
vi.mock('../../../src/services/tastingExtractor.js', () => ({
  extractTastingProfile: vi.fn(() => ({
    nose: { primary_fruit: ['cherry'], secondary: ['vanilla'], tertiary: [] },
    palate: { sweetness: 'dry', body: 'full', acidity: 'medium', tannin: 'high' },
    finish: { length: 'long', notes: ['spice'] }
  })),
  extractAndMergeProfiles: vi.fn(() => ({
    nose: { primary_fruit: ['cherry'], secondary: ['vanilla'], tertiary: [] },
    palate: { sweetness: 'dry', body: 'full', acidity: 'medium', tannin: 'high' },
    finish: { length: 'long', notes: ['spice'] }
  }))
}));

// Now import the module under test
const { SCHEMA_VERSION, convertToV2Schema } = await import('../../../src/services/tastingNotesV2.js');

describe('tastingNotesV2', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  describe('SCHEMA_VERSION', () => {
    it('should be version 2.0', () => {
      expect(SCHEMA_VERSION).toBe('2.0');
    });
  });
  
  describe('convertToV2Schema()', () => {
    it('should convert basic profile to v2 schema', () => {
      const profile = {
        nose: {
          primary_fruit: ['cherry', 'plum'],
          secondary: ['vanilla'],
          tertiary: [],
          intensity: 'medium'
        },
        palate: {
          sweetness: 'dry',
          body: 'full',
          acidity: 'medium',
          tannin: 'high',
          texture: ['velvety']
        },
        finish: {
          length: 'long',
          notes: ['spice']
        }
      };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'red' }
      });
      
      // Schema uses 'version' not 'schema_version'
      expect(result.version).toBe('2.0');
      expect(result.wine_type).toBe('still_red');
      expect(result.structure.sweetness).toBe('dry');
      expect(result.structure.body).toBe('full');
      expect(result.structure.tannin).toBe('high');
      expect(result.nose.all_descriptors).toContain('cherry');
      expect(result.finish.length).toBe('long');
    });
    
    it('should include normaliser version', () => {
      const profile = { nose: {}, palate: {} };
      const result = convertToV2Schema(profile);
      
      expect(result.normaliser_version).toBeDefined();
      expect(result.normaliser_version).toMatch(/^\d+\.\d+\.\d+$/);
    });
    
    it('should handle white wine without tannin', () => {
      const profile = {
        nose: { primary_fruit: ['citrus'] },
        palate: { sweetness: 'dry', body: 'light', acidity: 'high' }
      };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'white' }
      });
      
      expect(result.wine_type).toBe('still_white');
      expect(result.structure.tannin).toBeNull();
    });
    
    it('should detect sparkling wine type from style', () => {
      const profile = {
        nose: {},
        palate: { sweetness: 'dry' }
      };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'white', style: 'Champagne' }
      });
      
      expect(result.wine_type).toBe('sparkling');
    });
    
    it('should detect fortified wine type from style', () => {
      const profile = {
        nose: {},
        palate: { sweetness: 'sweet' }
      };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'red', style: 'Port' }
      });
      
      expect(result.wine_type).toBe('fortified');
    });
    
    it('should detect dessert wine type', () => {
      const profile = {
        nose: {},
        palate: { sweetness: 'sweet' }
      };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'white', style: 'Sauternes' }
      });
      
      expect(result.wine_type).toBe('dessert');
    });
    
    it('should default to still_red when colour unknown', () => {
      const profile = { nose: {}, palate: {} };
      const result = convertToV2Schema(profile, {});
      
      expect(result.wine_type).toBe('still_red');
    });
    
    it('should generate style fingerprint', () => {
      const profile = {
        nose: { primary_fruit: ['black_cherry', 'plum'] },
        palate: { sweetness: 'dry', body: 'full', acidity: 'medium', tannin: 'high' },
        structure: { body: 'full' }
      };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'red' }
      });
      
      expect(result.style_fingerprint).toBeDefined();
      expect(result.style_fingerprint.length).toBeLessThanOrEqual(120);
      // Fingerprint starts with capital R for 'Red'
      expect(result.style_fingerprint.toLowerCase()).toContain('red');
    });
    
    it('should group nose descriptors by category', () => {
      const profile = {
        nose: {
          primary_fruit: ['cherry', 'plum'],
          secondary: ['vanilla', 'oak'],
          tertiary: ['leather']
        },
        palate: {}
      };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'red' }
      });
      
      expect(result.nose.categories).toBeDefined();
      expect(result.nose.categories.stone_fruit).toContain('cherry');
      expect(result.nose.categories.oak).toContain('vanilla');
    });
    
    it('should set default structure values when not provided', () => {
      const profile = { nose: {}, palate: {} };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'red' }
      });
      
      expect(result.structure.sweetness).toBe('dry');
      expect(result.structure.acidity).toBe('medium');
      expect(result.structure.body).toBe('medium');
    });
    
    it('should calculate evidence strength with sources', () => {
      const profile = { nose: {}, palate: {} };
      const sources = [
        { type: 'critic', name: 'Wine Spectator' },
        { type: 'community', name: 'Vivino' },
        { type: 'critic', name: 'Decanter' }
      ];
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'red' },
        sources
      });
      
      expect(result.evidence).toBeDefined();
      expect(result.evidence.source_count).toBe(3);
      expect(['strong', 'medium', 'weak']).toContain(result.evidence.strength);
    });
    
    it('should handle empty profile gracefully', () => {
      const profile = {};
      
      const result = convertToV2Schema(profile, {});
      
      // Schema uses 'version' not 'schema_version'
      expect(result.version).toBe('2.0');
      expect(result.nose).toBeDefined();
      expect(result.palate).toBeDefined();
      expect(result.finish).toBeDefined();
    });
    
    it('should handle rosé wine type', () => {
      const profile = { nose: {}, palate: {} };
      
      const result = convertToV2Schema(profile, {
        wineInfo: { colour: 'rosé' }
      });
      
      expect(result.wine_type).toBe('still_rosé');
    });
    
    it('should detect contradictions with multiple profiles', () => {
      const profile1 = {
        palate: { sweetness: 'dry', body: 'light' }
      };
      const profile2 = {
        palate: { sweetness: 'dry', body: 'full' }
      };
      
      const result = convertToV2Schema(profile1, {
        allProfiles: [profile1, profile2]
      });
      
      // Contradictions are in evidence.contradictions
      expect(result.evidence).toBeDefined();
      expect(result.evidence.contradictions).toBeDefined();
      // Body contradiction: light vs full
      const bodyContradiction = result.evidence.contradictions.find(c => c.field === 'body');
      expect(bodyContradiction).toBeDefined();
      expect(bodyContradiction.values_found).toContain('light');
      expect(bodyContradiction.values_found).toContain('full');
    });
    
    it('should calculate agreement score of 1 for single profile', () => {
      const profile = { palate: { sweetness: 'dry' } };
      
      const result = convertToV2Schema(profile, {
        allProfiles: [profile]
      });
      
      expect(result.evidence.agreement_score).toBe(1);
    });
    
    it('should include finish descriptors', () => {
      const profile = {
        nose: {},
        palate: {},
        finish: {
          length: 'long',
          notes: ['spice', 'mineral', 'fruit']
        }
      };
      
      const result = convertToV2Schema(profile);
      
      expect(result.finish.length).toBe('long');
      expect(result.finish.descriptors).toBeDefined();
      expect(result.finish.descriptors.length).toBeLessThanOrEqual(5);
    });
    
    it('should handle Prosecco as sparkling', () => {
      const result = convertToV2Schema({ nose: {}, palate: {} }, {
        wineInfo: { colour: 'white', style: 'Prosecco DOC' }
      });
      expect(result.wine_type).toBe('sparkling');
    });
    
    it('should handle Cava as sparkling', () => {
      const result = convertToV2Schema({ nose: {}, palate: {} }, {
        wineInfo: { colour: 'white', style: 'Cava Brut' }
      });
      expect(result.wine_type).toBe('sparkling');
    });
    
    it('should handle Sherry as fortified', () => {
      const result = convertToV2Schema({ nose: {}, palate: {} }, {
        wineInfo: { colour: 'white', style: 'Fino Sherry' }
      });
      expect(result.wine_type).toBe('fortified');
    });
    
    it('should handle Madeira as fortified', () => {
      const result = convertToV2Schema({ nose: {}, palate: {} }, {
        wineInfo: { colour: 'red', style: 'Madeira Malmsey' }
      });
      expect(result.wine_type).toBe('fortified');
    });
    
    it('should handle icewine as dessert', () => {
      const result = convertToV2Schema({ nose: {}, palate: {} }, {
        wineInfo: { colour: 'white', style: 'Icewine Riesling' }
      });
      expect(result.wine_type).toBe('dessert');
    });
    
    it('should normalise rose (without accent) to still_rosé', () => {
      const result = convertToV2Schema({ nose: {}, palate: {} }, {
        wineInfo: { colour: 'rose' }
      });
      expect(result.wine_type).toBe('still_rosé');
    });
  });
  
});
