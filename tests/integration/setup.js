/**
 * @fileoverview Global setup for integration tests.
 * Starts the server before integration tests run.
 */

import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

let serverProcess = null;

/**
 * Wait for server to be ready by polling health endpoint.
 */
async function waitForServer(url, maxAttempts = 30, intervalMs = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await delay(intervalMs);
  }
  throw new Error(`Server did not become ready at ${url} after ${maxAttempts * intervalMs}ms`);
}

export async function setup() {
  const baseUrl = process.env.TEST_API_URL || 'http://localhost:3000';

  // Check if server is already running (e.g., started manually)
  try {
    const response = await fetch(`${baseUrl}/health/live`);
    if (response.ok) {
      console.log('[Integration Setup] Server already running, skipping spawn');
      return;
    }
  } catch {
    // Not running, we'll start it
  }

  console.log('[Integration Setup] Starting server...');

  // Start the server as a child process
  serverProcess = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: '3000',
      NODE_ENV: 'test'
    },
    detached: false
  });

  // Log server output for debugging
  serverProcess.stdout?.on('data', (data) => {
    if (process.env.DEBUG_INTEGRATION) {
      console.log(`[Server] ${data.toString().trim()}`);
    }
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  serverProcess.on('error', (err) => {
    console.error('[Integration Setup] Failed to start server:', err);
  });

  // Wait for server to be ready
  await waitForServer(`${baseUrl}/health/live`);
  console.log('[Integration Setup] Server is ready');
}

export async function teardown() {
  if (serverProcess) {
    console.log('[Integration Teardown] Stopping server...');
    serverProcess.kill('SIGTERM');

    // Give it a moment to clean up
    await delay(500);

    if (!serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }

    serverProcess = null;
    console.log('[Integration Teardown] Server stopped');
  }
}
