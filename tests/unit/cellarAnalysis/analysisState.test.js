import { deriveState, AnalysisState } from '../../../public/js/cellarAnalysis/analysisState.js';

describe('deriveState', () => {
  it('returns NO_ZONES when needsZoneSetup is true', () => {
    expect(deriveState({ needsZoneSetup: true })).toBe(AnalysisState.NO_ZONES);
  });

  it('returns ZONES_DEGRADED when >= 3 capacity alerts', () => {
    const cap = { type: 'zone_capacity_issue' };
    expect(deriveState({
      needsZoneSetup: false,
      alerts: [cap, cap, cap],
      summary: { totalBottles: 100, misplacedBottles: 5 }
    })).toBe(AnalysisState.ZONES_DEGRADED);
  });

  it('returns ZONES_DEGRADED when misplacement rate >= 10%', () => {
    expect(deriveState({
      needsZoneSetup: false,
      alerts: [],
      summary: { totalBottles: 100, misplacedBottles: 15 }
    })).toBe(AnalysisState.ZONES_DEGRADED);
  });

  it('returns ZONES_HEALTHY when under thresholds', () => {
    expect(deriveState({
      needsZoneSetup: false,
      alerts: [],
      summary: { totalBottles: 100, misplacedBottles: 2 }
    })).toBe(AnalysisState.ZONES_HEALTHY);
  });

  it('returns JUST_RECONFIGURED when __justReconfigured is set', () => {
    expect(deriveState({ __justReconfigured: true })).toBe(AnalysisState.JUST_RECONFIGURED);
  });

  it('JUST_RECONFIGURED takes precedence over NO_ZONES', () => {
    expect(deriveState({
      __justReconfigured: true,
      needsZoneSetup: true
    })).toBe(AnalysisState.JUST_RECONFIGURED);
  });

  it('returns ZONES_HEALTHY for null/undefined input', () => {
    expect(deriveState(null)).toBe(AnalysisState.ZONES_HEALTHY);
    expect(deriveState(undefined)).toBe(AnalysisState.ZONES_HEALTHY);
  });

  it('returns ZONES_DEGRADED at exactly 10% misplacement', () => {
    expect(deriveState({
      needsZoneSetup: false,
      alerts: [],
      summary: { totalBottles: 100, misplacedBottles: 10 }
    })).toBe(AnalysisState.ZONES_DEGRADED);
  });

  it('returns ZONES_HEALTHY at 9% misplacement', () => {
    expect(deriveState({
      needsZoneSetup: false,
      alerts: [],
      summary: { totalBottles: 100, misplacedBottles: 9 }
    })).toBe(AnalysisState.ZONES_HEALTHY);
  });
});
