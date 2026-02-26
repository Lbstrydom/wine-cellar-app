/**
 * @fileoverview Recipe normaliser: validates RecipeInput, extracts signals, applies category boost.
 * @module services/recipe/recipeNormaliser
 */

import { validateRecipeInput } from './adapters/adapterInterface.js';
import { getCategorySignalBoosts } from './categorySignalMap.js';

/**
 * Normalise and validate a RecipeInput.
 * - Validates required fields
 * - Trims strings
 * - Normalises rating to 0-5 integer
 * - Ensures categories is an array
 * @param {import('./adapters/adapterInterface.js').RecipeInput} input - Raw recipe input
 * @returns {{recipe: import('./adapters/adapterInterface.js').RecipeInput|null, errors: string[]}}
 */
export function normaliseRecipe(input) {
  const errors = validateRecipeInput(input);
  if (errors.length > 0) {
    return { recipe: null, errors };
  }

  const recipe = {
    ...input,
    name: input.name.trim(),
    ingredients: input.ingredients?.trim() || null,
    directions: input.directions?.trim() || null,
    categories: normaliseCategories(input.categories),
    rating: normaliseRating(input.rating),
    cook_time: input.cook_time?.trim() || null,
    prep_time: input.prep_time?.trim() || null,
    total_time: input.total_time?.trim() || null,
    servings: input.servings?.trim() || null,
    source: input.source?.trim() || null,
    source_url: input.source_url?.trim() || null,
    notes: input.notes?.trim() || null,
    image_url: input.image_url?.trim() || null,
    source_provider: input.source_provider || 'manual',
    source_recipe_id: input.source_recipe_id || null,
    source_hash: input.source_hash || null
  };

  return { recipe, errors: [] };
}

/**
 * Normalise and validate a batch of RecipeInputs.
 * Returns valid recipes and collects errors.
 * @param {import('./adapterInterface.js').RecipeInput[]} inputs - Raw inputs
 * @returns {{recipes: import('./adapterInterface.js').RecipeInput[], errors: Array<{index: number, errors: string[]}>}}
 */
export function normaliseRecipeBatch(inputs) {
  const recipes = [];
  const batchErrors = [];

  for (let i = 0; i < inputs.length; i++) {
    const { recipe, errors } = normaliseRecipe(inputs[i]);
    if (recipe) {
      recipes.push(recipe);
    } else {
      batchErrors.push({ index: i, errors });
    }
  }

  return { recipes, errors: batchErrors };
}

/**
 * Extract food signal boosts from a recipe (for profile computation).
 * Combines primary text-based signals with category boost.
 * @param {import('./adapterInterface.js').RecipeInput} recipe - Normalised recipe
 * @returns {Object.<string, number>} Signal -> weight map
 */
export function extractRecipeSignals(recipe) {
  // Category-based boost at 0.5x weight
  const categoryBoosts = getCategorySignalBoosts(recipe.categories || []);

  // Scale category boosts by 0.5
  const signals = {};
  for (const [signal, weight] of Object.entries(categoryBoosts)) {
    signals[signal] = weight * 0.5;
  }

  return signals;
}

/**
 * Normalise categories to a clean string array.
 * @param {*} categories - Raw categories (string, array, or undefined)
 * @returns {string[]}
 */
function normaliseCategories(categories) {
  if (!categories) return [];
  if (typeof categories === 'string') {
    return categories.split(/[,\n]/).map(c => c.trim()).filter(Boolean);
  }
  if (Array.isArray(categories)) {
    return categories.map(c => String(c).trim()).filter(Boolean);
  }
  return [];
}

/**
 * Normalise rating to integer 0-5.
 * @param {*} rating - Raw rating
 * @returns {number}
 */
function normaliseRating(rating) {
  if (rating === null || rating === undefined) return 0;
  const n = Number(rating);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}
