/**
 * @fileoverview AI model configuration for Claude API calls.
 * Allows environment-based model selection and defines model capabilities.
 * @module config/aiModels
 */

import logger from '../utils/logger.js';

/**
 * Available Claude models with their characteristics.
 * @internal — exported for unit tests only
 * @type {Object.<string, Object>}
 */
export const MODELS = {
  'claude-opus-4-6': {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    maxTokens: 128000,
    costTier: 'premium',
    capabilities: ['complex', 'awards', 'analysis', 'high-accuracy', 'planning', 'thinking'],
    description: 'Most capable model with adaptive thinking for complex reasoning'
  },
  'claude-opus-4-5-20251101': {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    maxTokens: 32000,
    costTier: 'premium',
    capabilities: ['complex', 'awards', 'analysis', 'high-accuracy', 'planning'],
    description: 'Previous generation Opus for complex planning and extraction'
  },
  'claude-sonnet-4-5-20250929': {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    maxTokens: 8192,
    costTier: 'standard',
    capabilities: ['fast', 'general', 'pairing', 'parsing'],
    description: 'Fast and capable for most tasks'
  },
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    maxTokens: 8192,
    costTier: 'economy',
    capabilities: ['fast', 'simple', 'classification'],
    description: 'Fast and economical for simple tasks'
  }
};

/**
 * Task-to-model mapping for automatic selection.
 * @internal — exported for unit tests only
 * @type {Object.<string, string>}
 */
export const TASK_MODELS = {
  // Conversational tasks use Sonnet 4.5
  sommelier: 'claude-sonnet-4-5-20250929',
  parsing: 'claude-sonnet-4-5-20250929',
  ratings: 'claude-sonnet-4-5-20250929',
  zoneChat: 'claude-sonnet-4-5-20250929',
  drinkRecommendations: 'claude-sonnet-4-5-20250929',
  tastingExtraction: 'claude-sonnet-4-5-20250929',

  // Restaurant pairing tasks use Sonnet 4.5
  menuParsing: 'claude-sonnet-4-5-20250929',
  restaurantPairing: 'claude-sonnet-4-5-20250929',

  // Cellar analysis uses Sonnet — classification + review, not deep planning
  cellarAnalysis: 'claude-sonnet-4-5-20250929',
  zoneCapacityAdvice: 'claude-opus-4-6',
  // Reconfiguration uses Sonnet — primary planning is done by algorithmic solver
  zoneReconfigurationPlan: 'claude-sonnet-4-5-20250929',

  // Complex extraction tasks use Opus 4.6 with adaptive thinking
  awardExtraction: 'claude-opus-4-6',

  // Simple classification tasks use Haiku 4.5
  wineClassification: 'claude-haiku-4-5-20251001',
  simpleValidation: 'claude-haiku-4-5-20251001'
};

// Startup validation: every TASK_MODELS value must reference a key in MODELS
for (const [task, modelId] of Object.entries(TASK_MODELS)) {
  if (!MODELS[modelId]) {
    throw new Error(`TASK_MODELS["${task}"] references unknown model "${modelId}"`);
  }
}

/**
 * Valid effort levels for adaptive thinking.
 * @type {Set<string>}
 */
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'max']);

/**
 * Task-to-thinking-effort mapping.
 * Only tasks that benefit from extended thinking are listed.
 * @internal — exported for unit tests only
 * @type {Object.<string, string>}
 */
export const TASK_THINKING = {
  zoneReconfigurationPlan: 'low',
  zoneCapacityAdvice: 'medium',
  awardExtraction: 'medium'
};

// Startup validation: every TASK_THINKING key must exist in TASK_MODELS
// and effort must be a valid level
for (const [task, effort] of Object.entries(TASK_THINKING)) {
  if (!TASK_MODELS[task]) {
    throw new Error(`TASK_THINKING["${task}"] has no corresponding TASK_MODELS entry`);
  }
  if (!VALID_EFFORTS.has(effort)) {
    throw new Error(`TASK_THINKING["${task}"] has invalid effort "${effort}"`);
  }
}

/**
 * Get model ID for a specific task.
 * Checks environment override first, then falls back to task mapping.
 * @param {string} task - Task identifier (e.g., 'sommelier', 'parsing')
 * @returns {string} Model ID to use
 */
export function getModelForTask(task) {
  // Check for environment override
  const envModel = process.env.CLAUDE_MODEL;
  if (envModel) {
    if (MODELS[envModel]) {
      return envModel;
    }
    logger.warn('AIModels', `CLAUDE_MODEL="${envModel}" is not a known model, ignoring`);
  }

  // Check for task-specific environment override
  const taskEnvKey = `CLAUDE_MODEL_${task.toUpperCase()}`;
  const taskEnvModel = process.env[taskEnvKey];
  if (taskEnvModel) {
    if (MODELS[taskEnvModel]) {
      return taskEnvModel;
    }
    logger.warn('AIModels', `${taskEnvKey}="${taskEnvModel}" is not a known model, ignoring`);
  }

  // Use task mapping or default to Sonnet
  return TASK_MODELS[task] || 'claude-sonnet-4-5-20250929';
}

/**
 * Get thinking configuration for a task.
 * Returns adaptive thinking params for tasks that benefit from extended thinking,
 * or null for tasks that don't need it.
 *
 * The return value is a flat object meant to be spread directly into
 * anthropic.messages.create() params.
 *
 * Note: output_config spread may conflict if a caller ever sets
 * output_config.format — currently none of the affected callers do.
 *
 * @param {string} task - Task identifier
 * @returns {{ thinking: {type: string}, output_config: {effort: string} } | null}
 */
export function getThinkingConfig(task) {
  const effort = TASK_THINKING[task];
  if (!effort) return null;

  return {
    thinking: { type: 'adaptive' },
    output_config: { effort }
  };
}

/**
 * Get model configuration.
 * @internal — exported for unit tests only
 * @param {string} modelId - Model identifier
 * @returns {Object|null} Model configuration or null if not found
 */
export function getModelConfig(modelId) {
  return MODELS[modelId] || null;
}

/**
 * Get max tokens for a model.
 * @param {string} modelId - Model identifier
 * @returns {number} Maximum tokens (defaults to 8192)
 */
export function getMaxTokens(modelId) {
  const model = MODELS[modelId];
  return model?.maxTokens || 8192;
}

/**
 * Check if a model has a specific capability.
 * @internal — exported for unit tests only
 * @param {string} modelId - Model identifier
 * @param {string} capability - Capability to check
 * @returns {boolean} Whether model has capability
 */
export function hasCapability(modelId, capability) {
  const model = MODELS[modelId];
  return model?.capabilities?.includes(capability) || false;
}

/**
 * List all available models.
 * @internal — exported for unit tests only
 * @returns {Array} Array of model configs
 */
export function listModels() {
  return Object.values(MODELS);
}

/**
 * Get models suitable for a capability.
 * @internal — exported for unit tests only
 * @param {string} capability - Required capability
 * @returns {Array} Array of suitable model IDs
 */
export function getModelsWithCapability(capability) {
  return Object.entries(MODELS)
    .filter(([_, config]) => config.capabilities.includes(capability))
    .map(([id]) => id);
}
