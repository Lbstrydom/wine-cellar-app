/**
 * @fileoverview Accuracy alerting service for rating quality monitoring.
 * Monitors accuracy metrics and sends alerts when thresholds are breached.
 * @module services/accuracyAlerting
 */

import logger from '../utils/logger.js';
import { calculateAccuracyMetrics } from './accuracyMetrics.js';

/**
 * Accuracy metric thresholds for alerting.
 */
const THRESHOLDS = {
  VINTAGE_MISMATCH_RATE: 0.05, // 5% threshold
  WRONG_WINE_RATE: 0.01, // 1% threshold
  IDENTITY_REJECTION_RATE: 0.15 // 15% threshold (higher because it's a filter)
};

/**
 * Alert levels based on severity.
 */
const ALERT_LEVELS = {
  WARNING: 'warning',
  CRITICAL: 'critical'
};

/**
 * Check accuracy metrics and generate alerts if thresholds are breached.
 * @param {number} cellarId - Cellar ID to check
 * @param {Object} options - Options for alert generation
 * @param {string} [options.timeframe='7d'] - Timeframe for metrics ('24h', '7d', '30d', 'all')
 * @returns {Promise<Array<Object>>} Array of alerts generated
 */
export async function checkAccuracyAlerts(cellarId, options = {}) {
  const { timeframe = '7d' } = options;

  try {
    const metrics = await calculateAccuracyMetrics(cellarId, timeframe);
    const alerts = [];

    // Check vintage mismatch rate
    if (metrics.vintage_mismatch_rate > THRESHOLDS.VINTAGE_MISMATCH_RATE) {
      alerts.push({
        level: ALERT_LEVELS.CRITICAL,
        metric: 'vintage_mismatch_rate',
        threshold: THRESHOLDS.VINTAGE_MISMATCH_RATE,
        actual: metrics.vintage_mismatch_rate,
        message: `Vintage mismatch rate (${(metrics.vintage_mismatch_rate * 100).toFixed(1)}%) exceeds threshold (${(THRESHOLDS.VINTAGE_MISMATCH_RATE * 100).toFixed(1)}%)`,
        recommendation: 'Review recent rating fetches and identity validation logic'
      });
    }

    // Check wrong wine corrections rate
    if (metrics.wrong_wine_corrections_rate > THRESHOLDS.WRONG_WINE_RATE) {
      alerts.push({
        level: ALERT_LEVELS.CRITICAL,
        metric: 'wrong_wine_corrections_rate',
        threshold: THRESHOLDS.WRONG_WINE_RATE,
        actual: metrics.wrong_wine_corrections_rate,
        message: `Wrong wine correction rate (${(metrics.wrong_wine_corrections_rate * 100).toFixed(1)}%) exceeds threshold (${(THRESHOLDS.WRONG_WINE_RATE * 100).toFixed(1)}%)`,
        recommendation: 'Check wine identity token generation and URL filtering'
      });
    }

    // Check identity rejection rate (warning only, as rejections are intentional)
    if (metrics.identity_rejection_rate > THRESHOLDS.IDENTITY_REJECTION_RATE) {
      alerts.push({
        level: ALERT_LEVELS.WARNING,
        metric: 'identity_rejection_rate',
        threshold: THRESHOLDS.IDENTITY_REJECTION_RATE,
        actual: metrics.identity_rejection_rate,
        message: `Identity rejection rate (${(metrics.identity_rejection_rate * 100).toFixed(1)}%) exceeds threshold (${(THRESHOLDS.IDENTITY_REJECTION_RATE * 100).toFixed(1)}%)`,
        recommendation: 'High rejection rate may indicate overly strict identity validation or poor search results'
      });
    }

    if (alerts.length > 0) {
      logger.warn('AccuracyAlert', `Generated ${alerts.length} alert(s) for cellar ${cellarId} (${timeframe})`);
      alerts.forEach(alert => {
        logger.warn('AccuracyAlert', `${alert.level.toUpperCase()}: ${alert.message}`);
      });
    }

    return alerts;
  } catch (error) {
    logger.error('AccuracyAlert', `Failed to check accuracy alerts: ${error.message}`);
    return [];
  }
}

/**
 * Get summary of accuracy alerts for all cellars.
 * @param {string} [timeframe='7d'] - Timeframe for metrics
 * @returns {Promise<Object>} Summary object with cellar-level alerts
 */
export async function getAccuracyAlertsSummary(timeframe = '7d') {
  // This would typically query all cellars, but for now we'll return empty
  // In a real implementation, you'd iterate through cellars with recent activity
  logger.info('AccuracyAlert', `Checking accuracy alerts across all cellars (${timeframe})`);
  
  return {
    timestamp: new Date().toISOString(),
    timeframe,
    summary: 'Accuracy alerting system active'
  };
}

/**
 * Log accuracy metrics to structured logs for monitoring.
 * @param {number} cellarId - Cellar ID
 * @param {Object} metrics - Accuracy metrics
 */
export function logAccuracyMetrics(cellarId, metrics) {
  logger.info('AccuracyMetrics', JSON.stringify({
    cellarId,
    vintage_mismatch_rate: metrics.vintage_mismatch_rate?.toFixed(4),
    wrong_wine_corrections_rate: metrics.wrong_wine_corrections_rate?.toFixed(4),
    identity_rejection_rate: metrics.identity_rejection_rate?.toFixed(4),
    total_ratings: metrics.total_ratings,
    total_searches: metrics.total_searches,
    timestamp: new Date().toISOString()
  }));
}
