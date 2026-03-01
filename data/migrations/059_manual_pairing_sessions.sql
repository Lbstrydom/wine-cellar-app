-- Migration 059: Add source and recipe_id columns to pairing_sessions
--
-- WHY: Manual pairings (user picks a wine to pair with a dish, bypassing AI)
-- need to be distinguished from AI-generated sessions. The `source` column
-- tracks origin ('ai' vs 'manual') and `recipe_id` links pairings initiated
-- from the recipe library.
--
-- DESIGN: dish_description and recommendations stay NOT NULL.
-- Manual pairings set dish_description = user's dish text and
-- recommendations = '[]' (empty JSON array).

-- ============================================================
-- 1. Add source column (default 'ai' for existing rows)
-- ============================================================

ALTER TABLE pairing_sessions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai';

COMMENT ON COLUMN pairing_sessions.source IS 'Pairing origin: ai (AI-generated) or manual (user-initiated)';

-- ============================================================
-- 2. Add optional recipe_id column
-- ============================================================

ALTER TABLE pairing_sessions ADD COLUMN IF NOT EXISTS recipe_id INTEGER;

COMMENT ON COLUMN pairing_sessions.recipe_id IS 'Recipe ID if pairing was initiated from recipe library';

-- ROLLBACK:
-- ALTER TABLE pairing_sessions DROP COLUMN IF EXISTS source;
-- ALTER TABLE pairing_sessions DROP COLUMN IF EXISTS recipe_id;
