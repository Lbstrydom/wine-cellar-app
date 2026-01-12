-- Migration 032a: Create all missing tables for multi-user migration
-- Run this BEFORE migration 033 to ensure all referenced tables exist
-- PostgreSQL syntax for Supabase

-- =============================================================================
-- Chat Sessions (sommelier conversations)
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    session_type TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    context_json TEXT,
    status TEXT DEFAULT 'active',
    message_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_type ON chat_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_activity ON chat_sessions(last_message_at);

-- Chat messages (if needed)
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    tokens_used INTEGER,
    model_used TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- =============================================================================
-- Palate Feedback and Profile
-- =============================================================================
CREATE TABLE IF NOT EXISTS palate_feedback (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    would_buy_again BOOLEAN,
    food_tags TEXT,
    occasion TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_palate_feedback_wine ON palate_feedback(wine_id);

CREATE TABLE IF NOT EXISTS palate_profile (
    id SERIAL PRIMARY KEY,
    dimension TEXT NOT NULL UNIQUE,
    preference_score REAL DEFAULT 0.5,
    sample_count INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Data Provenance
-- =============================================================================
CREATE TABLE IF NOT EXISTS data_provenance (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER REFERENCES wines(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT,
    retrieval_method TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    retrieved_at TIMESTAMPTZ DEFAULT NOW(),
    raw_hash TEXT,
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_provenance_wine ON data_provenance(wine_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source ON data_provenance(source_id);
CREATE INDEX IF NOT EXISTS idx_provenance_expires ON data_provenance(expires_at);
CREATE INDEX IF NOT EXISTS idx_provenance_field ON data_provenance(field_name);
CREATE INDEX IF NOT EXISTS idx_provenance_wine_source_field ON data_provenance(wine_id, source_id, field_name);

-- =============================================================================
-- Cellar Zones and Zone Management
-- =============================================================================
CREATE TABLE IF NOT EXISTS cellar_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    temp_range TEXT,
    colour_preference TEXT,
    style_hints TEXT,
    priority INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS zone_row_assignments (
    id SERIAL PRIMARY KEY,
    zone_id TEXT NOT NULL REFERENCES cellar_zones(id) ON DELETE CASCADE,
    row_pattern TEXT NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(zone_id, row_pattern)
);

CREATE TABLE IF NOT EXISTS zone_pins (
    zone_id TEXT PRIMARY KEY,
    pin_type TEXT CHECK (pin_type IN ('never_merge', 'minimum_rows', 'never_delete')),
    minimum_rows INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS zone_reconfigurations (
    id BIGSERIAL PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    plan_json JSONB NOT NULL,
    changes_summary TEXT,
    bottles_affected INTEGER,
    misplaced_before INTEGER,
    misplaced_after INTEGER,
    undone_at TIMESTAMPTZ
);

-- Zone allocations (from migration 010)
CREATE TABLE IF NOT EXISTS zone_allocations (
    zone_id TEXT PRIMARY KEY,
    assigned_rows JSONB NOT NULL,
    first_wine_date TIMESTAMPTZ,
    wine_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Search and Extraction Caches
-- =============================================================================
CREATE TABLE IF NOT EXISTS search_cache (
    id SERIAL PRIMARY KEY,
    cache_key TEXT UNIQUE NOT NULL,
    query_type TEXT NOT NULL,
    query_params TEXT NOT NULL,
    results TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_cache_key ON search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);

CREATE TABLE IF NOT EXISTS page_cache (
    id SERIAL PRIMARY KEY,
    url_hash TEXT UNIQUE NOT NULL,
    url TEXT NOT NULL,
    content TEXT,
    content_length INTEGER,
    fetch_status TEXT NOT NULL,
    status_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_cache_hash ON page_cache(url_hash);
CREATE INDEX IF NOT EXISTS idx_page_cache_expires ON page_cache(expires_at);

CREATE TABLE IF NOT EXISTS extraction_cache (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    extraction_type TEXT NOT NULL,
    extracted_ratings TEXT NOT NULL,
    extracted_windows TEXT,
    tasting_notes TEXT,
    model_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE(wine_id, content_hash, extraction_type)
);

CREATE INDEX IF NOT EXISTS idx_extraction_cache_wine ON extraction_cache(wine_id);
CREATE INDEX IF NOT EXISTS idx_extraction_cache_expires ON extraction_cache(expires_at);

-- Cache configuration
CREATE TABLE IF NOT EXISTS cache_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
);

INSERT INTO cache_config (key, value, description) VALUES
  ('serp_ttl_hours', '24', 'SERP results cache duration'),
  ('page_ttl_hours', '168', 'Page content cache duration (7 days)'),
  ('extraction_ttl_hours', '720', 'Extraction cache duration (30 days)'),
  ('blocked_page_ttl_hours', '24', 'Blocked page retry interval'),
  ('cache_cleanup_interval_hours', '6', 'How often to purge expired cache')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Background Job Queue
-- =============================================================================
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_job_queue_type ON job_queue(job_type);

CREATE TABLE IF NOT EXISTS job_history (
    id INTEGER PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    result TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_job_history_type ON job_history(job_type);
CREATE INDEX IF NOT EXISTS idx_job_history_completed ON job_history(completed_at);

-- =============================================================================
-- Cellar Analysis Cache
-- =============================================================================
CREATE TABLE IF NOT EXISTS cellar_analysis_cache (
    id SERIAL PRIMARY KEY,
    analysis_type VARCHAR(50) NOT NULL UNIQUE,
    analysis_data JSONB NOT NULL,
    wine_count INTEGER,
    slot_hash VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_type ON cellar_analysis_cache(analysis_type);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires ON cellar_analysis_cache(expires_at);

-- =============================================================================
-- Wine Serving Temperatures
-- =============================================================================
CREATE TABLE IF NOT EXISTS wine_serving_temps (
    id SERIAL PRIMARY KEY,
    wine_type TEXT NOT NULL,
    style_pattern TEXT,
    temp_min_c INTEGER NOT NULL,
    temp_max_c INTEGER NOT NULL,
    notes TEXT,
    UNIQUE(wine_type, style_pattern)
);

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

-- =============================================================================
-- Award Sources and Competitions
-- =============================================================================
CREATE TABLE IF NOT EXISTS award_sources (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    competition_name TEXT NOT NULL,
    year INTEGER NOT NULL,
    source_url TEXT,
    source_type TEXT NOT NULL,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    award_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_award_sources_competition ON award_sources(competition_id, year);

CREATE TABLE IF NOT EXISTS competition_awards (
    id SERIAL PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES award_sources(id) ON DELETE CASCADE,
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_id, wine_name, vintage, award)
);

CREATE INDEX IF NOT EXISTS idx_competition_awards_source ON competition_awards(source_id);
CREATE INDEX IF NOT EXISTS idx_competition_awards_wine ON competition_awards(matched_wine_id);
CREATE INDEX IF NOT EXISTS idx_competition_awards_normalized ON competition_awards(wine_name_normalized);
CREATE INDEX IF NOT EXISTS idx_competition_awards_producer ON competition_awards(producer);

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
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert known competitions
INSERT INTO known_competitions (id, name, short_name, country, scope, website, award_types, credibility) VALUES
    ('veritas', 'Veritas Wine Awards', 'Veritas', 'South Africa', 'national', 'https://veritasawards.co.za', '["double_gold", "gold", "silver", "bronze"]', 0.85),
    ('omtws', 'Old Mutual Trophy Wine Show', 'OMTWS', 'South Africa', 'national', 'https://www.trophywineshow.co.za', '["trophy", "gold", "silver", "bronze"]', 0.88),
    ('iwsc', 'International Wine & Spirit Competition', 'IWSC', 'UK', 'international', 'https://iwsc.net', '["trophy", "gold_outstanding", "gold", "silver", "bronze"]', 0.90),
    ('decanter', 'Decanter World Wine Awards', 'DWWA', 'UK', 'international', 'https://awards.decanter.com', '["best_in_show", "platinum", "gold", "silver", "bronze"]', 0.92),
    ('iwc', 'International Wine Challenge', 'IWC', 'UK', 'international', 'https://www.internationalwinechallenge.com', '["trophy", "gold", "silver", "bronze", "commended"]', 0.90),
    ('john_platter', 'John Platter Guide', 'Platter', 'South Africa', 'national', 'https://platteronline.com', '["five_star", "four_half_star", "four_star"]', 0.90)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Additional Wine table columns (if not already present)
-- =============================================================================
ALTER TABLE wines ADD COLUMN IF NOT EXISTS grapes TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS winemaking TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS sweetness TEXT DEFAULT 'dry';
ALTER TABLE wines ADD COLUMN IF NOT EXISTS zone_id TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS zone_confidence TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS producer TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS personal_rating REAL;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS personal_notes TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS personal_rated_at TIMESTAMPTZ;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS vivino_id TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS vivino_url TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS vivino_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS tasting_profile_json TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS zone_override_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_wines_zone ON wines(zone_id);

-- Open bottle tracking
ALTER TABLE slots ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT FALSE;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_slots_open ON slots(is_open) WHERE is_open = TRUE;

-- =============================================================================
-- Full-text search trigger
-- =============================================================================
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

DROP TRIGGER IF EXISTS wines_search_trigger ON wines;
CREATE TRIGGER wines_search_trigger
  BEFORE INSERT OR UPDATE ON wines
  FOR EACH ROW EXECUTE FUNCTION wines_search_update();

CREATE INDEX IF NOT EXISTS idx_wines_search ON wines USING GIN(search_vector);

-- =============================================================================
-- End of migration 032a
-- =============================================================================
