/**
 * @fileoverview Trigger thresholds for cellar reorganisation alerts.
 * @module config/cellarThresholds
 */

export const REORG_THRESHOLDS = {
  // Minimum misplaced bottles before suggesting reorganisation
  minMisplacedForReorg: 5,

  // Minimum percentage of bottles misplaced before suggesting reorganisation
  minMisplacedPercent: 10,

  // Fragmentation score (0-100) above which zone needs defragmentation
  minFragmentationScore: 40,

  // Minimum zone utilisation (%) before considering fragmentation
  minZoneUtilizationForFragCheck: 30,

  // Alert about overflow bottles after N days
  overflowAlertAfterDays: 3,

  // Alert about overflow when zone has N+ bottles in buffer
  overflowAlertAfterBottles: 5,

  // Trigger AI review when these thresholds are exceeded
  triggerAIReviewAfter: {
    misplacedCount: 8,
    overflowingZones: 2,
    unclassifiedCount: 3
  },

  // Limit reorganisation suggestion frequency
  maxReorgSuggestionsPerWeek: 2,

  // Minimum days between full cellar analyses
  minDaysBetweenFullAnalysis: 3
};

/**
 * Confidence score thresholds for zone matching
 */
export const CONFIDENCE_THRESHOLDS = {
  // Score >= this = high confidence
  high: 70,

  // Score >= this = medium confidence
  medium: 40,

  // Score difference from runner-up to consider "clear winner"
  clearWinnerMargin: 20
};

/**
 * Scoring weights for zone matching algorithm
 */
export const SCORING_WEIGHTS = {
  color: 15,
  grape: 35,
  keyword: 25,
  country: 15,
  region: 10,
  appellation: 15,
  winemaking: 30
};
