/**
 * @fileoverview Recipe import, CRUD, and pairing endpoints.
 * @module routes/recipes
 */

import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  recipeBodySchema, recipeUpdateSchema, recipeListQuerySchema,
  recipeIdSchema, urlImportSchema, syncProviderSchema, categoryOverridesSchema,
  menuPairSchema
} from '../schemas/recipe.js';
import db from '../db/index.js';
import * as recipeService from '../services/recipe/recipeService.js';
import { normaliseRecipeBatch } from '../services/recipe/recipeNormaliser.js';
import { getCategorySignalBoosts } from '../services/recipe/categorySignalMap.js';
import { parseRecipes as parsePaprika } from '../services/recipe/adapters/paprikaAdapter.js';
import logger from '../utils/logger.js';
import { extractSignals, generateShortlist } from '../services/pairing/pairingEngine.js';
import { invalidateProfile } from '../services/recipe/cookingProfile.js';
import { stringAgg } from '../db/helpers.js';

const router = Router();

// File upload: 20MB limit, accept common recipe file types
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/zip', 'application/x-zip-compressed',
      'application/json', 'text/csv', 'text/plain',
      'application/octet-stream' // .paprikarecipes
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(paprikarecipes|json|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  }
});

// ============================================
// Import Endpoints
// ============================================

/**
 * POST /recipes/import/paprika
 * Upload .paprikarecipes file.
 */
router.post('/import/paprika', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File is required. Upload a .paprikarecipes file.' });
  }

  logger.info('Recipes', `Paprika import started (${(req.file.size / 1024).toFixed(0)} KB)`);

  const rawRecipes = parsePaprika(req.file.buffer);
  if (rawRecipes.length === 0) {
    return res.status(400).json({ error: 'No recipes found in file. Is this a valid .paprikarecipes export?' });
  }

  const { recipes, errors } = normaliseRecipeBatch(rawRecipes);
  const result = await recipeService.importRecipes(recipes, req.cellarId);

  logger.info('Recipes', `Paprika import: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`);

  if (result.added > 0 || result.updated > 0) {
    await invalidateProfile(req.cellarId);
  }

  res.json({
    message: `Imported ${result.added + result.updated} recipes`,
    ...result,
    total_in_file: rawRecipes.length,
    validation_errors: errors.length
  });
}));

/**
 * POST /recipes/import/recipesage
 * Upload RecipeSage JSON-LD export.
 */
router.post('/import/recipesage', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File is required. Upload a RecipeSage JSON export.' });
  }

  // Lazy-load adapter
  const { parseRecipes } = await import('../services/recipe/adapters/recipeSageAdapter.js');
  const rawRecipes = parseRecipes(req.file.buffer.toString('utf8'));

  if (rawRecipes.length === 0) {
    return res.status(400).json({ error: 'No recipes found in file.' });
  }

  const { recipes, errors } = normaliseRecipeBatch(rawRecipes);
  const result = await recipeService.importRecipes(recipes, req.cellarId);

  if (result.added > 0 || result.updated > 0) {
    await invalidateProfile(req.cellarId);
  }

  res.json({
    message: `Imported ${result.added + result.updated} recipes`,
    ...result,
    total_in_file: rawRecipes.length,
    validation_errors: errors.length
  });
}));

/**
 * POST /recipes/import/csv
 * Upload CSV file.
 */
router.post('/import/csv', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required.' });
  }

  const { parseRecipes } = await import('../services/recipe/adapters/csvAdapter.js');
  const rawRecipes = parseRecipes(req.file.buffer.toString('utf8'));

  if (rawRecipes.length === 0) {
    return res.status(400).json({ error: 'No recipes found in CSV.' });
  }

  const { recipes, errors } = normaliseRecipeBatch(rawRecipes);
  const result = await recipeService.importRecipes(recipes, req.cellarId);

  if (result.added > 0 || result.updated > 0) {
    await invalidateProfile(req.cellarId);
  }

  res.json({
    message: `Imported ${result.added + result.updated} recipes`,
    ...result,
    total_in_file: rawRecipes.length,
    validation_errors: errors.length
  });
}));

/**
 * POST /recipes/import/url
 * Import a single recipe from a URL via JSON-LD scraping.
 */
router.post('/import/url', validateBody(urlImportSchema), asyncHandler(async (req, res) => {
  const { parseRecipeFromUrl } = await import('../services/recipe/adapters/jsonLdAdapter.js');
  const recipe = await parseRecipeFromUrl(req.body.url);

  if (!recipe) {
    return res.status(400).json({ error: 'No recipe found at this URL. The page may not have structured recipe data.' });
  }

  const { recipes, errors } = normaliseRecipeBatch([recipe]);
  if (recipes.length === 0) {
    return res.status(400).json({ error: 'Recipe data was invalid', validation_errors: errors });
  }

  const result = await recipeService.importRecipes(recipes, req.cellarId);

  if (result.added > 0 || result.updated > 0) {
    await invalidateProfile(req.cellarId);
  }

  res.json({
    message: result.added > 0 ? 'Recipe imported' : 'Recipe updated',
    ...result,
    recipe_name: recipes[0].name
  });
}));

