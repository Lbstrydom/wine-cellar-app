-- Migration: 053_zone_reconfig_change_counter.sql
-- Purpose: Track bottle changes since last zone reconfiguration to prevent
--          unnecessary reconfigurations when the cellar hasn't changed enough.
-- Created: 2026-02-24

-- ============================================================
-- UP MIGRATION
-- ============================================================

CREATE TABLE IF NOT EXISTS zone_reconfig_counters (
    cellar_id UUID NOT NULL REFERENCES cellars(id) ON DELETE CASCADE,
    bottle_change_count INTEGER NOT NULL DEFAULT 0,
    last_reconfig_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT zone_reconfig_counters_pk PRIMARY KEY (cellar_id)
);

-- ============================================================
-- ROLLBACK (for reference - not auto-executed)
-- ============================================================
-- DROP TABLE IF EXISTS zone_reconfig_counters;
