/**
 * @fileoverview RecipeSage JSON-LD export file adapter.
 * RecipeSage exports a JSON-LD array of schema.org Recipe objects.
 * @module services/recipe/adapters/recipeSageAdapter
 */

import { createHash } from 'node:crypto';

/**
 * Parse a RecipeSage JSON-LD export string.
 * @param {string} jsonText - JSON file content
 * @returns {import('./adapterInterface.js').RecipeInput[]}
 */
export function parseRecipes(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }

  // RecipeSage exports an array of JSON-LD Recipe objects
  const items = Array.isArray(data) ? data : [data];
  const recipes = [];

  for (const item of items) {
    const recipe = mapJsonLdRecipe(item);
    if (recipe) recipes.push(recipe);
  }

  return recipes;
}

/**
 * Map a JSON-LD Recipe object to RecipeInput.
 * @param {Object} item - JSON-LD object
 * @returns {import('./adapterInterface.js').RecipeInput|null}
 */
function mapJsonLdRecipe(item) {
  // Filter to Recipe type
  const type = item['@type'] || item.type;
  if (type && type !== 'Recipe' && !type.includes?.('Recipe')) return null;

  const name = item.name;
  if (!name) return null;

  const ingredients = extractIngredients(item);
  const directions = extractDirections(item);

  const hashContent = `${name}|${ingredients || ''}`;
  const sourceHash = createHash('sha256').update(hashContent).digest('hex').slice(0, 16);

  return {
    name,
    ingredients,
    directions,
    categories: extractCategories(item),
    rating: extractRating(item),
    cook_time: item.cookTime || null,
    prep_time: item.prepTime || null,
    total_time: item.totalTime || null,
    servings: extractServings(item),
    source: item.author?.name || item.publisher?.name || null,
    source_url: item.url || item['@id'] || null,
    notes: item.description || null,
    image_url: extractImage(item),
    source_provider: 'recipesage',
    source_recipe_id: item['@id'] || item.identifier || item.url || null,
    source_hash: sourceHash
  };
}

/**
 * Extract ingredients to newline-delimited string.
 * @param {Object} item - JSON-LD Recipe
 * @returns {string|null}
 */
function extractIngredients(item) {
  const ingredients = item.recipeIngredient || item.ingredients;
  if (!ingredients) return null;
  if (Array.isArray(ingredients)) return ingredients.join('\n');
  return String(ingredients);
}

/**
 * Extract directions to newline-delimited string.
 * @param {Object} item - JSON-LD Recipe
 * @returns {string|null}
 */
function extractDirections(item) {
  const steps = item.recipeInstructions || item.instructions;
  if (!steps) return null;
  if (typeof steps === 'string') return steps;
  if (Array.isArray(steps)) {
    return steps.map(s => typeof s === 'string' ? s : s.text || s.name || '').filter(Boolean).join('\n');
  }
  return null;
}

/**
 * Extract categories from JSON-LD.
 * @param {Object} item - JSON-LD Recipe
 * @returns {string[]}
 */
function extractCategories(item) {
  const cats = item.recipeCategory || item.keywords;
  if (!cats) return [];
  if (Array.isArray(cats)) return cats.map(c => String(c).trim()).filter(Boolean);
  if (typeof cats === 'string') return cats.split(/[,;]/).map(c => c.trim()).filter(Boolean);
  return [];
}

/**
 * Extract rating from JSON-LD aggregateRating.
 * @param {Object} item - JSON-LD Recipe
 * @returns {number}
 */
function extractRating(item) {
  const agg = item.aggregateRating;
  if (!agg) return 0;
  const val = Number(agg.ratingValue);
  if (Number.isNaN(val)) return 0;
  // Normalise to 0-5 scale
  const scale = Number(agg.bestRating) || 5;
  return Math.round((val / scale) * 5);
}

/**
 * Extract servings string.
 * @param {Object} item - JSON-LD Recipe
 * @returns {string|null}
 */
function extractServings(item) {
  const yield_ = item.recipeYield || item.yield;
  if (!yield_) return null;
  if (Array.isArray(yield_)) return yield_[0]?.toString() || null;
  return String(yield_);
}

/**
 * Extract image URL (no base64).
 * @param {Object} item - JSON-LD Recipe
 * @returns {string|null}
 */
function extractImage(item) {
  const img = item.image;
  if (!img) return null;
  if (typeof img === 'string') {
    return img.startsWith('http') ? img : null;
  }
  if (Array.isArray(img)) {
    const url = img.find(i => typeof i === 'string' && i.startsWith('http'));
    return url || img[0]?.url || null;
  }
  return img.url || null;
}
