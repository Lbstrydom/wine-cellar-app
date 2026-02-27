-- Migration 058: Enable RLS on buying guide tables
--
-- Root cause: Migration 056 used CREATE TABLE IF NOT EXISTS buying_guide_items
-- which was a no-op because the table already existed (created from
-- src/db/migrations/025). The ALTER TABLE ... ENABLE ROW LEVEL SECURITY at
-- the bottom of 056 was therefore never applied to the live Supabase instance.
--
-- Impact: LOW — the Express backend uses the postgres superuser connection
-- which bypasses RLS entirely, so access control is enforced via server-side
-- cellar_id WHERE clauses. However, RLS should be enabled as security hygiene
-- to match all other user-data tables and silence Supabase linter ERRORs.
--
-- No policies are added here — backend access goes through the service role
-- which bypasses RLS. Same pattern as slots, wines, etc.

ALTER TABLE IF EXISTS buying_guide_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS buying_guide_cache ENABLE ROW LEVEL SECURITY;

-- ROLLBACK:
-- ALTER TABLE buying_guide_items DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE buying_guide_cache DISABLE ROW LEVEL SECURITY;
