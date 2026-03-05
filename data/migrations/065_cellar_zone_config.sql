-- Migration 065: Per-cellar zone configuration
-- Allows each cellar to maintain a customised subset of the global 31-zone set.
-- When rows exist for a cellar → use them; otherwise fall back to all global zones.

CREATE TABLE IF NOT EXISTS cellar_zone_config (
  cellar_id    UUID        NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
  zone_id      TEXT        NOT NULL,
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  display_name TEXT,          -- user display-name override (null = use global default)
  custom_rules JSONB,         -- optional rule overrides (null = use global rules)
  sort_order   INTEGER,       -- custom ordering within the cellar (null = use global priority order)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cellar_id, zone_id)
);

-- Index for fast per-cellar lookups
CREATE INDEX IF NOT EXISTS idx_cellar_zone_config_cellar
  ON cellar_zone_config (cellar_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_cellar_zone_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cellar_zone_config_updated_at ON cellar_zone_config;
CREATE TRIGGER trg_cellar_zone_config_updated_at
  BEFORE UPDATE ON cellar_zone_config
  FOR EACH ROW EXECUTE FUNCTION update_cellar_zone_config_updated_at();
