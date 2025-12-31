-- Migration 012: Performance optimization indexes
-- These indexes address slow queries identified on Synology NAS deployment

-- Critical: Index for rating source lookups
-- Used in: src/routes/ratings.js filtering by source
CREATE INDEX IF NOT EXISTS idx_wine_ratings_source ON wine_ratings(source);

-- Critical: Index for reduce_now wine lookups
-- Used in: DELETE operations and JOIN queries
CREATE INDEX IF NOT EXISTS idx_reduce_now_wine_id ON reduce_now(wine_id);

-- Critical: Index for consumption log wine lookups
-- Used in: JOIN with wines table in consumption history
CREATE INDEX IF NOT EXISTS idx_consumption_log_wine_id ON consumption_log(wine_id);

-- Critical: Index for consumption log date range queries
-- Used in: Recent consumption stats (last 30 days)
CREATE INDEX IF NOT EXISTS idx_consumption_log_date ON consumption_log(consumed_at);

-- High: Composite index for slot zone + wine queries
-- Used in: Layout queries filtering by zone and joining wines
CREATE INDEX IF NOT EXISTS idx_slots_zone_wine ON slots(zone, wine_id);

-- Medium: Index for wine ratings user override filtering
-- Used in: Filtering out user overrides in aggregation
CREATE INDEX IF NOT EXISTS idx_wine_ratings_override ON wine_ratings(is_user_override);

-- Medium: Composite index for rating aggregation queries
-- Used in: Grouping ratings by wine and lens
CREATE INDEX IF NOT EXISTS idx_wine_ratings_wine_lens ON wine_ratings(wine_id, source_lens);

-- Medium: Index for wines country filtering
-- Used in: Regional relevance calculations
CREATE INDEX IF NOT EXISTS idx_wines_country ON wines(country);

-- Medium: Index for wines vintage (aging calculations)
-- Used in: Drinking window and reduce-now logic
CREATE INDEX IF NOT EXISTS idx_wines_vintage ON wines(vintage);

-- Analyze tables to update query planner statistics
ANALYZE wines;
ANALYZE slots;
ANALYZE wine_ratings;
ANALYZE reduce_now;
ANALYZE consumption_log;
ANALYZE drinking_windows;
