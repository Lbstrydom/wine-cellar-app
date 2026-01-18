/**
 * @fileoverview Blocked content detection for search results.
 * Identifies when pages are blocked, empty, or returning error pages.
 * Phase 1: Implement blocked detection heuristics
 * @module services/blockedDetection
 */

import logger from '../utils/logger.js';

/**
 * Detection patterns for blocked/error pages.
 */
const BLOCKED_PATTERNS = {
  // HTTP status indicators
  captcha: [
    /captcha/i,
    /recaptcha/i,
    /bot\s*check/i,
    /verify\s*you/i,
    /security\s*check/i,
    /unusual\s*activity/i
  ],

  // Rate limiting indicators
  rateLimited: [
    /too\s*many\s*requests/i,
    /throttl/i,
    /rate\s*limit/i,
    /try\s*again\s*later/i,
    /temporarily\s*unavailable/i
  ],

  // Access denied indicators
  forbidden: [
    /access\s*denied/i,
    /forbidden/i,
    /not\s*allowed/i,
    /unauthorized/i,
    /403/i,
    /permission\s*denied/i
  ],

  // Empty/error page indicators
  empty: [
    /no\s*results/i,
    /not\s*found/i,
    /404/i,
    /page\s*not\s*found/i,
    /content.*removed/i,
    /unavailable/i
  ],

  // Bot detection keywords
  botDetection: [
    /bot\s*detected/i,
    /automated\s*request/i,
    /automated\s*access/i,
    /scrapers?\s*(not\s*)?allowed/i,
    /robot/i
  ],

  // Cloudflare specific
  cloudflare: [
    /cloudflare/i,
    /challenge/i,
    /checking\s*browser/i,
    /just\s*a\s*moment/i
  ]
};

/**
 * Minimum content length thresholds.
 */
const CONTENT_THRESHOLDS = {
  minContentLength: 1024, // 1KB minimum
  maxErrorPageLength: 500, // Error pages are typically small
  minExpectedSelectors: 3 // At least 3 expected selectors should exist
};

/**
 * Detect if content is blocked.
 * Returns early with high confidence if matches known patterns.
 *
 * @param {Object} response - Fetch response object
 * @param {string} response.content - Page content
 * @param {number} response.statusCode - HTTP status code
 * @param {Object} options - Detection options
 * @param {string} [options.domain] - Domain being fetched
 * @param {string} [options.expectedSelectors] - CSS selectors expected to exist
 * @returns {Object} Detection result
 */
export function detectBlocked(response, options = {}) {
  const { content = '', statusCode = 200 } = response;
  const { domain = '', expectedSelectors = [] } = options;

  // Quick exit: successful status but tiny content
  if (statusCode === 200 && content.length < CONTENT_THRESHOLDS.minContentLength) {
    return {
      blocked: true,
      reason: 'empty_content',
      confidence: 0.8,
      suggestion: 'Try Web Unlocker for JS rendering'
    };
  }

  // Quick exit: HTTP error codes
  if (statusCode >= 400 && statusCode < 600) {
    const reason = getStatusCodeReason(statusCode);
    return {
      blocked: true,
      reason: `http_${statusCode}`,
      statusCode,
      confidence: 0.95,
      suggestion: 'Retry with Web Unlocker or fallback'
    };
  }

  // Check for blocked patterns in content
  const patternMatches = checkBlockedPatterns(content);

  if (patternMatches.length > 0) {
    return {
      blocked: true,
      reason: patternMatches[0],
      patterns: patternMatches,
      confidence: Math.min(0.99, 0.5 + patternMatches.length * 0.15),
      suggestion: getBlockedSuggestion(patternMatches[0])
    };
  }

  // Check for missing expected selectors (indicates JS not rendered)
  if (expectedSelectors && expectedSelectors.length > 0) {
    const missingCount = expectedSelectors.filter(sel => {
      return !content.includes(sel);
    }).length;

    if (missingCount >= expectedSelectors.length * 0.8) {
      return {
        blocked: true,
        reason: 'missing_selectors',
        confidence: 0.7,
        suggestion: 'Likely JS content not rendered. Try Web Unlocker with JS'
      };
    }
  }

  // No blocking detected
  return {
    blocked: false,
    reason: 'success',
    confidence: 1.0
  };
}

