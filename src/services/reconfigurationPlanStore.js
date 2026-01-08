/**
 * @fileoverview In-memory store for reconfiguration plans.
 * @module services/reconfigurationPlanStore
 */

import crypto from 'crypto';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/** @type {Map<string, {plan: any, createdAt: number}>} */
const plans = new Map();

function now() {
  return Date.now();
}

function gc() {
  const cutoff = now() - DEFAULT_TTL_MS;
  for (const [id, entry] of plans) {
    if (entry.createdAt < cutoff) plans.delete(id);
  }
}

/**
 * Store a plan and return an opaque planId.
 * @param {any} plan
 * @returns {string}
 */
export function putPlan(plan) {
  gc();
  const planId = crypto.randomUUID();
  plans.set(planId, { plan, createdAt: now() });
  return planId;
}

/**
 * Retrieve a plan by id.
 * @param {string} planId
 * @returns {any|null}
 */
export function getPlan(planId) {
  gc();
  const entry = plans.get(planId);
  if (!entry) return null;
  if (now() - entry.createdAt > DEFAULT_TTL_MS) {
    plans.delete(planId);
    return null;
  }
  return entry.plan;
}

/**
 * Remove a plan once applied (optional hygiene).
 * @param {string} planId
 */
export function deletePlan(planId) {
  plans.delete(planId);
}
