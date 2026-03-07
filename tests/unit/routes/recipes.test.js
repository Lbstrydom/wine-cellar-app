/**
 * @fileoverview Unit tests for POST /recipes/import/url.
 * Verifies that recipe_id is returned in the response so the frontend
 * can fetch full recipe details (ingredients) for the sommelier.
 */

// --- Mocks ---

vi.mock('../../../src/db/index.js', () => ({ default: { prepare: vi.fn() } }));

vi.mock('../../../src/services/recipe/recipeService.js', () => ({
  importRecipes: vi.fn(),
  listRecipes: vi.fn(),
  getRecipeCategories: vi.fn(),
  getRecipe: vi.fn(),
  createRecipe: vi.fn(),
  updateRecipe: vi.fn(),
  deleteRecipe: vi.fn()
}));

vi.mock('../../../src/services/recipe/recipeNormaliser.js', () => ({
  normaliseRecipeBatch: vi.fn()
}));

vi.mock('../../../src/services/recipe/cookingProfile.js', () => ({
  computeCookingProfile: vi.fn(),
  invalidateProfile: vi.fn()
}));

vi.mock('../../../src/services/pairing/pairingEngine.js', () => ({
  extractSignals: vi.fn(() => []),
  generateShortlist: vi.fn(() => ({ shortlist: [] }))
}));

vi.mock('../../../src/services/recipe/categorySignalMap.js', () => ({
  getCategorySignalBoosts: vi.fn(() => ({}))
}));

vi.mock('../../../src/db/helpers.js', () => ({
  stringAgg: vi.fn(() => "STRING_AGG(s.location_code, ',')")
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const { mockParseRecipeFromUrl } = vi.hoisted(() => ({
  mockParseRecipeFromUrl: vi.fn()
}));

vi.mock('../../../src/services/recipe/adapters/jsonLdAdapter.js', () => ({
  parseRecipeFromUrl: mockParseRecipeFromUrl
}));

import express from 'express';
import request from 'supertest';
import db from '../../../src/db/index.js';
import * as recipeService from '../../../src/services/recipe/recipeService.js';
import { normaliseRecipeBatch } from '../../../src/services/recipe/recipeNormaliser.js';
import { invalidateProfile } from '../../../src/services/recipe/cookingProfile.js';

async function createApp(cellarId = 'cellar-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = cellarId; req.user = { id: 'user-1' }; next(); });
  const { default: recipesRouter } = await import('../../../src/routes/recipes.js');
  app.use('/recipes', recipesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

const VALID_RECIPE = {
  name: 'Roast Chicken',
  source_provider: 'url',
  source_recipe_id: 'roast-chicken-123',
  ingredients: 'chicken, lemon, thyme'
};

describe('POST /recipes/import/url', () => {
  let app;

  beforeAll(async () => { app = await createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockParseRecipeFromUrl.mockResolvedValue(VALID_RECIPE);
    normaliseRecipeBatch.mockReturnValue({ recipes: [VALID_RECIPE], errors: [] });
    recipeService.importRecipes.mockResolvedValue({ added: 1, updated: 0, skipped: 0 });
    invalidateProfile.mockResolvedValue();
  });

  it('returns recipe_id in response after successful import', async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue({ id: 42 }) });

    const res = await request(app)
      .post('/recipes/import/url')
      .send({ url: 'https://example.com/roast-chicken' });

    expect(res.status).toBe(200);
    expect(res.body.recipe_id).toBe(42);
    expect(res.body.recipe_name).toBe('Roast Chicken');
    expect(res.body.added).toBe(1);
  });

  it('returns recipe_id: null when DB lookup finds no matching recipe', async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(null) });

    const res = await request(app)
      .post('/recipes/import/url')
      .send({ url: 'https://example.com/mystery-dish' });

    expect(res.status).toBe(200);
    expect(res.body.recipe_id).toBeNull();
  });
});
