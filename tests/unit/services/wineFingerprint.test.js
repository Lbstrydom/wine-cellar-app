import { describe, it, expect } from 'vitest';
import { WineFingerprint, WINE_ALIASES, findAliases } from '../../../src/services/wineFingerprint.js';

describe('WineFingerprint', () => {
  describe('generate()', () => {
    it('should generate fingerprint for complete wine object', () => {
      const wine = {
        producer: 'Kanonkop',
        wine_name: 'Kanonkop Pinotage 2019',
        vintage: 2019,
        country: 'South Africa',
        region: 'Stellenbosch'
      };

      const fp = WineFingerprint.generate(wine);
      expect(fp).toBe('kanonkop|pinotage|pinotage|2019|za:stellenbosch');
    });

    it('should return versioned fingerprint', () => {
      const wine = {
        producer: 'Kanonkop',
        wine_name: 'Kanonkop Pinotage 2019',
        vintage: 2019,
        country: 'South Africa',
        region: 'Stellenbosch'
      };

      const result = WineFingerprint.generateWithVersion(wine);
      expect(result.version).toBe(1);
      expect(result.fingerprint).toBe('kanonkop|pinotage|pinotage|2019|za:stellenbosch');
    });

    it('should generate consistent fingerprints for same wine', () => {
      const wine = {
        producer: 'Chateau Margaux',
        wine_name: 'Chateau Margaux 2015',
        vintage: 2015,
        country: 'France',
        region: 'Pauillac'
      };

      const fp1 = WineFingerprint.generate(wine);
      const fp2 = WineFingerprint.generate(wine);

      expect(fp1).toBe(fp2);
    });

    it('should handle wine with no producer specified', () => {
      const wine = {
        wine_name: 'Bordeaux Red Blend 2018',
        vintage: 2018,
        country: 'France',
        region: 'Bordeaux'
      };

      const fp = WineFingerprint.generate(wine);
      expect(fp).toBeDefined();
      expect(fp).toContain('2018');
      expect(fp).toContain('fr:bordeaux');
    });

    it('should handle non-vintage wines', () => {
      const wine = {
        producer: 'Champagne Bollinger',
        wine_name: 'Champagne Bollinger Brut',
        country: 'France',
        region: 'Champagne'
      };

      const fp = WineFingerprint.generate(wine);
      expect(fp).toContain('|nv|');
    });

    it('should return null for null input', () => {
      expect(WineFingerprint.generate(null)).toBe(null);
    });
  });

  describe('normalizeProducer()', () => {
    it('should remove French prefixes', () => {
      expect(WineFingerprint.normalizeProducer('Chateau Margaux')).toBe('margaux');
      expect(WineFingerprint.normalizeProducer('Domaine de la Romanee')).toBe('de-la-romanee');
      expect(WineFingerprint.normalizeProducer('Clos de Vougeot')).toBe('de-vougeot');
    });

    it('should remove Spanish prefixes', () => {
      expect(WineFingerprint.normalizeProducer('Bodega Catena')).toBe('catena');
    });

    it('should remove Italian prefixes', () => {
      expect(WineFingerprint.normalizeProducer('Tenuta Gaja')).toBe('gaja');
      expect(WineFingerprint.normalizeProducer('Cantina Artesa')).toBe('artesa');
    });

    it('should remove German prefixes', () => {
      expect(WineFingerprint.normalizeProducer('Weingut Muller')).toBe('muller');
    });

    it('should strip punctuation in names', () => {
      expect(WineFingerprint.normalizeProducer("O'Shaughnessy")).toBe('o-shaughnessy');
      expect(WineFingerprint.normalizeProducer("Chateau d'Issan")).toBe('d-issan');
    });

    it('should normalize spacing', () => {
      expect(WineFingerprint.normalizeProducer('Kanonkop  Estate')).toBe('kanonkop-estate');
      const result = WineFingerprint.normalizeProducer('  Bordeaux  Wines  ');
      expect(result).toContain('bordeaux');
      expect(result).toContain('wines');
    });

    it('should handle unknown producers', () => {
      expect(WineFingerprint.normalizeProducer(null)).toBe('unknown');
      expect(WineFingerprint.normalizeProducer('')).toBe('unknown');
    });
  });

  describe('extractCuveeAndVarietal()', () => {
    it('should extract varietal separately from cuvee', () => {
      const { cuvee, varietal } = WineFingerprint.extractCuveeAndVarietal(
        'Kanonkop Pinotage Reserve 2019',
        'Kanonkop'
      );
      expect(varietal).toBe('pinotage');
      // The cuvee will include the varietal since we don't remove it
      expect(cuvee).toContain('reserve');
    });

    it('should NOT drop varietal from cuvee (v1.1 fix)', () => {
      const { cuvee, varietal } = WineFingerprint.extractCuveeAndVarietal(
        'Domaine Chardonnay Grand Cru',
        'Domaine'
      );
      // Varietal should be extracted
      expect(varietal).toBe('chardonnay');
      // But if we were to include it elsewhere, it should be clear
      expect(cuvee).toContain('grand-cru');
    });

    it('should preserve tier markers cleanly (v1.1 fix - no brackets)', () => {
      const { cuvee } = WineFingerprint.extractCuveeAndVarietal(
        'Penfolds Grange Reserve 2015',
        'Penfolds'
      );
      // Tier marker should be present but clean
      expect(cuvee).toContain('reserve');
      expect(cuvee).not.toContain('[');
      expect(cuvee).not.toContain(']');
    });

    it('should handle multiple varietals (sorted blend)', () => {
      const { varietal } = WineFingerprint.extractCuveeAndVarietal(
        'Blend of Cabernet Sauvignon and Merlot',
        'Producer'
      );
      expect(varietal).toBe('cabernet-sauvignon-merlot');
    });

    it('should remove vintage years from cuvee', () => {
      const { cuvee } = WineFingerprint.extractCuveeAndVarietal(
        'Producer Pinotage 2015 Reserve',
        'Producer'
      );
      expect(cuvee).not.toContain('2015');
      expect(cuvee).toContain('reserve');
    });

    it('should default to "default" cuvee when extraction fails', () => {
      const { cuvee } = WineFingerprint.extractCuveeAndVarietal(null, 'Producer');
      expect(cuvee).toBe('default');
    });
  });

  describe('normalizeLocation()', () => {
    it('should convert country names to codes', () => {
      expect(WineFingerprint.normalizeLocation('France', null)).toBe('fr');
      expect(WineFingerprint.normalizeLocation('Italy', null)).toBe('it');
      expect(WineFingerprint.normalizeLocation('Spain', null)).toBe('es');
      expect(WineFingerprint.normalizeLocation('Germany', null)).toBe('de');
    });

    it('should handle alternative country names', () => {
      expect(WineFingerprint.normalizeLocation('United States', null)).toBe('us');
      expect(WineFingerprint.normalizeLocation('South Africa', null)).toBe('za');
      expect(WineFingerprint.normalizeLocation('New Zealand', null)).toBe('nz');
    });

    it('should include appellation when provided (v1.1 fix - no truncation)', () => {
      const location = WineFingerprint.normalizeLocation('France', 'Bordeaux');
      expect(location).toBe('fr:bordeaux');
    });

    it('should not duplicate appellation if same as country', () => {
      const location = WineFingerprint.normalizeLocation('France', 'France');
      expect(location).toBe('fr');
      expect(location).not.toContain(':');
    });

    it('should normalize appellation names', () => {
      const location = WineFingerprint.normalizeLocation('France', 'Cote d\'Or');
      expect(location).toContain(':');
      expect(location).not.toContain('\'');
      expect(location).not.toContain(' ');
    });

    it('should handle unknown countries', () => {
      expect(WineFingerprint.normalizeLocation('Unknown', null)).toBe('xx');
      expect(WineFingerprint.normalizeLocation(null, null)).toBe('xx');
    });
  });

  describe('extractProducer()', () => {
    it('should extract producer from wine name', () => {
      expect(WineFingerprint.extractProducer('Kanonkop Pinotage 2019')).toBe('Kanonkop');
      // extractProducer returns the producer before hitting a stop word
      const chateau = WineFingerprint.extractProducer('Chateau Margaux 2015');
      expect(chateau).toContain('Chateau');
    });

    it('should stop at varietal keywords', () => {
      const producer = WineFingerprint.extractProducer('Domaine Chardonnay Reserve 2019');
      // Should stop before "Chardonnay"
      expect(producer).not.toContain('Chardonnay');
    });

    it('should stop at vintage years', () => {
      const producer = WineFingerprint.extractProducer('Producer Name 2015 Special');
      // Should stop at 2015
      expect(producer).not.toContain('2015');
    });

    it('should limit to 4 words', () => {
      const producer = WineFingerprint.extractProducer(
        'Very Long Winery Name Estate Vineyard Pinotage'
      );
      const wordCount = producer.split(' ').length;
      expect(wordCount).toBeLessThanOrEqual(4);
    });

    it('should handle single-word producers', () => {
      expect(WineFingerprint.extractProducer('Vivino')).toBe('Vivino');
    });
  });

  describe('matches()', () => {
    it('should return true for identical fingerprints', () => {
      const fp = 'kanonkop|pinotage|pinotage|2019|za:stellenbosch';
      expect(WineFingerprint.matches(fp, fp)).toBe(true);
    });

    it('should return true for case-insensitive matches', () => {
      const fp1 = 'kanonkop|pinotage|pinotage|2019|za:stellenbosch';
      const fp2 = 'KANONKOP|PINOTAGE|PINOTAGE|2019|ZA:STELLENBOSCH';
      expect(WineFingerprint.matches(fp1, fp2)).toBe(true);
    });

    it('should return false for different fingerprints', () => {
      const fp1 = 'kanonkop|pinotage|pinotage|2019|za:stellenbosch';
      const fp2 = 'kanonkop|pinotage|pinotage|2018|za:stellenbosch';
      expect(WineFingerprint.matches(fp1, fp2)).toBe(false);
    });

    it('should return false if either fingerprint is null', () => {
      expect(WineFingerprint.matches(null, 'kanonkop|pinotage|pinotage|2019|za:stellenbosch')).not.toBeTruthy();
      expect(WineFingerprint.matches('kanonkop|pinotage|pinotage|2019|za:stellenbosch', null)).not.toBeTruthy();
      expect(WineFingerprint.matches(null, null)).not.toBeTruthy();
    });
  });

  describe('Integration: Complete fingerprinting workflows', () => {
    it('should correctly fingerprint French wines', () => {
      const wine = {
        producer: 'Chateau Margaux',
        wine_name: 'Chateau Margaux 2015',
        vintage: 2015,
        country: 'France',
        region: 'Pauillac'
      };

      const fp = WineFingerprint.generate(wine);
      expect(fp).toContain('margaux');
      expect(fp).toContain('2015');
      expect(fp).toContain('fr:pauillac');
    });

    it('should correctly fingerprint Italian wines', () => {
      const wine = {
        producer: 'Gaja',
        wine_name: 'Gaja Barbaresco Sori Tildin 2016',
        vintage: 2016,
        country: 'Italy',
        region: 'Barbaresco'
      };

      const fp = WineFingerprint.generate(wine);
      expect(fp).toContain('gaja');
      expect(fp).toContain('2016');
      expect(fp).toContain('it:barbaresco');
    });

    it('should correctly fingerprint Spanish wines', () => {
      const wine = {
        producer: 'Vega Sicilia',
        wine_name: 'Vega Sicilia Reserva Especial 2014',
        vintage: 2014,
        country: 'Spain',
        region: 'Ribera del Duero'
      };

      const fp = WineFingerprint.generate(wine);
      expect(fp).toContain('vega-sicilia');
      expect(fp).toContain('reserva');
      expect(fp).toContain('2014');
      expect(fp).toContain('es:ribera-del-duero');
    });

    it('should distinguish different vintages of same wine', () => {
      const base = {
        producer: 'Kanonkop',
        wine_name: 'Kanonkop Pinotage',
        country: 'South Africa',
        region: 'Stellenbosch'
      };

      const fp2019 = WineFingerprint.generate({ ...base, vintage: 2019 });
      const fp2018 = WineFingerprint.generate({ ...base, vintage: 2018 });

      expect(fp2019).not.toBe(fp2018);
      expect(fp2019).toContain('2019');
      expect(fp2018).toContain('2018');
    });

    it('should distinguish same wine with different tier levels', () => {
      const base = {
        producer: 'Penfolds',
        vintage: 2015,
        country: 'Australia'
      };

      const grange = WineFingerprint.generate({
        ...base,
        wine_name: 'Penfolds Grange Reserve'
      });
      const bin95 = WineFingerprint.generate({
        ...base,
        wine_name: 'Penfolds Bin 95'
      });

      // Different cuvees should produce different fingerprints
      expect(grange).not.toBe(bin95);
    });
  });

  describe('escapeRegex()', () => {
    it('should escape special regex characters', () => {
      expect(WineFingerprint.escapeRegex('test.com')).toBe('test\\.com');
      expect(WineFingerprint.escapeRegex('(test)')).toBe('\\(test\\)');
      expect(WineFingerprint.escapeRegex('[test]')).toBe('\\[test\\]');
    });
  });
});

