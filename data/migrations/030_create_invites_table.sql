-- Migration 030: Create invites table
-- Part of Multi-User Implementation Phase 1
-- Beta gating and cellar sharing via invite codes

-- Create invites table
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  -- Optional: link to specific cellar for sharing invites
  cellar_id UUID REFERENCES cellars(id) ON DELETE CASCADE,
  -- Role to assign when invite is used for cellar sharing
  granted_role TEXT CHECK (granted_role IS NULL OR granted_role IN ('editor', 'viewer'))
);

-- Index for finding unused invites
CREATE INDEX IF NOT EXISTS idx_invites_used_by ON invites(used_by) WHERE used_by IS NULL;

-- Index for cellar-specific invites
CREATE INDEX IF NOT EXISTS idx_invites_cellar ON invites(cellar_id) WHERE cellar_id IS NOT NULL;

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_invites_expires_at ON invites(expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE invites IS 'Invite codes for beta access and cellar sharing';
COMMENT ON COLUMN invites.code IS 'Unique invite code - human-readable format recommended';
COMMENT ON COLUMN invites.cellar_id IS 'If set, invite grants access to this specific cellar';
COMMENT ON COLUMN invites.granted_role IS 'Role to assign when used for cellar sharing (editor/viewer)';
