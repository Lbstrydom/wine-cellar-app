-- Migration: Settings expansion and credential storage
-- Add settings for reduce-now auto-rules and encrypted credentials

-- Expand user_settings for reduce-now rules
INSERT OR IGNORE INTO user_settings (key, value) VALUES
  ('reduce_auto_rules_enabled', 'false'),
  ('reduce_age_threshold', '10'),
  ('reduce_rating_minimum', '3.0'),
  ('reduce_drink_window_enabled', 'false');

-- Encrypted credentials table for external services
CREATE TABLE IF NOT EXISTS source_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL UNIQUE,
  username_encrypted TEXT,
  password_encrypted TEXT,
  auth_token_encrypted TEXT,
  token_expires_at DATETIME,
  auth_status TEXT DEFAULT 'none' CHECK (auth_status IN ('none', 'valid', 'expired', 'failed')),
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_source_credentials_source ON source_credentials(source_id);
