-- Migration 022: Open Bottle Tracking
-- Tracks bottles that have been opened but not yet finished

ALTER TABLE slots ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT FALSE;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP;

-- Index for quickly finding open bottles
CREATE INDEX IF NOT EXISTS idx_slots_open ON slots(is_open) WHERE is_open = TRUE;
