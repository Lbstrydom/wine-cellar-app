-- Migration 020: Palate Profile System
-- Tracks consumption feedback and builds user preference profile

-- Consumption feedback (post-bottle quick feedback)
CREATE TABLE IF NOT EXISTS consumption_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL,
  consumption_id INTEGER,                    -- Links to consumption_log if applicable
  would_buy_again INTEGER DEFAULT NULL,      -- 0 = No, 1 = Yes, NULL = Not answered
  personal_rating REAL DEFAULT NULL,         -- 1-5 star rating
  paired_with TEXT DEFAULT NULL,             -- JSON array of food tags
  occasion TEXT DEFAULT NULL,                -- e.g., "dinner party", "weeknight", "special"
  notes TEXT DEFAULT NULL,                   -- Free-text feedback
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

-- Palate profile (aggregated preferences learned from feedback)
CREATE TABLE IF NOT EXISTS palate_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preference_key TEXT UNIQUE NOT NULL,       -- e.g., "grape:cabernet", "country:france", "style:oaked"
  preference_category TEXT NOT NULL,         -- e.g., "grape", "country", "style", "pairing"
  preference_value TEXT NOT NULL,            -- e.g., "cabernet", "france", "oaked"
  score REAL DEFAULT 0,                      -- Weighted preference score (-5 to +5)
  confidence REAL DEFAULT 0,                 -- 0-1 based on sample size
  sample_count INTEGER DEFAULT 0,            -- Number of feedbacks contributing
  avg_rating REAL DEFAULT NULL,              -- Average rating for this preference
  buy_again_rate REAL DEFAULT NULL,          -- % of "would buy again" for this preference
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Preference weights for scoring calculation
CREATE TABLE IF NOT EXISTS preference_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preference_type TEXT UNIQUE NOT NULL,      -- e.g., "grape", "country", "style"
  weight REAL DEFAULT 1.0,                   -- Weight multiplier for this preference type
  description TEXT DEFAULT NULL
);

-- Insert default weights
INSERT OR IGNORE INTO preference_weights (preference_type, weight, description) VALUES
  ('grape', 1.5, 'Grape variety preferences (most predictive)'),
  ('country', 1.0, 'Country/region preferences'),
  ('style', 1.2, 'Style preferences (oaked, tannic, etc.)'),
  ('colour', 0.8, 'Colour preferences'),
  ('pairing', 0.6, 'Food pairing correlations'),
  ('price_range', 0.5, 'Price point preferences');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_consumption_feedback_wine_id ON consumption_feedback(wine_id);
CREATE INDEX IF NOT EXISTS idx_consumption_feedback_created_at ON consumption_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_palate_profile_category ON palate_profile(preference_category);
CREATE INDEX IF NOT EXISTS idx_palate_profile_score ON palate_profile(score DESC);
