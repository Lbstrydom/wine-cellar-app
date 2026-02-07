/**
 * @fileoverview Tests for wine data consistency checker.
 * Uses vitest globals (do NOT import from 'vitest').
 */

// Mock database BEFORE importing the module that uses it
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

import { checkWineConsistency, auditCellar } from '../../../src/services/consistencyChecker.js';
import { normalizeColour, normalizeGrape, parseGrapesField } from '../../../src/utils/wineNormalization.js';
import db from '../../../src/db/index.js';

describe('wineNormalization', () => {
  describe('normalizeColour', () => {
    it('normalizes rosé → rose', () => {
      expect(normalizeColour('rosé')).toBe('rose');
    });

    it('normalizes ROSÉ → rose (case-insensitive)', () => {
      expect(normalizeColour('ROSÉ')).toBe('rose');
    });

    it('normalizes rosado → rose', () => {
      expect(normalizeColour('rosado')).toBe('rose');
    });

    it('passes through valid colours', () => {
      expect(normalizeColour('red')).toBe('red');
      expect(normalizeColour('white')).toBe('white');
      expect(normalizeColour('sparkling')).toBe('sparkling');
      expect(normalizeColour('orange')).toBe('orange');
    });

    it('returns null for invalid colour', () => {
      expect(normalizeColour('purple')).toBeNull();
      expect(normalizeColour('rainbow')).toBeNull();
    });

    it('returns null for null/undefined/empty', () => {
      expect(normalizeColour(null)).toBeNull();
      expect(normalizeColour(undefined)).toBeNull();
      expect(normalizeColour('')).toBeNull();
    });
  });

  describe('normalizeGrape', () => {
    it('strips diacritics: Gewürztraminer → gewurztraminer', () => {
      expect(normalizeGrape('Gewürztraminer')).toBe('gewurztraminer');
    });

    it('resolves synonym: Shiraz → syrah', () => {
      expect(normalizeGrape('Shiraz')).toBe('syrah');
    });

    it('lowercases: MERLOT → merlot', () => {
      expect(normalizeGrape('MERLOT')).toBe('merlot');
    });

    it('trims whitespace', () => {
      expect(normalizeGrape('  Merlot  ')).toBe('merlot');
    });

    it('returns null for null/empty', () => {
      expect(normalizeGrape(null)).toBeNull();
      expect(normalizeGrape('')).toBeNull();
      expect(normalizeGrape('   ')).toBeNull();
    });
  });

  describe('parseGrapesField', () => {
    it('parses JSON array string', () => {
      expect(parseGrapesField('["Cabernet Sauvignon", "Merlot"]')).toEqual(['Cabernet Sauvignon', 'Merlot']);
    });

    it('parses actual array', () => {
      expect(parseGrapesField(['Cabernet', 'Merlot'])).toEqual(['Cabernet', 'Merlot']);
    });

    it('parses comma-separated string', () => {
      expect(parseGrapesField('Cabernet Sauvignon, Merlot')).toEqual(['Cabernet Sauvignon', 'Merlot']);
    });

    it('parses slash-separated string', () => {
      expect(parseGrapesField('Syrah/Grenache')).toEqual(['Syrah', 'Grenache']);
    });

    it('parses ampersand-separated string', () => {
      expect(parseGrapesField('Syrah & Grenache')).toEqual(['Syrah', 'Grenache']);
    });

    it('strips percentages: "60% Cabernet, 40% Merlot"', () => {
      const result = parseGrapesField('60% Cabernet, 40% Merlot');
      expect(result).toEqual(['Cabernet', 'Merlot']);
    });

    it('deduplicates grapes', () => {
      const result = parseGrapesField('Merlot, Merlot, Cabernet');
      expect(result).toEqual(['Merlot', 'Cabernet']);
    });

    it('returns empty for null/undefined/empty', () => {
      expect(parseGrapesField(null)).toEqual([]);
      expect(parseGrapesField(undefined)).toEqual([]);
      expect(parseGrapesField('')).toEqual([]);
    });

    it('handles object arrays with name property', () => {
      expect(parseGrapesField('[{"name": "Syrah"}, {"name": "Grenache"}]')).toEqual(['Syrah', 'Grenache']);
    });

    it('handles plus-separated string', () => {
      expect(parseGrapesField('Cabernet + Merlot')).toEqual(['Cabernet', 'Merlot']);
    });
  });
});

