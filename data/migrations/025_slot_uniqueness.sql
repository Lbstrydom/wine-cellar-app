-- Migration 025: Add slot uniqueness constraint
-- Prevents multiple bottles from occupying the same slot

-- Drop existing index if it exists (for idempotency)
DROP INDEX IF EXISTS idx_slots_wine_unique;

-- Create unique index on wine_id where wine_id IS NOT NULL
-- This prevents two slots from having the same wine_id
-- NULL values are allowed (multiple empty slots)
CREATE UNIQUE INDEX idx_slots_wine_unique ON slots(wine_id) WHERE wine_id IS NOT NULL;

-- Note: This constraint ensures that each wine can only be in one slot at a time
-- It complements the application-level validation in validateMovePlan()
