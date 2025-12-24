# Phase 8: Rating Search Architecture Improvements

## Overview

This phase addresses the architectural limitations identified in the rating search system:
1. **Latency** - 15-25 seconds per wine is too slow for interactive use
2. **Caching** - No result reuse; identical searches re-run full pipeline
3. **Premium sources** - Missing Parker, Jancis, Suckling, Vinous
4. **Error handling** - Inconsistent classification of fetch failures
5. **Vintage precision** - Inferred matches inappropriate for age-worthy wines

---

## 1. Caching Layer

### 1.1 Migration: Create Cache Tables

Create file: `migrations/009_search_cache.sql`

```sql
-- SERP result cache
CREATE TABLE IF NOT EXISTS search_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT UNIQUE NOT NULL,          -- hash of query params
  query_type TEXT NOT NULL,                -- 'serp_targeted', 'serp_broad', 'serp_variation'
  query_params TEXT NOT NULL,              -- JSON of search parameters
  results TEXT NOT NULL,                   -- JSON array of search results
  result_count INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_search_cache_key ON search_cache(cache_key);
CREATE INDEX idx_search_cache_expires ON search_cache(expires_at);

-- Page content cache
CREATE TABLE IF NOT EXISTS page_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_hash TEXT UNIQUE NOT NULL,           -- hash of URL
  url TEXT NOT NULL,
  content TEXT,                            -- page content (NULL if fetch failed)
  content_length INTEGER,
  fetch_status TEXT NOT NULL,              -- 'success', 'blocked', 'auth_required', 'timeout', 'error'
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_page_cache_hash ON page_cache(url_hash);
CREATE INDEX idx_page_cache_expires ON page_cache(expires_at);

-- Extraction cache (Claude results)
CREATE TABLE IF NOT EXISTS extraction_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,              -- hash of input content
  extraction_type TEXT NOT NULL,           -- 'page', 'snippet'
  extracted_ratings TEXT NOT NULL,         -- JSON array of ratings
  extracted_windows TEXT,                  -- JSON array of drinking windows
  tasting_notes TEXT,
  model_version TEXT,                      -- Claude model used
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  UNIQUE(wine_id, content_hash, extraction_type)
);

CREATE INDEX idx_extraction_cache_wine ON extraction_cache(wine_id);
CREATE INDEX idx_extraction_cache_expires ON extraction_cache(expires_at);

-- Cache configuration
CREATE TABLE IF NOT EXISTS cache_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT
);

INSERT INTO cache_config (key, value, description) VALUES
  ('serp_ttl_hours', '24', 'SERP results cache duration'),
  ('page_ttl_hours', '168', 'Page content cache duration (7 days)'),
  ('extraction_ttl_hours', '720', 'Extraction cache duration (30 days)'),
  ('blocked_page_ttl_hours', '24', 'Blocked page retry interval'),
  ('cache_cleanup_interval_hours', '6', 'How often to purge expired cache');
```

### 1.2 Cache Service

Create file: `src/services/cacheService.js`

