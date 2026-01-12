-- Migration 027: Create profiles table
-- Part of Multi-User Implementation Phase 1
-- Profiles table stores user identity, linked to Supabase auth.users

-- Create profiles table (identity, keyed by auth.users.id)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,  -- References auth.users(id) - FK added after Supabase auth setup
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'premium', 'admin')),
  cellar_quota INTEGER DEFAULT 1,
  bottle_quota INTEGER DEFAULT 100,
  active_cellar_id UUID,  -- FK added after cellars table created
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- Index for last login (for analytics/cleanup)
CREATE INDEX IF NOT EXISTS idx_profiles_last_login ON profiles(last_login_at);

COMMENT ON TABLE profiles IS 'User profiles linked to Supabase auth.users';
COMMENT ON COLUMN profiles.id IS 'UUID from auth.users - no separate mapping layer';
COMMENT ON COLUMN profiles.tier IS 'Subscription tier: free, premium, admin';
COMMENT ON COLUMN profiles.cellar_quota IS 'Max cellars this user can create';
COMMENT ON COLUMN profiles.bottle_quota IS 'Max bottles across all cellars';
COMMENT ON COLUMN profiles.active_cellar_id IS 'Currently selected cellar for this user';
