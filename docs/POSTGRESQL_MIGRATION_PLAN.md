# PostgreSQL Migration Plan

## Overview

This document outlines the complete refactoring required to achieve true PostgreSQL/SQLite dual compatibility. The goal is to eliminate all workarounds and create a clean, maintainable architecture.

## Current State

- **Database Selection**: `src/db/index.js` dynamically imports `postgres.js` or `sqlite.js` based on `DATABASE_URL`
- **Schema**: Single SQLite-specific `schema.sql` with SQLite-only syntax
- **Migrations**: 18 migration files using SQLite-specific syntax
- **Runtime DDL**: `provenance.js` creates tables at runtime with SQLite syntax
- **Views**: Two views using `GROUP_CONCAT` (SQLite-only)
- **FTS5**: Full-text search using SQLite's FTS5 virtual tables

---

## Phase 1: Schema Refactoring

### 1.1 Create Dual Schema Files

**Why**: PostgreSQL and SQLite have fundamental syntax differences that cannot be bridged with simple string replacements.

**Actions**:
1. Create `data/schema.sqlite.sql` - Keep existing SQLite schema
2. Create `data/schema.postgres.sql` - PostgreSQL-native schema

**PostgreSQL Schema Changes Required**:

| SQLite | PostgreSQL | Example |
|--------|------------|---------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` | Table primary keys |
| `DATETIME` | `TIMESTAMP` | All datetime columns |
| `BOOLEAN` (stored as 0/1) | `BOOLEAN` | Native boolean |
| `TEXT` with CHECK | `TEXT` or `ENUM` | Colour constraints |
| `GROUP_CONCAT(x, ', ')` | `STRING_AGG(x, ', ')` | Views |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` | Seed data |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT DO UPDATE` | Upserts |

### 1.2 Refactor Views for PostgreSQL

**inventory_view** (PostgreSQL version):
```sql
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
GROUP BY w.id, w.style, w.colour, w.wine_name, w.vintage,
         w.vivino_rating, w.price_eur;
```

### 1.3 Files to Create

```
data/
├── schema.sqlite.sql      # SQLite schema (renamed from schema.sql)
├── schema.postgres.sql    # PostgreSQL schema (new)
├── migrations/
│   ├── sqlite/           # SQLite-specific migrations (new folder)
│   └── postgres/         # PostgreSQL-specific migrations (new folder)
```

---

## Phase 2: Migration System Refactoring

### 2.1 Create Database-Specific Migration Folders

Since PostgreSQL is managed by Supabase (which has its own migration system), we need a strategy:

**Option A (Recommended)**: Supabase SQL Editor for PostgreSQL
- Keep SQLite migrations in `data/migrations/` for local dev
- Use Supabase Dashboard → SQL Editor for PostgreSQL schema
- Document the PostgreSQL schema in `data/schema.postgres.sql`

**Option B**: Dual Migration Files
- Create `data/migrations/sqlite/` and `data/migrations/postgres/`
- Migration runner selects folder based on `DATABASE_URL`

### 2.2 Migration Files Requiring Conversion

| File | Issues |
|------|--------|
| `001_add_ratings.sql` | `AUTOINCREMENT`, `DATETIME` |
| `009_search_cache.sql` | `AUTOINCREMENT`, `INSERT OR IGNORE` |
| `011_awards_database.sql` | `AUTOINCREMENT`, `INSERT OR IGNORE`, `DATETIME` |
| `013_data_provenance.sql` | `AUTOINCREMENT`, `DATETIME` |
| `014_fts5_search.sql` | **Completely incompatible** - needs PostgreSQL FTS alternative |

### 2.3 PostgreSQL Full-Text Search Implementation

**Replace FTS5 with PostgreSQL native full-text search**:

```sql
-- Add tsvector column to wines table
ALTER TABLE wines ADD COLUMN search_vector tsvector;

-- Create index for fast searching
CREATE INDEX idx_wines_search ON wines USING GIN(search_vector);

