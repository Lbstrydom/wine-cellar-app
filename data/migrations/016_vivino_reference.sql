-- Migration 016: Add Vivino reference fields to wines table
-- Enables storing confirmed wine matches from Vivino for accurate rating lookups

-- Add Vivino wine ID (unique identifier on Vivino)
ALTER TABLE wines ADD COLUMN vivino_id INTEGER;

-- Add Vivino URL for direct linking
ALTER TABLE wines ADD COLUMN vivino_url TEXT;

-- Add flag to indicate if wine match was user-confirmed
ALTER TABLE wines ADD COLUMN vivino_confirmed INTEGER DEFAULT 0;

-- Add timestamp for when confirmation happened
ALTER TABLE wines ADD COLUMN vivino_confirmed_at DATETIME;

-- Index for efficient lookups by Vivino ID
CREATE INDEX IF NOT EXISTS idx_wines_vivino_id ON wines(vivino_id);