```javascript
const crypto = require('crypto');
const db = require('../db');

/**
 * Generate cache key from parameters
 */
function generateCacheKey(params) {
  const normalized = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 32);
}

/**
 * Get cache TTL from config
 */
async function getCacheTTL(type) {
  const configKey = `${type}_ttl_hours`;
  const result = await db.get('SELECT value FROM cache_config WHERE key = ?', [configKey]);
  return result ? parseInt(result.value) : 24;
}

/**
 * Calculate expiry timestamp
 */
function getExpiryTimestamp(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// =============================================================================
// SERP Cache
// =============================================================================

async function getCachedSerpResults(queryParams) {
  const cacheKey = generateCacheKey(queryParams);
  
  const cached = await db.get(`
    SELECT results, result_count 
    FROM search_cache 
    WHERE cache_key = ? AND expires_at > datetime('now')
  `, [cacheKey]);
  
  if (cached) {
    console.log(`[Cache HIT] SERP: ${queryParams.query?.substring(0, 50)}...`);
    return {
      results: JSON.parse(cached.results),
      count: cached.result_count,
      fromCache: true
    };
  }
  
  return null;
}

async function cacheSerpResults(queryParams, queryType, results) {
  const cacheKey = generateCacheKey(queryParams);
  const ttlHours = await getCacheTTL('serp');
  
  await db.run(`
    INSERT INTO search_cache (cache_key, query_type, query_params, results, result_count, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      results = excluded.results,
      result_count = excluded.result_count,
      expires_at = excluded.expires_at,
      created_at = CURRENT_TIMESTAMP
  `, [
    cacheKey,
    queryType,
    JSON.stringify(queryParams),
    JSON.stringify(results),
    results.length,
    getExpiryTimestamp(ttlHours)
  ]);
}

// =============================================================================
// Page Cache
// =============================================================================

async function getCachedPage(url) {
  const urlHash = generateCacheKey({ url });
  
  const cached = await db.get(`
    SELECT content, fetch_status, status_code, error_message
    FROM page_cache 
    WHERE url_hash = ? AND expires_at > datetime('now')
  `, [urlHash]);
  
  if (cached) {
    console.log(`[Cache HIT] Page: ${url.substring(0, 60)}...`);
    return {
      content: cached.content,
      status: cached.fetch_status,
      statusCode: cached.status_code,
      error: cached.error_message,
      fromCache: true
    };
  }
  
  return null;
}

async function cachePage(url, content, status, statusCode, errorMessage = null) {
  const urlHash = generateCacheKey({ url });
  
  // Blocked pages get shorter TTL for retry
  const ttlType = status === 'success' ? 'page' : 'blocked_page';
  const ttlHours = await getCacheTTL(ttlType);
  
  await db.run(`
    INSERT INTO page_cache (url_hash, url, content, content_length, fetch_status, status_code, error_message, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url_hash) DO UPDATE SET
      content = excluded.content,
      content_length = excluded.content_length,
      fetch_status = excluded.fetch_status,
      status_code = excluded.status_code,
      error_message = excluded.error_message,
      expires_at = excluded.expires_at,
      created_at = CURRENT_TIMESTAMP
  `, [
    urlHash,
    url,
    content,
    content ? content.length : 0,
    status,
    statusCode,
    errorMessage,
    getExpiryTimestamp(ttlHours)
  ]);
}

// =============================================================================
// Extraction Cache
// =============================================================================

async function getCachedExtraction(wineId, contentHash, extractionType) {
  const cached = await db.get(`
    SELECT extracted_ratings, extracted_windows, tasting_notes
    FROM extraction_cache 
    WHERE wine_id = ? AND content_hash = ? AND extraction_type = ?
      AND expires_at > datetime('now')
  `, [wineId, contentHash, extractionType]);
  
  if (cached) {
    console.log(`[Cache HIT] Extraction: wine ${wineId}, type ${extractionType}`);
    return {
      ratings: JSON.parse(cached.extracted_ratings),
      windows: cached.extracted_windows ? JSON.parse(cached.extracted_windows) : [],
      tastingNotes: cached.tasting_notes,
      fromCache: true
    };
  }
  
  return null;
}

async function cacheExtraction(wineId, contentHash, extractionType, ratings, windows, tastingNotes, modelVersion) {
  const ttlHours = await getCacheTTL('extraction');
  
  await db.run(`
    INSERT INTO extraction_cache (wine_id, content_hash, extraction_type, extracted_ratings, extracted_windows, tasting_notes, model_version, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wine_id, content_hash, extraction_type) DO UPDATE SET
      extracted_ratings = excluded.extracted_ratings,
      extracted_windows = excluded.extracted_windows,
      tasting_notes = excluded.tasting_notes,
      model_version = excluded.model_version,
      expires_at = excluded.expires_at,
      created_at = CURRENT_TIMESTAMP
  `, [
    wineId,
    contentHash,
    extractionType,
    JSON.stringify(ratings),
    windows ? JSON.stringify(windows) : null,
    tastingNotes,
    modelVersion,
    getExpiryTimestamp(ttlHours)
  ]);
}

// =============================================================================
// Cache Maintenance
// =============================================================================

async function purgeExpiredCache() {
  const tables = ['search_cache', 'page_cache', 'extraction_cache'];
  const results = {};
  
  for (const table of tables) {
    const result = await db.run(`DELETE FROM ${table} WHERE expires_at < datetime('now')`);
    results[table] = result.changes || 0;
  }
  
  console.log('[Cache] Purged expired entries:', results);
  return results;
}

async function getCacheStats() {
  const stats = {};
  
  stats.serp = await db.get(`
    SELECT COUNT(*) as total, SUM(CASE WHEN expires_at > datetime('now') THEN 1 ELSE 0 END) as valid
    FROM search_cache
  `);
  
  stats.page = await db.get(`
    SELECT COUNT(*) as total, SUM(CASE WHEN expires_at > datetime('now') THEN 1 ELSE 0 END) as valid
    FROM page_cache
  `);
  
  stats.extraction = await db.get(`
    SELECT COUNT(*) as total, SUM(CASE WHEN expires_at > datetime('now') THEN 1 ELSE 0 END) as valid
    FROM extraction_cache
  `);
  
  return stats;
}

async function invalidateWineCache(wineId) {
  await db.run('DELETE FROM extraction_cache WHERE wine_id = ?', [wineId]);
  console.log(`[Cache] Invalidated extraction cache for wine ${wineId}`);
}

module.exports = {
  generateCacheKey,
  getCachedSerpResults,
  cacheSerpResults,
  getCachedPage,
  cachePage,
  getCachedExtraction,
  cacheExtraction,
  purgeExpiredCache,
  getCacheStats,
  invalidateWineCache
};
```

### 1.3 Integrate Cache into Search Flow

Update `searchProviders.js`:

```javascript
const cache = require('./cacheService');

async function searchWithCache(queryParams, queryType, searchFn) {
  // Check cache first
  const cached = await cache.getCachedSerpResults(queryParams);
  if (cached) {
    return cached.results;
  }
  
  // Execute search
  const results = await searchFn(queryParams);
  
  // Cache results
  await cache.cacheSerpResults(queryParams, queryType, results);
  
  return results;
}

async function fetchPageWithCache(url, fetchFn) {
  // Check cache first
  const cached = await cache.getCachedPage(url);
  if (cached) {
    return {
      content: cached.content,
      success: cached.status === 'success',
      blocked: cached.status === 'blocked',
      fromCache: true
    };
  }
  
  // Execute fetch
  const result = await fetchFn(url);
  
  // Classify and cache result
  const status = classifyFetchResult(result);
  await cache.cachePage(url, result.content, status.type, result.statusCode, status.error);
  
  return result;
}
```

---

## 2. Background Job Queue

### 2.1 Migration: Create Jobs Table

Add to `migrations/009_search_cache.sql`:

```sql
-- Background job queue
CREATE TABLE IF NOT EXISTS job_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,                  -- 'rating_fetch', 'batch_fetch', 'cache_cleanup'
  status TEXT DEFAULT 'pending',           -- 'pending', 'running', 'completed', 'failed'
  priority INTEGER DEFAULT 5,              -- 1 (highest) to 10 (lowest)
  payload TEXT NOT NULL,                   -- JSON job parameters
  result TEXT,                             -- JSON result or error
  progress INTEGER DEFAULT 0,              -- 0-100
  progress_message TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_job_queue_status ON job_queue(status, scheduled_for);
CREATE INDEX idx_job_queue_type ON job_queue(job_type);

-- Job history (completed jobs moved here)
CREATE TABLE IF NOT EXISTS job_history (
  id INTEGER PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  result TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP,
  completed_at TIMESTAMP
);
```

### 2.2 Job Queue Service

Create file: `src/services/jobQueue.js`

```javascript
const db = require('../db');
const EventEmitter = require('events');

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.isProcessing = false;
    this.currentJob = null;
    this.handlers = {};
  }
  
  /**
   * Register a job handler
   */
  registerHandler(jobType, handler) {
    this.handlers[jobType] = handler;
  }
  
  /**
   * Add a job to the queue
   */
  async enqueue(jobType, payload, options = {}) {
    const { priority = 5, scheduledFor = null, maxAttempts = 3 } = options;
    
    const result = await db.run(`
      INSERT INTO job_queue (job_type, payload, priority, max_attempts, scheduled_for)
      VALUES (?, ?, ?, ?, ?)
    `, [
      jobType,
      JSON.stringify(payload),
      priority,
      maxAttempts,
      scheduledFor || new Date().toISOString()
    ]);
    
    const jobId = result.lastID;
    this.emit('job:queued', { jobId, jobType, payload });
    
    // Trigger processing if not already running
    if (!this.isProcessing) {
      setImmediate(() => this.processNext());
    }
    
    return jobId;
  }
  
  /**
   * Get job status
   */
  async getJobStatus(jobId) {
    return db.get(`
      SELECT id, job_type, status, progress, progress_message, result, created_at, started_at, completed_at
      FROM job_queue WHERE id = ?
    `, [jobId]);
  }
  
  /**
   * Update job progress
   */
  async updateProgress(jobId, progress, message = null) {
    await db.run(`
      UPDATE job_queue SET progress = ?, progress_message = ? WHERE id = ?
    `, [progress, message, jobId]);
    
    this.emit('job:progress', { jobId, progress, message });
  }
  
  /**
   * Process next job in queue
   */
  async processNext() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    try {
      // Get next pending job
      const job = await db.get(`
        SELECT * FROM job_queue 
        WHERE status = 'pending' 
          AND scheduled_for <= datetime('now')
          AND attempts < max_attempts
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
      `);
      
      if (!job) {
        this.isProcessing = false;
        return;
      }
      
      this.currentJob = job;
      
      // Mark as running
      await db.run(`
        UPDATE job_queue 
        SET status = 'running', started_at = datetime('now'), attempts = attempts + 1
        WHERE id = ?
      `, [job.id]);
      
      this.emit('job:started', { jobId: job.id, jobType: job.job_type });
      
      // Execute handler
      const handler = this.handlers[job.job_type];
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.job_type}`);
      }
      
      const payload = JSON.parse(job.payload);
      const result = await handler(payload, {
        jobId: job.id,
        updateProgress: (p, m) => this.updateProgress(job.id, p, m)
      });
      
      // Mark as completed
      const startedAt = new Date(job.started_at || job.created_at);
      const durationMs = Date.now() - startedAt.getTime();
      
      await db.run(`
        UPDATE job_queue 
        SET status = 'completed', progress = 100, result = ?, completed_at = datetime('now')
        WHERE id = ?
      `, [JSON.stringify(result), job.id]);
      
      this.emit('job:completed', { jobId: job.id, result, durationMs });
      
      // Move to history
      await this.archiveJob(job.id);
      
    } catch (error) {
      console.error(`[JobQueue] Job ${this.currentJob?.id} failed:`, error);
      
      if (this.currentJob) {
        const job = this.currentJob;
        
        if (job.attempts >= job.max_attempts) {
          // Max retries exceeded
          await db.run(`
            UPDATE job_queue 
            SET status = 'failed', result = ?, completed_at = datetime('now')
            WHERE id = ?
          `, [JSON.stringify({ error: error.message }), job.id]);
          
          this.emit('job:failed', { jobId: job.id, error: error.message });
          await this.archiveJob(job.id);
        } else {
          // Schedule retry with backoff
          const backoffMinutes = Math.pow(2, job.attempts);
          await db.run(`
            UPDATE job_queue 
            SET status = 'pending', scheduled_for = datetime('now', '+${backoffMinutes} minutes')
            WHERE id = ?
          `, [job.id]);
          
          this.emit('job:retry', { jobId: job.id, attempt: job.attempts + 1, retryIn: backoffMinutes });
        }
      }
    } finally {
      this.currentJob = null;
      this.isProcessing = false;
      
      // Process next job
      setImmediate(() => this.processNext());
    }
  }
  
  /**
   * Archive completed/failed job to history
   */
  async archiveJob(jobId) {
    await db.run(`
      INSERT INTO job_history (id, job_type, status, payload, result, duration_ms, created_at, completed_at)
      SELECT id, job_type, status, payload, result,
        CAST((julianday(completed_at) - julianday(COALESCE(started_at, created_at))) * 86400000 AS INTEGER),
        created_at, completed_at
      FROM job_queue WHERE id = ?
    `, [jobId]);
    
    await db.run('DELETE FROM job_queue WHERE id = ?', [jobId]);
  }
  
  /**
   * Start the queue processor
   */
  start() {
    console.log('[JobQueue] Starting queue processor');
    this.processNext();
    
    // Periodic check for scheduled jobs
    setInterval(() => this.processNext(), 5000);
  }
  
  /**
   * Get queue statistics
   */
  async getStats() {
    return {
      pending: await db.get('SELECT COUNT(*) as count FROM job_queue WHERE status = ?', ['pending']),
      running: await db.get('SELECT COUNT(*) as count FROM job_queue WHERE status = ?', ['running']),
      failed: await db.get('SELECT COUNT(*) as count FROM job_queue WHERE status = ?', ['failed']),
      completedToday: await db.get(`
        SELECT COUNT(*) as count FROM job_history 
        WHERE completed_at > datetime('now', '-1 day')
      `)
    };
  }
}

