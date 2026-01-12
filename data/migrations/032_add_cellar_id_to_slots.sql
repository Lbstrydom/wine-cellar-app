-- Migration 032: Add cellar_id to slots table
-- Part of Multi-User Implementation Phase 1
-- Scopes physical storage slots to a specific cellar

-- Add cellar_id column (nullable initially for backfill)
ALTER TABLE slots ADD COLUMN IF NOT EXISTS cellar_id UUID;

-- Add foreign key constraint
ALTER TABLE slots ADD CONSTRAINT fk_slots_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;

-- Add index for cellar-scoped queries
CREATE INDEX IF NOT EXISTS idx_slots_cellar ON slots(cellar_id);

-- Composite index for cellar + zone (common query pattern)
CREATE INDEX IF NOT EXISTS idx_slots_cellar_zone ON slots(cellar_id, zone);

-- Composite index for cellar + location lookups
CREATE INDEX IF NOT EXISTS idx_slots_cellar_location ON slots(cellar_id, location_code);

-- Note: The existing UNIQUE constraint on location_code needs to become
-- UNIQUE(cellar_id, location_code) after backfill. This is handled in migration 035.

COMMENT ON COLUMN slots.cellar_id IS 'Cellar this slot belongs to - required for multi-tenancy';
