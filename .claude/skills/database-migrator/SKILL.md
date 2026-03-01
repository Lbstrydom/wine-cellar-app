---
name: database-migrator
description: Generates PostgreSQL database migrations for Supabase. Use when user needs to add columns, create tables, add indexes, or modify schema. Triggers on "create migration", "add column", "new table", "database change".
allowed-tools: Read, Glob, Grep, Bash(node:*)
---

# Database Migrator Skill

## Overview

Generates SQL migration files for PostgreSQL (Supabase). All migrations are PostgreSQL-only — SQLite is no longer supported.

## When to Use

- Adding new columns to existing tables
- Creating new tables
- Adding indexes for performance
- Modifying constraints
- User says: "create migration", "add column", "new table", "database change", "add index"

## Migration System

Migrations are stored in `data/migrations/` with numeric prefixes:
- Format: `NNN_description.sql` (e.g., `027_wine_ratings_cache.sql`)
- Applied in numeric order
- PostgreSQL syntax only (Supabase)

## PostgreSQL Reference

| Feature | Syntax |
|---------|--------|
| Auto-increment | `SERIAL` or `BIGSERIAL` |
| Timestamp default | `NOW()` or `CURRENT_TIMESTAMP` |
| Boolean | `BOOLEAN` |
| JSON | `JSONB` |
| Case-insensitive | `ILIKE` |
| String aggregation | `STRING_AGG()` |
| Upsert | `INSERT ... ON CONFLICT` |
| Interval | `INTERVAL '30 days'` |
| Partial index | Supported |

## Migration Template

```sql
-- Migration: NNN_description.sql
-- Purpose: Brief description of what this migration does
-- Created: YYYY-MM-DD

-- ============================================================
-- UP MIGRATION
-- ============================================================

CREATE TABLE IF NOT EXISTS table_name (
    id BIGSERIAL PRIMARY KEY,                    -- Use BIGSERIAL for new tables

    -- Foreign keys
    wine_id INTEGER REFERENCES wines(id) ON DELETE CASCADE,

    -- Cellar scope (REQUIRED for user-data tables)
    cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,

    -- Text fields
    name TEXT NOT NULL,
    description TEXT,

    -- Numeric fields
    score INTEGER,
    rating DECIMAL(3,2),                         -- For precise decimals

    -- JSON fields
    metadata JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_name UNIQUE (name),
    CONSTRAINT valid_score CHECK (score >= 0 AND score <= 100)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_table_cellar ON table_name (cellar_id);
CREATE INDEX IF NOT EXISTS idx_table_wine_id ON table_name (wine_id);
CREATE INDEX IF NOT EXISTS idx_table_created_at ON table_name (created_at DESC);

-- Partial index (for filtered queries)
CREATE INDEX IF NOT EXISTS idx_table_active
    ON table_name (created_at DESC)
    WHERE active = TRUE;

-- Row-level security (REQUIRED for all user-data tables in Supabase)
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ROLLBACK (for reference - not auto-executed)
-- ============================================================
-- DROP TABLE IF EXISTS table_name;
-- DROP INDEX IF EXISTS idx_table_wine_id;
```

## Common Patterns

### Adding a Column

```sql
-- Migration: 027_add_wine_confidence.sql
-- Purpose: Add confidence score to wine ratings

ALTER TABLE wine_ratings
    ADD COLUMN IF NOT EXISTS confidence DECIMAL(3,2);

ALTER TABLE wine_ratings
    ADD COLUMN IF NOT EXISTS confidence_source TEXT;

-- Default existing rows
UPDATE wine_ratings
SET confidence = 0.5
WHERE confidence IS NULL;
```

### Creating an Enum-like Column

```sql
-- Use CHECK constraints for enum-like validation
ALTER TABLE wines
    ADD COLUMN IF NOT EXISTS quality_tier TEXT
    CHECK (quality_tier IN ('entry', 'everyday', 'premium', 'luxury', 'icon'));
```

### Adding a Junction Table

