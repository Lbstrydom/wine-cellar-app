-- Migration 051: Add cellar_id to source_credentials for multi-user isolation
-- Ensures credentials are scoped per-cellar, not global
-- PostgreSQL-compatible version

-- Step 1: Check if table exists and needs migration
DO $$ 
BEGIN
  -- Add cellar_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'source_credentials' AND column_name = 'cellar_id'
  ) THEN
    ALTER TABLE source_credentials ADD COLUMN cellar_id TEXT;
    RAISE NOTICE 'Added cellar_id column to source_credentials';
  END IF;
END $$;

-- Step 2: Drop old unique constraint on source_id alone (if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'source_credentials_source_id_key'
  ) THEN
    ALTER TABLE source_credentials DROP CONSTRAINT source_credentials_source_id_key;
    RAISE NOTICE 'Dropped old unique constraint on source_id';
  END IF;
END $$;

-- Step 3: For PostgreSQL, we need to recreate the table to change primary key type and add composite unique
-- Save existing data
CREATE TABLE IF NOT EXISTS source_credentials_backup AS SELECT * FROM source_credentials;

-- Drop old table
DROP TABLE IF EXISTS source_credentials CASCADE;

-- Recreate with proper schema (PostgreSQL syntax)
CREATE TABLE source_credentials (
  id SERIAL PRIMARY KEY,
  cellar_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  username_encrypted TEXT,
  password_encrypted TEXT,
  auth_token_encrypted TEXT,
  token_expires_at TIMESTAMP,
  auth_status TEXT DEFAULT 'none' CHECK (auth_status IN ('none', 'valid', 'expired', 'failed')),
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cellar_id, source_id)  -- Composite unique constraint per cellar
);

-- Restore data (skip rows without cellar_id - those are invalid in multi-user setup)
INSERT INTO source_credentials 
  (cellar_id, source_id, username_encrypted, password_encrypted, auth_token_encrypted, 
   token_expires_at, auth_status, last_used_at, created_at, updated_at)
SELECT 
  cellar_id, source_id, username_encrypted, password_encrypted, auth_token_encrypted,
  token_expires_at, auth_status, last_used_at, created_at, updated_at
FROM source_credentials_backup
WHERE cellar_id IS NOT NULL;

-- Clean up
DROP TABLE IF EXISTS source_credentials_backup;

-- Create indexes for efficient cellar-scoped lookups
CREATE INDEX IF NOT EXISTS idx_source_credentials_cellar ON source_credentials(cellar_id);
CREATE INDEX IF NOT EXISTS idx_source_credentials_cellar_source ON source_credentials(cellar_id, source_id);

-- Step 4: Enable Row Level Security (PostgreSQL)
ALTER TABLE source_credentials ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS source_credentials_isolation ON source_credentials;

-- Create RLS policy for cellar isolation
-- Users can only access credentials for their active cellar
CREATE POLICY source_credentials_isolation ON source_credentials
  USING (cellar_id = current_setting('app.current_cellar_id', true));

