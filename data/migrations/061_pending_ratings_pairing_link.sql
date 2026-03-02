-- Migration 061: Link pending ratings to pairing sessions
-- Enables the reminder bar to prompt for both wine rating AND pairing feedback
-- when the consumption originated from a pairing interaction.

ALTER TABLE pending_ratings
  ADD COLUMN IF NOT EXISTS pairing_session_id INTEGER
  REFERENCES pairing_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pending_ratings_pairing_session
  ON pending_ratings(pairing_session_id)
  WHERE pairing_session_id IS NOT NULL;

COMMENT ON COLUMN pending_ratings.pairing_session_id IS
  'Links to pairing session if consumption originated from a pairing interaction';

-- ROLLBACK:
-- ALTER TABLE pending_ratings DROP COLUMN IF EXISTS pairing_session_id;
