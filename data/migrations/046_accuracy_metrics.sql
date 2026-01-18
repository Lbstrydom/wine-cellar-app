-- Migration 046: Add accuracy metrics fields to search_metrics table
-- Adds vintage_mismatch_count and wrong_wine_corrections for tracking data quality

-- Add accuracy metric columns to search_metrics
ALTER TABLE search_metrics ADD COLUMN IF NOT EXISTS vintage_mismatch_count INTEGER DEFAULT 0;
ALTER TABLE search_metrics ADD COLUMN IF NOT EXISTS wrong_wine_count INTEGER DEFAULT 0;
ALTER TABLE search_metrics ADD COLUMN IF NOT EXISTS identity_rejection_count INTEGER DEFAULT 0;

-- Add index for accuracy analysis queries
CREATE INDEX IF NOT EXISTS idx_search_metrics_accuracy 
  ON search_metrics(vintage_mismatch_count, wrong_wine_count) 
  WHERE vintage_mismatch_count > 0 OR wrong_wine_count > 0;