```sql
-- Migration: 027_wine_food_pairings.sql
-- Purpose: Many-to-many between wines and food items

CREATE TABLE IF NOT EXISTS wine_food_pairings (
    id BIGSERIAL PRIMARY KEY,
    cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
    wine_id INTEGER NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    food_item TEXT NOT NULL,
    pairing_score DECIMAL(3,2),           -- 0.00 to 1.00
    source TEXT,                           -- 'ai', 'user', 'imported'
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_wine_food UNIQUE (wine_id, food_item)
);

CREATE INDEX IF NOT EXISTS idx_wine_food_cellar ON wine_food_pairings (cellar_id);
CREATE INDEX IF NOT EXISTS idx_wine_food_wine_id ON wine_food_pairings (wine_id);
ALTER TABLE wine_food_pairings ENABLE ROW LEVEL SECURITY;
```

### Creating a Cache Table

```sql
-- Migration: 027_rating_cache.sql
-- Purpose: Cache aggregated ratings for performance

CREATE TABLE IF NOT EXISTS rating_cache (
    wine_id INTEGER PRIMARY KEY REFERENCES wines(id) ON DELETE CASCADE,

    -- Aggregated scores
    competition_index INTEGER,
    critics_index INTEGER,
    community_index INTEGER,
    purchase_score INTEGER,

    -- Metadata
    source_count INTEGER,
    confidence TEXT,

    -- Cache control
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    stale BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_rating_cache_expires
    ON rating_cache (expires_at)
    WHERE stale = FALSE;
```

## Process

### Step 1: Determine Next Migration Number

```bash
# Find highest existing migration number
ls data/migrations/*.sql | sort -V | tail -1
# Example: 060_pending_ratings.sql
# Next: 061_xxx.sql
```

### Step 2: Analyze Existing Schema

Read related tables to understand foreign keys and constraints:

```sql
-- Check existing table structure in Supabase SQL Editor
\d wines
\d slots
```

### Step 3: Generate Migration SQL

Create the migration file with:
1. Header comment with purpose and date
2. `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE`
3. `cellar_id` column + index for user-data tables
4. Row-level security enabled
5. Appropriate indexes
6. Rollback comments

### Step 4: Validate SQL

Check for common issues:
- Reserved words as column names
- Missing `IF NOT EXISTS` / `IF EXISTS`
- Missing `cellar_id` on user-data tables
- Missing RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- Missing foreign key references

### Step 5: Apply

```bash
# Apply via the app's migration runner
npm run migrate

# Or apply directly in Supabase Dashboard → SQL Editor
```

## Output Format

Provide the user with:

1. **Migration file content** (ready to save)
2. **Rollback SQL** (in comments)
3. **Validation notes** (any concerns)
4. **Application notes** (how to apply)

```
Migration: 027_wine_ratings_cache.sql

File created at: data/migrations/027_wine_ratings_cache.sql

To apply:
  npm run migrate
  OR run SQL in Supabase Dashboard → SQL Editor

Rollback (if needed):
  DROP TABLE IF EXISTS rating_cache;
```

## Key Files

| File | Purpose |
|------|---------|
| `data/migrations/*.sql` | All migration files |
| `data/schema.postgres.sql` | Authoritative PostgreSQL schema |
| `src/db/index.js` | Database abstraction layer |
| `src/db/postgres.js` | PostgreSQL queries (pg driver) |

## Existing Tables Reference

Core tables in the schema:

| Table | Purpose |
|-------|---------|
| `cellars` | Multi-tenant cellar containers |
| `cellar_memberships` | User roles per cellar |
| `wines` | Master wine records |
| `slots` | Physical storage locations |
| `wine_ratings` | Individual ratings from sources |
| `drinking_windows` | Drink from/peak/until dates |
| `reduce_now` | Priority drinking list |
| `consumption_log` | Drinking history |
| `pending_ratings` | Drink-now-rate-later reminders |
| `pairing_sessions` | AI + manual food pairing sessions |
| `user_settings` | User preferences |
| `zone_metadata` | Zone descriptions and intent |
| `data_provenance` | External data tracking |
| `competition_awards` | Award records |
| `ai_review_telemetry` | AI reviewer tracking |
| `buying_guide_items` | Shopping cart items |
| `recipes` | Recipe library |

## Example Usage

User: "Add a column to track when wines were last tasted"

Claude will:
1. Check existing `wines` table schema
2. Determine next migration number
3. Generate migration adding `last_tasted_at TIMESTAMPTZ` column
4. Include index if needed for queries
5. Provide rollback SQL
6. Output complete migration file
