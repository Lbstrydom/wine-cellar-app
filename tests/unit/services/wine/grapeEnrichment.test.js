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

      it('detects Chianti blend (Sangiovese-led)', () => {
        const result = detectGrapesFromWine({ wine_name: 'Antinori Chianti Classico 2019' });
        expect(result.grapes).toContain('Sangiovese');
        expect(result.grapes).toContain('Canaiolo');
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

    describe('blend appellation detection', () => {
      // ── RED BLENDS ──
      it('detects Châteauneuf-du-Pape as GSM blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Château Rayas Châteauneuf-du-Pape 2018' });
        expect(result.grapes).toContain('Grenache');
        expect(result.grapes).toContain('Shiraz');
        expect(result.grapes).toContain('Mourvèdre');
        expect(result.confidence).toBe('high');
        expect(result.source).toBe('appellation');
      });

      it('detects Bordeaux Left Bank blend (Médoc)', () => {
        const result = detectGrapesFromWine({ wine_name: 'Château Margaux Margaux 2015' });
        expect(result.grapes).toContain('Cabernet Sauvignon');
        expect(result.grapes).toContain('Merlot');
        expect(result.source).toBe('appellation');
      });

      it('detects Bordeaux Right Bank blend (Pomerol)', () => {
        const result = detectGrapesFromWine({ wine_name: 'Château Pétrus Pomerol 2012' });
        expect(result.grapes).toContain('Merlot');
        expect(result.grapes).toContain('Cabernet Franc');
        expect(result.source).toBe('appellation');
      });

      it('detects generic Bordeaux as red blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Château Lynch-Bages Bordeaux 2019' });
        expect(result.grapes).toContain('Cabernet Sauvignon');
        expect(result.grapes).toContain('Merlot');
        expect(result.source).toBe('appellation');
      });

      it('detects Amarone as Corvina blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Masi Amarone della Valpolicella 2016' });
        expect(result.grapes).toContain('Corvina');
        expect(result.grapes).toContain('Rondinella');
        expect(result.source).toBe('appellation');
      });

      it('detects Rioja as Tempranillo blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'La Rioja Alta Gran Reserva Rioja 2011' });
        expect(result.grapes).toContain('Tempranillo');
        expect(result.grapes).toContain('Garnacha');
        expect(result.source).toBe('appellation');
      });

      it('detects Priorat as Grenache-Carignan blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Alvaro Palacios L\'Ermita Priorat 2019' });
        expect(result.grapes).toContain('Grenache');
        expect(result.grapes).toContain('Carignan');
        expect(result.source).toBe('appellation');
      });

      it('detects Douro as Portuguese field blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Quinta do Vale Meão Douro 2018' });
        expect(result.grapes).toContain('Touriga Nacional');
        expect(result.grapes).toContain('Touriga Franca');
        expect(result.grapes).toContain('Tinta Roriz');
        expect(result.source).toBe('appellation');
      });

      it('detects Super Tuscan as Sangiovese-Cab blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Tenuta San Guido Super Tuscan 2019' });
        expect(result.grapes).toContain('Sangiovese');
        expect(result.grapes).toContain('Cabernet Sauvignon');
        expect(result.source).toBe('appellation');
      });

      it('detects Cape Blend (Pinotage-led)', () => {
        const result = detectGrapesFromWine({ wine_name: 'Kanonkop Cape Blend 2020' });
        expect(result.grapes).toContain('Pinotage');
        expect(result.grapes).toContain('Cabernet Sauvignon');
        expect(result.source).toBe('appellation');
      });

      it('detects Meritage as Bordeaux-style blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Clos du Bois Meritage 2018' });
        expect(result.grapes).toContain('Cabernet Sauvignon');
        expect(result.grapes).toContain('Merlot');
        expect(result.source).toBe('appellation');
      });

      it('detects Côte-Rôtie as Shiraz-Viognier blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Guigal La Mouline Côte-Rôtie 2017' });
        expect(result.grapes).toContain('Shiraz');
        expect(result.grapes).toContain('Viognier');
        expect(result.source).toBe('appellation');
      });

      // ── WHITE BLENDS ──
      it('detects Sauternes as Sémillon-Sauvignon blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Château d\'Yquem Sauternes 2017' });
        expect(result.grapes).toContain('Sémillon');
        expect(result.grapes).toContain('Sauvignon Blanc');
        expect(result.source).toBe('appellation');
      });

      it('detects Jurançon as Manseng blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Domaine Cauhapé Jurançon 2020' });
        expect(result.grapes).toContain('Gros Manseng');
        expect(result.grapes).toContain('Petit Manseng');
        expect(result.source).toBe('appellation');
      });

      it('detects Bordeaux Blanc as white blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Château Smith Haut Lafitte Bordeaux Blanc 2020' });
        expect(result.grapes).toContain('Sémillon');
        expect(result.grapes).toContain('Sauvignon Blanc');
        expect(result.source).toBe('appellation');
      });

      it('detects Hermitage blanc vs red correctly', () => {
        const blanc = detectGrapesFromWine({ wine_name: 'Chapoutier Hermitage Blanc 2019' });
        expect(blanc.grapes).toContain('Marsanne');
        expect(blanc.grapes).toContain('Roussanne');

        const red = detectGrapesFromWine({ wine_name: 'Chapoutier Hermitage 2019' });
        expect(red.grapes).toBe('Shiraz');
      });

      it('detects Vinho Verde as Portuguese white blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Quinta da Aveleda Vinho Verde 2022' });
        expect(result.grapes).toContain('Loureiro');
        expect(result.grapes).toContain('Alvarinho');
        expect(result.source).toBe('appellation');
      });

      // ── SPARKLING ──
      it('detects Champagne as three-grape blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Krug Grande Cuvée Champagne' });
        expect(result.grapes).toContain('Chardonnay');
        expect(result.grapes).toContain('Pinot Noir');
        expect(result.grapes).toContain('Pinot Meunier');
        expect(result.source).toBe('appellation');
      });

      it('detects Cava as Spanish sparkling blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Codorníu Cava Brut 2021' });
        expect(result.grapes).toContain('Macabeo');
        expect(result.grapes).toContain('Parellada');
        expect(result.source).toBe('appellation');
      });

      // ── ROSÉ ──
      it('detects Provence rosé blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Domaine Tempier Bandol Rosé Provence 2022' });
        expect(result.grapes).toContain('Grenache');
        expect(result.grapes).toContain('Cinsault');
        expect(result.source).toBe('appellation');
      });

      it('detects Tavel as rosé blend', () => {
        const result = detectGrapesFromWine({ wine_name: 'Château d\'Aqueria Tavel 2022' });
        expect(result.grapes).toContain('Grenache');
        expect(result.grapes).toContain('Cinsault');
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
