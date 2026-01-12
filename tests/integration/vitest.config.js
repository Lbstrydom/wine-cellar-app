/**
 * Vitest config specifically for integration tests.
 * Uses globalSetup to manage server lifecycle.
 * NODE_ENV is set to 'test' to allow auth bypass in tests.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    globalSetup: './tests/integration/setup.js',
    testTimeout: 30000, // Integration tests may be slower
    hookTimeout: 60000, // Allow time for server startup
    env: {
      NODE_ENV: 'test'  // Enable auth bypass for integration tests
    }
  }
});
