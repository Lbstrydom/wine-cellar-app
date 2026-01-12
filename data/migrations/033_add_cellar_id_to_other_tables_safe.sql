-- Migration 033 (Safe version): Add cellar_id to all existing user-data tables
-- Part of Multi-User Implementation Phase 1
-- Scopes all user data to a specific cellar
-- This version only modifies tables that exist

-- ============================================================
-- reduce_now
-- ============================================================
ALTER TABLE reduce_now ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reduce_now_cellar') THEN
    ALTER TABLE reduce_now ADD CONSTRAINT fk_reduce_now_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_reduce_now_cellar ON reduce_now(cellar_id);

-- ============================================================
-- wine_ratings (linked to wines, but also needs direct cellar scope)
-- ============================================================
ALTER TABLE wine_ratings ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_wine_ratings_cellar') THEN
    ALTER TABLE wine_ratings ADD CONSTRAINT fk_wine_ratings_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_wine_ratings_cellar ON wine_ratings(cellar_id);

-- ============================================================
-- drinking_windows
-- ============================================================
ALTER TABLE drinking_windows ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_drinking_windows_cellar') THEN
    ALTER TABLE drinking_windows ADD CONSTRAINT fk_drinking_windows_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_drinking_windows_cellar ON drinking_windows(cellar_id);

-- ============================================================
-- consumption_log
-- ============================================================
ALTER TABLE consumption_log ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_consumption_log_cellar') THEN
    ALTER TABLE consumption_log ADD CONSTRAINT fk_consumption_log_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_consumption_log_cellar ON consumption_log(cellar_id);

-- ============================================================
-- palate_profile (taste preferences per cellar)
-- ============================================================
ALTER TABLE palate_profile ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_palate_profile_cellar') THEN
    ALTER TABLE palate_profile ADD CONSTRAINT fk_palate_profile_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_palate_profile_cellar ON palate_profile(cellar_id);

-- ============================================================
-- zone_pins
-- ============================================================
ALTER TABLE zone_pins ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_zone_pins_cellar') THEN
    ALTER TABLE zone_pins ADD CONSTRAINT fk_zone_pins_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_zone_pins_cellar ON zone_pins(cellar_id);

-- ============================================================
-- zone_reconfigurations
-- ============================================================
ALTER TABLE zone_reconfigurations ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_zone_reconfigurations_cellar') THEN
    ALTER TABLE zone_reconfigurations ADD CONSTRAINT fk_zone_reconfigurations_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_zone_reconfigurations_cellar ON zone_reconfigurations(cellar_id);

-- ============================================================
-- search_cache (scope per cellar for user-specific searches)
-- ============================================================
ALTER TABLE search_cache ADD COLUMN IF NOT EXISTS cellar_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_search_cache_cellar') THEN
    ALTER TABLE search_cache ADD CONSTRAINT fk_search_cache_cellar
      FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_search_cache_cellar ON search_cache(cellar_id);

-- ============================================================
-- Comments for tables that exist
-- ============================================================
COMMENT ON COLUMN reduce_now.cellar_id IS 'Cellar this reduce-now item belongs to';
COMMENT ON COLUMN wine_ratings.cellar_id IS 'Cellar this rating belongs to';
COMMENT ON COLUMN drinking_windows.cellar_id IS 'Cellar this drinking window belongs to';
COMMENT ON COLUMN consumption_log.cellar_id IS 'Cellar where this consumption occurred';
COMMENT ON COLUMN palate_profile.cellar_id IS 'Cellar this profile belongs to';
COMMENT ON COLUMN zone_pins.cellar_id IS 'Cellar this pin belongs to';
COMMENT ON COLUMN zone_reconfigurations.cellar_id IS 'Cellar this reconfiguration belongs to';
COMMENT ON COLUMN search_cache.cellar_id IS 'Cellar this cache entry belongs to';
