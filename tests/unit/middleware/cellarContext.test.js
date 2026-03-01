/**
 * @fileoverview Unit tests for cellar context middleware.
 * Tests cellar membership validation and context setting.
 * CRITICAL: Validates that X-Cellar-ID is never trusted without membership check.
 *
 * Uses vi.hoisted() for stable mock references to prevent --no-isolate leakage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set DATABASE_URL before any imports
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost/mock';

// --- Stable mock references via vi.hoisted ---
const { mockGet, mockRun, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockRun = vi.fn();
  const mockAll = vi.fn();
  const mockPrepare = vi.fn(() => ({ get: mockGet, run: mockRun, all: mockAll }));
  return { mockGet, mockRun, mockAll, mockPrepare };
});

vi.mock('../../../src/db/index.js', () => ({
  default: { prepare: mockPrepare }
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

const { requireCellarContext, requireCellarEdit, requireCellarOwner } = await import('../../../src/middleware/cellarContext.js');

describe('Cellar Context Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      user: { id: 'user123', active_cellar_id: 'cellar-active' },
      headers: {},
      cellarId: null,
      cellarRole: null
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnValue(undefined)
    };

    mockNext = vi.fn();

    // Reset only our mock functions — not the module registry
    mockPrepare.mockClear();
    mockGet.mockClear();
    mockRun.mockClear();
    mockAll.mockClear();
    mockRes.status.mockClear();
    mockRes.json.mockClear();
    mockNext.mockClear();
  });

  describe('requireCellarContext', () => {
    it('should use X-Cellar-ID header if provided and membership valid', async () => {
      mockGet.mockResolvedValue({ role: 'editor' });
      mockReq.headers['x-cellar-id'] = 'cellar-requested';

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockPrepare).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith('cellar-requested', 'user123');
      expect(mockReq.cellarId).toBe('cellar-requested');
      expect(mockReq.cellarRole).toBe('editor');
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject X-Cellar-ID if membership validation fails', async () => {
      mockGet.mockResolvedValue(null);
      mockReq.headers['x-cellar-id'] = 'cellar-unauthorized';

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Not a member of this cellar' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should use active_cellar_id if X-Cellar-ID not provided', async () => {
      mockGet.mockResolvedValue({ role: 'owner' });
      mockReq.headers = {};

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockGet).toHaveBeenCalledWith('cellar-active', 'user123');
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
        mockGet.mockResolvedValue({ role });

        await requireCellarContext(mockReq, mockRes, mockNext);

        expect(mockReq.cellarRole).toBe(role);
        expect(mockNext).toHaveBeenCalled();
      }
    });
  });

  describe('requireCellarEdit', () => {
    it('should allow access for owner role', () => {
      mockReq.cellarRole = 'owner';
      requireCellarEdit(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should allow access for editor role', () => {
      mockReq.cellarRole = 'editor';
      requireCellarEdit(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should deny access for viewer role', () => {
      mockReq.cellarRole = 'viewer';
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
      requireCellarOwner(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should deny access for editor role', () => {
      mockReq.cellarRole = 'editor';
      requireCellarOwner(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should deny access for viewer role', () => {
      mockReq.cellarRole = 'viewer';
      requireCellarOwner(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('X-Cellar-ID spoofing prevention (CRITICAL)', () => {
    it('should verify membership before accepting X-Cellar-ID', async () => {
      mockGet.mockResolvedValue(null);
      mockReq.headers['x-cellar-id'] = 'cellar-from-attacker';

      await requireCellarContext(mockReq, mockRes, mockNext);

      // Verify that membership query was executed
      expect(mockPrepare).toHaveBeenCalled();
      const sql = mockPrepare.mock.calls[0][0];
      expect(sql).toContain('cellar_memberships');

      // Verify request was rejected
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should not set cellarId without membership validation', async () => {
      mockGet.mockResolvedValue(null);
      mockReq.headers['x-cellar-id'] = 'unauthorized-cellar';

      await requireCellarContext(mockReq, mockRes, mockNext);

      // cellarId should remain null — never set without valid membership
      expect(mockReq.cellarId).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockGet.mockRejectedValue(new Error('DB error'));
      mockReq.headers = {};

      await requireCellarContext(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Cellar context error' });
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
        mockGet.mockResolvedValue({ role: cellar.role });

        await requireCellarContext(mockReq, mockRes, mockNext);

        expect(mockReq.cellarId).toBe(cellar.id);
        expect(mockReq.cellarRole).toBe(cellar.role);
        expect(mockNext).toHaveBeenCalled();
      }
    });
  });
});
