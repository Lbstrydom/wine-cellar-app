-- User Taste Profile: DERIVED snapshot, recomputable from events
-- This is a cache, not source of truth

CREATE TABLE IF NOT EXISTS user_taste_profile (
  user_id TEXT PRIMARY KEY DEFAULT 'default',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Derived preferences (jsonb for flexibility)
  colour_preferences JSONB,
  style_preferences JSONB,
  region_preferences JSONB,
  grape_preferences JSONB,
  
  -- Pairing-specific learnings
  food_wine_affinities JSONB,
  failure_patterns JSONB,
  
  -- Meta
  data_points INTEGER DEFAULT 0,
  data_diversity_score REAL,
  data_recency_days INTEGER,
  profile_confidence TEXT CHECK (profile_confidence IN ('insufficient', 'low', 'medium', 'high')),
  
  -- Audit
  last_recalculated TIMESTAMPTZ,
  contributing_session_ids INTEGER[]
);

COMMENT ON TABLE user_taste_profile IS 
  'Derived snapshot, recomputable from pairing_sessions + wine_ratings + consumption_log. 
   Delete and rebuild if data integrity is questioned.';
