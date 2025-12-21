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

const router = Router();

router.use('/wines', wineRoutes);
router.use('/wines', ratingsRoutes);  // Nested under /wines for :wineId routes
router.use('/slots', slotRoutes);
router.use('/bottles', bottleRoutes);
router.use('/pairing', pairingRoutes);
router.use('/reduce-now', reduceNowRoutes);
router.use('/stats', statsRoutes);
router.use('/ratings', ratingsRoutes); // Also at /ratings for /sources
router.use('/settings', settingsRoutes);

export default router;
