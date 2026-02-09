/**
 * @fileoverview Ensures the holistic reconfiguration tables exist.
 * @module services/zone/reconfigurationTables
 */

import db from '../../db/index.js';

/**
 * Idempotently creates the tables used for holistic zone reconfiguration.
 * Safe to call on every server start or endpoint invocation.
 * @returns {Promise<void>}
 */
export async function ensureReconfigurationTables() {
	await db.exec(`
		CREATE TABLE IF NOT EXISTS zone_pins (
			zone_id TEXT NOT NULL,
			pin_type TEXT NOT NULL,
			minimum_rows INTEGER,
			notes TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (zone_id, pin_type)
		);
	`);

	await db.exec(`
		CREATE INDEX IF NOT EXISTS idx_zone_pins_zone_id
		ON zone_pins (zone_id);
	`);

	await db.exec(`
		CREATE TABLE IF NOT EXISTS zone_reconfigurations (
			id BIGSERIAL PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			plan_json JSONB NOT NULL,
			changes_summary TEXT,
			bottles_affected INTEGER,
			misplaced_before INTEGER,
			misplaced_after INTEGER,
			actions_count INTEGER,
			zones_affected INTEGER,
			undone_at TIMESTAMPTZ
		);
	`);

	await db.exec(`
		CREATE INDEX IF NOT EXISTS idx_zone_reconfigurations_applied_at
		ON zone_reconfigurations (applied_at DESC);
	`);
}

