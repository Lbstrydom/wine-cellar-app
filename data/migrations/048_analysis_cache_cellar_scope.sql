-- Migration 048: Add cellar_id to cellar_analysis_cache
-- Scopes analysis cache per cellar for multi-tenant isolation

-- Add cellar_id column (nullable first for backfill)
ALTER TABLE cellar_analysis_cache ADD COLUMN IF NOT EXISTS cellar_id UUID;

-- Drop the old unique constraint on analysis_type alone
ALTER TABLE cellar_analysis_cache DROP CONSTRAINT IF EXISTS cellar_analysis_cache_analysis_type_key;

-- Add composite unique constraint (cellar_id + analysis_type)
ALTER TABLE cellar_analysis_cache ADD CONSTRAINT uq_analysis_cache_cellar_type
  UNIQUE (cellar_id, analysis_type);

-- Clear any existing unscoped cache entries (they're stale anyway)
DELETE FROM cellar_analysis_cache WHERE cellar_id IS NULL;

-- Make cellar_id NOT NULL now that old rows are cleared
ALTER TABLE cellar_analysis_cache ALTER COLUMN cellar_id SET NOT NULL;
