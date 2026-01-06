/**
 * @fileoverview Validates AI responses against expected schemas.
 * Provides schema definitions and validation functions for Claude responses.
 * @module services/responseValidator
 */

/**
 * Response schemas for different AI tasks.
 * @type {Object.<string, Object>}
 */
export const SCHEMAS = {
  sommelier: {
    required: ['dish_analysis', 'recommendations'],
    properties: {
      dish_analysis: { type: 'string', minLength: 10 },
      recommendations: {
        type: 'array',
        minItems: 0,
        maxItems: 5,
        items: {
          required: ['wine_name', 'match_score', 'pairing_note'],
          properties: {
            wine_id: { type: 'number' },
            wine_name: { type: 'string', minLength: 1 },
            vintage: { type: ['number', 'string', 'null'] },
            match_score: { type: 'number', min: 0, max: 100 },
            pairing_note: { type: 'string', minLength: 10 }
          }
        }
      },
      no_match_reason: { type: 'string' }
    }
  },

  wineDetails: {
    required: ['wine_name'],
    properties: {
      wine_name: { type: 'string', minLength: 1 },
      vintage: { type: ['number', 'string', 'null'] },
      producer: { type: 'string' },
      country: { type: 'string' },
      region: { type: 'string' },
      grape: { type: 'string' },
      colour: { type: 'string', enum: ['red', 'white', 'rose', 'sparkling', 'dessert', 'fortified', 'orange'] },
      style: { type: 'string' },
      price: { type: ['number', 'string', 'null'] },
      drink_from_year: { type: ['number', 'null'] },
      drink_by_year: { type: ['number', 'null'] }
    }
  },

  ratings: {
    required: ['ratings'],
    properties: {
      ratings: {
        type: 'array',
        items: {
          required: ['source', 'score'],
          properties: {
            source: { type: 'string', minLength: 1 },
            score: { type: ['number', 'string'] },
            review_text: { type: 'string' },
            reviewer: { type: 'string' },
            review_date: { type: 'string' },
            url: { type: 'string' },
            drinking_window: {
              type: 'object',
              properties: {
                drink_from_year: { type: 'number' },
                drink_by_year: { type: 'number' },
                peak_year: { type: 'number' }
              }
            }
          }
        }
      }
    }
  },

  cellarAnalysis: {
    required: ['summary'],
    properties: {
      summary: { type: 'string', minLength: 20 },
      layoutNarrative: { type: 'string' },
      zoneHealth: {
        type: 'array',
        items: {
          required: ['zone', 'status'],
          properties: {
            zone: { type: 'string' },
            status: { type: 'string', enum: ['healthy', 'crowded', 'sparse', 'fragmented'] },
            recommendation: { type: 'string' }
          }
        }
      },
      suggestedZoneUpdates: {
        type: 'array',
        items: {
          required: ['zoneId'],
          properties: {
            zoneId: { type: 'string' },
            purpose: { type: 'string' },
            styleRange: { type: 'string' },
            pairingHints: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      fridgePlan: {
        type: 'object',
        properties: {
          toAdd: { type: 'array' },
          toRemove: { type: 'array' },
          coverageAfter: { type: 'object' }
        }
      }
    }
  },

  zoneChat: {
    required: ['response'],
    properties: {
      response: { type: 'string', minLength: 10 },
      suggestedMoves: {
        type: 'array',
        items: {
          required: ['wineId', 'toZone'],
          properties: {
            wineId: { type: 'number' },
            wineName: { type: 'string' },
            fromZone: { type: 'string' },
            toZone: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      affectedZones: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  },

  drinkRecommendations: {
    required: ['recommendations'],
    properties: {
      occasion: { type: 'string' },
      recommendations: {
        type: 'array',
        minItems: 0,
        maxItems: 5,
        items: {
          required: ['wine_id', 'reason'],
          properties: {
            wine_id: { type: 'number' },
            wine_name: { type: 'string' },
            reason: { type: 'string', minLength: 10 },
            category: { type: 'string' },
            priority: { type: 'number', min: 1, max: 5 }
          }
        }
      },
      noRecommendationReason: { type: 'string' }
    }
  },

  tastingProfile: {
    required: [],
    properties: {
      aromas: { type: 'array', items: { type: 'string' } },
      flavors: { type: 'array', items: { type: 'string' } },
      structure: {
        type: 'object',
        properties: {
          body: { type: 'string' },
          acidity: { type: 'string' },
          tannin: { type: 'string' },
          sweetness: { type: 'string' },
          alcohol: { type: 'string' }
        }
      },
      finish: { type: 'string' },
      overallImpression: { type: 'string' }
    }
  }
};

/**
 * Validate a value against a type specification.
 * @param {*} value - Value to validate
 * @param {string|string[]} type - Expected type(s)
 * @returns {boolean} Whether value matches type
 */
function validateType(value, type) {
  const types = Array.isArray(type) ? type : [type];

  for (const t of types) {
    if (t === 'null' && value === null) return true;
    if (t === 'string' && typeof value === 'string') return true;
    if (t === 'number' && typeof value === 'number' && !isNaN(value)) return true;
    if (t === 'boolean' && typeof value === 'boolean') return true;
    if (t === 'array' && Array.isArray(value)) return true;
    if (t === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
  }

  return false;
}

/**
 * Validate a value against a property schema.
 * @param {*} value - Value to validate
 * @param {Object} propSchema - Property schema
 * @param {string} path - Current path for error messages
 * @returns {Object} Validation result { valid, errors }
 */
function validateProperty(value, propSchema, path) {
  const errors = [];

  // Type check
  if (propSchema.type && !validateType(value, propSchema.type)) {
    errors.push(`${path}: expected ${propSchema.type}, got ${typeof value}`);
    return { valid: false, errors };
  }

  // String validations
  if (typeof value === 'string') {
    if (propSchema.minLength && value.length < propSchema.minLength) {
      errors.push(`${path}: string too short (min ${propSchema.minLength})`);
    }
    if (propSchema.maxLength && value.length > propSchema.maxLength) {
      errors.push(`${path}: string too long (max ${propSchema.maxLength})`);
    }
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      errors.push(`${path}: must be one of [${propSchema.enum.join(', ')}]`);
    }
  }

  // Number validations
  if (typeof value === 'number') {
    if (propSchema.min !== undefined && value < propSchema.min) {
      errors.push(`${path}: number too small (min ${propSchema.min})`);
    }
    if (propSchema.max !== undefined && value > propSchema.max) {
      errors.push(`${path}: number too large (max ${propSchema.max})`);
    }
  }

  // Array validations
  if (Array.isArray(value)) {
    if (propSchema.minItems !== undefined && value.length < propSchema.minItems) {
      errors.push(`${path}: array too short (min ${propSchema.minItems} items)`);
    }
    if (propSchema.maxItems !== undefined && value.length > propSchema.maxItems) {
      errors.push(`${path}: array too long (max ${propSchema.maxItems} items)`);
    }
    if (propSchema.items) {
      value.forEach((item, i) => {
        const itemResult = validateProperty(item, propSchema.items, `${path}[${i}]`);
        if (!itemResult.valid) errors.push(...itemResult.errors);

        // Validate required properties of array items
        if (propSchema.items.required && typeof item === 'object') {
          for (const req of propSchema.items.required) {
            if (item[req] === undefined) {
              errors.push(`${path}[${i}].${req}: required property missing`);
            }
          }
        }

        // Validate item properties
        if (propSchema.items.properties && typeof item === 'object') {
          for (const [propName, propSpec] of Object.entries(propSchema.items.properties)) {
            if (item[propName] !== undefined) {
              const propResult = validateProperty(item[propName], propSpec, `${path}[${i}].${propName}`);
              if (!propResult.valid) errors.push(...propResult.errors);
            }
          }
        }
      });
    }
  }

  // Object validations
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && propSchema.properties) {
    for (const [propName, propSpec] of Object.entries(propSchema.properties)) {
      if (value[propName] !== undefined) {
        const propResult = validateProperty(value[propName], propSpec, `${path}.${propName}`);
        if (!propResult.valid) errors.push(...propResult.errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a response against a schema.
 * @param {Object} response - Response object to validate
 * @param {string} schemaName - Name of schema to use
 * @returns {Object} Validation result { valid, errors, warnings }
 */
export function validateResponse(response, schemaName) {
  const schema = SCHEMAS[schemaName];
  if (!schema) {
    return { valid: false, errors: [`Unknown schema: ${schemaName}`], warnings: [] };
  }

  const errors = [];
  const warnings = [];

  // Check required properties
  if (schema.required) {
    for (const req of schema.required) {
      if (response[req] === undefined) {
        errors.push(`Missing required property: ${req}`);
      }
    }
  }

  // Validate properties
  if (schema.properties) {
    for (const [propName, propSpec] of Object.entries(schema.properties)) {
      if (response[propName] !== undefined) {
        const propResult = validateProperty(response[propName], propSpec, propName);
        if (!propResult.valid) {
          errors.push(...propResult.errors);
        }
      }
    }
  }

  // Warn about unexpected properties
  if (schema.properties) {
    const expectedProps = new Set(Object.keys(schema.properties));
    for (const prop of Object.keys(response)) {
      if (!expectedProps.has(prop)) {
        warnings.push(`Unexpected property: ${prop}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Parse and validate a JSON response from Claude.
 * @param {string} responseText - Raw response text
 * @param {string} schemaName - Schema to validate against
 * @returns {Object} Result { success, data, errors, raw }
 */
export function parseAndValidate(responseText, schemaName) {
  // Try to extract JSON from response
  let jsonStr = responseText;

  // Handle markdown code blocks
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                    responseText.match(/```\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Parse JSON
  let data;
  try {
    data = JSON.parse(jsonStr.trim());
  } catch (parseError) {
    return {
      success: false,
      data: null,
      errors: [`JSON parse error: ${parseError.message}`],
      raw: responseText
    };
  }

  // Validate against schema
  const validation = validateResponse(data, schemaName);

  return {
    success: validation.valid,
    data: validation.valid ? data : null,
    errors: validation.errors,
    warnings: validation.warnings,
    raw: responseText
  };
}

/**
 * Create a fallback response for a given schema.
 * @param {string} schemaName - Schema name
 * @param {string} errorReason - Reason for fallback
 * @returns {Object} Fallback response matching schema
 */
export function createFallback(schemaName, errorReason) {
  const fallbacks = {
    sommelier: {
      dish_analysis: 'Unable to process request.',
      recommendations: [],
      no_match_reason: errorReason
    },
    wineDetails: {
      wine_name: 'Unknown',
      error: errorReason
    },
    ratings: {
      ratings: [],
      error: errorReason
    },
    cellarAnalysis: {
      summary: 'Analysis unavailable.',
      error: errorReason
    },
    zoneChat: {
      response: `I apologize, but I couldn't process your request: ${errorReason}`,
      suggestedMoves: [],
      affectedZones: []
    },
    drinkRecommendations: {
      recommendations: [],
      noRecommendationReason: errorReason
    },
    tastingProfile: {
      aromas: [],
      flavors: [],
      error: errorReason
    }
  };

  return fallbacks[schemaName] || { error: errorReason };
}

/**
 * List available schemas.
 * @returns {string[]} Schema names
 */
export function listSchemas() {
  return Object.keys(SCHEMAS);
}
