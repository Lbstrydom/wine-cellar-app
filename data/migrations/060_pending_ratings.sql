-- Migration 060: Create pending_ratings table for drink-now-rate-later flow
--
-- WHY: When a user clicks "Drink" to consume a bottle but doesn't rate it
-- on the spot, the app should remind them next time they open it.
-- Each pending rating links to a specific consumption_log event (not wine-level)
-- to prevent false "already rated" when the same wine is consumed multiple times.
--
-- LIFECYCLE: pending → rated | dismissed
-- When resolved as 'rated', the rating is written back to both
-- consumption_log (event-level) and wines.personal_rating (wine-level).

CREATE TABLE IF NOT EXISTS pending_ratings (
  id SERIAL PRIMARY KEY,
  cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  consumption_log_id INTEGER NOT NULL,
  wine_id INTEGER NOT NULL,
  wine_name TEXT NOT NULL,
  vintage INTEGER,
  colour TEXT,
  style TEXT,
  location_code TEXT,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rated', 'dismissed')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookup of unresolved reminders by cellar
CREATE INDEX IF NOT EXISTS idx_pending_ratings_cellar_status
  ON pending_ratings(cellar_id, status);

-- Enable RLS (Express bypasses via service role; blocks direct PostgREST)
ALTER TABLE pending_ratings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pending_ratings IS 'Tracks consumed wines awaiting user rating';
COMMENT ON COLUMN pending_ratings.consumption_log_id IS 'Links to specific drink event in consumption_log';
COMMENT ON COLUMN pending_ratings.status IS 'pending = needs rating, rated = user rated, dismissed = user skipped';

-- ROLLBACK:
-- DROP TABLE IF EXISTS pending_ratings;
