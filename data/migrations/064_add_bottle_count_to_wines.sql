-- Migration 064: Add bottle_count to wines table
-- bottle_count is a user-managed field recording how many physical bottles
-- the user owns of a wine. NULL = unknown (no duplicate detection performed).
-- This enables detectDuplicatePlacements() to identify wines assigned to more
-- cellar slots than the user actually owns.

ALTER TABLE wines
  ADD COLUMN IF NOT EXISTS bottle_count INTEGER DEFAULT NULL;

COMMENT ON COLUMN wines.bottle_count IS
  'User-recorded physical bottle count. NULL means unknown — duplicate slot detection is skipped for that wine.';
