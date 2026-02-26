/**
 * @fileoverview Unit tests for CSV recipe import adapter.
 * @module tests/unit/services/recipe/csvAdapter.test
 */

import { describe, it, expect } from 'vitest';
import { parseRecipes } from '../../../../src/services/recipe/adapters/csvAdapter.js';

describe('CSV Adapter', () => {
  it('parses basic CSV with commas', () => {
    const csv = [
      'name,ingredients,categories,rating',
      'Pasta,Eggs,Italian,4',
      'Soup,Water,Comfort,3'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].name).toBe('Pasta');
    expect(recipes[0].ingredients).toBe('Eggs');
    expect(recipes[0].categories).toEqual(['Italian']);
    expect(recipes[0].rating).toBe(4);
    expect(recipes[0].source_provider).toBe('csv');
  });

  it('auto-detects semicolon delimiter', () => {
    const csv = [
      'name;ingredients;rating',
      'Pasta;Eggs;5'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe('Pasta');
  });

  it('auto-detects tab delimiter', () => {
    const csv = [
      'name\tingredients\trating',
      'Pasta\tEggs\t5'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe('Pasta');
  });

  it('handles quoted fields with commas', () => {
    const csv = [
      'name,ingredients,categories',
      '"Pasta Carbonara","Eggs, Bacon, Cheese","Italian, Quick"'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].name).toBe('Pasta Carbonara');
    expect(recipes[0].ingredients).toBe('Eggs, Bacon, Cheese');
    expect(recipes[0].categories).toEqual(['Italian', 'Quick']);
  });

  it('handles escaped quotes in fields', () => {
    const csv = [
      'name,notes',
      '"Pasta","Use ""fresh"" eggs"'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes[0].notes).toBe('Use "fresh" eggs');
  });

  it('recognises alternative header names', () => {
    const csv = [
      'recipe_name,ingredient_list,tags,score,cooking_time,serves,url,description,method',
      'Pasta,Eggs,Italian,4,30 min,4,https://x.com,Great,Cook it'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes[0].name).toBe('Pasta');
    expect(recipes[0].ingredients).toBe('Eggs');
    expect(recipes[0].categories).toEqual(['Italian']);
    expect(recipes[0].rating).toBe(4);
    expect(recipes[0].cook_time).toBe('30 min');
    expect(recipes[0].servings).toBe('4');
    expect(recipes[0].source_url).toBe('https://x.com');
    expect(recipes[0].notes).toBe('Great');
    expect(recipes[0].directions).toBe('Cook it');
  });

  it('returns empty for empty input', () => {
    expect(parseRecipes('')).toEqual([]);
    expect(parseRecipes(null)).toEqual([]);
  });

  it('returns empty for header-only CSV', () => {
    expect(parseRecipes('name,ingredients')).toEqual([]);
  });

  it('returns empty if no name column found', () => {
    const csv = 'foo,bar\n1,2';
    expect(parseRecipes(csv)).toEqual([]);
  });

  it('skips rows with empty name', () => {
    const csv = [
      'name,rating',
      'Pasta,4',
      ',3',
      'Soup,5'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].name).toBe('Pasta');
    expect(recipes[1].name).toBe('Soup');
  });

  it('parses multi-value categories with pipe delimiter', () => {
    const csv = [
      'name,categories',
      'Pasta,Italian|Quick|Easy'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes[0].categories).toEqual(['Italian', 'Quick', 'Easy']);
  });

  it('assigns sequential source_recipe_id', () => {
    const csv = [
      'name',
      'First',
      'Second'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes[0].source_recipe_id).toBe('csv-1');
    expect(recipes[1].source_recipe_id).toBe('csv-2');
  });

  it('clamps out-of-range ratings', () => {
    const csv = [
      'name,rating',
      'Low,-5',
      'High,100',
      'NaN,abc'
    ].join('\n');

    const recipes = parseRecipes(csv);
    expect(recipes[0].rating).toBe(0);
    expect(recipes[1].rating).toBe(5);
    expect(recipes[2].rating).toBe(0);
  });
});
