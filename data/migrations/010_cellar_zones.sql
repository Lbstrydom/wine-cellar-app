-- Migration 010: Dynamic Cellar Clustering System
-- Adds canonical wine fields and zone allocation tracking

-- Add canonical classification fields to wines table
ALTER TABLE wines ADD COLUMN grapes TEXT;           -- JSON array: ['cabernet sauvignon', 'merlot']
ALTER TABLE wines ADD COLUMN region TEXT;           -- e.g., 'Western Cape', 'Piedmont'
ALTER TABLE wines ADD COLUMN appellation TEXT;      -- e.g., 'Stellenbosch', 'Barolo DOCG'
ALTER TABLE wines ADD COLUMN winemaking TEXT;       -- JSON array: ['appassimento', 'oak_aged', 'organic']
ALTER TABLE wines ADD COLUMN sweetness TEXT DEFAULT 'dry';  -- 'dry' | 'off-dry' | 'medium-sweet' | 'sweet'
ALTER TABLE wines ADD COLUMN zone_id TEXT;          -- Assigned zone
ALTER TABLE wines ADD COLUMN zone_confidence TEXT;  -- 'high' | 'medium' | 'low'

-- Track active zone → row mappings
CREATE TABLE IF NOT EXISTS zone_allocations (
    zone_id TEXT PRIMARY KEY,
    assigned_rows TEXT NOT NULL,        -- JSON array: ["R5", "R6"]
    first_wine_date DATETIME,
    wine_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Backfill colour for existing wines (use existing colour column)
-- Note: wines.colour already exists in schema

-- Create index for zone lookups
CREATE INDEX IF NOT EXISTS idx_wines_zone ON wines(zone_id);
CREATE INDEX IF NOT EXISTS idx_wines_country ON wines(country);
