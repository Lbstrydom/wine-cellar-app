/**
 * @fileoverview Unit tests for Paprika adapter.
 * @module tests/unit/services/recipe/paprikaAdapter.test
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { parseRecipes } from '../../../../src/services/recipe/adapters/paprikaAdapter.js';

/**
 * Build a synthetic .paprikarecipes file (ZIP of gzipped JSON).
 * @param {Object[]} recipes - Recipe objects
 * @returns {Buffer}
 */
function buildPaprikaFile(recipes) {
  const zip = new AdmZip();
  for (let i = 0; i < recipes.length; i++) {
    const json = JSON.stringify(recipes[i]);
    const gzipped = gzipSync(Buffer.from(json, 'utf8'));
    zip.addFile(`recipe-${i}.paprikarecipe`, gzipped);
  }
  return zip.toBuffer();
}

describe('Paprika Adapter', () => {
  it('parses a single recipe from ZIP', () => {
    const buf = buildPaprikaFile([{
      name: 'Pasta Carbonara',
      ingredients: 'Eggs\nBacon',
      directions: 'Cook it',
      categories: 'Italian\nQuick',
      rating: 4,
      cook_time: '20 min',
      uid: 'abc-123'
    }]);

    const recipes = parseRecipes(buf);
    expect(recipes).toHaveLength(1);

    const r = recipes[0];
    expect(r.name).toBe('Pasta Carbonara');
    expect(r.ingredients).toBe('Eggs\nBacon');
    expect(r.categories).toEqual(['Italian', 'Quick']);
    expect(r.rating).toBe(4);
    expect(r.source_provider).toBe('paprika');
    expect(r.source_recipe_id).toBe('abc-123');
    expect(r.source_hash).toBeDefined();
    expect(r.source_hash).toHaveLength(16);
  });

  it('parses multiple recipes', () => {
    const buf = buildPaprikaFile([
      { name: 'Recipe 1', uid: '1' },
      { name: 'Recipe 2', uid: '2' },
      { name: 'Recipe 3', uid: '3' }
    ]);

    const recipes = parseRecipes(buf);
    expect(recipes).toHaveLength(3);
  });

  it('skips entries without name', () => {
    const buf = buildPaprikaFile([
      { name: 'Valid', uid: '1' },
      { ingredients: 'no name', uid: '2' }
    ]);

    const recipes = parseRecipes(buf);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe('Valid');
  });

  it('strips photo_data from output', () => {
    const buf = buildPaprikaFile([{
      name: 'Recipe',
      uid: '1',
      photo_data: 'base64encodedimage=='
    }]);

    const recipes = parseRecipes(buf);
    expect(recipes[0]).not.toHaveProperty('photo_data');
  });

  it('parses comma-separated categories', () => {
    const buf = buildPaprikaFile([{
      name: 'Recipe',
      uid: '1',
      categories: 'Italian, Asian, Quick'
    }]);

    const recipes = parseRecipes(buf);
    expect(recipes[0].categories).toEqual(['Italian', 'Asian', 'Quick']);
  });

  it('handles array categories', () => {
    const buf = buildPaprikaFile([{
      name: 'Recipe',
      uid: '1',
      categories: ['Italian', 'Quick']
    }]);

    const recipes = parseRecipes(buf);
    expect(recipes[0].categories).toEqual(['Italian', 'Quick']);
  });

  it('handles null optional fields gracefully', () => {
    const buf = buildPaprikaFile([{
      name: 'Minimal Recipe',
      uid: '1'
    }]);

    const recipes = parseRecipes(buf);
    const r = recipes[0];
    expect(r.ingredients).toBeNull();
    expect(r.directions).toBeNull();
    expect(r.categories).toEqual([]);
    expect(r.rating).toBe(0);
    expect(r.cook_time).toBeNull();
  });

  it('normalises string rating', () => {
    const buf = buildPaprikaFile([{
      name: 'Recipe',
      uid: '1',
      rating: '3'
    }]);

    const recipes = parseRecipes(buf);
    expect(recipes[0].rating).toBe(3);
  });

  it('generates deterministic content hash', () => {
    const buf = buildPaprikaFile([{
      name: 'Same Recipe',
      ingredients: 'Same Ingredients',
      directions: 'Same Directions',
      uid: '1'
    }]);

    const recipes1 = parseRecipes(buf);

    const buf2 = buildPaprikaFile([{
      name: 'Same Recipe',
      ingredients: 'Same Ingredients',
      directions: 'Same Directions',
      uid: '1'
    }]);

    const recipes2 = parseRecipes(buf2);
    expect(recipes1[0].source_hash).toBe(recipes2[0].source_hash);
  });

  it('skips corrupted entries without throwing', () => {
    const zip = new AdmZip();
    // Add a valid recipe
    zip.addFile('good.paprikarecipe', gzipSync(Buffer.from(JSON.stringify({ name: 'Good', uid: '1' }))));
    // Add a corrupted entry (not gzipped)
    zip.addFile('bad.paprikarecipe', Buffer.from('this is not gzipped'));

    const recipes = parseRecipes(zip.toBuffer());
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe('Good');
  });
});
