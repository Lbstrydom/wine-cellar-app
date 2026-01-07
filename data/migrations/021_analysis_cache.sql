-- Migration 021: Analysis Cache Table
-- Stores cellar analysis results to avoid expensive recalculation

CREATE TABLE IF NOT EXISTS cellar_analysis_cache (
  id SERIAL PRIMARY KEY,
  analysis_type VARCHAR(50) NOT NULL,      -- 'full', 'fridge', 'zones'
  analysis_data JSONB NOT NULL,            -- The cached analysis result
  wine_count INTEGER,                      -- For quick invalidation check
  slot_hash VARCHAR(64),                   -- MD5 hash of wine_id assignments
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  UNIQUE(analysis_type)
);

-- Index for quick lookup by type
CREATE INDEX IF NOT EXISTS idx_analysis_cache_type ON cellar_analysis_cache(analysis_type);

-- Index for expiration checks
CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires ON cellar_analysis_cache(expires_at);
