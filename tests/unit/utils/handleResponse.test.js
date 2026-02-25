/**
 * @fileoverview Unit tests for handleResponse metadata propagation.
 * Verifies that validation, phase, and moveCount from error responses
 * are attached to the thrown Error object.
 *
 * base.js accesses window.fetch, localStorage, Headers at module scope,
 * so we must stub globals and use dynamic import (vi.stubGlobal is not
 * hoisted before static imports).
 */

let handleResponse;

beforeAll(async () => {
  // Stub browser globals that base.js expects at module scope
  vi.stubGlobal('window', { fetch: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('Headers', class MockHeaders extends Map {
    constructor(init) { super(); if (init) for (const [k, v] of Object.entries(init)) this.set(k, v); }
    append(k, v) { this.set(k, v); }
  });
  const mod = await import('../../../public/js/api/base.js');
  handleResponse = mod.handleResponse;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * Helper: create a mock Response with a JSON body.
 */
function mockResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 400 ? 'Bad Request' : 'Internal Server Error',
    json: async () => body,
    text: async () => text
  };
}

describe('handleResponse', () => {
  describe('successful responses', () => {
    it('should return parsed JSON for 200 OK', async () => {
      const res = mockResponse(200, { success: true, data: [1, 2, 3] });
      const result = await handleResponse(res);
      expect(result).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('should return empty object for empty body', async () => {
      const res = {
        ok: true,
        status: 200,
        text: async () => ''
      };
      const result = await handleResponse(res);
      expect(result).toEqual({});
    });
  });

  describe('error responses', () => {
    it('should throw with string error message', async () => {
      const res = mockResponse(400, { error: 'Validation failed' });
      await expect(handleResponse(res)).rejects.toThrow('Validation failed');
    });

    it('should throw with structured error message', async () => {
      const res = mockResponse(400, {
        error: { message: 'Invalid input', details: [{ field: 'name', message: 'required' }] }
      });
      await expect(handleResponse(res)).rejects.toThrow('Invalid input: name required');
    });

    it('should use default error when no error field', async () => {
      const res = mockResponse(500, { something: 'else' });
      await expect(handleResponse(res, 'Custom default')).rejects.toThrow('Custom default');
    });
  });

  describe('validation metadata propagation', () => {
    it('should attach validation object to thrown Error', async () => {
      const validation = {
        valid: false,
        errors: [{ type: 'slot_not_found', message: 'R1C1 not found' }],
        summary: { errorCount: 1, slotsNotFound: 1 }
      };
      const res = mockResponse(400, {
        error: 'Move plan validation failed',
        validation
      });

      try {
        await handleResponse(res);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.validation).toBeDefined();
        expect(err.validation.valid).toBe(false);
        expect(err.validation.errors).toHaveLength(1);
        expect(err.validation.errors[0].type).toBe('slot_not_found');
      }
    });

    it('should attach phase to thrown Error', async () => {
      const res = mockResponse(500, {
        error: 'Move execution failed',
        phase: 'transaction'
      });

      try {
        await handleResponse(res);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.phase).toBe('transaction');
      }
    });

    it('should attach moveCount to thrown Error', async () => {
      const res = mockResponse(500, {
        error: 'Move execution failed',
        phase: 'transaction',
        moveCount: 3
      });

      try {
        await handleResponse(res);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.moveCount).toBe(3);
      }
    });

    it('should attach moveCount of 0', async () => {
      const res = mockResponse(500, {
        error: 'Move execution failed',
        moveCount: 0
      });

      try {
        await handleResponse(res);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.moveCount).toBe(0);
      }
    });

    it('should not attach absent metadata', async () => {
      const res = mockResponse(400, { error: 'Simple error' });

      try {
        await handleResponse(res);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.validation).toBeUndefined();
        expect(err.phase).toBeUndefined();
        expect(err.moveCount).toBeUndefined();
      }
    });

    it('should attach all metadata together', async () => {
      const validation = {
        valid: false,
        errors: [{ type: 'source_mismatch', message: 'Wrong wine at R1C1' }],
        summary: { errorCount: 1 }
      };
      const res = mockResponse(400, {
        error: 'Move plan validation failed',
        validation,
        phase: 'validation',
        moveCount: 2
      });

      try {
        await handleResponse(res);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.validation).toEqual(validation);
        expect(err.phase).toBe('validation');
        expect(err.moveCount).toBe(2);
      }
    });
  });
});
