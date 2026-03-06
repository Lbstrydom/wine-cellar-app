/**
 * @fileoverview Schema protection tests for the fridge category registry.
 * Guards against accidental removal of required fields or category mis-configuration.
 * @module tests/unit/config/fridgeCategories.test
 */

import {
  CATEGORY_REGISTRY,
  FLEX_CATEGORY,
  FRIDGE_CATEGORY_ORDER,
  CATEGORY_DISPLAY_NAMES
} from '../../../src/config/fridgeCategories.js';

describe('CATEGORY_REGISTRY — schema validation', () => {
  const categoryIds = Object.keys(CATEGORY_REGISTRY);

  it('contains at least 7 categories', () => {
    expect(categoryIds.length).toBeGreaterThanOrEqual(7);
  });

  it('every category has a numeric priority', () => {
    for (const [id, cat] of Object.entries(CATEGORY_REGISTRY)) {
      expect(typeof cat.priority, `${id}.priority`).toBe('number');
    }
  });

  it('every category has a non-empty description string', () => {
    for (const [id, cat] of Object.entries(CATEGORY_REGISTRY)) {
      expect(typeof cat.description, `${id}.description`).toBe('string');
      expect(cat.description.length, `${id}.description length`).toBeGreaterThan(0);
    }
  });

  it('every category has a suitableFor array with at least one entry', () => {
    for (const [id, cat] of Object.entries(CATEGORY_REGISTRY)) {
      expect(Array.isArray(cat.suitableFor), `${id}.suitableFor`).toBe(true);
      expect(cat.suitableFor.length, `${id}.suitableFor length`).toBeGreaterThan(0);
    }
  });

  it('suitableFor values are only wine_fridge or kitchen_fridge', () => {
    const validTypes = new Set(['wine_fridge', 'kitchen_fridge']);
    for (const [id, cat] of Object.entries(CATEGORY_REGISTRY)) {
      for (const type of cat.suitableFor) {
        expect(validTypes.has(type), `${id}.suitableFor[${type}]`).toBe(true);
      }
    }
  });

  it('every category has a matchRules object', () => {
    for (const [id, cat] of Object.entries(CATEGORY_REGISTRY)) {
      expect(typeof cat.matchRules, `${id}.matchRules`).toBe('object');
      expect(cat.matchRules).not.toBeNull();
    }
  });

  it('priorities are unique across all categories', () => {
    const priorities = Object.values(CATEGORY_REGISTRY).map(c => c.priority);
    const unique = new Set(priorities);
    expect(unique.size).toBe(priorities.length);
  });

  it('chillableRed is wine_fridge only', () => {
    expect(CATEGORY_REGISTRY.chillableRed.suitableFor).toEqual(['wine_fridge']);
  });

  it('textureWhite is wine_fridge only', () => {
    expect(CATEGORY_REGISTRY.textureWhite.suitableFor).toEqual(['wine_fridge']);
  });

  it('sparkling, crispWhite, aromaticWhite, rose are suitable for both fridge types', () => {
    const bothTypes = ['sparkling', 'crispWhite', 'aromaticWhite', 'rose'];
    for (const cat of bothTypes) {
      expect(CATEGORY_REGISTRY[cat].suitableFor, cat).toContain('wine_fridge');
      expect(CATEGORY_REGISTRY[cat].suitableFor, cat).toContain('kitchen_fridge');
    }
  });

  it('wine_fridge has more eligible categories than kitchen_fridge', () => {
    const wineFridgeCats = Object.values(CATEGORY_REGISTRY).filter(c => c.suitableFor.includes('wine_fridge'));
    const kitchenCats = Object.values(CATEGORY_REGISTRY).filter(c => c.suitableFor.includes('kitchen_fridge'));
    expect(wineFridgeCats.length).toBeGreaterThan(kitchenCats.length);
  });
});

describe('FRIDGE_CATEGORY_ORDER', () => {
  it('contains all CATEGORY_REGISTRY keys plus flex', () => {
    const registryKeys = new Set(Object.keys(CATEGORY_REGISTRY));
    for (const cat of FRIDGE_CATEGORY_ORDER) {
      if (cat === 'flex') continue;
      expect(registryKeys.has(cat), `${cat} in registry`).toBe(true);
    }
    expect(FRIDGE_CATEGORY_ORDER).toContain('flex');
  });

  it('has no duplicates', () => {
    const unique = new Set(FRIDGE_CATEGORY_ORDER);
    expect(unique.size).toBe(FRIDGE_CATEGORY_ORDER.length);
  });

  it('sparkling comes first (priority 1)', () => {
    expect(FRIDGE_CATEGORY_ORDER[0]).toBe('sparkling');
  });

  it('flex comes last', () => {
    expect(FRIDGE_CATEGORY_ORDER[FRIDGE_CATEGORY_ORDER.length - 1]).toBe('flex');
  });
});

describe('CATEGORY_DISPLAY_NAMES', () => {
  it('has an entry for every CATEGORY_REGISTRY key', () => {
    for (const cat of Object.keys(CATEGORY_REGISTRY)) {
      expect(CATEGORY_DISPLAY_NAMES[cat], `label for ${cat}`).toBeTruthy();
    }
  });

  it('has a flex label', () => {
    expect(CATEGORY_DISPLAY_NAMES.flex).toBeTruthy();
  });

  it('all labels are non-empty strings', () => {
    for (const [cat, label] of Object.entries(CATEGORY_DISPLAY_NAMES)) {
      expect(typeof label, `${cat} label type`).toBe('string');
      expect(label.length, `${cat} label length`).toBeGreaterThan(0);
    }
  });
});

describe('FLEX_CATEGORY', () => {
  it('has priority 99 (lowest)', () => {
    expect(FLEX_CATEGORY.priority).toBe(99);
  });

  it('is suitable for both fridge types', () => {
    expect(FLEX_CATEGORY.suitableFor).toContain('wine_fridge');
    expect(FLEX_CATEGORY.suitableFor).toContain('kitchen_fridge');
  });

  it('is marked optional', () => {
    expect(FLEX_CATEGORY.optional).toBe(true);
  });
});
