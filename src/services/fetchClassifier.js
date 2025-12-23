/**
 * @fileoverview Fetch result classifier for standardised error handling.
 * @module services/fetchClassifier
 */

import logger from '../utils/logger.js';

/**
 * Fetch result classification types.
 */
export const CLASSIFICATION = {
  SUCCESS: 'success',
  BLOCKED: 'blocked',
  AUTH_REQUIRED: 'auth_required',
  CAPTCHA: 'captcha',
  PAYWALL: 'paywall',
  SPA_SHELL: 'spa_shell',
  INSUFFICIENT_CONTENT: 'insufficient_content',
  TIMEOUT: 'timeout',
  ERROR: 'error'
};

const MIN_CONTENT_LENGTH = 500;

const SPA_SHELL_INDICATORS = [
  '<div id="__next"',
  '<div id="root"',
  'window.__NUXT__',
  'window.__INITIAL_STATE__',
  'window.__DATA__',
  '<noscript>You need to enable JavaScript',
  '<noscript>Please enable JavaScript'
];

const CAPTCHA_INDICATORS = [
  'captcha',
  'challenge-form',
  'cf-challenge',
  'recaptcha',
  'hcaptcha',
  'g-recaptcha',
  'cf-turnstile',
  'px-captcha'
];

const LOGIN_INDICATORS = [
  'sign in to',
  'log in to',
  'login required',
  'create account',
  'subscribe to access',
  'members only',
  'please sign in',
  'authentication required'
];

const PAYWALL_INDICATORS = [
  'subscribe to read',
  'premium content',
  'exclusive access',
  'unlock this article',
  'purchase to continue',
  'subscription required',
  'become a member',
  'start your free trial'
];

/**
 * Classify a fetch result for consistent handling.
 * @param {Object} response - HTTP response or response-like object
 * @param {string} content - Page content
 * @returns {{ type: string, retryable: boolean, useSnippet: boolean, message: string }}
 */
export function classifyFetchResult(response, content) {
  const statusCode = response?.status || response?.statusCode;
  const contentLength = content?.length || 0;
  const lowerContent = content?.toLowerCase() || '';

  // HTTP-level classification
  if (statusCode === 403) {
    return {
      type: CLASSIFICATION.BLOCKED,
      retryable: false,
      useSnippet: true,
      message: 'Access forbidden (403)'
    };
  }

  if (statusCode === 401) {
    return {
      type: CLASSIFICATION.AUTH_REQUIRED,
      retryable: false,
      useSnippet: true,
      message: 'Authentication required (401)'
    };
  }

  if (statusCode === 429) {
    return {
      type: CLASSIFICATION.BLOCKED,
      retryable: true,
      useSnippet: true,
      message: 'Rate limited (429)'
    };
  }

  if (statusCode >= 500) {
    return {
      type: CLASSIFICATION.ERROR,
      retryable: true,
      useSnippet: false,
      message: `Server error (${statusCode})`
    };
  }

  if (statusCode === 408 || response?.timeout) {
    return {
      type: CLASSIFICATION.TIMEOUT,
      retryable: true,
      useSnippet: true,
      message: 'Request timed out'
    };
  }

  // Content-level classification
  if (!content || contentLength < MIN_CONTENT_LENGTH) {
    // Check if it's an SPA shell
    if (SPA_SHELL_INDICATORS.some(ind => lowerContent.includes(ind.toLowerCase()))) {
      return {
        type: CLASSIFICATION.SPA_SHELL,
        retryable: true, // Could retry with Web Unlocker
        useSnippet: true,
        message: 'JavaScript-rendered page (SPA shell only)'
      };
    }

    return {
      type: CLASSIFICATION.INSUFFICIENT_CONTENT,
      retryable: true,
      useSnippet: true,
      message: `Content too short (${contentLength} chars)`
    };
  }

  // Check for captcha
  if (CAPTCHA_INDICATORS.some(ind => lowerContent.includes(ind))) {
    return {
      type: CLASSIFICATION.CAPTCHA,
      retryable: true,
      useSnippet: true,
      message: 'Captcha challenge detected'
    };
  }

  // Check for login wall (only if content is short)
  if (contentLength < 2000 && LOGIN_INDICATORS.some(ind => lowerContent.includes(ind))) {
    return {
      type: CLASSIFICATION.AUTH_REQUIRED,
      retryable: false,
      useSnippet: true,
      message: 'Login required to view content'
    };
  }

  // Check for paywall
  if (PAYWALL_INDICATORS.some(ind => lowerContent.includes(ind))) {
    return {
      type: CLASSIFICATION.PAYWALL,
      retryable: false,
      useSnippet: true,
      message: 'Content behind paywall'
    };
  }

  // Success
  return {
    type: CLASSIFICATION.SUCCESS,
    retryable: false,
    useSnippet: false,
    message: 'Content fetched successfully'
  };
}

/**
 * Known problematic domains and their handling.
 */
const KNOWN_PROBLEMATIC_DOMAINS = {
  'vivino.com': { issue: 'spa', solution: 'snippet', description: 'SPA requires JS rendering' },
  'cellartracker.com': { issue: 'auth', solution: 'snippet', description: 'Login required for full content' },
  'winemag.com': { issue: 'blocked', solution: 'snippet', description: 'Often blocks scrapers' },
  'jancisrobinson.com': { issue: 'paywall', solution: 'snippet', description: 'Premium content paywalled' },
  'robertparker.com': { issue: 'paywall', solution: 'snippet', description: 'Wine Advocate paywall' },
  'erobertparker.com': { issue: 'paywall', solution: 'snippet', description: 'Wine Advocate paywall' },
  'winespectator.com': { issue: 'paywall', solution: 'snippet', description: 'Paywall for full reviews' },
  'vinous.com': { issue: 'paywall', solution: 'snippet', description: 'Premium content paywalled' },
  'wineadvocate.com': { issue: 'paywall', solution: 'snippet', description: 'Wine Advocate paywall' }
};

/**
 * Determine if a domain is known to require special handling.
 * @param {string} url - URL to check
 * @returns {Object|null} Domain issue info or null
 */
export function getDomainIssue(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return KNOWN_PROBLEMATIC_DOMAINS[hostname] || null;
  } catch {
    return null;
  }
}

/**
 * Check if a URL should be skipped entirely.
 * @param {string} url - URL to check
 * @returns {boolean} True if should skip fetching
 */
export function shouldSkipFetch(url) {
  const issue = getDomainIssue(url);
  // Only skip if we know it's paywalled and we can't get any value
  return false; // Always try - we can fall back to snippet
}

/**
 * Log classification result.
 * @param {string} url - URL that was fetched
 * @param {Object} classification - Classification result
 */
export function logClassification(url, classification) {
  const logLevel = classification.type === CLASSIFICATION.SUCCESS ? 'info' : 'warn';
  logger[logLevel]('FetchClassifier', `${url.substring(0, 60)}... → ${classification.type}: ${classification.message}`);
}

export { MIN_CONTENT_LENGTH };
