-- Migration: 055_security_lint_fixes.sql
-- Purpose: Fix Supabase Database Linter findings:
--   1. ERROR: Enable RLS on 2 tables created after migration 047
--      - reconfiguration_plans (created dynamically by reconfigurationPlanStore.js)
--      - zone_reconfig_counters (created by migration 053)
--   2. WARN: Set search_path on 3 functions to prevent search_path injection
--      - update_storage_areas_updated_at (migration 038)
--      - manage_chilled_since (migration 038)
--      - wines_search_update (supabase_missing_objects.sql)
-- Created: 2026-02-25

-- ============================================================
-- 1. Enable RLS on tables missing it (ERROR level)
-- ============================================================

ALTER TABLE IF EXISTS reconfiguration_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS zone_reconfig_counters ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Fix mutable search_path on trigger functions (WARN level)
--    Re-create with SET search_path = public
-- ============================================================

-- 2a. update_storage_areas_updated_at
CREATE OR REPLACE FUNCTION update_storage_areas_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 2b. manage_chilled_since
CREATE OR REPLACE FUNCTION manage_chilled_since()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    old_area_type TEXT;
    new_area_type TEXT;
BEGIN
    -- Get old storage area type (if any)
    IF OLD.storage_area_id IS NOT NULL THEN
        SELECT storage_type INTO old_area_type
        FROM storage_areas WHERE id = OLD.storage_area_id;
    END IF;

    -- Get new storage area type (if any)
    IF NEW.storage_area_id IS NOT NULL THEN
        SELECT storage_type INTO new_area_type
        FROM storage_areas WHERE id = NEW.storage_area_id;
    END IF;

    -- Moving INTO kitchen fridge: set timestamp if not already set
    IF new_area_type = 'kitchen_fridge' AND (old_area_type IS NULL OR old_area_type != 'kitchen_fridge') THEN
        NEW.chilled_since = COALESCE(NEW.chilled_since, NOW());
    -- Moving OUT OF kitchen fridge: clear timestamp
    ELSIF old_area_type = 'kitchen_fridge' AND (new_area_type IS NULL OR new_area_type != 'kitchen_fridge') THEN
        NEW.chilled_since = NULL;
    END IF;

    RETURN NEW;
END;
$$;

-- 2c. wines_search_update
CREATE OR REPLACE FUNCTION wines_search_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.search_vector := to_tsvector('english',
        COALESCE(NEW.wine_name, '') || ' ' ||
        COALESCE(NEW.style, '') || ' ' ||
        COALESCE(NEW.country, '') || ' ' ||
        COALESCE(NEW.producer, '') || ' ' ||
        COALESCE(NEW.region, '') || ' ' ||
        COALESCE(NEW.tasting_notes, '')
    );
    RETURN NEW;
END;
$$;

-- ============================================================
-- ROLLBACK (for reference - not auto-executed)
-- ============================================================
-- ALTER TABLE IF EXISTS reconfiguration_plans DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE IF EXISTS zone_reconfig_counters DISABLE ROW LEVEL SECURITY;
-- (search_path changes are non-destructive, no rollback needed)
