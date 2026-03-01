/**
 * @fileoverview Tests for first-time user atomic setup via requireAuth.
 * createFirstTimeUser is private — tested through the public requireAuth middleware.
 * Tests validate: invite gating, transaction atomicity, edge cases.
 *
 * Uses vi.hoisted() for stable mock references to prevent --no-isolate leakage.
 * Provides a real RSA public JWK so crypto.createPublicKey succeeds in the
 * jwt verification path (jwt.verify itself is mocked).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env before imports
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost/mock';
process.env.SUPABASE_URL = 'https://mock.supabase.co';

// --- Stable mock references via vi.hoisted ---
const {
  mockGet, mockRun, mockAll, mockPrepare,
  mockTransactionCallback, mockFetchFn,
  mockJwtDecode, mockJwtVerify
} = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockRun = vi.fn();
  const mockAll = vi.fn();
  const mockPrepare = vi.fn(() => ({ get: mockGet, run: mockRun, all: mockAll }));
  const mockTransactionCallback = vi.fn();
  const mockFetchFn = vi.fn();
  const mockJwtDecode = vi.fn();
  const mockJwtVerify = vi.fn();
  return {
    mockGet, mockRun, mockAll, mockPrepare,
    mockTransactionCallback, mockFetchFn,
    mockJwtDecode, mockJwtVerify
  };
});

vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: mockPrepare,
    transaction: mockTransactionCallback
  }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

// Mock jwt - decode returns complete token structure, verify returns user payload
vi.mock('jsonwebtoken', () => ({
  default: {
    decode: mockJwtDecode,
    verify: mockJwtVerify
  }
}));

// Mock global fetch for JWKS endpoint
vi.stubGlobal('fetch', mockFetchFn);

const { requireAuth } = await import('../../../src/middleware/auth.js');

// Valid RSA public key JWK (well-known test key) so crypto.createPublicKey succeeds
const VALID_RSA_JWK = {
  kid: 'test-kid',
  kty: 'RSA',
  alg: 'RS256',
  use: 'sig',
  n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
  e: 'AQAB'
};

/**
 * Helper: Create a mock req with a valid Bearer token.
 */
function makeReq(headers = {}) {
  return {
    headers: { authorization: 'Bearer valid-token', ...headers },
    user: null
  };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnValue(undefined)
  };
}

/**
 * Setup JWT mocks for a successful verification.
 * jwt.decode returns complete token, fetch returns valid JWKS,
 * jwt.verify returns the user payload.
 */
function setupJwtSuccess() {
  mockJwtDecode.mockReturnValue({
    header: { kid: 'test-kid' },
    payload: { sub: 'user-new', email: 'new@example.com' }
  });
  mockJwtVerify.mockReturnValue({
    sub: 'user-new',
    email: 'new@example.com',
    name: 'New User'
  });
  mockFetchFn.mockResolvedValue({
    ok: true,
    json: async () => ({ keys: [VALID_RSA_JWK] })
  });
}

