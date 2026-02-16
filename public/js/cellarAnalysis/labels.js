/**
 * @fileoverview Shared constants for cellar analysis UI.
 * Single source of truth — change here to update everywhere.
 * @module cellarAnalysis/labels
 */

// ─── CTA labels ──────────────────────────────────────────
export const CTA_RECONFIGURE_ZONES = 'Adjust Zone Layout';
export const CTA_AI_RECOMMENDATIONS = 'AI Cellar Review';
export const CTA_SETUP_ZONES = 'Setup Zones';
export const CTA_GUIDE_MOVES = 'Guide Me Through Moves';
export const TAB_CELLAR_REVIEW = 'Cellar Review';
export const TAB_CELLAR_PLACEMENT = 'Cellar Placement';
export const TAB_FRIDGE = 'Fridge';

// ─── Zone health thresholds ──────────────────────────────
/** Number of capacity alerts that triggers holistic zone treatment */
export const CAPACITY_ALERT_HOLISTIC_THRESHOLD = 3;
/** Misplacement rate (0–1) above which zones are considered degraded */
export const MISPLACEMENT_RATE_THRESHOLD = 0.10;
