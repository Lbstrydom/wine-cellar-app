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
import ratingsRoutes from './ratings.js';
import settingsRoutes from './settings.js';
import drinkingWindowsRoutes from './drinkingWindows.js';
import cellarRoutes from './cellar.js';
import awardsRoutes from './awards.js';

const router = Router();

router.use('/wines', wineRoutes);
router.use('/wines', ratingsRoutes);  // Wine-specific ratings: GET/POST/PUT/DELETE /wines/:wineId/ratings
router.use('/slots', slotRoutes);
router.use('/bottles', bottleRoutes);
router.use('/pairing', pairingRoutes);
router.use('/reduce-now', reduceNowRoutes);
router.use('/stats', statsRoutes);
router.use('/ratings', ratingsRoutes); // Admin routes: GET /ratings/sources, /ratings/logs, POST /ratings/cleanup
router.use('/settings', settingsRoutes);
router.use('/', drinkingWindowsRoutes);  // /wines/:wine_id/drinking-windows and /drinking-windows/urgent
router.use('/cellar', cellarRoutes);    // /cellar/analyse, /cellar/suggest-placement, etc.
router.use('/awards', awardsRoutes);    // /awards/sources, /awards/import/*, /awards/wine/:id, etc.

export default router;