describe('checkWineConsistency', () => {
  it('returns error for Shiraz + white', () => {
    const finding = checkWineConsistency({
      id: 1,
      wine_name: 'Kleine Zalze Shiraz',
      colour: 'white',
      grapes: 'Shiraz',
    });
    expect(finding).not.toBeNull();
    expect(finding.severity).toBe('error');
    expect(finding.suggestedFix).toBe('red');
    expect(finding.issue).toBe('colour_mismatch');
  });

  it('returns null for Shiraz + red (consistent)', () => {
    const finding = checkWineConsistency({
      id: 2,
      wine_name: 'Kanonkop Shiraz',
      colour: 'red',
      grapes: 'Shiraz',
    });
    expect(finding).toBeNull();
  });

  it('returns null for Cabernet + rosé (rosé allows any grape)', () => {
    const finding = checkWineConsistency({
      id: 3,
      wine_name: 'Boschendal Rosé',
      colour: 'rose',
      grapes: 'Cabernet Sauvignon',
    });
    expect(finding).toBeNull();
  });

  it('returns null for Chardonnay + sparkling (method-type bypass)', () => {
    const finding = checkWineConsistency({
      id: 4,
      wine_name: 'Graham Beck Brut',
      colour: 'sparkling',
      grapes: 'Chardonnay',
    });
    expect(finding).toBeNull();
  });

  it('returns null for Chardonnay + orange (orange allows white grapes)', () => {
    const finding = checkWineConsistency({
      id: 5,
      wine_name: 'Testalonga Orange',
      colour: 'orange',
      grapes: 'Chardonnay',
    });
    expect(finding).toBeNull();
  });

  it('returns error for Merlot + orange (orange only allows white grapes)', () => {
    const finding = checkWineConsistency({
      id: 17,
      wine_name: 'Fake Orange Merlot',
      colour: 'orange',
      grapes: 'Merlot',
    });
    expect(finding).not.toBeNull();
    expect(finding.severity).toBe('error');
  });

  it('returns null for Champagne + white (sparkling keyword bypass)', () => {
    const finding = checkWineConsistency({
      id: 6,
      wine_name: 'Champagne Moët & Chandon',
      colour: 'white',
      grapes: 'Pinot Noir, Chardonnay',
    });
    expect(finding).toBeNull();
  });

  it('returns null for Blanc de Noirs + white (exception match)', () => {
    const finding = checkWineConsistency({
      id: 7,
      wine_name: 'Blanc de Noirs Brut 2019',
      colour: 'white',
      grapes: 'Pinot Noir',
    });
    expect(finding).toBeNull();
  });

  it('returns warning for mixed blend with partial mismatch', () => {
    const finding = checkWineConsistency({
      id: 8,
      wine_name: 'Test Blend',
      colour: 'white',
      grapes: 'Chardonnay, Merlot',
    });
    expect(finding).not.toBeNull();
    expect(finding.severity).toBe('warning');
    expect(finding.details.mismatches.length).toBe(1);
  });

  it('returns info for all unknown grapes', () => {
    const finding = checkWineConsistency({
      id: 9,
      wine_name: 'Mystery Wine',
      colour: 'red',
      grapes: 'Unicorn Grape, Dragon Berry',
    });
    expect(finding).not.toBeNull();
    expect(finding.severity).toBe('info');
    expect(finding.issue).toBe('unknown_grapes');
  });

  it('returns null for no grapes', () => {
    const finding = checkWineConsistency({
      id: 10,
      wine_name: 'No Grapes Wine',
      colour: 'red',
      grapes: null,
    });
    expect(finding).toBeNull();
  });

  it('returns null for no colour', () => {
    const finding = checkWineConsistency({
      id: 11,
      wine_name: 'No Colour Wine',
      colour: null,
      grapes: 'Merlot',
    });
    expect(finding).toBeNull();
  });

  it('returns null for dessert colour (method-type bypass)', () => {
    const finding = checkWineConsistency({
      id: 12,
      wine_name: 'Sauternes',
      colour: 'dessert',
      grapes: 'Semillon',
    });
    expect(finding).toBeNull();
  });

  it('returns null for fortified colour (method-type bypass)', () => {
    const finding = checkWineConsistency({
      id: 13,
      wine_name: 'Port',
      colour: 'fortified',
      grapes: 'Touriga Nacional',
    });
    expect(finding).toBeNull();
  });

  it('returns null for Port keyword + red (method keyword bypass)', () => {
    const finding = checkWineConsistency({
      id: 14,
      wine_name: 'Graham Porto Vintage',
      colour: 'red',
      grapes: 'Touriga Nacional',
    });
    expect(finding).toBeNull();
  });

  it('never throws — bad input returns null, never exception', () => {
    expect(checkWineConsistency(null)).toBeNull();
    expect(checkWineConsistency(undefined)).toBeNull();
    expect(checkWineConsistency({})).toBeNull();
    expect(checkWineConsistency({ colour: 123, grapes: 456 })).toBeNull();
    expect(checkWineConsistency({ colour: 'red', grapes: { bad: 'object' } })).toBeNull();
  });

  it('handles empty grapes string', () => {
    const finding = checkWineConsistency({
      id: 15,
      wine_name: 'Empty Grapes',
      colour: 'red',
      grapes: '',
    });
    expect(finding).toBeNull();
  });

  it('returns correct finding structure', () => {
    const finding = checkWineConsistency({
      id: 99,
      wine_name: 'Test Wine',
      vintage: 2020,
      colour: 'white',
      grapes: 'Shiraz',
    });
    expect(finding).toMatchObject({
      wineId: 99,
      wineName: 'Test Wine',
      vintage: 2020,
      issue: 'colour_mismatch',
      severity: 'error',
      suggestedFix: 'red',
    });
    expect(finding.details).toHaveProperty('mismatches');
    expect(finding.details).toHaveProperty('unknownGrapes');
    expect(finding.details).toHaveProperty('currentColour', 'white');
    expect(finding.details).toHaveProperty('suggestedColour', 'red');
    expect(typeof finding.message).toBe('string');
  });

  it('returns null for skin contact wine (exception)', () => {
    const finding = checkWineConsistency({
      id: 16,
      wine_name: 'Pinot Grigio Skin Contact',
      colour: 'white',
      grapes: 'Pinot Grigio',
    });
    expect(finding).toBeNull();
  });
});