describe('First-Time User Atomic Setup (via requireAuth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupJwtSuccess();
  });

  describe('Invite Code Validation', () => {
    it('should return 403 when no invite code and user not found', async () => {
      // No existing profile → triggers createFirstTimeUser
      mockGet.mockResolvedValue(null);

      const req = makeReq(); // No x-invite-code header
      const res = makeRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      // createFirstTimeUser returns null when no invite code → 403
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('invite code')
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject expired invite codes', async () => {
      mockGet.mockResolvedValue(null);

      mockTransactionCallback.mockImplementation(async (fn) => {
        const client = {
          query: vi.fn()
            .mockResolvedValueOnce({
              rows: [{
                code: 'expired-code',
                max_uses: 5,
                use_count: 0,
                expires_at: new Date(Date.now() - 86400000) // Yesterday
              }]
            })
        };
        return fn(client);
      });

      const req = makeReq({ 'x-invite-code': 'expired-code' });
      const res = makeRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject maxed-out invite codes', async () => {
      mockGet.mockResolvedValue(null);

      mockTransactionCallback.mockImplementation(async (fn) => {
        const client = {
          query: vi.fn()
            .mockResolvedValueOnce({
              rows: [{
                code: 'maxed-code',
                max_uses: 2,
                use_count: 2,
                expires_at: new Date(Date.now() + 86400000)
              }]
            })
        };
        return fn(client);
      });

      const req = makeReq({ 'x-invite-code': 'maxed-code' });
      const res = makeRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject non-existent invite codes', async () => {
      mockGet.mockResolvedValue(null);

      mockTransactionCallback.mockImplementation(async (fn) => {
        const client = {
          query: vi.fn().mockResolvedValueOnce({ rows: [] })
        };
        return fn(client);
      });

      const req = makeReq({ 'x-invite-code': 'fake-code' });
      const res = makeRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Happy Path: Complete Setup', () => {
    it('should create profile, cellar, membership atomically and call next', async () => {
      mockGet.mockResolvedValue(null);

      const profileData = {
        id: 'user-new', email: 'new@example.com',
        display_name: 'New User', avatar_url: null,
        active_cellar_id: null, cellar_quota: 3, bottle_quota: 500, tier: 'free'
      };

      mockTransactionCallback.mockImplementation(async (fn) => {
        const client = {
          query: vi.fn().mockImplementation(async (sql) => {
            if (sql.includes('FOR UPDATE')) {
              return { rows: [{ code: 'good-code', max_uses: 5, use_count: 0, expires_at: new Date(Date.now() + 86400000) }] };
            }
            if (sql.includes('INSERT INTO profiles')) {
              return { rows: [profileData] };
            }
            if (sql.includes('INSERT INTO cellars')) {
              return { rows: [{ id: 'cellar-new' }] };
            }
            return { rows: [] };
          })
        };
        return fn(client);
      });

      const req = makeReq({ 'x-invite-code': 'good-code' });
      const res = makeRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeTruthy();
      expect(req.user.id).toBe('user-new');
      expect(req.user.active_cellar_id).toBe('cellar-new');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should execute all transaction steps in correct order', async () => {
      mockGet.mockResolvedValue(null);

      const operationOrder = [];
      mockTransactionCallback.mockImplementation(async (fn) => {
        const client = {
          query: vi.fn().mockImplementation(async (sql) => {
            if (sql.includes('FOR UPDATE')) { operationOrder.push('SELECT_LOCK'); return { rows: [{ code: 'x', max_uses: 10, use_count: 0, expires_at: null }] }; }
            if (sql.includes('INSERT INTO profiles')) { operationOrder.push('INSERT_PROFILE'); return { rows: [{ id: 'u1', email: 'e', display_name: 'd', avatar_url: null, active_cellar_id: null, cellar_quota: 3, bottle_quota: 500, tier: 'free' }] }; }
            if (sql.includes('INSERT INTO cellars')) { operationOrder.push('INSERT_CELLAR'); return { rows: [{ id: 'c1' }] }; }
            if (sql.includes('INSERT INTO cellar_memberships')) { operationOrder.push('INSERT_MEMBERSHIP'); return { rows: [] }; }
            if (sql.includes('UPDATE profiles SET active')) { operationOrder.push('UPDATE_ACTIVE'); return { rows: [] }; }
            if (sql.includes('UPDATE invites')) { operationOrder.push('UPDATE_INVITE'); return { rows: [] }; }
            return { rows: [] };
          })
        };
        return fn(client);
      });

      const req = makeReq({ 'x-invite-code': 'code' });
      await requireAuth(req, makeRes(), vi.fn());

      expect(operationOrder).toEqual([
        'SELECT_LOCK',
        'INSERT_PROFILE',
        'INSERT_CELLAR',
        'INSERT_MEMBERSHIP',
        'UPDATE_ACTIVE',
        'UPDATE_INVITE'
      ]);
    });
  });

  describe('Transaction Rollback', () => {
    it('should return 403 if profile creation fails inside transaction', async () => {
      mockGet.mockResolvedValue(null);

      mockTransactionCallback.mockImplementation(async (fn) => {
        const client = {
          query: vi.fn().mockImplementation(async (sql) => {
            if (sql.includes('FOR UPDATE')) {
              return { rows: [{ code: 'x', max_uses: 10, use_count: 0, expires_at: null }] };
            }
            if (sql.includes('INSERT INTO profiles')) {
              throw new Error('Profile creation failed');
            }
            return { rows: [] };
          })
        };
        return fn(client);
      });

      const req = makeReq({ 'x-invite-code': 'code' });
      const res = makeRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      // createFirstTimeUser catches the error and returns null → 403
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Existing User (not first-time)', () => {
    it('should call next immediately for existing user with profile', async () => {
      mockGet.mockResolvedValue({
        id: 'user-new', email: 'new@example.com',
        display_name: 'Existing', avatar_url: null,
        active_cellar_id: 'cellar-1', cellar_quota: 3, bottle_quota: 500, tier: 'free'
      });
      mockRun.mockResolvedValue({ changes: 1 });

      const req = makeReq();
      const res = makeRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe('user-new');
      expect(mockTransactionCallback).not.toHaveBeenCalled();
    });

    it('should update last_login_at for existing user', async () => {
      mockGet.mockResolvedValue({
        id: 'user-new', email: 'e', display_name: 'd',
        avatar_url: null, active_cellar_id: 'c1', cellar_quota: 3, bottle_quota: 500, tier: 'free'
      });
      mockRun.mockResolvedValue({ changes: 1 });

      await requireAuth(makeReq(), makeRes(), vi.fn());

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('last_login_at'));
      expect(mockRun).toHaveBeenCalled();
    });
  });
});
