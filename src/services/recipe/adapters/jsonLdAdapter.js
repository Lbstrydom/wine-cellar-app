/**
 * @fileoverview URL scraper that extracts schema.org Recipe JSON-LD from web pages.
 * @module services/recipe/adapters/jsonLdAdapter
 */

import { createHash } from 'node:crypto';

/**
 * Scrape a URL and extract the schema.org Recipe markup.
 * @param {string} url - Recipe page URL
 * @returns {Promise<import('./adapterInterface.js').RecipeInput|null>}
 */
export async function parseRecipeFromUrl(url) {
  const html = await fetchPage(url);
  if (!html) return null;

  const jsonLd = extractJsonLd(html);
  if (!jsonLd) return null;

  return mapToRecipeInput(jsonLd, url);
}

/**
 * Fetch a web page as HTML text.
 * @param {string} url - URL to fetch
 * @returns {Promise<string|null>}
 */
async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WineCellarApp/1.0)',
        'Accept': 'text/html'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Extract JSON-LD Recipe object from HTML.
 * @param {string} html - HTML content
 * @returns {Object|null}
 */
function extractJsonLd(html) {
  // Find all <script type="application/ld+json"> blocks
  const pattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const recipe = findRecipeInLd(data);
      if (recipe) return recipe;
    } catch {
      // Skip malformed JSON-LD blocks
    }
  }

  return null;
}

/**
 * Find a Recipe object in a JSON-LD structure (may be nested in @graph).
 * @param {*} data - Parsed JSON-LD
 * @returns {Object|null}
 */
function findRecipeInLd(data) {
  if (!data) return null;

  // Direct Recipe object
  if (isRecipeType(data)) return data;

  // Array of objects
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
    return null;
  }

  // @graph container
  if (data['@graph'] && Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      if (isRecipeType(item)) return item;
    }
  }

  return null;
}

/**
 * Check if an object is a schema.org Recipe.
 * @param {*} obj - Object to check
 * @returns {boolean}
 */
function isRecipeType(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const type = obj['@type'];
  if (type === 'Recipe') return true;
  if (Array.isArray(type) && type.includes('Recipe')) return true;
  return false;
}

/**
 * Map extracted JSON-LD to RecipeInput.
 * @param {Object} ld - JSON-LD Recipe object
 * @param {string} sourceUrl - Original URL
 * @returns {import('./adapterInterface.js').RecipeInput}
 */
function mapToRecipeInput(ld, sourceUrl) {
  const name = ld.name;
  if (!name) return null;

  const ingredients = Array.isArray(ld.recipeIngredient)
    ? ld.recipeIngredient.join('\n')
    : ld.recipeIngredient || null;

  const directions = extractDirections(ld.recipeInstructions);

  const hashContent = `${name}|${ingredients || ''}`;
  const sourceHash = createHash('sha256').update(hashContent).digest('hex').slice(0, 16);

  return {
    name,
    ingredients,
    directions,
    categories: extractCategories(ld),
    rating: 0,
    cook_time: parseDuration(ld.cookTime),
    prep_time: parseDuration(ld.prepTime),
    total_time: parseDuration(ld.totalTime),
    servings: extractServings(ld),
    source: ld.author?.name || null,
    source_url: sourceUrl,
    notes: ld.description || null,
    image_url: extractImage(ld),
    source_provider: 'url',
    source_recipe_id: sourceUrl,
    source_hash: sourceHash
  };
}

/**
 * Extract directions from recipeInstructions.
 * @param {*} instructions - JSON-LD instructions
 * @returns {string|null}
 */
function extractDirections(instructions) {
  if (!instructions) return null;
  if (typeof instructions === 'string') return instructions;
  if (Array.isArray(instructions)) {
    return instructions
      .map(s => {
        if (typeof s === 'string') return s;
        if (s.text) return s.text;
        if (s.itemListElement) {
          return s.itemListElement.map(e => e.text || e.name || '').filter(Boolean).join('\n');
        }
        return s.name || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return null;
}

/**
 * Extract categories.
 * @param {Object} ld - JSON-LD Recipe
 * @returns {string[]}
 */
function extractCategories(ld) {
  const sources = [ld.recipeCategory, ld.keywords, ld.recipeCuisine];
  const cats = new Set();

  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src)) {
      src.forEach(c => { if (c) cats.add(String(c).trim()); });
    } else if (typeof src === 'string') {
      src.split(/[,;]/).forEach(c => { const t = c.trim(); if (t) cats.add(t); });
    }
  }

  return [...cats];
}

/**
 * Parse ISO 8601 duration to human-readable string.
 * @param {string|null} duration - e.g. "PT30M", "PT1H15M"
 * @returns {string|null}
 */
function parseDuration(duration) {
  if (!duration || typeof duration !== 'string') return null;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return duration; // Return as-is if not ISO format

  const parts = [];
  if (match[1]) parts.push(`${match[1]}h`);
  if (match[2]) parts.push(`${match[2]}m`);
  if (match[3] && !match[1] && !match[2]) parts.push(`${match[3]}s`);

  return parts.join(' ') || null;
}

/**
 * Extract servings.
 * @param {Object} ld - JSON-LD Recipe
 * @returns {string|null}
 */
function extractServings(ld) {
  const yield_ = ld.recipeYield;
  if (!yield_) return null;
  if (Array.isArray(yield_)) return yield_[0]?.toString() || null;
  return String(yield_);
}

/**
 * Extract image URL.
 * @param {Object} ld - JSON-LD Recipe
 * @returns {string|null}
 */
function extractImage(ld) {
  const img = ld.image;
  if (!img) return null;
  if (typeof img === 'string') return img.startsWith('http') ? img : null;
  if (Array.isArray(img)) {
    const url = img.find(i => typeof i === 'string' && i.startsWith('http'));
    return url || img[0]?.url || null;
  }
  return img.url || null;
}
