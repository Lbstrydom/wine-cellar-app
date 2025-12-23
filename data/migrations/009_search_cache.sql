-- Phase 8: Search Cache and Job Queue
-- Adds caching layer for SERP results, page content, and Claude extractions
-- Plus background job queue for async processing

-- =============================================================================
-- SERP Result Cache
-- =============================================================================
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

CREATE INDEX IF NOT EXISTS idx_search_cache_key ON search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);

-- =============================================================================
-- Page Content Cache
-- =============================================================================
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

CREATE INDEX IF NOT EXISTS idx_page_cache_hash ON page_cache(url_hash);
CREATE INDEX IF NOT EXISTS idx_page_cache_expires ON page_cache(expires_at);

-- =============================================================================
-- Extraction Cache (Claude results)
-- =============================================================================
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

CREATE INDEX IF NOT EXISTS idx_extraction_cache_wine ON extraction_cache(wine_id);
CREATE INDEX IF NOT EXISTS idx_extraction_cache_expires ON extraction_cache(expires_at);

-- =============================================================================
-- Cache Configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS cache_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO cache_config (key, value, description) VALUES
  ('serp_ttl_hours', '24', 'SERP results cache duration'),
  ('page_ttl_hours', '168', 'Page content cache duration (7 days)'),
  ('extraction_ttl_hours', '720', 'Extraction cache duration (30 days)'),
  ('blocked_page_ttl_hours', '24', 'Blocked page retry interval'),
  ('cache_cleanup_interval_hours', '6', 'How often to purge expired cache');

-- =============================================================================
-- Background Job Queue
-- =============================================================================
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

CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_job_queue_type ON job_queue(job_type);

-- =============================================================================
-- Job History (completed jobs moved here)
-- =============================================================================
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

CREATE INDEX IF NOT EXISTS idx_job_history_type ON job_history(job_type);
CREATE INDEX IF NOT EXISTS idx_job_history_completed ON job_history(completed_at);
