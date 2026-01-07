/**
 * @fileoverview Unit tests for validation middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate, validateBody, validateQuery, validateParams } from '../../../src/middleware/validate.js';

describe('validate middleware', () => {
  const testSchema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive()
  });

  function createMockReqRes(source, data) {
    return {
      req: { [source]: data },
      res: {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      },
      next: vi.fn()
    };
  }

  describe('validate()', () => {
    it('should pass validation with valid data', () => {
      const middleware = validate(testSchema, 'body');
      const { req, res, next } = createMockReqRes('body', { name: 'Test', count: 5 });

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should update request with validated/transformed data', () => {
      const schemaWithTransform = z.object({
        name: z.string().trim()
      });
      const middleware = validate(schemaWithTransform, 'body');
      const { req, res, next } = createMockReqRes('body', { name: '  trimmed  ' });

      middleware(req, res, next);

      expect(req.body.name).toBe('trimmed');
      expect(next).toHaveBeenCalled();
    });

    it('should return 400 for validation errors', () => {
      const middleware = validate(testSchema, 'body');
      const { req, res, next } = createMockReqRes('body', { name: '', count: -1 });

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should include field-specific error details', () => {
      const middleware = validate(testSchema, 'body');
      const { req, res, next } = createMockReqRes('body', { name: '', count: 'not-a-number' });

      middleware(req, res, next);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.error.details).toBeInstanceOf(Array);
      expect(jsonCall.error.details.length).toBeGreaterThan(0);
      expect(jsonCall.error.details[0]).toHaveProperty('field');
      expect(jsonCall.error.details[0]).toHaveProperty('message');
    });

    it('should forward non-Zod errors to next', () => {
      const badSchema = {
        parse: () => { throw new Error('Non-Zod error'); }
      };
      const middleware = validate(badSchema, 'body');
      const { req, res, next } = createMockReqRes('body', {});

      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('validateBody()', () => {
    it('should validate request body', () => {
      const middleware = validateBody(testSchema);
      const { req, res, next } = createMockReqRes('body', { name: 'Test', count: 1 });

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('validateQuery()', () => {
    it('should validate query parameters and store in req.validated.query', () => {
      const querySchema = z.object({
        limit: z.coerce.number().int().positive().default(50)
      });
      const middleware = validateQuery(querySchema);
      const { req, res, next } = createMockReqRes('query', { limit: '10' });

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      // Express 5: req.query is getter-only, so coerced values go to req.validated.query
      expect(req.validated.query.limit).toBe(10);
    });
  });

  describe('validateParams()', () => {
    it('should validate URL parameters', () => {
      const paramsSchema = z.object({
        id: z.coerce.number().int().positive()
      });
      const middleware = validateParams(paramsSchema);
      const { req, res, next } = createMockReqRes('params', { id: '123' });

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.params.id).toBe(123);
    });
  });
});
