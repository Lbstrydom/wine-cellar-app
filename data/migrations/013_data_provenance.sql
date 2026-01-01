-- Data Provenance Ledger
-- Tracks the origin of all externally-derived data for partnership readiness and data governance

CREATE TABLE IF NOT EXISTS data_provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- What was retrieved
  wine_id INTEGER,
  field_name TEXT NOT NULL,           -- 'rating_score', 'tasting_notes', 'drink_window', 'award', etc.

  -- Where it came from
  source_id TEXT NOT NULL,            -- 'decanter', 'vivino', etc. (from SOURCES)
  source_url TEXT,                    -- Exact URL scraped
  retrieval_method TEXT NOT NULL,     -- 'scrape', 'api', 'user_input', 'ocr', 'manual'

  -- Confidence and freshness
  confidence REAL DEFAULT 1.0,        -- 0.0-1.0 based on match quality
  retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  raw_hash TEXT,                      -- Hash of raw content for change detection
  expires_at DATETIME,                -- When to refresh/purge

  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provenance_wine ON data_provenance(wine_id);
CREATE INDEX IF NOT EXISTS idx_provenance_source ON data_provenance(source_id);
CREATE INDEX IF NOT EXISTS idx_provenance_expires ON data_provenance(expires_at);
CREATE INDEX IF NOT EXISTS idx_provenance_field ON data_provenance(field_name);
CREATE INDEX IF NOT EXISTS idx_provenance_wine_source_field ON data_provenance(wine_id, source_id, field_name);
