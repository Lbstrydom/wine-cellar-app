-- Migration 034: Backfill cellar_id for existing data
-- Part of Multi-User Implementation Phase 1
-- Creates default profile/cellar and assigns all existing data to it

-- ============================================================
-- Create default profile for existing data owner
-- This is a placeholder until the real user logs in via Supabase auth
-- ============================================================
INSERT INTO profiles (
  id,
  email,
  display_name,
  tier,
  cellar_quota,
  bottle_quota
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'legacy@wine-cellar.local',
  'Legacy User',
  'premium',
  10,
  1000
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Create default cellar for existing data
-- ============================================================
INSERT INTO cellars (
  id,
  name,
  description,
  created_by
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'My Wine Cellar',
  'Default cellar created during multi-user migration',
  '00000000-0000-0000-0000-000000000001'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Create membership for default user -> default cellar
-- ============================================================
INSERT INTO cellar_memberships (
  cellar_id,
  user_id,
  role
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'owner'
) ON CONFLICT (cellar_id, user_id) DO NOTHING;

-- ============================================================
-- Set default user's active cellar
-- ============================================================
UPDATE profiles
SET active_cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ============================================================
-- Backfill all tables with the default cellar_id
-- ============================================================

-- wines
UPDATE wines
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- slots
UPDATE slots
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- reduce_now
UPDATE reduce_now
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- wine_ratings
UPDATE wine_ratings
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- drinking_windows
UPDATE drinking_windows
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- consumption_log
UPDATE consumption_log
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- chat_sessions
UPDATE chat_sessions
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- palate_feedback
UPDATE palate_feedback
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- palate_profile
UPDATE palate_profile
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- data_provenance
UPDATE data_provenance
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- cellar_zones
UPDATE cellar_zones
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- zone_row_assignments
UPDATE zone_row_assignments
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- zone_pins
UPDATE zone_pins
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- zone_reconfigurations
UPDATE zone_reconfigurations
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- search_cache
UPDATE search_cache
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- extraction_cache
UPDATE extraction_cache
SET cellar_id = '00000000-0000-0000-0000-000000000001'
WHERE cellar_id IS NULL;

-- ============================================================
-- Verification queries (run manually to confirm backfill success)
-- ============================================================
-- SELECT 'wines' as table_name, COUNT(*) as total, COUNT(cellar_id) as with_cellar FROM wines
-- UNION ALL SELECT 'slots', COUNT(*), COUNT(cellar_id) FROM slots
-- UNION ALL SELECT 'reduce_now', COUNT(*), COUNT(cellar_id) FROM reduce_now
-- UNION ALL SELECT 'wine_ratings', COUNT(*), COUNT(cellar_id) FROM wine_ratings
-- UNION ALL SELECT 'drinking_windows', COUNT(*), COUNT(cellar_id) FROM drinking_windows
-- UNION ALL SELECT 'consumption_log', COUNT(*), COUNT(cellar_id) FROM consumption_log
-- UNION ALL SELECT 'chat_sessions', COUNT(*), COUNT(cellar_id) FROM chat_sessions
-- UNION ALL SELECT 'palate_feedback', COUNT(*), COUNT(cellar_id) FROM palate_feedback
-- UNION ALL SELECT 'palate_profile', COUNT(*), COUNT(cellar_id) FROM palate_profile
-- UNION ALL SELECT 'data_provenance', COUNT(*), COUNT(cellar_id) FROM data_provenance
-- UNION ALL SELECT 'cellar_zones', COUNT(*), COUNT(cellar_id) FROM cellar_zones
-- UNION ALL SELECT 'zone_row_assignments', COUNT(*), COUNT(cellar_id) FROM zone_row_assignments
-- UNION ALL SELECT 'zone_pins', COUNT(*), COUNT(cellar_id) FROM zone_pins
-- UNION ALL SELECT 'zone_reconfigurations', COUNT(*), COUNT(cellar_id) FROM zone_reconfigurations
-- UNION ALL SELECT 'search_cache', COUNT(*), COUNT(cellar_id) FROM search_cache
-- UNION ALL SELECT 'extraction_cache', COUNT(*), COUNT(cellar_id) FROM extraction_cache;
