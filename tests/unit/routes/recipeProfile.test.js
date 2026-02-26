/**
 * @fileoverview Route-level tests for recipe profile and menu-pair endpoints.
 * Validates route ordering (profile not shadowed by /:id), cache invalidation,
 * and category signal injection into pairing.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// Mock db BEFORE any module imports
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

// Mock recipe service
vi.mock('../../../src/services/recipe/recipeService.js', () => ({
  ensureRecipeTables: vi.fn(),
  listRecipes: vi.fn(),
  getRecipeCategories: vi.fn(),
  getRecipe: vi.fn(),
  createRecipe: vi.fn(),
  updateRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
  importRecipes: vi.fn()
}));

// Mock cooking profile
vi.mock('../../../src/services/recipe/cookingProfile.js', () => ({
  computeCookingProfile: vi.fn(),
  invalidateProfile: vi.fn()
}));

// Mock pairing engine
vi.mock('../../../src/services/pairing/pairingEngine.js', () => ({
  extractSignals: vi.fn(() => []),
  generateShortlist: vi.fn(() => ({ success: true, shortlist: [], signals: [] }))
}));

// Mock category signal map
vi.mock('../../../src/services/recipe/categorySignalMap.js', () => ({
  getCategorySignalBoosts: vi.fn(() => ({}))
}));

// Mock db helpers
vi.mock('../../../src/db/helpers.js', () => ({
  stringAgg: vi.fn(() => "STRING_AGG(s.location_code, ',' ORDER BY s.location_code)")
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import express from 'express';
import request from 'supertest';
import recipesRouter from '../../../src/routes/recipes.js';
import * as recipeService from '../../../src/services/recipe/recipeService.js';
import { computeCookingProfile, invalidateProfile } from '../../../src/services/recipe/cookingProfile.js';
import { extractSignals, generateShortlist } from '../../../src/services/pairing/pairingEngine.js';
import { getCategorySignalBoosts } from '../../../src/services/recipe/categorySignalMap.js';
import db from '../../../src/db/index.js';

/**
 * Create test app with cellarId injected.
 * @param {number} cellarId
 */
