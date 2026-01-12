-- Migration 031: Add cellar_id to wines table
-- Part of Multi-User Implementation Phase 1
-- Scopes wine records to a specific cellar

-- Add cellar_id column (nullable initially for backfill)
ALTER TABLE wines ADD COLUMN IF NOT EXISTS cellar_id UUID;

-- Add foreign key constraint
ALTER TABLE wines ADD CONSTRAINT fk_wines_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;

-- Add index for cellar-scoped queries (all wine queries will filter by cellar_id)
CREATE INDEX IF NOT EXISTS idx_wines_cellar ON wines(cellar_id);

-- Composite index for common query pattern (cellar + colour filter)
CREATE INDEX IF NOT EXISTS idx_wines_cellar_colour ON wines(cellar_id, colour);

-- Composite index for cellar + search
CREATE INDEX IF NOT EXISTS idx_wines_cellar_name ON wines(cellar_id, wine_name);

COMMENT ON COLUMN wines.cellar_id IS 'Cellar this wine belongs to - required for multi-tenancy';
