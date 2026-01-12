/**
 * @fileoverview Aggregates all route modules.
 * @module routes
 */

import { Router } from 'express';
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

router.use('/wines', wineRoutes);
router.use('/wines', ratingsRoutes);  // Wine-specific ratings: GET/POST/PUT/DELETE /wines/:wineId/ratings
router.use('/slots', slotRoutes);
router.use('/bottles', bottleRoutes);
router.use('/pairing', pairingRoutes);
router.use('/reduce-now', reduceNowRoutes);
router.use('/stats', statsRoutes);
router.use('/layout', layoutRoutes);
router.use('/ratings', ratingsRoutes); // Admin routes: GET /ratings/sources, /ratings/logs, POST /ratings/cleanup
router.use('/settings', settingsRoutes);
router.use('/', drinkingWindowsRoutes);  // /wines/:wine_id/drinking-windows and /drinking-windows/urgent
router.use('/cellar', cellarRoutes);    // /cellar/analyse, /cellar/suggest-placement, etc.
router.use('/awards', awardsRoutes);    // /awards/sources, /awards/import/*, /awards/wine/:id, etc.
router.use('/backup', backupRoutes);    // /backup/export/json, /backup/export/csv, /backup/import
router.use('/wine-search', wineSearchRoutes);  // /wine-search (POST), /wine-search/vivino/:id (GET)
router.use('/acquisition', acquisitionRoutes);  // /acquisition/workflow, /acquisition/save, etc.
router.use('/palate', palateProfileRoutes);    // /palate/feedback, /palate/profile, /palate/recommendations
router.use('/health', cellarHealthRoutes);    // /health, /health/fill-fridge, /health/at-risk, /health/shopping-list
router.use('/admin', adminRoutes);
router.use('/wines', tastingNotesRoutes);     // /wines/:id/tasting-notes, /wines/:id/tasting-notes/regenerate, etc.
router.use('/metrics', searchMetricsRoutes);  // /metrics/search/summary, /metrics/search/history, /metrics/search/stats

export default router;
