-- Shopping cart / buying guide items table
-- Tracks planned, ordered, and arrived wine purchases
-- linked to buying guide gap analysis

CREATE TABLE IF NOT EXISTS buying_guide_items (
  id SERIAL PRIMARY KEY,
  cellar_id UUID NOT NULL,
  wine_name TEXT NOT NULL,
  producer TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  style_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'ordered', 'arrived', 'cancelled')),
  inferred_style_confidence TEXT
    CHECK (inferred_style_confidence IN ('high', 'medium', 'low')),
  price NUMERIC(10,2),
  currency TEXT DEFAULT 'ZAR',
  vendor_url TEXT,
  vintage INTEGER,
  colour TEXT,
  grapes TEXT,
  region TEXT,
  country TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual',
  source_gap_style TEXT,
  converted_wine_id INTEGER REFERENCES wines(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgi_cellar ON buying_guide_items(cellar_id);
CREATE INDEX IF NOT EXISTS idx_bgi_cellar_status ON buying_guide_items(cellar_id, status);
CREATE INDEX IF NOT EXISTS idx_bgi_converted ON buying_guide_items(converted_wine_id)
  WHERE converted_wine_id IS NOT NULL;

ALTER TABLE buying_guide_items ENABLE ROW LEVEL SECURITY;

-- Buying guide cache for server-side caching (1-hour TTL)
CREATE TABLE IF NOT EXISTS buying_guide_cache (
  cellar_id UUID PRIMARY KEY,
  cache_data JSONB,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ROLLBACK: DROP TABLE IF EXISTS buying_guide_cache; DROP TABLE IF EXISTS buying_guide_items;