// ============================================
// CRUD Endpoints
// ============================================

/**
 * GET /recipes
 * List recipes with optional filters.
 */
router.get('/', validateQuery(recipeListQuerySchema), asyncHandler(async (req, res) => {
  const result = await recipeService.listRecipes(req.cellarId, req.query);
  res.json(result);
}));

/**
 * GET /recipes/categories
 * Get category list with counts.
 */
router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await recipeService.getRecipeCategories(req.cellarId);
  res.json({ data: categories });
}));

// ============================================
// Cooking Profile (MUST be above /:id to avoid route shadowing)
// ============================================

/**
 * GET /recipes/profile
 * Compute & return cooking profile.
 */
router.get('/profile', asyncHandler(async (req, res) => {
  const { computeCookingProfile } = await import('../services/recipe/cookingProfile.js');
  const profile = await computeCookingProfile(req.cellarId);
  res.json({ data: profile });
}));

/**
 * POST /recipes/profile/refresh
 * Force recompute (cache-bust).
 */
router.post('/profile/refresh', asyncHandler(async (req, res) => {
  const { computeCookingProfile } = await import('../services/recipe/cookingProfile.js');
  const profile = await computeCookingProfile(req.cellarId, { forceRefresh: true });
  res.json({ data: profile });
}));

/**
 * GET /recipes/buying-guide
 * Full buying guide report: gaps, surpluses, diversity recs.
 */
router.get('/buying-guide', asyncHandler(async (req, res) => {
  const { generateBuyingGuide } = await import('../services/recipe/buyingGuide.js');
  const guide = await generateBuyingGuide(req.cellarId);
  res.json({ data: guide });
}));

/**
 * GET /recipes/:id
 * Get single recipe.
 */
router.get('/:id', validateParams(recipeIdSchema), asyncHandler(async (req, res) => {
  const recipe = await recipeService.getRecipe(req.cellarId, req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  res.json({ data: recipe });
}));

/**
 * POST /recipes
 * Create manual recipe.
 */
router.post('/', validateBody(recipeBodySchema), asyncHandler(async (req, res) => {
  const result = await recipeService.createRecipe(req.cellarId, req.body);
  await invalidateProfile(req.cellarId);
  res.status(201).json({ message: 'Recipe created', data: result });
}));

/**
 * PUT /recipes/:id
 * Update recipe.
 */
router.put('/:id', validateParams(recipeIdSchema), validateBody(recipeUpdateSchema), asyncHandler(async (req, res) => {
  const result = await recipeService.updateRecipe(req.cellarId, req.params.id, req.body);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  await invalidateProfile(req.cellarId);
  res.json({ message: 'Recipe updated' });
}));

/**
 * DELETE /recipes/:id
 * Soft-delete recipe.
 */
router.delete('/:id', validateParams(recipeIdSchema), asyncHandler(async (req, res) => {
  const result = await recipeService.deleteRecipe(req.cellarId, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  await invalidateProfile(req.cellarId);
  res.json({ message: 'Recipe deleted' });
}));

// ============================================
// Category Overrides
// ============================================

/**
 * PUT /recipes/categories/overrides
 * Save category frequency overrides to cellar settings.
 */
router.put('/categories/overrides', validateBody(categoryOverridesSchema), asyncHandler(async (req, res) => {
  const db = (await import('../db/index.js')).default;
  await db.prepare(`
    UPDATE cellars SET settings = jsonb_set(
      COALESCE(settings, '{}'),
      '{categoryOverrides}',
      $1::jsonb
    ) WHERE id = $2
  `).run(JSON.stringify(req.body.overrides), req.cellarId);

  await invalidateProfile(req.cellarId);
  res.json({ message: 'Category overrides saved' });
}));

// ============================================
// Menu Pairing
// ============================================

/**
 * POST /recipes/menu-pair
 * Multi-recipe pairing: select multiple recipes and get combined wine suggestions.
 */
router.post('/menu-pair', validateBody(menuPairSchema), asyncHandler(async (req, res) => {
  const { recipe_ids, colour } = req.body;

  // Fetch all requested recipes (cellar-scoped)
  const recipes = [];
  for (const id of recipe_ids) {
    const recipe = await recipeService.getRecipe(req.cellarId, id);
    if (recipe) recipes.push(recipe);
  }

  if (recipes.length === 0) {
    return res.status(404).json({ error: 'No valid recipes found' });
  }

  // Combine signals from all recipes
  const allSignals = new Set();
  const recipeDetails = [];

  for (const recipe of recipes) {
    const dishText = [recipe.name, recipe.ingredients || ''].join(' ');
    const textSignals = extractSignals(dishText);
    const categories = safeParseCategories(recipe.categories);
    const categoryBoosts = getCategorySignalBoosts(categories);
    const boostSignals = Object.keys(categoryBoosts);

    const merged = [...new Set([...textSignals, ...boostSignals])];
    merged.forEach(s => allSignals.add(s));

    recipeDetails.push({
      id: recipe.id,
      name: recipe.name,
      signals: merged
    });
  }

  // Build combined dish text for scoring.
  // Append category boost signal keywords so generateShortlist's internal
  // extractSignals() picks them up alongside text-derived signals.
  const combinedDishText = [
    ...recipes.map(r => [r.name, r.ingredients || ''].join(' ')),
    ...[...allSignals] // inject category-derived signals as keywords
  ].join(' ');

  // Get wines and generate shortlist
  const wines = await getAllWinesForPairing(req.cellarId);
  const result = generateShortlist(wines, combinedDishText, {
    colour: colour || undefined,
    limit: 10
  });

  res.json({
    recipes: recipeDetails,
    combinedSignals: [...allSignals],
    ...result
  });
}));

// ============================================
// Single-Recipe Pairing
// ============================================

/**
 * POST /recipes/:id/pair
 * Get wine pairing suggestions for a recipe.
 */
router.post('/:id/pair', validateParams(recipeIdSchema), asyncHandler(async (req, res) => {
  const recipe = await recipeService.getRecipe(req.cellarId, req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: 'Recipe not found' });
  }

  // Build dish text from name + ingredients for signal extraction
  const dishText = [recipe.name, recipe.ingredients || ''].join(' ');
  const signals = extractSignals(dishText);

  // Also extract category-based signals from the recipe normaliser
  const categories = safeParseCategories(recipe.categories);
  const categoryBoosts = getCategorySignalBoosts(categories);
  const boostSignals = Object.keys(categoryBoosts);
  const mergedSignals = [...new Set([...signals, ...boostSignals])];

  // Inject category-derived signals into dish text so generateShortlist scores them
  const enrichedDishText = [dishText, ...boostSignals].join(' ');

  // Get wines from cellar
  const wines = await getAllWinesForPairing(req.cellarId);

  const { colour } = req.body || {};
  const result = generateShortlist(wines, enrichedDishText, {
    colour: colour || undefined,
    limit: 5
  });

  res.json({
    recipe_id: recipe.id,
    recipe_name: recipe.name,
    signals: mergedSignals,
    ...result
  });
}));