// Singleton instance
const queue = new JobQueue();

module.exports = queue;
```

### 2.3 Rating Fetch Job Handler

Create file: `src/jobs/ratingFetchJob.js`

```javascript
const { fetchWineRatings } = require('../services/claude');
const db = require('../db');

/**
 * Job handler for fetching wine ratings
 */
async function handleRatingFetch(payload, context) {
  const { wineId, forceRefresh = false } = payload;
  const { jobId, updateProgress } = context;
  
  // Get wine details
  await updateProgress(5, 'Loading wine details');
  const wine = await db.get('SELECT * FROM wines WHERE id = ?', [wineId]);
  
  if (!wine) {
    throw new Error(`Wine not found: ${wineId}`);
  }
  
  // Fetch ratings with progress updates
  await updateProgress(10, 'Searching for ratings');
  
  const result = await fetchWineRatings(wine, {
    forceRefresh,
    onProgress: (step, pct) => {
      const mappedProgress = 10 + Math.floor(pct * 0.85); // 10-95%
      updateProgress(mappedProgress, step);
    }
  });
  
  await updateProgress(95, 'Saving results');
  
  // Save ratings to database (existing logic)
  // ... transaction to delete old + insert new ...
  
  await updateProgress(100, 'Complete');
  
  return {
    wineId,
    wineName: wine.name,
    ratingsFound: result.ratings?.length || 0,
    competitionIndex: result.competition_index,
    criticsIndex: result.critics_index,
    communityIndex: result.community_index,
    purchaseScore: result.purchase_score
  };
}

module.exports = handleRatingFetch;
```

### 2.4 Batch Fetch Job Handler

Create file: `src/jobs/batchFetchJob.js`

```javascript
const { fetchWineRatings } = require('../services/claude');
const db = require('../db');

/**
 * Job handler for batch rating fetch
 */
