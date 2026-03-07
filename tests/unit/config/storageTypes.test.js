import { describe, it, expect } from 'vitest';
import {
  FRIDGE_TYPES,
  CELLAR_TYPES,
  isFridgeType,
  isCellarType,
  buildAreaTypeMap,
  isWineInCellar,
  isWineInFridge
} from '../../../src/config/storageTypes.js';
import { STORAGE_TYPES } from '../../../src/schemas/storageArea.js';

// Single source of truth: imported from the schema that validates API input
const ALL_STORAGE_TYPES = STORAGE_TYPES;

describe('storageTypes config', () => {
  describe('type sets cover all known values', () => {
    it('every known storage type is in exactly one set', () => {
      for (const type of ALL_STORAGE_TYPES) {
        const inFridge = FRIDGE_TYPES.has(type);
        const inCellar = CELLAR_TYPES.has(type);
        expect(inFridge || inCellar, `${type} is not in either set`).toBe(true);
        expect(inFridge && inCellar, `${type} is in both sets`).toBe(false);
      }
    });

    it('sets contain no unknown types', () => {
      for (const type of FRIDGE_TYPES) {
        expect(ALL_STORAGE_TYPES).toContain(type);
      }
      for (const type of CELLAR_TYPES) {
        expect(ALL_STORAGE_TYPES).toContain(type);
      }
    });
  });

  describe('isFridgeType', () => {
    it('returns true for wine_fridge', () => {
      expect(isFridgeType('wine_fridge')).toBe(true);
    });

    it('returns true for kitchen_fridge', () => {
      expect(isFridgeType('kitchen_fridge')).toBe(true);
    });

    it('returns false for cellar', () => {
      expect(isFridgeType('cellar')).toBe(false);
    });

    it('returns false for rack', () => {
      expect(isFridgeType('rack')).toBe(false);
    });

    it('returns false for other', () => {
      expect(isFridgeType('other')).toBe(false);
    });

    it('returns false for undefined/null', () => {
      expect(isFridgeType(undefined)).toBe(false);
      expect(isFridgeType(null)).toBe(false);
    });
  });

  describe('isCellarType', () => {
    it('returns true for cellar', () => {
      expect(isCellarType('cellar')).toBe(true);
    });

    it('returns true for rack', () => {
      expect(isCellarType('rack')).toBe(true);
    });

    it('returns true for other', () => {
      expect(isCellarType('other')).toBe(true);
    });

    it('returns false for wine_fridge', () => {
      expect(isCellarType('wine_fridge')).toBe(false);
    });

    it('returns false for kitchen_fridge', () => {
      expect(isCellarType('kitchen_fridge')).toBe(false);
    });
  });

  describe('buildAreaTypeMap', () => {
    it('builds map from areasByType object', () => {
      const areasByType = {
        cellar: [{ id: 'area-1' }, { id: 'area-2' }],
        wine_fridge: [{ id: 'area-3' }]
      };
      const map = buildAreaTypeMap(areasByType);
      expect(map.get('area-1')).toBe('cellar');
      expect(map.get('area-2')).toBe('cellar');
      expect(map.get('area-3')).toBe('wine_fridge');
      expect(map.size).toBe(3);
    });

    it('handles null/undefined input', () => {
      expect(buildAreaTypeMap(null).size).toBe(0);
      expect(buildAreaTypeMap(undefined).size).toBe(0);
    });

    it('handles empty object', () => {
      expect(buildAreaTypeMap({}).size).toBe(0);
    });

    it('skips entries without id', () => {
      const areasByType = { cellar: [{ id: 'a1' }, { name: 'no-id' }, null] };
      const map = buildAreaTypeMap(areasByType);
      expect(map.size).toBe(1);
      expect(map.get('a1')).toBe('cellar');
    });

    it('skips non-array values', () => {
      const areasByType = { cellar: 'not-an-array' };
      const map = buildAreaTypeMap(areasByType);
      expect(map.size).toBe(0);
    });
  });

  describe('isWineInCellar', () => {
    const areaTypeMap = new Map([
      ['cellar-area', 'cellar'],
      ['rack-area', 'rack'],
      ['fridge-area', 'wine_fridge']
    ]);

    it('uses areaTypeMap when wine has storage_area_id', () => {
      expect(isWineInCellar({ storage_area_id: 'cellar-area', slot_id: 'R5C3' }, areaTypeMap)).toBe(true);
      expect(isWineInCellar({ storage_area_id: 'rack-area', slot_id: 'R20C1' }, areaTypeMap)).toBe(true);
      expect(isWineInCellar({ storage_area_id: 'fridge-area', slot_id: 'F2' }, areaTypeMap)).toBe(false);
    });

    it('falls back to format check when areaTypeMap is null', () => {
      expect(isWineInCellar({ slot_id: 'R5C3' }, null)).toBe(true);
      expect(isWineInCellar({ slot_id: 'F2' }, null)).toBe(false);
    });

    it('falls back to format check when wine has no storage_area_id', () => {
      expect(isWineInCellar({ slot_id: 'R5C3' }, areaTypeMap)).toBe(true);
      expect(isWineInCellar({ slot_id: 'F2' }, areaTypeMap)).toBe(false);
    });

    it('uses location_code when slot_id is absent', () => {
      expect(isWineInCellar({ location_code: 'R5C3' }, null)).toBe(true);
    });

    it('returns false for null/undefined slot', () => {
      expect(isWineInCellar({}, null)).toBe(false);
    });

    it('returns false when area_id not in map', () => {
      expect(isWineInCellar({ storage_area_id: 'unknown', slot_id: 'R5C3' }, areaTypeMap)).toBe(false);
    });
  });

  describe('isWineInFridge', () => {
    const areaTypeMap = new Map([
      ['cellar-area', 'cellar'],
      ['fridge-area', 'wine_fridge'],
      ['kitchen-area', 'kitchen_fridge']
    ]);

    it('uses areaTypeMap when wine has storage_area_id', () => {
      expect(isWineInFridge({ storage_area_id: 'fridge-area', slot_id: 'F2' }, areaTypeMap)).toBe(true);
      expect(isWineInFridge({ storage_area_id: 'kitchen-area', slot_id: 'F1' }, areaTypeMap)).toBe(true);
      expect(isWineInFridge({ storage_area_id: 'cellar-area', slot_id: 'R5C3' }, areaTypeMap)).toBe(false);
    });

    it('falls back to format check when areaTypeMap is null', () => {
      expect(isWineInFridge({ slot_id: 'F2' }, null)).toBe(true);
      expect(isWineInFridge({ slot_id: 'R5C3' }, null)).toBe(false);
    });

    it('falls back to format check when wine has no storage_area_id', () => {
      expect(isWineInFridge({ slot_id: 'F2' }, areaTypeMap)).toBe(true);
    });

    it('returns false for null/undefined slot', () => {
      expect(isWineInFridge({}, null)).toBe(false);
    });
  });
});