/**
 * Get all wines with slot data for pairing.
 * @param {string} cellarId - Cellar ID
 * @returns {Promise<Array>}
 */
async function getAllWinesForPairing(cellarId) {
  const locationAgg = stringAgg('s.location_code', ',', true);

  const sql = [
    'SELECT',
    '  w.id,',
    '  w.wine_name,',
    '  w.vintage,',
    '  w.style,',
    '  w.colour,',
    '  w.country,',
    '  w.grapes,',
    '  w.region,',
    '  w.winemaking,',
    '  COUNT(s.id) as bottle_count,',
    '  ' + locationAgg + ' as locations,',
    "  MAX(CASE WHEN s.location_code LIKE 'F%' THEN 1 ELSE 0 END) as in_fridge,",
    '  COALESCE(MIN(rn.priority), 99) as reduce_priority,',
    '  MAX(rn.reduce_reason) as reduce_reason,',
    '  MIN(dw.drink_by_year) as drink_by_year,',
    '  MIN(dw.drink_from_year) as drink_from_year',
    'FROM wines w',
    'LEFT JOIN slots s ON s.wine_id = w.id',
    'LEFT JOIN reduce_now rn ON w.id = rn.wine_id',
    'LEFT JOIN drinking_windows dw ON dw.wine_id = w.id',
    'WHERE w.cellar_id = $1',
    'GROUP BY w.id, w.wine_name, w.vintage, w.style, w.colour, w.country, w.grapes, w.region, w.winemaking',
    'HAVING COUNT(s.id) > 0',
    'ORDER BY w.colour, w.style'
  ].join('\n');
  return await db.prepare(sql).all(cellarId);
}

/**
 * Parse categories from DB JSON string or array.
 * @param {string|string[]} cats
 * @returns {string[]}
 */
function safeParseCategories(cats) {
  if (Array.isArray(cats)) return cats;
  if (typeof cats === 'string') {
    try { return JSON.parse(cats); } catch { return []; }
  }
  return [];
}

// ============================================
// Sync Endpoints
// ============================================

/**
 * POST /recipes/sync/:provider
 * Trigger sync for a provider.
 */
router.post('/sync/:provider', validateParams(syncProviderSchema), asyncHandler(async (req, res) => {
  // Lazy-load sync service
  const { triggerSync } = await import('../services/recipe/recipeSyncService.js');
  const result = await triggerSync(req.cellarId, req.params.provider);

  if (result.added > 0 || result.updated > 0) {
    await invalidateProfile(req.cellarId);
  }

  res.json(result);
}));

/**
 * GET /recipes/sync/:provider/status
 * Get sync status for a provider.
 */
router.get('/sync/:provider/status', validateParams(syncProviderSchema), asyncHandler(async (req, res) => {
  const { getSyncStatus } = await import('../services/recipe/recipeSyncService.js');
  const status = await getSyncStatus(req.cellarId, req.params.provider);
  res.json(status);
}));

export default router;
