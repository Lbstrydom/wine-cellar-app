-- Migration 047: Enable Row Level Security on all public tables
--
-- WHY: Supabase exposes all public tables via PostgREST (auto-generated REST API).
-- Without RLS, anyone with the anon key can read/write any table directly,
-- bypassing our Express middleware (requireAuth + requireCellarContext).
--
-- STRATEGY: Enable RLS on every table but add NO policies for the anon role.
-- This effectively blocks all PostgREST access.
-- The postgres role (used by DATABASE_URL) bypasses RLS by default,
-- so our Express backend continues working unchanged.
--
-- VIEWS: Recreate SECURITY DEFINER views as SECURITY INVOKER to prevent
-- RLS bypass through view access.

-- ============================================================
-- 1. Enable RLS on all user-data tables (cellar-scoped)
-- ============================================================

ALTER TABLE IF EXISTS wines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reduce_now ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wine_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wine_source_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wine_external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS data_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS consumption_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS consumption_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS palate_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS palate_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_taste_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cellar_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS zone_row_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS zone_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS zone_reconfigurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS zone_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS zone_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS drinking_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wine_search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS search_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS extraction_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cellar_analysis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS preference_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tasting_note_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tasting_note_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tasting_profile_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS storage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS storage_area_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invites ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Enable RLS on multi-tenancy infrastructure tables
-- ============================================================

ALTER TABLE IF EXISTS cellars ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cellar_memberships ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Enable RLS on system-wide tables (belt-and-suspenders)
--    No user data, but blocks unnecessary PostgREST exposure
-- ============================================================

ALTER TABLE IF EXISTS pairing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS style_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS known_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS award_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS competition_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS drinking_window_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wine_serving_temps ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wine_serving_temperatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cache_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS page_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public_url_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public_extraction_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS producer_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS producer_crawl_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS robots_txt_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS source_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ai_review_telemetry ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Enable RLS on job queue tables
-- ============================================================

ALTER TABLE IF EXISTS job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS job_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Fix SECURITY DEFINER views → SECURITY INVOKER
--    Prevents using views to bypass RLS
-- ============================================================

-- Recreate views with security_invoker = true
-- (PostgreSQL 15+ / Supabase supports this)

ALTER VIEW IF EXISTS v_slots_with_zone SET (security_invoker = true);
ALTER VIEW IF EXISTS reduce_now_view SET (security_invoker = true);
ALTER VIEW IF EXISTS inventory_view SET (security_invoker = true);
