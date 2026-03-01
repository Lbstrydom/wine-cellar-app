/**
 * @fileoverview Shared database mock helpers for --no-isolate test runs.
 * Provides consistent db mock setup that avoids mock identity mismatches.
 * @module tests/helpers/mockDb
 */

/**
 * Create a fresh db mock with prepare/get/all/run chain.
 * Returns an object matching the db abstraction API.
 *
 * @returns {{ prepare: import('vitest').Mock }}
 */
export function createDbMock() {
  return {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn()
    })),
    transaction: vi.fn()
  };
}

/**
 * Create a standard logger mock matching src/utils/logger.js API.
 * @returns {{ info: Mock, error: Mock, warn: Mock, debug: Mock }}
 */
export function createLoggerMock() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  };
}

/**
 * Create a test Express app with cellar context injected.
 * Avoids copy-pasting createApp() across every route test file.
 *
 * @param {import('express').Router} router - The router under test
 * @param {string} mountPath - URL prefix (e.g., '/wines')
 * @param {Object} [options]
 * @param {string} [options.cellarId='cellar-1'] - Injected cellar ID
 * @param {string} [options.userId='user-1'] - Injected user ID
 * @param {string} [options.cellarRole='owner'] - Injected cellar role
 * @returns {import('express').Express}
 */
export function createTestApp(router, mountPath, options = {}) {
  // Dynamic import avoids module-level side effects in --no-isolate
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cellarId = options.cellarId ?? 'cellar-1';
    req.user = { id: options.userId ?? 'user-1' };
    req.cellarRole = options.cellarRole ?? 'owner';
    next();
  });
  app.use(mountPath, router);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}
