-- Migration 015: Add tasting profile column for structured wine descriptors
-- This stores AI-extracted tasting profiles as JSON

-- Add tasting_profile_json column to wines table
ALTER TABLE wines ADD COLUMN tasting_profile_json TEXT;

-- Index for wines with profiles (for filtering)
CREATE INDEX IF NOT EXISTS idx_wines_has_profile ON wines(id) WHERE tasting_profile_json IS NOT NULL;

-- Create tasting_profile_extractions table to track extraction history
CREATE TABLE IF NOT EXISTS tasting_profile_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL,
  source_id TEXT,                    -- 'decanter', 'vivino', 'user', etc.
  source_note TEXT,                  -- Original tasting note text
  extraction_method TEXT NOT NULL,   -- 'ai', 'deterministic', 'merged'
  confidence REAL,                   -- 0.0 to 1.0
  profile_json TEXT NOT NULL,        -- The extracted profile JSON
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

-- Index for looking up extractions by wine
CREATE INDEX IF NOT EXISTS idx_profile_extractions_wine ON tasting_profile_extractions(wine_id);

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_profile_extractions_source ON tasting_profile_extractions(source_id);
