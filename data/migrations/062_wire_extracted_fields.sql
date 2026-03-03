-- Migration 062: Add extracted search fields to wines table
-- These columns store data from the two-phase search pipeline that was
-- previously discarded at the persistence layer.
--
-- - style_summary: Concise style descriptor from web search extraction
--   (e.g. "Bold, fruit-forward Stellenbosch Cabernet blend aged in French oak")
-- - producer_description: Producer background from producer_info.description
-- - extracted_awards: JSONB array of {competition, year, award, wine_name}
--   stored on wines (inherently cellar-scoped via wines.cellar_id) rather
--   than competition_awards which is a global table with cross-tenant constraints.

ALTER TABLE wines ADD COLUMN IF NOT EXISTS style_summary TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS producer_description TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS extracted_awards JSONB;
