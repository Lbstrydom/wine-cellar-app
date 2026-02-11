-- Migration 052: Add cellar_id to pairing_sessions + enable RLS
--
-- WHY: pairing_sessions was created before multi-user (migration 023) and never
-- updated. It uses user_id TEXT instead of cellar_id UUID, has no RLS enabled,
-- and was missed in migration 047_enable_rls_all_tables.sql.
--
-- STRATEGY:
-- 1. Add cellar_id column (nullable initially)
-- 2. Backfill from wines table via chosen_wine_id
-- 3. Delete orphan rows that can't be matched
-- 4. Make cellar_id NOT NULL
-- 5. Enable RLS (no policies needed — blocks PostgREST, Express bypasses via postgres role)
-- 6. Add indexes

-- ============================================================
-- 1. Add cellar_id column
-- ============================================================

ALTER TABLE pairing_sessions ADD COLUMN IF NOT EXISTS cellar_id UUID;

-- ============================================================
-- 2. Backfill cellar_id from wines via chosen_wine_id
-- ============================================================

UPDATE pairing_sessions ps
SET cellar_id = w.cellar_id
FROM wines w
WHERE ps.chosen_wine_id = w.id
  AND ps.cellar_id IS NULL;

-- Also try to backfill from recommendations JSONB for sessions without a chosen wine
-- Extract first wine_id from recommendations array and look up its cellar
UPDATE pairing_sessions ps
SET cellar_id = w.cellar_id
FROM wines w
WHERE ps.cellar_id IS NULL
  AND ps.recommendations IS NOT NULL
  AND jsonb_array_length(ps.recommendations) > 0
  AND w.id = (ps.recommendations->0->>'wine_id')::INTEGER;

-- ============================================================
-- 3. Delete orphan rows that couldn't be matched to any cellar
-- ============================================================

DELETE FROM pairing_sessions WHERE cellar_id IS NULL;

-- ============================================================
-- 4. Add NOT NULL constraint and foreign key
-- ============================================================

ALTER TABLE pairing_sessions ALTER COLUMN cellar_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pairing_sessions_cellar') THEN
    ALTER TABLE pairing_sessions ADD CONSTRAINT fk_pairing_sessions_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 5. Enable Row Level Security
-- ============================================================

ALTER TABLE pairing_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. Add indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pairing_sessions_cellar ON pairing_sessions(cellar_id);

-- Replace old user_id-based partial index with cellar_id-based one
DROP INDEX IF EXISTS idx_pairing_sessions_pending_feedback;
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_pending_feedback
  ON pairing_sessions(cellar_id, created_at)
  WHERE chosen_wine_id IS NOT NULL AND pairing_fit_rating IS NULL;

DROP INDEX IF EXISTS idx_pairing_sessions_user;

-- ============================================================
-- 7. Drop legacy user_id column (no longer needed)
-- ============================================================

ALTER TABLE pairing_sessions DROP COLUMN IF EXISTS user_id;

-- ============================================================
-- 8. Add comment
-- ============================================================

COMMENT ON COLUMN pairing_sessions.cellar_id IS 'Cellar this pairing session belongs to';
