-- Migration 036: Add cellar_id to zone_allocations table
-- Part of Multi-User Implementation Phase 1 (supplementary)
-- This table was missed in migration 033
-- Required for proper cellar scoping of zone operations in cellar.js

-- Add cellar_id column (nullable initially for backfill)
ALTER TABLE zone_allocations ADD COLUMN IF NOT EXISTS cellar_id UUID;

-- Add foreign key constraint
ALTER TABLE zone_allocations ADD CONSTRAINT fk_zone_allocations_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;

-- Add index for cellar-scoped queries
CREATE INDEX IF NOT EXISTS idx_zone_allocations_cellar ON zone_allocations(cellar_id);

-- Backfill cellar_id from cellar_zones (zones know their cellar)
-- zone_allocations.zone_id references cellar_zones.id
UPDATE zone_allocations za
SET cellar_id = cz.cellar_id
FROM cellar_zones cz
WHERE za.zone_id = cz.id
  AND za.cellar_id IS NULL;

-- For any orphaned zone_allocations (zone_id not in cellar_zones),
-- assign to default cellar
UPDATE zone_allocations
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- Now add NOT NULL constraint
ALTER TABLE zone_allocations ALTER COLUMN cellar_id SET NOT NULL;

-- Add composite unique constraint (zone_id unique per cellar)
-- Drop existing primary key first if it's just zone_id
-- Note: zone_id was PRIMARY KEY in original schema, but that doesn't make sense
-- for multi-cellar where same zone_id could exist in different cellars
-- For now, add a unique constraint for (cellar_id, zone_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_allocations_cellar_zone
  ON zone_allocations(cellar_id, zone_id);

COMMENT ON COLUMN zone_allocations.cellar_id IS 'Cellar this zone allocation belongs to - required for multi-tenancy';
