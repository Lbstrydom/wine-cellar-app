/**
 * @fileoverview Generates holistic zone reconfiguration plans.
 * @module services/zoneReconfigurationPlanner
 */

import Anthropic from '@anthropic-ai/sdk';
import { getZoneById } from '../config/cellarZones.js';
import { getNeverMergeZones } from './zonePins.js';
import { getModelForTask, getMaxTokens } from '../config/aiModels.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000
});

function clampStabilityBias(value) {
  if (value === 'low' || value === 'moderate' || value === 'high') return value;
  return 'moderate';
}

function summarizeCapacityIssues(report) {
  const alerts = Array.isArray(report?.alerts) ? report.alerts : [];
  const issues = alerts.filter(a => a.type === 'zone_capacity_issue');

  const byZone = new Map();
  for (const issue of issues) {
    const data = issue.data || {};
    const zoneId = data.overflowingZoneId;
    if (!zoneId) continue;
    const wines = Array.isArray(data.winesNeedingPlacement) ? data.winesNeedingPlacement : [];
    const currentZoneAllocation = data.currentZoneAllocation || {};
    const availableRows = Array.isArray(data.availableRows) ? data.availableRows : [];

    if (!byZone.has(zoneId)) {
      byZone.set(zoneId, {
        overflowingZoneId: zoneId,
        overflowingZoneName: data.overflowingZoneName || zoneId,
        affectedCount: 0,
        winesNeedingPlacement: [],
        currentZoneAllocation,
        availableRows
      });
    }

    const entry = byZone.get(zoneId);
    entry.affectedCount += wines.length;
    entry.winesNeedingPlacement.push(...wines);
  }

  return Array.from(byZone.values());
}

function validatePlanShape(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Invalid plan');
  if (!Array.isArray(plan.actions)) throw new Error('Plan.actions must be an array');
  if (typeof plan.reasoning !== 'string') plan.reasoning = '';
  return plan;
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function computeSummary(report, actions) {
  const misplacedBefore = report?.summary?.misplacedBottles ?? 0;
  const bottlesAffected = actions.reduce((sum, a) => sum + (a.bottlesAffected || 0), 0);

  // Conservative estimate: we don't claim a dramatic improvement without simulating.
  const misplacedAfter = Math.max(0, misplacedBefore - Math.min(misplacedBefore, Math.round(bottlesAffected / 2)));

  return {
    zonesChanged: actions.length,
    bottlesAffected,
    misplacedBefore,
    misplacedAfter
  };
}

/**
 * Generate a holistic reconfiguration plan.
 * If Claude is not configured, returns a deterministic heuristic plan.
 */
export async function generateReconfigurationPlan(report, options = {}) {
  const {
    includeRetirements = true,
    includeNewZones = true,
    stabilityBias = 'moderate'
  } = options;

  const stability = clampStabilityBias(stabilityBias);
  const neverMerge = await getNeverMergeZones();

  const capacityIssues = summarizeCapacityIssues(report);
  const totalBottles = report?.summary?.totalBottles ?? 0;
  const misplacedBottles = report?.summary?.misplacedBottles ?? 0;
  const misplacementPct = totalBottles > 0 ? Math.round((misplacedBottles / totalBottles) * 100) : 0;

  // Attempt Claude first if configured.
  if (process.env.ANTHROPIC_API_KEY) {
    const prompt = {
      totalBottles,
      misplaced: misplacedBottles,
      misplacementPct,
      issues: capacityIssues.map(i => ({
        zoneId: i.overflowingZoneId,
        zoneName: i.overflowingZoneName,
        affectedCount: i.affectedCount
      })),
      constraints: {
        neverMergeZones: Array.from(neverMerge),
        includeRetirements,
        includeNewZones,
        stabilityBias: stability
      }
    };

    const system = 'You are a sommelier reorganizing a wine cellar. You must respond with valid JSON only.';

    const user = `Generate a holistic zone reconfiguration plan based on this state.\n\nSTATE JSON:\n${JSON.stringify(prompt, null, 2)}\n\nReturn JSON with schema:\n{\n  "reasoning": string,\n  "actions": [\n    {\n      "type": "expand_zone"|"merge_zones"|"retire_zone",\n      "priority": 1|2|3|4|5,\n      "reason": string,\n      ...fields\n    }\n  ]\n}\n\nConstraints:\n- Only propose zone IDs that already exist in the application's zone registry.\n- Do not propose create_zone/shrink_zone yet.\n- Never merge zones in neverMergeZones.\n- Prefer fewer changes when stabilityBias is high.\n`;

    const modelId = getModelForTask('zoneReconfigurationPlan');
    const maxTokens = Math.min(getMaxTokens(modelId), 1500);

    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }]
    });

    const text = response?.content?.[0]?.text || '';
    const json = parseJsonObject(text);
    if (!json) throw new Error('Invalid AI response (not JSON)');
    const plan = validatePlanShape(json);

    // Filter out any unknown zones defensively.
    plan.actions = plan.actions.filter(a => {
      if (a.type === 'expand_zone') return !!getZoneById(a.zoneId);
      if (a.type === 'merge_zones') {
        if (!Array.isArray(a.sourceZones)) return false;
        if (!getZoneById(a.targetZoneId)) return false;
        return a.sourceZones.every(z => getZoneById(z)) && a.sourceZones.every(z => !neverMerge.has(z));
      }
      if (a.type === 'retire_zone') {
        if (!getZoneById(a.zoneId)) return false;
        if (!getZoneById(a.mergeIntoZoneId)) return false;
        return !neverMerge.has(a.zoneId);
      }
      return false;
    });

    const summary = computeSummary(report, plan.actions);
    return {
      summary,
      reasoning: plan.reasoning,
      actions: plan.actions
    };
  }

  // Heuristic fallback.
  const allocated = new Set();
  const actions = [];

  // Expand each overflowing zone by 1 row when possible.
  for (const issue of capacityIssues) {
    if (issue.availableRows.length === 0) continue;
    const zoneId = issue.overflowingZoneId;
    if (!getZoneById(zoneId)) continue;

    const candidateRows = issue.availableRows.filter(r => !allocated.has(r));
    if (candidateRows.length === 0) continue;

    const row = candidateRows[0];
    allocated.add(row);

    actions.push({
      type: 'expand_zone',
      priority: 2,
      zoneId,
      currentRows: Array.isArray(issue.currentZoneAllocation?.[zoneId]) ? issue.currentZoneAllocation[zoneId] : [],
      proposedRows: [...(Array.isArray(issue.currentZoneAllocation?.[zoneId]) ? issue.currentZoneAllocation[zoneId] : []), row],
      reason: `${issue.affectedCount} bottle(s) need placement; allocate an extra row`,
      bottlesAffected: issue.affectedCount
    });
  }

  // Keep it stable: if high stability bias, don't propose more than 2 actions.
  const maxActions = stability === 'high' ? 2 : stability === 'moderate' ? 4 : 6;
  const trimmedActions = actions.slice(0, maxActions);

  const summary = computeSummary(report, trimmedActions);

  return {
    summary,
    reasoning: 'Generated using conservative heuristic plan (AI not configured).',
    actions: trimmedActions
  };
}