/**
 * Check content against blocked patterns.
 *
 * @param {string} content - Page content to check
 * @returns {string[]} List of matched pattern types
 */
function checkBlockedPatterns(content) {
  const matches = [];

  for (const [patternType, patterns] of Object.entries(BLOCKED_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        matches.push(patternType);
        break; // Only add once per pattern type
      }
    }
  }

  return matches;
}

/**
 * Get human-readable reason for HTTP status code.
 *
 * @param {number} statusCode - HTTP status code
 * @returns {string} Reason
 */
function getStatusCodeReason(statusCode) {
  const reasons = {
    403: 'forbidden',
    404: 'not_found',
    429: 'too_many_requests',
    503: 'service_unavailable'
  };

  return reasons[statusCode] || `http_error_${statusCode}`;
}

/**
 * Get suggested action for blocked page.
 *
 * @param {string} reason - Block reason type
 * @returns {string} Suggestion
 */
function getBlockedSuggestion(reason) {
  const suggestions = {
    captcha: 'Use Web Unlocker to bypass CAPTCHA',
    rateLimited: 'Wait before retrying. Use retry budget carefully.',
    forbidden: 'Access denied. Skip this domain or use Web Unlocker.',
    empty: 'Content empty or removed. Cache short TTL.',
    botDetection: 'Bot detected. Try Web Unlocker with residential proxy.',
    cloudflare: 'Cloudflare challenge. Use Web Unlocker.',
    missing_selectors: 'JavaScript content not rendered. Try Web Unlocker with JS.'
  };

  return suggestions[reason] || 'Use Web Unlocker or skip domain';
}

/**
 * Determine appropriate cache TTL based on blocked reason.
 *
 * @param {string} reason - Block reason from detectBlocked()
 * @param {string} domain - Domain being cached
 * @returns {number} TTL in hours
 */
export function getBlockedCacheTTL(reason, domain = '') {
  // Short TTL for transient issues
  if (reason === 'rateLimited') return 1;
  if (reason === 'temporary') return 2;

  // Medium TTL for protection mechanisms (may change)
  if (reason.includes('captcha') || reason === 'botDetection') return 2;
  if (reason === 'cloudflare') return 4;

  // Longer TTL for permanent blocks
  if (reason === 'forbidden') return 24;
  if (reason === 'not_found') return 168; // 7 days

  // Domain-specific default
  if (domain.includes('vivino.com')) return 2;
  if (domain.includes('decanter.com')) return 4;
  if (domain.includes('wine-searcher.com')) return 2;

  // Generic blocked default
  return 2;
}

/**
 * Determine if a blocked result should trigger retry.
 * Retry budget is scarce - only retry for transient issues.
 *
 * @param {string} reason - Block reason from detectBlocked()
 * @param {number} retryCount - Number of times already retried
 * @param {number} maxRetries - Max allowed retries for this search
 * @returns {boolean} True if should retry
 */
export function shouldRetryBlocked(reason, retryCount = 0, maxRetries = 1) {
  // Don't retry if we've exhausted retry budget
  if (retryCount >= maxRetries) return false;

  // Only retry transient issues
  const retryableReasons = [
    'rateLimited',
    'temporary',
    'service_unavailable'
  ];

  return retryableReasons.some(r => reason.includes(r));
}

/**
 * Validate content looks like expected domain type.
 * Quick sanity check that we got the right page, not an error page.
 *
 * @param {string} content - Page content
 * @param {string} domain - Expected domain
 * @param {string[]} expectedIndicators - Strings that should be present
 * @returns {boolean} True if content looks valid
 */
export function validateContentDomain(content, domain, expectedIndicators = []) {
  if (!content || content.length < 100) {
    return false;
  }

  // Check for expected indicators if provided
  if (expectedIndicators.length > 0) {
    const foundCount = expectedIndicators.filter(ind =>
      content.toLowerCase().includes(ind.toLowerCase())
    ).length;

    // Need at least 50% of expected indicators
    return foundCount >= expectedIndicators.length * 0.5;
  }

  return true;
}
