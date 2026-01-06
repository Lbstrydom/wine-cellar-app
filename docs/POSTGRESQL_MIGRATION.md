# PostgreSQL Migration Guide

This document outlines migrating from SQLite to PostgreSQL (Supabase) + Railway deployment.

## Why PostgreSQL?

- **Multi-tenant ready**: Future support for alpha testers with separate data
- **Managed hosting**: Supabase provides free PostgreSQL with backups
- **No file corruption**: No SQLite WAL issues that plagued Fly.io
- **Better concurrency**: PostgreSQL handles concurrent writes better

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Railway App   │────▶│    Supabase     │
│  (Node.js/Docker)│     │  (PostgreSQL)   │
└─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Cloudflare DNS │
│ cellar.creathyst.com
└─────────────────┘
```

---

## Database Schema Changes

### SQLite → PostgreSQL Syntax Differences

| SQLite | PostgreSQL |
|--------|------------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `DATETIME` | `TIMESTAMP` |
| `TEXT` | `TEXT` (same) |
| `REAL` | `REAL` or `DOUBLE PRECISION` |
| `BOOLEAN DEFAULT 0` | `BOOLEAN DEFAULT FALSE` |
| `GROUP_CONCAT(col, ', ')` | `STRING_AGG(col, ', ')` |
| FTS5 virtual tables | Use `pg_trgm` extension |

### Tables to Migrate

**Main Database (cellar.db):**
1. `wines` - Master wine inventory
2. `slots` - Physical storage locations
3. `reduce_now` - Priority drinking list
4. `consumption_log` - Drinking history
5. `pairing_rules` - Food pairing matrix
6. `wine_ratings` - External ratings
7. `drinking_windows` - Optimal drinking dates
8. `user_settings` - User preferences
9. `style_mappings` - Style normalization
10. `zone_allocations` - Zone row mappings
11. `zone_metadata` - Zone descriptions

**Awards Database (awards.db):**
1. `award_sources` - Imported award documents
2. `competition_awards` - Individual awards
3. `known_competitions` - Competition registry

---

## Step 1: Supabase Setup

### Create Project
1. Go to https://supabase.com
2. Sign up/login with GitHub
3. Click "New Project"
4. Settings:
   - Name: `wine-cellar`
   - Database Password: (generate strong password)
   - Region: Choose closest to you (e.g., Frankfurt for EU)
5. Wait for project to provision (~2 minutes)

### Get Connection String
1. Go to Project Settings → Database
2. Copy the "Connection string" (URI format)
3. It looks like:
   ```
   postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```

### Enable Extensions
Run in Supabase SQL Editor:
```sql
-- Enable trigram extension for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

---

## Step 2: PostgreSQL Schema

Create this schema in Supabase SQL Editor:

```sql
-- Wine Cellar PostgreSQL Schema
-- Converted from SQLite

-- Wines table: master inventory
CREATE TABLE wines (
    id SERIAL PRIMARY KEY,
    style TEXT NOT NULL,
    colour TEXT NOT NULL CHECK (colour IN ('red', 'white', 'rose', 'sparkling')),
    wine_name TEXT NOT NULL,
    vintage INTEGER,
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
    -- Migration 010: Zone fields
    grapes TEXT,
    region TEXT,
    appellation TEXT,
    winemaking TEXT,
    sweetness TEXT DEFAULT 'dry',
    zone_id TEXT,
    zone_confidence TEXT,
    -- Migration 013: Data provenance
    producer TEXT,
    -- Migration 016: Vivino reference
    vivino_id INTEGER,
    vivino_url TEXT,
    vivino_confirmed BOOLEAN DEFAULT FALSE,
    vivino_confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Style mappings
CREATE TABLE style_mappings (
    id SERIAL PRIMARY KEY,
    style_original TEXT NOT NULL,
    style_norm TEXT NOT NULL
);

-- Physical storage slots
CREATE TABLE slots (
    id SERIAL PRIMARY KEY,
    zone TEXT NOT NULL CHECK (zone IN ('fridge', 'cellar')),
    location_code TEXT NOT NULL UNIQUE,
    row_num INTEGER NOT NULL,
    col_num INTEGER,
    wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
    UNIQUE(zone, row_num, col_num)
);

-- Reduce-now priority list
CREATE TABLE reduce_now (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    reduce_reason TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Consumption log
CREATE TABLE consumption_log (
    id SERIAL PRIMARY KEY,
    wine_id INTEGER NOT NULL REFERENCES wines(id),
    slot_location TEXT,
    consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    occasion TEXT,
    pairing_dish TEXT,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    notes TEXT
);

-- Pairing rules
CREATE TABLE pairing_rules (
    id SERIAL PRIMARY KEY,
    food_signal TEXT NOT NULL,
    wine_style_bucket TEXT NOT NULL,
    match_level TEXT NOT NULL CHECK (match_level IN ('primary', 'good', 'fallback')),
    UNIQUE(food_signal, wine_style_bucket)
);

-- Wine ratings
CREATE TABLE wine_ratings (
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

-- Drinking windows
CREATE TABLE drinking_windows (
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

-- User settings
CREATE TABLE user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Zone allocations
CREATE TABLE zone_allocations (
    zone_id TEXT PRIMARY KEY,
    assigned_rows TEXT NOT NULL,
    first_wine_date TIMESTAMP,
    wine_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Zone metadata
CREATE TABLE zone_metadata (
    zone_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    purpose TEXT,
    style_range TEXT,
    serving_temp TEXT,
    aging_advice TEXT,
    pairing_hints TEXT,
    example_wines TEXT,
    family TEXT,
    seasonal_notes TEXT,
    ai_suggested_at TIMESTAMP,
    user_confirmed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Awards database tables
CREATE TABLE award_sources (
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

CREATE TABLE competition_awards (
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

CREATE TABLE known_competitions (
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

-- Indexes
CREATE INDEX idx_slots_wine ON slots(wine_id);
CREATE INDEX idx_slots_zone ON slots(zone);
CREATE INDEX idx_reduce_now_priority ON reduce_now(priority);
CREATE INDEX idx_wines_style ON wines(style);
CREATE INDEX idx_wines_colour ON wines(colour);
CREATE INDEX idx_wines_name ON wines(wine_name);
CREATE INDEX idx_wines_zone ON wines(zone_id);
CREATE INDEX idx_wines_country ON wines(country);
CREATE INDEX idx_wines_vivino_id ON wines(vivino_id);
CREATE INDEX idx_ratings_wine ON wine_ratings(wine_id);
CREATE INDEX idx_ratings_wine_vintage ON wine_ratings(wine_id, vintage);
CREATE INDEX idx_ratings_lens ON wine_ratings(source_lens);
CREATE INDEX idx_drinking_windows_wine_id ON drinking_windows(wine_id);
CREATE INDEX idx_drinking_windows_drink_by ON drinking_windows(drink_by_year);
CREATE INDEX idx_drinking_windows_source ON drinking_windows(source);
CREATE INDEX idx_award_sources_competition ON award_sources(competition_id, year);
CREATE INDEX idx_competition_awards_source ON competition_awards(source_id);
CREATE INDEX idx_competition_awards_wine ON competition_awards(matched_wine_id);
CREATE INDEX idx_competition_awards_normalized ON competition_awards(wine_name_normalized);
CREATE INDEX idx_competition_awards_producer ON competition_awards(producer);

-- Views
CREATE VIEW inventory_view AS
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

CREATE VIEW reduce_now_view AS
SELECT
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

-- Seed known competitions
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
```

