/**
 * @fileoverview Aggregates all route modules.
 * Auth strategy: Authentication mounted per-router (not globally in server.js)
 * This allows mixing authenticated and public endpoints.
 *
 * Exception: /api/restaurant-pairing is mounted directly in server.js (before
 * the global body parser) so it can use its own 5mb JSON limit for image uploads.
 * See server.js for that mount and its auth/metrics chain.
 * @module routes
 */

import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { requireCellarContext } from '../middleware/cellarContext.js';
import { WINE_COUNTRIES, COUNTRY_REGIONS } from '../config/wineRegions.js';
import wineRoutes from './wines.js';
import wineRatingsRoutes from './wineRatings.js';
import winesTastingRoutes from './winesTasting.js';
import slotRoutes from './slots.js';
import bottleRoutes from './bottles.js';
import pairingRoutes from './pairing.js';
import reduceNowRoutes from './reduceNow.js';
import statsRoutes from './stats.js';
import ratingsRoutes from './ratings.js';
import ratingsTierRoutes from './ratingsTier.js';
import settingsRoutes from './settings.js';
import drinkingWindowsRoutes from './drinkingWindows.js';
import cellarRoutes from './cellar.js';
import cellarAnalysisRoutes from './cellarAnalysis.js';
import cellarReconfigurationRoutes from './cellarReconfiguration.js';
import cellarZoneLayoutRoutes from './cellarZoneLayout.js';
import cellarsRoutes from './cellars.js';
import storageAreasRoutes from './storageAreas.js';
import profileRoutes from './profile.js';
import awardsRoutes from './awards.js';
import backupRoutes from './backup.js';
import wineSearchRoutes from './wineSearch.js';
import acquisitionRoutes from './acquisition.js';
import palateProfileRoutes from './palateProfile.js';
import cellarHealthRoutes from './cellarHealth.js';
import adminRoutes from './admin.js';
import tastingNotesRoutes from './tastingNotes.js';
import searchRoutes from './search.js';
import consistencyRoutes from './consistency.js';
import recipesRoutes from './recipes.js';
import buyingGuideItemsRoutes from './buyingGuideItems.js';
import pendingRatingsRoutes from './pendingRatings.js';

const router = Router();

// Public config for frontend (Supabase URL/anon key only)
router.get('/public-config', (_req, res) => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  return res.json({
    supabase_url: SUPABASE_URL,
    supabase_anon_key: SUPABASE_ANON_KEY
  });
});

// Public wine region reference data (no auth — cached by browser + SW)
router.get('/config/wine-regions', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400'); // 24h browser cache
  res.json({ countries: WINE_COUNTRIES, regions: COUNTRY_REGIONS });
});

// Client error logging (optional auth)
router.post('/errors/log', optionalAuth, (req, res) => {
  const { context, message, url } = req.body || {};
  const userId = req.user?.id || null;
  const safeContext = typeof context === 'string' ? context.slice(0, 120) : 'ClientError';
  const safeMessage = typeof message === 'string' ? message.slice(0, 2000) : 'Unknown error';

  logger.error('ClientError', `${safeContext}: ${safeMessage} (user=${userId}, url=${typeof url === 'string' ? url.slice(0, 500) : 'unknown'})`);

  res.json({ success: true });
});

// AUTHENTICATED ROUTES (all require Bearer token via requireAuth)
router.use('/profile', requireAuth, profileRoutes);  // User profile management
router.use('/cellars', requireAuth, cellarsRoutes);  // Cellar management (user-scoped, not cellar-scoped)


// DATA ROUTES (require both auth + cellar context)
// All use requireCellarContext middleware to validate membership and set req.cellarId
router.use('/wines', requireAuth, requireCellarContext, wineRoutes);
router.use('/wines', requireAuth, requireCellarContext, wineRatingsRoutes);
router.use('/wines', requireAuth, requireCellarContext, winesTastingRoutes);
router.use('/wines', requireAuth, requireCellarContext, ratingsRoutes);  // Wine-specific ratings
router.use('/wines', requireAuth, requireCellarContext, ratingsTierRoutes);  // 3-tier waterfall fetch
router.use('/slots', requireAuth, requireCellarContext, slotRoutes);
router.use('/bottles', requireAuth, requireCellarContext, bottleRoutes);
router.use('/storage-areas', requireAuth, requireCellarContext, storageAreasRoutes);
router.use('/pairing', requireAuth, requireCellarContext, pairingRoutes);
router.use('/reduce-now', requireAuth, requireCellarContext, reduceNowRoutes);
router.use('/stats', requireAuth, requireCellarContext, statsRoutes);
router.use('/ratings', requireAuth, requireCellarContext, ratingsRoutes); // Admin routes
router.use('/settings', requireAuth, requireCellarContext, settingsRoutes);
router.use('/', requireAuth, requireCellarContext, drinkingWindowsRoutes);  // /wines/:wine_id/drinking-windows and /drinking-windows/urgent
router.use('/cellar', requireAuth, requireCellarContext, cellarRoutes);    // /cellar/zones, /cellar/suggest-placement, /cellar/assign-zone, etc.
router.use('/cellar', requireAuth, requireCellarContext, cellarAnalysisRoutes);    // /cellar/analyse, /cellar/fridge-status, /cellar/zone-capacity-advice, etc.
router.use('/cellar', requireAuth, requireCellarContext, cellarReconfigurationRoutes);    // /cellar/reconfiguration-plan, /cellar/execute-moves, etc.
router.use('/cellar', requireAuth, requireCellarContext, cellarZoneLayoutRoutes);    // /cellar/zone-metadata, /cellar/zone-layout, /cellar/zone-chat, etc.
router.use('/awards', requireAuth, requireCellarContext, awardsRoutes);    // /awards/sources, /awards/import/*, /awards/wine/:id, etc.
router.use('/backup', requireAuth, requireCellarContext, backupRoutes);    // /backup/export/json, /backup/export/csv, /backup/import
router.use('/wine-search', requireAuth, requireCellarContext, wineSearchRoutes);  // /wine-search (POST), /wine-search/vivino/:id (GET)
router.use('/search', requireAuth, requireCellarContext, searchRoutes);  // /search/metrics
router.use('/acquisition', requireAuth, requireCellarContext, acquisitionRoutes);  // /acquisition/workflow, /acquisition/save, etc.
router.use('/palate', requireAuth, requireCellarContext, palateProfileRoutes);    // /palate/feedback, /palate/profile, /palate/recommendations
router.use('/health', requireAuth, requireCellarContext, cellarHealthRoutes);    // /health, /health/fill-fridge, /health/at-risk, /health/shopping-list
router.use('/admin', requireAuth, adminRoutes);
router.use('/wines', requireAuth, requireCellarContext, tastingNotesRoutes);     // /wines/:id/tasting-notes, /wines/:id/tasting-notes/regenerate, etc.
router.use('/consistency', requireAuth, requireCellarContext, consistencyRoutes);  // /consistency/audit, /consistency/check/:id, /consistency/validate
router.use('/recipes', requireAuth, requireCellarContext, recipesRoutes);          // /recipes, /recipes/import/*, /recipes/sync/*
router.use('/buying-guide-items', requireAuth, requireCellarContext, buyingGuideItemsRoutes);  // /buying-guide-items CRUD, status, batch
router.use('/pending-ratings', requireAuth, requireCellarContext, pendingRatingsRoutes);     // /pending-ratings, /pending-ratings/:id/resolve, /pending-ratings/dismiss-all

export default router;
