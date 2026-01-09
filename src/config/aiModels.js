/**
 * @fileoverview AI model configuration for Claude API calls.
 * Allows environment-based model selection and defines model capabilities.
 * @module config/aiModels
 */

/**
 * Available Claude models with their characteristics.
 * @type {Object.<string, Object>}
 */
export const MODELS = {
  'claude-opus-4-5-20251101': {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    maxTokens: 32000,
    costTier: 'premium',
    capabilities: ['complex', 'awards', 'analysis', 'high-accuracy', 'planning'],
    description: 'Most capable model for complex planning and extraction'
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

  // Complex planning tasks use Opus 4.5 (with GPT-5.2 review)
  cellarAnalysis: 'claude-opus-4-5-20251101',
  zoneCapacityAdvice: 'claude-opus-4-5-20251101',
  zoneReconfigurationPlan: 'claude-opus-4-5-20251101',

  // Complex extraction tasks use Opus 4.5
  awardExtraction: 'claude-opus-4-5-20251101',

  // Simple classification tasks use Haiku 4.5
  wineClassification: 'claude-haiku-4-5-20251001',
  simpleValidation: 'claude-haiku-4-5-20251001'
};

/**
 * Get model ID for a specific task.
 * Checks environment override first, then falls back to task mapping.
 * @param {string} task - Task identifier (e.g., 'sommelier', 'parsing')
 * @returns {string} Model ID to use
 */
export function getModelForTask(task) {
  // Check for environment override
  const envModel = process.env.CLAUDE_MODEL;
  if (envModel && MODELS[envModel]) {
    return envModel;
  }

  // Check for task-specific environment override
  const taskEnvKey = `CLAUDE_MODEL_${task.toUpperCase()}`;
  const taskEnvModel = process.env[taskEnvKey];
  if (taskEnvModel && MODELS[taskEnvModel]) {
    return taskEnvModel;
  }

  // Use task mapping or default to Sonnet
  return TASK_MODELS[task] || 'claude-sonnet-4-5-20250929';
}

/**
 * Get model configuration.
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
 * @returns {Array} Array of model configs
 */
export function listModels() {
  return Object.values(MODELS);
}

/**
 * Get models suitable for a capability.
 * @param {string} capability - Required capability
 * @returns {Array} Array of suitable model IDs
 */
export function getModelsWithCapability(capability) {
  return Object.entries(MODELS)
    .filter(([_, config]) => config.capabilities.includes(capability))
    .map(([id]) => id);
}
