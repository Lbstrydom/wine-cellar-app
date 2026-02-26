/**
 * @fileoverview Unit tests for RecipeSage adapter.
 * @module tests/unit/services/recipe/recipeSageAdapter.test
 */

import { describe, it, expect } from 'vitest';
import { parseRecipes } from '../../../../src/services/recipe/adapters/recipeSageAdapter.js';

describe('RecipeSage Adapter', () => {
  it('parses a JSON-LD Recipe array', () => {
    const json = JSON.stringify([
      {
        '@type': 'Recipe',
        name: 'Pasta Carbonara',
        recipeIngredient: ['Eggs', 'Bacon', 'Cheese'],
        recipeInstructions: [
          { text: 'Cook pasta' },
          { text: 'Mix eggs' }
        ],
        recipeCategory: ['Italian', 'Quick'],
        cookTime: 'PT20M',
        prepTime: 'PT10M',
        recipeYield: '4 servings',
        author: { name: 'Chef Test' },
        url: 'https://example.com/carbonara'
      }
    ]);

    const recipes = parseRecipes(json);
    expect(recipes).toHaveLength(1);

    const r = recipes[0];
    expect(r.name).toBe('Pasta Carbonara');
    expect(r.ingredients).toBe('Eggs\nBacon\nCheese');
    expect(r.directions).toBe('Cook pasta\nMix eggs');
    expect(r.categories).toEqual(['Italian', 'Quick']);
    expect(r.cook_time).toBe('PT20M');
    expect(r.servings).toBe('4 servings');
    expect(r.source).toBe('Chef Test');
    expect(r.source_url).toBe('https://example.com/carbonara');
    expect(r.source_provider).toBe('recipesage');
  });

  it('handles single object (not array)', () => {
    const json = JSON.stringify({
      '@type': 'Recipe',
      name: 'Single Recipe'
    });

    const recipes = parseRecipes(json);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe('Single Recipe');
  });

  it('filters out non-Recipe types', () => {
    const json = JSON.stringify([
      { '@type': 'Recipe', name: 'Valid Recipe' },
      { '@type': 'Person', name: 'Not A Recipe' }
    ]);

    const recipes = parseRecipes(json);
    expect(recipes).toHaveLength(1);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseRecipes('not json')).toEqual([]);
  });

  it('extracts aggregate rating', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Rated Recipe',
      aggregateRating: { ratingValue: 4.5, bestRating: 5 }
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].rating).toBe(5); // 4.5/5 * 5 = 4.5 -> rounded to 5
  });

  it('extracts rating on non-5 scale', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Rated Recipe',
      aggregateRating: { ratingValue: 7, bestRating: 10 }
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].rating).toBe(4); // 7/10 * 5 = 3.5 -> rounded to 4
  });

  it('extracts string instructions', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Recipe',
      recipeInstructions: 'Just cook it all together.'
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].directions).toBe('Just cook it all together.');
  });

  it('extracts string-based categories (comma-separated)', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Recipe',
      recipeCategory: 'Italian, Dinner, Quick'
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].categories).toEqual(['Italian', 'Dinner', 'Quick']);
  });

  it('extracts image URL string', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Recipe',
      image: 'https://example.com/photo.jpg'
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].image_url).toBe('https://example.com/photo.jpg');
  });

  it('extracts image from object with url', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Recipe',
      image: { url: 'https://example.com/photo.jpg' }
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].image_url).toBe('https://example.com/photo.jpg');
  });

  it('rejects base64 image', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Recipe',
      image: 'data:image/png;base64,iVBOR...'
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].image_url).toBeNull();
  });

  it('handles array recipeYield', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Recipe',
      recipeYield: ['4 servings', '4']
    }]);

    const recipes = parseRecipes(json);
    expect(recipes[0].servings).toBe('4 servings');
  });

  it('generates deterministic content hash', () => {
    const json = JSON.stringify([{
      '@type': 'Recipe',
      name: 'Same Recipe',
      recipeIngredient: ['Same Ingredient']
    }]);

    const r1 = parseRecipes(json);
    const r2 = parseRecipes(json);
    expect(r1[0].source_hash).toBe(r2[0].source_hash);
  });
});
