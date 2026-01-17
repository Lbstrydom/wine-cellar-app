-- Migration 044: Fix search_cache unique constraint for PostgreSQL
-- The ON CONFLICT(cache_key) clause requires a unique constraint to exist
-- This migration ensures the constraint exists

-- Add unique constraint on cache_key if it doesn't exist
DO $$
BEGIN
  -- Check if the unique constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'search_cache_cache_key_key'
    OR conname = 'uq_search_cache_cache_key'
  ) THEN
    -- Add unique constraint
    ALTER TABLE search_cache ADD CONSTRAINT uq_search_cache_cache_key UNIQUE (cache_key);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- Also ensure the index exists
CREATE INDEX IF NOT EXISTS idx_search_cache_cache_key ON search_cache(cache_key);
