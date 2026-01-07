-- Pairing Sessions: captures every Find Pairing interaction
-- Supports both PostgreSQL (production) and SQLite (local dev)

CREATE TABLE IF NOT EXISTS pairing_sessions (
  id SERIAL PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- The request
  dish_description TEXT NOT NULL,
  source_filter TEXT,
  colour_filter TEXT,
  
  -- AI analysis (structured for querying)
  food_signals JSONB,
  dish_analysis TEXT,
  
  -- Recommendations (ranked, with wine_ids for joins)
  recommendations JSONB NOT NULL,
  
  -- User selection
  chosen_wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
  chosen_rank INTEGER,
  chosen_at TIMESTAMPTZ,
  
  -- Consumption link (ground truth)
  consumption_log_id INTEGER REFERENCES consumption_log(id) ON DELETE SET NULL,
  confirmed_consumed BOOLEAN DEFAULT FALSE,
  
  -- Feedback (filled later)
  pairing_fit_rating REAL CHECK (pairing_fit_rating IS NULL OR (pairing_fit_rating >= 1 AND pairing_fit_rating <= 5)),
  would_pair_again BOOLEAN,
  failure_reasons JSONB,
  feedback_notes TEXT,
  feedback_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_user ON pairing_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_wine ON pairing_sessions(chosen_wine_id);
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_date ON pairing_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_consumption ON pairing_sessions(consumption_log_id);

-- GIN index for JSONB queries (PostgreSQL only, skip for SQLite)
-- CREATE INDEX IF NOT EXISTS idx_pairing_sessions_signals ON pairing_sessions USING GIN (food_signals);

-- Partial index for pending feedback queries
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_pending_feedback 
  ON pairing_sessions(user_id, created_at) 
  WHERE chosen_wine_id IS NOT NULL AND pairing_fit_rating IS NULL;

-- Add comment for failure_reasons vocabulary
COMMENT ON COLUMN pairing_sessions.failure_reasons IS 
  'Valid values: too_tannic, too_acidic, too_sweet, too_oaky, too_light, too_heavy, 
   clashed_with_spice, clashed_with_sauce, overwhelmed_dish, underwhelmed_dish, 
   wrong_temperature, other';
