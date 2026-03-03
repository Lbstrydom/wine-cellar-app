/**
 * @fileoverview Unit tests for wineUpdateService.persistSearchResults.
 * Verifies all fields are persisted, COALESCE guards work, JSONB serialisation
 * is correct, and food pairings are delegated to saveFoodPairings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

vi.mock('../../../../src/services/shared/foodPairingsService.js', () => ({
  saveFoodPairings: vi.fn().mockResolvedValue(1)
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import db from '../../../../src/db/index.js';
import { saveFoodPairings } from '../../../../src/services/shared/foodPairingsService.js';
import { persistSearchResults } from '../../../../src/services/shared/wineUpdateService.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const WINE_ID = 42;
const CELLAR_ID = 'cellar-uuid-1';
const WINE = { id: WINE_ID, cellar_id: CELLAR_ID, wine_name: 'Test Wine', vintage: 2020 };

const AGGREGATES = {
  competition_index: 85,
  critics_index: 90,
  community_index: 80,
  purchase_score: 88,
  purchase_stars: 4,
  confidence_level: 'high'
};

function mockRun(changes = 1) {
  const runFn = vi.fn().mockResolvedValue({ changes });
  db.prepare.mockReturnValue({ run: runFn });
  return runFn;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('persistSearchResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. SQL structure ──────────────────────────────────────────────────────
  it('generates UPDATE wines SET with all new columns', async () => {
    mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {});

    const sql = db.prepare.mock.calls[0][0];
    expect(sql).toContain('UPDATE wines SET');
    expect(sql).toContain('style_summary');
    expect(sql).toContain('producer_description');
    expect(sql).toContain('extracted_awards');
    expect(sql).toContain('tasting_notes');
    expect(sql).toContain('tasting_notes_structured');
    expect(sql).toContain('competition_index');
    expect(sql).toContain('COALESCE');
    // Backfill columns use COALESCE(NULLIF(col, ''), ?) — never overwrites existing data
    expect(sql).toContain("COALESCE(NULLIF(producer, ''), ?)");
    expect(sql).toContain("COALESCE(NULLIF(region, ''), ?)");
    expect(sql).toContain("COALESCE(NULLIF(country, ''), ?)");
  });

  it('scopes UPDATE to correct cellar_id and wine id', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {});

    const args = runFn.mock.calls[0];
    // Last two positional params are cellarId and wineId
    expect(args[args.length - 2]).toBe(CELLAR_ID);
    expect(args[args.length - 1]).toBe(WINE_ID);
  });

  // ── 2. All aggregates passed correctly ────────────────────────────────────
  it('passes all six aggregate fields as first six parameters', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {});

    const args = runFn.mock.calls[0];
    expect(args[0]).toBe(85);  // competition_index
    expect(args[1]).toBe(90);  // critics_index
    expect(args[2]).toBe(80);  // community_index
    expect(args[3]).toBe(88);  // purchase_score
    expect(args[4]).toBe(4);   // purchase_stars
    expect(args[5]).toBe('high'); // confidence_level
  });

  // ── 3. COALESCE guards — null inputs stay null ────────────────────────────
  it('passes null for all missing extracted fields (COALESCE guards)', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {});

    const args = runFn.mock.calls[0];
    expect(args[6]).toBeNull();  // narrative
    expect(args[7]).toBeNull();  // tastingNotesJson
    expect(args[8]).toBeNull();  // styleSummary
    expect(args[9]).toBeNull();  // producerDescription
    expect(args[10]).toBeNull(); // producerName (backfill)
    expect(args[11]).toBeNull(); // producerRegion (backfill)
    expect(args[12]).toBeNull(); // producerCountry (backfill)
    expect(args[13]).toBeNull(); // extractedAwardsJson
  });

  // ── 4. JSONB serialisation ────────────────────────────────────────────────
  it('serialises tastingNotesStructured to JSON string', async () => {
    const runFn = mockRun();
    const structured = { nose: ['cherry', 'plum'], palate: ['tobacco'] };
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      tastingNotesStructured: structured
    });

    const args = runFn.mock.calls[0];
    expect(args[7]).toBe(JSON.stringify(structured));
  });

  it('passes null for tastingNotesStructured when null', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      tastingNotesStructured: null
    });
    expect(runFn.mock.calls[0][7]).toBeNull();
  });

  it('serialises awards array to JSON string', async () => {
    const runFn = mockRun();
    const awards = [{ competition: 'Michelangelo', year: 2024, award: 'Gold', wine_name: 'Test' }];
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, { awards });

    const args = runFn.mock.calls[0];
    expect(JSON.parse(args[13])).toHaveLength(1);
    expect(JSON.parse(args[13])[0].competition).toBe('Michelangelo');
  });

  it('passes null for extracted_awards when awards array is empty', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, { awards: [] });
    expect(runFn.mock.calls[0][13]).toBeNull();
  });

  // ── Producer/region/country backfill ─────────────────────────────────────
  it('passes producerInfo name/region/country as backfill params', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      producerInfo: { name: 'Kanonkop', region: 'Stellenbosch', country: 'South Africa', description: 'Estate' }
    });
    const args = runFn.mock.calls[0];
    expect(args[9]).toBe('Estate');         // producerDescription
    expect(args[10]).toBe('Kanonkop');      // producerName backfill
    expect(args[11]).toBe('Stellenbosch');  // producerRegion backfill
    expect(args[12]).toBe('South Africa');  // producerCountry backfill
  });

  it('passes null backfill values when producerInfo.name/region/country absent', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      producerInfo: { description: 'Estate only' }
    });
    const args = runFn.mock.calls[0];
    expect(args[10]).toBeNull(); // producerName
    expect(args[11]).toBeNull(); // producerRegion
    expect(args[12]).toBeNull(); // producerCountry
  });

  // ── 5. styleSummary and producerInfo ─────────────────────────────────────
  it('passes styleSummary directly', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      styleSummary: 'Bold Stellenbosch Cabernet'
    });
    expect(runFn.mock.calls[0][8]).toBe('Bold Stellenbosch Cabernet');
  });

  it('extracts description from producerInfo.description', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      producerInfo: { description: 'Famous Kanonkop estate', country: 'South Africa' }
    });
    expect(runFn.mock.calls[0][9]).toBe('Famous Kanonkop estate');
  });

  it('passes null for producerDescription when producerInfo has no description', async () => {
    const runFn = mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      producerInfo: { country: 'South Africa' }
    });
    expect(runFn.mock.calls[0][9]).toBeNull();
  });

  // ── 6. food pairings delegation ───────────────────────────────────────────
  it('calls saveFoodPairings when food pairings provided', async () => {
    mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      foodPairings: ['Lamb rack', 'Beef brisket']
    });
    expect(saveFoodPairings).toHaveBeenCalledOnce();
    expect(saveFoodPairings).toHaveBeenCalledWith(WINE_ID, CELLAR_ID, ['Lamb rack', 'Beef brisket']);
  });

  it('does not call saveFoodPairings when food pairings empty', async () => {
    mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, { foodPairings: [] });
    expect(saveFoodPairings).not.toHaveBeenCalled();
  });

  it('does not call saveFoodPairings when extractionData is null', async () => {
    mockRun();
    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, null);
    expect(saveFoodPairings).not.toHaveBeenCalled();
  });

  // ── 7. Null safety ────────────────────────────────────────────────────────
  it('handles null extractionData without throwing', async () => {
    mockRun();
    await expect(
      persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, null)
    ).resolves.not.toThrow();
  });

  it('handles undefined extractionData without throwing', async () => {
    mockRun();
    await expect(
      persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, undefined)
    ).resolves.not.toThrow();
  });

  // ── 8. Full enriched call ─────────────────────────────────────────────────
  it('passes all fields correctly in a full enriched call', async () => {
    const runFn = mockRun();
    const structured = { nose: ['cherry'] };
    const awards = [{ competition: 'Platter', year: 2023, award: '5 Stars' }];

    await persistSearchResults(WINE_ID, CELLAR_ID, WINE, AGGREGATES, {
      narrative: 'Rich and complex.',
      tastingNotesStructured: structured,
      styleSummary: 'Powerful red blend',
      producerInfo: { description: 'Top SA estate' },
      awards,
      foodPairings: ['Lamb', 'Venison']
    });

    const args = runFn.mock.calls[0];
    expect(args[6]).toBe('Rich and complex.');
    expect(args[7]).toBe(JSON.stringify(structured));
    expect(args[8]).toBe('Powerful red blend');
    expect(args[9]).toBe('Top SA estate');
    expect(args[10]).toBeNull();             // producerName backfill (not provided)
    expect(args[11]).toBeNull();             // producerRegion backfill (not provided)
    expect(args[12]).toBeNull();             // producerCountry backfill (not provided)
    expect(JSON.parse(args[13])).toHaveLength(1);
    expect(args[args.length - 2]).toBe(CELLAR_ID);
    expect(args[args.length - 1]).toBe(WINE_ID);
    expect(saveFoodPairings).toHaveBeenCalledWith(WINE_ID, CELLAR_ID, ['Lamb', 'Venison']);
  });
});
