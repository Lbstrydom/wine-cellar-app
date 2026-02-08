/**
 * @fileoverview Unit tests for AI model configuration.
 * Tests task-to-model mapping, env overrides, and startup validation.
 */

// Mock the logger before importing the module under test
vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

import {
  MODELS,
  TASK_MODELS,
  getModelForTask,
  getModelConfig,
  getMaxTokens,
  hasCapability,
  listModels,
  getModelsWithCapability
} from '../../../src/config/aiModels.js';

import logger from '../../../src/utils/logger.js';

describe('aiModels', () => {

  describe('MODELS registry', () => {
    it('should contain Opus, Sonnet, and Haiku', () => {
      const names = Object.values(MODELS).map(m => m.name);
      expect(names).toContain('Claude Opus 4.5');
      expect(names).toContain('Claude Sonnet 4.5');
      expect(names).toContain('Claude Haiku 4.5');
    });

    it('should have id matching its key for every model', () => {
      for (const [key, config] of Object.entries(MODELS)) {
        expect(config.id).toBe(key);
      }
    });

    it('should define maxTokens, costTier, and capabilities for every model', () => {
      for (const config of Object.values(MODELS)) {
        expect(config.maxTokens).toBeGreaterThan(0);
        expect(typeof config.costTier).toBe('string');
        expect(Array.isArray(config.capabilities)).toBe(true);
        expect(config.capabilities.length).toBeGreaterThan(0);
      }
    });
  });

  describe('TASK_MODELS mapping', () => {
    it('should map every task to a model that exists in MODELS', () => {
      for (const [task, modelId] of Object.entries(TASK_MODELS)) {
        expect(MODELS[modelId], `TASK_MODELS["${task}"] → "${modelId}" not in MODELS`).toBeDefined();
      }
    });

    it('should include menuParsing and restaurantPairing tasks', () => {
      expect(TASK_MODELS.menuParsing).toBeDefined();
      expect(TASK_MODELS.restaurantPairing).toBeDefined();
    });

    it('should map all known tasks', () => {
      const expectedTasks = [
        'sommelier', 'parsing', 'ratings', 'zoneChat',
        'drinkRecommendations', 'tastingExtraction',
        'menuParsing', 'restaurantPairing',
        'cellarAnalysis', 'zoneCapacityAdvice', 'zoneReconfigurationPlan',
        'awardExtraction',
        'wineClassification', 'simpleValidation'
      ];
      for (const task of expectedTasks) {
        expect(TASK_MODELS[task], `Missing task: ${task}`).toBeDefined();
      }
    });
  });

  describe('getModelForTask()', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      vi.clearAllMocks();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return mapped model for known tasks', () => {
      expect(getModelForTask('menuParsing')).toBe('claude-sonnet-4-5-20250929');
      expect(getModelForTask('cellarAnalysis')).toBe('claude-opus-4-5-20251101');
      expect(getModelForTask('wineClassification')).toBe('claude-haiku-4-5-20251001');
    });

    it('should default to Sonnet for unknown tasks', () => {
      expect(getModelForTask('nonexistentTask')).toBe('claude-sonnet-4-5-20250929');
    });

    it('should respect CLAUDE_MODEL global override', () => {
      process.env.CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
      expect(getModelForTask('cellarAnalysis')).toBe('claude-haiku-4-5-20251001');
    });

    it('should respect task-specific env override', () => {
      process.env.CLAUDE_MODEL_MENUPARSING = 'claude-opus-4-5-20251101';
      expect(getModelForTask('menuParsing')).toBe('claude-opus-4-5-20251101');
    });

    it('should ignore invalid CLAUDE_MODEL and fall back to task mapping', () => {
      process.env.CLAUDE_MODEL = 'claude-nonexistent-model';
      expect(getModelForTask('menuParsing')).toBe('claude-sonnet-4-5-20250929');
    });

    it('should warn when CLAUDE_MODEL is invalid', () => {
      process.env.CLAUDE_MODEL = 'claude-nonexistent-model';
      getModelForTask('menuParsing');
      expect(logger.warn).toHaveBeenCalledWith(
        'AIModels',
        expect.stringContaining('claude-nonexistent-model')
      );
    });

    it('should ignore invalid task-specific override and fall back to task mapping', () => {
      process.env.CLAUDE_MODEL_MENUPARSING = 'bad-model-id';
      expect(getModelForTask('menuParsing')).toBe('claude-sonnet-4-5-20250929');
    });

    it('should warn when task-specific override is invalid', () => {
      process.env.CLAUDE_MODEL_MENUPARSING = 'bad-model-id';
      getModelForTask('menuParsing');
      expect(logger.warn).toHaveBeenCalledWith(
        'AIModels',
        expect.stringContaining('CLAUDE_MODEL_MENUPARSING')
      );
    });

    it('should prefer global override over task-specific override', () => {
      process.env.CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
      process.env.CLAUDE_MODEL_MENUPARSING = 'claude-opus-4-5-20251101';
      expect(getModelForTask('menuParsing')).toBe('claude-haiku-4-5-20251001');
    });

    it('should not warn when env overrides are valid', () => {
      process.env.CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
      getModelForTask('menuParsing');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('getModelConfig()', () => {
    it('should return config for known model', () => {
      const config = getModelConfig('claude-sonnet-4-5-20250929');
      expect(config).toBeDefined();
      expect(config.name).toBe('Claude Sonnet 4.5');
    });

    it('should return null for unknown model', () => {
      expect(getModelConfig('nonexistent')).toBeNull();
    });
  });

  describe('getMaxTokens()', () => {
    it('should return correct max tokens for Opus', () => {
      expect(getMaxTokens('claude-opus-4-5-20251101')).toBe(32000);
    });

    it('should return correct max tokens for Sonnet', () => {
      expect(getMaxTokens('claude-sonnet-4-5-20250929')).toBe(8192);
    });

    it('should default to 8192 for unknown model', () => {
      expect(getMaxTokens('nonexistent')).toBe(8192);
    });
  });

  describe('hasCapability()', () => {
    it('should return true for existing capability', () => {
      expect(hasCapability('claude-opus-4-5-20251101', 'complex')).toBe(true);
      expect(hasCapability('claude-sonnet-4-5-20250929', 'pairing')).toBe(true);
    });

    it('should return false for missing capability', () => {
      expect(hasCapability('claude-haiku-4-5-20251001', 'complex')).toBe(false);
    });

    it('should return false for unknown model', () => {
      expect(hasCapability('nonexistent', 'fast')).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('should return all model configs', () => {
      const models = listModels();
      expect(models.length).toBe(Object.keys(MODELS).length);
    });
  });

  describe('getModelsWithCapability()', () => {
    it('should return models with requested capability', () => {
      const fastModels = getModelsWithCapability('fast');
      expect(fastModels).toContain('claude-sonnet-4-5-20250929');
      expect(fastModels).toContain('claude-haiku-4-5-20251001');
      expect(fastModels).not.toContain('claude-opus-4-5-20251101');
    });

    it('should return empty array for nonexistent capability', () => {
      expect(getModelsWithCapability('teleportation')).toEqual([]);
    });
  });
});
