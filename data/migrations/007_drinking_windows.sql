-- Migration 007: Drinking Windows
-- Adds drinking window tracking for wines with data from critics and manual entry

-- Drinking windows table (supports multiple opinions per wine)
CREATE TABLE IF NOT EXISTS drinking_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                    -- 'halliday', 'vivino', 'wine_spectator', 'manual', etc.
  drink_from_year INTEGER,                 -- earliest recommended year
  drink_by_year INTEGER,                   -- latest recommended year
  peak_year INTEGER,                       -- optimal drinking year (optional)
  confidence TEXT DEFAULT 'medium',        -- 'high', 'medium', 'low'
  raw_text TEXT,                           -- original text: "Drink 2024-2030"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wine_id, source)                  -- one window per source per wine
);

CREATE INDEX IF NOT EXISTS idx_drinking_windows_wine_id ON drinking_windows(wine_id);
CREATE INDEX IF NOT EXISTS idx_drinking_windows_drink_by ON drinking_windows(drink_by_year);
CREATE INDEX IF NOT EXISTS idx_drinking_windows_source ON drinking_windows(source);

-- New user settings for window-based reduce rules
INSERT OR IGNORE INTO user_settings (key, value) VALUES
  ('reduce_window_urgency_months', '12'),
  ('reduce_include_no_window', 'true'),
  ('reduce_window_source_priority', '["manual","halliday","wine_spectator","decanter","vivino"]');
