/**
 * @fileoverview Zod validation middleware for request validation.
 * @module middleware/validate
 */

import { ZodError } from 'zod';

/**
 * Validation middleware factory.
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @param {'body' | 'query' | 'params'} source - Request property to validate
 * @returns {Function} Express middleware
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const data = req[source];
      const validated = schema.parse(data);
      // Express 5: req.query is getter-only and may be frozen
      // Store validated data in req.validated for reliable access
      req.validated = req.validated || {};
      req.validated[source] = validated;
      // Also try to update req[source] for backwards compatibility
      if (source !== 'query') {
        req[source] = validated;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code
        }));

        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: issues
          }
        });
      }
      next(error);
    }
  };
}

/**
 * Validate request body.
 * @param {import('zod').ZodSchema} schema
 * @returns {Function} Express middleware
 */
export function validateBody(schema) {
  return validate(schema, 'body');
}

/**
 * Validate query parameters.
 * @param {import('zod').ZodSchema} schema
 * @returns {Function} Express middleware
 */
export function validateQuery(schema) {
  return validate(schema, 'query');
}

/**
 * Validate route parameters.
 * @param {import('zod').ZodSchema} schema
 * @returns {Function} Express middleware
 */
export function validateParams(schema) {
  return validate(schema, 'params');
}

export default { validate, validateBody, validateQuery, validateParams };