function createApp(cellarId = 'cellar-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cellarId = cellarId; next(); });
  app.use('/recipes', recipesRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('Recipe Profile Routes', () => {
  let app;

  beforeAll(() => { app = createApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== Finding #1: Route shadowing =====

  describe('GET /recipes/profile — route ordering (Finding #1)', () => {
    it('returns profile data without being caught by /:id', async () => {
      const mockProfile = {
        dominantSignals: [{ signal: 'chicken', weight: 3.0 }],
        wineStyleDemand: { red_medium: 0.4, white_crisp: 0.3 },
        categoryBreakdown: {},
        recipeCount: 10,
        ratedRecipeCount: 5
      };
      computeCookingProfile.mockResolvedValue(mockProfile);

      const res = await request(app).get('/recipes/profile');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockProfile);
      expect(computeCookingProfile).toHaveBeenCalledWith('cellar-1');
    });

    it('does not return 400 validation error (which would mean /:id caught it)', async () => {
      computeCookingProfile.mockResolvedValue({ recipeCount: 0 });

      const res = await request(app).get('/recipes/profile');

      // If route shadowing were in effect, /:id would catch "profile" and fail
      // numeric validation, returning 400. We expect 200 instead.
      expect(res.status).toBe(200);
    });
  });

  describe('POST /recipes/profile/refresh', () => {
    it('force-refreshes the profile', async () => {
      const mockProfile = { recipeCount: 5, dominantSignals: [] };
      computeCookingProfile.mockResolvedValue(mockProfile);

      const res = await request(app).post('/recipes/profile/refresh');

      expect(res.status).toBe(200);
      expect(computeCookingProfile).toHaveBeenCalledWith('cellar-1', { forceRefresh: true });
    });
  });

  // ===== Finding #5: Cache invalidation =====

  describe('PUT /recipes/:id — cache invalidation (Finding #5)', () => {
    it('invalidates profile cache on recipe update', async () => {
      recipeService.updateRecipe.mockResolvedValue({ changes: 1 });

      const res = await request(app)
        .put('/recipes/1')
        .send({ name: 'Updated Recipe' });

      expect(res.status).toBe(200);
      expect(invalidateProfile).toHaveBeenCalledWith('cellar-1');
    });

    it('does not invalidate if recipe not found', async () => {
      recipeService.updateRecipe.mockResolvedValue({ changes: 0 });

      const res = await request(app)
        .put('/recipes/1')
        .send({ name: 'Updated Recipe' });

      expect(res.status).toBe(404);
      expect(invalidateProfile).not.toHaveBeenCalled();
    });
  });

  // ===== Finding #6: Category signal injection =====

  describe('POST /recipes/menu-pair — category signal injection (Finding #6)', () => {
    beforeEach(() => {
      // Mock db for getAllWinesForPairing
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ changes: 0 })
      });
    });

    it('injects category boost signals into dish text for scoring', async () => {
      recipeService.getRecipe.mockResolvedValue({
        id: 1, name: 'Grilled Chicken', ingredients: 'chicken breast',
        categories: '["Poultry","Grilled"]'
      });

      // extractSignals returns text-derived signals
      extractSignals.mockReturnValue(['chicken', 'grilled']);

      // getCategorySignalBoosts returns category-derived signals
      getCategorySignalBoosts.mockReturnValue({ chicken: 1, poultry: 0.5 });

      generateShortlist.mockReturnValue({ success: true, shortlist: [], signals: [] });

      const res = await request(app)
        .post('/recipes/menu-pair')
        .send({ recipe_ids: [1] });

      expect(res.status).toBe(200);

      // The dish text passed to generateShortlist should include category signals
      const dishTextArg = generateShortlist.mock.calls[0][1];
      expect(dishTextArg).toContain('chicken');
      expect(dishTextArg).toContain('poultry');

      // Combined signals in response should include both text + category signals
      expect(res.body.combinedSignals).toEqual(
        expect.arrayContaining(['chicken', 'grilled', 'poultry'])
      );
    });

    it('returns 404 when no valid recipes found', async () => {
      recipeService.getRecipe.mockResolvedValue(null);

      const res = await request(app)
        .post('/recipes/menu-pair')
        .send({ recipe_ids: [999] });

      expect(res.status).toBe(404);
    });

    it('validates recipe_ids is a non-empty array', async () => {
      const res = await request(app)
        .post('/recipes/menu-pair')
        .send({ recipe_ids: [] });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /recipes/:id/pair — single recipe signal injection', () => {
    beforeEach(() => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ changes: 0 })
      });
    });

    it('injects category boost signals into dish text', async () => {
      recipeService.getRecipe.mockResolvedValue({
        id: 1, name: 'Pasta Carbonara', ingredients: 'bacon, eggs, parmesan',
        categories: '["Italian","Pasta"]'
      });

      extractSignals.mockReturnValue(['pork']);
      getCategorySignalBoosts.mockReturnValue({ pork: 1, creamy: 0.5 });
      // generateShortlist returns its own signals field which spreads over the route's
      generateShortlist.mockReturnValue({ success: true, shortlist: [], signals: ['pork', 'creamy'] });

      const res = await request(app).post('/recipes/1/pair');

      expect(res.status).toBe(200);

      // Verify enriched dish text includes category-derived signals
      const dishTextArg = generateShortlist.mock.calls[0][1];
      expect(dishTextArg).toContain('pork');
      expect(dishTextArg).toContain('creamy');

      // Response includes signals from generateShortlist (which gets enriched dish text)
      expect(res.body.signals).toEqual(
        expect.arrayContaining(['pork', 'creamy'])
      );
    });
  });
});
