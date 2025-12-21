-- Migration: Add wine ratings tables and columns
-- Phase 4: Wine Ratings Aggregation

-- Wine ratings table for individual ratings from various sources
CREATE TABLE IF NOT EXISTS wine_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL,
  vintage INTEGER,                        -- NULL if non-vintage-specific

  -- Source info
  source TEXT NOT NULL,                   -- 'decanter', 'iwc', 'vivino', etc.
  source_lens TEXT NOT NULL,              -- 'competition', 'critics', 'community'

  -- Raw score (as received)
  score_type TEXT NOT NULL,               -- 'medal', 'points', 'stars'
  raw_score TEXT NOT NULL,                -- 'Gold', '92', '4.1'
  raw_score_numeric REAL,                 -- Numeric value if applicable

  -- Normalized score (for aggregation)
  normalized_min REAL NOT NULL,           -- Lower bound of band
  normalized_max REAL NOT NULL,           -- Upper bound of band
  normalized_mid REAL NOT NULL,           -- Midpoint (used for calculations)

  -- Metadata
  award_name TEXT,                        -- 'Best in Show', 'Regional Trophy', etc.
  competition_year INTEGER,
  reviewer_name TEXT,                     -- For critic sources
  rating_count INTEGER,                   -- For crowd-sourced (Vivino)

  -- Evidence (for verification)
  source_url TEXT,
  evidence_excerpt TEXT,                  -- Short quoted snippet from source
  matched_wine_label TEXT,                -- Exact label/name from source

  -- Tracking
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  vintage_match TEXT DEFAULT 'exact',     -- 'exact', 'inferred', 'non_vintage', 'mismatch'
  match_confidence TEXT DEFAULT 'high',   -- 'high', 'medium', 'low'

  -- User overrides
  is_user_override BOOLEAN DEFAULT 0,
  override_normalized_mid REAL,           -- User's corrected value
  override_note TEXT,

  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE,
  UNIQUE(wine_id, vintage, source, competition_year, award_name)
);

CREATE INDEX IF NOT EXISTS idx_ratings_wine ON wine_ratings(wine_id);
CREATE INDEX IF NOT EXISTS idx_ratings_wine_vintage ON wine_ratings(wine_id, vintage);
CREATE INDEX IF NOT EXISTS idx_ratings_lens ON wine_ratings(source_lens);

-- User settings table
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default preference slider (+40 competition bias)
INSERT OR IGNORE INTO user_settings (key, value) VALUES ('rating_preference', '40');

-- Add rating columns to wines table (cached aggregates)
-- Note: SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we check first
-- These will be run individually with error handling in db/index.js

-- ALTER TABLE wines ADD COLUMN country TEXT;
-- ALTER TABLE wines ADD COLUMN competition_index REAL;
-- ALTER TABLE wines ADD COLUMN critics_index REAL;
-- ALTER TABLE wines ADD COLUMN community_index REAL;
-- ALTER TABLE wines ADD COLUMN purchase_score REAL;
-- ALTER TABLE wines ADD COLUMN purchase_stars REAL;
-- ALTER TABLE wines ADD COLUMN confidence_level TEXT;
-- ALTER TABLE wines ADD COLUMN ratings_updated_at DATETIME;
