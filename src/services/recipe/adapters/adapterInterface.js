/**
 * @fileoverview RecipeInput typedef and validation for source-agnostic import.
 * All adapters normalise to this shape before storage.
 * @module services/recipe/adapters/adapterInterface
 */

/**
 * @typedef {Object} RecipeInput
 * @property {string} name - Recipe name (required)
 * @property {string} [ingredients] - Newline-delimited ingredient list
 * @property {string} [directions] - Cooking directions
 * @property {string[]} [categories] - Category strings
 * @property {number} [rating] - 0-5 (0 = unrated)
 * @property {string} [cook_time] - e.g. "30 min"
 * @property {string} [prep_time] - e.g. "15 min"
 * @property {string} [total_time] - e.g. "45 min"
 * @property {string} [servings] - e.g. "4"
 * @property {string} [source] - Source name / attribution
 * @property {string} [source_url] - Original recipe URL
 * @property {string} [notes] - User notes
 * @property {string} [image_url] - External image URL (no base64)
 * @property {string} source_provider - 'paprika'|'mealie'|'recipesage'|'url'|'csv'|'manual'
 * @property {string} [source_recipe_id] - Provider-specific unique ID for dedup
 * @property {string} [source_hash] - Content hash for differential sync
 */

/**
 * Validate a RecipeInput object. Returns errors array (empty = valid).
 * @param {RecipeInput} input - Recipe input to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateRecipeInput(input) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return ['Input must be an object'];
  }

  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
    errors.push('name is required and must be a non-empty string');
  }

  if (!input.source_provider || typeof input.source_provider !== 'string') {
    errors.push('source_provider is required');
  }

  if (input.rating !== undefined && input.rating !== null) {
    const r = Number(input.rating);
    if (Number.isNaN(r) || r < 0 || r > 5) {
      errors.push('rating must be between 0 and 5');
    }
  }

  if (input.categories !== undefined && !Array.isArray(input.categories)) {
    errors.push('categories must be an array of strings');
  }

  return errors;
}
