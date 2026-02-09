/**
 * @fileoverview Unit tests for wine name parser.
 * Tests grape, region, and style detection from wine names.
 */

import { parseWineName } from '../../../../src/services/wine/wineNameParser.js';

describe('parseWineName', () => {
  describe('grape detection', () => {
    it('should detect Cabernet Sauvignon', () => {
      const result = parseWineName('Chateau Example Cabernet Sauvignon 2019');
      expect(result.grape).toBe('cabernet_sauvignon');
      expect(result.detected_from).toContain('grape_in_name');
    });

    it('should detect Cabernet alone as Cabernet Sauvignon', () => {
      const result = parseWineName('Opus One Cabernet 2018');
      expect(result.grape).toBe('cabernet_sauvignon');
    });

    it('should detect Pinot Noir', () => {
      const result = parseWineName('Domaine de la Example Pinot Noir');
      expect(result.grape).toBe('pinot_noir');
    });

    it('should detect Pinot Nero (Italian)', () => {
      const result = parseWineName('Alto Adige Pinot Nero 2020');
      expect(result.grape).toBe('pinot_noir');
    });

    it('should detect Pinotage', () => {
      const result = parseWineName('Kanonkop Pinotage 2019');
      expect(result.grape).toBe('pinotage');
    });

    it('should detect Chenin Blanc', () => {
      const result = parseWineName('Ken Forrester Chenin Blanc 2021');
      expect(result.grape).toBe('chenin_blanc');
    });

    it('should detect Shiraz', () => {
      const result = parseWineName('Penfolds Shiraz 2018');
      expect(result.grape).toBe('shiraz');
    });

    it('should detect Syrah', () => {
      const result = parseWineName('Hermitage Syrah 2017');
      expect(result.grape).toBe('syrah');
    });

    it('should detect Gewurztraminer with umlaut', () => {
      const result = parseWineName('Alsace Gewürztraminer 2020');
      expect(result.grape).toBe('gewurztraminer');
    });

    it('should detect Sangiovese', () => {
      const result = parseWineName('Rosso di Montalcino Sangiovese 2019');
      expect(result.grape).toBe('sangiovese');
    });

    it('should detect Tempranillo', () => {
      const result = parseWineName('Rioja Tempranillo Reserva 2016');
      expect(result.grape).toBe('tempranillo');
    });

    it('should detect Malbec', () => {
      const result = parseWineName('Catena Malbec 2019');
      expect(result.grape).toBe('malbec');
    });
  });

  describe('region detection', () => {
    it('should detect Barolo and infer Nebbiolo', () => {
      const result = parseWineName('Giacomo Conterno Barolo 2016');
      expect(result.region).toBe('barolo');
      expect(result.grape).toBe('nebbiolo');
      expect(result.detected_from).toContain('grape_from_region');
    });

    it('should detect Brunello and infer Sangiovese', () => {
      const result = parseWineName('Biondi-Santi Brunello di Montalcino 2015');
      expect(result.region).toBe('brunello');
      expect(result.grape).toBe('sangiovese');
    });

    it('should detect Chianti Classico', () => {
      const result = parseWineName('Castello di Ama Chianti Classico 2018');
      expect(result.region).toBe('chianti_classico');
      expect(result.grape).toBe('sangiovese');
    });

    it('should detect Amarone and infer Corvina', () => {
      // Note: parser checks Valpolicella before Amarone in pattern order
      // Both match, but Valpolicella comes first in the patterns array
      const result = parseWineName('Bertani Amarone 2015');
      expect(result.region).toBe('amarone');
      expect(result.grape).toBe('corvina');
    });

    it('should detect Bordeaux', () => {
      const result = parseWineName('Chateau Margaux Bordeaux 2015');
      expect(result.region).toBe('bordeaux');
    });

    it('should detect Burgundy from Bourgogne', () => {
      const result = parseWineName('Bourgogne Rouge 2019');
      expect(result.region).toBe('burgundy');
    });

    it('should detect Chablis and infer Chardonnay', () => {
      const result = parseWineName('Domaine Laroche Chablis Premier Cru 2019');
      expect(result.region).toBe('chablis');
      expect(result.grape).toBe('chardonnay');
    });

    it('should detect Champagne', () => {
      const result = parseWineName('Krug Grande Cuvée Champagne');
      expect(result.region).toBe('champagne');
    });

    it('should detect Sancerre and infer Sauvignon Blanc', () => {
      const result = parseWineName('Domaine Vacheron Sancerre 2020');
      expect(result.region).toBe('sancerre');
      expect(result.grape).toBe('sauvignon_blanc');
    });

    it('should detect Rioja and infer Tempranillo', () => {
      const result = parseWineName('Marqués de Riscal Rioja Reserva 2017');
      expect(result.region).toBe('rioja');
      expect(result.grape).toBe('tempranillo');
    });

    it('should detect Stellenbosch', () => {
      const result = parseWineName('Kanonkop Stellenbosch 2018');
      expect(result.region).toBe('stellenbosch');
    });

    it('should detect Napa', () => {
      const result = parseWineName('Opus One Napa Valley 2018');
      expect(result.region).toBe('napa');
    });

    it('should detect Marlborough', () => {
      const result = parseWineName('Cloudy Bay Marlborough Sauvignon Blanc 2021');
      expect(result.region).toBe('marlborough');
    });

    it('should detect Barossa', () => {
      const result = parseWineName('Penfolds Grange Barossa Valley 2017');
      expect(result.region).toBe('barossa');
    });

    it('should detect Mendoza', () => {
      const result = parseWineName('Catena Zapata Mendoza Malbec 2019');
      expect(result.region).toBe('mendoza');
    });

    it('should detect Mosel and infer Riesling', () => {
      const result = parseWineName('Dr. Loosen Mosel Riesling 2020');
      expect(result.region).toBe('mosel');
      expect(result.grape).toBe('riesling');
    });
  });

  describe('style detection', () => {
    it('should detect Riserva', () => {
      const result = parseWineName('Chianti Classico Riserva 2017');
      expect(result.style).toBe('riserva');
    });

    it('should detect Gran Reserva', () => {
      const result = parseWineName('Rioja Gran Reserva 2012');
      expect(result.style).toBe('gran_reserva');
    });

    it('should detect Reserva', () => {
      const result = parseWineName('Rioja Reserva 2016');
      expect(result.style).toBe('reserva');
    });

    it('should detect Crianza', () => {
      const result = parseWineName('Rioja Crianza 2018');
      expect(result.style).toBe('crianza');
    });

    it('should detect Ripasso', () => {
      const result = parseWineName('Valpolicella Ripasso 2019');
      expect(result.style).toBe('ripasso');
    });

    it('should detect Grand Cru', () => {
      const result = parseWineName('Chambertin Grand Cru 2018');
      expect(result.style).toBe('grand_cru');
    });

    it('should detect Premier Cru', () => {
      const result = parseWineName('Meursault Premier Cru 2019');
      expect(result.style).toBe('premier_cru');
    });

    it('should detect 1er Cru as Premier Cru', () => {
      const result = parseWineName('Beaune 1er Cru 2018');
      expect(result.style).toBe('premier_cru');
    });

    it('should detect Spätlese', () => {
      const result = parseWineName('Mosel Riesling Spätlese 2020');
      expect(result.style).toBe('spatlese');
    });

    it('should detect Auslese', () => {
      const result = parseWineName('Rheingau Riesling Auslese 2019');
      expect(result.style).toBe('auslese');
    });

    it('should detect Late Harvest', () => {
      const result = parseWineName('Chenin Blanc Late Harvest 2020');
      expect(result.style).toBe('late_harvest');
    });

    it('should detect Brut', () => {
      const result = parseWineName('Champagne Brut NV');
      expect(result.style).toBe('brut');
    });

    it('should detect LBV', () => {
      const result = parseWineName("Graham's LBV Port 2016");
      expect(result.style).toBe('lbv');
    });

    it('should detect Tawny', () => {
      const result = parseWineName("Taylor's 20 Year Old Tawny Port");
      expect(result.style).toBe('tawny_aged');
    });

    it('should detect Fino', () => {
      const result = parseWineName('Tio Pepe Fino Sherry');
      expect(result.style).toBe('fino');
    });

    it('should detect Oloroso', () => {
      const result = parseWineName('Lustau Oloroso Sherry');
      expect(result.style).toBe('oloroso');
    });
  });

  describe('combined detection', () => {
    it('should detect region and style together', () => {
      const result = parseWineName('Barolo Riserva 2015');
      expect(result.region).toBe('barolo');
      expect(result.grape).toBe('nebbiolo');
      expect(result.style).toBe('riserva');
    });

    it('should detect grape and style together', () => {
      const result = parseWineName('Tempranillo Gran Reserva 2014');
      expect(result.grape).toBe('tempranillo');
      expect(result.style).toBe('gran_reserva');
    });

    it('should not override explicit grape with region-inferred grape', () => {
      // If grape is detected first, region should not override it
      const result = parseWineName('Pinot Noir Stellenbosch 2020');
      expect(result.grape).toBe('pinot_noir');
      expect(result.region).toBe('stellenbosch');
    });
  });

  describe('edge cases', () => {
    it('should return empty object for null input', () => {
      const result = parseWineName(null);
      expect(result).toEqual({});
    });

    it('should return empty object for empty string', () => {
      const result = parseWineName('');
      expect(result).toEqual({});
    });

    it('should handle case-insensitive matching', () => {
      const result = parseWineName('CABERNET SAUVIGNON NAPA VALLEY');
      expect(result.grape).toBe('cabernet_sauvignon');
      expect(result.region).toBe('napa');
    });

    it('should handle names with no detectable components', () => {
      const result = parseWineName('Mystery Wine 2020');
      expect(result.grape).toBeUndefined();
      expect(result.region).toBeUndefined();
      expect(result.style).toBeUndefined();
      expect(result.detected_from).toEqual([]);
    });
  });
});
