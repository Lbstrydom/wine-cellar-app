/**
 * @fileoverview Unit tests for recipe normaliser and category signal map.
 * @module tests/unit/services/recipe/recipeNormaliser.test
 */

import { describe, it, expect } from 'vitest';
import { normaliseRecipe, normaliseRecipeBatch, extractRecipeSignals } from '../../../../src/services/recipe/recipeNormaliser.js';
import { getCategorySignalBoosts, getRawMap } from '../../../../src/services/recipe/categorySignalMap.js';
import { validateRecipeInput } from '../../../../src/services/recipe/adapters/adapterInterface.js';

// ==========================================
// validateRecipeInput
// ==========================================
describe('validateRecipeInput', () => {
  it('returns empty errors for a valid input', () => {
    const errors = validateRecipeInput({
      name: 'Pasta Carbonara',
      source_provider: 'manual'
    });
    expect(errors).toEqual([]);
  });

  it('rejects null input', () => {
    const errors = validateRecipeInput(null);
    expect(errors).toContain('Input must be an object');
  });

  it('rejects missing name', () => {
    const errors = validateRecipeInput({ source_provider: 'csv' });
    expect(errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rejects empty string name', () => {
    const errors = validateRecipeInput({ name: '  ', source_provider: 'csv' });
    expect(errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rejects missing source_provider', () => {
    const errors = validateRecipeInput({ name: 'Test' });
    expect(errors.some(e => e.includes('source_provider'))).toBe(true);
  });

  it('rejects out-of-range rating', () => {
    const errors = validateRecipeInput({ name: 'Test', source_provider: 'csv', rating: 10 });
    expect(errors.some(e => e.includes('rating'))).toBe(true);
  });

  it('accepts valid rating of 0', () => {
    const errors = validateRecipeInput({ name: 'Test', source_provider: 'csv', rating: 0 });
    expect(errors).toEqual([]);
  });

  it('rejects non-array categories', () => {
    const errors = validateRecipeInput({ name: 'Test', source_provider: 'csv', categories: 'Chicken' });
    expect(errors.some(e => e.includes('categories'))).toBe(true);
  });
});

// ==========================================
// normaliseRecipe
// ==========================================
describe('normaliseRecipe', () => {
  const baseInput = {
    name: '  Pasta Carbonara  ',
    ingredients: '  Eggs\nBacon\n  ',
    directions: '  Cook pasta  ',
    categories: ['Italian', '  Quick  '],
    rating: 4.7,
    cook_time: ' 20 min ',
    prep_time: ' 10 min ',
    total_time: ' 30 min ',
    servings: ' 4 ',
    source: ' Test Source ',
    source_url: ' https://example.com ',
    notes: ' Great recipe ',
    source_provider: 'manual'
  };

  it('trims all string fields', () => {
    const { recipe } = normaliseRecipe(baseInput);
    expect(recipe.name).toBe('Pasta Carbonara');
    expect(recipe.ingredients).toBe('Eggs\nBacon');
    expect(recipe.directions).toBe('Cook pasta');
    expect(recipe.cook_time).toBe('20 min');
    expect(recipe.source).toBe('Test Source');
  });

  it('normalises categories by trimming', () => {
    const { recipe } = normaliseRecipe(baseInput);
    expect(recipe.categories).toEqual(['Italian', 'Quick']);
  });

  it('rounds rating to integer 0-5', () => {
    const { recipe } = normaliseRecipe(baseInput);
    expect(recipe.rating).toBe(5);
  });

  it('rejects negative rating at validation level', () => {
    const { recipe, errors } = normaliseRecipe({ ...baseInput, rating: -3 });
    expect(recipe).toBeNull();
    expect(errors.some(e => e.includes('rating'))).toBe(true);
  });

  it('rejects excessive rating at validation level', () => {
    const { recipe, errors } = normaliseRecipe({ ...baseInput, rating: 100 });
    expect(recipe).toBeNull();
    expect(errors.some(e => e.includes('rating'))).toBe(true);
  });

  it('handles null rating', () => {
    const { recipe } = normaliseRecipe({ ...baseInput, rating: null });
    expect(recipe.rating).toBe(0);
  });

  it('rejects NaN rating at validation level', () => {
    const { recipe, errors } = normaliseRecipe({ ...baseInput, rating: 'excellent' });
    expect(recipe).toBeNull();
    expect(errors.some(e => e.includes('rating'))).toBe(true);
  });

  it('rejects string categories at validation level', () => {
    const { recipe, errors } = normaliseRecipe({ ...baseInput, categories: 'Italian, Quick, Easy' });
    expect(recipe).toBeNull();
    expect(errors.some(e => e.includes('categories'))).toBe(true);
  });

  it('returns null recipe for invalid input', () => {
    const { recipe, errors } = normaliseRecipe({ source_provider: 'csv' });
    expect(recipe).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('nullifies empty optional strings', () => {
    const { recipe } = normaliseRecipe({ ...baseInput, notes: '  ', directions: '' });
    expect(recipe.notes).toBeNull();
    expect(recipe.directions).toBeNull();
  });
});

// ==========================================
// normaliseRecipeBatch
// ==========================================
describe('normaliseRecipeBatch', () => {
  it('returns valid recipes and collects errors', () => {
    const inputs = [
      { name: 'Good Recipe', source_provider: 'csv' },
      { source_provider: 'csv' }, // missing name
      { name: 'Also Good', source_provider: 'manual' }
    ];

    const { recipes, errors } = normaliseRecipeBatch(inputs);
    expect(recipes).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(1);
  });

  it('handles empty input array', () => {
    const { recipes, errors } = normaliseRecipeBatch([]);
    expect(recipes).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ==========================================
// getCategorySignalBoosts
// ==========================================
describe('getCategorySignalBoosts', () => {
  it('returns signals for direct category match', () => {
    const boosts = getCategorySignalBoosts(['Chicken']);
    expect(boosts.chicken).toBe(1);
  });

  it('returns signals for fuzzy category match', () => {
    const boosts = getCategorySignalBoosts(['Grilled Chicken']);
    expect(boosts).toHaveProperty('grilled');
    expect(boosts).toHaveProperty('chicken');
  });

  it('returns empty for unknown categories', () => {
    const boosts = getCategorySignalBoosts(['Obscure Category']);
    expect(Object.keys(boosts)).toHaveLength(0);
  });

  it('handles empty array', () => {
    const boosts = getCategorySignalBoosts([]);
    expect(boosts).toEqual({});
  });

  it('handles null input', () => {
    const boosts = getCategorySignalBoosts(null);
    expect(boosts).toEqual({});
  });

  it('aggregates signals from multiple categories', () => {
    const boosts = getCategorySignalBoosts(['Chicken', 'BBQ']);
    expect(boosts.chicken).toBe(1);
    expect(boosts.grilled).toBe(1);
    expect(boosts.smoky).toBe(1);
  });

  it('maps cuisine categories to signals', () => {
    const boosts = getCategorySignalBoosts(['Asian']);
    expect(boosts).toHaveProperty('spicy');
    expect(boosts).toHaveProperty('umami');
  });
});

// ==========================================
// extractRecipeSignals
// ==========================================
describe('extractRecipeSignals', () => {
  it('extracts signals from categories at 0.5x weight', () => {
    const signals = extractRecipeSignals({ categories: ['Chicken'] });
    expect(signals.chicken).toBe(0.5);
  });

  it('handles missing categories', () => {
    const signals = extractRecipeSignals({});
    expect(signals).toEqual({});
  });
});

// ==========================================
// categorySignalMap coverage
// ==========================================
describe('categorySignalMap', () => {
  it('has a non-empty map', () => {
    const map = getRawMap();
    expect(Object.keys(map).length).toBeGreaterThan(20);
  });

  it('all map values are string arrays', () => {
    const map = getRawMap();
    for (const [key, signals] of Object.entries(map)) {
      expect(Array.isArray(signals), `${key} should map to array`).toBe(true);
      for (const s of signals) {
        expect(typeof s).toBe('string');
      }
    }
  });
});
