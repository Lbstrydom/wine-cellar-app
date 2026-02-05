/**
 * @fileoverview URL utility functions.
 * @module utils/url
 */

/**
 * Extract the domain from a URL, stripping www. prefix.
 * Returns the original input on parse failure (graceful fallback).
 * @param {string} url - URL to extract domain from
 * @returns {string} Domain hostname or original input
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}
