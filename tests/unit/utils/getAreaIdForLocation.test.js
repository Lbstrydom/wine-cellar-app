/**
 * @fileoverview Unit tests for getAreaIdForLocation helper.
 * Pure function — no mocks needed.
 * @module tests/unit/utils/getAreaIdForLocation.test
 */

import { getAreaIdForLocation } from '../../../public/js/utils.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AREA_A_ID = 'area-a-uuid';
const AREA_B_ID = 'area-b-uuid';

/** Dynamic areas layout (new format) */
const areasLayout = {
  areas: [
    {
      id: AREA_A_ID,
      name: 'Main Cellar',
      rows: [
        {
          slots: [
            { location_code: 'R1C1', storage_area_id: AREA_A_ID, wine_id: null },
            { location_code: 'R1C2', storage_area_id: AREA_A_ID, wine_id: 'w1' },
          ]
        },
        {
          slots: [
            { location_code: 'R2C1', storage_area_id: AREA_A_ID, wine_id: null },
          ]
        }
      ]
    },
    {
      id: AREA_B_ID,
      name: 'Wine Fridge',
      rows: [
        {
          slots: [
            { location_code: 'F1', storage_area_id: AREA_B_ID, wine_id: null },
            { location_code: 'F2', storage_area_id: AREA_B_ID, wine_id: 'w2' },
          ]
        }
      ]
    }
  ]
};

/** Dynamic areas layout where slot has no storage_area_id (falls back to area.id) */
const areasLayoutNoSlotAreaId = {
  areas: [
    {
      id: AREA_A_ID,
      name: 'Fallback Area',
      rows: [
        {
          slots: [
            { location_code: 'R5C3', wine_id: null }  // no storage_area_id on slot
          ]
        }
      ]
    }
  ]
};

/** Legacy layout format */
const legacyLayout = {
  cellar: {
    rows: [
      {
        slots: [
          { location_code: 'R1C1', storage_area_id: AREA_A_ID },
          { location_code: 'R1C2', storage_area_id: AREA_A_ID },
        ]
      }
    ]
  },
  fridge: {
    rows: [
      {
        slots: [
          { location_code: 'F1', storage_area_id: AREA_B_ID },
        ]
      }
    ]
  }
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getAreaIdForLocation', () => {
  describe('null / missing layout', () => {
    it('returns null for null layout', () => {
      expect(getAreaIdForLocation(null, 'R1C1')).toBeNull();
    });

    it('returns null for undefined layout', () => {
      expect(getAreaIdForLocation(undefined, 'R1C1')).toBeNull();
    });
  });

  describe('dynamic areas layout', () => {
    it('finds a slot in the first area', () => {
      expect(getAreaIdForLocation(areasLayout, 'R1C1')).toBe(AREA_A_ID);
    });

    it('finds a slot in a second row of the first area', () => {
      expect(getAreaIdForLocation(areasLayout, 'R2C1')).toBe(AREA_A_ID);
    });

    it('finds a fridge slot in the second area', () => {
      expect(getAreaIdForLocation(areasLayout, 'F1')).toBe(AREA_B_ID);
      expect(getAreaIdForLocation(areasLayout, 'F2')).toBe(AREA_B_ID);
    });

    it('returns null for a location code not in layout', () => {
      expect(getAreaIdForLocation(areasLayout, 'R99C1')).toBeNull();
    });

    it('falls back to area.id when slot has no storage_area_id', () => {
      expect(getAreaIdForLocation(areasLayoutNoSlotAreaId, 'R5C3')).toBe(AREA_A_ID);
    });
  });

  describe('legacy layout', () => {
    it('finds a cellar slot', () => {
      expect(getAreaIdForLocation(legacyLayout, 'R1C1')).toBe(AREA_A_ID);
      expect(getAreaIdForLocation(legacyLayout, 'R1C2')).toBe(AREA_A_ID);
    });

    it('finds a fridge slot', () => {
      expect(getAreaIdForLocation(legacyLayout, 'F1')).toBe(AREA_B_ID);
    });

    it('returns null for a location code not in legacy layout', () => {
      expect(getAreaIdForLocation(legacyLayout, 'R5C5')).toBeNull();
    });
  });

  describe('empty / sparse layouts', () => {
    it('returns null for layout with empty areas array', () => {
      expect(getAreaIdForLocation({ areas: [] }, 'R1C1')).toBeNull();
    });

    it('returns null for area with no rows', () => {
      const layout = { areas: [{ id: AREA_A_ID, rows: [] }] };
      expect(getAreaIdForLocation(layout, 'R1C1')).toBeNull();
    });

    it('returns null for row with no slots', () => {
      const layout = { areas: [{ id: AREA_A_ID, rows: [{ slots: [] }] }] };
      expect(getAreaIdForLocation(layout, 'R1C1')).toBeNull();
    });

    it('handles missing rows key gracefully', () => {
      const layout = { areas: [{ id: AREA_A_ID }] };
      expect(getAreaIdForLocation(layout, 'R1C1')).toBeNull();
    });

    it('handles empty legacy layout sections', () => {
      const layout = { cellar: { rows: [] }, fridge: { rows: [] } };
      expect(getAreaIdForLocation(layout, 'R1C1')).toBeNull();
    });
  });
});
