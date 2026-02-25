-- Migration: 054_drop_wine_unique_index.sql
-- Purpose: Remove global unique index on slots.wine_id that incorrectly
--          prevents one wine from occupying multiple slots.
--          The app explicitly supports multi-bottle wines (layoutProposer.js),
--          so a per-wine unique constraint is incompatible with the data model.
-- Created: 2026-02-25

-- ============================================================
-- UP MIGRATION
-- ============================================================

-- Drop the broken global unique index (from 025_slot_uniqueness.sql)
DROP INDEX IF EXISTS idx_slots_wine_unique;

-- Replace with a non-unique index for query performance
-- (e.g. looking up which slots hold a given wine)
CREATE INDEX IF NOT EXISTS idx_slots_wine ON slots(wine_id) WHERE wine_id IS NOT NULL;

-- ============================================================
-- ROLLBACK (for reference - not auto-executed)
-- ============================================================
-- DROP INDEX IF EXISTS idx_slots_wine;
-- CREATE UNIQUE INDEX idx_slots_wine_unique ON slots(wine_id) WHERE wine_id IS NOT NULL;
