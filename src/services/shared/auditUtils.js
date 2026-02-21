/**
 * @fileoverview Shared utilities for LLM audit modules (move auditor, pairing auditor).
 * Centralises common patterns: env-flag parsing, timeout bounds, JSON extraction,
 * and audit-metadata shaping, so that each domain auditor focuses only on
 * domain-specific prompt building, integrity validation, and normalization.
 * @module services/shared/auditUtils
 */

// ───────────────────────────────────────────────────────────
// Shared enum constants (verdicts, severities, confidences)
// ───────────────────────────────────────────────────────────

/** @type {Set<string>} Valid audit verdicts */
export const VALID_VERDICTS = new Set(['approve', 'optimize', 'flag']);
/** @type {Set<string>} Valid audit confidence levels */
export const VALID_CONFIDENCES = new Set(['high', 'medium', 'low']);
/** @type {Set<string>} Valid issue severity levels */
export const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);

// ───────────────────────────────────────────────────────────
// Environment helpers
// ───────────────────────────────────────────────────────────

/**
 * Check whether an environment variable is truthy.
 * Recognises 'true' and '1' as truthy; everything else is false.
 * @param {string} envKey - Environment variable name
 * @returns {boolean}
 */
export function parseEnvBool(envKey) {
  const val = process.env[envKey];
  return val === 'true' || val === '1';
}

/**
 * Parse and clamp a timeout value from a raw string.
 * Returns `defaultMs` for non-numeric / non-positive values.
 * @param {string|undefined} raw - Raw environment variable value
 * @param {number} [defaultMs=45000] - Default timeout in milliseconds
 * @param {number} [minMs=5000] - Minimum allowed timeout
 * @param {number} [maxMs=120000] - Maximum allowed timeout
 * @returns {number} Bounded timeout in milliseconds
 */
export function parseTimeoutMs(raw, defaultMs = 45_000, minMs = 5_000, maxMs = 120_000) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultMs;
  return Math.min(Math.max(parsed, minMs), maxMs);
}

// ───────────────────────────────────────────────────────────
// JSON extraction
// ───────────────────────────────────────────────────────────

/**
 * Extract a JSON object from raw LLM response text.
 * Handles JSON wrapped in ```json fences, plain ``` fences,
 * or bare JSON in the response body.
 * @param {string} text - Raw response text from Claude / OpenAI
 * @returns {Object} Parsed JSON object
 * @throws {Error} If no valid JSON can be extracted
 */
export function extractJsonFromText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('No JSON found: empty response text');
  }
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                    text.match(/```\s*([\s\S]*?)\s*```/) ||
                    text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response text');
  }
  return JSON.parse((jsonMatch[1] || jsonMatch[0]).trim());
}

// ───────────────────────────────────────────────────────────
// Audit result metadata shaping
// ───────────────────────────────────────────────────────────

/**
 * Convert a raw audit result into a serialisable metadata object
 * suitable for embedding in API responses.
 * @param {Object} auditResult - Result from any audit function
 * @returns {Object} Normalised metadata: either audited fields or skipped fields
 */
export function toAuditMetadata(auditResult) {
  if (!auditResult) return { skipped: true, reason: 'Audit returned null' };

  if (auditResult.audited) {
    return {
      verdict: auditResult.verdict,
      issues: auditResult.issues,
      reasoning: auditResult.reasoning,
      confidence: auditResult.confidence,
      latencyMs: auditResult.latencyMs
    };
  }

  return {
    skipped: true,
    reason: auditResult.reason || 'Audit skipped',
    latencyMs: auditResult.latencyMs
  };
}
