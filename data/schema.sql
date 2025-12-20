-- Wine Cellar App Schema
-- Storage layout: Fridge (F1-F9), Cellar (R1C1-R1C7, R2C1-R19C9)

-- Wines table: master inventory
CREATE TABLE IF NOT EXISTS wines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    style TEXT NOT NULL,
    colour TEXT NOT NULL CHECK (colour IN ('red', 'white', 'rose', 'sparkling')),
    wine_name TEXT NOT NULL,
    vintage INTEGER, -- NULL for NV wines
    vivino_rating REAL,
    price_eur REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Normalised style lookup for pairing matrix matching
CREATE TABLE IF NOT EXISTS style_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    style_original TEXT NOT NULL,
    style_norm TEXT NOT NULL
);

-- Physical storage slots
CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone TEXT NOT NULL CHECK (zone IN ('fridge', 'cellar')),
    location_code TEXT NOT NULL UNIQUE, -- F1, R2C5, etc.
    row_num INTEGER NOT NULL,
    col_num INTEGER, -- NULL for fridge (linear)
    wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
    UNIQUE(zone, row_num, col_num)
);

-- Reduce-now priority list
CREATE TABLE IF NOT EXISTS reduce_now (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    reduce_reason TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Consumption log for history/analytics
CREATE TABLE IF NOT EXISTS consumption_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wine_id INTEGER NOT NULL REFERENCES wines(id),
    slot_location TEXT,
    consumed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    occasion TEXT,
    pairing_dish TEXT,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    notes TEXT
);

-- Pairing matrix: food signals to wine style buckets
CREATE TABLE IF NOT EXISTS pairing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_signal TEXT NOT NULL,
    wine_style_bucket TEXT NOT NULL,
    match_level TEXT NOT NULL CHECK (match_level IN ('primary', 'good', 'fallback')),
    UNIQUE(food_signal, wine_style_bucket)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_slots_wine ON slots(wine_id);
CREATE INDEX IF NOT EXISTS idx_slots_zone ON slots(zone);
CREATE INDEX IF NOT EXISTS idx_reduce_now_priority ON reduce_now(priority);
CREATE INDEX IF NOT EXISTS idx_wines_style ON wines(style);
CREATE INDEX IF NOT EXISTS idx_wines_colour ON wines(colour);

-- View: current inventory with locations (counts bottles per wine)
CREATE VIEW IF NOT EXISTS inventory_view AS
SELECT 
    w.id,
    w.style,
    w.colour,
    w.wine_name,
    w.vintage,
    COUNT(s.id) as bottle_count,
    GROUP_CONCAT(s.location_code, ', ') as locations,
    w.vivino_rating,
    w.price_eur,
    MAX(CASE WHEN s.zone = 'fridge' THEN 1 ELSE 0 END) as in_fridge,
    MAX(CASE WHEN s.zone = 'cellar' THEN 1 ELSE 0 END) as in_cellar
FROM wines w
LEFT JOIN slots s ON s.wine_id = w.id
GROUP BY w.id;

-- View: reduce-now list with full details
CREATE VIEW IF NOT EXISTS reduce_now_view AS
SELECT 
    rn.priority,
    w.style,
    w.colour,
    w.wine_name,
    w.vintage,
    COUNT(s.id) as bottle_count,
    GROUP_CONCAT(s.location_code, ', ') as locations,
    rn.reduce_reason,
    w.vivino_rating
FROM reduce_now rn
JOIN wines w ON w.id = rn.wine_id
LEFT JOIN slots s ON s.wine_id = w.id
GROUP BY rn.id
ORDER BY rn.priority, w.wine_name;
