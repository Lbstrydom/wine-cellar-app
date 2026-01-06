-- Wine Cellar App Schema (PostgreSQL)
-- Storage layout: Fridge (F1-F9), Cellar (R1C1-R1C7, R2C1-R19C9)
-- This schema is for PostgreSQL (Supabase/Railway)

-- Wines table: master inventory
CREATE TABLE IF NOT EXISTS wines (
    id SERIAL PRIMARY KEY,
    style TEXT NOT NULL,
    colour TEXT NOT NULL CHECK (colour IN ('red', 'white', 'rose', 'sparkling')),
    wine_name TEXT NOT NULL,
    vintage INTEGER, -- NULL for NV wines
    vivino_rating REAL,
    price_eur REAL,
    notes TEXT,
    country TEXT,
    tasting_notes TEXT,
    competition_index REAL,
    critics_index REAL,
    community_index REAL,
    purchase_score REAL,
    purchase_stars REAL,
    confidence_level TEXT,
    ratings_updated_at TIMESTAMP,
    drink_from INTEGER,
    drink_peak INTEGER,
    drink_until INTEGER,
    -- Additional columns from migrations
    grapes TEXT,
    region TEXT,
    winemaking TEXT,
    sweetness TEXT,
    producer TEXT,
    personal_rating REAL,
    personal_notes TEXT,
    personal_rated_at TIMESTAMP,
    vivino_id TEXT,
    vivino_url TEXT,
    vivino_confirmed BOOLEAN DEFAULT FALSE,
    zone_id TEXT,
    zone_confidence TEXT,
    tasting_profile_json TEXT,
    -- Full-text search vector (PostgreSQL native)
    search_vector tsvector,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Normalised style lookup for pairing matrix matching
CREATE TABLE IF NOT EXISTS style_mappings (
    id SERIAL PRIMARY KEY,
    style_original TEXT NOT NULL,
    style_norm TEXT NOT NULL
);

-- Physical storage slots
CREATE TABLE IF NOT EXISTS slots (
    id SERIAL PRIMARY KEY,
    zone TEXT NOT NULL CHECK (zone IN ('fridge', 'cellar')),
    location_code TEXT NOT NULL UNIQUE, -- F1, R2C5, etc.
    row_num INTEGER NOT NULL,
    col_num INTEGER, -- NULL for fridge (linear)
    wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
    UNIQUE(zone, row_num, col_num)
);

-- Reduce-now priority list
CREATE TABLE IF NOT EXISTS reduce_now (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    reduce_reason TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Consumption log for history/analytics
CREATE TABLE IF NOT EXISTS consumption_log (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER REFERENCES wines(id),
    wine_name TEXT,
    vintage INTEGER,
    style TEXT,
    colour TEXT,
    country TEXT,
    location_code TEXT,
    consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    occasion TEXT,
    pairing_dish TEXT,
    consumption_notes TEXT,
    consumption_rating INTEGER CHECK (consumption_rating BETWEEN 1 AND 5)
);

-- Pairing matrix: food signals to wine style buckets
CREATE TABLE IF NOT EXISTS pairing_rules (
    id SERIAL PRIMARY KEY,
    food_signal TEXT NOT NULL,
    wine_style_bucket TEXT NOT NULL,
    match_level TEXT NOT NULL CHECK (match_level IN ('primary', 'good', 'fallback')),
    UNIQUE(food_signal, wine_style_bucket)
);

-- Wine ratings table for individual ratings from various sources
CREATE TABLE IF NOT EXISTS wine_ratings (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL,
    vintage INTEGER,
    source TEXT NOT NULL,
    source_lens TEXT NOT NULL,
    score_type TEXT NOT NULL,
    raw_score TEXT NOT NULL,
    raw_score_numeric REAL,
    normalized_min REAL NOT NULL,
    normalized_max REAL NOT NULL,
    normalized_mid REAL NOT NULL,
    award_name TEXT,
    competition_year INTEGER,
    reviewer_name TEXT,
    rating_count INTEGER,
    source_url TEXT,
    evidence_excerpt TEXT,
    matched_wine_label TEXT,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    vintage_match TEXT DEFAULT 'exact',
    match_confidence TEXT DEFAULT 'high',
    is_user_override BOOLEAN DEFAULT FALSE,
    override_normalized_mid REAL,
    override_note TEXT,
    FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE,
    UNIQUE(wine_id, vintage, source, competition_year, award_name)
);

-- Drinking windows table
CREATE TABLE IF NOT EXISTS drinking_windows (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    drink_from_year INTEGER,
    drink_by_year INTEGER,
    peak_year INTEGER,
    confidence TEXT DEFAULT 'medium',
    raw_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wine_id, source)
);

-- User settings table
CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SERP Result Cache
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

-- Page Content Cache
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

-- Extraction Cache (Claude results)
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

-- Cache Configuration
CREATE TABLE IF NOT EXISTS cache_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
);

