/**
 * @fileoverview Service availability checker for Phase 6 features.
 * Reports which external services are configured at startup.
 * @module config/serviceAvailability
 */

import logger from '../utils/logger.js';
import FEATURE_FLAGS from './featureFlags.js';

/**
 * Service definitions with required and fallback env vars.
 */
const SERVICES = {
  wineSearch: {
    name: 'Wine Search Integration',
    featureFlag: 'WINE_ADD_ORCHESTRATOR_ENABLED',
    primary: ['BRIGHTDATA_API_KEY'],
    optional: ['BRIGHTDATA_SERP_ZONE', 'BRIGHTDATA_WEB_ZONE']
  },
  sommelier: {
    name: 'AI Sommelier & Awards',
    primary: ['ANTHROPIC_API_KEY']
  },
  zoneAdvisor: {
    name: 'Zone Reconfiguration Advisor',
    primary: ['OPENAI_API_KEY'],
    featureFlag: 'OPENAI_REVIEW_ZONE_RECONFIG'
  },
  ratings: {
    name: 'External Ratings',
    primary: ['BRIGHTDATA_API_KEY']
  }
};

/**
 * Check availability of all services.
 * @returns {Array<{key: string, name: string, status: string, reason: string}>}
 */
export function checkServiceAvailability() {
  const results = [];

  for (const [key, service] of Object.entries(SERVICES)) {
    const hasPrimary = service.primary.every(v => !!process.env[v]);
    const hasFallback = service.fallback?.every(v => !!process.env[v]) || false;
    const flagEnabled = service.featureFlag ? FEATURE_FLAGS[service.featureFlag] !== false : true;

    let status, reason;

    if (!flagEnabled) {
      status = 'disabled';
      reason = `feature flag ${service.featureFlag}=false`;
    } else if (hasPrimary) {
      status = 'enabled';
      reason = null;
    } else if (hasFallback) {
      status = 'enabled';
      reason = `via fallback (${service.fallback.join(', ')})`;
    } else {
      status = 'disabled';
      reason = `missing: ${service.primary.filter(v => !process.env[v]).join(', ')}`;
    }

    results.push({ key, name: service.name, status, reason });
  }

  return results;
}

/**
 * Log service status at startup.
 * Only logs if any services are disabled (to avoid noise when all is well).
 */
export function logServiceStatus() {
  const services = checkServiceAvailability();
  const disabled = services.filter(s => s.status === 'disabled');
  const enabledViaFallback = services.filter(s => s.status === 'enabled' && s.reason);

  // Only show status block if there's something noteworthy
  if (disabled.length > 0 || enabledViaFallback.length > 0) {
    logger.info('Startup', '--- Phase 6 Feature Status ---');

    for (const service of services) {
      if (service.status === 'enabled' && !service.reason) {
        logger.info('Startup', `✓ ${service.name}: ENABLED`);
      } else if (service.status === 'enabled' && service.reason) {
        logger.info('Startup', `✓ ${service.name}: ENABLED (${service.reason})`);
      } else {
        logger.warn('Startup', `✗ ${service.name}: DISABLED (${service.reason})`);
      }
    }

    if (disabled.length > 0) {
      logger.info('Startup', 'Configure missing env vars to enable all features');
    }

    logger.info('Startup', '-------------------------------');
  }
}
