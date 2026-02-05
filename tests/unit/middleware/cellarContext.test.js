/**
 * @fileoverview Unit tests for cellar context middleware.
 * Tests cellar membership validation and context setting.
 * CRITICAL: Validates that X-Cellar-ID is never trusted without membership check.
 */



// Set DATABASE_URL before any imports
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost/mock';

// Mock db BEFORE importing cellarContext.js
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
const { requireCellarContext, requireCellarEdit, requireCellarOwner } = await import('../../../src/middleware/cellarContext.js');
import db from '../../../src/db/index.js';

describe('Cellar Context Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      user: {
        id: 'user123',
        active_cellar_id: 'cellar-active'
      },
      headers: {},
      cellarId: null,
      cellarRole: null
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnValue(undefined)
    };

    mockNext = vi.fn();

    vi.clearAllMocks();
  });

  describe('requireCellarContext', () => {
    it('should use X-Cellar-ID header if provided and membership valid', async () => {
      const requestedCellarId = 'cellar-requested';

      db.prepare.mockReturnValue({
        get: vi.fn().mockResolvedValue({
          role: 'editor'
        }),
        run: vi.fn()
      });

      mockReq.headers['x-cellar-id'] = requestedCellarId;

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockReq.cellarId).toBe(requestedCellarId);
      expect(mockReq.cellarRole).toBe('editor');
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject X-Cellar-ID if membership validation fails', async () => {
      const requestedCellarId = 'cellar-unauthorized';

      db.prepare.mockReturnValue({
        get: vi.fn().mockResolvedValue(null),  // No membership
        run: vi.fn()
      });

      mockReq.headers['x-cellar-id'] = requestedCellarId;

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not a member of this cellar'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should use active_cellar_id if X-Cellar-ID not provided', async () => {
      db.prepare.mockReturnValue({
        get: vi.fn().mockResolvedValue({
          role: 'owner'
        }),
        run: vi.fn()
      });

      // No x-cellar-id header
      mockReq.headers = {};

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockReq.cellarId).toBe('cellar-active');
      expect(mockReq.cellarRole).toBe('owner');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should fail if no active_cellar_id is set', async () => {
      mockReq.user.active_cellar_id = null;
      mockReq.headers = {};

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining('No active cellar')
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should set cellarRole correctly for all role types', async () => {
      const roles = ['owner', 'editor', 'viewer'];

      for (const role of roles) {
        mockReq.headers = {};
        mockRes.status.mockClear();
        mockNext.mockClear();

        db.prepare.mockReturnValue({
          get: vi.fn().mockResolvedValue({ role }),
          run: vi.fn()
        });

        await requireCellarContext(mockReq, mockRes, mockNext);

        expect(mockReq.cellarRole).toBe(role);
      }
    });
  });

  describe('requireCellarEdit', () => {
    it('should allow access for owner role', () => {
      mockReq.cellarRole = 'owner';
      mockNext.mockClear();

      requireCellarEdit(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should allow access for editor role', () => {
      mockReq.cellarRole = 'editor';
      mockNext.mockClear();

      requireCellarEdit(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should deny access for viewer role', () => {
      mockReq.cellarRole = 'viewer';
      mockNext.mockClear();
      mockRes.status.mockClear();
      mockRes.json.mockClear();

      requireCellarEdit(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining('Editor or owner')
      });
    });
  });

  describe('requireCellarOwner', () => {
    it('should allow access only for owner role', () => {
      mockReq.cellarRole = 'owner';
      mockNext.mockClear();

      requireCellarOwner(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should deny access for editor role', () => {
      mockReq.cellarRole = 'editor';
      mockNext.mockClear();
      mockRes.status.mockClear();

      requireCellarOwner(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should deny access for viewer role', () => {
      mockReq.cellarRole = 'viewer';
      mockNext.mockClear();
      mockRes.status.mockClear();

      requireCellarOwner(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('X-Cellar-ID spoofing prevention (CRITICAL)', () => {
    it('should verify membership before accepting X-Cellar-ID', async () => {
      // This is the critical security test
      // Even if client sends X-Cellar-ID, it must validate membership

      const membershipCheckQuery = [];

      db.prepare.mockImplementation((sql) => {
        if (sql) membershipCheckQuery.push(sql);
        return {
          get: vi.fn().mockResolvedValue(null),  // No membership
          run: vi.fn()
        };
      });

      mockReq.headers['x-cellar-id'] = 'cellar-from-attacker';

      await requireCellarContext(mockReq, mockRes, mockNext);

      // Verify that membership was checked
      expect(membershipCheckQuery.length).toBeGreaterThan(0);
      expect(membershipCheckQuery[0]).toContain('cellar_memberships');

      // Verify request was rejected
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should not set cellarId without membership validation', async () => {
      db.prepare.mockReturnValue({
        get: vi.fn().mockResolvedValue(null),  // Membership check fails
        run: vi.fn()
      });

      mockReq.headers['x-cellar-id'] = 'unauthorized-cellar';
      const originalCellarId = mockReq.cellarId;

      await requireCellarContext(mockReq, mockRes, mockNext);

      // cellarId should remain null/original if membership check failed
      expect(mockReq.cellarId).toBe(originalCellarId);
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      db.prepare.mockReturnValue({
        get: vi.fn().mockRejectedValue(new Error('DB error')),
        run: vi.fn()
      });

      mockReq.headers = {};

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Cellar context error'
      });
    });
  });

  describe('Multiple membership scenarios', () => {
    it('should handle user with multiple cellar roles', async () => {
      const cellars = [
        { id: 'cellar1', role: 'owner' },
        { id: 'cellar2', role: 'editor' },
        { id: 'cellar3', role: 'viewer' }
      ];

      for (const cellar of cellars) {
        mockReq.headers['x-cellar-id'] = cellar.id;
        mockRes.status.mockClear();
        mockNext.mockClear();

        db.prepare.mockReturnValue({
          get: vi.fn().mockResolvedValue({ role: cellar.role }),
          run: vi.fn()
        });

        await requireCellarContext(mockReq, mockRes, mockNext);

        expect(mockReq.cellarId).toBe(cellar.id);
        expect(mockReq.cellarRole).toBe(cellar.role);
      }
    });
  });
});
