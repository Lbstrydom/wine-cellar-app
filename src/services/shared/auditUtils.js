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

  // Prefer fenced JSON if present.
  const fencedCandidates = [
    text.match(/```json\s*([\s\S]*?)\s*```/i),
    text.match(/```\s*([\s\S]*?)\s*```/)
  ]
    .filter(Boolean)
    .map(match => (match[1] || match[0]).trim());

  for (const candidate of fencedCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying other extraction strategies.
    }
  }

  // Fallback: scan for balanced JSON objects and return the first parseable one.
  const parsedObject = tryParseFirstBalancedObject(text);
  if (parsedObject != null) {
    return parsedObject;
  }

  throw new Error('No JSON found in response text');
}

/**
 * Attempt to parse the first balanced JSON object found in free-form text.
 * Handles brace characters inside quoted strings.
 * @param {string} text
 * @returns {Object|null}
 */
function tryParseFirstBalancedObject(text) {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let end = start; end < text.length; end++) {
      const ch = text[end];

      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (ch === '\\') {
          escaping = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth !== 0) continue;

        const candidate = text.slice(start, end + 1).trim();
        try {
          return JSON.parse(candidate);
        } catch {
          // Continue scanning for the next opening brace.
          break;
        }
      }
    }
  }

  return null;
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
    const meta = {
      verdict: auditResult.verdict,
      issues: auditResult.issues,
      reasoning: auditResult.reasoning,
      confidence: auditResult.confidence,
      latencyMs: auditResult.latencyMs
    };
    // Include suggestedDemotion if present (signal auditor)
    if (Array.isArray(auditResult.suggestedDemotion) && auditResult.suggestedDemotion.length > 0) {
      meta.suggestedDemotion = auditResult.suggestedDemotion;
    }
    return meta;
  }

  return {
    skipped: true,
    reason: auditResult.reason || 'Audit skipped',
    latencyMs: auditResult.latencyMs
  };
}
