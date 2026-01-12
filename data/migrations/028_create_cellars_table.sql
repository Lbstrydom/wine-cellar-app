-- Migration 028: Create cellars table
-- Part of Multi-User Implementation Phase 1
-- Cellars are the primary data container for multi-tenancy

-- Create cellars table (data container)
CREATE TABLE IF NOT EXISTS cellars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'My Cellar',
  description TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for created_by lookups (find all cellars a user created)
CREATE INDEX IF NOT EXISTS idx_cellars_created_by ON cellars(created_by);

-- Index for updated_at (for sync/cleanup operations)
CREATE INDEX IF NOT EXISTS idx_cellars_updated_at ON cellars(updated_at);

-- Add FK for active_cellar_id now that cellars table exists
ALTER TABLE profiles
  ADD CONSTRAINT fk_profiles_active_cellar
  FOREIGN KEY (active_cellar_id) REFERENCES cellars(id) ON DELETE SET NULL;

COMMENT ON TABLE cellars IS 'Data containers for wine collections - primary tenancy unit';
COMMENT ON COLUMN cellars.id IS 'UUID primary key - used as cellar_id FK in all data tables';
COMMENT ON COLUMN cellars.created_by IS 'Original creator - for auditing and ownership transfer';
COMMENT ON COLUMN cellars.settings IS 'Cellar-specific settings (layout, preferences, etc.)';