-- Background Job Queue
CREATE TABLE IF NOT EXISTS job_queue (
    id SERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    payload TEXT NOT NULL,
    result TEXT,
    progress INTEGER DEFAULT 0,
    progress_message TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Job History
CREATE TABLE IF NOT EXISTS job_history (
    id INTEGER PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    result TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Cellar zones table
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

-- Zone row assignments
CREATE TABLE IF NOT EXISTS zone_row_assignments (
    id SERIAL PRIMARY KEY,
    zone_id TEXT NOT NULL REFERENCES cellar_zones(id) ON DELETE CASCADE,
    row_pattern TEXT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(zone_id, row_pattern)
);

-- Award sources table
CREATE TABLE IF NOT EXISTS award_sources (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    competition_name TEXT NOT NULL,
    year INTEGER NOT NULL,
    source_url TEXT,
    source_type TEXT NOT NULL,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    award_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    notes TEXT
);

-- Competition awards table
CREATE TABLE IF NOT EXISTS competition_awards (
    id SERIAL PRIMARY KEY,
    source_id TEXT NOT NULL,
    producer TEXT,
    wine_name TEXT NOT NULL,
    wine_name_normalized TEXT,
    vintage INTEGER,
    award TEXT NOT NULL,
    award_normalized TEXT,
    category TEXT,
    region TEXT,
    matched_wine_id INTEGER,
    match_type TEXT,
    match_confidence REAL,
    extra_info TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES award_sources(id) ON DELETE CASCADE,
    UNIQUE(source_id, wine_name, vintage, award)
);

-- Known competitions registry
CREATE TABLE IF NOT EXISTS known_competitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT,
    country TEXT,
    scope TEXT DEFAULT 'regional',
    website TEXT,
    award_types TEXT,
    credibility REAL DEFAULT 0.85,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Data Provenance Ledger
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

-- Wine serving temperatures
CREATE TABLE IF NOT EXISTS wine_serving_temps (
    id SERIAL PRIMARY KEY,
    wine_type TEXT NOT NULL,
    style_pattern TEXT,
    temp_min_c INTEGER NOT NULL,
    temp_max_c INTEGER NOT NULL,
    notes TEXT,
    UNIQUE(wine_type, style_pattern)
);

-- Chat sessions for sommelier
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    context TEXT,
    message_count INTEGER DEFAULT 0
);

-- Palate profile feedback
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

-- Palate profile aggregates
CREATE TABLE IF NOT EXISTS palate_profile (
    id SERIAL PRIMARY KEY,
    dimension TEXT NOT NULL UNIQUE,
    preference_score REAL DEFAULT 0.5,
    sample_count INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_slots_wine ON slots(wine_id);
CREATE INDEX IF NOT EXISTS idx_slots_zone ON slots(zone);
CREATE INDEX IF NOT EXISTS idx_reduce_now_priority ON reduce_now(priority);
CREATE INDEX IF NOT EXISTS idx_wines_style ON wines(style);
CREATE INDEX IF NOT EXISTS idx_wines_colour ON wines(colour);
CREATE INDEX IF NOT EXISTS idx_wines_name ON wines(wine_name);
CREATE INDEX IF NOT EXISTS idx_ratings_wine ON wine_ratings(wine_id);
CREATE INDEX IF NOT EXISTS idx_ratings_wine_vintage ON wine_ratings(wine_id, vintage);
CREATE INDEX IF NOT EXISTS idx_ratings_lens ON wine_ratings(source_lens);
CREATE INDEX IF NOT EXISTS idx_drinking_windows_wine_id ON drinking_windows(wine_id);
CREATE INDEX IF NOT EXISTS idx_drinking_windows_drink_by ON drinking_windows(drink_by_year);
CREATE INDEX IF NOT EXISTS idx_drinking_windows_source ON drinking_windows(source);
CREATE INDEX IF NOT EXISTS idx_search_cache_key ON search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_page_cache_hash ON page_cache(url_hash);
CREATE INDEX IF NOT EXISTS idx_page_cache_expires ON page_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_extraction_cache_wine ON extraction_cache(wine_id);
CREATE INDEX IF NOT EXISTS idx_extraction_cache_expires ON extraction_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_job_queue_type ON job_queue(job_type);
CREATE INDEX IF NOT EXISTS idx_job_history_type ON job_history(job_type);
CREATE INDEX IF NOT EXISTS idx_job_history_completed ON job_history(completed_at);
CREATE INDEX IF NOT EXISTS idx_provenance_wine ON data_provenance(wine_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source ON data_provenance(source_id);
CREATE INDEX IF NOT EXISTS idx_provenance_expires ON data_provenance(expires_at);
CREATE INDEX IF NOT EXISTS idx_provenance_field ON data_provenance(field_name);
CREATE INDEX IF NOT EXISTS idx_provenance_wine_source_field ON data_provenance(wine_id, source_id, field_name);
CREATE INDEX IF NOT EXISTS idx_award_sources_competition ON award_sources(competition_id, year);
CREATE INDEX IF NOT EXISTS idx_competition_awards_source ON competition_awards(source_id);
CREATE INDEX IF NOT EXISTS idx_competition_awards_wine ON competition_awards(matched_wine_id);
CREATE INDEX IF NOT EXISTS idx_competition_awards_normalized ON competition_awards(wine_name_normalized);
CREATE INDEX IF NOT EXISTS idx_competition_awards_producer ON competition_awards(producer);
CREATE INDEX IF NOT EXISTS idx_wines_zone ON wines(zone_id);

-- Full-text search index (PostgreSQL native)
CREATE INDEX IF NOT EXISTS idx_wines_search ON wines USING GIN(search_vector);

-- =============================================================================
-- VIEWS (PostgreSQL syntax)
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

-- =============================================================================
-- FULL-TEXT SEARCH TRIGGER
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

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Cache configuration defaults
INSERT INTO cache_config (key, value, description) VALUES
  ('serp_ttl_hours', '24', 'SERP results cache duration'),
  ('page_ttl_hours', '168', 'Page content cache duration (7 days)'),
  ('extraction_ttl_hours', '720', 'Extraction cache duration (30 days)'),
  ('blocked_page_ttl_hours', '24', 'Blocked page retry interval'),
  ('cache_cleanup_interval_hours', '6', 'How often to purge expired cache')
ON CONFLICT (key) DO NOTHING;

-- Known competitions
INSERT INTO known_competitions (id, name, short_name, country, scope, website, award_types, credibility) VALUES
    ('veritas', 'Veritas Wine Awards', 'Veritas', 'South Africa', 'national', 'https://veritasawards.co.za', '["double_gold", "gold", "silver", "bronze"]', 0.85),
    ('omtws', 'Old Mutual Trophy Wine Show', 'OMTWS', 'South Africa', 'national', 'https://www.trophywineshow.co.za', '["trophy", "gold", "silver", "bronze"]', 0.88),
    ('iwsc', 'International Wine & Spirit Competition', 'IWSC', 'UK', 'international', 'https://iwsc.net', '["trophy", "gold_outstanding", "gold", "silver", "bronze"]', 0.90),
    ('decanter', 'Decanter World Wine Awards', 'DWWA', 'UK', 'international', 'https://awards.decanter.com', '["best_in_show", "platinum", "gold", "silver", "bronze"]', 0.92),
    ('iwc', 'International Wine Challenge', 'IWC', 'UK', 'international', 'https://www.internationalwinechallenge.com', '["trophy", "gold", "silver", "bronze", "commended"]', 0.90),
    ('descorchados', 'Descorchados', 'Descorchados', 'Chile', 'international', 'https://descorchados.com', '["points"]', 0.88),
    ('mundus_vini', 'Mundus Vini', 'Mundus Vini', 'Germany', 'international', 'https://www.mundusvini.com', '["grand_gold", "gold", "silver"]', 0.86),
    ('concours_mondial', 'Concours Mondial de Bruxelles', 'CMB', 'Belgium', 'international', 'https://concoursmondial.com', '["grand_gold", "gold", "silver"]', 0.87),
    ('san_francisco', 'San Francisco International Wine Competition', 'SFIWC', 'USA', 'international', 'https://www.sfwinecomp.com', '["double_gold", "gold", "silver", "bronze"]', 0.85),
    ('texsom', 'TEXSOM International Wine Awards', 'TEXSOM', 'USA', 'international', 'https://texsom.com', '["double_gold", "gold", "silver", "bronze"]', 0.84),
    ('sakura', 'Sakura Japan Women''s Wine Awards', 'Sakura', 'Japan', 'international', 'https://www.sakuraaward.com', '["double_gold", "gold", "silver"]', 0.83),
    ('absa_top10', 'Absa Top 10 Pinotage', 'Top 10 Pinotage', 'South Africa', 'national', 'https://pinotage.co.za', '["top_10"]', 0.87),
    ('john_platter', 'John Platter Guide', 'Platter', 'South Africa', 'national', 'https://platteronline.com', '["five_star", "four_half_star", "four_star"]', 0.90)
ON CONFLICT (id) DO NOTHING;

-- Default cellar zones
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

-- Serving temperature defaults
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
