-- Migration 035: Add NOT NULL constraints after backfill
-- Part of Multi-User Implementation Phase 1
-- IMPORTANT: Only run after migration 034 successfully backfills all cellar_id values

-- ============================================================
-- Add NOT NULL constraints to cellar_id columns
-- ============================================================

ALTER TABLE wines ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE slots ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE reduce_now ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE wine_ratings ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE drinking_windows ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE consumption_log ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE chat_sessions ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE palate_feedback ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE palate_profile ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE data_provenance ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE cellar_zones ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE zone_row_assignments ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE zone_pins ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE zone_reconfigurations ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE search_cache ALTER COLUMN cellar_id SET NOT NULL;
ALTER TABLE extraction_cache ALTER COLUMN cellar_id SET NOT NULL;

-- ============================================================
-- Update unique constraints to include cellar_id
-- These ensure data uniqueness is scoped per cellar
-- ============================================================

-- slots: location_code unique per cellar (drop old, add new)
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_location_code_key;
ALTER TABLE slots ADD CONSTRAINT uq_slots_cellar_location UNIQUE (cellar_id, location_code);

-- slots: zone + row + col unique per cellar
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_zone_row_num_col_num_key;
ALTER TABLE slots ADD CONSTRAINT uq_slots_cellar_zone_row_col UNIQUE (cellar_id, zone, row_num, col_num);

-- palate_profile: dimension unique per cellar
ALTER TABLE palate_profile DROP CONSTRAINT IF EXISTS palate_profile_dimension_key;
ALTER TABLE palate_profile ADD CONSTRAINT uq_palate_profile_cellar_dimension UNIQUE (cellar_id, dimension);

-- cellar_zones: zone id unique per cellar (was global)
-- Note: zone_id is TEXT PRIMARY KEY, we need a new approach
-- Add cellar-scoped uniqueness without changing PK
CREATE UNIQUE INDEX IF NOT EXISTS idx_cellar_zones_cellar_id_unique
  ON cellar_zones(cellar_id, id);

-- zone_row_assignments: zone_id + row_pattern unique per cellar
ALTER TABLE zone_row_assignments DROP CONSTRAINT IF EXISTS zone_row_assignments_zone_id_row_pattern_key;
ALTER TABLE zone_row_assignments ADD CONSTRAINT uq_zone_row_cellar_pattern
  UNIQUE (cellar_id, zone_id, row_pattern);

-- search_cache: cache_key unique per cellar
ALTER TABLE search_cache DROP CONSTRAINT IF EXISTS search_cache_cache_key_key;
ALTER TABLE search_cache ADD CONSTRAINT uq_search_cache_cellar_key UNIQUE (cellar_id, cache_key);

-- extraction_cache: wine_id + content_hash + extraction_type unique per cellar
ALTER TABLE extraction_cache DROP CONSTRAINT IF EXISTS extraction_cache_wine_id_content_hash_extraction_type_key;
ALTER TABLE extraction_cache ADD CONSTRAINT uq_extraction_cache_cellar_wine_content
  UNIQUE (cellar_id, wine_id, content_hash, extraction_type);

-- ============================================================
-- Update views to include cellar_id for filtering
-- ============================================================

-- Drop and recreate inventory_view with cellar_id
DROP VIEW IF EXISTS inventory_view;
CREATE VIEW inventory_view AS
SELECT
    w.cellar_id,
    w.id,
    w.style,
    w.colour,
    w.wine_name,
    w.vintage,
    COUNT(s.id) as bottle_count,
    STRING_AGG(s.location_code, ', ') as locations,
    w.vivino_rating,
    w.price_eur,
    MAX(CASE WHEN s.zone = 'fridge' THEN 1 ELSE 0 END) as in_fridge,
    MAX(CASE WHEN s.zone = 'cellar' THEN 1 ELSE 0 END) as in_cellar
FROM wines w
LEFT JOIN slots s ON s.wine_id = w.id
GROUP BY w.cellar_id, w.id, w.style, w.colour, w.wine_name, w.vintage, w.vivino_rating, w.price_eur;

-- Drop and recreate reduce_now_view with cellar_id
DROP VIEW IF EXISTS reduce_now_view;
CREATE VIEW reduce_now_view AS
SELECT
    rn.cellar_id,
    rn.id,
    rn.priority,
    w.style,
    w.colour,
    w.wine_name,
    w.vintage,
    COUNT(s.id) as bottle_count,
    STRING_AGG(s.location_code, ', ') as locations,
    rn.reduce_reason,
    w.vivino_rating
FROM reduce_now rn
JOIN wines w ON w.id = rn.wine_id
LEFT JOIN slots s ON s.wine_id = w.id
GROUP BY rn.cellar_id, rn.id, rn.priority, w.style, w.colour, w.wine_name, w.vintage, rn.reduce_reason, w.vivino_rating
ORDER BY rn.priority, w.wine_name;

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON VIEW inventory_view IS 'Wine inventory with bottle counts, filtered by cellar_id';
COMMENT ON VIEW reduce_now_view IS 'Reduce-now list with details, filtered by cellar_id';