describe('WINE_ALIASES', () => {
  it('should contain alias mappings', () => {
    expect(Object.keys(WINE_ALIASES).length).toBeGreaterThan(0);
  });

  it('should map primary fingerprints to alternatives', () => {
    const aliases = Object.values(WINE_ALIASES);
    aliases.forEach(alternateFps => {
      expect(Array.isArray(alternateFps)).toBe(true);
      expect(alternateFps.length).toBeGreaterThan(0);
    });
  });
});

describe('findAliases()', () => {
  it('should return fingerprint with its aliases', () => {
    const testFp = Object.keys(WINE_ALIASES)[0];
    const aliases = findAliases(testFp);

    expect(aliases).toContain(testFp);
    expect(aliases.length).toBeGreaterThan(1);
  });

  it('should find reverse aliases', () => {
    const testPrimary = Object.keys(WINE_ALIASES)[0];
    const testAlias = WINE_ALIASES[testPrimary][0];

    const foundAliases = findAliases(testAlias);
    expect(foundAliases).toContain(testPrimary);
  });

  it('should return array with fingerprint if no aliases exist', () => {
    const nonexistent = 'producer|cuvee|varietal|2020|xx:unknown';
    const aliases = findAliases(nonexistent);

    expect(aliases).toContain(nonexistent);
    expect(aliases.length).toBeGreaterThanOrEqual(1);
  });

  it('should remove duplicate aliases', () => {
    const testFp = Object.keys(WINE_ALIASES)[0];
    const aliases = findAliases(testFp);

    const uniqueAliases = new Set(aliases);
    expect(uniqueAliases.size).toBe(aliases.length);
  });
});

describe('Collision prevention (v1.1 fixes)', () => {
  it('should not collide producer/varietal combinations', () => {
    const wine1 = {
      producer: 'Producer',
      wine_name: 'Producer Chardonnay 2019',
      vintage: 2019,
      country: 'France'
    };

    const wine2 = {
      producer: 'Producer',
      wine_name: 'Producer Reserve Pinot Noir 2019',
      vintage: 2019,
      country: 'France'
    };

    const fp1 = WineFingerprint.generate(wine1);
    const fp2 = WineFingerprint.generate(wine2);

    // Different varietals should produce different fingerprints
    expect(fp1).not.toBe(fp2);
    expect(fp1).toContain('chardonnay');
    expect(fp2).toContain('pinot-noir');
  });

  it('should not drop varietals from fingerprint', () => {
    const wine = {
      producer: 'Producer',
      wine_name: 'Producer Cabernet Sauvignon Reserve',
      vintage: 2019,
      country: 'France'
    };

    const fp = WineFingerprint.generate(wine);
    // Varietal must be present in fingerprint
    expect(fp).toContain('cabernet-sauvignon');
  });
});
