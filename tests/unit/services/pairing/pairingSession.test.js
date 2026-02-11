/**
 * @fileoverview Unit tests for pairing session service.
 * Tests session creation, wine choice recording, feedback submission, and statistics.
 */



// Mock database
const mockDb = {
  prepare: vi.fn()
};

vi.mock('../../../../src/db/index.js', () => ({
  default: mockDb
}));

// Import service after mocking
const {
  createPairingSession,
  recordWineChoice,
  recordFeedback,
  getPendingFeedbackSessions,
  findRecentSessionForWine,
  getPairingHistory,
  getPairingStats,
  linkConsumption,
  FAILURE_REASONS
} = await import('../../../../src/services/pairing/pairingSession.js');

const TEST_CELLAR_ID = 'cellar-uuid-123';

describe('PairingSession Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('FAILURE_REASONS', () => {
    it('should export valid failure reason vocabulary', () => {
      expect(Array.isArray(FAILURE_REASONS)).toBe(true);
      expect(FAILURE_REASONS.length).toBeGreaterThan(0);
      expect(FAILURE_REASONS).toContain('too_tannic');
      expect(FAILURE_REASONS).toContain('too_sweet');
      expect(FAILURE_REASONS).toContain('clashed_with_spice');
    });
  });

  describe('createPairingSession', () => {
    it('should create a new pairing session with all parameters', async () => {
      const mockStatement = {
        get: vi.fn().mockReturnValue({ id: 42 })
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const sessionId = await createPairingSession({
        cellarId: TEST_CELLAR_ID,
        dish: 'grilled salmon with lemon',
        source: 'all',
        colour: 'white',
        foodSignals: ['fish', 'acid', 'light'],
        dishAnalysis: 'Light fish with citrus notes',
        recommendations: [
          { wine_id: 10, wine_name: 'Sauvignon Blanc', rank: 1 },
          { wine_id: 20, wine_name: 'Pinot Grigio', rank: 2 }
        ]
      });

      expect(sessionId).toBe(42);
      expect(mockDb.prepare).toHaveBeenCalled();
      expect(mockStatement.get).toHaveBeenCalledWith(
        TEST_CELLAR_ID,
        'grilled salmon with lemon',
        'all',
        'white',
        JSON.stringify(['fish', 'acid', 'light']),
        'Light fish with citrus notes',
        expect.any(String) // JSON.stringify of recommendations
      );
    });

    it('should throw error on database failure', async () => {
      const mockStatement = {
        get: vi.fn().mockImplementation(() => {
          throw new Error('Database constraint error');
        })
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await expect(
        createPairingSession({
          cellarId: TEST_CELLAR_ID,
          dish: 'test',
          source: 'all',
          colour: 'red',
          foodSignals: [],
          dishAnalysis: 'test',
          recommendations: []
        })
      ).rejects.toThrow('Database constraint error');
    });
  });

  describe('recordWineChoice', () => {
    it('should record a wine choice for a pairing session', async () => {
      const mockStatement = {
        run: vi.fn()
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await recordWineChoice(42, 15, 1, TEST_CELLAR_ID);

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(mockStatement.run).toHaveBeenCalledWith(15, 1, 42, TEST_CELLAR_ID);
    });

    it('should handle rank 2 and 3', async () => {
      const mockStatement = {
        run: vi.fn()
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await recordWineChoice(42, 20, 2, TEST_CELLAR_ID);
      expect(mockStatement.run).toHaveBeenCalledWith(20, 2, 42, TEST_CELLAR_ID);

      await recordWineChoice(42, 30, 3, TEST_CELLAR_ID);
      expect(mockStatement.run).toHaveBeenCalledWith(30, 3, 42, TEST_CELLAR_ID);
    });

    it('should throw on database error', async () => {
      const mockStatement = {
        run: vi.fn().mockImplementation(() => {
          throw new Error('Foreign key constraint');
        })
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await expect(recordWineChoice(-1, 15, 1, TEST_CELLAR_ID)).rejects.toThrow();
    });
  });

  describe('linkConsumption', () => {
    it('should link a pairing session to a consumption event', async () => {
      const mockStatement = {
        run: vi.fn()
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await linkConsumption(42, 100, TEST_CELLAR_ID);

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(mockStatement.run).toHaveBeenCalledWith(100, 42, TEST_CELLAR_ID);
    });
  });

  describe('recordFeedback', () => {
    it('should record feedback with all parameters', async () => {
      const mockStatement = {
        run: vi.fn()
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await recordFeedback(42, {
        pairingFitRating: 4.5,
        wouldPairAgain: true,
        failureReasons: null,
        notes: 'Perfect match with the salmon!'
      }, TEST_CELLAR_ID);

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(mockStatement.run).toHaveBeenCalledWith(
        4.5,
        true,
        null,
        'Perfect match with the salmon!',
        42,
        TEST_CELLAR_ID
      );
    });

    it('should record feedback with failure reasons', async () => {
      const mockStatement = {
        run: vi.fn()
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await recordFeedback(42, {
        pairingFitRating: 2,
        wouldPairAgain: false,
        failureReasons: ['too_tannic', 'overwhelmed_dish'],
        notes: 'Too heavy for the dish'
      }, TEST_CELLAR_ID);

      expect(mockStatement.run).toHaveBeenCalledWith(
        2,
        false,
        JSON.stringify(['too_tannic', 'overwhelmed_dish']),
        'Too heavy for the dish',
        42,
        TEST_CELLAR_ID
      );
    });

    it('should reject rating below 1', async () => {
      await expect(
        recordFeedback(42, {
          pairingFitRating: 0.5,
          wouldPairAgain: false
        }, TEST_CELLAR_ID)
      ).rejects.toThrow('between 1 and 5');
    });

    it('should reject rating above 5', async () => {
      await expect(
        recordFeedback(42, {
          pairingFitRating: 5.5,
          wouldPairAgain: true
        }, TEST_CELLAR_ID)
      ).rejects.toThrow('between 1 and 5');
    });

    it('should reject invalid failure reasons', async () => {
      await expect(
        recordFeedback(42, {
          pairingFitRating: 2,
          wouldPairAgain: false,
          failureReasons: ['invalid_reason', 'too_tannic']
        }, TEST_CELLAR_ID)
      ).rejects.toThrow('Invalid failure reasons');
    });

    it('should accept null failure reasons', async () => {
      const mockStatement = {
        run: vi.fn()
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await recordFeedback(42, {
        pairingFitRating: 4,
        wouldPairAgain: true,
        failureReasons: null,
        notes: null
      }, TEST_CELLAR_ID);

      expect(mockStatement.run).toHaveBeenCalledWith(4, true, null, null, 42, TEST_CELLAR_ID);
    });
  });

  describe('getPendingFeedbackSessions', () => {
    it('should retrieve pending feedback sessions', async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([
          {
            id: 1,
            dish_description: 'grilled salmon',
            chosen_wine_id: 10,
            chosen_at: '2026-01-07T19:00:00Z',
            confirmed_consumed: true,
            wine_name: 'Sauvignon Blanc',
            vintage: '2021'
          }
        ])
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const sessions = await getPendingFeedbackSessions(TEST_CELLAR_ID, 2);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(1);
      expect(sessions[0].wine_name).toBe('Sauvignon Blanc');
      expect(mockStatement.all).toHaveBeenCalledWith(TEST_CELLAR_ID);
    });

    it('should handle empty results', async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([])
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const sessions = await getPendingFeedbackSessions(TEST_CELLAR_ID);

      expect(sessions).toEqual([]);
    });
  });

  describe('findRecentSessionForWine', () => {
    it('should find a recent session for a wine', async () => {
      const mockStatement = {
        get: vi.fn().mockReturnValue({
          id: 42,
          dish_description: 'salmon',
          created_at: '2026-01-07T19:00:00Z'
        })
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const session = await findRecentSessionForWine(15, TEST_CELLAR_ID, 48);

      expect(session).not.toBeNull();
      expect(session.id).toBe(42);
      expect(mockStatement.get).toHaveBeenCalledWith(TEST_CELLAR_ID, 15);
    });

    it('should return null if no matching session', async () => {
      const mockStatement = {
        get: vi.fn().mockReturnValue(null)
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const session = await findRecentSessionForWine(99, TEST_CELLAR_ID);

      expect(session).toBeNull();
    });
  });

  describe('getPairingHistory', () => {
    it('should retrieve pairing history with default options', async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([
          {
            id: 1,
            dish_description: 'salmon',
            food_signals: '["fish","acid"]',
            created_at: '2026-01-07',
            chosen_wine_id: 10,
            chosen_rank: 1,
            confirmed_consumed: true,
            pairing_fit_rating: 5,
            would_pair_again: true,
            failure_reasons: null,
            wine_name: 'Sauvignon Blanc',
            vintage: '2021',
            colour: 'white'
          }
        ])
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const history = await getPairingHistory(TEST_CELLAR_ID);

      expect(history).toHaveLength(1);
      expect(history[0].wine_name).toBe('Sauvignon Blanc');
      expect(history[0].food_signals).toEqual(['fish', 'acid']);
      expect(mockStatement.all).toHaveBeenCalledWith(TEST_CELLAR_ID, 20, 0);
    });

    it('should respect custom limit and offset', async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([])
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      await getPairingHistory(TEST_CELLAR_ID, { limit: 50, offset: 10 });

      expect(mockStatement.all).toHaveBeenCalledWith(TEST_CELLAR_ID, 50, 10);
    });

    it('should parse food_signals and failure_reasons JSON', async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([
          {
            id: 1,
            dish_description: 'steak',
            food_signals: '["beef","roasted"]',
            created_at: '2026-01-07',
            chosen_wine_id: 20,
            chosen_rank: 1,
            confirmed_consumed: false,
            pairing_fit_rating: 2,
            would_pair_again: false,
            failure_reasons: '["too_tannic"]',
            wine_name: 'Cabernet',
            vintage: '2019',
            colour: 'red'
          }
        ])
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const history = await getPairingHistory(TEST_CELLAR_ID);

      expect(history[0].food_signals).toEqual(['beef', 'roasted']);
      expect(history[0].failure_reasons).toEqual(['too_tannic']);
    });

    it('should handle null JSON fields gracefully', async () => {
      const mockStatement = {
        all: vi.fn().mockReturnValue([
          {
            id: 1,
            dish_description: 'test',
            food_signals: null,
            created_at: '2026-01-07',
            chosen_wine_id: 10,
            chosen_rank: 1,
            confirmed_consumed: false,
            pairing_fit_rating: 3,
            would_pair_again: true,
            failure_reasons: null,
            wine_name: 'Test Wine',
            vintage: null,
            colour: 'red'
          }
        ])
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const history = await getPairingHistory(TEST_CELLAR_ID);

      expect(history[0].food_signals).toEqual([]);
      expect(history[0].failure_reasons).toBeNull();
    });
  });

  describe('getPairingStats', () => {
    it('should return aggregate pairing statistics', async () => {
      const mockStatement = {
        get: vi.fn().mockReturnValue({
          total_sessions: 15,
          sessions_with_choice: 14,
          sessions_with_feedback: 10,
          avg_pairing_rating: 4.2, // numeric value from DB
          would_pair_again_count: 8,
          confirmed_consumed_count: 7
        })
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const stats = await getPairingStats(TEST_CELLAR_ID);

      expect(stats.totalSessions).toBe(15);
      expect(stats.sessionsWithChoice).toBe(14);
      expect(stats.sessionsWithFeedback).toBe(10);
      expect(stats.avgPairingRating).toBe(4.2);
      expect(stats.wouldPairAgainRate).toBe('80.0');
      expect(stats.consumptionConfirmationRate).toBe('50.0');
      expect(mockStatement.get).toHaveBeenCalledWith(TEST_CELLAR_ID);
    });

    it('should handle null average rating', async () => {
      const mockStatement = {
        get: vi.fn().mockReturnValue({
          total_sessions: 0,
          sessions_with_choice: 0,
          sessions_with_feedback: 0,
          avg_pairing_rating: null,
          would_pair_again_count: 0,
          confirmed_consumed_count: 0
        })
      };
      mockDb.prepare.mockReturnValue(mockStatement);

      const stats = await getPairingStats(TEST_CELLAR_ID);

      expect(stats.avgPairingRating).toBeNull();
      expect(stats.wouldPairAgainRate).toBeNull();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete pairing session flow', async () => {
      const createStatement = {
        get: vi.fn().mockReturnValue({ id: 100 })
      };
      const choiceStatement = {
        run: vi.fn()
      };
      const feedbackStatement = {
        run: vi.fn()
      };

      mockDb.prepare
        .mockReturnValueOnce(createStatement)
        .mockReturnValueOnce(choiceStatement)
        .mockReturnValueOnce(feedbackStatement);

      // Create session
      const sessionId = await createPairingSession({
        cellarId: TEST_CELLAR_ID,
        dish: 'pasta carbonara',
        source: 'all',
        colour: 'white',
        foodSignals: ['pasta', 'creamy'],
        dishAnalysis: 'Creamy pasta dish',
        recommendations: [{ wine_id: 10, rank: 1 }]
      });
      expect(sessionId).toBe(100);

      // Record choice
      await recordWineChoice(sessionId, 25, 1, TEST_CELLAR_ID);
      expect(choiceStatement.run).toHaveBeenCalledWith(25, 1, 100, TEST_CELLAR_ID);

      // Submit feedback
      await recordFeedback(sessionId, {
        pairingFitRating: 5,
        wouldPairAgain: true,
        failureReasons: null,
        notes: 'Perfect match!'
      }, TEST_CELLAR_ID);
      expect(feedbackStatement.run).toHaveBeenCalled();
    });

    it('should handle user rejecting a pairing', async () => {
      const feedbackStatement = {
        run: vi.fn()
      };
      mockDb.prepare.mockReturnValue(feedbackStatement);

      await recordFeedback(42, {
        pairingFitRating: 1.5,
        wouldPairAgain: false,
        failureReasons: ['too_tannic', 'clashed_with_sauce'],
        notes: 'Overpowered the delicate sauce'
      }, TEST_CELLAR_ID);

      expect(feedbackStatement.run).toHaveBeenCalledWith(
        1.5,
        false,
        JSON.stringify(['too_tannic', 'clashed_with_sauce']),
        'Overpowered the delicate sauce',
        42,
        TEST_CELLAR_ID
      );
    });
  });
});
