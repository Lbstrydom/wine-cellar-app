/**
 * @fileoverview Recipe CRUD operations and import orchestration.
 * @module services/recipe/recipeService
 */

import db from '../../db/index.js';
import logger from '../../utils/logger.js';

let tablesInitialized = false;

/**
 * Ensure recipe tables exist. Uses CREATE TABLE IF NOT EXISTS for idempotency.
 */
export async function ensureRecipeTables() {
  if (tablesInitialized) return;

  try {
    const tableCheck = await db.prepare(`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'recipes'
    `).get().catch(() => null);

    if (!tableCheck) {
      logger.info('Recipes', 'Creating recipe tables...');

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS recipes (
          id SERIAL PRIMARY KEY,
          cellar_id UUID NOT NULL,
          source_provider TEXT NOT NULL DEFAULT 'manual',
          source_recipe_id TEXT,
          name TEXT NOT NULL,
          ingredients TEXT,
          directions TEXT,
          categories TEXT DEFAULT '[]',
          rating INTEGER DEFAULT 0,
          cook_time TEXT,
          prep_time TEXT,
          total_time TEXT,
          servings TEXT,
          source TEXT,
          source_url TEXT,
          notes TEXT,
          image_url TEXT,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(cellar_id, source_provider, source_recipe_id)
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS recipe_sync_state (
          id SERIAL PRIMARY KEY,
          cellar_id UUID NOT NULL,
          source_provider TEXT NOT NULL,
          source_recipe_id TEXT NOT NULL,
          source_hash TEXT,
          last_seen_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(cellar_id, source_provider, source_recipe_id)
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS recipe_sync_log (
          id SERIAL PRIMARY KEY,
          cellar_id UUID NOT NULL,
          source_provider TEXT NOT NULL,
          started_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          status TEXT DEFAULT 'running',
          added INTEGER DEFAULT 0,
          updated INTEGER DEFAULT 0,
          deleted INTEGER DEFAULT 0,
          unchanged INTEGER DEFAULT 0,
          error_message TEXT
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS cooking_profiles (
          id SERIAL PRIMARY KEY,
          cellar_id UUID NOT NULL UNIQUE,
          profile_data JSONB NOT NULL,
          generated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `).run();

      // Index for listing and filtering
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_recipes_cellar_active
        ON recipes (cellar_id, deleted_at)
      `).run();

      logger.info('Recipes', 'Recipe tables created');
    }

    // Ensure cooking_profiles table exists even if recipes table was already present
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS cooking_profiles (
        id SERIAL PRIMARY KEY,
        cellar_id UUID NOT NULL UNIQUE,
        profile_data JSONB NOT NULL,
        generated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).run().catch(() => { /* already exists */ });

    tablesInitialized = true;
  } catch (err) {
    logger.error('Recipes', `Failed to create tables: ${err.message}`);
    throw err;
  }
}

/**
 * Import recipes from a normalised RecipeInput array.
 * Upserts on (cellar_id, source_provider, source_recipe_id).
 * Skips recipes that the user previously soft-deleted (deleted_at IS NOT NULL).
 * @param {import('./adapters/adapterInterface.js').RecipeInput[]} inputs - Normalised recipes
 * @param {string} cellarId - Cellar ID
 * @returns {Promise<{added: number, updated: number, skipped: number}>}
 */
export async function importRecipes(inputs, cellarId) {
  await ensureRecipeTables();

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const recipe of inputs) {
    if (!recipe.name) {
      skipped++;
      continue;
    }

    const categories = JSON.stringify(recipe.categories || []);
    const sourceRecipeId = recipe.source_recipe_id || null;
    const sourceProvider = recipe.source_provider || 'manual';

    // Check if recipe was previously soft-deleted by user
    if (sourceRecipeId) {
      const existing = await db.prepare(`
        SELECT id, deleted_at FROM recipes
        WHERE cellar_id = $1 AND source_provider = $2 AND source_recipe_id = $3
      `).get(cellarId, sourceProvider, sourceRecipeId);

      if (existing?.deleted_at) {
        skipped++;
        continue;
      }
    }

    const result = await db.prepare(`
      INSERT INTO recipes (
        cellar_id, source_provider, source_recipe_id, name, ingredients, directions,
        categories, rating, cook_time, prep_time, total_time, servings,
        source, source_url, notes, image_url, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      ON CONFLICT (cellar_id, source_provider, source_recipe_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        ingredients = EXCLUDED.ingredients,
        directions = EXCLUDED.directions,
        categories = EXCLUDED.categories,
        rating = EXCLUDED.rating,
        cook_time = EXCLUDED.cook_time,
        prep_time = EXCLUDED.prep_time,
        total_time = EXCLUDED.total_time,
        servings = EXCLUDED.servings,
        source = EXCLUDED.source,
        source_url = EXCLUDED.source_url,
        notes = EXCLUDED.notes,
        image_url = EXCLUDED.image_url,
        updated_at = NOW()
      WHERE recipes.deleted_at IS NULL
    `).run(
      cellarId, sourceProvider, sourceRecipeId,
      recipe.name, recipe.ingredients || null, recipe.directions || null,
      categories, recipe.rating || 0,
      recipe.cook_time || null, recipe.prep_time || null, recipe.total_time || null,
      recipe.servings || null, recipe.source || null, recipe.source_url || null,
      recipe.notes || null, recipe.image_url || null
    );

    if (result.changes > 0) {
      // ON CONFLICT with DO UPDATE always reports changes=1
      // We check if the row existed before to distinguish add vs update
      if (sourceRecipeId) {
        const check = await db.prepare(`
          SELECT created_at, updated_at FROM recipes
          WHERE cellar_id = $1 AND source_provider = $2 AND source_recipe_id = $3
        `).get(cellarId, sourceProvider, sourceRecipeId);
        // If created_at and updated_at are very close, it's a new insert
        if (check && Math.abs(new Date(check.created_at) - new Date(check.updated_at)) < 1000) {
          added++;
        } else {
          updated++;
        }
      } else {
        added++;
      }
    } else {
      skipped++;
    }
  }

  return { added, updated, skipped };
}

/**
 * List recipes for a cellar with optional filters.
 * @param {string} cellarId - Cellar ID
 * @param {Object} [options] - Filter/pagination options
 * @param {string} [options.search] - Name search (ILIKE)
 * @param {string} [options.category] - Category filter
 * @param {number} [options.rating] - Minimum rating
 * @param {string} [options.source_provider] - Source filter
 * @param {number} [options.limit] - Page size (default 50)
 * @param {number} [options.offset] - Offset (default 0)
 * @returns {Promise<{data: Object[], total: number}>}
 */
export async function listRecipes(cellarId, options = {}) {
  await ensureRecipeTables();

  const { search, category, rating, source_provider, limit = 50, offset = 0 } = options;

  let where = 'WHERE r.cellar_id = $1 AND r.deleted_at IS NULL';
  const params = [cellarId];
  let paramIdx = 2;

  if (search) {
    where += ` AND r.name ILIKE $${paramIdx}`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  if (category) {
    where += ` AND r.categories::text ILIKE $${paramIdx}`;
    params.push(`%${category}%`);
    paramIdx++;
  }

  if (rating) {
    where += ` AND r.rating >= $${paramIdx}`;
    params.push(rating);
    paramIdx++;
  }

  if (source_provider) {
    where += ` AND r.source_provider = $${paramIdx}`;
    params.push(source_provider);
    paramIdx++;
  }

  const countSql = 'SELECT COUNT(*) as total FROM recipes r ' + where;
  const countResult = await db.prepare(countSql).get(...params);
  const total = countResult?.total || 0;

  const listSql = 'SELECT r.* FROM recipes r ' + where +
    ' ORDER BY r.name ASC' +
    ' LIMIT $' + paramIdx + ' OFFSET $' + (paramIdx + 1);
  const data = await db.prepare(listSql).all(...params, limit, offset);

  return { data, total };
}

/**
 * Get a single recipe by ID (cellar-scoped).
 * @param {string} cellarId - Cellar ID
 * @param {number} recipeId - Recipe ID
 * @returns {Promise<Object|null>}
 */
export async function getRecipe(cellarId, recipeId) {
  await ensureRecipeTables();

  return db.prepare(`
    SELECT * FROM recipes WHERE id = $1 AND cellar_id = $2 AND deleted_at IS NULL
  `).get(recipeId, cellarId);
}

/**
 * Create a recipe manually.
 * @param {string} cellarId - Cellar ID
 * @param {Object} data - Recipe data
 * @returns {Promise<{id: number}>}
 */
export async function createRecipe(cellarId, data) {
  await ensureRecipeTables();

  const categories = JSON.stringify(data.categories || []);
  const result = await db.prepare(`
    INSERT INTO recipes (cellar_id, source_provider, name, ingredients, directions,
      categories, rating, cook_time, prep_time, total_time, servings,
      source, source_url, notes, image_url)
    VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id
  `).get(
    cellarId, data.name, data.ingredients || null, data.directions || null,
    categories, data.rating || 0,
    data.cook_time || null, data.prep_time || null, data.total_time || null,
    data.servings || null, data.source || null, data.source_url || null,
    data.notes || null, data.image_url || null
  );

  return { id: result.id };
}

/**
 * Update a recipe (cellar-scoped).
 * Only updates fields that are explicitly present in data (including null to clear).
 * @param {string} cellarId - Cellar ID
 * @param {number} recipeId - Recipe ID
 * @param {Object} data - Fields to update
 * @returns {Promise<{changes: number}>}
 */
export async function updateRecipe(cellarId, recipeId, data) {
  await ensureRecipeTables();

  const setClauses = [];
  const params = [recipeId, cellarId];
  let idx = 3;

  const fields = {
    name: data.name,
    ingredients: data.ingredients,
    directions: data.directions,
    categories: data.categories !== undefined ? JSON.stringify(data.categories) : undefined,
    rating: data.rating,
    cook_time: data.cook_time,
    prep_time: data.prep_time,
    total_time: data.total_time,
    servings: data.servings,
    source: data.source,
    source_url: data.source_url,
    notes: data.notes,
    image_url: data.image_url,
  };

  for (const [col, val] of Object.entries(fields)) {
    if (val !== undefined) {
      setClauses.push(col + ' = $' + idx);
      params.push(val ?? null);
      idx++;
    }
  }

  if (setClauses.length === 0) {
    return { changes: 0 };
  }

  setClauses.push('updated_at = NOW()');

  const sql = 'UPDATE recipes SET ' + setClauses.join(', ') +
    ' WHERE id = $1 AND cellar_id = $2 AND deleted_at IS NULL';
  const result = await db.prepare(sql).run(...params);

  return { changes: result.changes };
}

/**
 * Soft-delete a recipe (cellar-scoped).
 * @param {string} cellarId - Cellar ID
 * @param {number} recipeId - Recipe ID
 * @returns {Promise<{changes: number}>}
 */
export async function deleteRecipe(cellarId, recipeId) {
  await ensureRecipeTables();

  const result = await db.prepare(`
    UPDATE recipes SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND cellar_id = $2 AND deleted_at IS NULL
  `).run(recipeId, cellarId);

  return { changes: result.changes };
}

/**
 * Get distinct categories with counts for a cellar.
 * @param {string} cellarId - Cellar ID
 * @returns {Promise<Array<{category: string, count: number}>>}
 */
export async function getRecipeCategories(cellarId) {
  await ensureRecipeTables();

  const recipes = await db.prepare(`
    SELECT categories FROM recipes
    WHERE cellar_id = $1 AND deleted_at IS NULL
  `).all(cellarId);

  const counts = {};
  for (const row of recipes) {
    try {
      const cats = JSON.parse(row.categories || '[]');
      for (const cat of cats) {
        const key = cat.trim();
        if (key) counts[key] = (counts[key] || 0) + 1;
      }
    } catch { /* skip malformed JSON */ }
  }

  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
