-- Migration: 063_security_lint_fixes_2.sql
-- Purpose: Fix Supabase Database Linter findings (March 2026 pass):
--   1. ERROR: Enable RLS on 5 tables created dynamically by recipe services
--      - wine_food_pairings (created by foodPairingsService / wineContextBuilder)
--      - recipes             (created by recipeService.ensureRecipeTables)
--      - recipe_sync_state   (created by recipeService.ensureRecipeTables)
--      - recipe_sync_log     (created by recipeService.ensureRecipeTables)
--      - cooking_profiles    (created by recipeService.ensureRecipeTables)
--   2. CLEANUP: Drop the Feb-28 name-cleanup backup table (no longer needed)
--   3. PERF: Fix Auth RLS Initialization Plan on source_credentials
--      Wrap current_setting() in a subquery so it is evaluated once per
--      statement rather than once per row.
-- Created: 2026-03-04

-- ============================================================
-- 1. Enable RLS on tables missing it (ERROR level)
--    Strategy (same as migration 047): enable RLS but add NO
--    policies for the anon role, which blocks all PostgREST
--    access. The postgres role used by DATABASE_URL bypasses
--    RLS, so the Express backend is unaffected.
-- ============================================================

ALTER TABLE IF EXISTS wine_food_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipe_sync_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipe_sync_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cooking_profiles    ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Drop the Feb-28 name-cleanup backup table
--    This is a one-off snapshot with no ongoing purpose and no
--    RLS; dropping it removes the security exposure entirely.
-- ============================================================

DROP TABLE IF EXISTS wines_name_cleanup_backup_20260228;

-- ============================================================
-- 3. Fix Auth RLS Initialization Plan on source_credentials
--    Replace inline current_setting() with a subquery so the
--    planner can hoist it out of the per-row evaluation loop.
-- ============================================================

DROP POLICY IF EXISTS source_credentials_isolation ON source_credentials;

CREATE POLICY source_credentials_isolation ON source_credentials
  USING (cellar_id = (SELECT current_setting('app.current_cellar_id', true)));
