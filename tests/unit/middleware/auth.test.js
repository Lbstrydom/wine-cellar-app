/**
 * @fileoverview Unit tests for authentication middleware.
 * Tests JWT validation, header parsing, and optional auth.
 *
 * Uses vi.hoisted() for stable mock references. Explicitly mocks jsonwebtoken
 * to prevent --no-isolate leakage from auth-firsttime-user.test.js which
 * mocks JWT to return valid data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set DATABASE_URL before any imports
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost/mock';

// --- Stable mock references via vi.hoisted ---
const { mockJwtDecode, mockJwtVerify } = vi.hoisted(() => {
  const mockJwtDecode = vi.fn();
  const mockJwtVerify = vi.fn();
  return { mockJwtDecode, mockJwtVerify };
});

// Mock modules BEFORE importing auth.js
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn() }
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

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

// Mock JWT to control verification behavior (prevents leakage from other test files)
vi.mock('jsonwebtoken', () => ({
  default: {
    decode: mockJwtDecode,
    verify: mockJwtVerify
  }
}));

// Now import the module to test
const { requireAuth, optionalAuth } = await import('../../../src/middleware/auth.js');

describe('Auth Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = { headers: {}, user: null };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnValue(undefined)
    };
    mockNext = vi.fn();
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

    it('should extract Bearer token and attempt JWT verification', async () => {
      // When a valid Bearer header is provided, requireAuth should:
      // 1. Extract the token (strip "Bearer ")
      // 2. Attempt to verify it via JWKS
      // Since we haven't mocked JWKS properly, it will fail auth — which proves
      // the token was extracted and verification was attempted.
      mockReq.headers = { authorization: 'Bearer abc123xyz' };

      await requireAuth(mockReq, mockRes, mockNext);

      // Should have attempted verification and failed (no JWKS mock)
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
    });
  });

  describe('optionalAuth', () => {
    it('should call next without setting user when no token', async () => {
      mockReq.headers = {};
      mockReq.user = null;

      await optionalAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeNull();
    });
  });

  describe('Authorization header parsing', () => {
    it('should reject all non-Bearer auth schemes', async () => {
      const schemes = ['Basic', 'Digest', 'OAuth', 'token'];

      for (const scheme of schemes) {
        mockReq.headers = { authorization: `${scheme} credentials` };
        mockRes.status.mockClear();
        mockRes.json.mockClear();
        mockNext.mockClear();

        await requireAuth(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockNext).not.toHaveBeenCalled();
      }
    });

    it('should reject empty bearer token', async () => {
      mockReq.headers = { authorization: 'Bearer ' };

      await requireAuth(mockReq, mockRes, mockNext);

      // Empty token should fail verification
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});
