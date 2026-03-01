/**
 * @fileoverview Tracks bottle changes between zone reconfigurations.
 * Prevents unnecessary reconfigurations when the cellar hasn't changed
 * significantly since the last one (default threshold: 10% of total bottles).
 * @module services/zone/reconfigChangeTracker
 */

import db from '../../db/index.js';
import logger from '../../utils/logger.js';

/** Default percentage of total bottle count required before zone reconfiguration. */
const DEFAULT_THRESHOLD_PCT = 10;

/** Absolute minimum threshold so tiny cellars aren't constantly gated. */
const MIN_ABSOLUTE_THRESHOLD = 2;

/**
 * Read the user's configured change-threshold percentage from user_settings.
 * Falls back to env var RECONFIG_CHANGE_THRESHOLD_PCT, then DEFAULT_THRESHOLD_PCT.
 * @param {string} cellarId - UUID of the cellar
 * @returns {Promise<number>} Percentage (0-100)
 */
export async function getReconfigChangeThresholdPct(cellarId) {
  // 1. Per-cellar user setting
  try {
    const row = await db.prepare(
      `SELECT value FROM user_settings WHERE cellar_id = $1 AND key = 'reconfig_change_pct'`
    ).get(cellarId);
    if (row) {
      const parsed = parseFloat(row.value);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
    }
  } catch {
    // table may not exist yet — fall through
  }

  // 2. Env-var override
  const envVal = process.env.RECONFIG_CHANGE_THRESHOLD_PCT;
  if (envVal !== undefined) {
    const parsed = parseFloat(envVal);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  }

  return DEFAULT_THRESHOLD_PCT;
}

/**
 * Count total occupied bottle slots for a cellar.
 * @param {string} cellarId
 * @returns {Promise<number>}
 */
export async function getTotalBottleCount(cellarId) {
  try {
    const row = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM slots WHERE cellar_id = $1 AND wine_id IS NOT NULL`
    ).get(cellarId);
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Compute the absolute threshold from percentage and total bottle count.
 * @param {number} pct - Threshold percentage (0-100)
 * @param {number} totalBottles - Current bottle count
 * @returns {number} Minimum change count (at least MIN_ABSOLUTE_THRESHOLD)
 */
export function computeAbsoluteThreshold(pct, totalBottles) {
  if (pct === 0) return 0; // 0% = disabled
  return Math.max(MIN_ABSOLUTE_THRESHOLD, Math.ceil(totalBottles * pct / 100));
}

/**
 * Increment the bottle change counter for a cellar.
 * Uses UPSERT to create the row on first call.
 * @param {string} cellarId - UUID of the cellar
 * @param {number} [delta=1] - Number of bottle changes to add
 * @returns {Promise<void>}
 */
export async function incrementBottleChangeCount(cellarId, delta = 1) {
  if (!cellarId) return;
  try {
    await db.prepare(`
      INSERT INTO zone_reconfig_counters (cellar_id, bottle_change_count, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (cellar_id)
      DO UPDATE SET
        bottle_change_count = zone_reconfig_counters.bottle_change_count + $2,
        updated_at = NOW()
    `).run(cellarId, delta);
  } catch (err) {
    // Fail-open: don't break bottle operations if counter table doesn't exist yet
    logger.warn('ReconfigTracker', `Failed to increment change counter: ${err.message}`);
  }
}

/**
 * Get the current bottle change count and last reconfiguration timestamp.
 * @param {string} cellarId - UUID of the cellar
 * @returns {Promise<{changeCount: number, lastReconfigAt: string|null, exists: boolean}>}
 */
export async function getBottleChangeStatus(cellarId) {
  try {
    const row = await db.prepare(`
      SELECT bottle_change_count, last_reconfig_at
      FROM zone_reconfig_counters
      WHERE cellar_id = $1
    `).get(cellarId);

    if (!row) {
      return { changeCount: 0, lastReconfigAt: null, exists: false };
    }

    return {
      changeCount: row.bottle_change_count ?? 0,
      lastReconfigAt: row.last_reconfig_at || null,
      exists: true
    };
  } catch (err) {
    // Fail-open: if table doesn't exist, allow reconfig
    logger.warn('ReconfigTracker', `Failed to read change counter: ${err.message}`);
    return { changeCount: 0, lastReconfigAt: null, exists: false };
  }
}

/**
 * Reset the bottle change counter after a reconfiguration is applied.
 * @param {string} cellarId - UUID of the cellar
 * @returns {Promise<void>}
 */
export async function resetBottleChangeCount(cellarId) {
  if (!cellarId) return;
  try {
    await db.prepare(`
      INSERT INTO zone_reconfig_counters (cellar_id, bottle_change_count, last_reconfig_at, updated_at)
      VALUES ($1, 0, NOW(), NOW())
      ON CONFLICT (cellar_id)
      DO UPDATE SET
        bottle_change_count = 0,
        last_reconfig_at = NOW(),
        updated_at = NOW()
    `).run(cellarId);
  } catch (err) {
    logger.warn('ReconfigTracker', `Failed to reset change counter: ${err.message}`);
  }
}

/**
 * Check whether the cellar has enough changes to warrant a zone reconfiguration.
 * Computes threshold as a percentage of total bottles.
 * Returns { allowed: true } if threshold is met or no prior reconfig exists.
 * Returns { allowed: false, ... } with info if below threshold.
 * @param {string} cellarId - UUID of the cellar
 * @returns {Promise<{allowed: boolean, changeCount?: number, threshold?: number, thresholdPct?: number, totalBottles?: number, lastReconfigAt?: string|null}>}
 */
export async function checkReconfigThreshold(cellarId) {
  const pct = await getReconfigChangeThresholdPct(cellarId);
  const totalBottles = await getTotalBottleCount(cellarId);
  const threshold = computeAbsoluteThreshold(pct, totalBottles);
  const status = await getBottleChangeStatus(cellarId);

  // No prior reconfig → always allow (first time)
  // Check lastReconfigAt (not status.exists) because incrementBottleChangeCount
  // creates the counter row before any reconfiguration has ever been applied.
  if (!status.lastReconfigAt) {
    return { allowed: true };
  }

  // 0% threshold = disabled → always allow
  if (pct === 0) {
    return { allowed: true };
  }

  if (status.changeCount >= threshold) {
    return { allowed: true };
  }

  return {
    allowed: false,
    changeCount: status.changeCount,
    threshold,
    thresholdPct: pct,
    totalBottles,
    lastReconfigAt: status.lastReconfigAt
  };
}
