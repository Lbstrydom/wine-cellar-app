-- Migration 011: Competition Awards Database
-- Local database for storing awards from competitions like Veritas, IWSC, Decanter, etc.

-- Award sources table - tracks imported award documents/pages
CREATE TABLE IF NOT EXISTS award_sources (
    id TEXT PRIMARY KEY,                    -- e.g., 'veritas_2024', 'iwsc_2023_gold'
    competition_id TEXT NOT NULL,           -- e.g., 'veritas', 'iwsc', 'decanter'
    competition_name TEXT NOT NULL,         -- e.g., 'Veritas Wine Awards'
    year INTEGER NOT NULL,                  -- Competition year
    source_url TEXT,                        -- Original URL or file path
    source_type TEXT NOT NULL,              -- 'pdf', 'webpage', 'magazine', 'csv', 'manual'
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    award_count INTEGER DEFAULT 0,          -- Number of awards imported
    status TEXT DEFAULT 'pending',          -- 'pending', 'processing', 'completed', 'failed'
    error_message TEXT,                     -- Error details if failed
    notes TEXT                              -- User notes about this source
);

CREATE INDEX IF NOT EXISTS idx_award_sources_competition ON award_sources(competition_id, year);

-- Competition awards table - individual award entries
CREATE TABLE IF NOT EXISTS competition_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,                -- References award_sources.id

    -- Wine identification (as listed in source)
    producer TEXT,                          -- Winery/producer name
    wine_name TEXT NOT NULL,                -- Full wine name as listed
    wine_name_normalized TEXT,              -- Lowercase, cleaned for matching
    vintage INTEGER,                        -- NULL if not specified

    -- Award details
    award TEXT NOT NULL,                    -- 'gold', 'silver', 'bronze', 'double_gold', 'best_in_class', etc.
    award_normalized TEXT,                  -- Normalized award code
    category TEXT,                          -- Wine category in competition
    region TEXT,                            -- Region if specified

    -- Match tracking (matched_wine_id references wines table in cellar.db, not enforced via FK)
    matched_wine_id INTEGER,                -- Linked wine in cellar (NULL if not matched)
    match_type TEXT,                        -- 'exact', 'fuzzy', 'manual', NULL
    match_confidence REAL,                  -- 0.0-1.0 confidence score

    -- Metadata
    extra_info TEXT,                        -- JSON for any additional data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (source_id) REFERENCES award_sources(id) ON DELETE CASCADE,
    UNIQUE(source_id, wine_name, vintage, award)
);

CREATE INDEX IF NOT EXISTS idx_competition_awards_source ON competition_awards(source_id);
CREATE INDEX IF NOT EXISTS idx_competition_awards_wine ON competition_awards(matched_wine_id);
CREATE INDEX IF NOT EXISTS idx_competition_awards_normalized ON competition_awards(wine_name_normalized);
CREATE INDEX IF NOT EXISTS idx_competition_awards_producer ON competition_awards(producer);

-- Known competitions registry
CREATE TABLE IF NOT EXISTS known_competitions (
    id TEXT PRIMARY KEY,                    -- e.g., 'veritas', 'iwsc', 'decanter'
    name TEXT NOT NULL,                     -- Full name
    short_name TEXT,                        -- Abbreviated name
    country TEXT,                           -- Primary country
    scope TEXT DEFAULT 'regional',          -- 'regional', 'national', 'international'
    website TEXT,                           -- Official website
    award_types TEXT,                       -- JSON array of award types (gold, silver, etc.)
    credibility REAL DEFAULT 0.85,          -- Credibility weight for ratings
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed common competitions
INSERT OR IGNORE INTO known_competitions (id, name, short_name, country, scope, website, award_types, credibility) VALUES
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
    ('john_platter', 'John Platter Guide', 'Platter', 'South Africa', 'national', 'https://platteronline.com', '["five_star", "four_half_star", "four_star"]', 0.90);
