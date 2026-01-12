/**
 * @fileoverview Aggregates all route modules.
 * Auth strategy: Authentication mounted per-router (not globally in server.js)
 * This allows mixing authenticated and public endpoints.
 * @module routes
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireCellarContext } from '../middleware/cellarContext.js';
import wineRoutes from './wines.js';
import slotRoutes from './slots.js';
import bottleRoutes from './bottles.js';
import pairingRoutes from './pairing.js';
import reduceNowRoutes from './reduceNow.js';
import statsRoutes from './stats.js';
import layoutRoutes from './layout.js';
import ratingsRoutes from './ratings.js';
import settingsRoutes from './settings.js';
import drinkingWindowsRoutes from './drinkingWindows.js';
import cellarRoutes from './cellar.js';
import cellarsRoutes from './cellars.js';
import profileRoutes from './profile.js';
import awardsRoutes from './awards.js';
import backupRoutes from './backup.js';
import wineSearchRoutes from './wineSearch.js';
import acquisitionRoutes from './acquisition.js';
import palateProfileRoutes from './palateProfile.js';
import cellarHealthRoutes from './cellarHealth.js';
import adminRoutes from './admin.js';
import tastingNotesRoutes from './tastingNotes.js';
import searchMetricsRoutes from './searchMetrics.js';

const router = Router();

// AUTHENTICATED ROUTES (all require Bearer token via requireAuth)
router.use('/profile', requireAuth, profileRoutes);  // User profile management
router.use('/cellars', requireAuth, cellarsRoutes);  // Cellar management (user-scoped, not cellar-scoped)

// DATA ROUTES (require both auth + cellar context)
// All use requireCellarContext middleware to validate membership and set req.cellarId
router.use('/wines', requireAuth, requireCellarContext, wineRoutes);
router.use('/wines', requireAuth, requireCellarContext, ratingsRoutes);  // Wine-specific ratings
router.use('/slots', requireAuth, requireCellarContext, slotRoutes);
router.use('/bottles', requireAuth, requireCellarContext, bottleRoutes);
router.use('/pairing', requireAuth, requireCellarContext, pairingRoutes);
router.use('/reduce-now', requireAuth, requireCellarContext, reduceNowRoutes);
router.use('/stats', requireAuth, requireCellarContext, statsRoutes);
router.use('/layout', requireAuth, requireCellarContext, layoutRoutes);
router.use('/ratings', requireAuth, requireCellarContext, ratingsRoutes); // Admin routes
router.use('/settings', requireAuth, requireCellarContext, settingsRoutes);
router.use('/', requireAuth, requireCellarContext, drinkingWindowsRoutes);  // /wines/:wine_id/drinking-windows and /drinking-windows/urgent
router.use('/cellar', requireAuth, requireCellarContext, cellarRoutes);    // /cellar/analyse, /cellar/suggest-placement, etc.
router.use('/awards', requireAuth, requireCellarContext, awardsRoutes);    // /awards/sources, /awards/import/*, /awards/wine/:id, etc.
router.use('/backup', requireAuth, requireCellarContext, backupRoutes);    // /backup/export/json, /backup/export/csv, /backup/import
router.use('/wine-search', requireAuth, requireCellarContext, wineSearchRoutes);  // /wine-search (POST), /wine-search/vivino/:id (GET)
router.use('/acquisition', requireAuth, requireCellarContext, acquisitionRoutes);  // /acquisition/workflow, /acquisition/save, etc.
router.use('/palate', requireAuth, requireCellarContext, palateProfileRoutes);    // /palate/feedback, /palate/profile, /palate/recommendations
router.use('/health', requireAuth, requireCellarContext, cellarHealthRoutes);    // /health, /health/fill-fridge, /health/at-risk, /health/shopping-list
router.use('/admin', adminRoutes);
router.use('/wines', requireAuth, requireCellarContext, tastingNotesRoutes);     // /wines/:id/tasting-notes, /wines/:id/tasting-notes/regenerate, etc.
router.use('/metrics', requireAuth, requireCellarContext, searchMetricsRoutes);  // /metrics/search/summary, /metrics/search/history, /metrics/search/stats

export default router;
