-- =============================================================================
-- Supabase Migration: Add Missing Objects
-- Run this in Supabase SQL Editor
-- =============================================================================

-- 1. Add missing columns to wines table
-- =============================================================================

-- personal_rating, personal_notes, personal_rated_at
ALTER TABLE wines ADD COLUMN IF NOT EXISTS personal_rating REAL;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS personal_notes TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS personal_rated_at TIMESTAMP;

-- tasting_profile_json for structured tasting notes
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_profile_json TEXT;

-- search_vector for full-text search
ALTER TABLE wines ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- zone_override_reason for manual zone assignments
ALTER TABLE wines ADD COLUMN IF NOT EXISTS zone_override_reason TEXT;

-- 2. Create missing tables
-- =============================================================================

-- search_cache table
CREATE TABLE IF NOT EXISTS search_cache (
    id SERIAL PRIMARY KEY,
    cache_key TEXT UNIQUE NOT NULL,
    query_type TEXT NOT NULL,
    query_params TEXT NOT NULL,
    results TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_cache_key ON search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);

-- page_cache table
CREATE TABLE IF NOT EXISTS page_cache (
    id SERIAL PRIMARY KEY,
    url_hash TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    content TEXT,
    content_length INTEGER,
    fetch_status TEXT NOT NULL,
    status_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_cache_hash ON page_cache(url_hash);
CREATE INDEX IF NOT EXISTS idx_page_cache_expires ON page_cache(expires_at);

-- extraction_cache table
CREATE TABLE IF NOT EXISTS extraction_cache (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    extraction_type TEXT NOT NULL,
    extracted_ratings TEXT NOT NULL,
    extracted_windows TEXT,
    tasting_notes TEXT,
    model_version TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    UNIQUE(wine_id, content_hash, extraction_type)
);

CREATE INDEX IF NOT EXISTS idx_extraction_cache_wine ON extraction_cache(wine_id);
CREATE INDEX IF NOT EXISTS idx_extraction_cache_expires ON extraction_cache(expires_at);

-- cache_config table
CREATE TABLE IF NOT EXISTS cache_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
);

-- Insert default cache config
INSERT INTO cache_config (key, value, description) VALUES
  ('serp_ttl_hours', '24', 'SERP results cache duration'),
  ('page_ttl_hours', '168', 'Page content cache duration (7 days)'),
  ('extraction_ttl_hours', '720', 'Extraction cache duration (30 days)'),
  ('blocked_page_ttl_hours', '24', 'Blocked page retry interval'),
  ('cache_cleanup_interval_hours', '6', 'How often to purge expired cache')
ON CONFLICT (key) DO NOTHING;

-- cellar_zones table
CREATE TABLE IF NOT EXISTS cellar_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    temp_range TEXT,
    colour_preference TEXT,
    style_hints TEXT,
    priority INTEGER DEFAULT 50,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default cellar zones
INSERT INTO cellar_zones (id, name, description, temp_range, colour_preference, style_hints, priority) VALUES
    ('premium_red', 'Premium Reds', 'Best positions for age-worthy red wines', '14-16°C', 'red', 'Cabernet, Shiraz, Bordeaux blends', 10),
    ('everyday_red', 'Everyday Reds', 'Ready-to-drink red wines', '14-16°C', 'red', 'Lighter reds, Pinotage', 30),
    ('white_aromatic', 'Aromatic Whites', 'Cooler spots for aromatic whites', '10-12°C', 'white', 'Sauvignon Blanc, Riesling', 20),
    ('white_full', 'Full-bodied Whites', 'Chardonnay and oak-aged whites', '12-14°C', 'white', 'Chardonnay, Chenin Blanc', 25),
    ('sparkling', 'Sparkling', 'Coolest positions for sparkling wines', '6-10°C', 'sparkling', 'MCC, Champagne', 15),
    ('dessert_fortified', 'Dessert & Fortified', 'Sweet and fortified wines', '14-18°C', 'any', 'Port, dessert wines', 40),
    ('rose', 'Rosé', 'Rosé wines for early drinking', '10-12°C', 'rose', 'Rosé', 35),
    ('ready_to_drink', 'Ready to Drink', 'Fridge and immediate consumption', '6-10°C', 'any', 'Tonight selections', 5)
ON CONFLICT (id) DO NOTHING;

