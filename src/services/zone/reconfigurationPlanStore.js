/**
 * @fileoverview PostgreSQL-backed store for reconfiguration plans.
 * Plans survive server restarts and Railway deploys.
 * @module services/zone/reconfigurationPlanStore
 */

import crypto from 'node:crypto';
import db from '../../db/index.js';
import logger from '../../utils/logger.js';

/** Plans expire after 15 minutes (hardcoded in SQL interval). */
let tableEnsured = false;

/**
 * Ensure the reconfiguration_plans table exists (idempotent).
 * @returns {Promise<void>}
 */
async function ensurePlanTable() {
  if (tableEnsured) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reconfiguration_plans (
      id UUID PRIMARY KEY,
      cellar_id UUID NOT NULL,
      plan_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reconfig_plans_cellar
    ON reconfiguration_plans (cellar_id)
  `);
  tableEnsured = true;
}

/**
 * Delete plans older than TTL.
 * @returns {Promise<void>}
 */
async function gc() {
  try {
    await db.prepare(
      'DELETE FROM reconfiguration_plans WHERE created_at < NOW() - INTERVAL \'15 minutes\''
    ).run();
  } catch (err) {
    logger.warn('PlanStore', `GC failed: ${err.message}`);
  }
}

/**
 * Store a plan and return an opaque planId.
 * @param {string} cellarId - Cellar ID for scoping
 * @param {any} plan - Plan data to store
 * @returns {Promise<string>} Generated plan ID (UUID)
 */
export async function putPlan(cellarId, plan) {
  await ensurePlanTable();
  gc().catch(() => {}); // fire-and-forget GC
  const planId = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO reconfiguration_plans (id, cellar_id, plan_json) VALUES (?, ?, ?)'
  ).run(planId, cellarId, JSON.stringify(plan));
  return planId;
}

/**
 * Retrieve a plan by id, scoped to cellar.
 * @param {string} planId
 * @param {string} cellarId - Cellar ID for tenant isolation
 * @returns {Promise<any|null>}
 */
export async function getPlan(planId, cellarId) {
  await ensurePlanTable();
  const row = await db.prepare(
    'SELECT plan_json FROM reconfiguration_plans WHERE id = ? AND cellar_id = ? AND created_at > NOW() - INTERVAL \'15 minutes\''
  ).get(planId, cellarId);
  if (!row) return null;
  // plan_json is auto-parsed by PostgreSQL JSONB driver
  return typeof row.plan_json === 'string' ? JSON.parse(row.plan_json) : row.plan_json;
}

/**
 * Remove a plan once applied (optional hygiene).
 * @param {string} planId
 * @returns {Promise<void>}
 */
export async function deletePlan(planId) {
  try {
    await ensurePlanTable();
    await db.prepare('DELETE FROM reconfiguration_plans WHERE id = ?').run(planId);
  } catch (err) {
    logger.warn('PlanStore', `Delete failed: ${err.message}`);
  }
}
