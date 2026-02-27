-- Migration 025: Buying Guide Items (shopping cart) + Guide Cache
-- Run this in the Supabase SQL Editor to unblock the buying guide feature.

-- ── Buying guide cart items ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buying_guide_items (
  id                        SERIAL PRIMARY KEY,
  cellar_id                 UUID NOT NULL,

  -- Wine identity
  wine_name                 TEXT NOT NULL,
  producer                  TEXT,
  vintage                   INTEGER,
  colour                    TEXT,
  grapes                    TEXT,
  region                    TEXT,
  country                   TEXT,

  -- Style classification
  style_id                  TEXT,
  inferred_style_confidence TEXT,           -- 'high' | 'medium' | 'low'
  source_gap_style          TEXT,           -- style that triggered the suggestion

  -- Cart metadata
  quantity                  INTEGER NOT NULL DEFAULT 1,
  status                    TEXT NOT NULL DEFAULT 'planned',  -- planned | ordered | arrived | cancelled
  price                     NUMERIC(10, 2),
  currency                  TEXT NOT NULL DEFAULT 'ZAR',
  vendor_url                TEXT,
  notes                     TEXT,
  source                    TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'extension' | 'suggestion'

  -- Conversion tracking (set when item is moved to physical cellar)
  converted_wine_id         INTEGER REFERENCES wines(id) ON DELETE SET NULL,

  -- Timestamps
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_bgi_cellar          ON buying_guide_items (cellar_id);
CREATE INDEX IF NOT EXISTS idx_bgi_cellar_status   ON buying_guide_items (cellar_id, status);
CREATE INDEX IF NOT EXISTS idx_bgi_cellar_style    ON buying_guide_items (cellar_id, style_id);
CREATE INDEX IF NOT EXISTS idx_bgi_converted       ON buying_guide_items (converted_wine_id) WHERE converted_wine_id IS NOT NULL;

-- ── Buying guide server-side cache ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buying_guide_cache (
  cellar_id    UUID PRIMARY KEY,
  cache_data   JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