---

## Step 3: Update Application Code

### Install PostgreSQL Driver

```bash
npm uninstall better-sqlite3
npm install pg
```

### Update package.json

Remove `better-sqlite3`, add `pg`:
```json
{
  "dependencies": {
    "pg": "^8.11.3"
  }
}
```

### Update src/db/index.js

See `src/db/postgres.js` for the new implementation.

---

## Step 4: Data Migration

### Export from SQLite (on Synology)

```bash
# SSH to Synology
ssh lstrydom@192.168.86.31

# Export each table to CSV
cd ~/Apps/wine-cellar-app/data
sqlite3 cellar.db ".mode csv" ".headers on" ".output wines.csv" "SELECT * FROM wines;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output slots.csv" "SELECT * FROM slots;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output reduce_now.csv" "SELECT * FROM reduce_now;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output consumption_log.csv" "SELECT * FROM consumption_log;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output wine_ratings.csv" "SELECT * FROM wine_ratings;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output drinking_windows.csv" "SELECT * FROM drinking_windows;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output user_settings.csv" "SELECT * FROM user_settings;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output zone_allocations.csv" "SELECT * FROM zone_allocations;"
sqlite3 cellar.db ".mode csv" ".headers on" ".output zone_metadata.csv" "SELECT * FROM zone_metadata;"

# Awards database
sqlite3 awards.db ".mode csv" ".headers on" ".output award_sources.csv" "SELECT * FROM award_sources;"
sqlite3 awards.db ".mode csv" ".headers on" ".output competition_awards.csv" "SELECT * FROM competition_awards;"
```

### Download CSVs

```bash
scp lstrydom@192.168.86.31:~/Apps/wine-cellar-app/data/*.csv ./data/
```

### Import to Supabase

Use Supabase Dashboard → Table Editor → Import CSV for each table.

Or use the `scripts/migrate-to-postgres.js` script.

---

## Step 5: Railway Deployment

### Create Railway Project

1. Go to https://railway.app
2. Login with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select `wine-cellar-app` repository
5. Railway auto-detects Node.js

### Configure Environment Variables

In Railway dashboard, add:
```
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
NODE_ENV=production
PORT=3000
ANTHROPIC_API_KEY=your-key
BRIGHTDATA_API_KEY=your-key
BRIGHTDATA_SERP_ZONE=your-zone
BRIGHTDATA_WEB_ZONE=your-zone
```

### Configure Domain

1. Railway Settings → Networking → Generate Domain
2. Or add custom domain: `cellar.creathyst.com`
3. Update Cloudflare DNS to point to Railway

### Deploy

Railway auto-deploys on git push. Or trigger manually in dashboard.

---

## Step 6: Update CLAUDE.md

Update deployment instructions to reference Railway instead of Fly.io.

---

## Rollback Plan

If PostgreSQL migration fails:
1. Synology deployment still works at `http://192.168.86.31:3000`
2. SQLite databases remain on Synology
3. Can revert code to use `better-sqlite3`

---

## Cost Comparison

| Service | Free Tier | Notes |
|---------|-----------|-------|
| Supabase | 500MB database, 2GB transfer | Sufficient for personal use |
| Railway | $5 credit/month | ~$5/month after free tier |
| Fly.io | 3 shared VMs, 1GB volumes | Had SQLite corruption issues |

**Estimated monthly cost**: $0-5 (within free tiers for personal use)

---

## Multi-Tenant Future

When adding alpha testers:

1. Add `user_id` column to `wines`, `slots`, `consumption_log`, etc.
2. Add `users` table with authentication
3. Update queries to filter by `user_id`
4. Each user sees only their own cellar

Supabase provides built-in auth and Row Level Security (RLS) for this.
