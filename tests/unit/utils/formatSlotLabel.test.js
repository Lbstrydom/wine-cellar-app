/**
 * @fileoverview Unit tests for formatSlotLabel and getAreaName helpers.
 * Pure functions — no mocks needed.
 * @module tests/unit/utils/formatSlotLabel.test
 */

import { formatSlotLabel, getAreaName } from '../../../public/js/utils.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AREA_A_ID = 'area-a-uuid';
const AREA_B_ID = 'area-b-uuid';

const multipleAreas = [
  { id: AREA_A_ID, name: 'Main Cellar' },
  { id: AREA_B_ID, name: 'Wine Fridge' },
];

const singleArea = [
  { id: AREA_A_ID, name: 'Main Cellar' },
];

// ── formatSlotLabel ────────────────────────────────────────────────────────────

describe('formatSlotLabel', () => {
  describe('single-area layout — no prefix', () => {
    it('returns bare location code for single area', () => {
      expect(formatSlotLabel('R1C1', AREA_A_ID, singleArea)).toBe('R1C1');
    });

    it('returns bare location code even with a valid areaId', () => {
      expect(formatSlotLabel('F2', AREA_A_ID, singleArea)).toBe('F2');
    });
  });

  describe('multi-area layout — area prefix added', () => {
    it('prepends area name in brackets for known area', () => {
      expect(formatSlotLabel('R1C1', AREA_A_ID, multipleAreas)).toBe('[Main Cellar] R1C1');
    });

    it('prepends fridge area name', () => {
      expect(formatSlotLabel('F3', AREA_B_ID, multipleAreas)).toBe('[Wine Fridge] F3');
    });

    it('returns bare code when areaId is not found in areas', () => {
      expect(formatSlotLabel('R5C2', 'unknown-id', multipleAreas)).toBe('R5C2');
    });
  });

  describe('null / missing arguments', () => {
    it('returns locationCode as-is when areaId is null', () => {
      expect(formatSlotLabel('R1C1', null, multipleAreas)).toBe('R1C1');
    });

    it('returns locationCode as-is when areas is null', () => {
      expect(formatSlotLabel('R1C1', AREA_A_ID, null)).toBe('R1C1');
    });

    it('returns locationCode as-is when areas is undefined', () => {
      expect(formatSlotLabel('R1C1', AREA_A_ID, undefined)).toBe('R1C1');
    });

    it('returns locationCode as-is when areas is empty array', () => {
      expect(formatSlotLabel('R1C1', AREA_A_ID, [])).toBe('R1C1');
    });

    it('returns locationCode unchanged when locationCode is empty string', () => {
      expect(formatSlotLabel('', AREA_A_ID, multipleAreas)).toBe('');
    });

    it('returns locationCode unchanged when locationCode is null', () => {
      expect(formatSlotLabel(null, AREA_A_ID, multipleAreas)).toBe(null);
    });
  });
});

// ── getAreaName ────────────────────────────────────────────────────────────────

describe('getAreaName', () => {
  it('returns name for a known area', () => {
    expect(getAreaName(AREA_A_ID, multipleAreas)).toBe('Main Cellar');
  });

  it('returns name for the second area', () => {
    expect(getAreaName(AREA_B_ID, multipleAreas)).toBe('Wine Fridge');
  });

  it('returns empty string when areaId is not found', () => {
    expect(getAreaName('unknown-id', multipleAreas)).toBe('');
  });

  it('returns empty string when areaId is null', () => {
    expect(getAreaName(null, multipleAreas)).toBe('');
  });

  it('returns empty string when areas is null', () => {
    expect(getAreaName(AREA_A_ID, null)).toBe('');
  });

  it('returns empty string when areas is undefined', () => {
    expect(getAreaName(AREA_A_ID, undefined)).toBe('');
  });

  it('returns empty string for empty areas array', () => {
    expect(getAreaName(AREA_A_ID, [])).toBe('');
  });

  it('returns empty string when area has no name property', () => {
    const areas = [{ id: AREA_A_ID }];
    expect(getAreaName(AREA_A_ID, areas)).toBe('');
  });
});
