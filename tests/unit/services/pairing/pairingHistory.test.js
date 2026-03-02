/**
 * @fileoverview Unit tests for getRelevantPairingHistory.
 * Verifies correct SQL projection, JSON parsing of failure_reasons, and limit behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/db/index.js', () => ({
  default: { prepare: vi.fn() }
}));

import db from '../../../../src/db/index.js';
import { getRelevantPairingHistory } from '../../../../src/services/pairing/pairingSession.js';

const CELLAR_ID = 'cellar-uuid-history-test';

describe('getRelevantPairingHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns mapped rows with parsed failure_reasons', async () => {
    const rows = [
      {
        dish_description: 'grilled salmon',
        pairing_fit_rating: 5,
        would_pair_again: true,
        failure_reasons: null,
        wine_name: 'Meerlust Chardonnay',
        vintage: 2021,
        colour: 'white',
        style: 'full_white'
      },
      {
        dish_description: 'beef stew',
        pairing_fit_rating: 2,
        would_pair_again: false,
        failure_reasons: '["too_light","underwhelmed_dish"]',
        wine_name: 'Rustenberg Sauvignon Blanc',
        vintage: 2022,
        colour: 'white',
        style: 'crisp_white'
      }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(rows) });

    const result = await getRelevantPairingHistory(CELLAR_ID, 5);

    expect(result).toHaveLength(2);
    expect(result[0].failure_reasons).toBeNull();
    expect(result[1].failure_reasons).toEqual(['too_light', 'underwhelmed_dish']);
    expect(result[0].wine_name).toBe('Meerlust Chardonnay');
  });

  it('passes cellarId and limit to the query', async () => {
    const allMock = vi.fn().mockResolvedValue([]);
    db.prepare.mockReturnValue({ all: allMock });

    await getRelevantPairingHistory(CELLAR_ID, 3);

    expect(allMock).toHaveBeenCalledWith(CELLAR_ID, 3);
  });

  it('defaults limit to 5', async () => {
    const allMock = vi.fn().mockResolvedValue([]);
    db.prepare.mockReturnValue({ all: allMock });

    await getRelevantPairingHistory(CELLAR_ID);

    expect(allMock).toHaveBeenCalledWith(CELLAR_ID, 5);
  });

  it('returns empty array when no feedback exists', async () => {
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue([]) });

    const result = await getRelevantPairingHistory(CELLAR_ID);

    expect(result).toEqual([]);
  });
});