-- zone_row_assignments table
CREATE TABLE IF NOT EXISTS zone_row_assignments (
    id SERIAL PRIMARY KEY,
    zone_id TEXT NOT NULL REFERENCES cellar_zones(id) ON DELETE CASCADE,
    row_pattern TEXT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(zone_id, row_pattern)
);

-- data_provenance table
CREATE TABLE IF NOT EXISTS data_provenance (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER,
    field_name TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT,
    retrieval_method TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    retrieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    raw_hash TEXT,
    expires_at TIMESTAMP,
    FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provenance_wine ON data_provenance(wine_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source ON data_provenance(source_id);
CREATE INDEX IF NOT EXISTS idx_provenance_expires ON data_provenance(expires_at);
CREATE INDEX IF NOT EXISTS idx_provenance_field ON data_provenance(field_name);

-- wine_serving_temps table
CREATE TABLE IF NOT EXISTS wine_serving_temps (
    id SERIAL PRIMARY KEY,
    wine_type TEXT NOT NULL,
    style_pattern TEXT,
    temp_min_c INTEGER NOT NULL,
    temp_max_c INTEGER NOT NULL,
    notes TEXT,
    UNIQUE(wine_type, style_pattern)
);

-- Insert serving temperature defaults
INSERT INTO wine_serving_temps (wine_type, style_pattern, temp_min_c, temp_max_c, notes) VALUES
    ('sparkling', NULL, 6, 8, 'Well chilled'),
    ('white', 'Sauvignon Blanc', 8, 10, 'Cold'),
    ('white', 'Riesling', 8, 10, 'Cold'),
    ('white', 'Chenin Blanc', 10, 12, 'Cool'),
    ('white', 'Chardonnay', 12, 14, 'Lightly chilled'),
    ('rose', NULL, 10, 12, 'Cool'),
    ('red', 'Pinot Noir', 14, 16, 'Cellar temperature'),
    ('red', 'Pinotage', 16, 18, 'Room temperature'),
    ('red', 'Shiraz', 16, 18, 'Room temperature'),
    ('red', 'Cabernet', 16, 18, 'Room temperature'),
    ('red', 'Merlot', 16, 18, 'Room temperature'),
    ('dessert', NULL, 8, 12, 'Chilled'),
    ('fortified', 'Port', 16, 18, 'Room temperature')
ON CONFLICT (wine_type, style_pattern) DO NOTHING;

-- chat_sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    context TEXT,
    message_count INTEGER DEFAULT 0
);

-- palate_feedback table
CREATE TABLE IF NOT EXISTS palate_feedback (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    would_buy_again BOOLEAN,
    food_tags TEXT,
    occasion TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create missing views
-- =============================================================================

-- View: current inventory with locations (counts bottles per wine)
CREATE OR REPLACE VIEW inventory_view AS
SELECT
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
GROUP BY w.id, w.style, w.colour, w.wine_name, w.vintage, w.vivino_rating, w.price_eur;

-- View: reduce-now list with full details
CREATE OR REPLACE VIEW reduce_now_view AS
SELECT
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
GROUP BY rn.id, rn.priority, w.style, w.colour, w.wine_name, w.vintage, rn.reduce_reason, w.vivino_rating
ORDER BY rn.priority, w.wine_name;

-- 4. Create full-text search trigger
-- =============================================================================

-- Function to update search_vector on wine changes
CREATE OR REPLACE FUNCTION wines_search_update() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

-- Trigger to auto-update search_vector
DROP TRIGGER IF EXISTS wines_search_trigger ON wines;
CREATE TRIGGER wines_search_trigger
  BEFORE INSERT OR UPDATE ON wines
  FOR EACH ROW EXECUTE FUNCTION wines_search_update();

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_wines_search ON wines USING GIN(search_vector);

-- Backfill search_vector for existing wines
UPDATE wines SET search_vector = to_tsvector('english',
    COALESCE(wine_name, '') || ' ' ||
    COALESCE(style, '') || ' ' ||
    COALESCE(country, '') || ' ' ||
    COALESCE(producer, '') || ' ' ||
    COALESCE(region, '') || ' ' ||
    COALESCE(tasting_notes, '')
);

-- 5. Create missing indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_wines_zone ON wines(zone_id);
CREATE INDEX IF NOT EXISTS idx_palate_feedback_wine ON palate_feedback(wine_id);

-- =============================================================================
-- End of migration
-- =============================================================================
