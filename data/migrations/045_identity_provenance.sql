-- Migration 045: Add identity provenance columns to wine_ratings
-- Adds nullable columns to store identity diagnostics for ratings

-- SQLite and Postgres compatible statements
ALTER TABLE wine_ratings ADD COLUMN identity_score INTEGER;
ALTER TABLE wine_ratings ADD COLUMN identity_reason TEXT;
