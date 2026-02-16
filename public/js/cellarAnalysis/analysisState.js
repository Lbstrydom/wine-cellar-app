/**
 * @fileoverview Formal state machine for cellar analysis CTA.
 * Derives the current analysis state to drive a single primary action button.
 * @module cellarAnalysis/analysisState
 */

import {
  CAPACITY_ALERT_HOLISTIC_THRESHOLD,
  MISPLACEMENT_RATE_THRESHOLD
} from './labels.js';

export const AnalysisState = {
  NO_ZONES: 'NO_ZONES',
  ZONES_DEGRADED: 'ZONES_DEGRADED',
  ZONES_HEALTHY: 'ZONES_HEALTHY',
  JUST_RECONFIGURED: 'JUST_RECONFIGURED'
};

/**
 * Derive the current analysis state from a report object.
 * @param {Object} analysis - Analysis report from API
 * @returns {string} One of AnalysisState values
 */
export function deriveState(analysis) {
  if (analysis?.__justReconfigured) return AnalysisState.JUST_RECONFIGURED;
  if (analysis?.needsZoneSetup) return AnalysisState.NO_ZONES;

  const alerts = Array.isArray(analysis?.alerts) ? analysis.alerts : [];
  const capacityAlerts = alerts.filter(a => a.type === 'zone_capacity_issue').length;
  const total = analysis?.summary?.totalBottles ?? 0;
  const misplaced = analysis?.summary?.misplacedBottles ?? 0;
  const misplacementRate = total > 0 ? misplaced / total : 0;

  if (capacityAlerts >= CAPACITY_ALERT_HOLISTIC_THRESHOLD || misplacementRate >= MISPLACEMENT_RATE_THRESHOLD) return AnalysisState.ZONES_DEGRADED;
  return AnalysisState.ZONES_HEALTHY;
}
