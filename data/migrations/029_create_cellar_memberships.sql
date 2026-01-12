-- Migration 029: Create cellar_memberships table
-- Part of Multi-User Implementation Phase 1
-- Links users to cellars with role-based access control

-- Create cellar_memberships table (access control)
CREATE TABLE IF NOT EXISTS cellar_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cellar_id, user_id)
);

-- Index for user lookups (find all cellars a user has access to)
CREATE INDEX IF NOT EXISTS idx_cellar_memberships_user ON cellar_memberships(user_id);

-- Index for cellar lookups (find all users with access to a cellar)
CREATE INDEX IF NOT EXISTS idx_cellar_memberships_cellar ON cellar_memberships(cellar_id);

-- Index for role filtering (e.g., find all owners)
CREATE INDEX IF NOT EXISTS idx_cellar_memberships_role ON cellar_memberships(role);

COMMENT ON TABLE cellar_memberships IS 'Access control - links users to cellars with roles';
COMMENT ON COLUMN cellar_memberships.role IS 'owner: full control, editor: modify data, viewer: read-only';
COMMENT ON COLUMN cellar_memberships.invited_by IS 'User who sent the invite - for audit trail';