async function handleBatchFetch(payload, context) {
  const { wineIds, options = {} } = payload;
  const { jobId, updateProgress } = context;
  
  const results = {
    total: wineIds.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    wines: []
  };
  
  for (let i = 0; i < wineIds.length; i++) {
    const wineId = wineIds[i];
    const progress = Math.floor((i / wineIds.length) * 100);
    
    try {
      await updateProgress(progress, `Processing wine ${i + 1} of ${wineIds.length}`);
      
      const wine = await db.get('SELECT * FROM wines WHERE id = ?', [wineId]);
      if (!wine) {
        results.skipped++;
        continue;
      }
      
      // Check if recently fetched (skip if within 24 hours unless forced)
      if (!options.forceRefresh && wine.ratings_updated_at) {
        const lastUpdate = new Date(wine.ratings_updated_at);
        const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
        if (hoursSinceUpdate < 24) {
          results.skipped++;
          results.wines.push({ wineId, status: 'skipped', reason: 'recently_updated' });
          continue;
        }
      }
      
      const fetchResult = await fetchWineRatings(wine, { forceRefresh: options.forceRefresh });
      
      results.successful++;
      results.wines.push({
        wineId,
        status: 'success',
        ratingsFound: fetchResult.ratings?.length || 0,
        purchaseScore: fetchResult.purchase_score
      });
      
      // Rate limiting: pause between wines
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      results.failed++;
      results.wines.push({
        wineId,
        status: 'failed',
        error: error.message
      });
    }
  }
  
  await updateProgress(100, 'Batch complete');
  
  return results;
}

module.exports = handleBatchFetch;
```

### 2.5 API Endpoints for Jobs

Update `routes/ratings.js`:

```javascript
const jobQueue = require('../services/jobQueue');

