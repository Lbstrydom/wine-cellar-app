/**
 * @fileoverview Paprika .paprikarecipes file adapter.
 * Parses the ZIP archive containing gzipped JSON recipe files.
 * @module services/recipe/adapters/paprikaAdapter
 */

import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { gunzipSync } from 'node:zlib';

/**
 * Parse a .paprikarecipes file (ZIP of gzipped JSON recipes).
 * Strips photo_data to avoid storing base64 images.
 * @param {Buffer} fileBuffer - File content as Buffer
 * @returns {import('./adapterInterface.js').RecipeInput[]}
 */
export function parseRecipes(fileBuffer) {
  const zip = new AdmZip(fileBuffer);
  const entries = zip.getEntries();
  const recipes = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    try {
      const decompressed = gunzipSync(entry.getData());
      const raw = JSON.parse(decompressed.toString('utf8'));
      const recipe = mapPaprikaRecipe(raw);
      if (recipe) recipes.push(recipe);
    } catch {
      // Skip entries that can't be decompressed/parsed
    }
  }

  return recipes;
}

/**
 * Map a raw Paprika recipe JSON to RecipeInput.
 * @param {Object} raw - Raw Paprika recipe object
 * @returns {import('./adapterInterface.js').RecipeInput|null}
 */
function mapPaprikaRecipe(raw) {
  if (!raw.name) return null;

  // Build content hash from name + ingredients for diff sync
  const hashContent = `${raw.name}|${raw.ingredients || ''}|${raw.directions || ''}`;
  const sourceHash = createHash('sha256').update(hashContent).digest('hex').slice(0, 16);

  return {
    name: raw.name,
    ingredients: raw.ingredients || null,
    directions: raw.directions || null,
    categories: parsePaprikaCategories(raw.categories),
    rating: parsePaprikaRating(raw.rating),
    cook_time: raw.cook_time || null,
    prep_time: raw.prep_time || null,
    total_time: raw.total_time || null,
    servings: raw.servings || null,
    source: raw.source || null,
    source_url: raw.source_url || null,
    notes: raw.notes || null,
    image_url: raw.image_url || null,
    // Strip photo_data entirely — no base64 storage
    source_provider: 'paprika',
    source_recipe_id: raw.uid || null,
    source_hash: sourceHash
  };
}

/**
 * Parse Paprika categories field.
 * Paprika stores categories as newline-delimited strings.
 * @param {string|string[]} categories - Raw categories
 * @returns {string[]}
 */
function parsePaprikaCategories(categories) {
  if (!categories) return [];
  if (Array.isArray(categories)) return categories.filter(Boolean);
  // Paprika uses newline or comma separation
  return categories.split(/[\n,]/).map(c => c.trim()).filter(Boolean);
}

/**
 * Parse Paprika rating to 0-5 integer.
 * Paprika uses 0-5 scale already, but may send as string.
 * @param {number|string|null} rating - Raw rating
 * @returns {number}
 */
function parsePaprikaRating(rating) {
  if (rating === null || rating === undefined || rating === '') return 0;
  const n = Number(rating);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}
