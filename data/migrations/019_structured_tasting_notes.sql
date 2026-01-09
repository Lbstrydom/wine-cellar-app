-- Migration 019: Structured tasting notes v2.0
-- Implements Wine Detail Panel Spec v2 requirements

-- Add structured tasting notes columns to wines table
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_notes_structured TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_notes_version TEXT DEFAULT '2.0';
ALTER TABLE wines ADD COLUMN IF NOT EXISTS normaliser_version TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_notes_generated_at TIMESTAMP;

-- Keep legacy rendered text for fallback/migration
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_notes_rendered TEXT;

-- Flags for moderation
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_notes_needs_review BOOLEAN DEFAULT FALSE;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_notes_user_reported BOOLEAN DEFAULT FALSE;

-- Serving temperature cache (speeds up lookups)
ALTER TABLE wines ADD COLUMN IF NOT EXISTS serving_temp_min_c INTEGER;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS serving_temp_max_c INTEGER;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS serving_temp_source TEXT;

-- Create tasting note sources table for provenance tracking
CREATE TABLE IF NOT EXISTS tasting_note_sources (
  id SERIAL PRIMARY KEY,
  wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('critic', 'merchant', 'community', 'producer')),
  source_url TEXT,
  snippet TEXT,
  retrieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wine_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_tns_wine_id ON tasting_note_sources(wine_id);
CREATE INDEX IF NOT EXISTS idx_tns_source_type ON tasting_note_sources(source_type);

-- Create tasting note reports table for user feedback
CREATE TABLE IF NOT EXISTS tasting_note_reports (
  id SERIAL PRIMARY KEY,
  wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('inaccurate', 'missing_info', 'wrong_wine', 'other')),
  details TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tnr_wine_id ON tasting_note_reports(wine_id);
CREATE INDEX IF NOT EXISTS idx_tnr_status ON tasting_note_reports(status);

-- Index for wines with structured notes
CREATE INDEX IF NOT EXISTS idx_wines_structured_notes ON wines(id) WHERE tasting_notes_structured IS NOT NULL;
