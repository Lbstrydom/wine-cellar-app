-- Migration 033: Add cellar_id to all remaining user-data tables
-- Part of Multi-User Implementation Phase 1
-- Scopes all user data to a specific cellar

-- ============================================================
-- reduce_now
-- ============================================================
ALTER TABLE reduce_now ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE reduce_now ADD CONSTRAINT fk_reduce_now_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_reduce_now_cellar ON reduce_now(cellar_id);

-- ============================================================
-- wine_ratings (linked to wines, but also needs direct cellar scope)
-- ============================================================
ALTER TABLE wine_ratings ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE wine_ratings ADD CONSTRAINT fk_wine_ratings_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_wine_ratings_cellar ON wine_ratings(cellar_id);

-- ============================================================
-- drinking_windows
-- ============================================================
ALTER TABLE drinking_windows ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE drinking_windows ADD CONSTRAINT fk_drinking_windows_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_drinking_windows_cellar ON drinking_windows(cellar_id);

-- ============================================================
-- consumption_log
-- ============================================================
ALTER TABLE consumption_log ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE consumption_log ADD CONSTRAINT fk_consumption_log_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_consumption_log_cellar ON consumption_log(cellar_id);

-- ============================================================
-- chat_sessions (sommelier chat per cellar)
-- ============================================================
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE chat_sessions ADD CONSTRAINT fk_chat_sessions_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_cellar ON chat_sessions(cellar_id);

-- ============================================================
-- palate_feedback
-- ============================================================
ALTER TABLE palate_feedback ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE palate_feedback ADD CONSTRAINT fk_palate_feedback_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_palate_feedback_cellar ON palate_feedback(cellar_id);

-- ============================================================
-- palate_profile (taste preferences per cellar)
-- ============================================================
ALTER TABLE palate_profile ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE palate_profile ADD CONSTRAINT fk_palate_profile_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_palate_profile_cellar ON palate_profile(cellar_id);
-- Note: UNIQUE(dimension) becomes UNIQUE(cellar_id, dimension) in migration 035

-- ============================================================
-- data_provenance
-- ============================================================
ALTER TABLE data_provenance ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE data_provenance ADD CONSTRAINT fk_data_provenance_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_data_provenance_cellar ON data_provenance(cellar_id);

-- ============================================================
-- cellar_zones (zones are per-cellar)
-- ============================================================
ALTER TABLE cellar_zones ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE cellar_zones ADD CONSTRAINT fk_cellar_zones_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_cellar_zones_cellar ON cellar_zones(cellar_id);

-- ============================================================
-- zone_row_assignments
-- ============================================================
ALTER TABLE zone_row_assignments ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE zone_row_assignments ADD CONSTRAINT fk_zone_row_assignments_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_zone_row_assignments_cellar ON zone_row_assignments(cellar_id);

-- ============================================================
-- zone_pins
-- ============================================================
ALTER TABLE zone_pins ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE zone_pins ADD CONSTRAINT fk_zone_pins_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_zone_pins_cellar ON zone_pins(cellar_id);

-- ============================================================
-- zone_reconfigurations
-- ============================================================
ALTER TABLE zone_reconfigurations ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE zone_reconfigurations ADD CONSTRAINT fk_zone_reconfigurations_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_zone_reconfigurations_cellar ON zone_reconfigurations(cellar_id);

-- ============================================================
-- search_cache (scope per cellar for user-specific searches)
-- ============================================================
ALTER TABLE search_cache ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE search_cache ADD CONSTRAINT fk_search_cache_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_search_cache_cellar ON search_cache(cellar_id);

-- ============================================================
-- extraction_cache (scope per cellar)
-- ============================================================
ALTER TABLE extraction_cache ADD COLUMN IF NOT EXISTS cellar_id UUID;
ALTER TABLE extraction_cache ADD CONSTRAINT fk_extraction_cache_cellar
  FOREIGN KEY (cellar_id) REFERENCES cellars(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_extraction_cache_cellar ON extraction_cache(cellar_id);

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON COLUMN reduce_now.cellar_id IS 'Cellar this reduce-now item belongs to';
COMMENT ON COLUMN wine_ratings.cellar_id IS 'Cellar this rating belongs to';
COMMENT ON COLUMN drinking_windows.cellar_id IS 'Cellar this drinking window belongs to';
COMMENT ON COLUMN consumption_log.cellar_id IS 'Cellar where this consumption occurred';
COMMENT ON COLUMN chat_sessions.cellar_id IS 'Cellar this chat session is associated with';
COMMENT ON COLUMN palate_feedback.cellar_id IS 'Cellar this feedback belongs to';
COMMENT ON COLUMN palate_profile.cellar_id IS 'Cellar this profile belongs to';
COMMENT ON COLUMN data_provenance.cellar_id IS 'Cellar this provenance record belongs to';
COMMENT ON COLUMN cellar_zones.cellar_id IS 'Cellar this zone belongs to';
COMMENT ON COLUMN zone_row_assignments.cellar_id IS 'Cellar this assignment belongs to';
COMMENT ON COLUMN zone_pins.cellar_id IS 'Cellar this pin belongs to';
COMMENT ON COLUMN zone_reconfigurations.cellar_id IS 'Cellar this reconfiguration belongs to';
COMMENT ON COLUMN search_cache.cellar_id IS 'Cellar this cache entry belongs to';
COMMENT ON COLUMN extraction_cache.cellar_id IS 'Cellar this extraction belongs to';
