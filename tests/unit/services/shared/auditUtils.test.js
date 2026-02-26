/**
 * @fileoverview Unit tests for shared audit utilities.
 * Covers parseEnvBool, parseTimeoutMs, extractJsonFromText, toAuditMetadata,
 * and shared enum constants.
 * @module tests/unit/services/shared/auditUtils.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseEnvBool,
  parseTimeoutMs,
  extractJsonFromText,
  toAuditMetadata,
  VALID_VERDICTS,
  VALID_CONFIDENCES,
  VALID_SEVERITIES
} from '../../../../src/services/shared/auditUtils.js';

describe('auditUtils', () => {

  // ─────────────────────────────────────────────────────────
  // Shared constants
  // ─────────────────────────────────────────────────────────

  describe('shared constants', () => {
    it('VALID_VERDICTS contains approve/optimize/flag', () => {
      expect(VALID_VERDICTS.has('approve')).toBe(true);
      expect(VALID_VERDICTS.has('optimize')).toBe(true);
      expect(VALID_VERDICTS.has('flag')).toBe(true);
      expect(VALID_VERDICTS.size).toBe(3);
    });

    it('VALID_CONFIDENCES contains high/medium/low', () => {
      expect(VALID_CONFIDENCES.has('high')).toBe(true);
      expect(VALID_CONFIDENCES.has('medium')).toBe(true);
      expect(VALID_CONFIDENCES.has('low')).toBe(true);
      expect(VALID_CONFIDENCES.size).toBe(3);
    });

    it('VALID_SEVERITIES contains error/warning/info', () => {
      expect(VALID_SEVERITIES.has('error')).toBe(true);
      expect(VALID_SEVERITIES.has('warning')).toBe(true);
      expect(VALID_SEVERITIES.has('info')).toBe(true);
      expect(VALID_SEVERITIES.size).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────
  // parseEnvBool
  // ─────────────────────────────────────────────────────────

  describe('parseEnvBool', () => {
    const originalEnv = process.env;

    beforeEach(() => { process.env = { ...originalEnv }; });
    afterEach(() => { process.env = originalEnv; });

    it('returns true for "true"', () => {
      process.env.TEST_FLAG = 'true';
      expect(parseEnvBool('TEST_FLAG')).toBe(true);
    });

    it('returns true for "1"', () => {
      process.env.TEST_FLAG = '1';
      expect(parseEnvBool('TEST_FLAG')).toBe(true);
    });

    it('returns false for "false"', () => {
      process.env.TEST_FLAG = 'false';
      expect(parseEnvBool('TEST_FLAG')).toBe(false);
    });

    it('returns false for "0"', () => {
      process.env.TEST_FLAG = '0';
      expect(parseEnvBool('TEST_FLAG')).toBe(false);
    });

    it('returns false when env var is not set', () => {
      delete process.env.TEST_FLAG;
      expect(parseEnvBool('TEST_FLAG')).toBe(false);
    });

    it('returns false for empty string', () => {
      process.env.TEST_FLAG = '';
      expect(parseEnvBool('TEST_FLAG')).toBe(false);
    });

    it('returns false for arbitrary strings', () => {
      process.env.TEST_FLAG = 'yes';
      expect(parseEnvBool('TEST_FLAG')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // parseTimeoutMs
  // ─────────────────────────────────────────────────────────

  describe('parseTimeoutMs', () => {
    it('returns default for undefined input', () => {
      expect(parseTimeoutMs(undefined)).toBe(45_000);
    });

    it('returns default for empty string', () => {
      expect(parseTimeoutMs('')).toBe(45_000);
    });

    it('returns default for non-numeric string', () => {
      expect(parseTimeoutMs('abc')).toBe(45_000);
    });

    it('returns default for zero', () => {
      expect(parseTimeoutMs('0')).toBe(45_000);
    });

    it('returns default for negative value', () => {
      expect(parseTimeoutMs('-5000')).toBe(45_000);
    });

    it('clamps to minimum when below min', () => {
      expect(parseTimeoutMs('1000')).toBe(5_000); // min is 5000
    });

    it('clamps to maximum when above max', () => {
      expect(parseTimeoutMs('999999')).toBe(120_000); // max is 120000
    });

    it('returns parsed value when within bounds', () => {
      expect(parseTimeoutMs('30000')).toBe(30_000);
    });

    it('returns exact min boundary', () => {
      expect(parseTimeoutMs('5000')).toBe(5_000);
    });

    it('returns exact max boundary', () => {
      expect(parseTimeoutMs('120000')).toBe(120_000);
    });

    it('accepts custom default, min, max', () => {
      expect(parseTimeoutMs(undefined, 10_000, 2_000, 50_000)).toBe(10_000);
      expect(parseTimeoutMs('1000', 10_000, 2_000, 50_000)).toBe(2_000);
      expect(parseTimeoutMs('99999', 10_000, 2_000, 50_000)).toBe(50_000);
      expect(parseTimeoutMs('25000', 10_000, 2_000, 50_000)).toBe(25_000);
    });

    it('handles NaN from parseInt', () => {
      expect(parseTimeoutMs('NaN')).toBe(45_000);
    });

    it('handles Infinity-like strings', () => {
      expect(parseTimeoutMs('Infinity')).toBe(45_000);
    });
  });

  // ─────────────────────────────────────────────────────────
  // extractJsonFromText
  // ─────────────────────────────────────────────────────────

  describe('extractJsonFromText', () => {
    it('extracts from json code fence', () => {
      const text = 'Some text\n```json\n{"verdict":"approve"}\n```';
      expect(extractJsonFromText(text)).toEqual({ verdict: 'approve' });
    });

    it('extracts from plain code fence', () => {
      const text = '```\n{"verdict":"flag"}\n```\nsome trailing text';
      expect(extractJsonFromText(text)).toEqual({ verdict: 'flag' });
    });

    it('extracts bare JSON object', () => {
      const text = 'Here is the result: {"verdict":"optimize","issues":[]}';
      const result = extractJsonFromText(text);
      expect(result.verdict).toBe('optimize');
      expect(result.issues).toEqual([]);
    });

    it('extracts JSON object when text contains extra braces before/after payload', () => {
      const text = 'prefix {not json} and payload {"verdict":"approve"} trailing {x}';
      const result = extractJsonFromText(text);
      expect(result).toEqual({ verdict: 'approve' });
    });

    it('throws on empty string', () => {
      expect(() => extractJsonFromText('')).toThrow('empty response text');
    });

    it('throws on null/undefined', () => {
      expect(() => extractJsonFromText(null)).toThrow();
      expect(() => extractJsonFromText(undefined)).toThrow();
    });

    it('throws on text with no JSON', () => {
      expect(() => extractJsonFromText('This is just plain text')).toThrow('No JSON found');
    });

    it('throws on malformed JSON inside fence', () => {
      const text = '```json\n{broken json}\n```';
      expect(() => extractJsonFromText(text)).toThrow();
    });

    it('extracts complex nested JSON from fence', () => {
      const text = `\`\`\`json
{
  "verdict": "optimize",
  "issues": [{"type": "missed_swap", "severity": "warning", "description": "test"}],
  "optimizedMoves": [{"wineId": 1, "from": "R1C1", "to": "R2C1"}],
  "reasoning": "Improved",
  "confidence": "high"
}
\`\`\``;
      const result = extractJsonFromText(text);
      expect(result.verdict).toBe('optimize');
      expect(result.issues).toHaveLength(1);
      expect(result.optimizedMoves).toHaveLength(1);
    });

    it('prefers json fence over bare JSON when both present', () => {
      const text = '{"verdict":"flag"}\n```json\n{"verdict":"approve"}\n```';
      expect(extractJsonFromText(text)).toEqual({ verdict: 'approve' });
    });
  });

  // ─────────────────────────────────────────────────────────
  // toAuditMetadata
  // ─────────────────────────────────────────────────────────

  describe('toAuditMetadata', () => {
    it('returns audited metadata for successful audit', () => {
      const result = toAuditMetadata({
        audited: true,
        verdict: 'approve',
        issues: [{ type: 'info' }],
        reasoning: 'All good',
        confidence: 'high',
        latencyMs: 1200
      });
      expect(result).toEqual({
        verdict: 'approve',
        issues: [{ type: 'info' }],
        reasoning: 'All good',
        confidence: 'high',
        latencyMs: 1200
      });
    });

    it('returns skipped metadata for skipped audit', () => {
      const result = toAuditMetadata({
        skipped: true,
        reason: 'Feature disabled',
        latencyMs: 5
      });
      expect(result).toEqual({
        skipped: true,
        reason: 'Feature disabled',
        latencyMs: 5
      });
    });

    it('returns skipped with default reason for null input', () => {
      expect(toAuditMetadata(null)).toEqual({
        skipped: true,
        reason: 'Audit returned null'
      });
    });

    it('returns skipped for undefined input', () => {
      expect(toAuditMetadata(undefined)).toEqual({
        skipped: true,
        reason: 'Audit returned null'
      });
    });

    it('returns skipped with fallback reason when reason is missing', () => {
      const result = toAuditMetadata({ skipped: true });
      expect(result.reason).toBe('Audit skipped');
    });

    it('preserves latencyMs when skipped', () => {
      const result = toAuditMetadata({ skipped: true, reason: 'timeout', latencyMs: 45000 });
      expect(result.latencyMs).toBe(45000);
    });

    it('includes suggestedDemotion when present and non-empty', () => {
      const result = toAuditMetadata({
        audited: true,
        verdict: 'flag',
        issues: [],
        reasoning: 'garlic_onion too dominant',
        confidence: 'high',
        latencyMs: 800,
        suggestedDemotion: ['garlic_onion', 'pepper']
      });
      expect(result.suggestedDemotion).toEqual(['garlic_onion', 'pepper']);
    });

    it('omits suggestedDemotion when empty array', () => {
      const result = toAuditMetadata({
        audited: true,
        verdict: 'approve',
        issues: [],
        reasoning: 'All good',
        confidence: 'high',
        latencyMs: 500,
        suggestedDemotion: []
      });
      expect(result).not.toHaveProperty('suggestedDemotion');
    });

    it('omits suggestedDemotion when not present', () => {
      const result = toAuditMetadata({
        audited: true,
        verdict: 'approve',
        issues: [],
        reasoning: 'All good',
        confidence: 'high',
        latencyMs: 500
      });
      expect(result).not.toHaveProperty('suggestedDemotion');
    });
  });
});
