/**
 * @fileoverview Standardized error handling utilities.
 * @module utils/errorResponse
 */

import logger from './logger.js';

/**
 * Standard error codes.
 * @readonly
 * @enum {string}
 */
export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  BAD_REQUEST: 'BAD_REQUEST',
  RATE_LIMITED: 'RATE_LIMITED'
};

/**
 * HTTP status codes for each error code.
 * @readonly
 */
const StatusCodes = {
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.INTERNAL_ERROR]: 500,
  [ErrorCodes.SERVICE_UNAVAILABLE]: 503,
  [ErrorCodes.BAD_REQUEST]: 400,
  [ErrorCodes.RATE_LIMITED]: 429
};

/**
 * Application error class with standardized properties.
 */
export class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {string} code - Error code from ErrorCodes enum
   * @param {Object} details - Additional error details
   */
  constructor(message, code = ErrorCodes.INTERNAL_ERROR, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = StatusCodes[code] || 500;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Create a NOT_FOUND error.
   * @param {string} resource - Resource type (e.g., 'Wine', 'Slot')
   * @param {string|number} id - Resource identifier
   */
  static notFound(resource, id = null) {
    const message = id ? `${resource} ${id} not found` : `${resource} not found`;
    return new AppError(message, ErrorCodes.NOT_FOUND);
  }

  /**
   * Create a VALIDATION_ERROR.
   * @param {string} message - Validation error message
   * @param {Array} details - Validation error details
   */
  static validation(message, details = null) {
    return new AppError(message, ErrorCodes.VALIDATION_ERROR, details);
  }

  /**
   * Create a CONFLICT error.
   * @param {string} message - Conflict description
   */
  static conflict(message) {
    return new AppError(message, ErrorCodes.CONFLICT);
  }

  /**
   * Create a SERVICE_UNAVAILABLE error.
   * @param {string} service - Service name
   */
  static serviceUnavailable(service) {
    return new AppError(`${service} is not available`, ErrorCodes.SERVICE_UNAVAILABLE);
  }

  /**
   * Create a BAD_REQUEST error.
   * @param {string} message - Error message
   */
  static badRequest(message) {
    return new AppError(message, ErrorCodes.BAD_REQUEST);
  }
}

/**
 * Express error handler middleware.
 * Converts errors to standardized JSON responses.
 * @param {Error} err - Error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Next middleware
 */
export function errorHandler(err, req, res, next) {
  // Already sent response
  if (res.headersSent) {
    return next(err);
  }

  // Handle AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && { details: err.details }),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      }
    });
  }

  // Handle Zod validation errors (if not caught by middleware)
  if (err.name === 'ZodError') {
    const details = err.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code
    }));

    return res.status(400).json({
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid request data',
        details
      }
    });
  }

  // Log unexpected errors
  logger.error('Error', err.message || String(err));

  // Generic error response
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
}

/**
 * Async route handler wrapper.
 * Catches async errors and forwards to error handler.
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not found handler for undefined routes.
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`
    }
  });
}

export default { AppError, ErrorCodes, errorHandler, asyncHandler, notFoundHandler };