// Async rating fetch (returns job ID)
router.post('/wines/:wineId/ratings/fetch-async', async (req, res) => {
  try {
    const { wineId } = req.params;
    const { forceRefresh = false } = req.body;
    
    const jobId = await jobQueue.enqueue('rating_fetch', {
      wineId: parseInt(wineId),
      forceRefresh
    }, { priority: 3 });
    
    res.status(202).json({
      message: 'Rating fetch queued',
      jobId,
      statusUrl: `/api/jobs/${jobId}/status`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Batch fetch (returns job ID)
router.post('/ratings/batch-fetch', async (req, res) => {
  try {
    const { wineIds, forceRefresh = false } = req.body;
    
    if (!wineIds || !Array.isArray(wineIds)) {
      return res.status(400).json({ error: 'wineIds array required' });
    }
    
    const jobId = await jobQueue.enqueue('batch_fetch', {
      wineIds,
      options: { forceRefresh }
    }, { priority: 5 });
    
    res.status(202).json({
      message: `Batch fetch queued for ${wineIds.length} wines`,
      jobId,
      statusUrl: `/api/jobs/${jobId}/status`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Job status endpoint
router.get('/jobs/:jobId/status', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await jobQueue.getJobStatus(parseInt(jobId));
    
    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 2.6 Register Job Handlers on Startup

Update `server.js` or `app.js`:

```javascript
const jobQueue = require('./services/jobQueue');
const handleRatingFetch = require('./jobs/ratingFetchJob');
const handleBatchFetch = require('./jobs/batchFetchJob');

// Register job handlers
jobQueue.registerHandler('rating_fetch', handleRatingFetch);
jobQueue.registerHandler('batch_fetch', handleBatchFetch);
jobQueue.registerHandler('cache_cleanup', async () => {
  const { purgeExpiredCache } = require('./services/cacheService');
  return purgeExpiredCache();
});

// Start queue processor
jobQueue.start();

// Schedule periodic cache cleanup
jobQueue.enqueue('cache_cleanup', {}, {
  priority: 10,
  scheduledFor: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() // 6 hours
});
```

---

## 3. Premium Source Definitions

### 3.1 Add to Source Registry

Update `sourceRegistry.js`:

```javascript
// =============================================================================
// PREMIUM CRITICS (Paywalled but snippets often contain scores)
// =============================================================================

const premiumCritics = [
  {
    id: 'robert_parker',
    name: 'Wine Advocate / Robert Parker',
    domain: 'robertparker.com',
    alternativeDomains: ['erobertparker.com'],
    lens: 'critic',
    credibility: 0.95,
    language: 'en',
    score_type: 'points',
    score_format: '\\d{2,3}\\+?',
    paywalled: true,
    snippet_extraction: true,
    notes: 'Benchmark for Bordeaux, Napa, Rhône. Scores often in snippets.'
  },
  {
    id: 'jancis_robinson',
    name: 'Jancis Robinson',
    domain: 'jancisrobinson.com',
    lens: 'critic',
    credibility: 0.95,
    language: 'en',
    score_type: 'points',
    score_format: '\\d{1,2}(\\.5)?/20|\\d{2,3}',
    paywalled: true,
    snippet_extraction: true,
    notes: '20-point scale. Global authority, especially Burgundy.'
  },
  {
    id: 'wine_spectator',
    name: 'Wine Spectator',
    domain: 'winespectator.com',
    lens: 'critic',
    credibility: 0.92,
    language: 'en',
    score_type: 'points',
    score_format: '\\d{2,3}',
    paywalled: true,
    snippet_extraction: true,
    notes: 'US market influence. Top 100 lists.'
  },
  {
    id: 'vinous',
    name: 'Vinous (Antonio Galloni)',
    domain: 'vinous.com',
    lens: 'critic',
    credibility: 0.93,
    language: 'en',
    score_type: 'points',
    score_format: '\\d{2,3}\\+?',
    paywalled: true,
    snippet_extraction: true,
    notes: 'Italian specialist, ex-Parker reviewer.'
  },
  {
    id: 'james_suckling',
    name: 'James Suckling',
    domain: 'jamessuckling.com',
    lens: 'critic',
    credibility: 0.88,
    language: 'en',
    score_type: 'points',
    score_format: '\\d{2,3}',
    paywalled: false, // Often accessible
    snippet_extraction: true,
    notes: 'High volume, global coverage. Often in snippets.'
  },
  {
    id: 'wine_enthusiast',
    name: 'Wine Enthusiast',
    domain: 'winemag.com',
    lens: 'critic',
    credibility: 0.85,
    language: 'en',
    score_type: 'points',
    score_format: '\\d{2,3}',
    paywalled: false,
    notes: 'Broad coverage, buying guides.'
  },
  {
    id: 'decanter_reviews',
    name: 'Decanter Magazine Reviews',
    domain: 'decanter.com',
    alternativeDomains: ['awards.decanter.com'],
    lens: 'critic',
    credibility: 0.90,
    language: 'en',
    score_type: 'points',
    score_format: '\\d{2,3}',
    paywalled: false,
    notes: 'Separate from DWWA competition.'
  }
];

// =============================================================================
// ADDITIONAL REGIONAL SOURCES
// =============================================================================

const additionalRegionalSources = [
  // German
  {
    id: 'falstaff',
    name: 'Falstaff',
    domain: 'falstaff.com',
    lens: 'panel_guide',
    credibility: 0.88,
    language: 'de',
    score_type: 'points',
    score_format: '\\d{2,3}',
    regions: ['germany', 'austria'],
    notes: 'German-speaking markets authority.'
  },
  {
    id: 'weinwisser',
    name: 'Weinwisser',
    domain: 'weinwisser.com',
    lens: 'critic',
    credibility: 0.82,
    language: 'de',
    score_type: 'points',
    score_format: '\\d{2,3}',
    regions: ['germany'],
    notes: 'German wine focus.'
  },
  
  // Portuguese
  {
    id: 'revista_vinhos',
    name: 'Revista de Vinhos',
    domain: 'revistadevinhos.pt',
    lens: 'panel_guide',
    credibility: 0.85,
    language: 'pt',
    score_type: 'points',
    score_format: '\\d{2,3}',
    regions: ['portugal'],
    notes: 'Portuguese wine authority.'
  },
  
  // Greek
  {
    id: 'elloinos',
    name: 'Elloinos',
    domain: 'elloinos.com',
    lens: 'panel_guide',
    credibility: 0.80,
    language: 'el',
    score_type: 'points',
    score_format: '\\d{2,3}',
    regions: ['greece'],
    notes: 'Greek wine specialist.'
  },
  
  // Swiss
  {
    id: 'vinum',
    name: 'Vinum',
    domain: 'vinum.eu',
    lens: 'panel_guide',
    credibility: 0.85,
    language: 'de',
    score_type: 'points',
    score_format: '\\d{2,3}',
    regions: ['switzerland', 'germany', 'austria'],
    notes: 'Swiss wine guide.'
  }
];

// =============================================================================
// AGGREGATE SOURCES
// =============================================================================

const aggregateSources = [
  {
    id: 'wine_searcher',
    name: 'Wine-Searcher',
    domain: 'wine-searcher.com',
    lens: 'aggregate',
    credibility: 0.75,
    language: 'en',
    score_type: 'aggregate',
    notes: 'Aggregates scores from multiple critics. Useful for consensus view.'
  },
  {
    id: 'winecritic',
    name: 'The Wine Critic',
    domain: 'thewinecritic.com',
    lens: 'aggregate',
    credibility: 0.70,
    language: 'en',
    score_type: 'aggregate',
    notes: 'Aggregates professional reviews.'
  }
];

module.exports = {
  premiumCritics,
  additionalRegionalSources,
  aggregateSources,
  // ... existing exports
};
```

### 3.2 Update Region-Source Priority

```javascript
const regionSourcePriority = {
  // Existing...
  
  // Add premium critics as secondary sources for premium wine regions
  'France': ['guide_hachette', 'rvf', 'bettane_desseauve', 'decanter', 
             'jancis_robinson', 'robert_parker', 'wine_spectator', 'vivino'],
  
  'Italy': ['gambero_rosso', 'vinous', 'doctor_wine', 'bibenda', 
            'james_suckling', 'wine_spectator', 'decanter', 'vivino'],
  
  'USA': ['wine_spectator', 'wine_enthusiast', 'robert_parker', 
          'vinous', 'james_suckling', 'decanter', 'vivino'],
  
  'Germany': ['falstaff', 'weinwisser', 'vinum', 'jancis_robinson', 
              'decanter', 'vivino'],
  
  'Austria': ['falstaff', 'vinum', 'decanter', 'vivino'],
  
  'Portugal': ['revista_vinhos', 'jancis_robinson', 'decanter', 'vivino'],
  
  'Greece': ['elloinos', 'decanter', 'vivino'],
  
  // Premium-tier wines get extra critic coverage
  '_premium': ['robert_parker', 'jancis_robinson', 'vinous', 
               'wine_spectator', 'james_suckling']
};
```

---

## 4. Vintage Sensitivity Configuration

### 4.1 Add to Source Registry or Separate Config

Create file: `src/config/vintageSensitivity.js`

```javascript
/**
 * Vintage sensitivity determines whether "inferred" vintage matches are acceptable
 * 
 * HIGH: Only exact vintage matches valid (age-worthy wines where each vintage differs)
 * MEDIUM: Accept ±1 year for similar vintages
 * LOW: Accept ±2 years or NV (everyday wines, consistent house styles)
 */

const vintageSensitivityByType = {
  // High sensitivity - each vintage is unique
  high: [
    // French
    'barolo', 'barbaresco', 'brunello', 'burgundy', 'bordeaux_classified',
    'champagne_vintage', 'hermitage', 'cote_rotie', 'cornas',
    'sauternes', 'alsace_grand_cru',
    
    // Italian
    'amarone', 'taurasi', 'brunello_di_montalcino',
    
    // Spanish
    'rioja_gran_reserva', 'ribera_gran_reserva', 'priorat',
    
    // German
    'trockenbeerenauslese', 'auslese', 'spatlese',
    
    // Port
    'vintage_port',
    
    // Premium New World
    'napa_cult', 'penfolds_grange', 'hill_of_grace'
  ],
  
  // Medium sensitivity - vintage matters but similar years comparable
  medium: [
    // French
    'chablis', 'rhone', 'loire', 'alsace', 'bordeaux',
    
    // Italian
    'chianti_classico', 'valpolicella_ripasso', 'barolo_entry',
    
    // Spanish
    'rioja_reserva', 'ribera_reserva',
    
    // New World premium
    'barossa_shiraz', 'margaret_river', 'stellenbosch', 'mendoza_premium',
    
    // Most aged wines
    'oak_aged_white', 'reserve_red'
  ],
  
  // Low sensitivity - consistent style, vintage less critical
  low: [
    // Everyday whites
    'marlborough_sauvignon', 'pinot_grigio', 'prosecco', 'cava',
    'albarino', 'verdejo', 'vermentino',
    
    // Everyday reds
    'chianti', 'cotes_du_rhone', 'malbec', 'carmenere',
    
    // House styles
    'nv_champagne', 'nv_sparkling', 'ruby_port', 'tawny_port',
    
    // Commercial brands
    'commercial_brand', 'supermarket_wine'
  ]
};

/**
 * Determine vintage sensitivity for a wine
 */
function getVintageSensitivity(wine) {
  const { grape, region, style, price } = wine;
  
  // Price-based override: expensive wines get high sensitivity
  if (price && price >= 75) return 'high';
  if (price && price >= 30) return 'medium';
  if (price && price < 12) return 'low';
  
  // Check explicit matches
  const normRegion = normaliseForMatch(region);
  const normStyle = normaliseForMatch(style);
  const normGrape = normaliseForMatch(grape);
  
  for (const [sensitivity, types] of Object.entries(vintageSensitivityByType)) {
    for (const type of types) {
      if (normRegion?.includes(type) || normStyle?.includes(type) || normGrape?.includes(type)) {
        return sensitivity;
      }
    }
  }
  
  // Default based on colour
  const colour = wine.colour?.toLowerCase();
  if (colour === 'sparkling') return 'medium';
  if (colour === 'dessert') return 'medium';
  if (colour === 'white' || colour === 'rose') return 'low';
  
  return 'medium'; // Default for reds
}

function normaliseForMatch(value) {
  if (!value) return null;
  return value.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Check if a vintage match is acceptable
 */
function isVintageMatchAcceptable(wine, wineVintage, ratingVintage, matchType) {
  if (matchType === 'exact') return true;
  if (!wineVintage) return true; // NV wine
  
  const sensitivity = getVintageSensitivity(wine);
  
  if (matchType === 'non_vintage') {
    return sensitivity === 'low';
  }
  
  if (matchType === 'inferred') {
    const diff = Math.abs(wineVintage - ratingVintage);
    
    switch (sensitivity) {
      case 'high': return false; // Never accept inferred
      case 'medium': return diff <= 1;
      case 'low': return diff <= 2;
      default: return diff <= 1;
    }
  }
  
  return false;
}

module.exports = {
  getVintageSensitivity,
  isVintageMatchAcceptable,
  vintageSensitivityByType
};
```

### 4.2 Apply in Rating Extraction

Update extraction post-processing in `claude.js`:

```javascript
const { isVintageMatchAcceptable } = require('../config/vintageSensitivity');

function filterRatingsByVintageSensitivity(wine, ratings) {
  return ratings.filter(rating => {
    const acceptable = isVintageMatchAcceptable(
      wine,
      wine.vintage,
      rating.vintage_year,
      rating.vintage_match
    );
    
    if (!acceptable) {
      console.log(`[Vintage] Rejecting ${rating.source} rating: ${rating.vintage_match} match for sensitive wine`);
    }
    
    return acceptable;
  });
}
```

---

## 5. Fetch Result Classification

### 5.1 Standardised Classification

Create file: `src/services/fetchClassifier.js`

```javascript
/**
 * Classify fetch results for consistent handling
 */

const CLASSIFICATION = {
  SUCCESS: 'success',
  BLOCKED: 'blocked',
  AUTH_REQUIRED: 'auth_required',
  CAPTCHA: 'captcha',
  PAYWALL: 'paywall',
  SPA_SHELL: 'spa_shell',
  INSUFFICIENT_CONTENT: 'insufficient_content',
  TIMEOUT: 'timeout',
  ERROR: 'error'
};

const MIN_CONTENT_LENGTH = 500;
const SPA_SHELL_INDICATORS = [
  '<div id="__next"',
  '<div id="root"',
  'window.__NUXT__',
  'window.__INITIAL_STATE__'
];

const CAPTCHA_INDICATORS = [
  'captcha',
  'challenge-form',
  'cf-challenge',
  'recaptcha',
  'hcaptcha'
];

const LOGIN_INDICATORS = [
  'sign in',
  'log in',
  'login',
  'create account',
  'subscribe to access',
  'members only'
];

const PAYWALL_INDICATORS = [
  'subscribe to read',
  'premium content',
  'exclusive access',
  'unlock this article',
  'purchase to continue'
];

/**
 * Classify a fetch result
 * @returns {{ type: string, retryable: boolean, useSnippet: boolean, message: string }}
 */
function classifyFetchResult(response, content) {
  const statusCode = response?.status || response?.statusCode;
  const contentLength = content?.length || 0;
  const lowerContent = content?.toLowerCase() || '';
  
  // HTTP-level classification
  if (statusCode === 403) {
    return {
      type: CLASSIFICATION.BLOCKED,
      retryable: false,
      useSnippet: true,
      message: 'Access forbidden (403)'
    };
  }
  
  if (statusCode === 401) {
    return {
      type: CLASSIFICATION.AUTH_REQUIRED,
      retryable: false,
      useSnippet: true,
      message: 'Authentication required (401)'
    };
  }
  
  if (statusCode === 429) {
    return {
      type: CLASSIFICATION.BLOCKED,
      retryable: true,
      useSnippet: true,
      message: 'Rate limited (429)'
    };
  }
  
  if (statusCode >= 500) {
    return {
      type: CLASSIFICATION.ERROR,
      retryable: true,
      useSnippet: false,
      message: `Server error (${statusCode})`
    };
  }
  
  // Content-level classification
  if (!content || contentLength < MIN_CONTENT_LENGTH) {
    // Check if it's an SPA shell
    if (SPA_SHELL_INDICATORS.some(ind => lowerContent.includes(ind.toLowerCase()))) {
      return {
        type: CLASSIFICATION.SPA_SHELL,
        retryable: true, // Could retry with Web Unlocker
        useSnippet: true,
        message: 'JavaScript-rendered page (SPA shell only)'
      };
    }
    
    return {
      type: CLASSIFICATION.INSUFFICIENT_CONTENT,
      retryable: true,
      useSnippet: true,
      message: `Content too short (${contentLength} chars)`
    };
  }
  
  // Check for captcha
  if (CAPTCHA_INDICATORS.some(ind => lowerContent.includes(ind))) {
    return {
      type: CLASSIFICATION.CAPTCHA,
      retryable: true,
      useSnippet: true,
      message: 'Captcha challenge detected'
    };
  }
  
  // Check for login wall (only if content is short)
  if (contentLength < 2000 && LOGIN_INDICATORS.some(ind => lowerContent.includes(ind))) {
    return {
      type: CLASSIFICATION.AUTH_REQUIRED,
      retryable: false,
      useSnippet: true,
      message: 'Login required to view content'
    };
  }
  
  // Check for paywall
  if (PAYWALL_INDICATORS.some(ind => lowerContent.includes(ind))) {
    return {
      type: CLASSIFICATION.PAYWALL,
      retryable: false,
      useSnippet: true,
      message: 'Content behind paywall'
    };
  }
  
  // Success
  return {
    type: CLASSIFICATION.SUCCESS,
    retryable: false,
    useSnippet: false,
    message: 'Content fetched successfully'
  };
}

/**
 * Determine if a domain is known to require special handling
 */
const KNOWN_PROBLEMATIC_DOMAINS = {
  'vivino.com': { issue: 'spa', solution: 'web_unlocker' },
  'cellartracker.com': { issue: 'auth', solution: 'snippet' },
  'winemag.com': { issue: 'blocked', solution: 'snippet' },
  'jancisrobinson.com': { issue: 'paywall', solution: 'snippet' },
  'robertparker.com': { issue: 'paywall', solution: 'snippet' },
  'winespectator.com': { issue: 'paywall', solution: 'snippet' }
};

function getDomainIssue(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return KNOWN_PROBLEMATIC_DOMAINS[hostname] || null;
  } catch {
    return null;
  }
}

module.exports = {
  classifyFetchResult,
  getDomainIssue,
  CLASSIFICATION,
  MIN_CONTENT_LENGTH
};
```

---

## 6. Updated Extraction Prompt with Score Formats

### 6.1 Dynamic Prompt Builder

Update `claude.js`:

```javascript
const scoreFormats = require('../config/scoreFormats');

function buildExtractionPrompt(wineName, vintage, pages, sources) {
  // Get relevant score formats for the sources found
  const relevantFormats = sources
    .map(s => scoreFormats[s.id])
    .filter(Boolean);
  
  const scoreFormatInstructions = relevantFormats.length > 0
    ? `
Score formats to recognise:
${relevantFormats.map(f => `- ${f.name}: ${f.examples.join(', ')} → normalise as ${f.normalisation_hint}`).join('\n')}
`
    : '';
  
  return `
Extract wine ratings for "${wineName}" ${vintage || ''} from the following pages.

${scoreFormatInstructions}

For each rating found, provide a JSON object with:
- source: source identifier (lowercase, e.g., "halliday", "vivino", "robert_parker")
- lens: "competition" | "panel_guide" | "critic" | "community" | "aggregate"
- score_type: "medal" | "points" | "stars" | "symbol"
- raw_score: exactly as shown (e.g., "Gold", "92", "4.2", "Tre Bicchieri", "17.5/20")
- normalised_score: converted to 100-point scale:
  - Points out of 100: use as-is
  - Points out of 20: multiply by 5
  - Stars out of 5: multiply by 20
  - Medals: Trophy/Platinum=98, Grand Gold=96, Gold=94, Silver=88, Bronze=82
  - Tre Bicchieri=95, Due Bicchieri Rossi=90, Due Bicchieri=87
  - Platter's 5 stars=100, 4.5 stars=95, 4 stars=90
- drinking_window: object or null, containing:
  - drink_from: year (integer) when wine becomes ready
  - drink_by: year (integer) when wine should be consumed by
  - peak: year (integer) when wine is at optimum
  - raw_text: original text (e.g., "Drink 2024-2030")
- vintage_year: the vintage this rating applies to (integer or null)
- vintage_match: "exact" | "inferred" | "non_vintage"
- evidence_excerpt: brief quote proving the rating (max 100 chars)
- match_confidence: "high" | "medium" | "low"

IMPORTANT:
- Only extract ratings that clearly apply to "${wineName}"
- If vintage ${vintage} is mentioned, mark as "exact" match
- If a nearby vintage (±2 years) is rated, include with "inferred" match
- Ignore ratings for different wines or unclear matches

Return as JSON array. If no ratings found, return empty array [].

--- PAGES ---
${pages.map((p, i) => `
--- PAGE ${i + 1}: ${p.source} (${p.url}) ---
${p.content.substring(0, 8000)}
`).join('\n')}
`;
}
```

### 6.2 Score Formats Config

Create file: `src/config/scoreFormats.js`

```javascript
module.exports = {
  robert_parker: {
    name: 'Wine Advocate / Robert Parker',
    type: 'points',
    examples: ['92', '95+', '88-90'],
    normalisation_hint: 'use as-is (already 100-point)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3})/);
      return match ? parseInt(match[1]) : null;
    }
  },
  
  jancis_robinson: {
    name: 'Jancis Robinson',
    type: 'points',
    examples: ['17/20', '16.5', '18.5/20'],
    normalisation_hint: 'multiply by 5',
    normalise: (raw) => {
      const match = raw.match(/(\d{1,2}(?:\.\d)?)/);
      if (match) {
        const score = parseFloat(match[1]);
        return score <= 20 ? Math.round(score * 5) : score;
      }
      return null;
    }
  },
  
  gambero_rosso: {
    name: 'Gambero Rosso',
    type: 'symbol',
    examples: ['Tre Bicchieri', 'Due Bicchieri Rossi', 'Due Bicchieri'],
    normalisation_hint: 'Tre Bicchieri=95, Due Bicchieri Rossi=90, Due Bicchieri=87',
    normalise: (raw) => {
      const map = {
        'tre bicchieri': 95,
        'due bicchieri rossi': 90,
        'due bicchieri': 87,
        'un bicchiere': 80
      };
      return map[raw.toLowerCase()] || null;
    }
  },
  
  platters: {
    name: "Platter's Wine Guide",
    type: 'stars',
    examples: ['5 stars', '4.5 stars', '4 stars'],
    normalisation_hint: '5 stars=100, 4.5=95, 4=90, 3.5=85, 3=80',
    normalise: (raw) => {
      const match = raw.match(/(\d(?:\.\d)?)\s*stars?/i);
      if (match) {
        const stars = parseFloat(match[1]);
        return Math.round(stars * 20);
      }
      return null;
    }
  },
  
  guide_hachette: {
    name: 'Guide Hachette',
    type: 'symbol',
    examples: ['★★★', '★★', '★', 'Coup de Cœur'],
    normalisation_hint: '★★★=94, ★★=88, ★=82, Coup de Cœur=96',
    normalise: (raw) => {
      if (raw.includes('Coup de') || raw.includes('coup de')) return 96;
      const stars = (raw.match(/★/g) || []).length;
      if (stars === 3) return 94;
      if (stars === 2) return 88;
      if (stars === 1) return 82;
      return null;
    }
  },
  
  bibenda: {
    name: 'Bibenda',
    type: 'symbol',
    examples: ['5 grappoli', 'cinque grappoli', '4 grappoli'],
    normalisation_hint: '5 grappoli=95, 4 grappoli=90, 3 grappoli=85',
    normalise: (raw) => {
      const map = {
        '5': 95, 'cinque': 95,
        '4': 90, 'quattro': 90,
        '3': 85, 'tre': 85,
        '2': 80, 'due': 80
      };
      const match = raw.match(/(\d|cinque|quattro|tre|due)/i);
      return match ? map[match[1].toLowerCase()] || null : null;
    }
  },
  
  vivino: {
    name: 'Vivino',
    type: 'stars',
    examples: ['4.2', '3.8', '4.5/5'],
    normalisation_hint: 'multiply by 20',
    normalise: (raw) => {
      const match = raw.match(/(\d(?:\.\d)?)/);
      if (match) {
        const rating = parseFloat(match[1]);
        return rating <= 5 ? Math.round(rating * 20) : rating;
      }
      return null;
    }
  },
  
  cellartracker: {
    name: 'CellarTracker',
    type: 'points',
    examples: ['CT89', '91', '87.5'],
    normalisation_hint: 'use as-is (100-point scale)',
    normalise: (raw) => {
      const match = raw.match(/(\d{2,3}(?:\.\d)?)/);
      return match ? Math.round(parseFloat(match[1])) : null;
    }
  },
  
  // Competition medals
  competition_medal: {
    name: 'Competition Medal',
    type: 'medal',
    examples: ['Gold', 'Silver', 'Bronze', 'Trophy', 'Grand Gold'],
    normalisation_hint: 'Trophy=98, Grand Gold=96, Gold=94, Silver=88, Bronze=82',
    normalise: (raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('trophy') || lower.includes('platinum')) return 98;
      if (lower.includes('grand gold') || lower.includes('double gold')) return 96;
      if (lower.includes('gold')) return 94;
      if (lower.includes('silver')) return 88;
      if (lower.includes('bronze')) return 82;
      if (lower.includes('commended') || lower.includes('mention')) return 78;
      return null;
    }
  }
};
```

---

## 7. Frontend: Job Progress Polling

### 7.1 Update Ratings UI

Add to `public/js/ratings.js`:

```javascript
/**
 * Fetch ratings asynchronously with progress updates
 */
async function fetchRatingsAsync(wineId) {
  const button = document.getElementById('refresh-ratings-btn');
  const progressContainer = document.getElementById('ratings-progress');
  const progressBar = document.getElementById('ratings-progress-bar');
  const progressText = document.getElementById('ratings-progress-text');
  
  try {
    // Disable button, show progress
    button.disabled = true;
    button.textContent = 'Fetching...';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = 'Queuing job...';
    
    // Queue the job
    const response = await fetch(`/api/wines/${wineId}/ratings/fetch-async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRefresh: true })
    });
    
    if (!response.ok) throw new Error('Failed to queue rating fetch');
    
    const { jobId } = await response.json();
    
    // Poll for progress
    await pollJobProgress(jobId, (progress, message) => {
      progressBar.style.width = `${progress}%`;
      progressText.textContent = message || `${progress}%`;
    });
    
    // Job complete - reload ratings
    progressText.textContent = 'Loading results...';
    await loadWineRatings(wineId);
    
    progressContainer.style.display = 'none';
    button.disabled = false;
    button.textContent = 'Refresh Ratings';
    
  } catch (error) {
    console.error('Rating fetch failed:', error);
    progressText.textContent = `Error: ${error.message}`;
    button.disabled = false;
    button.textContent = 'Retry';
  }
}

/**
 * Poll job status until complete
 */
async function pollJobProgress(jobId, onProgress) {
  const pollInterval = 1000; // 1 second
  const maxPolls = 120; // 2 minutes max
  
  for (let i = 0; i < maxPolls; i++) {
    const response = await fetch(`/api/jobs/${jobId}/status`);
    const status = await response.json();
    
    onProgress(status.progress || 0, status.progress_message);
    
    if (status.status === 'completed') {
      return status.result;
    }
    
    if (status.status === 'failed') {
      const error = status.result ? JSON.parse(status.result).error : 'Unknown error';
      throw new Error(error);
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  throw new Error('Job timed out');
}
```

### 7.2 Progress Bar HTML

Add to wine modal in `index.html`:

```html
<div id="ratings-progress" class="progress-container" style="display: none;">
  <div class="progress-bar-wrapper">
    <div id="ratings-progress-bar" class="progress-bar"></div>
  </div>
  <span id="ratings-progress-text" class="progress-text">Starting...</span>
</div>
```

### 7.3 Progress Bar CSS

```css
.progress-container {
  margin: 1rem 0;
}

.progress-bar-wrapper {
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #4CAF50, #8BC34A);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-text {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: #666;
}
```

---

## 8. File Summary

| File | Action | Description |
|------|--------|-------------|
| `migrations/009_search_cache.sql` | Create | Cache tables + job queue |
| `src/services/cacheService.js` | Create | Cache operations |
| `src/services/jobQueue.js` | Create | Background job processing |
| `src/services/fetchClassifier.js` | Create | Standardised fetch result handling |
| `src/jobs/ratingFetchJob.js` | Create | Single wine fetch handler |
| `src/jobs/batchFetchJob.js` | Create | Batch fetch handler |
| `src/config/scoreFormats.js` | Create | Score normalisation definitions |
| `src/config/vintageSensitivity.js` | Create | Vintage match rules |
| `src/config/sourceRegistry.js` | Update | Add premium critics + regions |
| `src/services/searchProviders.js` | Update | Integrate caching |
| `src/services/claude.js` | Update | Dynamic prompt building |
| `src/routes/ratings.js` | Update | Async endpoints + job status |
| `public/js/ratings.js` | Update | Progress polling UI |
| `public/index.html` | Update | Progress bar HTML |
| `public/css/styles.css` | Update | Progress bar styles |
| `server.js` | Update | Register job handlers |

---

## 9. Testing Checklist

| Test | Expected Result |
|------|-----------------|
| Fetch same wine twice within 24h | Second fetch uses SERP cache |
| Fetch blocked page twice | Second fetch uses page cache, skips retry |
| Queue rating fetch | Returns 202 + job ID immediately |
| Poll job status | Shows progress updates |
| Batch fetch 10 wines | Processes with rate limiting, shows aggregate result |
| Fetch Barolo with inferred vintage | Rejects inferred match (high sensitivity) |
| Fetch Marlborough SB with inferred vintage | Accepts ±1 year (low sensitivity) |
| Cache cleanup job | Removes expired entries |

---

## 10. Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Single wine fetch (cold) | 15-25s | 12-18s |
| Single wine fetch (cached SERP) | 15-25s | 8-14s |
| Single wine fetch (fully cached) | 15-25s | <2s |
| UI responsiveness | Blocked 15-25s | Immediate (async) |
| Batch 50 wines | N/A (not supported) | ~5 minutes |

---

## 11. Future Considerations

1. **WebSocket for real-time updates** - Replace polling with push
2. **Redis cache** - For multi-instance deployments
3. **Competition database APIs** - Direct IWC/DWWA integration
4. **ML re-ranking** - Local model to filter irrelevant results before Claude
5. **User feedback loop** - Flag incorrect extractions to improve prompts
