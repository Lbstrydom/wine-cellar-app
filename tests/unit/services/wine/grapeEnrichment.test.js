/**
 * @fileoverview Unit tests for grape enrichment service.
 * Tests grape detection from names, appellation proxies, multi-grape, and no-signal cases.
 */

import { detectGrapesFromWine, batchDetectGrapes } from '../../../../src/services/wine/grapeEnrichment.js';

describe('grapeEnrichment', () => {
  describe('detectGrapesFromWine', () => {
    describe('direct grape name detection', () => {
      it('detects single grape in wine name', () => {
        const result = detectGrapesFromWine({ wine_name: 'Kanonkop Pinotage 2019' });
        expect(result.grapes).toBe('Pinotage');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('name');
      });

      it('detects Shiraz/Syrah variants', () => {
        const shiraz = detectGrapesFromWine({ wine_name: 'Boschendal Shiraz 2020' });
        expect(shiraz.grapes).toContain('Shiraz');
        expect(shiraz.confidence).toBe('high');

        const syrah = detectGrapesFromWine({ wine_name: 'Côte-Rôtie Syrah 2018' });
        expect(syrah.grapes).toContain('Shiraz');
        expect(syrah.confidence).toBe('high');
      });

      it('detects Cabernet Sauvignon (two-word grape)', () => {
        const result = detectGrapesFromWine({ wine_name: 'Warwick Cabernet Sauvignon 2018' });
        expect(result.grapes).toContain('Cabernet Sauvignon');
        expect(result.confidence).toBe('high');
      });

      it('detects grape from style field when not in name', () => {
        const result = detectGrapesFromWine({ wine_name: 'Mystery Estate Reserve', style: 'Merlot' });
        expect(result.grapes).toBe('Merlot');
        expect(result.confidence).toBe('high');
      });

      it('detects multiple grapes in blend name', () => {
        const result = detectGrapesFromWine({
          wine_name: 'GSM Grenache Shiraz Mourvèdre 2020'
        });
        expect(result.grapes).toContain('Shiraz');
        expect(result.grapes).toContain('Grenache');
        expect(result.grapes).toContain('Mourvèdre');
        expect(result.confidence).toBe('high');
      });

      it('detects Chenin Blanc', () => {
        const result = detectGrapesFromWine({ wine_name: 'Ken Forrester Chenin Blanc 2022' });
        expect(result.grapes).toBe('Chenin Blanc');
        expect(result.confidence).toBe('high');
      });

      it('detects Sauvignon Blanc', () => {
        const result = detectGrapesFromWine({ wine_name: 'Tokara Sauvignon Blanc 2023' });
        expect(result.grapes).toBe('Sauvignon Blanc');
        expect(result.confidence).toBe('high');
      });

      it('detects Gewürztraminer with special characters', () => {
        const result = detectGrapesFromWine({ wine_name: 'Trimbach Gewürztraminer 2019' });
        expect(result.grapes).toBe('Gewürztraminer');
        expect(result.confidence).toBe('high');
      });

      it('handles case-insensitive matching', () => {
        const result = detectGrapesFromWine({ wine_name: 'ESTATE CHARDONNAY 2021' });
        expect(result.grapes).toBe('Chardonnay');
        expect(result.confidence).toBe('high');
      });
    });

    describe('appellation proxy detection', () => {
      it('detects Nebbiolo from Barolo', () => {
        const result = detectGrapesFromWine({ wine_name: 'Giacomo Conterno Barolo 2016' });
        expect(result.grapes).toBe('Nebbiolo');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Nebbiolo from Barbaresco', () => {
        const result = detectGrapesFromWine({ wine_name: 'Gaja Barbaresco 2017' });
        expect(result.grapes).toBe('Nebbiolo');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Sangiovese from Chianti', () => {
        const result = detectGrapesFromWine({ wine_name: 'Antinori Chianti Classico 2019' });
        expect(result.grapes).toBe('Sangiovese');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Sangiovese from Brunello', () => {
        const result = detectGrapesFromWine({ wine_name: 'Biondi-Santi Brunello di Montalcino 2015' });
        expect(result.grapes).toBe('Sangiovese');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Sauvignon Blanc from Sancerre', () => {
        const result = detectGrapesFromWine({ wine_name: 'Domaine Vacheron Sancerre 2021' });
        expect(result.grapes).toBe('Sauvignon Blanc');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Chardonnay from Chablis', () => {
        const result = detectGrapesFromWine({ wine_name: 'William Fèvre Chablis Grand Cru 2018' });
        expect(result.grapes).toBe('Chardonnay');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Chenin Blanc from Vouvray', () => {
        const result = detectGrapesFromWine({ wine_name: 'Domaine Huet Vouvray 2020' });
        expect(result.grapes).toBe('Chenin Blanc');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Chardonnay from Meursault', () => {
        const result = detectGrapesFromWine({ wine_name: 'Domaine Roulot Meursault 2019' });
        expect(result.grapes).toBe('Chardonnay');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Tempranillo from Ribera del Duero', () => {
        const result = detectGrapesFromWine({ wine_name: 'Vega Sicilia Ribera del Duero 2015' });
        expect(result.grapes).toBe('Tempranillo');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Shiraz from Hermitage', () => {
        const result = detectGrapesFromWine({ wine_name: 'Jaboulet Hermitage La Chapelle 2017' });
        expect(result.grapes).toBe('Shiraz');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });
    });

    describe('region-based detection', () => {
      it('detects grape from region when name has no signal', () => {
        const result = detectGrapesFromWine({
          wine_name: 'Castillo de Aresan Reserve',
          region: 'Ribera del Duero'
        });
        expect(result.grapes).toBe('Tempranillo');
        expect(result.source).toBe('region');
      });

      it('downgrades confidence for region-only detection', () => {
        const result = detectGrapesFromWine({
          wine_name: 'Some Estate Red',
          region: 'Barolo'
        });
        expect(result.grapes).toBe('Nebbiolo');
        expect(result.confidence).toBe('medium');
        expect(result.source).toBe('region');
      });
    });

    describe('no-signal cases', () => {
      it('returns null for generic blend names', () => {
        const result = detectGrapesFromWine({ wine_name: 'Quoin Rock Red Blend 2020' });
        expect(result.grapes).toBeNull();
        expect(result.confidence).toBe('low');
      });

      it('returns null for empty wine', () => {
        const result = detectGrapesFromWine({});
        expect(result.grapes).toBeNull();
      });

      it('returns null for null input', () => {
        const result = detectGrapesFromWine(null);
        expect(result.grapes).toBeNull();
      });

      it('returns null for wine with only generic name', () => {
        const result = detectGrapesFromWine({ wine_name: 'Black Angus Reserve 2019' });
        expect(result.grapes).toBeNull();
        expect(result.confidence).toBe('low');
      });
    });

    describe('priority ordering', () => {
      it('prefers direct name match over appellation', () => {
        // If wine name contains both a grape and an appellation, grape wins
        const result = detectGrapesFromWine({ wine_name: 'Chianti Sangiovese Riserva' });
        expect(result.grapes).toContain('Sangiovese');
        expect(result.source).toBe('name');
      });

      it('prefers appellation in name over region', () => {
        const result = detectGrapesFromWine({
          wine_name: 'Domaine Huet Vouvray Sec 2020',
          region: 'Mendoza'
        });
        expect(result.grapes).toBe('Chenin Blanc');
        expect(result.source).toBe('appellation');
      });
    });
  });

  describe('batchDetectGrapes', () => {
    it('processes multiple wines', () => {
      const wines = [
        { id: 1, wine_name: 'Kanonkop Pinotage 2019' },
        { id: 2, wine_name: 'Gaja Barbaresco 2017' },
        { id: 3, wine_name: 'Mystery Blend 2020' }
      ];

      const results = batchDetectGrapes(wines);
      expect(results).toHaveLength(3);
      expect(results[0].detection.grapes).toBe('Pinotage');
      expect(results[1].detection.grapes).toBe('Nebbiolo');
      expect(results[2].detection.grapes).toBeNull();
    });

    it('includes wine IDs and names', () => {
      const results = batchDetectGrapes([{ id: 42, wine_name: 'Test Merlot' }]);
      expect(results[0].wineId).toBe(42);
      expect(results[0].wine_name).toBe('Test Merlot');
    });

    it('handles empty array', () => {
      expect(batchDetectGrapes([])).toEqual([]);
    });

    it('handles null input', () => {
      expect(batchDetectGrapes(null)).toEqual([]);
    });
  });
});