describe('auditCellar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockWines = [
    { id: 1, wine_name: 'Good Red', vintage: 2020, colour: 'red', grapes: 'Merlot', style: null },
    { id: 2, wine_name: 'Bad White', vintage: 2021, colour: 'white', grapes: 'Shiraz', style: null },
    { id: 3, wine_name: 'No Grapes', vintage: 2022, colour: 'red', grapes: null, style: null },
    { id: 4, wine_name: 'Empty Grapes', vintage: 2023, colour: 'red', grapes: '', style: null },
    { id: 5, wine_name: 'Mystery', vintage: 2024, colour: 'red', grapes: 'Unicorn Berry', style: null },
  ];

  function setupMock(wines) {
    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue(wines)
    });
  }

  it('returns correct summary with totalWines, checked, and skippedNoGrapes', async () => {
    setupMock(mockWines);
    const result = await auditCellar(1);

    expect(result.summary.totalWines).toBe(5);
    expect(result.summary.skippedNoGrapes).toBe(2); // null + empty
    expect(result.summary.checked).toBe(3); // 5 - 2
  });

  it('finds errors and populates counts', async () => {
    setupMock(mockWines);
    const result = await auditCellar(1, { includeUnknown: true });

    expect(result.summary.errors).toBe(1); // Shiraz+white
    expect(result.summary.issuesFound).toBeGreaterThanOrEqual(1);
  });

  it('excludes unknown grape findings by default', async () => {
    setupMock(mockWines);
    const result = await auditCellar(1, { includeUnknown: false });

    const unknownFindings = result.data.filter(f => f.issue === 'unknown_grapes');
    expect(unknownFindings.length).toBe(0);
  });

  it('includes unknown grape findings when includeUnknown=true', async () => {
    setupMock(mockWines);
    const result = await auditCellar(1, { includeUnknown: true });

    const unknownFindings = result.data.filter(f => f.issue === 'unknown_grapes');
    expect(unknownFindings.length).toBe(1);
  });

  it('tracks unknownGrapeCount in summary even when excluding unknowns', async () => {
    setupMock(mockWines);
    const result = await auditCellar(1, { includeUnknown: false });

    expect(result.summary.unknownGrapeCount).toBeGreaterThanOrEqual(1);
  });

  it('filters by severity', async () => {
    setupMock(mockWines);
    const result = await auditCellar(1, { severity: 'error', includeUnknown: true });

    for (const finding of result.data) {
      expect(finding.severity).toBe('error');
    }
  });

  it('paginates results', async () => {
    setupMock(mockWines);
    const result = await auditCellar(1, { limit: 1, offset: 0, includeUnknown: true });

    expect(result.data.length).toBeLessThanOrEqual(1);
    expect(result.pagination.limit).toBe(1);
    expect(result.pagination.offset).toBe(0);
    expect(result.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('scopes query by cellarId', async () => {
    setupMock([]);
    await auditCellar(42);

    expect(db.prepare).toHaveBeenCalled();
    const prepareCall = db.prepare.mock.calls[0][0];
    expect(prepareCall).toContain('cellar_id');
  });
});
