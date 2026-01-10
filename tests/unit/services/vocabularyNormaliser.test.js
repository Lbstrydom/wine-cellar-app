/**
 * @fileoverview Unit tests for vocabularyNormaliser service.
 * Tests synonym mapping, category grouping, structure value normalisation.
 */

import { describe, it, expect } from 'vitest';
import {
  NORMALISER_VERSION,
  SYNONYM_MAP,
  CATEGORY_MAP,
  STRUCTURE_SCALES,
  normaliseDescriptor,
  normaliseStructureValue,
  groupByCategory,
  toDisplayFormat,
  toCanonicalFormat
} from '../../../src/services/vocabularyNormaliser.js';

describe('vocabularyNormaliser', () => {
  
  describe('NORMALISER_VERSION', () => {
    it('should be a valid semver string', () => {
      expect(NORMALISER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
    
    it('should be version 1.0.0', () => {
      expect(NORMALISER_VERSION).toBe('1.0.0');
    });
  });
  
  describe('SYNONYM_MAP', () => {
    it('should map citrus synonyms to canonical forms', () => {
      expect(SYNONYM_MAP['lemon zest']).toBe('lemon');
      expect(SYNONYM_MAP['lime zest']).toBe('lime');
      expect(SYNONYM_MAP['citrus peel']).toBe('citrus');
    });
    
    it('should map fruit synonyms correctly', () => {
      expect(SYNONYM_MAP['passionfruit']).toBe('passion_fruit');
      expect(SYNONYM_MAP['red fruits']).toBe('red_fruit');
      expect(SYNONYM_MAP['dark fruits']).toBe('dark_fruit');
    });
    
    it('should map herbal synonyms', () => {
      expect(SYNONYM_MAP['cut grass']).toBe('grass');
      expect(SYNONYM_MAP['fresh herbs']).toBe('herbs');
      expect(SYNONYM_MAP['herbaceous']).toBe('herbs');
    });
    
    it('should map oak and spice terms', () => {
      expect(SYNONYM_MAP['toasty']).toBe('toast');
      expect(SYNONYM_MAP['smoky']).toBe('smoke');
      expect(SYNONYM_MAP['spicy']).toBe('spice');
    });
  });
  
  describe('CATEGORY_MAP', () => {
    it('should categorise orchard fruit terms', () => {
      expect(CATEGORY_MAP.apple).toBe('orchard');
      expect(CATEGORY_MAP.pear).toBe('orchard');
    });
    
    it('should categorise stone fruit terms', () => {
      expect(CATEGORY_MAP.cherry).toBe('stone_fruit');
      expect(CATEGORY_MAP.peach).toBe('stone_fruit');
    });
    
    it('should categorise citrus terms', () => {
      expect(CATEGORY_MAP.citrus).toBe('citrus');
      expect(CATEGORY_MAP.lemon).toBe('citrus');
    });
    
    it('should categorise oak terms', () => {
      expect(CATEGORY_MAP.oak).toBe('oak');
      expect(CATEGORY_MAP.vanilla).toBe('oak');
      expect(CATEGORY_MAP.cedar).toBe('oak');
    });
    
    it('should categorise mineral terms', () => {
      expect(CATEGORY_MAP.mineral).toBe('mineral');
      expect(CATEGORY_MAP.flint).toBe('mineral');
      expect(CATEGORY_MAP.chalk).toBe('mineral');
    });
    
    it('should categorise herbal terms', () => {
      expect(CATEGORY_MAP.herbs).toBe('herbal');
      expect(CATEGORY_MAP.mint).toBe('herbal');
      expect(CATEGORY_MAP.eucalyptus).toBe('herbal');
    });
    
    it('should categorise earthy terms', () => {
      expect(CATEGORY_MAP.earth).toBe('earthy');
      expect(CATEGORY_MAP.mushroom).toBe('earthy');
      expect(CATEGORY_MAP.truffle).toBe('earthy');
    });
  });
  
  describe('STRUCTURE_SCALES', () => {
    it('should have sweetness scale with 6 levels', () => {
      expect(STRUCTURE_SCALES.sweetness).toHaveLength(6);
      expect(STRUCTURE_SCALES.sweetness).toContain('bone-dry');
      expect(STRUCTURE_SCALES.sweetness).toContain('dry');
      expect(STRUCTURE_SCALES.sweetness).toContain('sweet');
    });
    
    it('should have acidity scale with 6 levels', () => {
      expect(STRUCTURE_SCALES.acidity).toHaveLength(6);
      expect(STRUCTURE_SCALES.acidity).toContain('low');
      expect(STRUCTURE_SCALES.acidity).toContain('medium');
      expect(STRUCTURE_SCALES.acidity).toContain('high');
    });
    
    it('should have body scale with 5 levels', () => {
      expect(STRUCTURE_SCALES.body).toHaveLength(5);
      expect(STRUCTURE_SCALES.body).toContain('light');
      expect(STRUCTURE_SCALES.body).toContain('medium');
      expect(STRUCTURE_SCALES.body).toContain('full');
    });
    
    it('should have tannin scale with 7 levels', () => {
      expect(STRUCTURE_SCALES.tannin).toHaveLength(7);
      expect(STRUCTURE_SCALES.tannin).toContain('none');
      expect(STRUCTURE_SCALES.tannin).toContain('medium');
      expect(STRUCTURE_SCALES.tannin).toContain('grippy');
    });
    
    it('should have finish scale with 6 levels', () => {
      expect(STRUCTURE_SCALES.finish).toHaveLength(6);
      expect(STRUCTURE_SCALES.finish).toContain('short');
      expect(STRUCTURE_SCALES.finish).toContain('medium');
      expect(STRUCTURE_SCALES.finish).toContain('very-long');
    });
  });
  
  describe('normaliseDescriptor()', () => {
    it('should return object with canonical term if in CATEGORY_MAP', () => {
      const result = normaliseDescriptor('cherry');
      expect(result).not.toBeNull();
      expect(result.canonical).toBe('cherry');
      expect(result.category).toBe('stone_fruit');
    });
    
    it('should map synonyms to canonical terms', () => {
      const lemon = normaliseDescriptor('lemon zest');
      expect(lemon.canonical).toBe('lemon');
      expect(lemon.category).toBe('citrus');
      
      const passion = normaliseDescriptor('passionfruit');
      expect(passion.canonical).toBe('passion_fruit');
      
      const smoke = normaliseDescriptor('smoky');
      expect(smoke.canonical).toBe('smoke');
    });
    
    it('should handle case-insensitive input', () => {
      const result = normaliseDescriptor('CHERRY');
      expect(result.canonical).toBe('cherry');
      
      const lemon = normaliseDescriptor('Lemon Zest');
      expect(lemon.canonical).toBe('lemon');
    });
    
    it('should trim whitespace', () => {
      const result = normaliseDescriptor('  cherry  ');
      expect(result.canonical).toBe('cherry');
    });
    
    it('should flag unknown terms with category other', () => {
      const result = normaliseDescriptor('completely unknown term');
      expect(result).not.toBeNull();
      expect(result.category).toBe('other');
      expect(result.flagged).toBe(true);
    });
    
    it('should return null for noise terms', () => {
      expect(normaliseDescriptor('amazing')).toBeNull();
      expect(normaliseDescriptor('outstanding')).toBeNull();
    });
    
    it('should return null for empty or invalid input', () => {
      expect(normaliseDescriptor('')).toBeNull();
      expect(normaliseDescriptor(null)).toBeNull();
      expect(normaliseDescriptor(undefined)).toBeNull();
    });
  });
  
  describe('normaliseStructureValue()', () => {
    it('should normalise sweetness values (field, value)', () => {
      expect(normaliseStructureValue('sweetness', 'dry')).toBe('dry');
      expect(normaliseStructureValue('sweetness', 'SWEET')).toBe('sweet');
    });
    
    it('should normalise acidity values', () => {
      expect(normaliseStructureValue('acidity', 'medium')).toBe('medium');
      expect(normaliseStructureValue('acidity', 'high')).toBe('high');
      expect(normaliseStructureValue('acidity', 'medium-plus')).toBe('medium-plus');
    });
    
    it('should normalise body values', () => {
      expect(normaliseStructureValue('body', 'full')).toBe('full');
      expect(normaliseStructureValue('body', 'light')).toBe('light');
    });
    
    it('should normalise tannin values', () => {
      expect(normaliseStructureValue('tannin', 'high')).toBe('high');
      expect(normaliseStructureValue('tannin', 'medium')).toBe('medium');
    });
    
    it('should normalise finish values', () => {
      expect(normaliseStructureValue('finish', 'long')).toBe('long');
      expect(normaliseStructureValue('finish', 'short')).toBe('short');
      expect(normaliseStructureValue('finish', 'medium')).toBe('medium');
    });
    
    it('should handle case-insensitive input', () => {
      expect(normaliseStructureValue('sweetness', 'DRY')).toBe('dry');
      expect(normaliseStructureValue('acidity', 'Medium')).toBe('medium');
    });
    
    it('should return null for unknown values', () => {
      expect(normaliseStructureValue('sweetness', 'unknown')).toBeNull();
      expect(normaliseStructureValue('acidity', 'xyz')).toBeNull();
    });
    
    it('should return null for unknown fields', () => {
      expect(normaliseStructureValue('unknown_field', 'high')).toBeNull();
    });
    
    it('should return null for empty input', () => {
      expect(normaliseStructureValue('sweetness', '')).toBeNull();
      expect(normaliseStructureValue('acidity', null)).toBeNull();
    });
  });
  
  describe('groupByCategory()', () => {
    it('should group descriptors by category', () => {
      const descriptors = ['cherry', 'vanilla', 'mineral', 'herbs'];
      const grouped = groupByCategory(descriptors);
      
      expect(grouped.stone_fruit).toContain('cherry');
      expect(grouped.oak).toContain('vanilla');
      expect(grouped.mineral).toContain('mineral');
      expect(grouped.herbal).toContain('herbs');
    });
    
    it('should handle multiple descriptors per category', () => {
      const descriptors = ['cherry', 'plum', 'peach'];
      const grouped = groupByCategory(descriptors);
      
      expect(grouped.stone_fruit).toHaveLength(3);
      expect(grouped.stone_fruit).toContain('cherry');
      expect(grouped.stone_fruit).toContain('plum');
      expect(grouped.stone_fruit).toContain('peach');
    });
    
    it('should not duplicate descriptors', () => {
      const descriptors = ['cherry', 'cherry', 'cherry'];
      const grouped = groupByCategory(descriptors);
      
      expect(grouped.stone_fruit).toHaveLength(1);
    });
    
    it('should put unknown terms in "other" category', () => {
      const descriptors = ['cherry', 'unknown_term_xyz'];
      const grouped = groupByCategory(descriptors);
      
      expect(grouped.stone_fruit).toContain('cherry');
      expect(grouped.other).toContain('unknown_term_xyz');
    });
    
    it('should return empty object for empty input', () => {
      const grouped = groupByCategory([]);
      expect(Object.keys(grouped)).toHaveLength(0);
    });
  });
  
  describe('toDisplayFormat()', () => {
    it('should convert snake_case to Title Case', () => {
      expect(toDisplayFormat('black_cherry')).toBe('Black Cherry');
      expect(toDisplayFormat('dark_fruit')).toBe('Dark Fruit');
    });
    
    it('should handle single words', () => {
      expect(toDisplayFormat('cherry')).toBe('Cherry');
      expect(toDisplayFormat('vanilla')).toBe('Vanilla');
    });
    
    it('should handle multiple underscores', () => {
      expect(toDisplayFormat('medium_plus_acidity')).toBe('Medium Plus Acidity');
    });
  });
  
  describe('toCanonicalFormat()', () => {
    it('should convert spaces to underscores', () => {
      expect(toCanonicalFormat('black cherry')).toBe('black_cherry');
      expect(toCanonicalFormat('dark fruit')).toBe('dark_fruit');
    });
    
    it('should convert to lowercase', () => {
      expect(toCanonicalFormat('Black Cherry')).toBe('black_cherry');
      expect(toCanonicalFormat('VANILLA')).toBe('vanilla');
    });
    
    it('should trim whitespace', () => {
      expect(toCanonicalFormat('  cherry  ')).toBe('cherry');
    });
    
    it('should handle multiple spaces', () => {
      expect(toCanonicalFormat('red   fruit')).toBe('red_fruit');
    });
  });
  
});
