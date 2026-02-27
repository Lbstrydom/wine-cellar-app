-- Migration 057: Add missing status_changed_at column to buying_guide_items
--
-- Root cause: buying_guide_items was initially created from an earlier version
-- of migration 056 that lacked this column. CREATE TABLE IF NOT EXISTS is a
-- no-op once the table exists, so the column was never added to production.
-- Without it, PATCH /api/buying-guide-items/:id/status throws a PostgreSQL
-- column-not-found error (code 42703), surfacing as HTTP 500.

ALTER TABLE buying_guide_items
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ DEFAULT NOW();

-- Back-fill existing rows with created_at so the column has meaningful data
-- (status was last changed at row creation time at a minimum).
UPDATE buying_guide_items
  SET status_changed_at = created_at
  WHERE status_changed_at IS NULL;

-- ROLLBACK: ALTER TABLE buying_guide_items DROP COLUMN IF EXISTS status_changed_at;
