/**
 * @fileoverview Express server setup.
 * @module server
 */

// Load environment variables BEFORE any other imports
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import jobQueue from './services/jobQueue.js';
import handleRatingFetch from './jobs/ratingFetchJob.js';
import handleBatchFetch from './jobs/batchFetchJob.js';
import { purgeExpiredCache } from './services/cacheService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased for base64 image uploads
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', routes);

// Register job handlers
jobQueue.registerHandler('rating_fetch', handleRatingFetch);
jobQueue.registerHandler('batch_fetch', handleBatchFetch);

// Start job queue processor
jobQueue.start();

// Schedule periodic cache cleanup (every 6 hours)
const CACHE_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;
setInterval(() => {
  console.log('[Cache] Running scheduled cache cleanup...');
  try {
    const result = purgeExpiredCache();
    console.log('[Cache] Cleanup complete:', result);
  } catch (err) {
    console.error('[Cache] Cleanup failed:', err.message);
  }
}, CACHE_CLEANUP_INTERVAL);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wine cellar app running on http://0.0.0.0:${PORT}`);
  console.log('[Jobs] Job queue started');
});
