/**
 * @fileoverview Unit tests for error response utilities.
 */

import {
  AppError,
  ErrorCodes,
  asyncHandler
} from '../../../src/utils/errorResponse.js';

describe('ErrorCodes', () => {
  it('should define all expected error codes', () => {
    expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCodes.CONFLICT).toBe('CONFLICT');
    expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCodes.FORBIDDEN).toBe('FORBIDDEN');
    expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCodes.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
    expect(ErrorCodes.BAD_REQUEST).toBe('BAD_REQUEST');
    expect(ErrorCodes.RATE_LIMITED).toBe('RATE_LIMITED');
  });
});

describe('AppError', () => {
  it('should create error with default code', () => {
    const error = new AppError('Something went wrong');
    expect(error.message).toBe('Something went wrong');
    expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(error.statusCode).toBe(500);
    expect(error.details).toBeNull();
  });

  it('should create error with specific code', () => {
    const error = new AppError('Not found', ErrorCodes.NOT_FOUND);
    expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(error.statusCode).toBe(404);
  });

  it('should create error with details', () => {
    const details = [{ field: 'name', message: 'Required' }];
    const error = new AppError('Validation failed', ErrorCodes.VALIDATION_ERROR, details);
    expect(error.details).toEqual(details);
    expect(error.statusCode).toBe(400);
  });

  describe('static factory methods', () => {
    it('notFound should create NOT_FOUND error', () => {
      const error = AppError.notFound('Wine', 123);
      expect(error.message).toBe('Wine 123 not found');
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.statusCode).toBe(404);
    });

    it('notFound without id should work', () => {
      const error = AppError.notFound('Wine');
      expect(error.message).toBe('Wine not found');
    });

    it('validation should create VALIDATION_ERROR', () => {
      const details = [{ field: 'name' }];
      const error = AppError.validation('Invalid input', details);
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual(details);
    });

    it('conflict should create CONFLICT error', () => {
      const error = AppError.conflict('Resource already exists');
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.statusCode).toBe(409);
    });

    it('serviceUnavailable should create SERVICE_UNAVAILABLE error', () => {
      const error = AppError.serviceUnavailable('Rating API');
      expect(error.message).toBe('Rating API is not available');
      expect(error.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
      expect(error.statusCode).toBe(503);
    });

    it('badRequest should create BAD_REQUEST error', () => {
      const error = AppError.badRequest('Invalid parameter');
      expect(error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(error.statusCode).toBe(400);
    });
  });
});

describe('asyncHandler', () => {
  it('should call the wrapped function', async () => {
    const mockFn = async (req, res) => {
      res.status(200).json({ ok: true });
    };

    const wrapped = asyncHandler(mockFn);
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes
    };

    await wrapped({}, mockRes, () => {});
  });

  it('should forward errors to next', async () => {
    const error = new Error('Test error');
    const mockFn = async () => {
      throw error;
    };

    const wrapped = asyncHandler(mockFn);
    let capturedError = null;

    await wrapped({}, {}, (err) => {
      capturedError = err;
    });

    expect(capturedError).toBe(error);
  });
});
