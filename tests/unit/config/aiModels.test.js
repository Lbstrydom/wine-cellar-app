/**
 * @fileoverview Unit tests for AI model configuration.
 * Tests task-to-model mapping, env overrides, thinking config, and startup validation.
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
  TASK_THINKING,
  getModelForTask,
  getModelConfig,
  getMaxTokens,
  getThinkingConfig,
  hasCapability,
  listModels,
  getModelsWithCapability
} from '../../../src/config/aiModels.js';

import logger from '../../../src/utils/logger.js';

describe('aiModels', () => {

  describe('MODELS registry', () => {
    it('should contain Opus 4.6, Opus 4.5, Sonnet, and Haiku', () => {
      const names = Object.values(MODELS).map(m => m.name);
      expect(names).toContain('Claude Opus 4.6');
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

    it('should have thinking capability only on Opus 4.6', () => {
      expect(hasCapability('claude-opus-4-6', 'thinking')).toBe(true);
      expect(hasCapability('claude-opus-4-5-20251101', 'thinking')).toBe(false);
      expect(hasCapability('claude-sonnet-4-5-20250929', 'thinking')).toBe(false);
      expect(hasCapability('claude-haiku-4-5-20251001', 'thinking')).toBe(false);
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

    it('should map complex tasks to Opus 4.6', () => {
      expect(TASK_MODELS.zoneCapacityAdvice).toBe('claude-opus-4-6');
      expect(TASK_MODELS.awardExtraction).toBe('claude-opus-4-6');
    });

    it('should map cellarAnalysis to Sonnet (classification, not deep planning)', () => {
      expect(TASK_MODELS.cellarAnalysis).toBe('claude-sonnet-4-5-20250929');
    });

    it('should map zoneReconfigurationPlan to Sonnet (solver handles primary planning)', () => {
      expect(TASK_MODELS.zoneReconfigurationPlan).toBe('claude-sonnet-4-5-20250929');
    });

    it('should map conversational tasks to Sonnet 4.5', () => {
      expect(TASK_MODELS.sommelier).toBe('claude-sonnet-4-5-20250929');
      expect(TASK_MODELS.menuParsing).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('TASK_THINKING mapping', () => {
    it('should only map tasks that exist in TASK_MODELS', () => {
      for (const task of Object.keys(TASK_THINKING)) {
        expect(TASK_MODELS[task], `TASK_THINKING["${task}"] has no corresponding TASK_MODELS entry`).toBeDefined();
      }
    });

    it('should use valid effort levels', () => {
      const validEfforts = ['low', 'medium', 'high', 'max'];
      for (const [task, effort] of Object.entries(TASK_THINKING)) {
        expect(validEfforts, `Invalid effort "${effort}" for task "${task}"`).toContain(effort);
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
      expect(getModelForTask('cellarAnalysis')).toBe('claude-sonnet-4-5-20250929');
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

  describe('getThinkingConfig()', () => {
    it('should return null for cellarAnalysis (no thinking for classification)', () => {
      expect(getThinkingConfig('cellarAnalysis')).toBeNull();
    });

    it('should return adaptive thinking with low effort for zoneReconfigurationPlan (solver handles primary planning)', () => {
      expect(getThinkingConfig('zoneReconfigurationPlan')).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' }
      });
    });

    it('should return adaptive thinking with medium effort for zoneCapacityAdvice', () => {
      expect(getThinkingConfig('zoneCapacityAdvice')).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' }
      });
    });

    it('should return adaptive thinking with medium effort for awardExtraction', () => {
      expect(getThinkingConfig('awardExtraction')).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' }
      });
    });

    it('should return null for tasks without thinking', () => {
      expect(getThinkingConfig('sommelier')).toBeNull();
      expect(getThinkingConfig('menuParsing')).toBeNull();
      expect(getThinkingConfig('wineClassification')).toBeNull();
      expect(getThinkingConfig('ratings')).toBeNull();
    });

    it('should return null for unknown tasks', () => {
      expect(getThinkingConfig('nonexistentTask')).toBeNull();
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
    it('should return correct max tokens for Opus 4.6', () => {
      expect(getMaxTokens('claude-opus-4-6')).toBe(128000);
    });

    it('should return correct max tokens for Opus 4.5', () => {
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
      expect(hasCapability('claude-opus-4-6', 'complex')).toBe(true);
      expect(hasCapability('claude-opus-4-6', 'thinking')).toBe(true);
      expect(hasCapability('claude-sonnet-4-5-20250929', 'pairing')).toBe(true);
    });

    it('should return false for missing capability', () => {
      expect(hasCapability('claude-haiku-4-5-20251001', 'complex')).toBe(false);
      expect(hasCapability('claude-opus-4-5-20251101', 'thinking')).toBe(false);
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
      expect(fastModels).not.toContain('claude-opus-4-6');
    });

    it('should return models with thinking capability', () => {
      const thinkingModels = getModelsWithCapability('thinking');
      expect(thinkingModels).toEqual(['claude-opus-4-6']);
    });

    it('should return empty array for nonexistent capability', () => {
      expect(getModelsWithCapability('teleportation')).toEqual([]);
    });
  });
});
