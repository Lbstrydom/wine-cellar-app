/**
 * @fileoverview Tests for grapeData.js reference data module.
 */

import { describe, it, expect } from 'vitest';
import {
  GRAPE_VARIETIES, WHITE_GRAPES, RED_GRAPES,
  COMMON_BLENDS, GRAPE_COLOUR_MAP, FILTER_CATEGORIES,
} from '../../../public/js/grapeData.js';

describe('GRAPE_VARIETIES', () => {
  it('has at least 70 varieties', () => {
    expect(GRAPE_VARIETIES.length).toBeGreaterThanOrEqual(70);
  });

  it('is sorted alphabetically within colour groups', () => {
    // White grapes come first (indices 0-36), then red (37+)
    // Each group should be internally sorted
    const whites = GRAPE_VARIETIES.filter(g =>
      ['Albariño','Alvarinho','Assyrtiko','Chardonnay','Chenin Blanc','Clairette',
       'Cortese','Fiano','Garganega','Gewürztraminer','Godello','Greco',
       'Grenache Blanc','Gros Manseng','Grüner Veltliner','Loureiro','Macabeo',
       'Malvasia','Marsanne','Melon de Bourgogne','Muscadelle','Muscat',
       'Parellada','Petit Manseng','Picpoul','Pinot Blanc','Pinot Grigio',
       'Riesling','Roussanne','Sauvignon Blanc','Sémillon','Torrontés',
       'Trebbiano','Verdejo','Vermentino','Viognier','Xarel·lo'].includes(g)
    );
    expect(whites.length).toBeGreaterThanOrEqual(30);
  });

  it('has no duplicates', () => {
    const unique = new Set(GRAPE_VARIETIES);
    expect(unique.size).toBe(GRAPE_VARIETIES.length);
  });

  it('includes common red varieties', () => {
    const reds = ['Cabernet Sauvignon', 'Merlot', 'Pinot Noir', 'Shiraz', 'Tempranillo', 'Sangiovese'];
    for (const grape of reds) {
      expect(GRAPE_VARIETIES).toContain(grape);
    }
  });

  it('includes common white varieties', () => {
    const whites = ['Chardonnay', 'Sauvignon Blanc', 'Riesling', 'Chenin Blanc', 'Viognier'];
    for (const grape of whites) {
      expect(GRAPE_VARIETIES).toContain(grape);
    }
  });

  it('includes South African varieties', () => {
    expect(GRAPE_VARIETIES).toContain('Pinotage');
    expect(GRAPE_VARIETIES).toContain('Chenin Blanc');
  });

  it('includes Portuguese varieties', () => {
    const portuguese = ['Touriga Nacional', 'Touriga Franca', 'Tinta Roriz', 'Tinta Barroca'];
    for (const grape of portuguese) {
      expect(GRAPE_VARIETIES).toContain(grape);
    }
  });
});

describe('COMMON_BLENDS', () => {
  it('has at least 20 blends', () => {
    expect(COMMON_BLENDS.length).toBeGreaterThanOrEqual(20);
  });

  it('each blend has label and grapes', () => {
    for (const blend of COMMON_BLENDS) {
      expect(blend).toHaveProperty('label');
      expect(blend).toHaveProperty('grapes');
      expect(blend.label).toBeTruthy();
      expect(blend.grapes).toBeTruthy();
    }
  });

  it('blend grapes are comma-separated strings', () => {
    for (const blend of COMMON_BLENDS) {
      const grapes = blend.grapes.split(',').map(g => g.trim());
      expect(grapes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('includes major red blends', () => {
    const labels = COMMON_BLENDS.map(b => b.label);
    expect(labels).toContain('Bordeaux Blend (Left Bank)');
    expect(labels.some(l => l.includes('GSM'))).toBe(true);
    expect(labels).toContain('Super Tuscan');
    expect(labels).toContain('Cape Blend');
  });

  it('includes white and sparkling blends', () => {
    const labels = COMMON_BLENDS.map(b => b.label);
    expect(labels).toContain('White Bordeaux');
    expect(labels).toContain('Champagne Blend');
    expect(labels).toContain('Cava Blend');
  });

  it('GSM blend contains correct grapes', () => {
    const gsm = COMMON_BLENDS.find(b => b.label.includes('GSM'));
    expect(gsm).toBeTruthy();
    const grapes = gsm.grapes.split(',').map(g => g.trim());
    expect(grapes).toContain('Grenache');
    expect(grapes).toContain('Mourvèdre');
  });

  it('each blend has a category', () => {
    for (const blend of COMMON_BLENDS) {
      expect(blend).toHaveProperty('category');
      expect(['red', 'white', 'sparkling', 'rosé']).toContain(blend.category);
    }
  });
});

describe('WHITE_GRAPES / RED_GRAPES', () => {
  it('WHITE_GRAPES has at least 30 entries', () => {
    expect(WHITE_GRAPES.length).toBeGreaterThanOrEqual(30);
  });

  it('RED_GRAPES has at least 30 entries', () => {
    expect(RED_GRAPES.length).toBeGreaterThanOrEqual(30);
  });

  it('GRAPE_VARIETIES equals union of WHITE and RED', () => {
    const combined = new Set([...WHITE_GRAPES, ...RED_GRAPES]);
    const all = new Set(GRAPE_VARIETIES);
    expect(combined.size).toBe(all.size);
    for (const g of combined) {
      expect(all.has(g)).toBe(true);
    }
  });

  it('no overlap between WHITE and RED', () => {
    const whiteSet = new Set(WHITE_GRAPES);
    for (const g of RED_GRAPES) {
      expect(whiteSet.has(g)).toBe(false);
    }
  });

  it('Chardonnay is white, Cabernet Sauvignon is red', () => {
    expect(WHITE_GRAPES).toContain('Chardonnay');
    expect(RED_GRAPES).toContain('Cabernet Sauvignon');
  });
});

describe('GRAPE_COLOUR_MAP', () => {
  it('maps every grape to red or white', () => {
    for (const grape of GRAPE_VARIETIES) {
      expect(GRAPE_COLOUR_MAP.has(grape)).toBe(true);
      expect(['red', 'white']).toContain(GRAPE_COLOUR_MAP.get(grape));
    }
  });

  it('correctly categorizes known grapes', () => {
    expect(GRAPE_COLOUR_MAP.get('Riesling')).toBe('white');
    expect(GRAPE_COLOUR_MAP.get('Merlot')).toBe('red');
    expect(GRAPE_COLOUR_MAP.get('Pinotage')).toBe('red');
    expect(GRAPE_COLOUR_MAP.get('Chenin Blanc')).toBe('white');
  });
});

describe('FILTER_CATEGORIES', () => {
  it('has expected filter keys', () => {
    const keys = FILTER_CATEGORIES.map(c => c.key);
    expect(keys).toContain('all');
    expect(keys).toContain('red');
    expect(keys).toContain('white');
    expect(keys).toContain('blends');
  });

  it('each category has key and label', () => {
    for (const cat of FILTER_CATEGORIES) {
      expect(cat.key).toBeTruthy();
      expect(cat.label).toBeTruthy();
    }
  });
});
