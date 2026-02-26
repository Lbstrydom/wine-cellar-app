/**
 * @fileoverview CSV recipe import adapter.
 * Expects headers: name, ingredients, categories, rating, cook_time, prep_time, servings, source_url, notes
 * @module services/recipe/adapters/csvAdapter
 */

/**
 * Parse CSV text into RecipeInput array.
 * Auto-detects delimiter (comma, semicolon, tab).
 * @param {string} csvText - CSV file content
 * @returns {import('./adapterInterface.js').RecipeInput[]}
 */
export function parseRecipes(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return []; // Need at least header + 1 row

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.toLowerCase().trim());

  // Map header names to our field names
  const nameCol = findColumn(headers, ['name', 'recipe_name', 'title', 'recipe']);
  if (nameCol === -1) return []; // Name column is required

  const ingredientsCol = findColumn(headers, ['ingredients', 'ingredient_list', 'ingredient']);
  const categoriesCol = findColumn(headers, ['categories', 'category', 'tags', 'type']);
  const ratingCol = findColumn(headers, ['rating', 'score', 'stars']);
  const cookTimeCol = findColumn(headers, ['cook_time', 'cooking_time', 'cook']);
  const prepTimeCol = findColumn(headers, ['prep_time', 'preparation_time', 'prep']);
  const servingsCol = findColumn(headers, ['servings', 'serves', 'portions']);
  const sourceUrlCol = findColumn(headers, ['source_url', 'url', 'link', 'source']);
  const notesCol = findColumn(headers, ['notes', 'note', 'description']);
  const directionsCol = findColumn(headers, ['directions', 'instructions', 'steps', 'method']);

  const recipes = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], delimiter);
    const name = cols[nameCol]?.trim();
    if (!name) continue;

    recipes.push({
      name,
      ingredients: cols[ingredientsCol]?.trim() || null,
      directions: cols[directionsCol]?.trim() || null,
      categories: parseCategories(cols[categoriesCol]),
      rating: parseRating(cols[ratingCol]),
      cook_time: cols[cookTimeCol]?.trim() || null,
      prep_time: cols[prepTimeCol]?.trim() || null,
      total_time: null,
      servings: cols[servingsCol]?.trim() || null,
      source_url: cols[sourceUrlCol]?.trim() || null,
      notes: cols[notesCol]?.trim() || null,
      source_provider: 'csv',
      source_recipe_id: `csv-${i}`,
      image_url: null
    });
  }

  return recipes;
}

/**
 * Detect CSV delimiter from header line.
 * @param {string} line - First line
 * @returns {string}
 */
function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const char of line) {
    if (counts[char] !== undefined) counts[char]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Parse a single CSV line respecting quoted fields.
 * @param {string} line - CSV line
 * @param {string} delimiter - Field delimiter
 * @returns {string[]}
 */
function parseCSVLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Find column index by checking multiple possible header names.
 * @param {string[]} headers - Lowercase headers
 * @param {string[]} candidates - Possible column names
 * @returns {number} Column index or -1
 */
function findColumn(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse categories from a CSV field.
 * @param {string|undefined} value - Raw value
 * @returns {string[]}
 */
function parseCategories(value) {
  if (!value) return [];
  return value.split(/[,;|]/).map(c => c.trim()).filter(Boolean);
}

/**
 * Parse rating from CSV field.
 * @param {string|undefined} value - Raw value
 * @returns {number}
 */
function parseRating(value) {
  if (!value) return 0;
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}
