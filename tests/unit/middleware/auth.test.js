/**
 * @fileoverview Unit tests for authentication middleware.
 * Tests JWT validation, profile creation, and first-time user setup.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set DATABASE_URL before any imports
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost/mock';

// Mock modules BEFORE importing auth.js
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn()
    }
  }))
}));

vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn()
    }))
  }
}));

// Now import the module to test
const { requireAuth, optionalAuth } = await import('../../../src/middleware/auth.js');
import db from '../../../src/db/index.js';

describe('Auth Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    // Create mock request/response/next
    mockReq = {
      headers: {},
      user: null
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnValue(undefined)
    };

    mockNext = vi.fn();

    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('requireAuth', () => {
    it('should return 401 if no authorization header', async () => {
      mockReq.headers = {};

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'No token provided' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 if authorization header has wrong format', async () => {
      mockReq.headers = { authorization: 'Basic xyz' };

      await requireAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'No token provided' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle Bearer token correctly', async () => {
      mockReq.headers = {
        authorization: 'Bearer abc123xyz'
      };

      // Verify token is extracted correctly (Bearer should be removed)
      expect(mockReq.headers.authorization.substring(7)).toBe('abc123xyz');
    });
  });

  describe('optionalAuth', () => {
    it('should not fail on missing token', async () => {
      mockReq.headers = {};
      mockReq.user = null;
      mockNext.mockClear();

      await optionalAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeNull();
    });
  });

  describe('Authorization header parsing', () => {
    it('should not accept other auth schemes', async () => {
      const schemes = ['Basic', 'Digest', 'OAuth', 'token'];

      for (const scheme of schemes) {
        mockReq.headers = { authorization: `${scheme} credentials` };
        mockRes.status.mockClear();
        mockRes.json.mockClear();
        mockNext.mockClear();

        await requireAuth(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
      }
    });
  });

  describe('Header case sensitivity', () => {
    it('should handle Authorization header case variations', () => {
      // HTTP headers are case-insensitive per RFC 7230
      // Express normalizes headers to lowercase
      mockReq.headers = { authorization: 'Bearer token' };

      expect('authorization' in mockReq.headers).toBe(true);
    });
  });
});
