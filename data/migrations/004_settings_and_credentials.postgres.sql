-- Migration 004 (PostgreSQL): Settings expansion and credential storage
-- PostgreSQL-compatible version

-- Expand user_settings for reduce-now rules (skip if table doesn't exist yet)
INSERT INTO user_settings (key, value) VALUES
  ('reduce_auto_rules_enabled', 'false'),
  ('reduce_age_threshold', '10'),
  ('reduce_rating_minimum', '3.0'),
  ('reduce_drink_window_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Encrypted credentials table for external services
CREATE TABLE IF NOT EXISTS source_credentials (
  id SERIAL PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  username_encrypted TEXT,
  password_encrypted TEXT,
  auth_token_encrypted TEXT,
  token_expires_at TIMESTAMP,
  auth_status TEXT DEFAULT 'none' CHECK (auth_status IN ('none', 'valid', 'expired', 'failed')),
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_source_credentials_source ON source_credentials(source_id);