-- Create trigger to update search_vector
CREATE OR REPLACE FUNCTION wines_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.wine_name, '') || ' ' ||
    COALESCE(NEW.style, '') || ' ' ||
    COALESCE(NEW.country, '') || ' ' ||
    COALESCE(NEW.tasting_notes, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wines_search_trigger
  BEFORE INSERT OR UPDATE ON wines
  FOR EACH ROW EXECUTE FUNCTION wines_search_update();

-- Usage: SELECT * FROM wines WHERE search_vector @@ to_tsquery('cabernet');
```

---

## Phase 3: Runtime DDL Cleanup

### 3.1 Remove Runtime Table Creation

**File**: `src/services/provenance.js`

**Problem**: `initProvenanceTable()` creates table with SQLite `AUTOINCREMENT`

**Solution**: Remove runtime DDL - ensure table exists via migration/schema only

```javascript
// REMOVE this function entirely
export function initProvenanceTable() { ... }

// REPLACE with a validation check
export async function validateProvenanceTable() {
  try {
    await db.prepare('SELECT 1 FROM data_provenance LIMIT 1').get();
    logger.info('[Provenance] Table validated');
  } catch (error) {
    logger.error('[Provenance] Table missing - run migrations');
    throw new Error('data_provenance table not found');
  }
}
```

### 3.2 Ensure All Tables Exist in Schema

Tables currently created at runtime that need migration:
- `data_provenance` (in `013_data_provenance.sql` - already exists)
- Any other dynamically created tables

---

## Phase 4: Code Compatibility Audit

### 4.1 String Aggregation Helper

**Create a centralized helper** in `src/db/helpers.js`:

```javascript
/**
 * Get the string aggregation function for the current database.
 * @param {string} column - Column to aggregate
 * @param {string} [separator=','] - Separator string
 * @returns {string} SQL function call
 */
export function stringAgg(column, separator = ',') {
  if (process.env.DATABASE_URL) {
    return `STRING_AGG(${column}, '${separator}')`;
  }
  return `GROUP_CONCAT(${column}, '${separator}')`;
}

/**
 * Get the current timestamp function for the current database.
 * @returns {string} SQL function
 */
export function nowFunc() {
  return process.env.DATABASE_URL ? 'CURRENT_TIMESTAMP' : "datetime('now')";
}
```

### 4.2 Files Requiring Updates

| File | Function | Change Required |
|------|----------|-----------------|
| `src/routes/wines.js:230` | `getAllWines` | Use `stringAgg()` helper |
| `src/services/claude.js:55,72` | `getSommelierRecommendation` | Use `stringAgg()` helper |
| `src/services/drinkNowAI.js:60` | Wine query | Use `stringAgg()` helper |
| `src/routes/pairing.js:17` | `getAllWinesWithSlots` | Already fixed, use helper |
| `src/routes/drinkingWindows.js` | Urgent wines | Use `stringAgg()` helper |
| `src/routes/backup.js` | CSV export | Use `stringAgg()` helper |
| `src/services/pairing.js` | Pairing query | Use `stringAgg()` helper |
| `src/routes/reduceNow.js` | Reduce list | Use `stringAgg()` helper |

### 4.3 GROUP BY Completeness Check

PostgreSQL requires all non-aggregated columns in GROUP BY. Files needing audit:
- All files using `GROUP BY w.id` - must include all selected `w.*` columns
- Already fixed: `claude.js`, `pairing.js`
- Need verification: all other files

---

## Phase 5: Search Functionality

### 5.1 Dual Search Implementation

**Create `src/services/search.js`**:

```javascript
import db from '../db/index.js';

/**
 * Search wines using database-appropriate full-text search.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Matching wines
 */
export async function searchWines(query) {
  if (process.env.DATABASE_URL) {
    // PostgreSQL full-text search
    return db.prepare(`
      SELECT w.*, ts_rank(search_vector, to_tsquery('english', ?)) as rank
      FROM wines w
      WHERE search_vector @@ to_tsquery('english', ?)
      ORDER BY rank DESC
      LIMIT 50
    `).all(query, query);
  } else {
    // SQLite FTS5 search (if available) or LIKE fallback
    try {
      return db.prepare(`
        SELECT w.* FROM wines w
        WHERE w.id IN (
          SELECT rowid FROM wines_fts WHERE wines_fts MATCH ?
        )
        LIMIT 50
      `).all(query);
    } catch {
      // FTS5 not available, use LIKE
      const likeQuery = `%${query}%`;
      return db.prepare(`
        SELECT * FROM wines
        WHERE wine_name LIKE ? OR style LIKE ? OR country LIKE ?
        LIMIT 50
      `).all(likeQuery, likeQuery, likeQuery);
    }
  }
}
```

---

## Phase 6: Testing Infrastructure

### 6.1 Enhanced Compatibility Test Script

Extend `scripts/test-pg-compat.js` to cover:
- All view definitions work
- Full-text search works
- All aggregate functions work
- GROUP BY completeness
- UPSERT operations

### 6.2 Test Categories

```javascript
// tests/db-compat.test.js
describe('Database Compatibility', () => {
  describe('Schema', () => {
    it('all tables exist');
    it('all views return data');
    it('all indexes exist');
  });

  describe('Aggregation', () => {
    it('STRING_AGG/GROUP_CONCAT works');
    it('GROUP BY is complete');
  });

  describe('Search', () => {
    it('full-text search returns results');
    it('ILIKE search is case-insensitive');
  });

  describe('Upserts', () => {
    it('ON CONFLICT works for settings');
    it('ON CONFLICT works for ratings');
  });
});
```

---

## Implementation Order

### Sprint 1: Schema Foundation (Priority: Critical)
1. Create `data/schema.postgres.sql`
2. Apply PostgreSQL schema to Supabase
3. Create `src/db/helpers.js` with `stringAgg()` and `nowFunc()`
4. Update all files to use helpers

### Sprint 2: Migration Cleanup (Priority: High)
1. Move SQLite migrations to `data/migrations/sqlite/`
2. Create PostgreSQL migration documentation
3. Remove runtime DDL from `provenance.js`
4. Verify all tables exist in PostgreSQL

### Sprint 3: Search Refactoring (Priority: Medium)
1. Add `search_vector` column to PostgreSQL wines table
2. Create search trigger in PostgreSQL
3. Implement dual search in `src/services/search.js`
4. Update wine search routes to use new service

### Sprint 4: Testing & Validation (Priority: High)
1. Extend `test-pg-compat.js`
2. Add GitHub Actions test for PostgreSQL
3. Add view validation tests
4. Add search tests

---

## Files to Create/Modify Summary

### New Files
- `data/schema.postgres.sql`
- `data/migrations/sqlite/` (folder - move existing)
- `src/db/helpers.js`
- `src/services/search.js`

### Modified Files
- `src/services/provenance.js` - Remove `initProvenanceTable()`
- `src/routes/wines.js` - Use helpers
- `src/services/claude.js` - Use helpers
- `src/services/drinkNowAI.js` - Use helpers
- `src/routes/pairing.js` - Use helpers
- `src/routes/drinkingWindows.js` - Use helpers
- `src/routes/backup.js` - Use helpers
- `src/services/pairing.js` - Use helpers
- `src/routes/reduceNow.js` - Use helpers
- `scripts/test-pg-compat.js` - Extend tests

### Deprecated Files
- `data/schema.sql` - Rename to `schema.sqlite.sql`
- `data/migrations/014_fts5_search.sql` - SQLite only, document in sqlite/ folder

---

## Success Criteria

1. **Schema Parity**: PostgreSQL and SQLite have equivalent schemas
2. **Zero Runtime DDL**: No table creation at application runtime
3. **Consistent Helpers**: All string aggregation uses centralized helpers
4. **Full Search**: Both databases have functional full-text search
5. **CI/CD Validation**: GitHub Actions tests pass on both databases
6. **No Workarounds**: Code uses proper solutions, not conditional hacks

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during schema migration | Backup before any Supabase changes |
| Breaking changes in production | Test all changes in Railway preview environment first |
| FTS5 features lost in PostgreSQL | PostgreSQL FTS is more powerful - document differences |
| Performance regression | Add query performance tests to CI |

---

## Appendix: Quick Reference

### PostgreSQL vs SQLite Syntax

```sql
-- Auto-increment
SQLite:    INTEGER PRIMARY KEY AUTOINCREMENT
PostgreSQL: SERIAL PRIMARY KEY (or GENERATED ALWAYS AS IDENTITY)

-- Current timestamp
SQLite:    datetime('now')
PostgreSQL: CURRENT_TIMESTAMP

-- String aggregation
SQLite:    GROUP_CONCAT(col, ',')
PostgreSQL: STRING_AGG(col, ',')

-- Case-insensitive LIKE
SQLite:    LIKE (case-insensitive by default)
PostgreSQL: ILIKE

-- Upsert
SQLite:    INSERT OR REPLACE INTO ...
PostgreSQL: INSERT INTO ... ON CONFLICT ... DO UPDATE SET ...

-- Boolean
SQLite:    0 or 1
PostgreSQL: TRUE or FALSE (0/1 also work)
```
